import database from './db.json' with { type: 'json' }

const TOOLTIP_ID = 'tooltip'
const MARGIN = 8
const MAX_WIDTH = 456

const statLabels = {
  3: 'Agility',
  4: 'Strength',
  5: 'Intellect',
  6: 'Spirit',
  7: 'Stamina',
  31: 'Hit Rating',
  32: 'Critical Strike Rating',
  36: 'Haste Rating',
  38: 'Attack Power',
  43: 'Mana Regeneration',
  45: 'Spell Power',
}

const schoolNames = {
  1: 'Physical',
  2: 'Holy',
  4: 'Fire',
  8: 'Nature',
  16: 'Frost',
  32: 'Shadow',
  64: 'Arcane',
}

const itemTypes = {
  0: 'Consumable',
  1: 'Container',
  2: 'Weapon',
  4: 'Armor',
  5: 'Reagent',
  6: 'Projectile',
  7: 'Trade Goods',
  9: 'Recipe',
  11: 'Quiver',
  12: 'Quest',
  13: 'Key',
  15: 'Miscellaneous',
  16: 'Glyph',
}

const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const formatMilliseconds = (value) => {
  const seconds = asNumber(value) / 1000
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} sec` : `${seconds} sec`
}

const text = (tag, value, className = '') => {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = String(value)
  return element
}

const addLine = (parent, value, className = '') => {
  if (value === undefined || value === null || value === '') return
  parent.append(text('div', value, className))
}

const addDescription = (parent, value, className = 'tooltip-description') => {
  if (!value) return
  addLine(parent, value, className)
}

const addIcon = (parent, value, quality) => {
  const icon = text('span', '', 'tooltip-icon')
  const sprite = text('span', '')
  icon.setAttribute('aria-hidden', 'true')
  sprite.className = 'icon-sprite'
  sprite.style.setProperty('--icon-index', String(asNumber(value)))
  if (quality !== undefined) icon.dataset.quality = String(asNumber(quality))
  icon.append(sprite)
  parent.append(icon)
}

const effectiveEntry = (entry) => {
  const custom = asRecord(entry.custom)
  return {
    ...entry,
    ...custom,
    spells: { ...asRecord(entry.spells), ...asRecord(custom.spells) },
  }
}

const renderSpell = (content, entry) => {
  const value = effectiveEntry(entry)
  const header = document.createElement('div')
  header.className = 'tooltip-header'
  addIcon(header, value.icon)
  const heading = document.createElement('div')
  heading.className = 'tooltip-heading'
  heading.append(text('div', value.name || 'Unknown spell', 'tooltip-name tooltip-spell-name'))
  addLine(heading, value.nameSubtext, 'tooltip-subtext')
  header.append(heading)
  content.append(header)

  const metadata = document.createElement('div')
  metadata.className = 'tooltip-metadata'
  if (asNumber(value.castTime) > 0) addLine(metadata, `Cast time: ${formatMilliseconds(value.castTime)}`)
  const resource = asRecord(value.resource)
  if (asNumber(resource.cost) > 0) addLine(metadata, `Cost: ${resource.cost}`)
  if (asNumber(resource.percent) > 0) addLine(metadata, `Cost: ${resource.percent}% of base mana`)
  if (asNumber(value.cooldown) > 0) addLine(metadata, `Cooldown: ${formatMilliseconds(value.cooldown)}`)
  if (asNumber(value.school) > 0) {
    const schools = Object.entries(schoolNames)
      .filter(([mask]) => asNumber(value.school) & Number(mask))
      .map(([, name]) => name)
    if (schools.length) addLine(metadata, `School: ${schools.join(', ')}`)
  }
  if (metadata.childNodes.length) content.append(metadata)

  addDescription(content, value.description)
  addDescription(content, value.auraDescription, 'tooltip-description tooltip-aura')
}

const renderItem = (content, entry) => {
  const value = effectiveEntry(entry)
  const header = document.createElement('div')
  header.className = 'tooltip-header'
  addIcon(header, value.icon, value.quality)
  const heading = document.createElement('div')
  heading.className = 'tooltip-heading'
  const name = text('div', value.name || 'Unknown item', 'tooltip-name')
  name.dataset.quality = String(asNumber(value.quality))
  heading.append(name)
  header.append(heading)
  content.append(header)

  const metadata = document.createElement('div')
  metadata.className = 'tooltip-metadata'
  addLine(metadata, itemTypes[asNumber(value.class)])
  if (asNumber(value.requiredLevel) > 0) addLine(metadata, `Requires Level ${value.requiredLevel}`)
  if (asNumber(value.armor) > 0) addLine(metadata, `${value.armor} Armor`)
  if (asNumber(value.weaponSpeed) > 0) addLine(metadata, `Speed ${formatMilliseconds(value.weaponSpeed)}`)
  if (metadata.childNodes.length) content.append(metadata)

  const damages = Array.isArray(value.damage) ? value.damage : []
  for (const damage of damages) {
    const row = asRecord(damage)
    const min = asNumber(row.min)
    const max = asNumber(row.max)
    if (min || max) addLine(content, `${min}-${max} Damage`, 'tooltip-stat')
  }

  for (const [key, label] of Object.entries(statLabels)) {
    const amount = asNumber(value[`stat_${key}`])
    if (amount) addLine(content, `${amount > 0 ? '+' : ''}${amount} ${label}`, 'tooltip-stat')
  }

  for (
    const [key, label] of Object.entries({
      res_holy: 'Holy Resistance',
      res_fire: 'Fire Resistance',
      res_nature: 'Nature Resistance',
      res_frost: 'Frost Resistance',
      res_shadow: 'Shadow Resistance',
      res_arcane: 'Arcane Resistance',
    })
  ) {
    const amount = asNumber(value[key])
    if (amount) addLine(content, `+${amount} ${label}`, 'tooltip-stat')
  }

  addDescription(content, value.description)

  for (const [spellId, metadata] of Object.entries(asRecord(value.spells))) {
    const spell = database[`spell:${spellId}`]
    if (!spell) continue
    const spellValue = effectiveEntry(spell)
    const effect = document.createElement('div')
    effect.className = 'tooltip-effect'
    const trigger = asRecord(metadata).trigger || 'use'
    const triggerLabel = trigger === 'hit' ? 'On Hit' : trigger === 'equip' ? 'Equip' : 'Use'
    effect.append(text('div', `${triggerLabel}: ${spellValue.name || `Spell ${spellId}`}`))
    addDescription(effect, spellValue.description)
    content.append(effect)
  }
}

const renderEntry = (tooltip, entry) => {
  const content = document.createElement('div')
  content.className = 'tooltip-content'
  if (entry.kind === 'item') renderItem(content, entry)
  else if (entry.kind === 'spell') renderSpell(content, entry)
  else return false
  const icon = content.querySelector('.tooltip-icon')
  const shell = document.createElement('div')
  shell.className = 'tooltip-shell'
  if (icon) shell.append(icon)
  shell.append(content)
  tooltip.replaceChildren(shell)
  return true
}

export const calculateTooltipPosition = ({ x, y, height, innerWidth, innerHeight }) => {
  const tooltipWidth = Math.min(MAX_WIDTH, Math.max(0, innerWidth - MARGIN * 2))
  let left = x + MARGIN
  let top = y - 52
  if (left + tooltipWidth + MARGIN > innerWidth) left = x - tooltipWidth - MARGIN
  left = Math.max(MARGIN, Math.min(left, innerWidth - tooltipWidth - MARGIN))
  const maxHeight = Math.max(0, innerHeight - MARGIN * 2)
  top = Math.max(
    MARGIN,
    Math.min(top, innerHeight - Math.min(height, maxHeight) - MARGIN),
  )
  return { left, top, width: tooltipWidth, maxHeight }
}

export const installTooltip = () => {
  if (typeof document === 'undefined' || document.getElementById(TOOLTIP_ID)) return
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', installTooltip, { once: true })
    return
  }

  const tooltip = document.createElement('div')
  tooltip.id = TOOLTIP_ID
  tooltip.hidden = true
  tooltip.setAttribute('aria-hidden', 'true')
  document.body.append(tooltip)

  let currentKey
  let mouseX = 0
  let mouseY = 0
  let viewportWidth = globalThis.innerWidth
  let viewportHeight = globalThis.innerHeight

  const hide = () => {
    currentKey = undefined
    tooltip.hidden = true
    tooltip.setAttribute('aria-hidden', 'true')
  }

  const redrawPosition = () => {
    if (tooltip.hidden) return
    const position = calculateTooltipPosition({
      x: mouseX,
      y: mouseY,
      height: tooltip.getBoundingClientRect().height,
      innerWidth: viewportWidth,
      innerHeight: viewportHeight,
    })
    tooltip.style.width = `${position.width}px`
    tooltip.style.maxHeight = `${position.maxHeight}px`
    tooltip.style.transform = `translate3d(${Math.round(position.left)}px, ${Math.round(position.top)}px, 0)`
  }

  const updateEntry = (key) => {
    const entry = database[key]
    if (!entry || !renderEntry(tooltip, entry, database)) {
      hide()
      return
    }
    tooltip.hidden = false
    tooltip.setAttribute('aria-hidden', 'false')
    redrawPosition()
  }

  globalThis.addEventListener('resize', () => {
    viewportWidth = globalThis.innerWidth
    viewportHeight = globalThis.innerHeight
    redrawPosition()
  })

  globalThis.addEventListener('mousemove', (event) => {
    mouseX = event.clientX
    mouseY = event.clientY
    const match = event.target instanceof HTMLElement ? event.target.closest('[data-tip]') : undefined
    const key = match?.getAttribute('data-tip')?.trim()
    if (!key) {
      hide()
      return
    }
    if (key !== currentKey) {
      currentKey = key
      updateEntry(key)
    }
    redrawPosition()
  })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installTooltip, { once: true })
  else installTooltip()
}
