// Stats blacklist per class
const magical = ['Intellect', 'Spirit']
const physical = ['Agility', 'Strength']
const none: string[] = []

export const wowClasses = {
  DRUID: {
    excludeStats: none,
    color: '#ff7c0a', // Orange
  },
  HUNTER: {
    excludeStats: magical,
    color: '#aad372', // Pistachio
  },
  MAGE: {
    excludeStats: physical,
    color: '#3fc7eb', // Light Blue
  },
  PALADIN: {
    excludeStats: none,
    color: '#f48cba', // Pink
  },
  PRIEST: {
    excludeStats: physical,
    color: '#ffffff', // White*
  },
  ROGUE: {
    excludeStats: magical,
    color: '#fff468', // Yellow*
  },
  SHAMAN: {
    excludeStats: none,
    color: '#0070dd', // Blue
  },
  WARLOCK: {
    excludeStats: physical,
    color: '#8788ee', // Purple
  },
  WARRIOR: {
    excludeStats: magical,
    color: '#c69b6d', // Tan
  },
    /*
  DEATHKNIGHT: {
    excludeStats: magical,
    color: '#c41e3a', // Red
  },
  DEMONHUNTER: {
    excludeStats: magical,
    color: '#a330c9', // Dark Magenta
  },
  MONK: {
    excludeStats: none,
    color: '#00ff98', // Spring Green
  },
  */
} as const
