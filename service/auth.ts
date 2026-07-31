import { json } from './utils.ts'
import { env } from './env.ts'
import { getCookies, setCookie } from '@std/http/cookie'
import { auth } from './db.ts'
import { discord } from './discord.ts'

const CLIENT_ID = env.DISCORD_APP_ID
const CLIENT_SECRET = env.DISCORD_CLIENT_SECRET
const GUILD_ID = env.DISCORD_GUILD_ID
const BASE_URL = env.PUBLIC_BASE_URL

const roleGMLevel: Record<string, number> = {
  [env.GM_LEVEL_1]: 1,
  [env.GM_LEVEL_2]: 2,
  [env.GM_LEVEL_3]: 3,
}

// In-memory OAuth state store
const states = new Set<string>()

type SessionData = {
  user: unknown
  gmLevel: number
  discordId: string
  exp: number
}

const getStoredSession = (sessionId: string): SessionData | null => {
  try {
    const raw = localStorage.getItem(`session:${sessionId}`)
    if (!raw) return null
    const data: SessionData = JSON.parse(raw)
    if (data.exp && Date.now() > data.exp) {
      localStorage.removeItem(`session:${sessionId}`)
      return null
    }
    return data
  } catch {
    return null
  }
}

const saveStoredSession = (sessionId: string, data: Omit<SessionData, 'exp'>) => {
  const session: SessionData = {
    ...data,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  }
  localStorage.setItem(`session:${sessionId}`, JSON.stringify(session))
}

const removeStoredSession = (sessionId: string) => {
  localStorage.removeItem(`session:${sessionId}`)
}

export const getSession = async (req: Request) => {
  const cookies = getCookies(req.headers)
  const sessionId = cookies['logs_session']
  if (!sessionId) return null

  return getStoredSession(sessionId)
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
    'access-control-allow-origin': BASE_URL,
    'access-control-allow-credentials': 'true',
  }

  if (url.pathname === '/auth/discord/login') {
    const state = crypto.randomUUID()
    states.add(state)
    // Clear state after 5 mins
    setTimeout(() => states.delete(state), 5 * 60 * 1000)

    const redirectUri = `${BASE_URL}/auth/discord/callback`
    const discordUrl = `https://discord.com/api/oauth2/authorize?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds.join',
      state,
      prompt: 'none',
    })}`

    const headers = new Headers({
      'location': discordUrl,
      ...corsHeaders,
    })
    setCookie(headers, {
      name: 'discord_oauth_state',
      value: state,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 300,
    })

    return new Response(null, {
      status: 302,
      headers,
    })
  }

  if (url.pathname === '/auth/discord/callback') {
    const code = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    const cookies = getCookies(req.headers)
    const stateCookie = cookies['discord_oauth_state'] || ''

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
        redirect_uri: `${BASE_URL}/auth/discord/callback`,
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

    // Invite/add user to the guild
    try {
      await discord.rest.PUT_GUILD_MEMBER({ guild: GUILD_ID, user: user.id, access_token })
    } catch (err) {
      console.error('Guild member join error:', err)
    }

    // Fetch guild member to get roles
    let gmLevel = 0
    try {
      const member = await discord.rest.GET_GUILD_MEMBER({ guild: GUILD_ID, user: user.id }) as { roles?: string[] }
      if (member && member.roles) {
        for (const role of member.roles) {
          const level = roleGMLevel[role]
          if (level && level > gmLevel) {
            gmLevel = level
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch guild membership info:', err)
    }

    // Ensure discord_account entry exists
    const discordId = BigInt(user.id)
    const [existingLink] = await auth.sql`
      SELECT account_id FROM discord_account WHERE discord_id=${discordId}
    `
    if (!existingLink) {
      await auth.sql`
        INSERT INTO discord_account (discord_id, discord_login)
        VALUES (${discordId}, ${user.username})
      `
    }

    const sessionId = crypto.randomUUID()
    saveStoredSession(sessionId, {
      user,
      gmLevel,
      discordId: user.id,
    })

    const headers = new Headers({
      'location': `${BASE_URL}/install`,
      ...corsHeaders,
    })
    setCookie(headers, {
      name: 'logs_session',
      value: sessionId,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 30 * 24 * 60 * 60,
    })
    setCookie(headers, {
      name: 'discord_oauth_state',
      value: '',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 0,
    })

    return new Response(null, {
      status: 302,
      headers,
    })
  }

  if (url.pathname === '/auth/me') {
    const session = await getSession(req)
    if (!session) return json({ authenticated: false }, { headers: corsHeaders })
    return json({
      authenticated: true,
      user: session.user,
      gmLevel: session.gmLevel,
      discordId: session.discordId,
    }, { headers: corsHeaders })
  }

  if (url.pathname === '/auth/logout' && req.method === 'POST') {
    const cookies = getCookies(req.headers)
    const sessionId = cookies['logs_session']
    if (sessionId) removeStoredSession(sessionId)

    const headers = new Headers(corsHeaders)
    setCookie(headers, {
      name: 'logs_session',
      value: '',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 0,
    })
    return new Response(null, {
      status: 200,
      headers,
    })
  }

  return null
}
