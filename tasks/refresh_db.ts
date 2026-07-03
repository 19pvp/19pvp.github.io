import config from '../config.json' with { type: 'json' }
import { openDBC } from '../dbc.ts'
import { sqlRaw } from '../service/db.ts'

const _config = config
const worldDb = Deno.env.get('WORLD_DB') || '19pvp_world'
if (!/^[a-zA-Z0-9_]+$/.test(worldDb)) throw Error(`invalid WORLD_DB ${worldDb}`)

type GSheetData = {
  ITEM: { ID: string }[]
}

const gsheetResponse = await fetch('https://gsheet.devazuka.com/1F1Re3VLtPuF5fXZ1wV79CpogaSgP-fS9r9dm3_aRoP0')
if (!gsheetResponse.ok || !gsheetResponse.headers.get('content-type')?.includes('application/json')) {
  const body = await gsheetResponse.text()
  throw Error(`invalid gsheet response ${gsheetResponse.status}: ${body.slice(0, 120)}`)
}
const gsheetData = await gsheetResponse.json() as GSheetData

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

const lua = `-- Generated by tasks/refresh_db.ts

random_enchant_db = {
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
}
`

await Deno.writeTextFile('core_scripts/random-enchant-db.lua', lua)
console.log(
  `wrote ${randomEnchantItemIds.size} items, ${usedSuffixOptions.size} suffix options and ${usedPropertyOptions.size} property options`,
)
