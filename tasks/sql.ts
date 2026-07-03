import { sqlTransaction } from '../service/db.ts'

const apply = Deno.args.includes('--apply')
const file = Deno.args.find((arg) => !arg.startsWith('--'))
if (!file) throw Error('SQL file path is required')

const stripComments = (sql: string) =>
  sql.split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

const statements = stripComments(await Deno.readTextFile(file))
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean)

await sqlTransaction(statements, !apply)

console.log(`${apply ? 'executed' : 'validated'} ${statements.length} SQL statement(s) from ${file}`)
