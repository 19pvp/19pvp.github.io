import launcherPatch from '../launcher/patch.json' with { type: 'json' }
import { openDBC } from '../dbc.ts'
import { worldserver } from '../service/db.ts'
import { env } from '../service/env.ts'
import { loadStormLib } from '../launcher/stormlib.ts'
import { blackenCorners, decodeBlp, encodePng, type RGBAImage, stitchImages, trimImage } from './blp.ts'
import {
  buildItemEntry,
  buildSpellEntry,
  highestRankSpellIds,
  type IconContext,
  type ItemSheetRow,
  type ItemTemplateRow,
  mergeStartingSpells,
  parseItemCustom,
  patchById,
  type SpellPatch,
  startingSpellsFromRows,
  startingSpellsFromSkillLineAbilities,
} from './db_data.ts'

type GSheetData = { ITEM?: ItemSheetRow[] }

type ItemTemplateDbRow = ItemTemplateRow & {
  entry: number
  name: string
}

const sheetId = Deno.env.get('SHEET_ID') || '1F1Re3VLtPuF5fXZ1wV79CpogaSgP-fS9r9dm3_aRoP0'
const outputPath = 'web/db.json'
const iconCacheDirectory = '.cache/db-icons'

const suffixWeightByItemId: Record<number, number> = {
  31270: 3333,
  51964: 1000,
  51968: 1000,
  51978: 1000,
  51994: 1300,
}

const asNumber = (value: unknown) => Number(value)
const uniquePositiveIds = (rows: ItemSheetRow[]) => [
  ...new Set(
    rows.map((row) => asNumber(row.ID)).filter((id) => Number.isInteger(id) && id > 1),
  ),
]

type RandomEnchantItem = { randomProperty: number; randomSuffix: number; properties?: number[] }
type RandomEnchantOption = {
  name: string
  stats: { id: number; value: number }[]
}

const parseLuaNumberList = (value: string) => [...value.matchAll(/\d+/g)].map((match) => Number(match[0]))

const parseRandomEnchantLua = async () => {
  const customData = await Deno.readTextFile('core_scripts/custom-data.lua')
  const npcScript = await Deno.readTextFile('core_scripts/random-enchant-npc.lua')
  const items = new Map<number, RandomEnchantItem>()
  const properties = new Map<number, RandomEnchantOption>()
  const suffixes = new Map<number, RandomEnchantOption>()
  const itemsSection = customData.match(/items\s*=\s*\{([\s\S]*?)\n\s*\},\s*property_options/)?.[1] ?? ''
  for (const line of itemsSection.split(/\r?\n/)) {
    const match = line.match(/^\s*\[(\d+)\]\s*=\s*\{(.*)\},?\s*$/)
    if (!match) continue
    const body = match[2]
    const propertyList = body.match(/properties\s*=\s*\{([^}]*)\}/)?.[1]
    items.set(Number(match[1]), {
      randomSuffix: Number(body.match(/random_suffix\s*=\s*(\d+)/)?.[1] ?? 0),
      randomProperty: Number(body.match(/random_property\s*=\s*(\d+)/)?.[1] ?? 0),
      properties: propertyList === undefined ? undefined : parseLuaNumberList(propertyList),
    })
  }
  const propertySection = customData.match(/property_options\s*=\s*\{([\s\S]*?)\n\s*\},\s*\n\s*\},/)?.[1] ?? ''
  for (const line of propertySection.split(/\r?\n/)) {
    const match = line.match(/^\s*\[(\d+)\]\s*=\s*\{(.*)\},?\s*$/)
    if (!match) continue
    const body = match[2]
    const name = body.match(/name\s*=\s*"([^"]*)"/)?.[1]
    if (!name) continue
    properties.set(Number(match[1]), {
      name,
      stats: [...body.matchAll(/\{\s*id\s*=\s*(\d+)\s*,\s*value\s*=\s*(\d+)/g)].map((match) => ({
        id: Number(match[1]),
        value: Number(match[2]),
      })),
    })
  }
  const suffixSection = npcScript.match(/local suffix_options\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  for (const line of suffixSection.split(/\r?\n/)) {
    const match = line.match(/^\s*\[(\d+)\]\s*=\s*\{\s*id\s*=\s*\d+\s*,\s*name\s*=\s*"([^"]*)"/)
    if (!match) continue
    suffixes.set(Number(match[1]), { name: match[2], stats: [] })
  }
  return { items, properties, suffixes }
}

const fetchSheet = async (): Promise<GSheetData> => {
  const refresh = await fetch(`https://gsheet.devazuka.com/refresh/${sheetId}/ITEM`)
  if (!refresh.ok) throw Error(`could not refresh ITEM sheet: ${refresh.status}`)

  const response = await fetch(`https://gsheet.devazuka.com/${sheetId}`)
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    const body = await response.text()
    throw Error(`invalid gsheet response ${response.status}: ${body.slice(0, 120)}`)
  }
  return await response.json() as GSheetData
}

const itemRows = async (ids: number[], table: 'item_template' | 'acore_world.item_template') => {
  if (ids.length === 0) return []
  return await worldserver.raw.sql`
SELECT
  entry,
  name,
  description,
  class classId,
  subclass subclassId,
  displayid displayId,
  Quality quality,
  Flags flags,
  InventoryType inventoryType,
  ItemLevel itemLevel,
  RequiredLevel requiredLevel,
  stat_type1 statType1, stat_value1 statValue1,
  stat_type2 statType2, stat_value2 statValue2,
  stat_type3 statType3, stat_value3 statValue3,
  stat_type4 statType4, stat_value4 statValue4,
  stat_type5 statType5, stat_value5 statValue5,
  stat_type6 statType6, stat_value6 statValue6,
  stat_type7 statType7, stat_value7 statValue7,
  stat_type8 statType8, stat_value8 statValue8,
  stat_type9 statType9, stat_value9 statValue9,
  stat_type10 statType10, stat_value10 statValue10,
  dmg_min1 damageMin1, dmg_max1 damageMax1, dmg_type1 damageType1,
  dmg_min2 damageMin2, dmg_max2 damageMax2, dmg_type2 damageType2,
  armor,
  holy_res holyRes, fire_res fireRes, nature_res natureRes,
  frost_res frostRes, shadow_res shadowRes, arcane_res arcaneRes,
  delay,
  RangedModRange rangedModRange,
  spellid_1 spellId1, spelltrigger_1 spellTrigger1, spellcharges_1 spellCharges1,
  spellppmRate_1 spellPpmRate1, spellcooldown_1 spellCooldown1,
  spellcategory_1 spellCategory1, spellcategorycooldown_1 spellCategoryCooldown1,
  spellid_2 spellId2, spelltrigger_2 spellTrigger2, spellcharges_2 spellCharges2,
  spellppmRate_2 spellPpmRate2, spellcooldown_2 spellCooldown2,
  spellcategory_2 spellCategory2, spellcategorycooldown_2 spellCategoryCooldown2,
  spellid_3 spellId3, spelltrigger_3 spellTrigger3, spellcharges_3 spellCharges3,
  spellppmRate_3 spellPpmRate3, spellcooldown_3 spellCooldown3,
  spellcategory_3 spellCategory3, spellcategorycooldown_3 spellCategoryCooldown3,
  spellid_4 spellId4, spelltrigger_4 spellTrigger4, spellcharges_4 spellCharges4,
  spellppmRate_4 spellPpmRate4, spellcooldown_4 spellCooldown4,
  spellcategory_4 spellCategory4, spellcategorycooldown_4 spellCategoryCooldown4,
  spellid_5 spellId5, spelltrigger_5 spellTrigger5, spellcharges_5 spellCharges5,
  spellppmRate_5 spellPpmRate5, spellcooldown_5 spellCooldown5,
  spellcategory_5 spellCategory5, spellcategorycooldown_5 spellCategoryCooldown5,
  Material material, sheath
FROM ${table}
WHERE entry IN (${ids.join(', ')})
ORDER BY entry
  ` as ItemTemplateDbRow[]
}

const spellPatchRows = (launcherPatch as { rows?: SpellPatch[] }[])
  .flatMap((patch) => patch.rows ?? [])

const clientDirectory = async () => {
  try {
    await Deno.stat(env.CLIENT_DIR)
    return env.CLIENT_DIR
  } catch {
    return `${import.meta.dirname}/../launcher/client`
  }
}

const extractIcons = async (iconNames: readonly string[]) => {
  await Deno.mkdir(iconCacheDirectory, { recursive: true })
  const blpByIcon = new Map<string, Uint8Array>()
  const missingIconNames: string[] = []
  for (const iconName of iconNames) {
    const cachePath = `${iconCacheDirectory}/${iconName}.blp`
    try {
      blpByIcon.set(iconName, await Deno.readFile(cachePath))
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
      missingIconNames.push(iconName)
    }
  }
  console.log(
    missingIconNames.length
      ? `using ${blpByIcon.size} cached client BLPs; extracting ${missingIconNames.length}`
      : `using ${blpByIcon.size} cached client BLPs`,
  )

  if (missingIconNames.length) {
    const client = await clientDirectory()
    const archivePaths = [
      `${client}/Data/patch-S.mpq`,
      `${client}/Data/enUS/patch-enUS-3.MPQ`,
      `${client}/Data/enUS/patch-enUS-2.MPQ`,
      `${client}/Data/enUS/patch-enUS.MPQ`,
      `${client}/Data/enUS/locale-enUS.MPQ`,
      `${client}/Data/enUS/lichking-locale-enUS.MPQ`,
      `${client}/Data/enUS/expansion-locale-enUS.MPQ`,
      `${client}/Data/enUS/base-enUS.MPQ`,
      `${client}/Data/patch-3.MPQ`,
      `${client}/Data/patch-2.MPQ`,
      `${client}/Data/patch.MPQ`,
      `${client}/Data/lichking.MPQ`,
      `${client}/Data/expansion.MPQ`,
      `${client}/Data/common-2.MPQ`,
      `${client}/Data/common.MPQ`,
    ]
    const storm = await loadStormLib()
    const remaining = new Set(missingIconNames)
    let openedArchives = 0
    for (const archivePath of archivePaths) {
      let archive
      try {
        archive = await storm.open(archivePath)
        openedArchives++
        for (const iconName of remaining) {
          const archiveName = `Interface\\Icons\\${iconName}.blp`
          let bytes: Uint8Array | undefined
          try {
            const file = archive.getFile(archiveName)
            try {
              const contents = new Uint8Array(file.size)
              file.read(contents)
              bytes = contents
            } finally {
              file.close()
            }
          } catch {
            continue
          }
          blpByIcon.set(iconName, bytes)
          await Deno.writeFile(`${iconCacheDirectory}/${iconName}.blp`, bytes)
          remaining.delete(iconName)
        }
      } catch {
        // The launcher can run with a partial client installation.
      } finally {
        await archive?.close().catch(() => {})
      }
    }
    if (openedArchives === 0) throw Error(`no client MPQ archives found under ${client}`)
    if (remaining.size) {
      throw Error(`could not find client icons: ${[...remaining].join(', ')}`)
    }
  }

  const imageByIcon = new Map<string, RGBAImage>()
  for (const [iconName, blp] of blpByIcon) {
    // NOTE: client BLP headers are 64x64; a 3px crop produces the requested 58px tiles.
    const image = blackenCorners(trimImage(decodeBlp(blp), 3))
    imageByIcon.set(iconName, image)
  }
  return imageByIcon
}

const sheet = await fetchSheet()
const sheetRows = sheet.ITEM ?? []
const itemIds = uniquePositiveIds(sheetRows)
const itemsById = new Map(sheetRows.map((row) => [asNumber(row.ID), parseItemCustom(row)]))

const dbcItem = openDBC('Item')
const dbcSpell = openDBC('Spell')
const itemDisplay = openDBC('ItemDisplayInfo')
const spellIcons = openDBC('SpellIcon')
const dbcEnchantment = openDBC('SpellItemEnchantment')
const dbcRandomSuffix = openDBC('ItemRandomSuffix')
const castTimes = openDBC('SpellCastTimes')
const durations = openDBC('SpellDuration')
const radii = openDBC('SpellRadius')
const ranges = openDBC('SpellRange')
const startingSpellRows = await worldserver.raw.sql`
SELECT racemask, classmask, spell FROM playercreateinfo_spell_custom
`
const startingSkillRows = await worldserver.raw.sql`
SELECT racemask, classmask, skill FROM playercreateinfo_skills
`
const deathKnightClassMask = 1 << (6 - 1)
const startingSpells = mergeStartingSpells(
  startingSpellsFromRows(startingSpellRows),
  startingSpellsFromSkillLineAbilities(openDBC('SkillLineAbility').values(), startingSkillRows),
).filter((spell) => spell.classMask !== deathKnightClassMask)
const patches = patchById(spellPatchRows)
const spellTextContext = {
  spellById: dbcSpell,
  durationById: durations,
  radiusById: radii,
  rangeById: ranges,
  overrideById: patches,
}
const iconContext: IconContext = { itemDisplayById: itemDisplay, spellIconById: spellIcons }
const templates = await itemRows(itemIds, 'item_template')
const originalTemplates = await itemRows(itemIds, 'acore_world.item_template')
const templatesById = new Map(templates.map((row) => [asNumber(row.entry), row]))
const originalTemplatesById = new Map(originalTemplates.map((row) => [asNumber(row.entry), row]))
const randomEnchantData = await parseRandomEnchantLua()

const dataset: Record<string, unknown> = {}
const missingItems: number[] = []
const itemSpellIds = new Set<number>()
const enchantIds = new Set<number>()
const randomEnchantIds = new Set<number>()
const suffixEnchantIds = new Set<number>()
const suffixStats = (suffixId: number) => {
  const suffix = dbcRandomSuffix.get(suffixId) as Record<string, unknown> | undefined
  const stats: Record<string, number> = {}
  for (let index = 1; index <= 5; index++) {
    const enchantId = asNumber(suffix?.[`Enchantment_${index}`])
    const value = asNumber(suffix?.[`AllocationPct_${index}`])
    const enchant = dbcEnchantment.get(enchantId) as Record<string, unknown> | undefined
    if (!enchant || value <= 0) continue
    for (let effectIndex = 1; effectIndex <= 3; effectIndex++) {
      const stat = asNumber(enchant[`EffectArg_${effectIndex}`])
      if (stat > 0) stats[`stat_${stat}`] = (stats[`stat_${stat}`] ?? 0) + value
    }
  }
  return stats
}
const spellEnchantIds = (row: ItemTemplateRow) =>
  Array.from({ length: 5 }, (_, index) => {
    const spell = dbcSpell.get(asNumber(row[`spellId${index + 1}`])) as Record<string, unknown> | undefined
    if (!spell) return 0
    for (const effectIndex of [1, 2, 3]) {
      if (asNumber(spell[`Effect_${effectIndex}`]) === 53) return asNumber(spell[`EffectMiscValue_${effectIndex}`])
    }
    return 0
  }).filter((id): id is number => id > 0)
const enchantData = (row: ItemTemplateRow) => {
  for (const id of spellEnchantIds(row)) enchantIds.add(id)
  const info = randomEnchantData.items.get(asNumber(row.entry))
  const random = new Set(info?.properties ?? [])
  const suffix = info && info.randomSuffix > 0 && info.properties === undefined
    ? new Set(randomEnchantData.suffixes.keys())
    : new Set<number>()
  for (const id of random) randomEnchantIds.add(id)
  for (const id of suffix) suffixEnchantIds.add(id)
  return {
    ...(random.size ? { enchant: [...random] } : {}),
    ...(suffix.size ? { suffix: suffixWeightByItemId[asNumber(row.entry)] ?? 1000 } : {}),
  }
}
const flattenFields = (entry: ReturnType<typeof buildItemEntry>, custom: Record<string, unknown>) => {
  if (Object.keys(custom).length === 0) return entry
  const result = { ...entry }
  delete result.custom
  delete result.description
  if (custom.spells !== undefined) delete result.spells
  if (result.spells && Object.keys(result.spells).length === 0) delete result.spells
  if (Object.keys(custom).some((key) => /^stat_\d+$/.test(key))) {
    for (const key of Object.keys(result)) {
      if (/^stat_\d+$/.test(key)) delete result[key]
    }
  }
  return { ...result, ...custom, custom: true }
}
const includeCurrentStats = (
  entry: ReturnType<typeof buildItemEntry>,
  custom: Record<string, unknown>,
) => {
  if (!Object.keys(custom).some((key) => /^stat_\d+$/.test(key))) return custom
  return {
    ...custom,
    ...Object.fromEntries(
      Object.entries(entry).filter(([key]) => /^stat_\d+$/.test(key)),
    ),
  }
}
const normalizeUse = (
  entry: ReturnType<typeof buildItemEntry>,
  custom: Record<string, unknown>,
) => {
  const use = asNumber(custom.use)
  if (!use) return custom
  const spells = {
    ...(entry.spells && typeof entry.spells === 'object' && !Array.isArray(entry.spells) ? entry.spells : {}),
    ...(custom.spells && typeof custom.spells === 'object' && !Array.isArray(custom.spells) ? custom.spells : {}),
  } as Record<string, Record<string, unknown>>
  spells[String(use)] = {
    ...spells[String(use)],
    trigger: 'use',
    ...(typeof custom.cooldown === 'number' ? { cooldown: custom.cooldown } : {}),
  }
  const result: Record<string, unknown> = { ...custom, spells }
  delete result.use
  delete result.cooldown
  return result
}
const hasCustomData = (fields: Record<string, unknown>) =>
  Object.keys(fields).some((key) => /^stat_\d+$/.test(key) || ['armor', 'spells'].includes(key))
for (const id of itemIds) {
  const row = originalTemplatesById.get(id)
  if (!row) {
    missingItems.push(id)
    continue
  }
  if (asNumber(row.classId) === 3 || asNumber(row.classId) === 16) continue
  const currentRow = templatesById.get(id) ?? row
  const currentEntry = buildItemEntry(dbcItem.get(id), currentRow, {}, iconContext, dbcSpell)
  // The pristine table contains the values before the bracket normalization in
  // item_template. Such an item is presented as a created item: current values
  // are its base values and no database diff is exposed as custom data.
  const created = asNumber(row.requiredLevel) > 19 || asNumber(row.itemLevel) > 45
  const baseEntry = created ? undefined : buildItemEntry(dbcItem.get(id), row, {}, iconContext, dbcSpell)
  const sheetCustom = Object.fromEntries(
    Object.entries(itemsById.get(id) ?? {}).filter(([key, value]) =>
      created || JSON.stringify(value) !== JSON.stringify(baseEntry?.[key])
    ),
  )
  const entry = created
    ? (() => {
      const spells =
        currentEntry.spells && typeof currentEntry.spells === 'object' && !Array.isArray(currentEntry.spells)
          ? { ...(currentEntry.spells as Record<string, Record<string, unknown>>) }
          : {}
      const use = typeof sheetCustom.use === 'number' ? sheetCustom.use : 0
      if (use) {
        spells[String(use)] = {
          ...spells[String(use)],
          trigger: 'use',
          ...(typeof sheetCustom.cooldown === 'number' ? { cooldown: sheetCustom.cooldown } : {}),
        }
      }
      const fields = Object.fromEntries(
        Object.entries(sheetCustom).filter(([key]) => key !== 'use' && key !== 'cooldown'),
      )
      const createdEntry = {
        ...currentEntry,
        ...fields,
        spells: Object.keys(spells).length ? spells : undefined,
        created: true,
      }
      const custom = { ...fields, ...(use ? { spells } : {}) }
      return hasCustomData(custom)
        ? flattenFields(createdEntry, includeCurrentStats(createdEntry, custom))
        : createdEntry
    })()
    : (() => {
      const dbCustom = Object.fromEntries(
        Object.entries(currentEntry).filter(([key, value]) =>
          !['id', 'kind', 'icon'].includes(key) && JSON.stringify(value) !== JSON.stringify(baseEntry?.[key])
        ),
      )
      const custom = normalizeUse(currentEntry, { ...dbCustom, ...sheetCustom })
      if (Object.keys(custom).length === 0) return baseEntry!
      if (!hasCustomData(custom)) {
        const metadata = Object.fromEntries(
          Object.entries(custom).filter(([key]) => key !== 'use' && key !== 'cooldown'),
        )
        return { ...currentEntry, ...metadata }
      }
      const source = currentEntry.spells
        ? currentEntry
        : baseEntry?.spells
        ? { ...currentEntry, spells: baseEntry.spells }
        : currentEntry
      return flattenFields(source, includeCurrentStats(source, custom))
    })()
  dataset[`item:${id}`] = Object.assign(entry, enchantData(row))
  const effective = (entry as Record<string, unknown>).custom as Record<string, unknown> | undefined
  for (const spells of [entry.spells, currentEntry.spells, effective?.spells]) {
    if (spells && typeof spells === 'object' && !Array.isArray(spells)) {
      for (const spellId of Object.keys(spells)) {
        const id = Number(spellId)
        if (Number.isInteger(id) && id > 0) itemSpellIds.add(id)
      }
    }
  }
}

const missingSpells: number[] = []
const startingSpellById = new Map(startingSpells.map((spell) => [spell.id, spell]))
const startingSpellIds = highestRankSpellIds(startingSpells.map((spell) => spell.id), dbcSpell)
const spellIds = [...new Set([...startingSpellIds, ...itemSpellIds])].sort((a, b) => a - b)
const selectedSpellIds = spellIds
const classMaskByName = new Map<string, number>()
const raceMaskByName = new Map<string, number>()
for (const [id, startingSpell] of startingSpellById) {
  const name = String(dbcSpell.get(id)?.Name_Lang_enUS ?? id)
  classMaskByName.set(name, (classMaskByName.get(name) ?? 0) | startingSpell.classMask)
  raceMaskByName.set(name, (raceMaskByName.get(name) ?? 0) | startingSpell.raceMask)
}
for (const id of selectedSpellIds) {
  const spell = dbcSpell.get(id)
  if (!spell) {
    missingSpells.push(id)
    continue
  }
  const name = String(spell.Name_Lang_enUS ?? id)
  const entry = buildSpellEntry(
    spell,
    startingSpellById.get(id)?.classMask ?? classMaskByName.get(name) ?? 0,
    patches.get(id),
    castTimes,
    spellTextContext,
    iconContext,
    startingSpellById.get(id)?.raceMask ?? raceMaskByName.get(name) ?? 0,
  )
  const custom = entry.custom && typeof entry.custom === 'object' ? entry.custom as Record<string, unknown> : {}
  if (
    ![entry.description, entry.auraDescription, custom.description, custom.auraDescription].some((value) => {
      return typeof value === 'string' && value.trim().length > 0
    })
  ) continue
  dataset[`spell:${id}`] = entry
}

for (const optionId of randomEnchantIds) {
  const option = randomEnchantData.properties.get(optionId)
  if (!option) continue
  dataset[`enchant-random:${optionId}`] = {
    name: option.name,
    ...Object.fromEntries(option.stats.map((stat) => [`stat_${stat.id}`, stat.value])),
  }
}
for (const optionId of suffixEnchantIds) {
  const option = randomEnchantData.suffixes.get(optionId)
  if (!option) continue
  const suffix = dbcRandomSuffix.get(optionId)
  dataset[`enchant-suffix:${optionId}`] = {
    name: suffix?.Name_Lang_enUS || option.name,
    ...suffixStats(optionId),
  }
}
for (const enchantId of enchantIds) {
  const enchant = dbcEnchantment.get(enchantId)
  if (enchant) dataset[`enchant:${enchantId}`] = enchant.Name_Lang_enUS
}
for (const value of Object.values(dataset)) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    delete (value as Record<string, unknown>).id
    delete (value as Record<string, unknown>).kind
  }
}

const iconNames = [
  ...new Set(
    Object.values(dataset).flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const icon = (entry as Record<string, unknown>).icon
      return typeof icon === 'string' && icon.length > 0 ? [icon] : []
    }),
  ),
].sort()
const iconDirectory = 'web/assets/icon'
await Deno.mkdir(iconDirectory, { recursive: true })
const imageByIcon = await extractIcons(iconNames)
const iconImages = iconNames.map((iconName) => {
  const image = imageByIcon.get(iconName)
  if (!image) throw Error(`missing decoded icon ${iconName}`)
  return image
})
const iconColumns = 35
const iconSprite = stitchImages(iconImages, iconColumns)
const iconSpritePng = await encodePng(iconSprite)
await Deno.writeFile('web/assets/icons.png', iconSpritePng)

const iconIndexByName = new Map(iconNames.map((iconName, index) => [iconName, index]))
const replaceIconNames = (value: Record<string, unknown>) => {
  if (typeof value.icon === 'string') {
    const index = iconIndexByName.get(value.icon)
    if (index === undefined) throw Error(`missing icon index for ${value.icon}`)
    value.icon = index
  }
}
for (const entry of Object.values(dataset)) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    replaceIconNames(entry as Record<string, unknown>)
  }
}

for (const iconName of iconNames) {
  await Deno.remove(`${iconCacheDirectory}/${iconName}.png`).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  })
  await Deno.remove(`${iconDirectory}/${iconName}.png`).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  })
  await Deno.remove(`${iconDirectory}/${iconName}.jpg`).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  })
}

await Deno.writeTextFile(outputPath, JSON.stringify(dataset, null, 2) + '\n')
console.log(
  `wrote ${
    Object.keys(dataset).length
  } entries and ${iconNames.length} icons to ${outputPath}, web/assets/icons.avif and web/assets/icons.jpg`,
)
if (missingItems.length) console.warn(`missing item_template rows: ${missingItems.join(', ')}`)
if (missingSpells.length) console.warn(`missing Spell.dbc rows: ${missingSpells.join(', ')}`)
