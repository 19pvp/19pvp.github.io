import { json } from './utils.ts'
import { env } from './env.ts'

const CLIENT_ID = env.DISCORD_APP_ID
const CLIENT_SECRET = env.DISCORD_CLIENT_SECRET
const GUILD_ID = env.DISCORD_GUILD_ID
const BOT_TOKEN = env.DISCORD_TOKEN
const PUBLIC_BASE_URL = env.PUBLIC_BASE_URL
const WEB_ORIGIN = env.WEB_ORIGIN

const roleGMLevel: Record<string, number> = {
  [env.GM_LEVEL_1]: 1,
  [env.GM_LEVEL_2]: 2,
  [env.GM_LEVEL_3]: 3,
}

// In-memory session store & temporary OAuth state store
const sessions = new Map<string, { user: unknown; gmLevel: number; fingerprint: string }>()
const states = new Set<string>()

// Cryptographically secure random session signing secret generated once at startup
const sessionSecret = crypto.randomUUID()

const hashSessionId = async (id: string) => {
  const data = new TextEncoder().encode(id + sessionSecret)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const getClientFingerprint = (req: Request) => {
  const ip = req.headers.get('x-forwarded-for') || ''
  const ua = req.headers.get('user-agent') || ''
  return `${ip}:${ua}`
}

const getSession = async (req: Request) => {
  const cookie = req.headers.get('cookie') || ''
  const match = cookie.match(/logs_session=([^;]+)/)
  if (!match) return null
  const [sessionId, signature] = match[1].split('.')
  if (!sessionId || !signature) return null
  const expectedSig = await hashSessionId(sessionId)
  if (signature !== expectedSig) return null

  const session = sessions.get(sessionId)
  if (!session) return null

  if (session.fingerprint !== getClientFingerprint(req)) {
    sessions.delete(sessionId)
    return null
  }
  return session
}

export const checkAuth = async (req: Request) => {
  const session = await getSession(req)
  if (!session || session.gmLevel < 1) {
    return false
  }
  return true
}

export const handleAuth = async (req: Request) => {
  const url = new URL(req.url)

  // Configure CORS headers (always present and non-empty)
  const corsHeaders = {
    'access-control-allow-origin': WEB_ORIGIN,
    'access-control-allow-credentials': 'true',
  }

  if (url.pathname === '/auth/discord/login') {
    const state = crypto.randomUUID()
    states.add(state)
    // Clear state after 5 mins
    setTimeout(() => states.delete(state), 5 * 60 * 1000)

    const redirectUri = `${PUBLIC_BASE_URL}/auth/discord/callback`
    const discordUrl = `https://discord.com/api/oauth2/authorize?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify',
      state,
    })}`

    return new Response(null, {
      status: 302,
      headers: {
        'location': discordUrl,
        'set-cookie': `discord_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
        ...corsHeaders,
      },
    })
  }

  if (url.pathname === '/auth/discord/callback') {
    const code = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    const cookie = req.headers.get('cookie') || ''
    const stateCookie = cookie.match(/discord_oauth_state=([^;]+)/)?.[1] || ''

    if (!state || state !== stateCookie || !states.has(state)) {
      return json({ error: 'CSRF state verification failed' }, { status: 400, headers: corsHeaders })
    }
    states.delete(state)

    // Exchange code for token
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${PUBLIC_BASE_URL}/auth/discord/callback`,
      }),
    })
    if (!tokenRes.ok) {
      return json({ error: 'Failed to exchange OAuth code' }, { status: 400, headers: corsHeaders })
    }
    const { access_token } = await tokenRes.json()

    // Fetch user
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bearer ${access_token}` },
    })
    if (!userRes.ok) {
      return json({ error: 'Failed to fetch Discord user info' }, { status: 400, headers: corsHeaders })
    }
    const user = await userRes.json()

    // Fetch guild member
    const memberRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${user.id}`, {
      headers: { authorization: `Bot ${BOT_TOKEN}` },
    })
    if (!memberRes.ok) {
      return json({ error: 'Failed to fetch guild membership info' }, { status: 403, headers: corsHeaders })
    }
    const member = await memberRes.json()

    // Determine GM level
    let gmLevel = 0
    for (const role of member.roles || []) {
      const level = roleGMLevel[role]
      if (level && level > gmLevel) {
        gmLevel = level
      }
    }

    if (gmLevel < 1) {
      return json({ error: 'Forbidden: No GM role mapped' }, { status: 403, headers: corsHeaders })
    }

    const sessionId = crypto.randomUUID()
    const signature = await hashSessionId(sessionId)
    sessions.set(sessionId, {
      user,
      gmLevel,
      fingerprint: getClientFingerprint(req),
    })

    return new Response(null, {
      status: 302,
      headers: {
        'location': '/',
        'set-cookie': `logs_session=${sessionId}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
        'set-cookie-2': `discord_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        ...corsHeaders,
      },
    })
  }

  if (url.pathname === '/auth/me') {
    const session = await getSession(req)
    if (!session) {
      return json({ authenticated: false }, { headers: corsHeaders })
    }
    return json({
      authenticated: true,
      user: session.user,
      gmLevel: session.gmLevel,
    }, { headers: corsHeaders })
  }

  if (url.pathname === '/auth/logout' && req.method === 'POST') {
    const cookie = req.headers.get('cookie') || ''
    const sessionId = cookie.match(/logs_session=([^.;]+)/)?.[1]
    if (sessionId) {
      sessions.delete(sessionId)
    }
    return new Response(null, {
      status: 200,
      headers: {
        'set-cookie': `logs_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        ...corsHeaders,
      },
    })
  }

  return null
}
