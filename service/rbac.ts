import { auth, worldDbName, worldserverForDatabase } from './db.ts'
import { env } from './env.ts'

export type RbacRealm = {
  id: number
  name: string
  database: string
}

export const parseRealmDatabases = (value: string) => {
  const entries = new Map<number, string>()
  if (!value) return entries

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    for (const [id, database] of Object.entries(parsed)) {
      if (/^\d+$/.test(id) && typeof database === 'string' && database) entries.set(Number(id), database)
    }
    return entries
  } catch {
    // Fall back to the compact ID:database format below.
  }

  for (const entry of value.split(',')) {
    const [id, database] = entry.trim().split(/[:=]/, 2)
    if (id && database && /^\d+$/.test(id)) entries.set(Number(id), database)
  }
  return entries
}

const realmDatabases = parseRealmDatabases(env.REALM_DATABASES)
if (!realmDatabases.has(env.WORLD_ID)) realmDatabases.set(env.WORLD_ID, worldDbName)

export const getRbacRealms = async (): Promise<RbacRealm[]> => {
  const rows = await auth.sql`SELECT id, name FROM realmlist ORDER BY id`
  const names = new Map(rows.map((row) => [Number(row.id), String(row.name || `Realm ${row.id}`)]))
  return [...realmDatabases.entries()]
    .map(([id, database]) => ({ id, name: names.get(id) || `Realm ${id}`, database }))
    .sort((a, b) => a.id - b.id)
}

const asNumber = (value: unknown) => Number(value)
const permissionName = (row: Record<string, unknown>) => String(row.name || '')

export const getRbacData = async (realmId: number) => {
  const realms = await getRbacRealms()
  const realm = realms.find((candidate) => candidate.id === realmId)
  if (!realm) throw Error('No configured realms')

  const world = worldserverForDatabase(realm.database)
  const [permissions, linkedPermissions, defaultPermissions, accountPermissions, accounts, commands] = await Promise
    .all([
      auth.sql`SELECT id, name FROM rbac_permissions ORDER BY id`,
      auth.sql`
      SELECT linked.id, linked.linkedId, source.name AS name, target.name AS linkedName
      FROM rbac_linked_permissions linked
      JOIN rbac_permissions source ON source.id = linked.id
      JOIN rbac_permissions target ON target.id = linked.linkedId
      ORDER BY linked.id, linked.linkedId
    `,
      auth.sql`
      SELECT defaults.secId, defaults.permissionId, defaults.realmId, permissions.name
      FROM rbac_default_permissions defaults
      JOIN rbac_permissions permissions ON permissions.id = defaults.permissionId
      WHERE defaults.realmId IN (-1, ${realm.id})
      ORDER BY defaults.secId, defaults.permissionId, defaults.realmId
    `,
      auth.sql`
      SELECT accountPermissions.accountId, accountPermissions.permissionId, accountPermissions.granted,
        accountPermissions.realmId, accounts.username, permissions.name
      FROM rbac_account_permissions accountPermissions
      JOIN account accounts ON accounts.id = accountPermissions.accountId
      JOIN rbac_permissions permissions ON permissions.id = accountPermissions.permissionId
      WHERE accountPermissions.realmId IN (-1, ${realm.id})
      ORDER BY accounts.username, accountPermissions.permissionId, accountPermissions.realmId
    `,
      auth.sql`SELECT id, username FROM account ORDER BY username LIMIT 5000`,
      world.sql`SELECT name, security, help FROM command ORDER BY name`,
    ])

  let modulePermissions: Record<string, unknown>[] | null = null
  try {
    const [moduleTable] = await auth.sql`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'module_rbac_permissions'
    `
    if (Number(moduleTable?.count) > 0) {
      const rows = await auth.sql`SELECT * FROM module_rbac_permissions ORDER BY 1`
      modulePermissions = rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === 'bigint' ? String(value) : value instanceof Date ? value.toISOString() : value,
          ]),
        )
      )
    }
  } catch {
    // This table belongs to optional modules and is not part of AzerothCore's base auth schema.
  }

  return {
    realms,
    realm: { id: realm.id, name: realm.name, database: realm.database },
    permissions: permissions.map((row) => ({ id: asNumber(row.id), name: permissionName(row) })),
    linkedPermissions: linkedPermissions.map((row) => ({
      id: asNumber(row.id),
      linkedId: asNumber(row.linkedId),
      name: permissionName(row),
      linkedName: String(row.linkedName || ''),
    })),
    defaultPermissions: defaultPermissions.map((row) => ({
      secId: asNumber(row.secId),
      permissionId: asNumber(row.permissionId),
      realmId: asNumber(row.realmId),
      name: permissionName(row),
    })),
    accountPermissions: accountPermissions.map((row) => ({
      accountId: asNumber(row.accountId),
      username: String(row.username || ''),
      permissionId: asNumber(row.permissionId),
      granted: Boolean(Number(row.granted)),
      realmId: asNumber(row.realmId),
      name: permissionName(row),
    })),
    accounts: accounts.map((row) => ({ id: asNumber(row.id), username: String(row.username || '') })),
    commands: commands.map((row) => ({
      name: String(row.name || ''),
      security: asNumber(row.security),
      help: String(row.help || ''),
    })),
    modulePermissions,
  }
}

const asInt = (value: unknown, label: string) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw Error(`Invalid ${label}`)
  return number
}

const validateRealmId = async (value: unknown) => {
  const realmId = asInt(value, 'realm ID')
  if (realmId !== -1 && !(await getRbacRealms()).some((realm) => realm.id === realmId)) {
    throw Error('Unknown realm')
  }
  return realmId
}

const validatePermissionId = async (value: unknown) => {
  const permissionId = asInt(value, 'permission ID')
  const [permission] = await auth.sql`SELECT id FROM rbac_permissions WHERE id = ${permissionId}`
  if (!permission) throw Error('Unknown permission')
  return permissionId
}

export const updateRbac = async (body: Record<string, unknown>) => {
  const action = String(body.action || '')
  const permissionId = await validatePermissionId(body.permissionId)
  const realmId = await validateRealmId(body.realmId)

  if (action === 'account-upsert' || action === 'account-delete') {
    const accountId = asInt(body.accountId, 'account ID')
    const [account] = await auth.sql`SELECT id FROM account WHERE id = ${accountId}`
    if (!account) throw Error('Unknown account')
    if (action === 'account-delete') {
      await auth.sql`
        DELETE FROM rbac_account_permissions
        WHERE accountId = ${accountId} AND permissionId = ${permissionId} AND realmId = ${realmId}
      `
    } else {
      const granted = body.granted === false ? 0 : 1
      await auth.sql`
        INSERT INTO rbac_account_permissions (accountId, permissionId, granted, realmId)
        VALUES (${accountId}, ${permissionId}, ${granted}, ${realmId})
        ON DUPLICATE KEY UPDATE granted = VALUES(granted)
      `
    }
    return
  }

  if (action === 'default-upsert' || action === 'default-delete') {
    const secId = asInt(body.secId, 'security level')
    if (secId < 0 || secId > 3) throw Error('Security level must be between 0 and 3')
    if (action === 'default-delete') {
      await auth.sql`
        DELETE FROM rbac_default_permissions
        WHERE secId = ${secId} AND permissionId = ${permissionId} AND realmId = ${realmId}
      `
    } else {
      await auth.sql`
        INSERT IGNORE INTO rbac_default_permissions (secId, permissionId, realmId)
        VALUES (${secId}, ${permissionId}, ${realmId})
      `
    }
    return
  }

  if (action === 'link-upsert' || action === 'link-delete') {
    if (realmId !== -1) throw Error('Permission links are shared by all realms')
    const linkedId = await validatePermissionId(body.linkedId)
    if (action === 'link-delete') {
      await auth.sql`DELETE FROM rbac_linked_permissions WHERE id = ${permissionId} AND linkedId = ${linkedId}`
    } else {
      await auth.sql`
        INSERT IGNORE INTO rbac_linked_permissions (id, linkedId)
        VALUES (${permissionId}, ${linkedId})
      `
    }
    return
  }

  throw Error('Unknown RBAC action')
}
