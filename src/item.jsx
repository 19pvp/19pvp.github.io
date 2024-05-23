import { h } from 'preact'
import { useFetchJSON } from './hooks.js'

const ITEM_URL = 'https://19pvp.github.io/data/items'
// TODO: persist in localstorage?
const StatName = (pre, post) => (
  <span class="text-green-200">
    {pre}
    <span class="lg:inline hidden">{post}</span>
  </span>
)
const statName3 = name => {
  name.endsWith(' Rating') && (name = name.slice(0, -' Rating'.length))
  name.endsWith(' Resistance') && (name = name.slice(0, -'istance'.length))
  if (name < 6) return <span class="text-green-200">{name}</span>
  return StatName(name.slice(0, 3), name.slice(3))
}

// TODO: add more pre-abreviated stat names
const statsRenders = {
  Stamina: StatName('Stam', 'ina'),
  'Critical Strike Rating': StatName('Crit', 'ical Strike'),
}

export const mergeStats = statsSources => {
  const result = {}
  for (const stats of statsSources) {
    if (!stats) continue
    for (const [stat, qty] of Object.entries(stats)) {
      result[stat] = (result[stat] || 0) + qty
    }
  }
  return result
}

const formatEnchantName = ench => {
  const nameParts = ench.name.split(' - ')
  return nameParts[nameParts.length > 1 ? 1 : 0]
}

// Stats blacklist per class
const magical = ['Agility', 'Strength']
const physical = ['Intellect', 'Spirit']
const hybrid = []
const statsBlacklists = {
  DRUID: hybrid,
  HUNTER: physical,
  MAGE: magical,
  PALADIN: hybrid,
  PRIEST: magical,
  ROGUE: physical,
  SHAMAN: hybrid,
  WARLOCK: magical,
  WARRIOR: physical,
}

// DOING Show DPS / Armor
// TODO: Show source ?
const itemsDB = new Map()
export const Item = ({ id, rand, slot, enchant, wowclass }) => {
  const itemRequest = useFetchJSON(id && `${ITEM_URL}/${id}.json`)
  const enchRequest = useFetchJSON(enchant && `${ITEM_URL}/${enchant}.json`)
  const ench = enchRequest.data
  const item = itemRequest.data || {
    icon: slot ? `inventoryslot_${slot}` : 'inv_misc_questionmark',
    name:
      (id &&
        (itemRequest.isLoading
          ? 'loading item...'
          : itemRequest.error?.message || 'Missing item')) || (
        <span class="text-gray-500 capitalize">{slot}</span>
      ) ||
      '...',
  }

  const stats = Object.entries(
    mergeStats([item.rand?.[rand]?.stats, item.stats, ench?.stats]),
  )

  const statBlackList = statsBlacklists[wowclass.toUpperCase()] || []
  return (
    <div
      class="
        flex gap-1
        p-2 pl-[68px]
        rounded-md overflow-hidden
        bg-zinc-800 bg-contain bg-no-repeat bg-left
        text-zinc-200
        border-zinc-700 border-solid border-4
      "
      style={{
        backgroundImage: [
          'linear-gradient(to right, transparent 40px, rgb(39 39 42 / var(--tw-bg-opacity)) 65px)',
          'linear-gradient(to right, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
          'linear-gradient(to top, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
          'linear-gradient(to bottom, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
          `url(https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg)`,
        ].join(', '),
      }}
    >
      <div>
        <span class="font-bold text-ellipsis overflow-hidden whitespace-nowrap">
          <a
            href={`#detail-item-${item.id}`}
            data-tip={`items/${item.id}`}
            class={item.quality}
          >
            {[item.name, rand].filter(Boolean).join(' ')}
          </a>
          {ench && (
            <a
              href={`#detail-item-${ench.id}`}
              data-tip={`items/${ench.id}`}
              class={ench.quality}
            >{` [${formatEnchantName(ench)}]`}</a>
          )}
        </span>
        <div class="text-ellipsis overflow-hidden whitespace-nowrap">
          {item.spell && (
            <a
              href="#"
              data-tip={`spells/${item.spell.id}`}
              class="text-zinc-400"
            >
              {item.spell.type}:{' '}
              <span class="text-purple-300">{item.spell.name}</span>
            </a>
          )}
          {stats
          .filter(([k]) => !statBlackList.includes(k))
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
