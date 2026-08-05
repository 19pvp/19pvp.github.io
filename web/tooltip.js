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
  12: 'Defense',
  13: 'Dodge',
  15: 'Block',
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

const inventorySlots = {
  1: 'Head',
  2: 'Neck',
  3: 'Shoulders',
  4: 'Shirt',
  5: 'Chest',
  6: 'Waist',
  7: 'Legs',
  8: 'Feet',
  9: 'Wrist',
  10: 'Hands',
  11: 'Finger',
  12: 'Trinket',
  13: 'One-Hand',
  14: 'Shield',
  15: 'Ranged',
  16: 'Back',
  17: 'Two-Hand',
  19: 'Tabard',
  20: 'Chest',
  21: 'Main Hand',
  22: 'Off Hand',
  23: 'Held In Off-hand',
  25: 'Thrown',
  26: 'Ranged',
}

const armorTypes = {
  1: 'Cloth',
  2: 'Leather',
  3: 'Mail',
  4: 'Plate',
  6: 'Shield',
}

const weaponTypes = {
  0: 'Axe',
  1: 'Axe',
  2: 'Bow',
  3: 'Gun',
  4: 'Mace',
  5: 'Mace',
  6: 'Polearm',
  7: 'Sword',
  8: 'Sword',
  10: 'Staff',
  13: 'Fist Weapon',
  15: 'Dagger',
  16: 'Thrown',
  18: 'Crossbow',
  19: 'Wand',
  20: 'Fishing Pole',
}

const damageTypes = {
  1: 'Holy',
  2: 'Fire',
  3: 'Nature',
  4: 'Frost',
  5: 'Shadow',
  6: 'Arcane',
}

const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const formatMilliseconds = (value) => {
  const seconds = asNumber(value) / 1000
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} sec` : `${seconds} sec`
}
const formatNumber = (value) => {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
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

const addPairLine = (parent, left, right, className = '') => {
  if (left === right) right = ''
  if (!left && right) [left, right] = [right, '']
  const line = text('div', '', `tooltip-pair ${className}`.trim())
  line.append(text('span', left))
  if (right) line.append(text('span', right))
  parent.append(line)
}

const addDescription = (parent, value, className = 'tooltip-description') => {
  if (!value) return
  addLine(parent, value, className)
}

const enchantKey = (entry, enchantId) => entry.suffix !== undefined
  ? `enchant-suffix:${enchantId}`
  : `enchant-random:${enchantId}`

const renderEnchant = (parent, entry, enchantId) => {
  const enchant = database[enchantKey(entry, enchantId)]
  if (!enchant || typeof enchant !== 'object') return false
  const stats = Object.entries(enchant)
    .filter(([key]) => key.startsWith('stat_'))
    .map(([key, value]) => {
      const amount = entry.suffix === undefined
        ? asNumber(value)
        : Math.floor(asNumber(value) / asNumber(entry.suffix))
      const label = statLabels[key.slice(5)] || `Stat ${key.slice(5)}`
      return `${amount > 0 ? '+' : ''}${formatNumber(amount)} ${label}`
    })
  for (const stat of stats) addLine(parent, stat, 'tooltip-stat')
  return true
}

const renderPlayerEnchant = (parent, enchantId) => {
  const enchant = database[`enchant:${enchantId}`]
  if (typeof enchant !== 'string') return false
  addLine(parent, `Enchanted: ${enchant}`, 'tooltip-enchant')
  return true
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
  const value = { ...entry }
  if (Object.keys(custom).some((key) => /^stat_\d+$/.test(key))) {
    for (const key of Object.keys(value)) {
      if (/^stat_\d+$/.test(key)) delete value[key]
    }
  }
  return {
    ...value,
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

const renderItem = (content, entry, { enchantId, randomEnchantId, suffixId }) => {
  const value = effectiveEntry(entry)
  const isWeapon = asNumber(value.class) === 2
  const isArmor = asNumber(value.class) === 4
  const header = document.createElement('div')
  header.className = 'tooltip-header'
  addIcon(header, value.icon, value.quality)
  const heading = document.createElement('div')
  heading.className = 'tooltip-heading'
  const selectedSuffix = value.suffix !== undefined && suffixId
    ? database[`enchant-suffix:${Number(suffixId)}`]
    : undefined
  const name = text('div', value.name || 'Unknown item', 'tooltip-name')
  if (selectedSuffix && typeof selectedSuffix === 'object' && selectedSuffix.name) {
    name.style.setProperty('--enchant-name', JSON.stringify(` ${selectedSuffix.name}`))
  }
  name.dataset.quality = String(asNumber(value.quality))
  heading.append(name)
  header.append(heading)
  content.append(header)

  const metadata = document.createElement('div')
  metadata.className = 'tooltip-metadata'
  if (!isWeapon && !isArmor) addLine(metadata, itemTypes[asNumber(value.class)])
  if (metadata.childNodes.length) content.append(metadata)

  const damages = Array.isArray(value.damage) ? value.damage : []
  if (isWeapon) {
    addPairLine(
      content,
      inventorySlots[asNumber(value.inventoryType)] || 'Weapon',
      weaponTypes[asNumber(value.subclass)],
      'tooltip-item-detail',
    )
    const first = asRecord(damages[0])
    const firstMin = asNumber(first.min)
    const firstMax = asNumber(first.max)
    const speed = asNumber(value.weaponSpeed)
    if (firstMin || firstMax || speed) {
      addPairLine(
        content,
        firstMin || firstMax ? `${firstMin} - ${firstMax}` : '',
        speed > 0 ? `Speed ${(speed / 1000).toFixed(2)}` : '',
        'tooltip-item-detail',
      )
    }
    for (const damage of damages.slice(1)) {
      const row = asRecord(damage)
      const min = asNumber(row.min)
      const max = asNumber(row.max)
      const type = damageTypes[asNumber(row.type)]
      if (min || max) addLine(content, `+${min} - ${max}${type ? ` ${type} Damage` : ' Damage'}`, 'tooltip-item-detail')
    }
    if (speed > 0 && damages.length) {
      const average = damages.reduce((total, damage) => {
        const row = asRecord(damage)
        return total + (asNumber(row.min) + asNumber(row.max)) / 2
      }, 0)
      addLine(content, `(${formatNumber(average / (speed / 1000))} damage per second)`, 'tooltip-item-detail')
    }
  } else if (isArmor) {
    addPairLine(
      content,
      inventorySlots[asNumber(value.inventoryType)] || 'Armor',
      armorTypes[asNumber(value.subclass)],
      'tooltip-item-detail',
    )
    if (asNumber(value.armor) > 0) addLine(content, `${value.armor} Armor`, 'tooltip-item-detail')
  } else {
    for (const damage of damages) {
      const row = asRecord(damage)
      const min = asNumber(row.min)
      const max = asNumber(row.max)
      if (min || max) addLine(content, `${min}-${max} Damage`, 'tooltip-stat')
    }
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

  const hasRandomEnchant = Array.isArray(value.enchant) || value.suffix !== undefined
  const randomId = value.suffix !== undefined ? suffixId : randomEnchantId
  if (hasRandomEnchant) {
    const selectedId = Number(randomId)
    if (!randomId || !Number.isInteger(selectedId) || !renderEnchant(content, value, selectedId)) {
      if (hasRandomEnchant) addLine(content, '<Randomly enchanted>', 'tooltip-stat')
    }
  }
  if (enchantId) renderPlayerEnchant(content, Number(enchantId))

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

const renderEntry = (tooltip, key, entry, enchantments) => {
  const content = document.createElement('div')
  content.className = 'tooltip-content'
  const kind = key.split(':', 1)[0]
  if (kind === 'item') renderItem(content, entry, enchantments)
  else if (kind === 'spell') renderSpell(content, entry)
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

  const updateEntry = (key, enchantments) => {
    const entry = database[key]
    if (!entry || !renderEntry(tooltip, key, entry, enchantments)) {
      hide()
      return
    }
    tooltip.hidden = false
    tooltip.setAttribute('aria-hidden', 'false')
    redrawPosition()
  }

  const updateTarget = (target) => {
    const match = target instanceof Element ? target.closest('[data-tip]') : undefined
    const key = match?.getAttribute('data-tip')?.trim()
    if (!key) {
      hide()
      return
    }
    const enchantments = {
      enchantId: match?.getAttribute('data-enchant') || '',
      randomEnchantId: match?.getAttribute('data-random-enchant') || '',
      suffixId: match?.getAttribute('data-suffix') || '',
    }
    const stateKey = `${key}:${Object.values(enchantments).join(':')}`
    if (stateKey !== currentKey) {
      currentKey = stateKey
      updateEntry(key, enchantments)
    }
    redrawPosition()
  }

  globalThis.addEventListener('resize', () => {
    viewportWidth = globalThis.innerWidth
    viewportHeight = globalThis.innerHeight
    updateTarget(document.elementFromPoint(mouseX, mouseY))
    redrawPosition()
  })

  globalThis.addEventListener('mousemove', (event) => {
    mouseX = event.clientX
    mouseY = event.clientY
    updateTarget(event.target)
  })

  globalThis.addEventListener('scroll', () => updateTarget(document.elementFromPoint(mouseX, mouseY)), {
    passive: true,
  })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installTooltip, { once: true })
  else installTooltip()
}
