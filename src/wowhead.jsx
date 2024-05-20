import { h } from 'preact'
import { useFetchJSON } from './hooks.js'
import * as style from './wowhead.module.css'

const ITEM_URL = 'https://19pvp.github.io/data/items'
// TODO: persist in localstorage?
const StatName = (pre, post) =>
 <span class="text-green-200">{pre}<span class="lg:inline hidden">{post}</span></span>
const StatName3 = name => {
  name.endsWith(' Rating') && (name = name.slice(0, ' Rating'.length))
  name.endsWith(' Resistance') && (name = name.slice(0, 'istance'.length))
  if (name < 6) return <span class="text-green-200">{name}</span>
  return StatName(name.slice(0, 3), name.slice(3))
}

// TODO: add more pre-abreviated stat names
const statsRenders = {
  Stamina: StatName('Stam', 'ina'),
  'Critical Strike Rating': StatName('Crit', 'ical Strike'),
}

// DOING Show DPS / Armor
// TODO: Show source ?
const itemsDB = new Map()
export const Item = ({ id }) => {
  const item = useFetchJSON(`${ITEM_URL}/${id}.json`)
  if (item.isLoading) return <div>Loading...</div>
  if (item.error) return <div>Error: {item.error.message}</div>
  return (
    <div
    class="bg-zinc-800 text-zinc-200 overflow-hidden p-2 border-solid border-4 pl-[68px] border-zinc-700 flex gap-1 bg-contain rounded-md bg-no-repeat bg-left"
    style={{
      backgroundImage: [
        'linear-gradient(to right, transparent 40px, rgb(39 39 42 / var(--tw-bg-opacity)) 65px)',
        'linear-gradient(to top, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
        'linear-gradient(to bottom, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
        'linear-gradient(to right, rgb(39 39 42 / var(--tw-bg-opacity)), transparent 5px)',
        `url(https://wow.zamimg.com/images/wow/icons/large/${item.data.icon}.jpg)`,
      ].join(', '),
    }}
    >
      <div>
        <div class={`${item.data.quality} font-bold text-ellipsis overflow-hidden whitespace-nowrap`}>{item.data.name}</div>
        <div class="text-ellipsis overflow-hidden whitespace-nowrap">
          {item.data.spell && <span class="text-zinc-400">On Hit: <span class="text-purple-300">{item.data.spell.name}</span></span>}
          {Object.entries(item.data.stats || {}).map(([k, v], i) => (
            <span>
              <span class="text-zinc-600">{(item.data.spell  || i > 0) ? ', ' : ' '}</span>
              <span class="text-blue-200">+{v}</span> {statsRenders[k] || (statsRenders[k] = StatName3(k))}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
