import { applySqlFile } from './sql_utils.ts'

const apply = Deno.args.includes('--apply')
const file = Deno.args.find((arg) => !arg.startsWith('--'))
if (!file) throw Error('SQL file path is required')

const statements = await applySqlFile(file, apply)

console.log(`${apply ? 'executed' : 'validated'} ${statements} SQL statement(s) from ${file}`)
