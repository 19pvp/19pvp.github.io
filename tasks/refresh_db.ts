import config from '../config.json' with { type: 'json' }
import { openDBC } from '../dbc.ts'
import { charactersDbName, playerbotsDbName, worldDbName, worldserver } from '../service/db.ts'

const _config = config
const worldDb = worldDbName
const playerbotsDb = playerbotsDbName
const charactersDb = charactersDbName
const sheetId = Deno.env.get('SHEET_ID') || '1F1Re3VLtPuF5fXZ1wV79CpogaSgP-fS9r9dm3_aRoP0'

type GSheetData = {
  ITEM: ItemSheetRow[]
  NPC?: NpcSheetRow[]
  QUEST?: QuestSheetRow[]
}

type ItemSheetRow = {
  CLASSES?: string
  ID?: string
  LINK?: string
  NAME?: string
  PROPS?: string
  SOURCE?: string
  TYPE?: string
  VALUE?: string
}

type NpcSheetRow = {
  GUID?: string
  ID?: string
  GUILD?: string
  NAME?: string
}

type QuestSheetRow = {
  ID?: string
  GIVER?: string
  TAKER?: string
  TITLE?: string
  PROPS?: string
  START?: string
  PROGRESSION?: string
  END?: string
  OBJECTIVE?: string
}

type WsgBotItemSheetRow = {
  AMOUNT?: string
  CLASSES?: string
  ID?: string
  NAME?: string
  SLOT?: string
  TEAM?: string
}

type CountedItem = {
  count: number
  id: number
}

type ItemProps = {
  cd?: number
  name?: string
  quality?: number
  stats: { type: number; value: number }[]
  use?: number
}

type StarterItem = {
  classId: number
  className: string
  itemId: number
  name: string
}

type WsgBotRosterEntry = {
  account: string
  behaviorProfile: string
  classId: number
  className: string
  enabled: boolean
  guid?: number
  name: string
  raceId: number
  raceName: string
  replacementPriority: number
  role: string
  slot: number
  spec: string
  team: number
}

type WsgBotItem = {
  amount: number
  itemId: number
  name: string
  note: string
  account: string
}

type QuestProps = {
  ChooseItem?: CountedItem[]
  LearnSpell?: number
  NextQuestID?: number
  Repeat?: 'Daily' | 'Weekly'
  RequireQuestID?: number
  RewardArena?: number
  RewardGold?: number
  RewardHonor?: number
  RewardItem?: CountedItem[]
  TakeItem?: CountedItem[]
}

type Quest = {
  id: number
  giver: number
  taker: number
  title: string
  start: string
  progression: string
  end: string
  objective: string
  props: QuestProps
}

type CreaturePositionRow = {
  npc: number
  map: number
  position_x: number
  position_y: number
}

type NpcSpawnSwap = {
  guid: number
  id: number
}

type VendorCurrency = 'arena' | 'gold' | 'honor' | 'heroism' | 'justice'
type VendorTier = '★☆☆☆☆' | '★★☆☆☆' | '★★★☆☆' | '★★★★☆' | '★★★★★'
type VendorCategory = 'accessory' | 'armor' | 'enchant' | 'gem' | 'weapon'

type VendorItemInfo = {
  classId: number
  inventoryType: number
  itemId: number
  name: string
  subclassId: number
}

type VendorItem = {
  currency: VendorCurrency
  inventoryType: number
  itemId: number
  name: string
  npc: number
  special: boolean
  value?: VendorTier
}

type SatchelItem = {
  classId: number
  inventoryType: number
  itemId: number
  name: string
  subclassId: number
}

type SatchelDropItem = {
  itemId: number
  name: string
}

const autoReturnQuestFlags = 589824
const dailyQuestFlags = 4096
const weeklyQuestFlags = 32768
const invisibleNpcEntry = 12999
const learnSpellRewardDummy = 36937
const soulboundBonding = 1
const bonusArmorStatType = 50
const vendorNpcFlag = 128
const vendorTrainerNpcFlags = 16 | 32 | 64
const vendorNpcFlagsWithoutTrainer = 4294967295 - vendorTrainerNpcFlags
const vendorNpcFlagsWithoutVendorOrTrainer = 4294967295 - (vendorNpcFlag | vendorTrainerNpcFlags)
const consortiumFaction = 1731
const satchelAlwaysDropItemIds = [5740, 6657]
const appliedItemSpells = [{ itemId: 19969, spellId: 23990 }] as const

const itemQualityByName = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
} as const

const itemStatTypeByKey = {
  agi: 3,
  str: 4,
  int: 5,
  spirit: 6,
  stam: 7,
  hit: 31,
  crit: 32,
  ap: 38,
  hast: 36,
  mp5: 43,
  spell: 45,
} as const

const playerClassIdByName = {
  deathknight: 6,
  deathKnight: 6,
  druid: 11,
  hunter: 3,
  mage: 8,
  paladin: 2,
  priest: 5,
  rogue: 4,
  shaman: 7,
  warlock: 9,
  warrior: 1,
} as const

const playerRaceIdByName = {
  bloodelf: 10,
  draenei: 11,
  dwarf: 3,
  gnome: 7,
  human: 1,
  nightelf: 4,
  orc: 2,
  tauren: 6,
  troll: 8,
  undead: 5,
} as const

const teamIdByName = {
  alliance: 1,
  horde: 2,
} as const

const teamNameById = {
  1: 'alliance',
  2: 'horde',
} as const

const wsgClassSlotOrder = {
  priest: 1,
  mage: 2,
  warrior: 3,
  hunter: 4,
  druid: 5,
} as const

const wsgSlotKey = (team: number, className: string) =>
  `${teamNameById[team as keyof typeof teamNameById] ?? `team${team}`}-${normalizeClassName(className)}`

await Promise.all([
  fetch(`https://gsheet.devazuka.com/refresh/${sheetId}/QUEST`),
  fetch(`https://gsheet.devazuka.com/refresh/${sheetId}/ITEM`),
  fetch(`https://gsheet.devazuka.com/refresh/${sheetId}/NPC`),
])
const gsheetResponse = await fetch(`https://gsheet.devazuka.com/${sheetId}`)
if (!gsheetResponse.ok || !gsheetResponse.headers.get('content-type')?.includes('application/json')) {
  const body = await gsheetResponse.text()
  throw Error(`invalid gsheet response ${gsheetResponse.status}: ${body.slice(0, 120)}`)
}
const gsheetData = await gsheetResponse.json() as GSheetData
const questWarnings: string[] = []

const toPositiveInt = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

const parseRequiredInt = (value: string | undefined, label: string, rowLabel: string): number | undefined => {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    questWarnings.push(`${rowLabel}: invalid ${label} ${JSON.stringify(value)}`)
    return undefined
  }
  return number
}

const normalizeCountedItem = (value: unknown): CountedItem | undefined => {
  const id = toPositiveInt(value)
  if (id) return { count: 1, id }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const objectId = toPositiveInt(record.id)
  if (!objectId) return undefined

  const count = record.count === undefined ? 1 : toPositiveInt(record.count)
  if (!count) return undefined
  return { count, id: objectId }
}

const parseNumberProp = (key: keyof QuestProps, value: unknown, rowLabel: string): number | undefined => {
  const number = toPositiveInt(value)
  if (!number) questWarnings.push(`${rowLabel}: ignored ${key}, expected a positive integer`)
  return number
}

const parseCountedItemArrayProp = (
  key: keyof QuestProps,
  value: unknown,
  rowLabel: string,
): CountedItem[] | undefined => {
  const values = (Array.isArray(value) ? value : [value]).filter((item) => item !== null && item !== '')
  if (!values.length) {
    questWarnings.push(`${rowLabel}: ignored ${key}, expected at least one item`)
    return undefined
  }
  const items = values.map(normalizeCountedItem)
  if (items.some((item) => !item)) {
    questWarnings.push(`${rowLabel}: ignored ${key}, expected item id(s) or { count, id } objects`)
    return undefined
  }
  return items as CountedItem[]
}

const parseQuestProps = (props: string | undefined, rowLabel: string): QuestProps => {
  const result: QuestProps = {}
  for (const [index, line] of (props ?? '').split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const separator = trimmed.indexOf(':')
    if (separator === -1) {
      questWarnings.push(`${rowLabel}: ignored PROPS line ${index + 1}, missing ":"`)
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    let value: unknown
    try {
      const repairedRawValue = key === 'ChooseItem' || key === 'RewardItem' || key === 'TakeItem'
        ? rawValue
          .replace(/^\[\s*,/, '[null,')
          .replace(/,\s*(?=,|\])/g, ', null')
          .replace(/^(\s*\[[\s\S]*\}\s*)$/, '$1]')
        : rawValue
      value = JSON.parse(repairedRawValue)
    } catch (err) {
      if (key === 'Repeat' && (rawValue === 'Daily' || rawValue === 'Weekly')) {
        value = rawValue
      } else {
        questWarnings.push(`${rowLabel}: ignored ${key}, invalid JSON value (${(err as Error).message})`)
        continue
      }
    }

    switch (key) {
      case 'ChooseItem': {
        const parsed = parseCountedItemArrayProp(key, value, rowLabel)
        if (parsed) result.ChooseItem = parsed
        break
      }
      case 'LearnSpell': {
        const parsed = parseNumberProp(key, value, rowLabel)
        if (parsed) result.LearnSpell = parsed
        break
      }
      case 'NextQuestID': {
        const parsed = parseNumberProp(key, value, rowLabel)
        if (parsed) result.NextQuestID = parsed
        break
      }
      case 'Repeat': {
        if (value === 'Daily' || value === 'Weekly') {
          result.Repeat = value
        } else {
          questWarnings.push(`${rowLabel}: ignored Repeat, expected Daily or Weekly`)
        }
        break
      }
      case 'RequireQuestID': {
        const parsed = parseNumberProp(key, value, rowLabel)
        if (parsed) result.RequireQuestID = parsed
        break
      }
      case 'RewardArena': {
        const parsed = parseNumberProp(key, value, rowLabel)
        if (parsed) result.RewardArena = parsed
        break
      }
      case 'RewardGold': {
        const parsed = parseNumberProp(key, value, rowLabel)
        if (parsed) result.RewardGold = parsed
        break
      }
      case 'RewardHonor': {
        const parsed = parseNumberProp(key, value, rowLabel)
        if (parsed) result.RewardHonor = parsed
        break
      }
      case 'RewardItem': {
        const parsed = parseCountedItemArrayProp(key, value, rowLabel)
        if (parsed) result.RewardItem = parsed
        break
      }
      case 'TakeItem': {
        const parsed = parseCountedItemArrayProp(key, value, rowLabel)
        if (parsed) result.TakeItem = parsed
        break
      }
      default:
        questWarnings.push(`${rowLabel}: ignored unknown PROPS key ${JSON.stringify(key)}`)
    }
  }
  return result
}

const parseItemDurationMs = (value: string): number | undefined => {
  const match = value.trim().match(
    /^(\d+)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/,
  )
  if (!match) return undefined

  const amount = Number(match[1])
  const unit = match[2]
  if (!Number.isInteger(amount) || amount < 0) return undefined
  if (unit === 'ms') return amount
  if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') {
    return amount * 1000
  }
  if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') {
    return amount * 60 * 1000
  }
  return amount * 60 * 60 * 1000
}

const parseItemProps = (props: string | undefined, rowLabel: string): ItemProps | undefined => {
  const result: ItemProps = { stats: [] }
  let hasProps = false

  for (const [index, line] of (props ?? '').split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const separator = trimmed.indexOf(':')
    if (separator === -1) {
      questWarnings.push(`${rowLabel}: ignored PROPS line ${index + 1}, missing ":"`)
      continue
    }

    const key = trimmed.slice(0, separator).trim().toLowerCase()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!rawValue) {
      questWarnings.push(`${rowLabel}: ignored ${key}, missing value`)
      continue
    }

    if (key === 'quality') {
      const quality = itemQualityByName[rawValue.toLowerCase() as keyof typeof itemQualityByName]
      if (!quality) {
        questWarnings.push(`${rowLabel}: ignored quality, expected common, uncommon, rare, or epic`)
        continue
      }
      result.quality = quality
      hasProps = true
      continue
    }

    if (key === 'use') {
      const spellId = Number(rawValue)
      if (!Number.isInteger(spellId) || spellId <= 0) {
        questWarnings.push(`${rowLabel}: ignored use, expected a positive spell id`)
        continue
      }
      result.use = spellId
      hasProps = true
      continue
    }

    if (key === 'cd') {
      const cooldown = parseItemDurationMs(rawValue)
      if (cooldown === undefined) {
        questWarnings.push(`${rowLabel}: ignored cd, expected values like 50s, 3m, or 1h`)
        continue
      }
      result.cd = cooldown
      hasProps = true
      continue
    }

    const statType = itemStatTypeByKey[key as keyof typeof itemStatTypeByKey]
    if (statType) {
      const value = Number(rawValue)
      if (!Number.isInteger(value) || value <= 0) {
        questWarnings.push(`${rowLabel}: ignored ${key}, expected a positive integer`)
        continue
      }
      result.stats.push({ type: statType, value })
      hasProps = true
      continue
    }

    questWarnings.push(`${rowLabel}: ignored unknown PROPS key ${JSON.stringify(key)}`)
  }

  if (result.stats.length > 10) {
    questWarnings.push(`${rowLabel}: ignored item stats, expected at most 10 stat props`)
    result.stats = []
  }

  return hasProps ? result : undefined
}

const parseItemUpdates = (rows: ItemSheetRow[] | undefined) => {
  const updates = new Map<number, ItemProps>()
  for (const [index, row] of (rows ?? []).entries()) {
    if (!row.PROPS?.trim()) continue

    const rowLabel = `ITEM row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    const id = parseRequiredInt(row.ID, 'ID', rowLabel)
    if (!id) continue

    const props = parseItemProps(row.PROPS, rowLabel)
    if (props && row.NAME?.trim()) props.name = row.NAME.trim()
    if (props) updates.set(id, props)
  }
  return updates
}

const normalizeClassName = (value: string) => value.trim().toLowerCase().replaceAll(/\s+/g, '')
const normalizeRosterKey = (value: string) => value.trim().toLowerCase().replaceAll(/[\s_-]+/g, '')

const wsgBot = (
  team: 1 | 2,
  name: string,
  raceName: keyof typeof playerRaceIdByName,
  className: keyof typeof wsgClassSlotOrder,
  role: string,
  spec: string,
  replacementPriority: number,
  behaviorProfile: string,
): WsgBotRosterEntry => ({
  team,
  slot: wsgClassSlotOrder[className],
  name,
  account: wsgSlotKey(team, className),
  raceName,
  raceId: playerRaceIdByName[raceName],
  className,
  classId: playerClassIdByName[className],
  role,
  spec,
  replacementPriority,
  behaviorProfile,
  enabled: true,
})

const defaultWsgBotRoster: WsgBotRosterEntry[] = [
  wsgBot(1, 'Lofi', 'human', 'priest', 'healer', 'discipline', 5, 'wsg-healer'),
  wsgBot(1, 'Filo', 'human', 'mage', 'dps', 'frost', 1, 'wsg-ranged-dps'),
  wsgBot(1, 'Trarife', 'human', 'warrior', 'dps', 'arms', 2, 'wsg-melee-dps'),
  wsgBot(1, 'Ilfo', 'nightelf', 'hunter', 'dps', 'marksman', 3, 'wsg-ranged-dps'),
  wsgBot(1, 'Lifo', 'nightelf', 'druid', 'flag-carrier', 'feral', 4, 'wsg-flag-carrier'),
  wsgBot(2, 'Foli', 'undead', 'priest', 'healer', 'discipline', 5, 'wsg-healer'),
  wsgBot(2, 'Foil', 'undead', 'mage', 'dps', 'frost', 1, 'wsg-ranged-dps'),
  wsgBot(2, 'Iolf', 'orc', 'warrior', 'dps', 'arms', 2, 'wsg-melee-dps'),
  wsgBot(2, 'Iflo', 'troll', 'hunter', 'dps', 'marksman', 3, 'wsg-ranged-dps'),
  wsgBot(2, 'Olfi', 'tauren', 'druid', 'flag-carrier', 'feral', 4, 'wsg-flag-carrier'),
]

const parseOptionalPositiveInt = (value: string | undefined, label: string, rowLabel: string): number | undefined => {
  if (!value?.trim()) return undefined
  return parseRequiredInt(value, label, rowLabel)
}

const parseWsgBotRoster = (): WsgBotRosterEntry[] => {
  const roster = defaultWsgBotRoster.map((bot) => ({
    ...bot,
    account: wsgSlotKey(bot.team, bot.className),
  }))
  const accounts = new Set<string>()
  const names = new Set<string>()
  for (const bot of roster) {
    if (accounts.has(bot.account)) questWarnings.push(`WSG_BOT: duplicate account ${bot.account}`)
    accounts.add(bot.account)

    const nameKey = bot.name.toLowerCase()
    if (names.has(nameKey)) questWarnings.push(`WSG_BOT: duplicate bot name ${bot.name}`)
    names.add(nameKey)
  }

  if (roster.length !== 10) questWarnings.push(`WSG_BOT: expected 10 fixed bots, found ${roster.length}`)
  for (const team of [1, 2]) {
    const teamBots = roster.filter((bot) => bot.team === team)
    const classes = teamBots.map((bot) => bot.className).sort().join(',')
    if (classes !== 'druid,hunter,mage,priest,warrior') {
      questWarnings.push(`WSG_BOT: team ${team} should contain priest, mage, warrior, hunter, and druid`)
    }
  }

  return roster.sort((a, b) => a.team - b.team || a.slot - b.slot)
}

const parseStarterItems = (rows: ItemSheetRow[] | undefined) => {
  const items: StarterItem[] = []
  const seen = new Set<string>()

  for (const [index, row] of (rows ?? []).entries()) {
    if (row.SOURCE?.trim().toLowerCase() !== 'starter') continue

    const rowLabel = `ITEM row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    const itemId = parseRequiredInt(row.ID, 'ID', rowLabel)
    if (!itemId) continue

    const classNames = row.CLASSES?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
    if (classNames.length === 0) {
      questWarnings.push(`${rowLabel}: ignored starter item, missing CLASSES`)
      continue
    }

    for (const className of classNames) {
      const normalized = normalizeClassName(className)
      const classId = playerClassIdByName[normalized as keyof typeof playerClassIdByName]
      if (!classId) {
        questWarnings.push(`${rowLabel}: ignored starter class ${JSON.stringify(className)}`)
        continue
      }

      const key = `${classId}:${itemId}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ classId, className, itemId, name: row.NAME?.trim() || String(itemId) })
    }
  }

  return items.sort((a, b) => a.classId - b.classId || a.itemId - b.itemId)
}

const parseBotStarterItems = (rows: ItemSheetRow[] | undefined) => {
  const items: StarterItem[] = []
  const seen = new Set<string>()

  for (const [index, row] of (rows ?? []).entries()) {
    const source = row.SOURCE?.trim().toLowerCase()
    if (source !== 'botstarter' && source !== 'wsgbotstarter') continue

    const rowLabel = `ITEM row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    const itemId = parseRequiredInt(row.ID, 'ID', rowLabel)
    if (!itemId) continue

    const classNames = row.CLASSES?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
    if (classNames.length === 0) {
      questWarnings.push(`${rowLabel}: ignored bot starter item, missing CLASSES`)
      continue
    }

    for (const className of classNames) {
      const normalized = normalizeClassName(className)
      const classId = playerClassIdByName[normalized as keyof typeof playerClassIdByName]
      if (!classId) {
        questWarnings.push(`${rowLabel}: ignored bot starter class ${JSON.stringify(className)}`)
        continue
      }

      const key = `${classId}:${itemId}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ classId, className, itemId, name: row.NAME?.trim() || String(itemId) })
    }
  }

  return items.sort((a, b) => a.classId - b.classId || a.itemId - b.itemId)
}

const vendorCurrencyFromSource = (source: string | undefined): VendorCurrency | undefined => {
  const normalized = source?.trim().toLowerCase()
  switch (normalized) {
    case 'gold':
    case 'honor':
    case 'arena':
    case 'justice':
    case 'heroism':
      return normalized
  }
}

const vendorTierFromValue = (value: string | undefined): VendorTier | undefined => {
  const normalized = value?.trim()
  if (!normalized || !Object.hasOwn(costs.gold, normalized)) return undefined
  return normalized as VendorTier
}

const vendorCategoryFromItemInfo = (item: VendorItemInfo): VendorCategory | undefined => {
  if (item.classId === 3) return 'gem'
  if (item.classId === 16) return 'glyph'
  if (item.inventoryType === 0) return 'enchant'
  if ([2, 11, 12, 16].includes(item.inventoryType)) return 'accessory'
  if (
    item.classId === 2 ||
    (item.classId === 4 && (item.subclassId === 6 || [14, 23].includes(item.inventoryType)))
  ) {
    return 'weapon'
  }
  if (item.classId === 4) return 'armor'
  return undefined
}

const vendorNpcSubname = (currency: VendorCurrency, category: VendorCategory) => {
  if (currency === 'arena') return 'former gladiator'
  if (category === 'enchant') return `enchant ${currency === 'gold' ? 'merchant' : 'quartermaster'}`
  const prefix = category === 'weapon' ? 'weapons' : category
  const suffix = currency === 'gold' ? 'merchant' : 'quartermaster'
  return `${prefix} ${suffix}`
}

const parseVendorItems = (
  rows: ItemSheetRow[] | undefined,
  itemInfoById: Map<number, VendorItemInfo>,
) => {
  const items: VendorItem[] = []
  const seen = new Set<string>()

  for (const [index, row] of (rows ?? []).entries()) {
    const currency = vendorCurrencyFromSource(row.SOURCE)
    if (!currency) continue

    const rowLabel = `ITEM row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    const itemId = parseRequiredInt(row.ID, 'ID', rowLabel)
    if (!itemId) continue

    const rawValue = row.VALUE?.trim()
    const value = vendorTierFromValue(rawValue)
    if (!value && rawValue && rawValue.toLowerCase() !== 'special') {
      questWarnings.push(`${rowLabel}: ignored vendor item, invalid VALUE ${JSON.stringify(row.VALUE)}`)
      continue
    }

    const itemInfo = itemInfoById.get(itemId)
    if (!itemInfo) {
      questWarnings.push(`${rowLabel}: ignored vendor item, item_template row not found`)
      continue
    }

    const category = vendorCategoryFromItemInfo(itemInfo)
    if (!category) {
      questWarnings.push(
        `${rowLabel}: ignored vendor item, unsupported class ${itemInfo.classId} subclass ${itemInfo.subclassId} inventory type ${itemInfo.inventoryType}`,
      )
      continue
    }

    const npcSubname = vendorNpcSubname(currency, category)
    const npc = npcEntriesBySubname.get(npcSubname.toLowerCase())
    if (!npc) {
      questWarnings.push(`${rowLabel}: ignored vendor item, NPC subname ${JSON.stringify(npcSubname)} not found`)
      continue
    }

    const key = `${npc}:${itemId}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      currency,
      inventoryType: itemInfo.inventoryType,
      itemId,
      name: row.NAME?.trim() || itemInfo.name || String(itemId),
      npc,
      special: rawValue?.toLowerCase() === 'special',
      value,
    })
  }

  return items.sort((a, b) => a.npc - b.npc || a.itemId - b.itemId)
}

const parseSatchelItems = (
  rows: ItemSheetRow[] | undefined,
  itemInfoById: Map<number, VendorItemInfo>,
): SatchelItem[] => {
  const itemsById = new Map<number, SatchelItem>()

  for (const [index, row] of (rows ?? []).entries()) {
    if (row.SOURCE?.trim().toLowerCase() !== 'satchel') continue

    const rowLabel = `ITEM row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    const itemId = parseRequiredInt(row.ID, 'ID', rowLabel)
    if (!itemId) continue

    const itemInfo = itemInfoById.get(itemId)
    if (!itemInfo) {
      questWarnings.push(`${rowLabel}: ignored satchel item, item_template row not found`)
      continue
    }

    itemsById.set(itemId, {
      classId: itemInfo.classId,
      inventoryType: itemInfo.inventoryType,
      itemId,
      name: row.NAME?.trim() || itemInfo.name || String(itemId),
      subclassId: itemInfo.subclassId,
    })
  }

  return [...itemsById.values()].sort((a, b) => a.itemId - b.itemId)
}

const parseWsgBotItems = (
  rows: WsgBotItemSheetRow[] | undefined,
  roster: WsgBotRosterEntry[],
  starterItems: StarterItem[],
  botStarterItems: StarterItem[],
): WsgBotItem[] => {
  const itemsByBot = new Map<string, WsgBotItem>()

  const addBotItem = (bot: WsgBotRosterEntry, itemId: number, amount: number, name: string, note: string) => {
    const key = `${bot.account}:${itemId}`
    const existing = itemsByBot.get(key)
    itemsByBot.set(key, {
      account: bot.account,
      itemId,
      amount: (existing?.amount ?? 0) + amount,
      name,
      note,
    })
  }

  for (const bot of roster) {
    for (const item of starterItems) {
      if (item.classId === bot.classId) {
        addBotItem(bot, item.itemId, 1, item.name, 'player starter gear')
      }
    }

    for (const item of botStarterItems) {
      if (item.classId === bot.classId) {
        addBotItem(bot, item.itemId, 1, item.name, 'bot-only starter gear')
      }
    }
  }

  for (const [index, row] of (rows ?? []).entries()) {
    if (!Object.values(row).some((value) => value?.trim())) continue

    const rowLabel = `WSG_BOT_ITEM row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    const itemId = parseRequiredInt(row.ID, 'ID', rowLabel)
    if (!itemId) continue

    const amount = row.AMOUNT?.trim() ? parseRequiredInt(row.AMOUNT, 'AMOUNT', rowLabel) : 1
    if (!amount) continue

    const teamRaw = row.TEAM?.trim()
    const team = teamRaw
      ? teamIdByName[normalizeRosterKey(teamRaw) as keyof typeof teamIdByName] ?? Number(teamRaw)
      : undefined
    const slot = row.SLOT?.trim() && /^\d+$/.test(row.SLOT.trim())
      ? parseOptionalPositiveInt(row.SLOT, 'SLOT', rowLabel)
      : undefined
    const classIds: number[] = row.CLASSES?.split(',').map((value) => {
      const classId = playerClassIdByName[normalizeClassName(value) as keyof typeof playerClassIdByName]
      if (!classId) questWarnings.push(`${rowLabel}: ignored unknown class ${JSON.stringify(value)}`)
      return classId
    }).filter((classId): classId is NonNullable<typeof classId> => Boolean(classId)) ?? []
    const account = row.SLOT?.trim() && !/^\d+$/.test(row.SLOT.trim()) ? normalizeRosterKey(row.SLOT) : undefined

    const matchingBots = roster.filter((bot) => {
      if (team !== undefined && bot.team !== team) return false
      if (slot !== undefined && bot.slot !== slot) return false
      if (classIds.length > 0 && !classIds.includes(bot.classId)) return false
      if (account && bot.account !== account) return false
      return true
    })

    if (matchingBots.length === 0) {
      questWarnings.push(`${rowLabel}: item matched no WSG bots`)
      continue
    }

    for (const bot of matchingBots) {
      addBotItem(bot, itemId, amount, row.NAME?.trim() || String(itemId), 'WSG_BOT_ITEM sheet')
    }
  }

  return [...itemsByBot.values()].sort((a, b) => a.account.localeCompare(b.account) || a.itemId - b.itemId)
}

const dbc = {
  charStartOutfit: openDBC('CharStartOutfit'),
  item: openDBC('Item'),
  itemDisplay: openDBC('ItemDisplayInfo'),
  properties: openDBC('ItemRandomProperties'),
  suffix: openDBC('ItemRandomSuffix'),
  enchant: openDBC('SpellItemEnchantment'),
}

const itemIds = gsheetData.ITEM.map((i) => Number(i.ID)).filter((i) => i > 1)
const itemTemplateLookupIds = [...new Set([...itemIds, ...satchelAlwaysDropItemIds])]
const itemUpdates = parseItemUpdates(gsheetData.ITEM)
const starterItems = parseStarterItems(gsheetData.ITEM)
const botStarterItems = parseBotStarterItems(gsheetData.ITEM)

console.log(itemIds)

type ItemEnchantRow = {
  item: number
  randomSuffix: number
  randomProperty: number
  suffixId: number | null
  propertyId: number | null
}

type ItemTemplateInfoRow = {
  item: number
  name: string
  classId: number
  subclassId: number
  inventoryType: number
}

const itemEnchantRows = await worldserver.raw.sql`
SELECT
  item.entry item,
  item.RandomSuffix randomSuffix,
  item.RandomProperty randomProperty,
  suffix.ench suffixId,
  property.ench propertyId
FROM item_template item
LEFT JOIN item_enchantment_template suffix
  ON suffix.entry = item.RandomSuffix
LEFT JOIN item_enchantment_template property
  ON property.entry = item.RandomProperty
WHERE item.entry IN (${itemIds.join(', ')})
ORDER BY item.entry, suffix.chance DESC, suffix.ench, property.chance DESC, property.ench
  ` as ItemEnchantRow[]

const itemTemplateInfoRows = await worldserver.raw.sql`
SELECT
  entry item,
  name,
  class classId,
  subclass subclassId,
  InventoryType inventoryType
FROM item_template
WHERE entry IN (${itemTemplateLookupIds.join(', ')})
ORDER BY entry
  ` as ItemTemplateInfoRow[]
const itemInfoById = new Map(
  itemTemplateInfoRows.map((row) => [
    Number(row.item),
    {
      classId: Number(row.classId),
      inventoryType: Number(row.inventoryType),
      itemId: Number(row.item),
      name: row.name,
      subclassId: Number(row.subclassId),
    },
  ]),
)

type RandomEnchantOption = {
  id: number
  name: string
  enchants: number[]
  stats: { id: number; value: number }[]
  score: number
}

const luaString = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const luaArray = <T>(values: T[], formatter: (value: T) => string) => `{ ${values.map(formatter).join(', ')} }`
const sqlString = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

const startingInfoSpellSection = async () => {
  const existing = await Deno.readTextFile('sql/starting-info.sql').catch(() => '')
  const marker = 'DROP TEMPORARY TABLE IF EXISTS `starting_info_spell`;'
  const index = existing.indexOf(marker)
  if (index === -1) throw Error(`sql/starting-info.sql is missing ${marker}`)
  return existing.slice(index).trimEnd()
}

const generateStartingInfoSql = async (starterItems: StarterItem[]) => {
  const starterClassItems = new Set(starterItems.map((item) => `${item.classId}:${item.itemId}`))
  const starterItemIds = [...new Set(starterItems.map((item) => item.itemId))].sort((a, b) => a - b)
  const removalRows: string[] = []
  const removedOutfitItems = new Set<string>()

  for (const outfit of dbc.charStartOutfit.values()) {
    for (let index = 1; index <= 24; index++) {
      const itemId = outfit[`ItemID_${index}` as keyof typeof outfit]
      if (typeof itemId !== 'number' || itemId <= 0) continue

      const classItemKey = `${outfit.ClassID}:${itemId}`
      if (starterClassItems.has(classItemKey)) {
        questWarnings.push(`starter item ${itemId} also exists in CharStartOutfit.dbc for class ${outfit.ClassID}`)
        continue
      }

      const key = `${outfit.RaceID}:${outfit.ClassID}:${itemId}`
      if (removedOutfitItems.has(key)) continue
      removedOutfitItems.add(key)
      removalRows.push(
        `  (${outfit.RaceID}, ${outfit.ClassID}, ${itemId}, -1, ${sqlString(`remove DBC outfit item ${itemId}`)})`,
      )
    }
  }

  const starterRows = starterItems.map((item) =>
    `  (0, ${item.classId}, ${item.itemId}, 1, ${sqlString(`${item.className}: ${item.name}`)})`
  )
  const itemRows = [...removalRows, ...starterRows]
  const starterSellPriceUpdate = starterItemIds.length
    ? `UPDATE \`item_template\` SET \`SellPrice\` = 1 WHERE \`entry\` IN (${starterItemIds.join(', ')});`
    : '-- No starter item sell-price updates.'
  const itemInsert = itemRows.length
    ? `INSERT INTO \`starting_info_item\` (\`race\`, \`class\`, \`itemid\`, \`amount\`, \`note\`) VALUES
${itemRows.join(',\n')};

DELETE FROM \`playercreateinfo_item\`;
INSERT INTO \`playercreateinfo_item\` (\`race\`, \`class\`, \`itemid\`, \`amount\`, \`Note\`)
SELECT pci.\`race\`, pci.\`class\`, item.\`itemid\`, item.\`amount\`, CONCAT('19pvp starter sheet: ', item.\`note\`)
FROM \`playercreateinfo\` pci
JOIN \`starting_info_item\` item
  ON (item.\`race\` = 0 OR item.\`race\` = pci.\`race\`)
  AND (item.\`class\` = 0 OR item.\`class\` = pci.\`class\`);`
    : `DELETE FROM \`playercreateinfo_item\`;
-- No starter item rows found in the ITEM sheet.`

  return `-- Applied by tasks/refresh_sql.ts.
-- Generated by tasks/refresh_db.ts.
-- Overrides DBC-backed player starting location, items, and custom spells.

UPDATE \`playercreateinfo\`
SET \`map\` = 530,
    \`zone\` = 3523,
    \`position_x\` = 4115.9697,
    \`position_y\` = 3058.874,
    \`position_z\` = 339.4637,
    \`orientation\` = 1.9342613;

${starterSellPriceUpdate}

DROP TEMPORARY TABLE IF EXISTS \`starting_info_item\`;
CREATE TEMPORARY TABLE \`starting_info_item\` (
  \`race\` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  \`class\` TINYINT UNSIGNED NOT NULL,
  \`itemid\` INT UNSIGNED NOT NULL,
  \`amount\` INT NOT NULL DEFAULT 1,
  \`note\` VARCHAR(255) NOT NULL
);

${itemInsert}

DROP TEMPORARY TABLE \`starting_info_item\`;

${await startingInfoSpellSection()}
`
}

const slotValue = <T>(values: T[] | undefined, index: number, getter: (value: T) => number) =>
  values?.[index] ? getter(values[index]) : 0

const parseQuests = (rows: QuestSheetRow[] | undefined): Quest[] => {
  const quests: Quest[] = []
  for (const [index, row] of (rows ?? []).entries()) {
    const rowLabel = `QUEST row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    const id = parseRequiredInt(row.ID, 'ID', rowLabel)
    const giver = parseRequiredInt(row.GIVER, 'GIVER', rowLabel)
    const taker = parseRequiredInt(row.TAKER, 'TAKER', rowLabel)
    const title = row.TITLE?.trim()
    if (!id || !giver || !taker || !title) {
      if (!title) questWarnings.push(`${rowLabel}: invalid TITLE ${JSON.stringify(row.TITLE)}`)
      continue
    }

    quests.push({
      id,
      giver,
      taker,
      title,
      start: row.START ?? '',
      progression: row.PROGRESSION ?? '',
      end: row.END ?? '',
      objective: row.OBJECTIVE ?? row.PROGRESSION ?? '',
      props: parseQuestProps(row.PROPS, rowLabel),
    })
  }
  return quests
}

const parseNpcSubnames = (rows: NpcSheetRow[] | undefined) => {
  const subnames = new Map<number, string>()
  for (const [index, row] of (rows ?? []).entries()) {
    const rowLabel = `NPC row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    if (!row.ID?.trim()) continue
    const id = parseRequiredInt(row.ID, 'ID', rowLabel)
    if (!id) continue

    const subname = row.GUILD?.trim()
    if (!subname) continue
    subnames.set(id, subname)
  }
  return subnames
}

const buildNpcEntryBySubname = (subnames: Map<number, string>) => {
  const entries = new Map<string, number>()
  for (const [entry, subname] of subnames) {
    const normalized = subname.trim().toLowerCase()
    if (!normalized) continue
    if (entries.has(normalized)) questWarnings.push(`NPC subname ${JSON.stringify(subname)} is duplicated`)
    else entries.set(normalized, entry)
  }
  return entries
}

const parseNpcNames = (rows: NpcSheetRow[] | undefined) => {
  const names = new Map<number, string>()
  for (const [index, row] of (rows ?? []).entries()) {
    const rowLabel = `NPC row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    if (!row.ID?.trim()) continue
    const id = parseRequiredInt(row.ID, 'ID', rowLabel)
    if (!id) continue

    const name = row.NAME?.trim()
    if (!name) continue
    names.set(id, name)
  }
  return names
}

const parseNpcSpawnSwaps = (rows: NpcSheetRow[] | undefined) => {
  const swaps: NpcSpawnSwap[] = []
  for (const [index, row] of (rows ?? []).entries()) {
    const rowLabel = `NPC row ${index + 2}${row.ID ? ` (${row.ID})` : ''}`
    if (!row.GUID?.trim()) continue

    const guid = Number(row.GUID)
    if (!Number.isInteger(guid) || guid <= 0) continue

    const id = row.ID?.trim() ? Number(row.ID) : invisibleNpcEntry
    if (!Number.isInteger(id) || id <= 0) {
      questWarnings.push(`${rowLabel}: ignored spawn swap, invalid ID ${JSON.stringify(row.ID)}`)
      continue
    }

    swaps.push({ guid, id })
  }
  return swaps.sort((a, b) => a.guid - b.guid)
}

const questTemplateColumns = [
  'ID',
  'QuestType',
  'QuestLevel',
  'MinLevel',
  'QuestSortID',
  'QuestInfoID',
  'SuggestedGroupNum',
  'RequiredFactionId1',
  'RequiredFactionId2',
  'RequiredFactionValue1',
  'RequiredFactionValue2',
  'RewardNextQuest',
  'RewardXPDifficulty',
  'RewardMoney',
  'RewardMoneyDifficulty',
  'RewardDisplaySpell',
  'RewardSpell',
  'RewardHonor',
  'RewardKillHonor',
  'StartItem',
  'Flags',
  'RequiredPlayerKills',
  'RewardItem1',
  'RewardAmount1',
  'RewardItem2',
  'RewardAmount2',
  'RewardItem3',
  'RewardAmount3',
  'RewardItem4',
  'RewardAmount4',
  'ItemDrop1',
  'ItemDropQuantity1',
  'ItemDrop2',
  'ItemDropQuantity2',
  'ItemDrop3',
  'ItemDropQuantity3',
  'ItemDrop4',
  'ItemDropQuantity4',
  'RewardChoiceItemID1',
  'RewardChoiceItemQuantity1',
  'RewardChoiceItemID2',
  'RewardChoiceItemQuantity2',
  'RewardChoiceItemID3',
  'RewardChoiceItemQuantity3',
  'RewardChoiceItemID4',
  'RewardChoiceItemQuantity4',
  'RewardChoiceItemID5',
  'RewardChoiceItemQuantity5',
  'RewardChoiceItemID6',
  'RewardChoiceItemQuantity6',
  'POIContinent',
  'POIx',
  'POIy',
  'POIPriority',
  'RewardTitle',
  'RewardTalents',
  'RewardArenaPoints',
  'RewardFactionID1',
  'RewardFactionValue1',
  'RewardFactionOverride1',
  'RewardFactionID2',
  'RewardFactionValue2',
  'RewardFactionOverride2',
  'RewardFactionID3',
  'RewardFactionValue3',
  'RewardFactionOverride3',
  'RewardFactionID4',
  'RewardFactionValue4',
  'RewardFactionOverride4',
  'RewardFactionID5',
  'RewardFactionValue5',
  'RewardFactionOverride5',
  'TimeAllowed',
  'AllowableRaces',
  'LogTitle',
  'LogDescription',
  'QuestDescription',
  'AreaDescription',
  'QuestCompletionLog',
  'RequiredNpcOrGo1',
  'RequiredNpcOrGo2',
  'RequiredNpcOrGo3',
  'RequiredNpcOrGo4',
  'RequiredNpcOrGoCount1',
  'RequiredNpcOrGoCount2',
  'RequiredNpcOrGoCount3',
  'RequiredNpcOrGoCount4',
  'RequiredItemId1',
  'RequiredItemId2',
  'RequiredItemId3',
  'RequiredItemId4',
  'RequiredItemId5',
  'RequiredItemId6',
  'RequiredItemCount1',
  'RequiredItemCount2',
  'RequiredItemCount3',
  'RequiredItemCount4',
  'RequiredItemCount5',
  'RequiredItemCount6',
  'Unknown0',
  'ObjectiveText1',
  'ObjectiveText2',
  'ObjectiveText3',
  'ObjectiveText4',
  'VerifiedBuild',
]

const questTemplateRow = (quest: Quest, poi: CreaturePositionRow | undefined) => {
  const rewardItems = quest.props.RewardItem ?? []
  const choiceItems = quest.props.ChooseItem ?? []
  const requiredItems = quest.props.TakeItem ?? []
  let flags = quest.start.trim() || quest.progression.trim() ? 0 : autoReturnQuestFlags
  if (quest.props.Repeat === 'Daily') flags |= dailyQuestFlags
  if (quest.props.Repeat === 'Weekly') flags |= weeklyQuestFlags
  const values = [
    quest.id,
    2,
    19,
    19,
    3738,
    0,
    0,
    0,
    0,
    0,
    0,
    quest.props.NextQuestID ?? 0,
    0,
    quest.props.RewardGold ?? 0,
    0,
    quest.props.LearnSpell ?? 0,
    quest.props.LearnSpell ? learnSpellRewardDummy : 0,
    quest.props.RewardHonor ?? 0,
    0,
    0,
    flags,
    0,
    slotValue(rewardItems, 0, (item) => item.id),
    slotValue(rewardItems, 0, (item) => item.count),
    slotValue(rewardItems, 1, (item) => item.id),
    slotValue(rewardItems, 1, (item) => item.count),
    slotValue(rewardItems, 2, (item) => item.id),
    slotValue(rewardItems, 2, (item) => item.count),
    slotValue(rewardItems, 3, (item) => item.id),
    slotValue(rewardItems, 3, (item) => item.count),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    slotValue(choiceItems, 0, (item) => item.id),
    slotValue(choiceItems, 0, (item) => item.count),
    slotValue(choiceItems, 1, (item) => item.id),
    slotValue(choiceItems, 1, (item) => item.count),
    slotValue(choiceItems, 2, (item) => item.id),
    slotValue(choiceItems, 2, (item) => item.count),
    slotValue(choiceItems, 3, (item) => item.id),
    slotValue(choiceItems, 3, (item) => item.count),
    slotValue(choiceItems, 4, (item) => item.id),
    slotValue(choiceItems, 4, (item) => item.count),
    slotValue(choiceItems, 5, (item) => item.id),
    slotValue(choiceItems, 5, (item) => item.count),
    poi?.map ?? 0,
    poi ? Math.round(poi.position_x) : 0,
    poi ? Math.round(poi.position_y) : 0,
    poi ? 1 : 0,
    0,
    0,
    quest.props.RewardArena ?? 0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    sqlString(quest.title),
    sqlString(quest.progression),
    sqlString(quest.start),
    sqlString(quest.objective),
    sqlString(quest.objective),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    slotValue(requiredItems, 0, (item) => item.id),
    slotValue(requiredItems, 1, (item) => item.id),
    slotValue(requiredItems, 2, (item) => item.id),
    slotValue(requiredItems, 3, (item) => item.id),
    slotValue(requiredItems, 4, (item) => item.id),
    slotValue(requiredItems, 5, (item) => item.id),
    slotValue(requiredItems, 0, (item) => item.count),
    slotValue(requiredItems, 1, (item) => item.count),
    slotValue(requiredItems, 2, (item) => item.count),
    slotValue(requiredItems, 3, (item) => item.count),
    slotValue(requiredItems, 4, (item) => item.count),
    slotValue(requiredItems, 5, (item) => item.count),
    0,
    sqlString(quest.objective),
    "''",
    "''",
    "''",
    0,
  ]
  if (values.length !== questTemplateColumns.length) {
    throw Error(`quest_template value mismatch: ${values.length} values for ${questTemplateColumns.length} columns`)
  }
  return `(${values.join(', ')})`
}

const questRequiredItemUpdateRows = (quests: Quest[]) =>
  quests
    .filter((quest) => quest.props.TakeItem?.length)
    .map((quest) => {
      const requiredItems = quest.props.TakeItem ?? []
      const assignments = Array.from({ length: 4 }, (_, index) => {
        const item = requiredItems[index]
        return [
          `\`RequiredItemId${index + 1}\` = ${item?.id ?? 0}`,
          `\`RequiredItemCount${index + 1}\` = ${item?.count ?? 0}`,
        ]
      }).flat()
      return `UPDATE \`quest_template\`
SET ${assignments.join(', ')}
WHERE \`ID\` = ${quest.id};`
    })
    .join('\n')

const costs = {
  gold: {
    '★☆☆☆☆': 55_00,
    '★★☆☆☆': 1_15_00,
    '★★★☆☆': 1_60_00,
    '★★★★☆': 3_35_00,
    '★★★★★': 5_00_00,
  },
  honor: {
    '★☆☆☆☆': 837, //  700
    '★★☆☆☆': 491, // 1600
    '★★★☆☆': 1062, // 3000
    '★★★★☆': 747, // 6000
    '★★★★★': 2261, // 9000
  },
  arena: {
    '★☆☆☆☆': 2596, //  100
    '★★☆☆☆': 2431, //  250
    '★★★☆☆': 2432, //  400
    '★★★★☆': 2380, //  800
    '★★★★★': 2342, // 1125
  },
  justice: { // bg token 29434
    '★☆☆☆☆': 1909, // 10
    '★★☆☆☆': 1452, // 20
    '★★★☆☆': 2347, // 40
    '★★★★☆': 2347, // 75
    '★★★★★': 2330, // 125
  },
  heroism: { // arena token
    '★☆☆☆☆': 2525, // 15
    '★★☆☆☆': 2529, // 30
    '★★★☆☆': 2526, // 60
    '★★★★☆': 2530, // 100
    '★★★★★': 2550, // 200
  },
} as const

const specialVendorCosts = {
  epicItem: 2428,
  epicRing: 1911,
  luckyFishingHat: 2559,
} as const

const luckyFishingHatItemId = 19972
const ringInventoryType = 11
const satchelLootEntry = 51999
const allPlayableClassesMask = 2047
const satchelLegacyChoiceReference = 10066
const satchelAlwaysDropReference = 10065
const satchelMinMoneyLoot = 50 * 100
const satchelMaxMoneyLoot = 75 * 100
const satchelReferenceByCategory = {
  cloth: { classMask: 400, reference: 10036 },
  leather: { classMask: 1100, reference: 10037 },
  mail: { classMask: 3, reference: 10038 },
  weapon: { classMask: allPlayableClassesMask, reference: 10062 },
  shield: { classMask: 67, reference: 10063 },
  accessory: { classMask: allPlayableClassesMask, reference: 10064 },
} as const

const getCost = (item: VendorItem) => {
  if (item.value) return costs[item.currency][item.value]
  if (!item.special) return undefined
  if (item.itemId === luckyFishingHatItemId) return specialVendorCosts.luckyFishingHat
  if (item.inventoryType === ringInventoryType) return specialVendorCosts.epicRing
  return specialVendorCosts.epicItem
}

const satchelReferenceForItem = (item: SatchelItem) => {
  if (item.classId === 4) {
    if ([2, 11, 12, 16].includes(item.inventoryType)) return { ...satchelReferenceByCategory.accessory }
    if (item.subclassId === 1) return { ...satchelReferenceByCategory.cloth }
    if (item.subclassId === 2) return { ...satchelReferenceByCategory.leather }
    if (item.subclassId === 3) return { ...satchelReferenceByCategory.mail }
    if (item.subclassId === 6) return { ...satchelReferenceByCategory.shield }
  }

  if (item.classId === 2) {
    if (item.subclassId === 19) return { classMask: 400, reference: satchelReferenceByCategory.weapon.reference }
    if (item.subclassId === 0) return { classMask: 79, reference: satchelReferenceByCategory.weapon.reference }
    if (item.subclassId === 1) return { classMask: 71, reference: satchelReferenceByCategory.weapon.reference }
    return { ...satchelReferenceByCategory.weapon }
  }

  return { ...satchelReferenceByCategory.accessory }
}

const generateQuestSql = (
  quests: Quest[],
  positionsByNpc: Map<number, CreaturePositionRow>,
  npcNames: Map<number, string>,
  npcSubnames: Map<number, string>,
  npcSpawnSwaps: NpcSpawnSwap[],
  satchelItems: SatchelItem[],
  satchelAlwaysDropItems: SatchelDropItem[],
  vendorItems: VendorItem[],
) => {
  const questIds = quests.map((quest) => quest.id)
  const minQuestId = Math.min(...questIds)
  const maxQuestId = Math.max(...questIds)
  const rangeWhere = `ID >= ${minQuestId} AND ID <= ${maxQuestId}`
  const questWhere = `quest >= ${minQuestId} AND quest <= ${maxQuestId}`
  const poiWhere = `QuestId >= ${minQuestId} AND QuestId <= ${maxQuestId}`
  const questPoiRows = quests.flatMap((quest) => {
    const poi = positionsByNpc.get(quest.taker)
    return poi ? [`(${quest.id}, 1, -1, ${poi.map}, 105, 0, 0, 0, 0)`] : []
  })
  const questPoiPointRows = quests.flatMap((quest) => {
    const poi = positionsByNpc.get(quest.taker)
    return poi ? [`(${quest.id}, 1, 0, ${Math.round(poi.position_x)}, ${Math.round(poi.position_y)})`] : []
  })
  const addonRows = quests.flatMap((quest) => {
    if (!quest.props.NextQuestID && !quest.props.RequireQuestID) return []
    return [
      `(${quest.id}, 19, 0, 0, ${quest.props.RequireQuestID ?? 0}, ${
        quest.props.NextQuestID ?? 0
      }, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32)`,
    ]
  })
  const npcNameRows = [...npcNames.entries()].sort(([a], [b]) => a - b)
  const npcNameCase = npcNameRows.map(([id, name]) => `  WHEN ${id} THEN ${sqlString(name)}`).join('\n')
  const npcSubnameRows = [...npcSubnames.entries()].sort(([a], [b]) => a - b)
  const npcSubnameCase = npcSubnameRows.map(([id, subname]) => `  WHEN ${id} THEN ${sqlString(subname)}`).join('\n')
  const npcSpawnSwapRows = npcSpawnSwaps
    .map((swap) => `UPDATE \`creature\` SET \`id\` = ${swap.id} WHERE \`guid\` = ${swap.guid};`)
    .join('\n')
  const vendorEntries = [...new Set(vendorItems.map((item) => item.npc))].sort((a, b) => a - b)
  const unlistedVendorWhere = vendorEntries.length ? `\`entry\` NOT IN (${vendorEntries.join(', ')})` : '1 = 1'
  const unlistedVendorCleanup = `-- Remove vendor inventory and vendor flags from NPCs not listed in the ITEM sheet.
DELETE FROM \`npc_vendor\` WHERE ${unlistedVendorWhere};
UPDATE \`creature_template\`
SET \`npcflag\` = \`npcflag\` & ${vendorNpcFlagsWithoutVendorOrTrainer}
WHERE (\`npcflag\` & ${vendorNpcFlag}) <> 0
  AND ${unlistedVendorWhere};

-- Remove trainer flags from merchant and quartermaster NPCs, including legacy entries.
UPDATE \`creature_template\`
SET \`npcflag\` = \`npcflag\` & ${vendorNpcFlagsWithoutTrainer}
WHERE LOWER(\`subname\`) LIKE '%merchant%'
   OR LOWER(\`subname\`) LIKE '%quartermaster%';`
  const vendorSlots = new Map<number, number>()
  const vendorItemRows = vendorItems.map((item) => {
    const slot = (vendorSlots.get(item.npc) ?? 0) + 1
    vendorSlots.set(item.npc, slot)
    const extendedCost = item.currency === 'gold' ? 0 : getCost(item) ?? 0
    return `  (${item.npc}, ${slot}, ${item.itemId}, 0, 0, ${extendedCost}, NULL)`
  })
  const goldVendorPrices = [
    ...new Map(
      vendorItems
        .filter((item) => item.currency === 'gold')
        .flatMap((item) => {
          const cost = getCost(item)
          return cost === undefined ? [] : [[item.itemId, cost]]
        }),
    ),
  ].sort(([a], [b]) => a - b)
  const goldVendorItemIds = goldVendorPrices.map(([itemId]) => itemId)
  const goldVendorPriceCase = goldVendorPrices.map(([itemId, price]) => `  WHEN ${itemId} THEN ${price}`).join('\n')
  const goldVendorSellPriceCase = goldVendorPrices
    .map(([itemId, price]) => `  WHEN ${itemId} THEN ${Math.floor(price / 4)}`)
    .join('\n')
  const satchelReferenceItems = satchelItems.map((item) => ({ item, ...satchelReferenceForItem(item) }))
  const satchelAlwaysDropReferenceItems = satchelAlwaysDropItems.map((item) => ({
    item,
    reference: satchelAlwaysDropReference,
  }))
  const satchelReferenceIds = [
    ...new Set([
      ...satchelReferenceItems.map((item) => item.reference),
      10036,
      10037,
      10038,
      satchelLegacyChoiceReference,
      satchelAlwaysDropReference,
    ]),
  ].sort((a, b) => a - b)
  const satchelItemIds = [
    ...new Set([
      ...satchelReferenceItems.map(({ item }) => item.itemId),
      ...satchelAlwaysDropReferenceItems.map(({ item }) => item.itemId),
    ]),
  ]
  const satchelGroupId = (reference: number) => satchelReferenceIds.indexOf(reference) + 1
  const satchelLootItems = satchelReferenceItems
  const satchelLootRows = [
    ...satchelLootItems.map(({ item }) =>
      `  (${satchelLootEntry}, ${item.itemId}, 0, 0, 0, 1, 1, 1, 1, ${
        sqlString(
          item.name,
        )
      })`
    ),
    `  (${satchelLootEntry}, 0, ${satchelAlwaysDropReference}, 100, 0, 1, 0, 1, 1, 'Satchel of Helpful Goods - (ReferenceTable)')`,
  ]
  const satchelReferenceLootRows = [
    ...satchelAlwaysDropReferenceItems.map(({ item, reference }) =>
      `  (${reference}, ${item.itemId}, 0, 0, 0, 1, ${satchelGroupId(reference)}, 1, 1, ${sqlString(item.name)})`
    ),
  ]
  const satchelConditionRows = satchelLootItems.map(({ item, classMask }) =>
    `  (10, ${satchelLootEntry}, ${item.itemId}, 0, 0, 15, 0, ${classMask}, 0, 0, 0, 0, 0, '', ${
      sqlString(
        `Generated Satchel of Helpful Goods - ${item.name}`,
      )
    })`
  )

  return `${generatedHeader}

USE \`${worldDb}\`;

DELETE FROM quest_request_items WHERE ${rangeWhere};
DELETE FROM quest_offer_reward WHERE ${rangeWhere};
DELETE FROM quest_template_addon WHERE ${rangeWhere};
DELETE FROM creature_queststarter WHERE ${questWhere};
DELETE FROM creature_questender WHERE ${questWhere};
DELETE FROM quest_template WHERE ${rangeWhere};
DELETE FROM quest_poi WHERE ${poiWhere};
DELETE FROM quest_poi_points WHERE ${poiWhere};

UPDATE item_template SET \`RequiredReputationFaction\` = 0, \`RequiredReputationRank\` = 0, \`AllowableRace\` = -1 WHERE \`RequiredReputationFaction\` <> 0 OR AllowableRace <> -1 OR \`RequiredReputationRank\` <> 0;
UPDATE item_template SET \`AllowableClass\` = -1 WHERE (\`entry\` = 18468);
UPDATE item_template SET \`socketColor_1\` = 4, \`socketContent_1\` = 1 WHERE (\`InventoryType\` IN (1, 7));
UPDATE item_template SET \`RequiredSkill\` = 0, \`RequiredSkillRank\` = 0 WHERE \`RequiredSkill\` > 0;
UPDATE item_template SET \`name\` = 'Smoked Speckled Tastyfish', \`spellcharges_1\` = 0, \`description\` = 'The first bite is delicious. The thousandth is still a surprise.', \`Quality\` = 2, \`flags\` = \`flags\` | 32, \`SellPrice\` = 0, \`bonding\` = 1 WHERE (\`entry\` = 21153);
UPDATE item_template SET \`name\` = 'Infinite Bandage', \`Quality\` = 2, \`flags\` = \`flags\` | 32, \`spellcharges_1\` = 0, \`SellPrice\` = 0, \`bonding\` = 1 WHERE (\`entry\` = 14530);
UPDATE item_template SET \`Quality\` = 3, \`spellcharges_1\` = 0 WHERE (\`entry\` = 4381);

UPDATE \`creature_template\` SET \`npcflag\` = \`npcflag\` | 2 WHERE \`entry\` IN (${
    [...new Set(quests.flatMap((quest) => [quest.giver, quest.taker]))].sort((a, b) => a - b).join(', ')
  });

UPDATE \`creature_template\` SET \`gossip_menu_id\` = 0, \`ScriptName\` = '' WHERE (\`entry\` IN (35364, 35365));

${
    npcNameRows.length
      ? `UPDATE \`creature_template\`
SET \`name\` = CASE \`entry\`
${npcNameCase}
END
WHERE \`entry\` IN (${npcNameRows.map(([id]) => id).join(', ')});`
      : '-- No NPC name rows.'
  }

${
    npcSubnameRows.length
      ? `UPDATE \`creature_template\`
SET \`subname\` = CASE \`entry\`
${npcSubnameCase}
END
WHERE \`entry\` IN (${npcSubnameRows.map(([id]) => id).join(', ')});`
      : '-- No NPC subname rows.'
  }

${npcSpawnSwapRows || '-- No NPC spawn swaps.'}

${unlistedVendorCleanup}

${
    vendorEntries.length
      ? `UPDATE \`creature_template\`
SET \`npcflag\` = (\`npcflag\` & ${vendorNpcFlagsWithoutTrainer}) | ${vendorNpcFlag},
    \`faction\` = ${consortiumFaction}
WHERE \`entry\` IN (${vendorEntries.join(', ')});

DELETE FROM \`npc_vendor\` WHERE \`entry\` IN (${vendorEntries.join(', ')});

${
        goldVendorItemIds.length
          ? `UPDATE \`item_template\`
SET \`BuyPrice\` = CASE \`entry\`
${goldVendorPriceCase}
END,
\`SellPrice\` = CASE \`entry\`
${goldVendorSellPriceCase}
END
WHERE \`entry\` IN (${goldVendorItemIds.join(', ')});`
          : '-- No gold vendor item prices.'
      }

INSERT INTO \`npc_vendor\` (\`entry\`, \`slot\`, \`item\`, \`maxcount\`, \`incrtime\`, \`ExtendedCost\`, \`VerifiedBuild\`) VALUES
${vendorItemRows.join(',\n')};`
      : '-- No generated vendor inventory.'
  }

DELETE FROM \`item_loot_template\` WHERE \`Entry\` = ${satchelLootEntry};

UPDATE \`item_template\`
SET \`MinMoneyLoot\` = ${satchelMinMoneyLoot},
    \`MaxMoneyLoot\` = ${satchelMaxMoneyLoot}
WHERE \`entry\` = ${satchelLootEntry};

${
    satchelLootRows.length
      ? `INSERT INTO \`item_loot_template\` (\`Entry\`, \`Item\`, \`Reference\`, \`Chance\`, \`QuestRequired\`, \`LootMode\`, \`GroupId\`, \`MinCount\`, \`MaxCount\`, \`Comment\`) VALUES
${satchelLootRows.join(',\n')};`
      : '-- No generated Satchel of Helpful Goods loot.'
  }

DELETE FROM \`reference_loot_template\`
WHERE \`Entry\` = ${satchelLegacyChoiceReference}
   OR (\`Entry\` IN (${satchelReferenceIds.join(', ')})
       AND \`Item\` IN (${satchelItemIds.join(', ')}));

${
    satchelReferenceLootRows.length
      ? `INSERT INTO \`reference_loot_template\` (\`Entry\`, \`Item\`, \`Reference\`, \`Chance\`, \`QuestRequired\`, \`LootMode\`, \`GroupId\`, \`MinCount\`, \`MaxCount\`, \`Comment\`) VALUES
${satchelReferenceLootRows.join(',\n')};`
      : '-- No generated Satchel reference loot.'
  }

DELETE FROM \`conditions\`
WHERE \`SourceTypeOrReferenceId\` = 10
  AND (\`SourceGroup\` = ${satchelLootEntry}
    OR \`SourceGroup\` IN (${satchelReferenceIds.join(', ')}))
  AND \`SourceEntry\` IN (${satchelItemIds.join(', ')});

${
    satchelConditionRows.length
      ? `INSERT INTO \`conditions\` (\`SourceTypeOrReferenceId\`, \`SourceGroup\`, \`SourceEntry\`, \`SourceId\`, \`ElseGroup\`, \`ConditionTypeOrReference\`, \`ConditionTarget\`, \`ConditionValue1\`, \`ConditionValue2\`, \`ConditionValue3\`, \`NegativeCondition\`, \`ErrorType\`, \`ErrorTextId\`, \`ScriptName\`, \`Comment\`) VALUES
${satchelConditionRows.join(',\n')};`
      : '-- No generated Satchel loot conditions.'
  }

INSERT INTO \`quest_template\` (${questTemplateColumns.map((column) => `\`${column}\``).join(', ')}) VALUES
${quests.map((quest) => `  ${questTemplateRow(quest, positionsByNpc.get(quest.taker))}`).join(',\n')};

-- Reapply sheet-defined item requirements explicitly after quest row generation.
${questRequiredItemUpdateRows(quests) || '-- No sheet-defined quest item requirements.'}

INSERT INTO \`quest_offer_reward\` (\`ID\`, \`Emote1\`, \`Emote2\`, \`Emote3\`, \`Emote4\`, \`EmoteDelay1\`, \`EmoteDelay2\`, \`EmoteDelay3\`, \`EmoteDelay4\`, \`RewardText\`, \`VerifiedBuild\`) VALUES
${quests.map((quest) => `  (${quest.id}, 0, 0, 0, 0, 0, 0, 0, 0, ${sqlString(quest.end)}, 0)`).join(',\n')};

${
    addonRows.length
      ? `INSERT INTO \`quest_template_addon\` (\`ID\`, \`MaxLevel\`, \`AllowableClasses\`, \`SourceSpellID\`, \`PrevQuestID\`, \`NextQuestID\`, \`ExclusiveGroup\`, \`RewardMailTemplateID\`, \`RewardMailDelay\`, \`RequiredSkillID\`, \`RequiredSkillPoints\`, \`RequiredMinRepFaction\`, \`RequiredMaxRepFaction\`, \`RequiredMinRepValue\`, \`RequiredMaxRepValue\`, \`ProvidedItemCount\`, \`SpecialFlags\`) VALUES
${addonRows.map((row) => `  ${row}`).join(',\n')};`
      : '-- No quest_template_addon rows.'
  }

INSERT INTO \`quest_request_items\` (\`ID\`, \`EmoteOnComplete\`, \`EmoteOnIncomplete\`, \`CompletionText\`, \`VerifiedBuild\`) VALUES
${quests.map((quest) => `  (${quest.id}, 0, 0, ${sqlString(quest.progression)}, 0)`).join(',\n')};

INSERT INTO \`creature_queststarter\` (\`id\`, \`quest\`) VALUES
${quests.map((quest) => `  (${quest.giver}, ${quest.id})`).join(',\n')};

INSERT INTO \`creature_questender\` (\`id\`, \`quest\`) VALUES
${quests.map((quest) => `  (${quest.taker}, ${quest.id})`).join(',\n')};

${
    questPoiRows.length
      ? `INSERT INTO quest_poi (\`QuestId\`, \`id\`, \`ObjectiveIndex\`, \`MapId\`, \`WorldMapAreaId\`, \`Floor\`, \`Priority\`, \`Flags\`, \`VerifiedBuild\`) VALUES
${questPoiRows.map((row) => `  ${row}`).join(',\n')};

INSERT INTO quest_poi_points (\`QuestId\`, \`idx1\`, \`idx2\`, \`X\`, \`Y\`) VALUES
${questPoiPointRows.map((row) => `  ${row}`).join(',\n')};`
      : '-- No quest POI rows: no taker NPCs found on map 530.'
  }
`
}

const cdCategories: Record<number, number> = {
  42292: 1182, // PvP Trinket
}
const generatedHeader = '-- Generated by tasks/refresh_db.ts'

const generateWsgBotRosterSql = (roster: WsgBotRosterEntry[], items: WsgBotItem[]) => {
  const rosterRows = roster.map((bot) =>
    `  (${sqlString(bot.account)}, ${sqlString(bot.name)}, ${bot.raceId}, ${bot.classId}, ${sqlString(bot.role)}, ${
      sqlString(bot.spec)
    }, ${bot.replacementPriority}, ${sqlString(bot.behaviorProfile)}, ${bot.enabled ? 1 : 0})`
  )
  const itemRows = items.map((item) =>
    `  (${sqlString(item.account)}, ${item.itemId}, ${item.amount}, ${sqlString(item.note)}, 1)`
  )

  return `${generatedHeader}

USE \`${playerbotsDb}\`;

DROP TABLE IF EXISTS \`playerbots_fixed_roster_item\`;
DROP TABLE IF EXISTS \`playerbots_fixed_roster\`;

CREATE TABLE IF NOT EXISTS \`playerbots_fixed_roster\` (
  \`account\` varchar(32) NOT NULL DEFAULT '',
  \`name\` varchar(12) NOT NULL DEFAULT '',
  \`race\` tinyint unsigned NOT NULL DEFAULT 0,
  \`class\` tinyint unsigned NOT NULL DEFAULT 0,
  \`role\` varchar(16) NOT NULL DEFAULT '',
  \`spec\` varchar(32) NOT NULL DEFAULT '',
  \`replacement_priority\` tinyint unsigned NOT NULL DEFAULT 0,
  \`behavior_profile\` varchar(32) NOT NULL DEFAULT '',
  \`enabled\` tinyint(1) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (\`account\`),
  UNIQUE KEY \`name_unique\` (\`name\`),
  KEY \`enabled\` (\`enabled\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS \`playerbots_fixed_roster_guid\` (
  \`account\` varchar(32) NOT NULL DEFAULT '',
  \`guid\` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (\`account\`),
  UNIQUE KEY \`guid_unique\` (\`guid\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS \`playerbots_fixed_roster_item\` (
  \`account\` varchar(32) NOT NULL,
  \`item\` int unsigned NOT NULL,
  \`amount\` int unsigned NOT NULL DEFAULT 1,
  \`note\` varchar(255) NOT NULL DEFAULT '',
  \`enabled\` tinyint(1) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (\`account\`, \`item\`),
  KEY \`enabled\` (\`enabled\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO \`playerbots_fixed_roster\` (
  \`account\`,
  \`name\`,
  \`race\`,
  \`class\`,
  \`role\`,
  \`spec\`,
  \`replacement_priority\`,
  \`behavior_profile\`,
  \`enabled\`
) VALUES
${rosterRows.join(',\n')};

${
    itemRows.length
      ? `INSERT INTO \`playerbots_fixed_roster_item\` (\`account\`, \`item\`, \`amount\`, \`note\`, \`enabled\`) VALUES
${itemRows.join(',\n')};`
      : '-- No fixed roster item rows.'
  }

-- Sync character names from the fixed roster to the characters database
UPDATE \`${charactersDb}\`.\`characters\` c
JOIN \`${playerbotsDb}\`.\`playerbots_fixed_roster_guid\` g ON g.\`guid\` = c.\`guid\`
JOIN \`${playerbotsDb}\`.\`playerbots_fixed_roster\` r ON r.\`account\` = g.\`account\`
SET c.\`name\` = r.\`name\`
WHERE c.\`name\` <> r.\`name\`;
`
}

const itemUpdateSql = (itemId: number, props: ItemProps) => {
  const assignments: string[] = []

  // 1. SIMPLE UPDATES (Assign if defined in sheet)
  assignments.push(`\`bonding\` = ${soulboundBonding}`)

  if (props.name !== undefined) {
    assignments.push(`\`description\` = IF(\`name\` <> ${sqlString(props.name)}, '', \`description\`)`)
    assignments.push(`\`name\` = ${sqlString(props.name)}`)
  }

  if (props.quality !== undefined) {
    assignments.push(`\`Quality\` = ${props.quality}`)
  }

  if (props.stats && props.stats.length > 0) {
    for (let index = 0; index < 10; index++) {
      const stat = props.stats[index]
      assignments.push(`\`stat_type${index + 1}\` = ${stat?.type ?? 0}`)
      assignments.push(`\`stat_value${index + 1}\` = ${stat?.value ?? 0}`)
    }
    for (const column of ['holy_res', 'fire_res', 'nature_res', 'frost_res', 'shadow_res', 'arcane_res']) {
      assignments.push(`\`${column}\` = 0`)
    }
  }

  if (props.use !== undefined) {
    for (let index = 1; index <= 5; index++) {
      assignments.push(`\`spellid_${index}\` = 0`)
      assignments.push(`\`spelltrigger_${index}\` = 0`)
      assignments.push(`\`spellcharges_${index}\` = 0`)
      assignments.push(`\`spellppmRate_${index}\` = 0`)
      assignments.push(`\`spellcooldown_${index}\` = -1`)
      assignments.push(`\`spellcategory_${index}\` = 0`)
      assignments.push(`\`spellcategorycooldown_${index}\` = -1`)
    }

    assignments.push(`\`spellid_1\` = ${props.use}`)
    assignments.push('`spelltrigger_1` = 0')
    assignments.push(`\`spellcategory_1\` = ${cdCategories[props.use] || props.use}`)

    if (props.cd !== undefined) {
      assignments.push(`\`spellcooldown_1\` = ${props.cd}`)
      assignments.push(`\`spellcategorycooldown_1\` = ${props.cd}`)
    }
  }

  return `UPDATE item_template
SET ${assignments.join(',\n    ')}
WHERE \`entry\` = ${itemId};`
}

const bonusArmorStatCleanupSql = () => {
  const assignments: string[] = [`\`bonding\` = ${soulboundBonding}`, '`startquest` = 0']
  for (let index = 1; index <= 10; index++) {
    assignments.push(
      `\`stat_value${index}\` = IF(\`stat_type${index}\` = ${bonusArmorStatType}, 0, \`stat_value${index}\`)`,
    )
    assignments.push(
      `\`stat_type${index}\` = IF(\`stat_type${index}\` = ${bonusArmorStatType}, 0, \`stat_type${index}\`)`,
    )
  }
  return assignments.join(',\n    ')
}

const classMasks = {
  warrior: 1,
  paladin: 2,
  hunter: 4,
  rogue: 8,
  priest: 16,
  shaman: 64,
  mage: 128,
  warlock: 256,
  druid: 1024,
} as const

type PlayerClass = keyof typeof classMasks

const allowableClass = (classes: PlayerClass[]) =>
  classes.reduce((mask, playerClass) => mask | classMasks[playerClass], 0)

const weaponClassRestrictions = [
  { subclasses: [0], classes: ['warrior', 'paladin', 'hunter', 'rogue', 'shaman'] }, // One-handed axes
  { subclasses: [1], classes: ['warrior', 'paladin', 'hunter', 'shaman'] }, // Two-handed axes
  { subclasses: [2, 3, 16, 18], classes: ['warrior', 'hunter', 'rogue'] }, // Bows, guns, thrown, crossbows
  { subclasses: [4], classes: ['warrior', 'paladin', 'rogue', 'priest', 'shaman', 'druid'] }, // One-handed maces
  { subclasses: [5], classes: ['warrior', 'paladin', 'shaman', 'druid'] }, // Two-handed maces
  { subclasses: [6], classes: ['warrior', 'paladin', 'hunter', 'druid'] }, // Polearms
  { subclasses: [7], classes: ['warrior', 'paladin', 'hunter', 'rogue', 'mage', 'warlock'] }, // One-handed swords
  { subclasses: [8], classes: ['warrior', 'paladin', 'hunter'] }, // Two-handed swords
  { subclasses: [10], classes: ['warrior', 'hunter', 'priest', 'shaman', 'mage', 'warlock', 'druid'] }, // Staves
  { subclasses: [13], classes: ['warrior', 'hunter', 'rogue', 'shaman', 'druid'] }, // Fist weapons
  { subclasses: [15], classes: ['warrior', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'] }, // Daggers
  { subclasses: [19], classes: ['priest', 'mage', 'warlock'] }, // Wands
] satisfies { subclasses: number[]; classes: PlayerClass[] }[]

const subclassList = (subclasses: number[]) =>
  subclasses.length === 1 ? `= ${subclasses[0]}` : `IN (${subclasses.join(', ')})`

const weaponClassRestrictionSql = () =>
  weaponClassRestrictions.map((restriction) =>
    `UPDATE item_template
SET \`AllowableClass\` = ${allowableClass(restriction.classes)}
WHERE \`class\` = 2
  AND \`subclass\` ${subclassList(restriction.subclasses)}
  AND \`AllowableClass\` = -1;`
  ).join('\n\n')

const generateItemPropsSql = (itemUpdates: Map<number, ItemProps>) => {
  const itemUpdateRows = [...itemUpdates.entries()]
    .sort(([a], [b]) => a - b)
    .map(([itemId, props]) => itemUpdateSql(itemId, props))
    .join('\n\n')
  const appliedItemSpellRows = appliedItemSpells
    .map(
      ({ itemId, spellId }) =>
        `UPDATE \`item_template\`
SET \`spellid_1\` = ${spellId},
    \`spelltrigger_1\` = 1,
    \`spellcharges_1\` = 0,
    \`spellppmRate_1\` = 0,
    \`spellcooldown_1\` = -1,
    \`spellcategory_1\` = 0,
    \`spellcategorycooldown_1\` = -1
WHERE \`entry\` = ${itemId};`,
    )
    .join('\n\n')

  return `${generatedHeader}

USE \`${worldDb}\`;

${itemUpdateRows || '-- No item prop updates.'}

-- Apply permanent item spells without making them on-use effects.
${appliedItemSpellRows || '-- No applied item spells.'}
`
}

const generateItemTemplateSql = (itemIds: number[]) => {
  const itemIdList = [...new Set(itemIds)].sort((a, b) => a - b).join(', ')

  return `${generatedHeader}

USE \`${worldDb}\`;

-- Make every sheet-listed item soulbound and remove any bonus armor stat slots.
UPDATE item_template
SET ${bonusArmorStatCleanupSql()}
WHERE \`entry\` IN (${itemIdList});

-- Make sheet-listed gems ordinary non-unique socket gems.
UPDATE \`item_template\`
SET \`Flags\` = \`Flags\` & 4294443007,
    \`ItemLimitCategory\` = 0
WHERE \`entry\` IN (${itemIdList})
  AND \`class\` = 3;

CREATE TEMPORARY TABLE item_template_relaxed_class_entries AS
SELECT \`entry\`
FROM item_template
WHERE \`RequiredLevel\` > 19
   OR \`ItemLevel\` > 45;

-- Normalize custom bracket item levels before relaxing requirements, but preserve
-- item levels for random-suffix items because their stats scale from ItemLevel.
UPDATE \`item_template\`
SET \`ItemLevel\` = 35
WHERE \`RandomSuffix\` = 0;

-- Remove class requirements from items that were above the bracket before level normalization.
UPDATE item_template
SET \`AllowableClass\` = -1
WHERE \`entry\` IN (SELECT \`entry\` FROM item_template_relaxed_class_entries);

-- Remove item required levels.
UPDATE item_template
SET \`RequiredLevel\` = 0;

DROP TEMPORARY TABLE item_template_relaxed_class_entries;

-- Restrict unrestricted mail and plate armor to warrior/paladin.
UPDATE item_template
SET \`AllowableClass\` = 3
WHERE \`class\` = 4
  AND \`subclass\` IN (3, 4)
  AND \`AllowableClass\` = -1;

-- Restrict unrestricted leather armor to every non-DK class except priest/mage/warlock.
UPDATE item_template
SET \`AllowableClass\` = 1103
WHERE \`class\` = 4
  AND \`subclass\` = 2
  AND \`AllowableClass\` = -1;

-- Restrict unrestricted weapons to classes that can learn each weapon type.
${weaponClassRestrictionSql()}

-- Restrict unrestricted shields to warrior/paladin/shaman.
UPDATE item_template
SET \`AllowableClass\` = ${allowableClass(['warrior', 'paladin', 'shaman'])}
WHERE \`class\` = 4
  AND \`subclass\` = 6
  AND \`AllowableClass\` = -1;
`
}

const enchantStats = (enchantIds: number[], values: number[]) =>
  enchantIds.flatMap((id, index) => {
    const enchant = dbc.enchant.get(id)
    if (!enchant) return []
    return [
      { id: enchant.EffectArg_1, value: values[index] },
      { id: enchant.EffectArg_2, value: values[index] },
      { id: enchant.EffectArg_3, value: values[index] },
    ].filter((stat) => stat.id > 0 && stat.value > 0)
  }).sort((a, b) => a.id - b.id)

const scoreStats = (stats: { id: number; value: number }[]) => stats.reduce((total, stat) => total + stat.value, 0)
const optionKey = (option: RandomEnchantOption) => option.stats.map((stat) => stat.id).join(':')

const suffixOptionsById = new Map<number, RandomEnchantOption>()
const propertyOptionsById = new Map<number, RandomEnchantOption>()

for (const suffix of dbc.suffix.values()) {
  const name = suffix.Name_Lang_enUS.trim()
  if (!name || name.toLowerCase().includes('test')) continue

  const enchants = [
    suffix.Enchantment_1,
    suffix.Enchantment_2,
    suffix.Enchantment_3,
    suffix.Enchantment_4,
    suffix.Enchantment_5,
  ].filter((id) => id > 0)
  const allocations = [
    suffix.AllocationPct_1,
    suffix.AllocationPct_2,
    suffix.AllocationPct_3,
    suffix.AllocationPct_4,
    suffix.AllocationPct_5,
  ]
  const stats = enchantStats(enchants, allocations)
  if (stats.length === 0) continue

  const score = scoreStats(stats)
  const option = {
    id: suffix.ID,
    name,
    enchants,
    stats,
    score,
  }
  suffixOptionsById.set(suffix.ID, option)
}

for (const property of dbc.properties.values()) {
  const name = property.Name_Lang_enUS.trim()
  if (!name || name.toLowerCase().includes('test')) continue

  const enchants = [
    property.Enchantment_1,
    property.Enchantment_2,
    property.Enchantment_3,
    property.Enchantment_4,
    property.Enchantment_5,
  ].filter((id) => id > 0)
  const values = enchants.map((id) => {
    const enchant = dbc.enchant.get(id)
    if (!enchant) return 0
    return Math.max(
      enchant.EffectPointsMin_1,
      enchant.EffectPointsMax_1,
      enchant.EffectPointsMin_2,
      enchant.EffectPointsMax_2,
      enchant.EffectPointsMin_3,
      enchant.EffectPointsMax_3,
    )
  })
  const stats = enchantStats(enchants, values)
  if (stats.length === 0) continue

  propertyOptionsById.set(property.ID, {
    id: property.ID,
    name,
    enchants,
    stats,
    score: scoreStats(stats),
  })
}

const itemSuffixOptions = new Map<number, RandomEnchantOption[]>()
const itemPropertyOptions = new Map<number, RandomEnchantOption[]>()
const itemRandomSuffix = new Map<number, number>()
const itemRandomProperty = new Map<number, number>()
const randomEnchantItemIds = new Set<number>()

const addOption = (optionsByItem: Map<number, RandomEnchantOption[]>, itemId: number, option: RandomEnchantOption) => {
  const options = optionsByItem.get(itemId) ?? []
  const key = optionKey(option)
  const duplicateIndex = options.findIndex((current) => optionKey(current) === key)
  if (duplicateIndex === -1) {
    options.push(option)
  } else if (option.score > options[duplicateIndex].score) {
    options[duplicateIndex] = option
  }
  optionsByItem.set(itemId, options)
}

for (const row of itemEnchantRows) {
  itemRandomSuffix.set(row.item, row.randomSuffix)
  itemRandomProperty.set(row.item, row.randomProperty)
  if (row.randomSuffix > 0 || row.randomProperty > 0) {
    randomEnchantItemIds.add(row.item)
  }
  if (row.suffixId) {
    const option = suffixOptionsById.get(row.suffixId)
    if (option) addOption(itemSuffixOptions, row.item, option)
  }

  if (row.propertyId) {
    const property = propertyOptionsById.get(row.propertyId)
    if (property) addOption(itemPropertyOptions, row.item, property)
  }
}

for (const optionsByItem of [itemSuffixOptions, itemPropertyOptions]) {
  for (const options of optionsByItem.values()) {
    options.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
  }
}

const usedSuffixOptions = new Map<number, RandomEnchantOption>()
for (const options of itemSuffixOptions.values()) {
  for (const option of options) {
    usedSuffixOptions.set(option.id, option)
  }
}
const usedPropertyOptions = new Map<number, RandomEnchantOption>()
for (const options of itemPropertyOptions.values()) {
  for (const option of options) {
    usedPropertyOptions.set(option.id, option)
  }
}

const luaItem = (itemId: number) => {
  const suffixes = itemSuffixOptions.get(itemId) ?? []
  const properties = itemPropertyOptions.get(itemId) ?? []
  const item = dbc.item.get(itemId)
  const display = item ? dbc.itemDisplay.get(item.DisplayInfoID) : undefined
  const icon = display?.InventoryIcon_1 ?? ''
  return `    [${itemId}] = { random_suffix = ${itemRandomSuffix.get(itemId) ?? 0}, random_property = ${
    itemRandomProperty.get(itemId) ?? 0
  }, icon = ${luaString(icon)}, suffixes = ${luaArray(suffixes, (option) => String(option.id))}, properties = ${
    luaArray(properties, (option) => String(option.id))
  } },`
}

const luaOption = (option: RandomEnchantOption) =>
  `    [${option.id}] = { id = ${option.id}, name = ${luaString(option.name)}, score = ${option.score}, enchants = ${
    luaArray(option.enchants, (id) => String(id))
  }, stats = ${luaArray(option.stats, (stat) => `{ id = ${stat.id}, value = ${stat.value} }`)} },`

const quests = parseQuests(gsheetData.QUEST)
const npcSubnames = parseNpcSubnames(gsheetData.NPC)
const npcNames = parseNpcNames(gsheetData.NPC)
const npcSpawnSwaps = parseNpcSpawnSwaps(gsheetData.NPC)
const npcEntriesBySubname = buildNpcEntryBySubname(npcSubnames)
const satchelItems = parseSatchelItems(gsheetData.ITEM, itemInfoById)
const satchelAlwaysDropItems = satchelAlwaysDropItemIds.flatMap((itemId) => {
  const item = itemInfoById.get(itemId)
  if (!item) {
    questWarnings.push(`Satchel always-drop item ${itemId}: item_template row not found`)
    return []
  }
  return [{ itemId, name: item.name }]
})
const vendorItems = parseVendorItems(gsheetData.ITEM, itemInfoById)
const wsgBotRoster = parseWsgBotRoster()
const wsgBotItems = parseWsgBotItems(/* gsheetData.ITEM */ [], wsgBotRoster, starterItems, botStarterItems)
const luaQuestRewardSpells = quests
  .filter((quest) => quest.props.LearnSpell)
  .sort((a, b) => a.id - b.id)
  .map((quest) => `    [${quest.id}] = ${quest.props.LearnSpell},`)
  .join('\n')

const lua = `-- Generated by tasks/refresh_db.ts

custom_data = {
  random_enchants = {
    items = {
${itemIds.filter((itemId) => randomEnchantItemIds.has(itemId)).map(luaItem).join('\n')}
    },
    suffix_options = {
${
  [...usedSuffixOptions.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
    .map(luaOption)
    .join('\n')
}
    },
    property_options = {
${
  [...usedPropertyOptions.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
    .map(luaOption)
    .join('\n')
}
    },
  },
  quest_reward_spells = {
${luaQuestRewardSpells}
  },
}
`

await Deno.writeTextFile('core_scripts/custom-data.lua', lua)
console.log(
  `wrote ${randomEnchantItemIds.size} items, ${usedSuffixOptions.size} suffix options, ${usedPropertyOptions.size} property options and ${
    quests.filter((quest) => quest.props.LearnSpell).length
  } quest reward spells`,
)

await Deno.writeTextFile('sql/generated-item-props.sql', generateItemPropsSql(itemUpdates))
console.log('wrote item prop updates to sql/generated-item-props.sql')

await Deno.writeTextFile('sql/generated-item-template.sql', generateItemTemplateSql(itemIds))
console.log('wrote item template normalization to sql/generated-item-template.sql')

await Deno.writeTextFile(
  'sql/generated-playerbots-fixed-roster.sql',
  generateWsgBotRosterSql(wsgBotRoster, wsgBotItems),
)
console.log(
  `wrote ${wsgBotRoster.length} WSG bot roster rows and ${wsgBotItems.length} item rows to sql/generated-playerbots-fixed-roster.sql`,
)

await Deno.writeTextFile('sql/starting-info.sql', await generateStartingInfoSql(starterItems))
console.log(`wrote ${starterItems.length} starter item rows to sql/starting-info.sql`)

if (quests.length > 0) {
  const takerIds = [...new Set(quests.map((quest) => quest.taker))].sort((a, b) => a - b)
  const creaturePositionRows = await worldserver.raw.sql`
SELECT spawned.npc, spawned.map, spawned.position_x, spawned.position_y
FROM (
  SELECT id npc, map, position_x, position_y, guid
  FROM creature
  WHERE map = 530 AND id IN (${takerIds.join(', ')})
) spawned
INNER JOIN (
  SELECT id npc, MAX(guid) guid
  FROM creature
  WHERE map = 530 AND id IN (${takerIds.join(', ')})
  GROUP BY id
) latest
  ON latest.npc = spawned.npc AND latest.guid = spawned.guid
ORDER BY npc
    ` as CreaturePositionRow[]

  const positionsByNpc = new Map(creaturePositionRows.map((row) => [Number(row.npc), row]))
  const missingPoiTakers = takerIds.filter((taker) => !positionsByNpc.has(taker))
  for (const taker of missingPoiTakers) {
    questWarnings.push(`NPC ${taker}: no map 530 creature spawn found for quest POI`)
  }

  await Deno.writeTextFile(
    'sql/generated-quests.sql',
    generateQuestSql(
      quests,
      positionsByNpc,
      npcNames,
      npcSubnames,
      npcSpawnSwaps,
      satchelItems,
      satchelAlwaysDropItems,
      vendorItems,
    ),
  )
  console.log(
    `wrote ${quests.length} quests, ${satchelItems.length} satchel items, ${satchelAlwaysDropItems.length} always-drop satchel items, and ${vendorItems.length} vendor items to sql/generated-quests.sql`,
  )
}

for (const warning of questWarnings) {
  console.warn(`quest warning: ${warning}`)
}
