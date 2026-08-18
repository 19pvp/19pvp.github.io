import { parseRealmDatabases } from './rbac.ts'

Deno.test('parseRealmDatabases accepts the documented mapping format', () => {
  const realms = parseRealmDatabases('1:chupato_world,2:19pvp_world')
  if (realms.get(1) !== 'chupato_world' || realms.get(2) !== '19pvp_world' || realms.size !== 2) {
    throw Error(`unexpected realm mapping: ${JSON.stringify([...realms])}`)
  }
})

Deno.test('parseRealmDatabases accepts JSON mappings', () => {
  const realms = parseRealmDatabases('{"1":"chupato_world","2":"19pvp_world"}')
  if (realms.get(1) !== 'chupato_world' || realms.get(2) !== '19pvp_world') {
    throw Error(`unexpected JSON realm mapping: ${JSON.stringify([...realms])}`)
  }
})
