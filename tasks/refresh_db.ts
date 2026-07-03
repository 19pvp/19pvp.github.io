import config from '../config.json' with { type: 'json' }
import { openDBC } from '../dbc.ts'
import { sqlRaw } from '../service/db.ts'

const _config = config

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
  chance: number | null
}

const itemEnchantRows = await sqlRaw(
  `
SELECT
  item.entry item,
  item.RandomSuffix randomSuffix,
  item.RandomProperty randomProperty,
  suffix.ench suffixId,
  suffix.chance chance
FROM acore_world.item_template item
LEFT JOIN acore_world.item_enchantment_template suffix
  ON suffix.entry = item.RandomSuffix
WHERE item.entry IN (${itemIds.map(() => '?').join(', ')})
ORDER BY item.entry, suffix.chance DESC, suffix.ench
  `,
  itemIds,
) as ItemEnchantRow[]

type SuffixOption = {
  id: number
  name: string
  enchants: number[]
  stats: { id: number; value: number }[]
  score: number
}

const luaString = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const luaArray = <T>(values: T[], formatter: (value: T) => string) => `{ ${values.map(formatter).join(', ')} }`

const suffixOptionsById = new Map<number, SuffixOption>()

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
  const stats = enchants.flatMap((id, index) => {
    const enchant = dbc.enchant.get(id)
    if (!enchant) return []
    return [
      { id: enchant.EffectArg_1, value: allocations[index] },
      { id: enchant.EffectArg_2, value: allocations[index] },
      { id: enchant.EffectArg_3, value: allocations[index] },
    ].filter((stat) => stat.id > 0 && stat.value > 0)
  }).sort((a, b) => a.id - b.id)
  if (stats.length === 0) continue

  const score = stats.reduce((total, stat) => total + stat.value, 0)
  const option = {
    id: suffix.ID,
    name,
    enchants,
    stats,
    score,
  }
  suffixOptionsById.set(suffix.ID, option)
}

const itemSuffixOptions = new Map<number, SuffixOption[]>()
const itemRandomSuffix = new Map<number, number>()
const itemRandomProperty = new Map<number, number>()
const randomEnchantItemIds = new Set<number>()

for (const row of itemEnchantRows) {
  itemRandomSuffix.set(row.item, row.randomSuffix)
  itemRandomProperty.set(row.item, row.randomProperty)
  if (row.randomSuffix > 0 || row.randomProperty > 0) {
    randomEnchantItemIds.add(row.item)
  }
  if (!row.suffixId) continue

  const option = suffixOptionsById.get(row.suffixId)
  if (!option) continue

  const options = itemSuffixOptions.get(row.item) ?? []
  const key = option.stats.map((stat) => stat.id).join(':')
  const duplicateIndex = options.findIndex((current) => current.stats.map((stat) => stat.id).join(':') === key)
  if (duplicateIndex === -1) {
    options.push(option)
  } else if (option.score > options[duplicateIndex].score) {
    options[duplicateIndex] = option
  }
  itemSuffixOptions.set(row.item, options)
}

for (const options of itemSuffixOptions.values()) {
  options.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
}

const usedSuffixOptions = new Map<number, SuffixOption>()
for (const options of itemSuffixOptions.values()) {
  for (const option of options) {
    usedSuffixOptions.set(option.id, option)
  }
}

const luaItem = (itemId: number) => {
  const suffixes = itemSuffixOptions.get(itemId) ?? []
  return `    [${itemId}] = { random_suffix = ${itemRandomSuffix.get(itemId) ?? 0}, random_property = ${
    itemRandomProperty.get(itemId) ?? 0
  }, suffixes = ${luaArray(suffixes, (option) => String(option.id))} },`
}

const luaSuffixOption = (option: SuffixOption) =>
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
    .map(luaSuffixOption)
    .join('\n')
}
  },
}
`

await Deno.writeTextFile('core_scripts/random-enchant-db.lua', lua)
console.log(`wrote ${randomEnchantItemIds.size} items and ${usedSuffixOptions.size} suffix options`)
