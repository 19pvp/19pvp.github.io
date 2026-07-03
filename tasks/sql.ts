import { sqlTransaction } from '../service/db.ts'

const apply = Deno.args.includes('--apply')
const file = Deno.args.find((arg) => !arg.startsWith('--'))
if (!file) throw Error('SQL file path is required')

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

const statements = splitStatements(stripComments(await Deno.readTextFile(file)))
  .map((statement) => statement.trim())
  .filter(Boolean)

await sqlTransaction(statements, !apply)

console.log(`${apply ? 'executed' : 'validated'} ${statements.length} SQL statement(s) from ${file}`)
