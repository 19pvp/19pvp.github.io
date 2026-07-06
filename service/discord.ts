import { brightRed, cyan, green, magenta } from '@std/fmt/colors'
const TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
const GUILD_ID = Deno.env.get('DISCORD_GUILD_ID')
const authorization = `Bot ${TOKEN}`
const apiUrl = 'https://discord.com/api/v10'

type DiscordPayload = Record<string, unknown>
type DiscordHandler<T = unknown> = (data: T) => unknown
type DiscordEventMap = Record<string, <T>(fn: DiscordHandler<T>) => Set<DiscordHandler>>
type DiscordOnceMap = Record<string, () => Promise<DiscordPayload>>
type DiscordDoMap = Record<string, (data: DiscordPayload) => Promise<unknown>>
type DiscordRestMap = Record<string, (data: Record<string, unknown>) => Promise<unknown>>

const ONCE: Record<string, Set<DiscordHandler>> = {}
const ON: Record<string, Set<DiscordHandler>> = {}

const eventTypes = {
  GUILDS: [
    // 'GUILD_CREATE',
    // 'GUILD_UPDATE',
    // 'GUILD_DELETE',
    // 'GUILD_ROLE_CREATE',
    // 'GUILD_ROLE_UPDATE',
    // 'GUILD_ROLE_DELETE',
    // 'CHANNEL_CREATE',
    // 'CHANNEL_UPDATE',
    // 'CHANNEL_DELETE',
    // 'CHANNEL_PINS_UPDATE',
  ],
  GUILD_MEMBERS: [
    'GUILD_MEMBER_ADD',
    'GUILD_MEMBER_UPDATE',
    // 'GUILD_MEMBER_REMOVE',
    'GUILD_MEMBERS_CHUNK',
  ],
  GUILD_BANS: [
    // 'GUILD_BAN_ADD',
    // 'GUILD_BAN_REMOVE',
  ],
  GUILD_EMOJIS: [
    // 'GUILD_EMOJIS_UPDATE',
  ],
  GUILD_INTEGRATIONS: [
    // 'GUILD_INTEGRATIONS_UPDATE',
    // 'INTEGRATION_CREATE',
    // 'INTEGRATION_UPDATE',
    // 'INTEGRATION_DELETE',
  ],
  GUILD_WEBHOOKS: [
    // 'WEBHOOKS_UPDATE',
  ],
  GUILD_INVITES: [
    // 'INVITE_CREATE',
    // 'INVITE_DELETE',
  ],
  GUILD_VOICE_STATES: [
    // 'VOICE_STATE_UPDATE',
  ],
  GUILD_PRESENCES: [
    // 'PRESENCE_UPDATE',
  ],
  GUILD_MESSAGES: [
    'MESSAGE_CREATE',
    // 'MESSAGE_UPDATE',
    // 'MESSAGE_DELETE',
    // 'MESSAGE_DELETE_BULK',
  ],
  GUILD_MESSAGE_REACTIONS: [
    // 'MESSAGE_REACTION_ADD',
    // 'MESSAGE_REACTION_REMOVE',
    // 'MESSAGE_REACTION_REMOVE_ALL',
    // 'MESSAGE_REACTION_REMOVE_EMOJI',
  ],
  GUILD_MESSAGE_TYPING: [
    // 'TYPING_START',
  ],
  DIRECT_MESSAGES: [
    'MESSAGE_CREATE',
    // 'MESSAGE_UPDATE',
    // 'MESSAGE_DELETE',
    // 'CHANNEL_PINS_UPDATE',
  ],
  DIRECT_MESSAGE_REACTIONS: [
    // 'MESSAGE_REACTION_ADD',
    // 'MESSAGE_REACTION_REMOVE',
    // 'MESSAGE_REACTION_REMOVE_ALL',
    // 'MESSAGE_REACTION_REMOVE_EMOJI',
  ],
  DIRECT_MESSAGE_TYPING: [
    // 'TYPING_START',
  ],
}

const actionTypes = {
  REQUEST_GUILD_MEMBERS: 8,
}

export const discord = {
  once: {} as DiscordOnceMap,
  on: {} as DiscordEventMap,
  do: {} as DiscordDoMap,
  rest: {} as DiscordRestMap,
}

const stacks = new Map()
const registerEvent = (type: string) => {
  const on = (ON[type] = new Set())
  const once = (ONCE[type] = new Set())
  const next = (fn: DiscordHandler) => {
    stacks.set(fn, Error(`Source: ${fn.name}`).stack)
    once.add(fn)
  }
  discord.on[type] = (fn) => on.add(fn as DiscordHandler)
  discord.once[type] = () => new Promise<DiscordPayload>((resolve) => next(resolve as DiscordHandler))
}

let intents = 1 << 15 // MESSAGE_CONTENT intent
Object.entries(eventTypes).forEach(([, types], index) => {
  types.length && (intents |= 1 << index)
  types.forEach(registerEvent)
})

const guildIdEventTypes = new Set(['GUILD_CREATE', 'GUILD_UPDATE', 'GUILD_DELETE'])
const getEventGuildId = (type: string, d: DiscordPayload) => d?.guild_id || (guildIdEventTypes.has(type) ? d?.id : null)
const shouldDispatch = (type: string, d: DiscordPayload) => {
  if (!GUILD_ID || type === 'READY' || type === 'RESUMED') return true
  const guildId = getEventGuildId(type, d)
  return !guildId || guildId === GUILD_ID
}

let handleMessages = () => {}

const messagesToSend = new Set<string>()
for (const [key, op] of Object.entries(actionTypes)) {
  discord.do[key] = (d: DiscordPayload) => {
    const response = discord.once.GUILD_MEMBERS_CHUNK()
    messagesToSend.add(JSON.stringify({ op, d }))
    handleMessages()
    return response
  }
}

registerEvent('READY')

let gatewayUrl = 'wss://gateway.discord.gg'
discord.on.READY((d: DiscordPayload) => {
  gatewayUrl = String(d.resume_gateway_url || gatewayUrl)
})
const log = (type: unknown, d: DiscordPayload | null) => {
  if (!d) return console.log(type, null)
  const dd = { ...d }
  const member = dd.member
  const author = dd.author
  const user = dd.user
  const isPrivateMessage = type === 'MESSAGE_CREATE' && dd.channel_type === 1
  for (
    const key of [
      'v',
      'user_settings',
      'session_id',
      'session_type',
      'resume_gateway_url',
      'private_channels',
      'presences',
      'guilds',
      'guild_join_requests',
      'geo_ordered_rtc_regions',
      'game_relationships',
      'application',
      'relationships',
      'auth',
      'nonce',
      'flags',
      'embeds',
      'guild_id',
      'channel_id',
      'channel_type',
      'components',
      'attachments',
      'edited_timestamp',
      'mentions',
      'mention_roles',
      'mention_everyone',
      'pinned',
      'tts',
      '_trace',
      'member',
      'author',
      'user',
    ]
  ) {
    delete dd[key]
  }

  isPrivateMessage && (dd.content = '[redacted private message]')
  const discordUser = user as { username?: string; id?: string } | undefined
  const discordMember = member as { nick?: string } | undefined
  const discordAuthor = author as { username?: string; id?: string } | undefined
  discordUser && (dd.user = { username: discordUser.username, id: discordUser.id })
  discordMember && (dd.member = discordMember.nick)
  discordAuthor && (dd.author = { username: discordAuthor.username, id: discordAuthor.id })
  console.log(type, dd)
}

let last = Date.now()
const connect = (failCount: number) => {
  console.log('connecting to', magenta(gatewayUrl))
  const start = Date.now()
  const ws = new WebSocket(`${gatewayUrl}/?v=10&encoding=json`)
  let seq: number | null = null
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined
  let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined
  let waitingForHeartbeatAck = false
  let reconnecting = false
  const stopHeartbeat = () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    if (heartbeatTimeout) clearTimeout(heartbeatTimeout)
  }
  const reconnect = () => {
    if (reconnecting) return
    reconnecting = true
    stopHeartbeat()
    // limit reconnection attemps rate exponentially
    const nextTryIn = Math.max(0, start + 1000 * (2 ** failCount - 1) - Date.now())
    setTimeout(connect, nextTryIn, failCount + 1)
  }
  // reset fail count once ready
  discord.once.READY().then(() => {
    console.log('connected in', Date.now() - last)
    handleMessages = () => {
      for (const message of messagesToSend) {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(message)
        messagesToSend.delete(message)
      }
    }
    failCount = 0
    handleMessages()
  })

  const resetConnection = () => {
    // console.log(cyan('ZOMBIFED'), 'reconnect the client', new Date())
    // TODO: try too resume ?
    stopHeartbeat()
    ws.close()
    reconnect()
  }

  const sendHeartbeat = () => {
    last = Date.now()
    waitingForHeartbeatAck = true
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: seq }))
  }

  const heartbeat = () => {
    if (waitingForHeartbeatAck) return resetConnection()
    sendHeartbeat()
  }

  const startHeartbeat = (interval: number) => {
    stopHeartbeat()
    heartbeatTimeout = setTimeout(() => {
      heartbeat()
      heartbeatInterval = setInterval(heartbeat, interval)
    }, Math.random() * interval)
  }

  ws.addEventListener('close', (event) => {
    stopHeartbeat()
    console.log(
      'close socket',
      JSON.stringify({
        timeStamp: event.timeStamp,
        type: event.type,
        wasClean: event.wasClean,
        code: event.code,
        reason: event.reason,
      }),
    )
    if (event.code === 4004) {
      console.error('Discord gateway authentication failed; not reconnecting without a new token')
      return
    }
    reconnect()
  })

  const run = (fn: DiscordHandler, d: DiscordPayload) => {
    try {
      fn(d)
    } catch (err) {
      const stack = stacks.get(fn)
      console.log(brightRed('ERROR:'))
      console.log(err)
      console.log(cyan('STACK:'))
      console.log(stack)
      console.log(green('FUNCTION:'))
      console.log(String(fn))
    }
  }
  ws.addEventListener('message', (event) => {
    const { t, s, op, d } = JSON.parse(String(event.data))
    if (s != null) seq = s
    switch (op) {
      case 0: {
        // DISPATCH
        if (!shouldDispatch(String(t), d)) return
        log(cyan(t), d)
        const on = ON[t]
        const once = ONCE[t]
        if (!on) return
        for (const fn of on) run(fn, d)
        for (const fn of once) run(fn, d)
        once.clear()
        return
      }
      case 1: // HEARTBEAT
        return sendHeartbeat()
      case 2: // IDENTIFY
        return log('IDENTIFY', d)
      case 3: // STATUSUPDATE
        return log('STATUSUPDATE', d)
      case 4: // VOICESTATEUPDATE
        return log('VOICESTATEUPDATE', d)
      case 6: // RESUME
        return log('RESUME', d)
      case 7: // RECONNECT
        return log('RECONNECT', d)
      case 8: // REQUESTGUILDMEMBERS
        return log('REQUESTGUILDMEMBERS', d)
      case 9: {
        resetConnection()
        return log('INVALIDSESSION', d)
      }
      case 10: // HELLO
        startHeartbeat(d.heartbeat_interval)
        ws.send(
          JSON.stringify({
            op: 2, // IDENTIFY
            d: {
              token: TOKEN,
              intents,
              properties: { $os: 'linux', $browser: 'wow19', $device: 'wow19' },
            },
          }),
        )
        return
      case 11: // HEARTBEATACK
        // log('HEARTBEATAC', { delay: Date.now() - last })
        waitingForHeartbeatAck = false
        return
      default:
        log(`OP_${op}`, d)
    }
  })
}

// DISCORD_APP_ID
// DISCORD_PUB_KEY
// DISCORD_TOKEN
// DISCORD_CLIENT_SECRET
type DiscordRequestInit = Omit<RequestInit, 'body'> & { body?: unknown }

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const discordFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const res = await fetch(url, init)
  if (res.status !== 429) return res
  const retryAfterHeader = res.headers.get('x-ratelimit-reset-after') || res.headers.get('retry-after')
  const waitMs = (Number(retryAfterHeader) || 60) * 1000
  console.warn(`[Discord API] Rate limited (429). Retrying in ${waitMs}ms...`)
  await delay(waitMs)
  return discordFetch(url, init)
}

const parseDiscordResponse = async (res: Response) => {
  const text = await res.text().catch(() => '')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const validateDiscordToken = async () => {
  if (!TOKEN) return false
  const res = await discordFetch(`${apiUrl}/users/@me`, {
    headers: { authorization },
    signal: AbortSignal.timeout(5000),
  })
  const response = await parseDiscordResponse(res)
  if (!res.ok) {
    console.error('Discord token validation failed', {
      status: res.status,
      statusText: res.statusText,
      response,
      tokenLength: TOKEN.length,
    })
    return false
  }
  const user = response as { id?: string; username?: string; bot?: boolean }
  console.log('Discord token validated', {
    id: user.id,
    username: user.username,
    bot: user.bot,
    tokenLength: TOKEN.length,
  })
  return true
}

if (!TOKEN) {
  console.warn('DISCORD_TOKEN is not set; Discord gateway bridge is disabled')
} else {
  validateDiscordToken()
    .then((valid) => {
      if (valid) connect(0)
    })
    .catch((err) => {
      console.error('Discord token validation failed before gateway connect', String(err))
    })
}

const rest = async (pathname: string, params: DiscordRequestInit) => {
  if (params.body && typeof params.body !== 'string') {
    const headers = (params.headers || (params.headers = {})) as Record<string, string>
    const type = headers['content-type'] || headers['Content-Type']
    if (type === 'application/x-www-form-urlencoded') {
      params.body = String(new URLSearchParams(params.body as Record<string, string>))
    } else {
      type || (headers['content-type'] = 'application/json')
      params.body = JSON.stringify(params.body)
    }
  }
  const res = await discordFetch(`${apiUrl}${pathname}`, params as RequestInit)
  // TODO: check the response headers
  // to see if I should attempt JSON parsing
  let response: unknown = await res.text()
  try {
    response = JSON.parse(String(response))
  } catch {
    // Non-JSON responses are returned as text.
  }
  if (!res.ok) {
    const err = Error(res.statusText) as Error & { response?: unknown }
    err.response = response
    console.log(res)
    console.log(response)
    throw err
  }
  return response
}

discord.rest.POST_CHANNEL_MESSAGE = ({ channel, content }) =>
  rest(`/channels/${channel}/messages`, {
    method: 'POST',
    headers: { authorization },
    body: {
      content,
      flags: 4, // disable embeds
      allowed_mentions: { parse: [] }, // disable pings
    },
  })

discord.rest.GET_GUILD_MEMBERS = ({ guild, after = '0', limit = 1000 }) =>
  rest(`/guilds/${guild}/members?${new URLSearchParams({ after: String(after), limit: String(limit) })}`, {
    method: 'GET',
    headers: { authorization },
  })

const API = (method: string) => (url: string, init?: DiscordRequestInit) =>
  discordFetch(`https://discord.com/api/v10${url}`, {
    method,
    ...init,
    body: (init?.body == null
      ? undefined
      : (typeof init.body === 'string' || init.body instanceof Uint8Array)
      ? init.body
      : JSON.stringify(init.body)) as BodyInit,
    headers: { 'Content-Type': 'application/json', authorization, ...init?.headers },
  })

const POST = API('POST')
discord.do.createMessage = ({ channelId, content }) =>
  POST(`/channels/${channelId}/messages`, { method: 'POST', body: { content } })
