// npx mysql-schema-ts mysql://system:$PASSWORD@$HOSTNAME:3306/acore_world  > world-schema.ts

// CREATE USER 'DB_USER' IDENTIFIED BY 'DB_PASSWORD');
// CREATE DATABASE web;
// GRANT ALL PRIVILEGES ON web.* TO 'DB_USER';
// GRANT ALL PRIVILEGES ON acore_auth.* TO 'DB_USER';
// GRANT ALL PRIVILEGES ON acore_world.* TO 'DB_USER';
// GRANT ALL PRIVILEGES ON acore_characters.* TO 'DB_USER';

import { red } from '@std/fmt/colors'
import { Client, configLogger } from 'mysql'

export type SqlValue = string | number | bigint | boolean | Date | null | undefined
export type SqlRow = Record<string, unknown>

let db: Client | undefined

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw Error(`${name} is required for database access`)
  return value
}

const database = async () => {
  if (db) return db

  await configLogger({ enable: false })
  db = await new Client().connect({
    hostname: requiredEnv('HOSTNAME'),
    username: Deno.env.get('DB_USER') || 'system',
    poolSize: Number(Deno.env.get('DB_POOL_SIZE')) || 3,
    password: requiredEnv('PASSWORD'),
  })
  return db
}

export const sql = async (template: TemplateStringsArray, ...args: SqlValue[]): Promise<SqlRow[]> => {
  const query = template.join('?').trim()
  return await sqlRaw(query, args)
}

export const sqlRaw = async (query: string, args: SqlValue[] = []): Promise<SqlRow[]> => {
  const sql = query.trim()
  const db = await database()

  try {
    const result = sql.slice(0, 6).toUpperCase() === 'SELECT' ? await db.query(sql, args) : await db.execute(sql, args)
    return result as SqlRow[]
  } catch (err) {
    console.log(red(sql), args)
    throw err
  }
}
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
