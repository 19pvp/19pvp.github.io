import cachedItems from './cached-items.json'
import type { ItemData } from './item'

const cachedIcons = [
  ...[
  ...new Set(Object.values(cachedItems).map(item => item.icon)),
].sort(),
  'chest',
  'feet',
  'finger',
  'hands',
  'head',
  'legs',
  'mainhand',
  'neck',
  'ranged',
  'relic',
  'offhand',
  'shoulder',
  'trinket',
  'waist',
  'wrists',
]

const iconImageSet = `image-set(${[
  'url("/src/icons/sprite.avif") type("image/avif")',
  'url("/src/icons/sprite.webp") type("image/webp")',
  'url("/src/icons/sprite.jpg") type("image/jpeg")',
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
