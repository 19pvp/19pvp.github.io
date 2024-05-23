import { useState, useMemo } from 'preact/hooks'

import { useEvent, useWindowSize, useFetchJSON } from './hooks.js'
import { mergeStats } from './item.jsx'
import * as style from './icons.module.css'

const MISSING_EVENT = { x: 0, y: 0, target: document.body }
const DATA_URL = 'https://19pvp.github.io/data/'

const capWord = word => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`
const capitalize = str => str.split('_').map(capWord).join(' ')

export const ToolTip = () => {
  const [ref, setRef] = useState(null)
  const { x, y, target } = useEvent('mousemove') || MISSING_EVENT
  const { innerWidth, innerHeight } = useWindowSize()
  const rect = useMemo(() => ref?.getBoundingClientRect(), [ref])
  const tip = useMemo(
    () => target?.closest('[data-tip]')?.dataset.tip,
    [target],
  )
  const { data } = useFetchJSON(tip && `${DATA_URL}${tip}.json`)

  const tipStyle = {}
  if (rect?.width) {
    const { width, height } = rect
    let Y = y - (56 + 4)
    let X = x + 4
    if (X + width > innerWidth) {
      X = x - 4 - width
      tipStyle.flexDirection = 'row-reverse'
    } else {
      tipStyle.flexDirection = 'row'
    }
    if (Y + height > innerHeight) {
      Y = innerHeight - (height + 24)
    }
    Y < 0 && (Y = y + 4)
    // follow tooltip to the mouse
    tipStyle.transform = `translate(${X}px, ${Y}px)`
  }

  // TODO:
  // handle enchants and random enchants
  // fix heirloom Armor + leather head stats
  // Show sides icon
  if (!tip || !data || data.isFetching || data.isLoading) return null
  const source =
    data.source === 'DROP' && data.bind === 'Binds when picked up'
      ? 'DUNGEON'
      : 'DROP'
  return (
    <div
      class="
        flex gap-2
        fixed pointer-events-none z-50
        top-0 left-0
        opacity-100 transition-opacity duration-200
      "
      style={tipStyle}
      ref={elem => {
        elem !== ref && setRef(elem)
      }}
    >
      <div>
        <div
          class={`w-[56px] h-[56px] ${data.quality}`}
          style={{
            border: `1px solid currentcolor`,
            backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/large/${data.icon}.jpg)`,
          }}
        />
      </div>
      <div
        class={`${data.quality} bg-zinc-800 p-1`}
        style={{
          width: '400px',
          border: `1px solid currentcolor`,
        }}
      >
        <div class="font-bold">{data.name}</div>
        {data.itemLevel && (
          <div class="text-amber-300 flex justify-between">
            <div>
              Item Level {data.quality === 'HEIRLOOM' ? 24 : data.itemLevel}
            </div>
            {data.quality !== 'HEIRLOOM' && data.requiredLevel && (
              <div>(Required {data.requiredLevel})</div>
            )}
          </div>
        )}
        <div class="text-zinc-200">{data.bind}</div>
        <div class="text-zinc-200 flex justify-between">
          <span>{data.subclass && capitalize(data.subclass)}</span>
          <span>{capitalize(data.class)}</span>
        </div>
        {data.subclass && (
          <div class="text-zinc-200 flex justify-between">
            <span>{data.type && capitalize(data.type)}</span>
            <span>
              {[
                (data.armor > 0 ||
                  (data.quality === 'HEIRLOOM' && data.class === 'ARMOR')) &&
                  `+${data.armor || '??'}`,
                data.dps && `${data.dps} dps`,
              ]
                .filter(Boolean)
                .join(' ')}
            </span>
          </div>
        )}
        {data.dps && (
          <div class="text-zinc-200 flex justify-between">
            <span>
              {data.dmgMin} - {data.dmgMax}
            </span>
            <span>{data.speed}s</span>
          </div>
        )}
        {Object.entries(data.stats || {}).map(([name, qty]) => (
          <div>
            <span class="text-blue-200">+{qty}</span>{' '}
            <span class="text-green-200">{name}</span>
          </div>
        ))}
        {data.spell?.text && (
          <div class="text-green-400">{data.spell?.text}</div>
        )}
        {data.source && (
          <div class="text-zinc-200 flex justify-between">
            <div class="flex content-center">
              <div class={`${style[data.source]} w-[20px] h-[20px] bg-cover`} />
              <span class="text-purple-200 pl-1">
                {(source === 'DUNGEON' ? data.sourceZone : data.sourceName) ||
                  capitalize(data.source)}
              </span>
            </div>
            <span class="text-zinc-400 font-mono flex justify-between">
              {tip.replace(/s?\//, ':')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
