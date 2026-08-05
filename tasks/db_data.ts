type DBCRow = Record<string, unknown>
type DBCMap = { get: (id: number) => DBCRow | undefined }
type SpellOverrideMap = { get: (id: number) => SpellPatch | undefined }

export type ItemSheetRow = {
  CLASSES?: string
  ID?: string
  LINK?: string
  NAME?: string
  PROPS?: string
  SOURCE?: string
}

export type ItemTemplateRow = Record<string, unknown>

export type DbEntry = {
  id: number
  kind: 'item' | 'spell'
  [key: string]: unknown
}

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

const toNumber = (value: unknown): number => Number(value) || 0

const parseDurationMs = (value: string): number | undefined => {
  const match = value.trim().match(
    /^(\d+)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/,
  )
  if (!match) return undefined

  const amount = Number(match[1])
  if (!Number.isInteger(amount) || amount < 0) return undefined
  if (match[2] === 'ms') return amount
  if (/^(s|sec|secs|second|seconds)$/.test(match[2])) return amount * 1000
  if (/^(m|min|mins|minute|minutes)$/.test(match[2])) return amount * 60 * 1000
  return amount * 60 * 60 * 1000
}

export const parseItemCustom = (row: ItemSheetRow): Record<string, unknown> => {
  const custom: Record<string, unknown> = {}
  let hasProps = false
  for (const line of (row.PROPS ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (!value) continue

    if (key === 'quality') {
      const quality = itemQualityByName[value.toLowerCase() as keyof typeof itemQualityByName]
      if (quality) {
        custom.quality = quality
        hasProps = true
      }
      continue
    }
    if (key === 'use') {
      const spellId = Number(value)
      if (Number.isInteger(spellId) && spellId > 0) {
        custom.use = spellId
        hasProps = true
      }
      continue
    }
    if (key === 'cd') {
      const cooldown = parseDurationMs(value)
      if (cooldown !== undefined) {
        custom.cooldown = cooldown
        hasProps = true
      }
      continue
    }
    if (key === 'armor') {
      const armor = Number(value)
      if (Number.isInteger(armor) && armor >= 0) {
        custom.armor = armor
        hasProps = true
      }
      continue
    }

    const statType = itemStatTypeByKey[key as keyof typeof itemStatTypeByKey]
    if (statType) {
      const statValue = Number(value)
      if (Number.isInteger(statValue) && statValue > 0) {
        const statKey = `stat_${statType}`
        custom[statKey] = (Number(custom[statKey]) || 0) + statValue
        hasProps = true
      }
    }
  }

  // NAME is an item override only when the row also has PROPS; this mirrors
  // tasks/refresh_db.ts, which does not update a name-only sheet row.
  if (hasProps && row.NAME?.trim()) custom.name = row.NAME.trim()
  return custom
}

const compactValue = (value: unknown): unknown => {
  if (value === undefined || value === 0 || value === '') return undefined
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  if (value && typeof value === 'object') {
    const object = Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, compactValue(item)])
        .filter(([, item]) => item !== undefined),
    )
    return Object.keys(object).length ? object : undefined
  }
  return value
}

const compact = <T extends Record<string, unknown>>(value: T): T => compactValue(value) as T

export type SpellTextContext = {
  spellById: DBCMap
  durationById: DBCMap
  radiusById?: DBCMap
  rangeById?: DBCMap
  overrideById?: SpellOverrideMap
}

export type IconContext = {
  itemDisplayById: DBCMap
  spellIconById: DBCMap
}

const iconName = (value: unknown) => {
  const name = String(value || '').split(/[\\/]/).at(-1) || ''
  return name.replace(/\.[^.]+$/, '') || undefined
}

const EFFECT_VALUE = /\$(?:(\d+))?([mMsSoO])([1-3])/g
const EFFECT_FORMULA = /\$([/*+-])(\d+(?:\.\d+)?);(?:(\d+))?([mMsSoO])([1-3])/g
const BRACED_EXPRESSION = /\$\{([^}]+)\}/g
const BRACED_ARITHMETIC = /\$\{([\d\s.+\-*/()]+)\}/g
const PLURAL_CHOICE = /\$l([^:;]+):([^;]+);/g
const GENDER_CHOICE = /\$g([^:;]+):([^;]+);/g
const GLYPH_CHOICE = /\$\?s\d+\[([^\]]*)\]\[([^\]]*)\]/g
const TOTAL_VALUE = /\$<total>/g
const MIN_VALUE = /\$<min>/g
const MAX_VALUE = /\$<max>/g
const FIXED_VALUE = /\$<(?:mult|glyph)>/g
const PERCENT_VALUE = /\$<percent>/g
const DURATION = /\$(?:(\d+))?d/g
const PROC_CHANCE = /\$(?:(\d+))?h/g
const STACK_COUNT = /\$(?:(\d+))?n/g
const AURA_PERIOD = /\$(?:(\d+))?t([1-3])/g
const COMBO_POINT_VALUE = /\$(?:(\d+))?b([1-3])/g
const CHAIN_TARGETS = /\$(?:(\d+))?x([1-3])/g
const RADIUS = /\$(?:(\d+))?a([1-3])/g
const RANGE = /\$(?:(\d+))?r([1-3])/g
const SPECIAL_VALUE = /\$(?:(\d+))?([qi])([1-3])?/g

const asNumber = (value: unknown) => Number(value) || 0

const formatNumber = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

const getEffectValue = (spell: DBCRow, kind: string, effectIndex: string) => {
  const base = asNumber(spell[`EffectBasePoints_${effectIndex}`])
  const dieSides = asNumber(spell[`EffectDieSides_${effectIndex}`])
  const value = base === 0 && dieSides === 0 ? 0 : base + 1

  switch (kind) {
    case 'm':
    case 's':
      return value
    case 'M':
      return base + Math.max(1, dieSides)
    case 'S':
      return Math.abs(value)
    default:
      return 0
  }
}

const calculate = (left: number, operator: string, right: number) => {
  switch (operator) {
    case '/':
      return right === 0 ? left : left / right
    case '*':
      return left * right
    case '+':
      return left + right
    case '-':
      return left - right
    default:
      return left
  }
}

const getReferencedSpell = (spell: DBCRow, spellId: string | undefined, context: SpellTextContext) => {
  if (!spellId) return spell
  const referencedSpell = context.spellById.get(Number(spellId))
  if (!referencedSpell) return spell
  const override = context.overrideById?.get(Number(spellId))
  return override ? { ...referencedSpell, ...override } : referencedSpell
}

const formatDurationValue = (milliseconds: number) => {
  if (milliseconds === -1) return 'until cancelled'
  if (milliseconds < 1000) return `${formatNumber(milliseconds)} ms`
  const seconds = Math.max(0, milliseconds / 1000)
  if (seconds < 60) return `${formatNumber(seconds)} sec`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds - minutes * 60)
  if (remainder === 60) return `${minutes + 1} min`
  return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`
}

const getDurationMilliseconds = (spell: DBCRow, spellId: string | undefined, context: SpellTextContext) => {
  const source = getReferencedSpell(spell, spellId, context)
  const duration = context.durationById.get(asNumber(source.DurationIndex))
  return duration ? asNumber(duration.Duration) : undefined
}

const formatDuration = (spell: DBCRow, spellId: string | undefined, context: SpellTextContext) => {
  const milliseconds = getDurationMilliseconds(spell, spellId, context)
  return milliseconds === undefined ? `$${spellId || ''}d` : formatDurationValue(milliseconds)
}

const getPeriodicValue = (spell: DBCRow, effectIndex: string, context: SpellTextContext) => {
  const period = asNumber(spell[`EffectAuraPeriod_${effectIndex}`])
  const duration = getDurationMilliseconds(spell, undefined, context)
  if (period <= 0 || duration === undefined || duration <= 0) return 0
  return getEffectValue(spell, 's', effectIndex) * Math.floor(duration / period)
}

const getTotalPeriodicValue = (spell: DBCRow, context: SpellTextContext) =>
  [1, 2, 3].reduce((total, index) => total + getPeriodicValue(spell, String(index), context), 0)

const getEffectRange = (spell: DBCRow) => {
  for (let index = 1; index <= 3; index++) {
    if (toNumber(spell[`Effect_${index}`]) === 0) continue
    return {
      min: getEffectValue(spell, 'm', String(index)),
      max: getEffectValue(spell, 'M', String(index)),
    }
  }
  return { min: 0, max: 0 }
}

const getExpressionDuration = (spell: DBCRow, expression: string, context: SpellTextContext) => {
  const referencedId = expression.match(/\$(\d+)[mMsSoO][1-3]/)?.[1]
  const source = getReferencedSpell(spell, referencedId, context)
  const duration = getDurationMilliseconds(source, undefined, context)
  if (duration === undefined) return 1
  for (let index = 1; index <= 3; index++) {
    const period = asNumber(source[`EffectAuraPeriod_${index}`])
    if (period > 0) return Math.max(1, Math.floor(duration / period))
  }
  return duration / 1000
}

const getValue = (spell: DBCRow, kind: string, effectIndex: string, context: SpellTextContext) => {
  if (kind.toLowerCase() === 'o') return getPeriodicValue(spell, effectIndex, context)
  return getEffectValue(spell, kind, effectIndex)
}

const formatExpression = (spell: DBCRow, expression: string, context: SpellTextContext) => {
  const jsExpression = expression
    .replace(FIXED_VALUE, '1')
    .replace(PERCENT_VALUE, '100')
    .replace(/\$<duration>/g, () => String(getExpressionDuration(spell, expression, context)))
    .replace(/\$(?:(\d+))?([mMsSoObBx])([1-3])/g, (_, spellId, kind, effectIndex) => {
      const source = getReferencedSpell(spell, spellId, context)
      if (kind.toLowerCase() === 'b') return String(asNumber(source[`EffectPointsPerCombo_${effectIndex}`]))
      if (kind.toLowerCase() === 'x') return String(asNumber(source[`EffectChainTargets_${effectIndex}`]))
      return String(getValue(source, kind, effectIndex, context))
    })
    .replace(/\$([A-Za-z]+)/g, (_, name) => name === 'AP' ? '200' : '100')
    .replace(/\s*(?:ms|secs?|seconds?)\b/gi, '')

  if (!/^[\d\s.+\-*/()]+$/.test(jsExpression)) return `\${${expression}}`
  try {
    return formatNumber(Function(`return ${jsExpression}`)())
  } catch {
    return `\${${expression}}`
  }
}

export const formatSpellText = (spell: DBCRow, text: string, context: SpellTextContext) => {
  let lastEffectValue = 0
  return text
    .replace(GLYPH_CHOICE, (_match, _glyphed, unglyphed) => unglyphed)
    .replace(GENDER_CHOICE, (_match, first, _second) => first)
    .replace(FIXED_VALUE, '1')
    .replace(PERCENT_VALUE, '100')
    .replace(BRACED_EXPRESSION, (_, expression) => formatExpression(spell, expression, context))
    .replace(EFFECT_FORMULA, (_, operator, operand, spellId, kind, effectIndex) => {
      const value = formatNumber(
        calculate(
          getValue(getReferencedSpell(spell, spellId, context), kind, effectIndex, context),
          operator,
          Number(operand),
        ),
      )
      lastEffectValue = Number(value) || lastEffectValue
      return value
    })
    .replace(EFFECT_VALUE, (_, spellId, kind, effectIndex) => {
      const value = getValue(getReferencedSpell(spell, spellId, context), kind, effectIndex, context)
      lastEffectValue = value
      return formatNumber(value)
    })
    .replace(TOTAL_VALUE, () => formatNumber(getTotalPeriodicValue(spell, context)))
    .replace(MIN_VALUE, () => formatNumber(getEffectRange(spell).min))
    .replace(MAX_VALUE, () => formatNumber(getEffectRange(spell).max))
    .replace(SPECIAL_VALUE, (_, spellId, kind, effectIndex = '1') => {
      const source = getReferencedSpell(spell, spellId, context)
      return kind === 'q'
        ? formatNumber(asNumber(source[`EffectMiscValue_${effectIndex}`]))
        : formatNumber(asNumber(source.MaxTargets))
    })
    .replace(DURATION, (_, spellId) => formatDuration(spell, spellId, context))
    .replace(
      PROC_CHANCE,
      (_, spellId) => formatNumber(asNumber(getReferencedSpell(spell, spellId, context).ProcChance)),
    )
    .replace(
      STACK_COUNT,
      (_, spellId) => formatNumber(asNumber(getReferencedSpell(spell, spellId, context).ProcCharges)),
    )
    .replace(
      AURA_PERIOD,
      (_, spellId, effectIndex) =>
        formatNumber(asNumber(getReferencedSpell(spell, spellId, context)[`EffectAuraPeriod_${effectIndex}`]) / 1000),
    )
    .replace(
      COMBO_POINT_VALUE,
      (_, spellId, effectIndex) =>
        formatNumber(asNumber(getReferencedSpell(spell, spellId, context)[`EffectPointsPerCombo_${effectIndex}`])),
    )
    .replace(
      CHAIN_TARGETS,
      (_, spellId, effectIndex) =>
        formatNumber(asNumber(getReferencedSpell(spell, spellId, context)[`EffectChainTargets_${effectIndex}`])),
    )
    .replace(RADIUS, (_, spellId, effectIndex) => {
      const source = getReferencedSpell(spell, spellId, context)
      const radius = context.radiusById?.get(asNumber(source[`EffectRadiusIndex_${effectIndex}`]))
      return radius ? formatNumber(asNumber(radius.Radius)) : `$${spellId || ''}a${effectIndex}`
    })
    .replace(RANGE, (_, spellId, effectIndex) => {
      const source = getReferencedSpell(spell, spellId, context)
      const radius = context.radiusById?.get(asNumber(source[`EffectRadiusIndex_${effectIndex}`]))
      if (radius && asNumber(radius.Radius) > 0) return formatNumber(asNumber(radius.Radius))
      const range = context.rangeById?.get(asNumber(source.RangeIndex))
      return range ? formatNumber(asNumber(range.RangeMax_1)) : `$${spellId || ''}r${effectIndex}`
    })
    .replace(PLURAL_CHOICE, (_, singular, plural) => Math.abs(lastEffectValue) === 1 ? singular : plural)
    .replace(BRACED_ARITHMETIC, (_, expression) => formatExpression(spell, expression, context))
    .replace(/([.!?]) {2,}/g, '$1 ')
}

const itemDamage = (row: ItemTemplateRow) =>
  Array.from({ length: 2 }, (_, index) => {
    const min = toNumber(row[`damageMin${index + 1}`])
    const max = toNumber(row[`damageMax${index + 1}`])
    return min || max ? compact({ min, max, type: toNumber(row[`damageType${index + 1}`]) }) : undefined
  }).filter((damage): damage is NonNullable<typeof damage> => Boolean(damage))

const itemSpells = (row: ItemTemplateRow) =>
  Array.from({ length: 5 }, (_, index) => {
    const slot = index + 1
    const id = toNumber(row[`spellId${slot}`])
    return id > 0 ? id : undefined
  }).filter((spell): spell is NonNullable<typeof spell> => Boolean(spell))

const itemSpellStat = (spell: DBCRow) => {
  for (let index = 1; index <= 3; index++) {
    if (toNumber(spell[`Effect_${index}`]) !== 6) continue
    const aura = toNumber(spell[`EffectAura_${index}`])
    const misc = toNumber(spell[`EffectMiscValue_${index}`])
    const stat = aura === 13 && misc === 126
      ? 'stat_45'
      : aura === 99 && misc === 0
      ? 'stat_38'
      : aura === 189 && misc === 224
      ? 'stat_31'
      : aura === 85 && misc === 0
      ? 'stat_43'
      : undefined
    const value = stat ? getEffectValue(spell, 's', String(index)) : 0
    if (stat && value > 0) return { stat, value }
  }
  return undefined
}

const itemSpellTrigger = (trigger: number) => trigger === 1 ? 'equip' : trigger === 2 ? 'hit' : 'use'

type ItemSpellData = {
  trigger?: number
  charges?: number
  ppmRate?: number
  cooldown?: number
}

export const convertItemSpells = (
  spellIds: number[],
  spellById?: DBCMap,
  triggers?: number[],
  metadata?: ItemSpellData[],
) => {
  const stats: Record<string, number> = {}
  const spells: Record<string, Record<string, unknown>> = {}
  for (const [index, spellId] of spellIds.entries()) {
    const converted = spellById && (triggers === undefined || triggers[index] === 1)
      ? itemSpellStat(spellById.get(spellId) ?? {})
      : undefined
    if (!converted) {
      const data = metadata?.[index]
      const key = String(spellId)
      spells[key] = {
        ...spells[key],
        ...compact({
          trigger: itemSpellTrigger(data?.trigger ?? triggers?.[index] ?? 0),
          charges: data?.charges,
          ppmRate: data?.ppmRate,
          cooldown: data?.cooldown,
        }),
      }
      continue
    }
    stats[converted.stat] = (stats[converted.stat] ?? 0) + converted.value
  }
  return { stats, spells }
}

const itemStats = (row: ItemTemplateRow, spellById?: DBCMap) => {
  const stats: Record<string, number> = {}
  for (let index = 0; index < 10; index++) {
    const type = toNumber(row[`statType${index + 1}`])
    const value = toNumber(row[`statValue${index + 1}`])
    if (type > 0 && value !== 0) stats[`stat_${type}`] = (stats[`stat_${type}`] ?? 0) + value
  }
  const converted = convertItemSpells(
    itemSpells(row),
    spellById,
    Array.from({ length: 5 }, (_, index) => toNumber(row[`spellTrigger${index + 1}`])),
    Array.from({ length: 5 }, (_, index) => ({
      trigger: toNumber(row[`spellTrigger${index + 1}`]),
      charges: toNumber(row[`spellCharges${index + 1}`]),
      ppmRate: toNumber(row[`spellPpmRate${index + 1}`]),
      cooldown: toNumber(row[`spellCooldown${index + 1}`]),
    })),
  )
  for (const [stat, value] of Object.entries(converted.stats)) stats[stat] = (stats[stat] ?? 0) + value
  return { stats, spells: converted.spells }
}

export const buildItemEntry = (
  dbcItem: DBCRow | undefined,
  row: ItemTemplateRow,
  custom: Record<string, unknown>,
  icons?: IconContext,
  spellById?: DBCMap,
): DbEntry =>
  (() => {
    const stats = itemStats(row, spellById)
    const customFields = { ...custom }
    const customSpells =
      customFields.spells && typeof customFields.spells === 'object' && !Array.isArray(customFields.spells)
        ? { ...(customFields.spells as Record<string, unknown>) }
        : {}
    const use = toNumber(customFields.use)
    if (use) {
      const useSpell = customSpells[String(use)] && typeof customSpells[String(use)] === 'object'
        ? customSpells[String(use)] as Record<string, unknown>
        : {}
      customSpells[String(use)] = compact({
        ...useSpell,
        trigger: 'use',
        cooldown: customFields.cooldown,
      })
      customFields.spells = customSpells
      delete customFields.use
      delete customFields.cooldown
    }
    return compact({
      id: toNumber(row.entry),
      kind: 'item' as const,
      name: row.name,
      description: row.description,
      icon: iconName(icons?.itemDisplayById.get(toNumber(row.displayId ?? dbcItem?.DisplayInfoID))?.InventoryIcon_1),
      class: toNumber(row.classId),
      subclass: toNumber(row.subclassId),
      inventoryType: toNumber(row.inventoryType ?? dbcItem?.InventoryType),
      quality: toNumber(row.quality),
      flags: toNumber(row.flags),
      ...stats.stats,
      armor: toNumber(row.armor),
      res_holy: toNumber(row.holyRes),
      res_fire: toNumber(row.fireRes),
      res_nature: toNumber(row.natureRes),
      res_frost: toNumber(row.frostRes),
      res_shadow: toNumber(row.shadowRes),
      res_arcane: toNumber(row.arcaneRes),
      damage: itemDamage(row),
      weaponSpeed: toNumber(row.delay),
      rangedModRange: toNumber(row.rangedModRange),
      spells: stats.spells,
      custom: Object.keys(customFields).length ? customFields : undefined,
    })
  })()

export type StartingSpell = { id: number; classMask: number; raceMask: number }

export const startingSpellsFromRows = (rows: Iterable<DBCRow>): StartingSpell[] => {
  const byId = new Map<number, { classMask: number; raceMask: number }>()
  for (const row of rows) {
    const classMask = toNumber(row.classmask ?? row.ClassMask)
    const raceMask = toNumber(row.racemask ?? row.RaceMask)
    const id = toNumber(row.spell ?? row.Spell)
    if (!id) continue
    const masks = byId.get(id) ?? { classMask: 0, raceMask: 0 }
    masks.classMask |= classMask
    masks.raceMask |= raceMask
    byId.set(id, masks)
  }

  return [...byId.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, masks]) => ({ id, ...masks }))
}

export const startingSpellsFromSkillLineAbilities = (
  abilities: Iterable<DBCRow>,
  skills: Iterable<DBCRow>,
): StartingSpell[] => {
  const masksBySkill = new Map<number, { classMask: number; raceMask: number }>()
  for (const skill of skills) {
    const id = toNumber(skill.skill ?? skill.Skill)
    if (!id) continue
    const masks = masksBySkill.get(id) ?? { classMask: 0, raceMask: 0 }
    const classMask = toNumber(skill.classmask ?? skill.ClassMask)
    const raceMask = toNumber(skill.racemask ?? skill.RaceMask)
    masks.classMask |= classMask
    masks.raceMask |= raceMask
    masksBySkill.set(id, masks)
  }
  return startingSpellsFromRows(
    [...abilities].flatMap((ability) => {
      if (toNumber(ability.AcquireMethod) !== 2) return []
      const masks = masksBySkill.get(toNumber(ability.SkillLine))
      if (!masks) return []
      return [{
        spell: ability.Spell,
        classmask: toNumber(ability.ClassMask) || masks.classMask,
        racemask: toNumber(ability.RaceMask) || masks.raceMask,
      }]
    }),
  )
}

export const mergeStartingSpells = (...groups: StartingSpell[][]): StartingSpell[] => {
  const byId = new Map<number, { classMask: number; raceMask: number }>()
  for (const group of groups) {
    for (const spell of group) {
      const masks = byId.get(spell.id) ?? { classMask: 0, raceMask: 0 }
      masks.classMask |= spell.classMask
      masks.raceMask |= spell.raceMask
      byId.set(spell.id, masks)
    }
  }
  return [...byId.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, masks]) => ({ id, ...masks }))
}

export type SpellPatch = Record<string, unknown> & { ID: number }

const spellCustomFields = (
  spell: DBCRow,
  patch: SpellPatch,
  castTimes: DBCMap,
  textContext?: SpellTextContext,
) => {
  const custom: Record<string, unknown> = { dbc: { ...patch } }
  delete (custom.dbc as Record<string, unknown>).ID
  const castTimeIndex = patch.CastingTimeIndex
  const castTimeRow = castTimeIndex === undefined ? undefined : castTimes.get(toNumber(castTimeIndex))
  const castTime = castTimeRow?.Base === undefined ? undefined : toNumber(castTimeRow.Base)
  if (patch.Name_Lang_enUS !== undefined) custom.name = patch.Name_Lang_enUS
  const patchedSpell = { ...spell, ...patch }
  if (patch.Description_Lang_enUS !== undefined) {
    custom.description = textContext
      ? formatSpellText(patchedSpell, String(patch.Description_Lang_enUS), textContext)
      : patch.Description_Lang_enUS
  }
  if (patch.AuraDescription_Lang_enUS !== undefined) {
    custom.auraDescription = textContext
      ? formatSpellText(patchedSpell, String(patch.AuraDescription_Lang_enUS), textContext)
      : patch.AuraDescription_Lang_enUS
  }
  if (castTime !== undefined) custom.castTime = castTime
  if (patch.SchoolMask !== undefined) custom.school = patch.SchoolMask
  if (patch.RecoveryTime !== undefined) custom.cooldown = patch.RecoveryTime
  if (patch.PowerType !== undefined || patch.ManaCost !== undefined || patch.ManaCostPct !== undefined) {
    custom.resource = compact({
      type: patch.PowerType,
      cost: patch.ManaCost,
      percent: patch.ManaCostPct,
    })
  }
  return custom
}

export const buildSpellEntry = (
  spell: DBCRow,
  classMask: number,
  patch: SpellPatch | undefined,
  castTimes: DBCMap,
  textContext?: SpellTextContext,
  icons?: IconContext,
  raceMask = 0,
): DbEntry =>
  compact({
    id: toNumber(spell.ID),
    kind: 'spell' as const,
    name: spell.Name_Lang_enUS,
    icon: iconName(icons?.spellIconById.get(asNumber(spell.SpellIconID))?.File),
    nameSubtext: spell.NameSubtext_Lang_enUS,
    description: textContext
      ? formatSpellText(spell, String(spell.Description_Lang_enUS || ''), { ...textContext, overrideById: undefined })
      : spell.Description_Lang_enUS,
    auraDescription: textContext
      ? formatSpellText(spell, String(spell.AuraDescription_Lang_enUS || ''), {
        ...textContext,
        overrideById: undefined,
      })
      : spell.AuraDescription_Lang_enUS,
    castTime: (() => {
      const row = castTimes.get(toNumber(spell.CastingTimeIndex))
      return row?.Base === undefined ? 0 : toNumber(row.Base)
    })(),
    school: spell.SchoolMask,
    resource: compact({
      type: spell.PowerType,
      cost: spell.ManaCost,
      percent: spell.ManaCostPct,
      perSecond: spell.ManaPerSecond,
    }),
    cooldown: spell.RecoveryTime,
    classMask,
    raceMask,
    custom: patch ? spellCustomFields(spell, patch, castTimes, textContext) : undefined,
  })

export const spellRank = (spell: DBCRow | undefined) =>
  Number(String(spell?.NameSubtext_Lang_enUS ?? '').match(/\brank\s+(\d+)/i)?.[1] ?? 0)

export const highestRankSpellIds = (spellIds: number[], spellById: DBCMap) => {
  const highestByName = new Map<string, { rank: number; ids: Set<number> }>()
  for (const id of spellIds) {
    const spell = spellById.get(id)
    const rank = spellRank(spell)
    if (!spell || rank === 0) continue
    const name = String(spell.Name_Lang_enUS ?? id)
    const current = highestByName.get(name)
    if (!current || rank > current.rank) highestByName.set(name, { rank, ids: new Set([id]) })
    else if (rank === current.rank) current.ids.add(id)
  }
  return spellIds.filter((id) => {
    const spell = spellById.get(id)
    const rank = spellRank(spell)
    if (rank === 0) return true
    return highestByName.get(String(spell?.Name_Lang_enUS ?? id))?.ids.has(id) ?? true
  })
}

export const patchById = (patches: readonly SpellPatch[]) => new Map(patches.map((patch) => [Number(patch.ID), patch]))
