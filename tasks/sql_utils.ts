import { sqlTransaction } from '../service/db.ts'

export const stripComments = (sql: string) =>
  sql.split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

export const splitStatements = (sql: string) => {
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

export const statementsFromSql = (sql: string) =>
  splitStatements(stripComments(sql))
    .map((statement) => statement.trim())
    .filter(Boolean)

export const applySqlFile = async (file: string, apply: boolean, options: { database?: string } = {}) => {
  const statements = statementsFromSql(await Deno.readTextFile(file))
  if (options.database) statements.unshift(`USE \`${options.database}\``)
  await sqlTransaction(statements, !apply)
  return options.database ? statements.length - 1 : statements.length
}
