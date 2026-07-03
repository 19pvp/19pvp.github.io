import config from '../config.json' with { type: 'json' }
import { openDBC } from '../dbc.ts'
import { sqlRaw } from '../service/db.ts'

const _config = config
const worldDb = Deno.env.get('WORLD_DB') || '19pvp_world'
if (!/^[a-zA-Z0-9_]+$/.test(worldDb)) throw Error(`invalid WORLD_DB ${worldDb}`)

type GSheetData = {
  ITEM: { ID: string }[]
  NPC?: NpcSheetRow[]
  QUEST?: QuestSheetRow[]
}

type NpcSheetRow = {
  ID?: string
  GUILD?: string
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

type CountedItem = {
  count: number
  id: number
}

type QuestProps = {
  ChooseItem?: number[]
  LearnSpell?: number
  NextQuestID?: number
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

const autoReturnQuestFlags = 589824
const learnSpellRewardDummy = 36937

await fetch('https://gsheet.devazuka.com/refresh/1F1Re3VLtPuF5fXZ1wV79CpogaSgP-fS9r9dm3_aRoP0/QUEST')
const gsheetResponse = await fetch('https://gsheet.devazuka.com/1F1Re3VLtPuF5fXZ1wV79CpogaSgP-fS9r9dm3_aRoP0')
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

const parseNumberArrayProp = (key: keyof QuestProps, value: unknown, rowLabel: string): number[] | undefined => {
  if (!Array.isArray(value)) {
    questWarnings.push(`${rowLabel}: ignored ${key}, expected an array of positive integers`)
    return undefined
  }
  const numbers = value.map(toPositiveInt)
  if (numbers.some((number) => !number)) {
    questWarnings.push(`${rowLabel}: ignored ${key}, expected an array of positive integers`)
    return undefined
  }
  return numbers as number[]
}

const parseCountedItemArrayProp = (
  key: keyof QuestProps,
  value: unknown,
  rowLabel: string,
): CountedItem[] | undefined => {
  const values = Array.isArray(value) ? value : [value]
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
      value = JSON.parse(rawValue)
    } catch (err) {
      questWarnings.push(`${rowLabel}: ignored ${key}, invalid JSON value (${(err as Error).message})`)
      continue
    }

    switch (key) {
      case 'ChooseItem': {
        const parsed = parseNumberArrayProp(key, value, rowLabel)
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

const dbc = {
  item: openDBC('Item'),
  itemDisplay: openDBC('ItemDisplayInfo'),
  properties: openDBC('ItemRandomProperties'),
  suffix: openDBC('ItemRandomSuffix'),
  enchant: openDBC('SpellItemEnchantment'),
}

const itemIds = gsheetData.ITEM.map((i) => Number(i.ID)).filter((i) => i > 1)

console.log(itemIds)

type ItemEnchantRow = {
  item: number
  randomSuffix: number
  randomProperty: number
  suffixId: number | null
  propertyId: number | null
}

const itemEnchantRows = await sqlRaw(
  `
SELECT
  item.entry item,
  item.RandomSuffix randomSuffix,
  item.RandomProperty randomProperty,
  suffix.ench suffixId,
  property.ench propertyId
FROM \`${worldDb}\`.item_template item
LEFT JOIN \`${worldDb}\`.item_enchantment_template suffix
  ON suffix.entry = item.RandomSuffix
LEFT JOIN \`${worldDb}\`.item_enchantment_template property
  ON property.entry = item.RandomProperty
WHERE item.entry IN (${itemIds.map(() => '?').join(', ')})
ORDER BY item.entry, suffix.chance DESC, suffix.ench, property.chance DESC, property.ench
  `,
  itemIds,
) as ItemEnchantRow[]

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
  const choiceItems = quest.props.ChooseItem?.map((id) => ({ count: 1, id })) ?? []
  const requiredItems = quest.props.TakeItem ?? []
  const flags = quest.start.trim() || quest.progression.trim() ? 0 : autoReturnQuestFlags
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

const generateQuestSql = (
  quests: Quest[],
  positionsByNpc: Map<number, CreaturePositionRow>,
  npcSubnames: Map<number, string>,
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
  const npcSubnameRows = [...npcSubnames.entries()].sort(([a], [b]) => a - b)
  const npcSubnameCase = npcSubnameRows.map(([id, subname]) => `  WHEN ${id} THEN ${sqlString(subname)}`).join('\n')

  return `-- Generated by tasks/refresh_db.ts

USE \`${worldDb}\`;

DELETE FROM quest_request_items WHERE ${rangeWhere};
DELETE FROM quest_offer_reward WHERE ${rangeWhere};
DELETE FROM quest_template_addon WHERE ${rangeWhere};
DELETE FROM creature_queststarter WHERE ${questWhere};
DELETE FROM creature_questender WHERE ${questWhere};
DELETE FROM quest_template WHERE ${rangeWhere};
DELETE FROM quest_poi WHERE ${poiWhere};
DELETE FROM quest_poi_points WHERE ${poiWhere};

UPDATE \`creature_template\` SET \`npcflag\` = \`npcflag\` | 2 WHERE \`entry\` IN (${
    [...new Set(quests.flatMap((quest) => [quest.giver, quest.taker]))].sort((a, b) => a - b).join(', ')
  });

${
    npcSubnameRows.length
      ? `UPDATE \`creature_template\`
SET \`subname\` = CASE \`entry\`
${npcSubnameCase}
END
WHERE \`entry\` IN (${npcSubnameRows.map(([id]) => id).join(', ')});`
      : '-- No NPC subname rows.'
  }

INSERT INTO \`quest_template\` (${questTemplateColumns.map((column) => `\`${column}\``).join(', ')}) VALUES
${quests.map((quest) => `  ${questTemplateRow(quest, positionsByNpc.get(quest.taker))}`).join(',\n')};

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

if (quests.length > 0) {
  const takerIds = [...new Set(quests.map((quest) => quest.taker))].sort((a, b) => a - b)
  const creaturePositionRows = await sqlRaw(
    `
SELECT spawned.npc, spawned.map, spawned.position_x, spawned.position_y
FROM (
  SELECT id1 npc, map, position_x, position_y, guid
  FROM \`${worldDb}\`.creature
  WHERE map = 530 AND id1 IN (${takerIds.map(() => '?').join(', ')})
  UNION ALL
  SELECT id2 npc, map, position_x, position_y, guid
  FROM \`${worldDb}\`.creature
  WHERE map = 530 AND id2 IN (${takerIds.map(() => '?').join(', ')})
  UNION ALL
  SELECT id3 npc, map, position_x, position_y, guid
  FROM \`${worldDb}\`.creature
  WHERE map = 530 AND id3 IN (${takerIds.map(() => '?').join(', ')})
) spawned
INNER JOIN (
  SELECT npc, MAX(guid) guid
  FROM (
    SELECT id1 npc, guid FROM \`${worldDb}\`.creature WHERE map = 530 AND id1 IN (${takerIds.map(() => '?').join(', ')})
    UNION ALL
    SELECT id2 npc, guid FROM \`${worldDb}\`.creature WHERE map = 530 AND id2 IN (${takerIds.map(() => '?').join(', ')})
    UNION ALL
    SELECT id3 npc, guid FROM \`${worldDb}\`.creature WHERE map = 530 AND id3 IN (${takerIds.map(() => '?').join(', ')})
  ) spawns
  GROUP BY npc
) latest
  ON latest.npc = spawned.npc AND latest.guid = spawned.guid
ORDER BY npc
    `,
    [...takerIds, ...takerIds, ...takerIds, ...takerIds, ...takerIds, ...takerIds],
  ) as CreaturePositionRow[]

  const positionsByNpc = new Map(creaturePositionRows.map((row) => [Number(row.npc), row]))
  const missingPoiTakers = takerIds.filter((taker) => !positionsByNpc.has(taker))
  for (const taker of missingPoiTakers) {
    questWarnings.push(`NPC ${taker}: no map 530 creature spawn found for quest POI`)
  }

  await Deno.writeTextFile('core_scripts/generated-quests.sql', generateQuestSql(quests, positionsByNpc, npcSubnames))
  console.log(`wrote ${quests.length} quests to core_scripts/generated-quests.sql`)
}

for (const warning of questWarnings) {
  console.warn(`quest warning: ${warning}`)
}
