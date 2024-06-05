import { h } from 'preact'
import { useFetchJSON } from './hooks.js'
import { wowClasses } from './wow-classes.ts'

type Quality =
  | 'POOR'
  | 'COMMON'
  | 'UNCOMMON'
  | 'RARE'
  | 'EPIC'
  | 'LEGENDARY'
  | 'ARTIFACT'
  | 'HEIRLOOM'
type Source = 'CRAFT' | 'DROP' | 'QUEST' | 'VENDOR' | 'DUNGEON'
type SourceZoneType = 'Dungeon' | 'Zone'
type Side = 'ALLIANCE' | 'HORDE'
type Type =
  | 'LEGS'
  | 'CHEST'
  | 'HANDS'
  | 'FEET'
  | 'WAIST'
  | 'RANGED'
  | 'FINGER'
  | 'MAIN_HAND'
  | 'HELD_IN_OFF_HAND'
  | 'WRISTS'
  | 'BACK'
  | 'ONE_HAND'
  | 'TWO_HAND'
  | 'SHIELD'
  | 'NECK'
  | 'TRINKET'
  | 'HEAD'
  | 'TABARD'
  | 'THROWN'
  | 'SHOULDERS'
  | 'SHIRT'
  | 'OFF_HAND'

type Subclasses =
  // Weapon Subclasses
  | 'WAND'
  | 'BOW'
  | 'ONE_HANDED_MACE'
  | 'TWO_HANDED_MACE'
  | 'ONE_HANDED_SWORD'
  | 'TWO_HANDED_AXE'
  | 'DAGGER'
  | 'ONE_HANDED_AXE'
  | 'TWO_HANDED_SWORD'
  | 'STAFF'
  | 'GUN'
  | 'FISHING_POLE'
  | 'CROSSBOW'
  | 'THROWN'
  | 'MISCELLANEOUS'
  | 'POLEARM'
  | 'FIST_WEAPON'
  // Armor Subclasses
  | 'CLOTH'
  | 'LEATHER'
  | 'MAIL'
  | 'RINGS'
  | 'OFF_HAND_FRILLS'
  | 'CLOAKS'
  | 'SHIELDS'
  | 'AMULETS'
  | 'TRINKETS'
  | 'MISC'
  | 'TABARDS'
  | 'PLATE'
  | 'SHIRTS'

type SourceType = 'SPELL' | 'NPC' | 'QUEST' | 'ITEM'
// TODO: define class / sublcass types instead of "string"
// define type
// define random enchant types
// define stats names
type Stats = { [statName: string]: number }
type RandomEnchant = { id: number; chance: number; stats: Stats }
export type ItemData = {
  id: number
  name: string
  bind?: string
  spell?: {
    id: number
    type: string
    name: string
    text: string
  }
  icon: string
  iconIndex?: number
  source: Source
  class: 'CONSUMABLE' | 'WEAPON' | 'ARMOR'
  subclass?: Subclasses
  sourceId?: number
  sourceType?: SourceType
  sourceZone?: SourceType
  sourceName?: string
  sourceZoneType?: SourceZoneType
  itemLevel?: number
  requiredLevel?: number
  popularity?: number
  armor?: number
  dps?: number
  dmgMin?: number
  dmgMax?: number
  speed?: number
  quality: Quality
  stats?: Stats
  side?: Side
  rand?: { [randomEnchantName: string]: RandomEnchant }
  type?: Type
}

// TODO: persist in localstorage?
const StatName = (pre: string, post: string) => (
  <span class="text-green-200">
    {pre}
    <span class="lg:inline hidden">{post}</span>
  </span>
)

const statName3 = (name: string) => {
  name.endsWith(' Rating') && (name = name.slice(0, -' Rating'.length))
  name.endsWith(' Resistance') && (name = name.slice(0, -'istance'.length))
  if (name.length < 6) return <span class="text-green-200">{name}</span>
  return StatName(name.slice(0, 3), name.slice(3))
}

// TODO: add more pre-abreviated stat names
const statsRenders: { [StatName: string]: h.JSX.Element } = {
  Stamina: StatName('Stam', 'ina'),
  'Critical Strike Rating': StatName('Crit', 'ical Strike'),
}

export const mergeStats = (statsSources: (Stats | undefined)[]) => {
  const result: Stats = {}
  for (const stats of statsSources) {
    if (!stats) continue
    for (const [stat, qty] of Object.entries(stats)) {
      result[stat] = (result[stat] || 0) + qty
    }
  }
  return result
}

const formatEnchantName = (ench: ItemData) => {
  const nameParts = ench.name.split(' - ')
  return nameParts[nameParts.length > 1 ? 1 : 0]
}

export const useItem = (id?: number) =>
  useFetchJSON<ItemData>(
    id && id > 0 ? `https://19pvp.github.io/data/items/${id}.json` : null,
  )

// TODO: Show source ?
// TODO: Make spell toolitps
type ItemProps = {
  id?: number
  rand: string
  slot: string
  enchant: number
  wowClass: keyof typeof wowClasses
  name: string
}

export const Item = ({
  id,
  rand,
  slot,
  enchant,
  wowClass,
  name,
}: ItemProps) => {
  const itemRequest = useItem(id)
  const enchRequest = useItem(enchant)
  const ench = enchRequest.data
  const item =
    itemRequest.data ||
    ({
      icon: slot ? `inventoryslot_${slot}` : 'inv_misc_questionmark',
      name: (id &&
        (itemRequest.isLoading
          ? `${name} loading item...`
          : itemRequest.error?.message || `${name} missing`)) || (
        <span class="text-gray-500 capitalize">{name}</span>
      ),
    } as ItemData)

  const stats = Object.entries(
    mergeStats([item.rand?.[rand]?.stats, item.stats, ench?.stats]),
  )

  const excludeStats = wowClasses[wowClass]?.excludeStats || []
  return (
    <div
      class="
        flex gap-1
        p-2 pl-[68px]
        rounded-md overflow-hidden
        bg-zinc-800 bg-contain bg-no-repeat bg-left
        text-zinc-200
        border-zinc-700 border-solid border-4
        w-full
      "
      style={{
        backgroundImage: [
          'linear-gradient(to right, transparent 40px, rgb(39 39 42 / var(--tw-bg-opacity)) 65px)',
          'linear-gradient(to right, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
          'linear-gradient(to top, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
          'linear-gradient(to bottom, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
          // TODO use image-set and 
          `url(https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg)`,
        ].join(', '),
      }}
    >
      <div>
        <span class="font-bold text-ellipsis overflow-hidden whitespace-nowrap">
          <a
            href={`#detail-item-${item.id}`}
            data-tip={item.id && `items/${item.id}:${rand||''}`}
            class={item.quality}
          >
            {item.name} {rand}
          </a>
          {ench && (
            <a
              href={`#detail-item-${ench.id}`}
              data-tip={ench.id && `items/${ench.id}:`}
              class={ench.quality}
            >{` [${formatEnchantName(ench)}]`}</a>
          )}
        </span>
        <div class="text-ellipsis overflow-hidden whitespace-nowrap">
          {item.spell && (
            <a
              href="#"
              data-tip={item.spell.id && `spells/${item.spell.id}`}
              class="text-zinc-400"
            >
              {item.spell.type}:{' '}
              <span class="text-purple-300">{item.spell.name}</span>
            </a>
          )}
          {stats
            .filter(([k]) => !excludeStats.includes(k))
            .map(([k, v], i) => (
              <span>
                <span class="text-zinc-600">
                  {item.spell || i > 0 ? ', ' : ' '}
                </span>
                <span class="text-blue-200">+{v}</span>{' '}
                {statsRenders[k] || (statsRenders[k] = statName3(k))}
              </span>
            ))}
          {!stats.length && !item.spell && <span class="opacity-0">'-'</span>}
        </div>
      </div>
    </div>
  )
}
