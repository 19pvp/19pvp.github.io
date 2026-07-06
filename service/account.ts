import { auth, type SqlRow } from './db.ts'

const MAX_ACCOUNT_USERNAME_LENGTH = 17
const N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7')
const G = 7n
const encoder = new TextEncoder()

type Account = SqlRow & {
  id: number
  username: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const getAccountByUsername = async (username: string, timeout = 10_000): Promise<Account> => {
  const start = Date.now()
  username = upperOnlyLatin(username)
  while (true) {
    const [account] = await auth.sql`SELECT * FROM account WHERE username = ${username}`
    if (account) return account as Account
    if (Date.now() - start >= timeout) break
    await sleep(100)
  }
  throw Error(`Created account ${username}, but it was not found in account`)
}

const upperOnlyLatin = (value: unknown) => String(value).replace(/[a-z]/g, (char) => char.toUpperCase())
const concatBytes = (...chunks: Uint8Array[]) => {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
const sha1 = async (...chunks: Uint8Array[]) =>
  new Uint8Array(await crypto.subtle.digest('SHA-1', concatBytes(...chunks)))
const bytesToLittleEndianBigInt = (bytes: Uint8Array) => {
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = (value << 8n) + BigInt(bytes[i])
  }
  return value
}
const bigIntToLittleEndianBytes = (value: bigint, length: number) => {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(value & 0xFFn)
    value >>= 8n
  }
  return bytes
}
const modPow = (base: bigint, exponent: bigint, modulus: bigint) => {
  let result = 1n
  base %= modulus
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus
    exponent >>= 1n
    base = (base * base) % modulus
  }
  return result
}
const toHex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const makeRegistrationData = async (username: string, password: string) => {
  username = upperOnlyLatin(username)
  password = upperOnlyLatin(password)

  const salt = crypto.getRandomValues(new Uint8Array(32))
  const inner = await sha1(encoder.encode(username), encoder.encode(':'), encoder.encode(password))
  const verifierHash = await sha1(salt, inner)
  const verifier = bigIntToLittleEndianBytes(
    modPow(G, bytesToLittleEndianBigInt(verifierHash), N),
    32,
  )

  return {
    salt: toHex(salt),
    verifier: toHex(verifier),
  }
}
const initRealmCharacters = async (accountId: number) => {
  await auth.sql`
    INSERT IGNORE INTO realmcharacters (realmid, acctid, numchars)
    SELECT id, ${accountId}, 0 FROM realmlist
  `
}

export const createAccount = async ({
  username: suggeredUsername,
  password = Math.random().toString(36).slice(2),
  gmLevel = 0,
  useExisting = false,
}: {
  username: string
  password?: string
  gmLevel?: number
  useExisting?: boolean
}): Promise<Account> => {
  let i = -1
  let username = suggeredUsername
  while (++i < 20) {
    username = upperOnlyLatin(username)
    if (username.length > MAX_ACCOUNT_USERNAME_LENGTH) {
      throw Error(`Account name can't be longer than ${MAX_ACCOUNT_USERNAME_LENGTH} characters, account not created!`)
    }

    const [existing] = await auth.sql`SELECT * FROM account WHERE username = ${username}`
    if (!existing) break
    if (useExisting) return existing as Account

    const key = i < 10 ? i.toString(36) : String(Math.floor(Math.random() * 999))
    username = `${suggeredUsername.slice(0, MAX_ACCOUNT_USERNAME_LENGTH - key.length)}${key}`
  }
  if (i >= 20) {
    throw Error(`Unable to create account ${suggeredUsername}: too many username collisions`)
  }

  const registration = await makeRegistrationData(String(username), password)
  await auth.sql`
    INSERT INTO account(username, salt, verifier, expansion, reg_mail, email, joindate)
    VALUES (${username}, UNHEX(${registration.salt}), UNHEX(${registration.verifier}), ${2}, '', '', NOW())
  `

  const account = await getAccountByUsername(username)
  await initRealmCharacters(account.id)
  gmLevel && (await setGmLevel(username, gmLevel))
  return account
}

export const getUsername = async (accountIdOrName: number | string) => {
  if (typeof accountIdOrName === 'string') return accountIdOrName
  const [account] = await auth.sql`SELECT username FROM account WHERE id=${accountIdOrName}`
  return account?.username ? String(account.username) : undefined
}

export const setGmLevel = async (account: number | string, gmLevel: number) => {
  const id = typeof account === 'string' ? (await getAccountByUsername(account)).id : account

  await auth.sql`DELETE FROM account_access WHERE id=${id}`
  if (gmLevel > 0) {
    await auth.sql`
      INSERT INTO account_access (id, gmlevel, RealmID)
      VALUES (${id}, ${gmLevel}, -1)
    `
  }
}

export const setPassword = async (account: number | string, password: string) => {
  const id = typeof account === 'string' ? (await getAccountByUsername(account)).id : account
  const username = await getUsername(id)
  if (!username) {
    return { success: false, output: { message: `Account ${account} does not exist` } }
  }

  const registration = await makeRegistrationData(username, password)
  await auth.sql`
    UPDATE account
    SET salt=UNHEX(${registration.salt}), verifier=UNHEX(${registration.verifier})
    WHERE id=${id}
  `

  return { success: true, output: [`Password changed for account ${username}.`] }
}

export const setUsernameAndPassword = async (account: number | string, username: string, password: string) => {
  const id = typeof account === 'string' ? (await getAccountByUsername(account)).id : account
  const currentUsername = await getUsername(id)
  if (!currentUsername) {
    return { success: false, output: { message: `Account ${account} does not exist` } }
  }

  username = upperOnlyLatin(username.trim())
  if (!username) {
    return { success: false, output: { message: 'Username cannot be empty.' } }
  }
  if (username.length > MAX_ACCOUNT_USERNAME_LENGTH) {
    return {
      success: false,
      output: { message: `Username can't be longer than ${MAX_ACCOUNT_USERNAME_LENGTH} characters.` },
    }
  }

  const [existing] = await auth.sql`SELECT id FROM account WHERE username = ${username} AND id <> ${id}`
  if (existing) {
    return { success: false, output: { message: `Username ${username} is already taken.` } }
  }

  const registration = await makeRegistrationData(username, password)
  await auth.sql`
    UPDATE account
    SET username=${username}, salt=UNHEX(${registration.salt}), verifier=UNHEX(${registration.verifier})
    WHERE id=${id}
  `

  return { success: true, output: [`Username changed from ${currentUsername} to ${username}.`] }
}
