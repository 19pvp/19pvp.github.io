import { Item } from './item.jsx'

const inventory = Object.entries({
  head: { side: 'left', icon: 'head' },
  neck: { side: 'left', icon: 'neck' },
  shoulder: { side: 'left', types: ['shoulders'] },
  back: { side: 'left', icon: 'chest' },
  chest: { side: 'left' },
  wrists: { side: 'left' },
  ['main hand']: {
    side: 'left',
    icon: 'mainhand',
    types: ['two hand', 'one hand'],
  },
  ['off hand']: {
    side: 'left',
    icon: 'offhand',
    types: ['shield', 'one hand'],
  },
  ranged: { side: 'left', types: ['thrown'] },
  hands: { side: 'right' },
  waist: { side: 'right' },
  legs: { side: 'right' },
  feet: { side: 'right' },
  finger1: { side: 'right', icon: 'finger', types: ['finger'] },
  finger2: { side: 'right', icon: 'finger', types: ['finger'] },
  trinket1: { side: 'right', icon: 'trinket', types: ['trinket'] },
  trinket2: { side: 'right', icon: 'trinket', types: ['trinket'] },
}).map(([key, inv]) => ({
  key,
  side: inv.side,
  icon: inv.icon || key,
  types: [key, ...(inv.types || [])],
}))

const leftSide = inv => inv.side === 'left'
const rightSide = inv => inv.side === 'right'
const slotToItem = slot =>
  !slot.unavailable && (
    <Item
      key={slot.key}
      slot={slot.icon}
      id={slot.item?.id}
      rand={slot.item?.rand}
      enchant={slot.item?.enchant}
      wowclass={slot.wowclass}
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
  const wowclass = name?.split(':')?.[0]?.trim() || ''
  const slotsByInventoryType = {}
  for (const inv of inventory) {
    const match = items.find(
      item => !equipped.has(item) && inv.types.includes(item.type),
    )
    match && equipped.add(match)
    const slot = { ...inv, item: match, wowclass }
    slotsByInventoryType[slot.key] = slot
    slots.push(slot)
  }
  slotsByInventoryType['off hand'].unavailable =
    slotsByInventoryType['main hand'].item?.type === 'two hand'

  return (
    <>
      <div class="flex gap-10">
        <div class="flex gap-2 flex-col w-1/2">
          {slots.filter(leftSide).map(slotToItem)}
        </div>
        <div class="flex gap-2 flex-col w-1/2">
          {slots.filter(rightSide).map(slotToItem)}
        </div>
      </div>
    </>
  )
}
