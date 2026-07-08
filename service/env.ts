import { projectName } from '../env.ts'

export const isServer = Deno.mainModule.endsWith('server.ts') || Deno.args.includes('serve')

const envAccessGranted = Deno.permissions.querySync({ name: "env" }).state === 'granted'

const get = (key: string, required = false, fallback = ''): string => {
  if (!envAccessGranted) return fallback
  const value = Deno.env.get(key)
  if (required && !value) {
    if (isServer) {
      throw new Error(`Environment variable ${key} is required but missing.`)
    }
  }
  return value || fallback
}

const getNumber = (key: string, fallback: number): number => {
  if (!envAccessGranted) return fallback
  const value = Deno.env.get(key)
  if (!value) return fallback
  const parsed = Number(value)
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number (got: "${value}").`)
  }
  return parsed
}

export const env = {
  // Required for Auth & Discord Gate
  DISCORD_APP_ID: get('DISCORD_APP_ID', true),
  DISCORD_CLIENT_SECRET: get('DISCORD_CLIENT_SECRET', true),
  DISCORD_GUILD_ID: get('DISCORD_GUILD_ID', true),
  DISCORD_TOKEN: get('DISCORD_BOT_TOKEN', true),
  PUBLIC_BASE_URL: `https://${projectName}.devazuka.com`,

  // Auth / GM Role Configuration
  GM_LEVEL_1: get('GM_LEVEL_1', false, '_1'),
  GM_LEVEL_2: get('GM_LEVEL_2', false, '_2'),
  GM_LEVEL_3: get('GM_LEVEL_3', false, '_3'),

  // Database settings
  DB_HOSTNAME: get('DB_HOSTNAME'),
  DB_PORT: getNumber('DB_PORT', 3306),
  DB_USERNAME: get('DB_USERNAME'),
  DB_PASSWORD: get('DB_PASSWORD'),
  DB_POOL_SIZE: getNumber('DB_POOL_SIZE', 3),

  // API integrations & System administration
  GEMINI_TOKEN: get('GEMINI_TOKEN'),
  CORE_PATH: get('CORE_PATH', false, `/root/services/${projectName}/core`),
  WORLDSERVER_SERVICE_NAME: get('WORLDSERVER_SERVICE_NAME', false, `${projectName}-worldserver`),

  // Worldserver SOAP access
  PASSWORD: get('PASSWORD'),
  SOAP_HOST: get('SOAP_HOST'),
  SOAP_PORT: get('SOAP_PORT'),

  // Discord channels
  DISCORD_GENERAL_CHANNEL_ID: get('DISCORD_GENERAL_CHANNEL_ID') || get('DISCORD_GUILD_ID') || '',
  DISCORD_GM_COMMAND_CHANNEL_ID: get('DISCORD_GM_COMMAND_CHANNEL_ID', false, '1519357383946535183'),

  // Game details
  WORLD_ID: getNumber('WORLD_ID', 1),
}
