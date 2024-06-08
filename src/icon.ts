import cachedItems from './cached-items.json'
import type { ItemData } from './item.tsx'
import avif from './icons/sprite.avif'
import webp from './icons/sprite.webp'
import jpeg from './icons/sprite.jpeg'

const cachedIcons = [
  ...[
  ...new Set(Object.values(cachedItems).map(item => item.icon)),
].sort(),
  'inventoryslot_chest',
  'inventoryslot_feet',
  'inventoryslot_finger',
  'inventoryslot_hands',
  'inventoryslot_head',
  'inventoryslot_legs',
  'inventoryslot_mainhand',
  'inventoryslot_neck',
  'inventoryslot_ranged',
  'inventoryslot_relic',
  'inventoryslot_offhand',
  'inventoryslot_shoulder',
  'inventoryslot_trinket',
  'inventoryslot_waist',
  'inventoryslot_wrists',
]

const iconImageSet = `image-set(${[
  `url("${avif}") type("image/avif")`,
  `url("${webp}") type("image/webp")`,
  `url("${jpeg}") type("image/jpeg")`,
].join(', ')})`

const indexToStyle = (iconIndex: number, width = 58) => ({
  backgroundImage: iconImageSet,
  backgroundPositionY: `${iconIndex * -width}px`,
})

export const getIconStyle = (item?: ItemData, width?: number) => {
  if (!item) return
  const iconIndex = cachedIcons.indexOf(item.icon)
  return iconIndex > -1
    ? indexToStyle(iconIndex, width)
    : {
        backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg)`,
      }
}
