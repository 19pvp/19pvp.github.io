import { h, Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useUrl, Link, navigate } from './router.tsx'
import { ItemData, useItem } from './item.tsx'
import * as style from './icons.module.css'
import { getIconStyle } from './icon.ts'

const capWord = (word: string) =>
  `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`
const capitalize = (str: string) => str.split('_').map(capWord).join(' ')

const wowheadUrl = 'https://www.wowhead.com/cata/'
const getItemSourceLink = (item?: ItemData) => {
  if (!item) return '#'
  if (item.source === 'VENDOR') {
    return item.sourceId
      ? `${wowheadUrl}npc=${item.sourceId}#sells`
      : `${wowheadUrl}item=${item.id}/#sold-by`
  }
  if (item.source === 'CRAFT') {
    return `${wowheadUrl}spell=${item.sourceId}`
  }
  if (item.source === 'DROP') {
    return item.sourceId
      ? `${wowheadUrl}npc=${item.sourceId}#drops`
      : `${wowheadUrl}item=${item.id}/#dropped-by`
  }
  return `${wowheadUrl}${item.source.toLowerCase()}=${item.sourceId}`
}

export const ItemDialog = ({ children }: { children?: h.JSX.Element | null }) => {
  const url = useUrl()
  const [ref, setRef] = useState<HTMLDialogElement | null>(null)
  useEffect(() => {
    if (!ref) return
    const isOpen = url.hash.startsWith('#detail-item-')
    if (isOpen === ref.open) return
    isOpen ? ref.showModal() : ref.close()
  }, [ref, url.hash])
  const closedHref = `${url.origin}${url.pathname}${url.search}`
  const itemId = Number(url.hash.split('#detail-item-')[1])
  const itemRequest = useItem(itemId)
  const item = itemRequest.data

  const source =
    item?.source === 'DROP' && item?.bind === 'Binds when picked up'
      ? 'DUNGEON'
      : 'DROP'

  return (
    <dialog
      style={{ boxShadow: '0 0 60px 2px black, 0 0 2px 1px #0005' }}
      class="p-0 bg-transparent rounded"
      ref={elem => elem instanceof HTMLDialogElement && setRef(elem)}
      onMouseDown={e => ref && e.target === ref && ref.close()}
      onClose={() => navigate(closedHref)}
    >
      <form
        class="
          flex gap-1 flex-col
          p-4
          w-full
          max-w-[520px]
          rounded-md overflow-hidden
          bg-zinc-800 bg-contain bg-no-repeat bg-left
          text-zinc-200
          border-zinc-700 border-solid border-4"
        method="dialog"
      >
        <h3 class={`text-center text-xl m-0 ${item?.quality}`}>{item?.name}</h3>
        <div
          class={`w-[58px] h-[58px] ${item?.quality} m-auto my-4`}
          style={{ border: `1px solid currentcolor`, ...getIconStyle(item) }}
        ></div>
        {item?.itemLevel && (
          <div class="text-amber-300 flex justify-between gap-2">
            <div>
              Item Level {item?.quality === 'HEIRLOOM' ? 24 : item?.itemLevel}
            </div>
            {item?.quality !== 'HEIRLOOM' && item?.requiredLevel && (
              <div>(Required {item?.requiredLevel})</div>
            )}
          </div>
        )}
        <div class="text-zinc-200">{item?.bind}</div>
        <div class="text-zinc-200 flex justify-between gap-2">
          <span>{item?.subclass && capitalize(item?.subclass)}</span>
          <span>{item?.class && capitalize(item?.class)}</span>
        </div>
        {item?.subclass && (
          <div class="text-zinc-200 flex justify-between gap-2">
            <span>{item?.type && capitalize(item?.type)}</span>
            <span>
              {[
                (Number(item?.armor) > 0 ||
                  (item?.quality === 'HEIRLOOM' && item?.class === 'ARMOR')) &&
                  `+${item?.armor || '??'}`,
                item?.dps && `${item?.dps} dps`,
              ]
                .filter(Boolean)
                .join(' ')}
            </span>
          </div>
        )}
        {item?.dps && (
          <div class="text-zinc-200 flex justify-between gap-2">
            <span>
              {item?.dmgMin} - {item?.dmgMax}
            </span>
            <span>{item?.speed}s</span>
          </div>
        )}
        {Object.entries(item?.stats || {}).map(([name, qty]) => (
          <div>
            <span class="text-blue-200">+{qty}</span>{' '}
            <span class="text-green-200">{name}</span>
          </div>
        ))}
        {Object.entries(item?.rand || {}).map(([rand, { chance, stats }]) => (
          <div class="mt-1">
            <div>
              ...{rand} <span class="text-zinc-400">({chance}%)</span>
            </div>
            <div>
              {Object.entries(stats || {}).map(([name, qty], i) => (
                <>
                  {i > 0 ? <span class="text-zinc-400">{' / '}</span> : null}
                  <span class="text-blue-200">+{qty}</span>{' '}
                  <span class="text-green-200">{name}</span>
                </>
              ))}
            </div>
          </div>
        ))}
        {item?.spell?.text && (
          <a
            href={`${wowheadUrl}spell=${item.spell.id}`}
            class="text-green-400 hover:underline"
          >
            {item?.spell?.text}
          </a>
        )}
        {item?.source && (
          <div class="text-zinc-200 flex justify-between gap-2">
            <a
              href={getItemSourceLink(item)}
              class="flex content-center hover:underline"
            >
              <div class={`${style[item.source]} w-[20px] h-[20px] bg-cover`} />
              <span class="text-purple-200 pl-1">
                {(source === 'DUNGEON' ? item.sourceZone : item.sourceName) ||
                  capitalize(item.source)}
              </span>
            </a>
            <span class="text-zinc-400 font-mono flex justify-between">
              item:{itemId}
            </span>
          </div>
        )}
        <div class="text-zinc-200 flex justify-between gap-2">
          <a
            href={`${wowheadUrl}item=${itemId}`}
            class="underline"
          >
            Open in wowhead
          </a>
          <Link href={closedHref} class="hover:underline">
            Close
          </Link>
        </div>
      </form>
      {children}
    </dialog>
  )
}
