import { unemojify } from 'node-emoji'

import { auth, type SqlRow } from './db.ts'
import { discord } from './discord.ts'
import { describeImage } from './gemini.ts'
import { handleInitialStateEvents, wowEvents } from './wow-events.ts'
import { createAccount, getUsername, setGmLevel, setPassword, setUsernameAndPassword } from './account.ts'

const botUserID = '766251453337436170' // App Id
const guildId = Deno.env.get('DISCORD_GUILD_ID')
const generalChannelId = Deno.env.get('DISCORD_GENERAL_CHANNEL_ID') || Deno.env.get('DISCORD_GUILD_ID')
const gmCommandChannelId = Deno.env.get('DISCORD_GM_COMMAND_CHANNEL_ID') || '1519357383946535183'
const roleGMLevel = {
  [Deno.env.get('GM_LEVEL_1') || '_1']: 1,
  [Deno.env.get('GM_LEVEL_2') || '_2']: 2,
  [Deno.env.get('GM_LEVEL_3') || '_3']: 3,
}
const MAX_ACCOUNT_USERNAME_LENGTH = 17
const MAX_DISCORD_LOGIN_LENGTH = 255

type DiscordUser = {
  id: string
  username: string
  global_name?: string | null
  bot?: boolean
}

type DiscordMember = {
  user?: DiscordUser
  roles: string[]
  nick?: string | null
}

type DiscordAttachment = {
  width?: number
  height?: number
  content_type?: string
  proxy_url: string
}

type DiscordMessage = {
  author: DiscordUser
  member?: DiscordMember
  channel_type?: number
  channel_id: string
  content: string
  attachments: DiscordAttachment[]
}

type DiscordAccount = SqlRow & {
  id: bigint | string
  login: string
  account: number
  gmLevel?: number
  syncAction?: SyncAction
}

type SyncAction = 'created' | 'linked' | 'existing' | 'cached'

type DiscordAccountRow = SqlRow & {
  id: bigint | string
  login: string
  account: number | null
}

const getHighestGMLevel = (acc: number, role: string) => Math.max(acc, roleGMLevel[role] || 0)
const toAccountNamePart = (value: unknown) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const toAccountUsername = (user: DiscordUser, login = user.username) => {
  const base = toAccountNamePart(login) || toAccountNamePart(user.username) || 'discord'
  return base.slice(0, MAX_ACCOUNT_USERNAME_LENGTH)
}
const toDiscordLogin = (user: DiscordUser, login?: string | null) => {
  const normalized = (login || user.username || '')
    .normalize('NFKC')
  const dbSafe = [...normalized]
    .filter((char) => (char.codePointAt(0) || 0) <= 0xFFFF)
    .join('')
    .trim()
    .slice(0, MAX_DISCORD_LOGIN_LENGTH)
  return dbSafe || toAccountUsername(user)
}

const activeUsers: Record<string, DiscordAccount> = {}
const activeUsersByAccount: Record<number, DiscordAccount> = {}
const activeUserSyncs = new Map<string, Promise<DiscordAccount | undefined>>()

const toDiscordAccount = (
  row: DiscordAccountRow,
  extra: Pick<DiscordAccount, 'gmLevel' | 'syncAction'> = {},
): DiscordAccount => ({
  ...row,
  id: row.id,
  login: String(row.login),
  account: Number(row.account),
  ...extra,
})

const getDiscordAccountByDiscordId = async (discordId: bigint) => {
  const [row] = await auth.sql`
    SELECT discord_id AS id, discord_login AS login, account_id AS account
    FROM discord_account WHERE discord_id=${discordId}
  `
  return row ? toDiscordAccount(row as DiscordAccountRow) : undefined
}

const createDiscordAccount = async (discordId: bigint, login: string, username: string) => {
  const account = await createAccount({ username })
  await auth.sql`
    INSERT INTO discord_account (discord_id, discord_login, account_id)
    VALUES (${discordId}, ${login}, ${account.id})
  `
  return toDiscordAccount({ id: discordId, login, account: account.id }, { syncAction: 'created' })
}

const linkDiscordAccount = async (userData: DiscordAccount, discordId: bigint, username: string) => {
  const account = await createAccount({ username, useExisting: true })
  await auth.sql`
    UPDATE discord_account
    SET account_id=${account.id}
    WHERE discord_id=${discordId}
  `
  return {
    ...userData,
    account: account.id,
    syncAction: 'linked' as const,
  }
}

const ensureDiscordAccount = async (discordId: bigint, login: string, username: string) => {
  const userData = await getDiscordAccountByDiscordId(discordId)
  if (!userData) return await createDiscordAccount(discordId, login, username)
  if (!userData.account) return await linkDiscordAccount(userData, discordId, username)
  return { ...userData, syncAction: 'existing' as const }
}

const syncUserDataNow = async (member?: DiscordMember, user = member?.user): Promise<DiscordAccount | undefined> => {
  if (!member) return
  user || (user = member.user)
  if (!user || user.bot) return

  const gmLevel = member.roles.reduce(getHighestGMLevel, 0)
  const displayLogin = member.nick || user.global_name || user.username
  const login = toDiscordLogin(user, displayLogin)
  const accountUsername = toAccountUsername(user, displayLogin)
  const id = BigInt(user.id)
  let userData = activeUsers[user.id]
  const cachedGmLevel = userData?.gmLevel
  let syncAction: SyncAction = userData?.account ? 'cached' : 'existing'
  if (!userData?.account) {
    userData = await ensureDiscordAccount(id, login, accountUsername)
    userData.gmLevel = cachedGmLevel
    activeUsers[user.id] = userData
    syncAction = userData.syncAction || syncAction

    userData.account &&
      (activeUsersByAccount[userData.account] = userData)
  }

  if (userData.gmLevel == null) {
    const access = await auth.sql`
      SELECT gmlevel FROM account_access
      WHERE id=${userData.account}
    `

    userData.gmLevel = Number(access[0]?.gmlevel) || 0
  }

  if (userData.login !== login) {
    await auth.sql`
      UPDATE discord_account
      SET discord_login=${login}
      WHERE discord_id=${id}
    `
    userData.login = login
  }

  if (userData.gmLevel !== gmLevel) {
    console.log(`account ${login} gm-level changed from ${userData.gmLevel} to ${gmLevel}`)
    userData.gmLevel = gmLevel
    await setGmLevel(userData.account, gmLevel)
  }

  userData.syncAction = syncAction
  return userData
}

const syncUserData = (member?: DiscordMember, user = member?.user) => {
  if (!member || !user || user.bot) return
  const currentSync = activeUserSyncs.get(user.id)
  if (currentSync) return currentSync
  const sync = syncUserDataNow(member, user)
    .finally(() => activeUserSyncs.delete(user.id))
  activeUserSyncs.set(user.id, sync)
  return sync
}

const syncGuildMembers = async () => {
  if (!guildId) {
    console.log('DISCORD_GUILD_ID is not set; skipping guild member sync')
    return
  }

  console.time('Sync guild members')
  let after = '0'
  const stats = {
    fetched: 0,
    synced: 0,
    created: 0,
    linked: 0,
    existing: 0,
    cached: 0,
    bots: 0,
    failed: 0,
  }
  while (true) {
    const members = await discord.rest.GET_GUILD_MEMBERS({ guild: guildId, after }) as DiscordMember[]
    if (!members.length) break

    for (const member of members) {
      stats.fetched++
      if (member.user?.bot) {
        stats.bots++
        continue
      }

      try {
        const user = await syncUserData(member)
        if (!user) continue
        stats.synced++
        if (user.syncAction) stats[user.syncAction]++
        if ((user.gmLevel || 0) > 0) {
          console.log(`Synced GM ${user.login}: ${user.syncAction} account ${user.account}`)
        }
      } catch (err) {
        stats.failed++
        console.error(`Failed to sync Discord member ${member.user?.id}`, err)
      }
    }

    after = members.at(-1)?.user?.id || after
    if (members.length < 1000) break
  }
  console.log('Synced Discord guild members', stats)
  console.timeEnd('Sync guild members')
}

discord.once.READY().then(syncGuildMembers).catch((err) => {
  console.error('Failed to sync Discord guild members', err)
})

const getDiscordDataForAccount = async (account: number) => {
  const userData = activeUsersByAccount[account]
  if (userData) return userData
  const [currentData] = await auth.sql`
    SELECT discord_id AS id, discord_login AS login, account_id AS account
    FROM discord_account WHERE account_id=${account}
  `
  if (!currentData) return undefined

  const currentUserData = toDiscordAccount(currentData as DiscordAccountRow)
  activeUsersByAccount[account] = currentUserData
  return currentUserData
}

const resultToMessage = (result: { success: boolean; output: unknown }) =>
  result.success
    ? (Array.isArray(result.output) ? result.output.join('\n') : String(result.output))
    : `Unable to update account: ${
      (typeof result.output === 'object' && result.output && 'message' in result.output
        ? String(result.output.message)
        : String(result.output)).trim()
    }`

const getAccountHelp = async (account: number) => {
  const username = await getUsername(account)
  return [
    `Your username is: ${username || 'unknown'}`,
    'Commands:',
    'password <new password>',
    'username <new username> <new password>',
  ].join('\n')
}

const handleAccountCommand = async (account: number, content: string) => {
  const parts = content.trim().split(/\s+/)
  const command = (parts.shift() || '').toLowerCase()

  if (!command || command === 'account' || command === 'help' || command === 'commands') {
    return await getAccountHelp(account)
  }

  if (command === 'password') {
    const password = parts.join(' ')
    if (!password) return 'Usage: password <new password>'
    return resultToMessage(await setPassword(account, password))
  }

  if (command === 'username') {
    const username = parts.shift() || ''
    const password = parts.join(' ')
    if (!username || !password) return 'Usage: username <new username> <new password>'
    return resultToMessage(await setUsernameAndPassword(account, username, password))
  }

  return await getAccountHelp(account)
}

const discordMarkdownToWowText = (content: string) =>
  content
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
    .replace(/[*_~`]/g, '')
/*
const _messageCreateExample = {
  type: 0,
  tts: false,
  timestamp: "2024-10-27T21:01:59.371000+00:00",
  pinned: false,
  nonce: "1300202866849349632",
  mentions: [],
  mention_roles: [],
  mention_everyone: false,
  member: {
    roles: [ "1297691066660687892" ],
    premium_since: null,
    pending: false,
    nick: null,
    mute: false,
    joined_at: "2024-10-20T22:38:02.328000+00:00",
    flags: 0,
    deaf: false,
    communication_disabled_until: null,
    banner: null,
    avatar: null
  },
  id: "1300202863967997983",
  flags: 0,
  embeds: [],
  edited_timestamp: null,
  content: "nice",
  components: [],
  channel_id: "1298381467910537266",
  author: {
    username: "devazuka",
    public_flags: 0,
    id: "143860662987128832",
    global_name: "Clement",
    discriminator: "0",
    clan: null,
    avatar_decoration_data: null,
    avatar: "a_1ec4a57542f002dd770cccc8fae9b5db"
  },
  attachments: [
    {
      width: 1024,
      url: "https://cdn.discordapp.com/attachments/310186336961167385/1379823041445367850/119-insolite-46.png?ex=6841a3d8&is=68405258&hm=530ee95106f369002dfc1843861430f12a69d61fb9a0dd1fb005014dc9447788&",
      size: 849730,
      proxy_url: "https://media.discordapp.net/attachments/310186336961167385/1379823041445367850/119-insolite-46.png?ex=6841a3d8&is=68405258&hm=530ee95106f369002dfc1843861430f12a69d61fb9a0dd1fb005014dc9447788&",
      placeholder_version: 1,
      placeholder: "CQgGBIAQiXp4iIWxaIWwtQdMOA==",
      id: "1379823041445367850",
      height: 640,
      filename: "119-insolite-46.png",
      content_type: "image/png",
      content_scan_version: 1
    }
  ],
  guild_id: "1297688961170538496"
}
*/
discord.on.MESSAGE_CREATE(async (event: DiscordMessage) => {
  if (event.author.id === botUserID) return
  if (event.channel_type === 1) {
    const { members } = await discord.do.REQUEST_GUILD_MEMBERS({
      guild_id: guildId,
      user_ids: [event.author.id],
    }) as { members: DiscordMember[] }

    if (!members.length) return

    const userData = await syncUserData(members[0], event.author)
    const command = event.content.trim().split(/\s+/, 1)[0]?.toLowerCase()
    if (command === 'password' || command === 'username') {
      if (!userData) return
      return discord.rest.POST_CHANNEL_MESSAGE({
        channel: event.channel_id,
        content: await handleAccountCommand(userData.account, event.content),
      })
    }

    const content = userData ? await getAccountHelp(userData.account) : `
Commands:
password <new password>
username <new username> <new password>
`
    return discord.rest.POST_CHANNEL_MESSAGE({ channel: event.channel_id, content })
  }
  if (event.channel_id !== generalChannelId) return
  const userData = await syncUserData(event.member, event.author)
  if (!userData) return
  const { id } = userData
  let message = event.content
  if (message.includes('<@')) {
    const missingUsers = new Map<number, string>()
    const content = event.content
      .split(/<@!?([0-9]+)>/g)
      .map((content, index) => {
        if (index % 2 === 0) return content
        const user = activeUsers[content]
        if (user) return user.account ? `<@${user.account}:${user.login}>` : user.login
        missingUsers.set(index, content)
        return '@unknown'
      })

    if (missingUsers.size) {
      const { members } = await discord.do.REQUEST_GUILD_MEMBERS({
        guild_id: guildId,
        user_ids: [...missingUsers.values()],
      }) as { members: DiscordMember[] }
      for (const [index, id] of missingUsers) {
        const user = await syncUserData(members.find((u) => u.user?.id === id))
        if (!user) continue
        content[index] = user.account ? `<@${user.account}:${user.login}>` : user.login
      }
    }
    message = content.join('')
  }

  // TODO: replace wowhead links to ingame chat links
  const attachement = await Promise.all(event.attachments.map(async (attachement) => {
    const { width, height, content_type, proxy_url } = attachement
    if (!content_type?.startsWith('image/')) return ''
    if (!width || !height) return ''
    const imageUrl = new URL(proxy_url)
    imageUrl.searchParams.set('format', 'webp')
    imageUrl.searchParams.set('width', String(Math.round((width / height) * 256)))
    imageUrl.searchParams.set('height', '256')
    try {
      return `[img:${await describeImage(imageUrl.href)}]`
    } catch (err) {
      console.log('error generating image description', err)
      console.log(imageUrl)
      return ''
    }
  }))

  const formattedMsg = unemojify(discordMarkdownToWowText(message).slice(0, 255))
  const fullMessage = [formattedMsg, ...attachement].filter((s) => s && s.trim()).join(' ').slice(0, 255)
  if (!fullMessage.length) return console.log('empty message, skipping.')
  console.log('[general]:', fullMessage)
  await auth.sql`
    INSERT INTO discord_message (message, discord_id, discord_login, account_id)
    VALUES (${fullMessage}, ${id}, ${userData.login}, ${userData.account})
  `
})
/*
const _guildMemberUpdateExample = {
  user: {
    username: "devazuka",
    public_flags: 0,
    id: "143860662987128832",
    global_name: "Clement",
    discriminator: "0",
    clan: null,
    avatar_decoration_data: null,
    avatar: "a_1ec4a57542f002dd770cccc8fae9b5db"
  },
  unusual_dm_activity_until: null,
  roles: [ "1297691066660687892" ],
  premium_since: null,
  pending: false,
  nick: "Pedro",
  joined_at: "2024-10-20T22:38:02.328000+00:00",
  guild_id: "1297688961170538496",
  flags: 0,
  communication_disabled_until: null,
  banner: null,
  avatar: null
}
*/
discord.on.GUILD_MEMBER_ADD((member: DiscordMember) => syncUserData(member))
discord.on.GUILD_MEMBER_UPDATE((member: DiscordMember) => syncUserData(member))

/*
const _wowMessageEvent = {
  id: 76,
  type: "GENERAL_CHANNEL_MESSAGE",
  at: new Date('2024-10-27T22:55:47.476Z'),
  data: {
    player: { id: 9, name: "Asulol", race: 1, class: 4, account: "TEST1" },
    message: "yoo"
  },
  start: new Date('2024-10-27T22:55:47.617Z'),
  elapsed: 0.068
}
*/

const replaceItemLinks = (_: string, itemStr: string, itemName: string) => {
  const [itemId, _itemEnchant] = itemStr.split(':')
  return `[${itemName}](https://www.wowhead.com/wotlk/item=${itemId}/${itemName.replaceAll(' ', '+')})`
}

wowEvents.on.GENERAL_CHANNEL_MESSAGE(async ({ data }) => {
  if (!generalChannelId || typeof data !== 'object' || !data) return
  const { player, message } = data
  if (
    typeof player !== 'object' || !player || !('account' in player) || !('name' in player) ||
    typeof message !== 'string'
  ) return
  const account = Number(player.account)
  const user = activeUsersByAccount[account] || (await getDiscordDataForAccount(account))
  if (!user) {
    // TODO: try to init data now ?
  }
  const mention = user ? `<@${user.id}>` : ''
  const content = `**[${mention}${String(player.name)}]**: ${
    message.replace(/\|Hitem:([^|]+)\|h\[([^\]]+)]\|h/, replaceItemLinks)
  }`
  await discord.rest.POST_CHANNEL_MESSAGE({ channel: generalChannelId, content })
})

wowEvents.on.COMMAND(async ({ data }) => {
  if (!gmCommandChannelId || typeof data !== 'object' || !data) return
  const { player, command } = data
  if (
    typeof player !== 'object' || !player || !('account' in player) || !('name' in player) ||
    typeof command !== 'string'
  ) return

  const account = Number(player.account)
  const user = account ? activeUsersByAccount[account] || (await getDiscordDataForAccount(account)) : undefined
  const mention = user ? `<@${user.id}> ` : ''
  const content = `**GM command** ${mention}${String(player.name)}: \`${command.replaceAll('`', '\\`')}\``
  await discord.rest.POST_CHANNEL_MESSAGE({ channel: gmCommandChannelId, content })
})

handleInitialStateEvents().catch((err) => {
  console.error('Failed to start WoW event polling', err)
})
