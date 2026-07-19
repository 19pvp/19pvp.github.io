import worldserverConfig from './config/worldserver.json' with { type: 'json' }
import aleConfig from './config/ale.json' with { type: 'json' }
import playerbotsConfig from './config/playerbots.json' with { type: 'json' }
import cfbgConfig from './config/cfbg.json' with { type: 'json' }

export const projectName = import.meta.dirname!.split('/').at(-1)

const distDir = 'core/env/dist'
const dist = (path: string) => `${import.meta.dirname}/${distDir}/${path}`
export const bin = (path: string) => dist(`bin/${path}`)
export const etc = (path: string) => dist(`etc/${path}`)

export const targets = {
  ale: {
    label: 'ALE Config',
    reload: 'reload ale',
    subdir: 'modules/',
    config: aleConfig,
    url: 'https://raw.githubusercontent.com/azerothcore/mod-ale/refs/heads/master/conf/mod_ale.conf.dist',
  },
  playerbots: {
    label: 'Playerbots Config',
    reload: 'reload config',
    subdir: 'modules/',
    config: playerbotsConfig,
    url: 'https://raw.githubusercontent.com/mod-playerbots/mod-playerbots/refs/heads/master/conf/playerbots.conf.dist',
  },
  worldserver: {
    label: 'WorldServer Config',
    reload: 'reload config',
    subdir: '',
    config: worldserverConfig,
    url:
      'https://raw.githubusercontent.com/mod-playerbots/azerothcore-wotlk/refs/heads/Playerbot/src/server/apps/worldserver/worldserver.conf.dist',
  },
  cfbg: {
    label: 'Cross-Faction Battleground Config',
    reload: 'reload config',
    subdir: 'modules/',
    config: cfbgConfig,
    url: 'https://raw.githubusercontent.com/azerothcore/mod-cfbg/refs/heads/master/conf/CFBG.conf.dist',
  },
} as const

export type TargetName = keyof typeof targets
