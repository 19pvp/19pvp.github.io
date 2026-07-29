export type ScrollSpell = {
  itemId: number
  spellIds: readonly number[]
}

export type SpellDescription = {
  Description_Lang_enUS: string
}

export type ScrollPatchEdit = {
  filename: 'Spell.dbc'
  schema: Record<string, string>
  rows: { ID: number; Description_Lang_enUS: string }[]
}

const itemLevelRequirement =
  /(?:Only\s+us(?:e)?able\s+on\s+items?\s+level\s+\d+\s+and\s+above\.|Requires\s+a\s+level\s+\d+\s+or\s+higher(?:\s+level)?\s+item\.)\s*/gi

export const removeItemLevelRequirement = (description: string): string | undefined => {
  if (!itemLevelRequirement.test(description)) return undefined
  itemLevelRequirement.lastIndex = 0
  return description.replace(itemLevelRequirement, '').replace(/[ \t]{2,}/g, ' ').trim()
}

export const buildScrollPatch = (
  scrollSpells: readonly ScrollSpell[],
  spells: ReadonlyMap<number, SpellDescription>,
  schema: Record<string, string>,
): { edit: ScrollPatchEdit | undefined; missingSpellIds: number[]; unchangedSpellIds: number[] } => {
  const spellIds = [...new Set(scrollSpells.flatMap((item) => item.spellIds))].filter((spellId) => spellId > 0)
  const rows: ScrollPatchEdit['rows'] = []
  const missingSpellIds: number[] = []
  const unchangedSpellIds: number[] = []

  for (const spellId of spellIds) {
    const spell = spells.get(spellId)
    if (!spell) {
      missingSpellIds.push(spellId)
      continue
    }

    const description = removeItemLevelRequirement(spell.Description_Lang_enUS)
    if (description === undefined) {
      unchangedSpellIds.push(spellId)
      continue
    }
    rows.push({ ID: spellId, Description_Lang_enUS: description })
  }

  return {
    edit: rows.length ? { filename: 'Spell.dbc', schema, rows } : undefined,
    missingSpellIds,
    unchangedSpellIds,
  }
}
