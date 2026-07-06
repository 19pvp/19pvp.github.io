// npx mysql-schema-ts mysql://system:$PASSWORD@$HOSTNAME:3306/acore_world  > world-schema.ts

// CREATE USER 'DB_USER' IDENTIFIED BY 'DB_PASSWORD');
// CREATE DATABASE web;
// GRANT ALL PRIVILEGES ON web.* TO 'DB_USER';
// GRANT ALL PRIVILEGES ON acore_auth.* TO 'DB_USER';
// GRANT ALL PRIVILEGES ON acore_world.* TO 'DB_USER';
// GRANT ALL PRIVILEGES ON acore_characters.* TO 'DB_USER';

import { red } from '@std/fmt/colors'
import { Client, configLogger } from 'mysql'
import playerbotsConfig from '../config/playerbots.json' with { type: 'json' }
import worldserverConfig from '../config/worldserver.json' with { type: 'json' }

export type SqlValue = string | number | bigint | boolean | Date | null | undefined
export type SqlRow = Record<string, unknown>
type SqlConnection = {
  query: (query: string, args?: SqlValue[]) => Promise<unknown>
  execute: (query: string, args?: SqlValue[]) => Promise<unknown>
}
type SqlTag<T> = (template: TemplateStringsArray, ...args: SqlValue[]) => Promise<T>
type RawSqlTag<T> = (template: TemplateStringsArray, ...args: unknown[]) => Promise<T>
type DatabaseScope = {
  sql: SqlTag<SqlRow[]>
  raw: { sql: RawSqlTag<SqlRow[]> }
  transaction: { sql: RawSqlTag<void> }
}
class RollbackValidation extends Error {
  constructor() {
    super('rollback validation')
  }
}

const dbByConfig = new Map<string, Client>()

import { env } from './env.ts'

const validateDatabaseName = (name: string, label = 'database') => {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw Error(`invalid ${label} ${name}`)
  return name
}

const unquote = (value: unknown) => String(value || '').replace(/^"|"$/g, '')
const databaseConfig = (info: unknown, label: string) => {
  const [hostname, port, username, password, db] = unquote(info).split(';')
  if (!hostname || !port || !username || password === undefined || !db) {
    throw Error(`${label} must be a 5-part database info string`)
  }

  return {
    hostname: env.DB_HOSTNAME || hostname,
    port: env.DB_PORT !== 3306 ? env.DB_PORT : Number(port),
    username: env.DB_USERNAME || username,
    password: env.DB_PASSWORD || password,
    db: validateDatabaseName(db, label),
  }
}

const authDb = databaseConfig(worldserverConfig.LoginDatabaseInfo, 'LoginDatabaseInfo')
const worldDb = databaseConfig(worldserverConfig.WorldDatabaseInfo, 'WorldDatabaseInfo')
const charactersDb = databaseConfig(worldserverConfig.CharacterDatabaseInfo, 'CharacterDatabaseInfo')
const playerbotsDb = databaseConfig(playerbotsConfig.PlayerbotsDatabaseInfo, 'PlayerbotsDatabaseInfo')

export const authDbName = authDb.db
export const worldDbName = worldDb.db
export const charactersDbName = charactersDb.db
export const playerbotsDbName = playerbotsDb.db

const dbConnect = {
  poolSize: env.DB_POOL_SIZE,
}

type DatabaseConfig = typeof authDb
const databaseKey = (config: DatabaseConfig) => `${config.hostname};${config.port};${config.username};${config.db}`

const database = async (config: DatabaseConfig = worldDb) => {
  const key = databaseKey(config)
  const existing = dbByConfig.get(key)
  if (existing) return existing

  await configLogger({ enable: false })
  const client = await new Client().connect({
    ...dbConnect,
    hostname: config.hostname,
    port: config.port,
    username: config.username,
    password: config.password,
    db: config.db,
  })
  dbByConfig.set(key, client)
  return client
}

export const sqlRaw = async (
  query: string,
  args: SqlValue[] = [],
  options: { database?: DatabaseConfig } = {},
): Promise<SqlRow[]> => {
  const sql = query.trim()
  const db = await database(options.database)

  try {
    const result = sql.slice(0, 6).toUpperCase() === 'SELECT' ? await db.query(sql, args) : await db.execute(sql, args)
    return result as SqlRow[]
  } catch (err) {
    console.log(red(sql), args)
    throw err
  }
}

const executeRaw = async (connection: SqlConnection, sql: string, args: SqlValue[] = []) => {
  return sql.slice(0, 6).toUpperCase() === 'SELECT'
    ? await connection.query(sql, args)
    : await connection.execute(sql, args)
}

const rawSql = (template: TemplateStringsArray, ...args: unknown[]) => String.raw(template, ...args)

const stripComments = (sql: string) =>
  sql.split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

const splitStatements = (sql: string) => {
  const statements: string[] = []
  let current = ''
  let quote: "'" | '"' | undefined
  let escaped = false

  for (const char of sql) {
    current += char

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === ';') {
      statements.push(current.slice(0, -1))
      current = ''
    }
  }

  if (current.trim()) statements.push(current)
  return statements
}

const statementsFromSql = (sql: string) =>
  splitStatements(stripComments(sql))
    .map((statement) => statement.trim())
    .filter(Boolean)

export const sqlTransaction = async (statements: string[], rollback = true) => {
  const db = await database() as Client & {
    transaction: <T>(fn: (connection: SqlConnection) => Promise<T>) => Promise<T>
  }

  try {
    await db.transaction(async (connection) => {
      for (const statement of statements) {
        await executeRaw(connection, statement)
      }
      if (rollback) throw new RollbackValidation()
    })
  } catch (err) {
    if (err instanceof RollbackValidation) return
    throw err
  }
}

const scope = (config: DatabaseConfig): DatabaseScope => ({
  sql: async (template, ...args) => {
    const query = template.join('?').trim()
    return await sqlRaw(query, args, { database: config })
  },
  raw: {
    sql: async (template, ...args) => await sqlRaw(rawSql(template, ...args), [], { database: config }),
  },
  transaction: {
    sql: async (template, ...args) => {
      const statements = statementsFromSql(rawSql(template, ...args))
      const db = await database(config) as Client & {
        transaction: <T>(fn: (connection: SqlConnection) => Promise<T>) => Promise<T>
      }

      try {
        await db.transaction(async (connection) => {
          for (const statement of statements) {
            await executeRaw(connection, statement)
          }
        })
      } catch (err) {
        if (err instanceof RollbackValidation) return
        throw err
      }
    },
  },
})

export const auth = scope(authDb)
export const worldserver = scope(worldDb)
export const characters = scope(charactersDb)
export const playerbots = scope(playerbotsDb)
/*
Query Graveyard:

UPDATE acore_auth.discord_account SET account_id=${3}
WHERE discord_id=${525092099884974081n}
// 202907732062240769n = 'test1'
// 525092099884974081n = 'test2'

SELECT online, name FROM acore_characters.characters

INSERT INTO acore_auth.discord_message (message, discord_id)
VALUES (${`test-${Math.random()}`}, ${BigInt('143860662987128832')})

UPDATE acore_auth.discord_account SET discord_login=${'Clément'}
WHERE discord_id=${143860662987128832n}

INSERT INTO acore_auth.discord_account (discord_login, account_id, discord_id)
VALUES ('Clément', 1, 143860662987128832)


*/
