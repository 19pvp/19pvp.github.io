import { h, Fragment } from 'preact'
import { Item } from './item.tsx'

const inventory = Object.entries({
  Head: { side: 'left', icon: 'head' },
  Neck: { side: 'left', icon: 'neck' },
  Shoulder: { side: 'left', types: ['shoulders'] },
  Back: { side: 'left', icon: 'chest' },
  Chest: { side: 'left' },
  Wrists: { side: 'left' },
  ['Main Hand']: {
    side: 'left',
    icon: 'mainhand',
    types: ['two hand', 'one hand'],
  },
  ['Off Hand']: {
    side: 'left',
    icon: 'offhand',
    types: ['shield', 'one hand'],
  },
  Ranged: { side: 'left', types: ['thrown'] },
  Hands: { side: 'right' },
  Waist: { side: 'right' },
  Legs: { side: 'right' },
  Feet: { side: 'right' },
  ['Finger 1']: { side: 'right', icon: 'finger', types: ['finger'] },
  ['Finger 2']: { side: 'right', icon: 'finger', types: ['finger'] },
  ['Trinket 1']: { side: 'right', icon: 'trinket', types: ['trinket'] },
  ['Trinket 2']: { side: 'right', icon: 'trinket', types: ['trinket'] },
}).map(([name, inv]) => ({
  name,
  side: inv.side,
  icon: inv.icon || name.toLowerCase(),
  types: [name.toLowerCase(), ...(inv.types || [])],
}))

const leftSide = inv => inv.side === 'left'
const rightSide = inv => inv.side === 'right'
const slotToItem = slot => (
  <Item
    key={slot.name}
    slot={slot.icon}
    name={slot.name}
    wowClass={slot.wowClass}
    {...(slot.unavailable || slot.item)}
  />
)

export const Build = ({ build, name }) => {
  const items = (build || []).map(item => ({
    id: item.ID,
    type: item.Slot.toLowerCase(),
    rand: item['Random Enchant'],
    name: item['Name'],
    enchant: item['Enchant ID'],
  }))
  const equipped = new Set()
  const slots = []
  const wowClass = name?.split(':')?.[0]?.trim() || ''
  const slotsByInventoryType = {}
  for (const inv of inventory) {
    const match = items.find(
      item => !equipped.has(item) && inv.types.includes(item.type),
    )
    match && equipped.add(match)
    const slot = { ...inv, item: match, wowClass }
    slotsByInventoryType[slot.name] = slot
    slots.push(slot)
  }

  slotsByInventoryType['Off Hand'].unavailable =
    slotsByInventoryType['Main Hand'].item?.type === 'two hand'

  slotsByInventoryType.Ranged.unavailable =
    wowClass === 'PALADIN' || wowClass === 'SHAMAN'

  return (
    <>
      <div class="grid grid-cols-2 gap-10 p-10 w-full">
        <div class="flex gap-2 flex-col">
          {slots.filter(leftSide).map(slotToItem)}
        </div>
        <div class="flex gap-2 flex-col">
          {slots.filter(rightSide).map(slotToItem)}
        </div>
      </div>
    </>
  )
}
