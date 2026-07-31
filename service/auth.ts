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

// In-memory temporary OAuth state store
const states = new Set<string>()

// Stable secret key derived from environment
const sessionSecret = env.LAUNCHER_VERIFICATION_HASH || '19pvp-stable-session-secret-seed'

const getKey = async () => {
  const enc = new TextEncoder()
  return await crypto.subtle.importKey(
    'raw',
    enc.encode(sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

const signSessionData = async (data: string) => {
  const key = await getKey()
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const verifySessionData = async (data: string, signatureHex: string) => {
  const key = await getKey()
  const sigBytes = new Uint8Array(signatureHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [])
  return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data))
}

export const getSession = async (req: Request) => {
  const cookies = getCookies(req.headers)
  const cookieValue = cookies['logs_session']
  if (!cookieValue) return null
  const lastDot = cookieValue.lastIndexOf('.')
  if (lastDot === -1) return null
  const payloadB64 = cookieValue.slice(0, lastDot)
  const signature = cookieValue.slice(lastDot + 1)
  if (!payloadB64 || !signature) return null

  try {
    const isValid = await verifySessionData(payloadB64, signature)
    if (!isValid) return null

    const jsonStr = new TextDecoder().decode(Uint8Array.from(atob(payloadB64), (c) => c.charCodeAt(0)))
    const session = JSON.parse(jsonStr)

    if (session.exp && Date.now() > session.exp) return null

    return {
      user: session.user,
      gmLevel: Number(session.gmLevel || 0),
      discordId: String(session.discordId),
    }
  } catch {
    return null
  }
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

    const payload = JSON.stringify({
      user,
      gmLevel,
      discordId: user.id,
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
    const payloadB64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
    const signature = await signSessionData(payloadB64)
    const token = `${payloadB64}.${signature}`

    const headers = new Headers({
      'location': `${BASE_URL}/install`,
      ...corsHeaders,
    })
    setCookie(headers, {
      name: 'logs_session',
      value: token,
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
