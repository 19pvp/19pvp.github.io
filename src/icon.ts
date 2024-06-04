import cachedItems from './cached-items.json'
import type { ItemData } from './item'

const cachedIcons = [
  ...new Set(Object.values(cachedItems).map(item => item.icon)),
].sort()

export const getIconStyle = (item?: ItemData, width = 58) => {
  if (!item) return
  const iconIndex = cachedIcons.indexOf(item.icon)
  return iconIndex > -1 ? { backgroundPositionY: `${iconIndex * -width}px` } : undefined
}

export const iconImageSet = `image-set(
  url("./icons/sprite.avif") type("image/avif"),
  url("./icons/sprite.webp") type("image/webp"),
  url("./icons/sprite.jpg") type("image/jpeg")
)`
