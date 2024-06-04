import { h, Fragment } from 'preact'
import { wowClasses } from './wow-classes.js'
import { useSheet } from './hooks.js'
import { Build } from './build.jsx'
import { Link, useUrl, withParams } from './router.tsx'
import type { ItemData } from './item.tsx'
import * as style from './class-button.module.css'

type ClassButtonParams = {
  wowClass: keyof typeof wowClasses
  url: URL
  color: string
}

const ClassButton = ({ wowClass, url, color }: ClassButtonParams) => {
  const active =
    url.searchParams.get('class') === wowClass ? (style.active as string) : ''
  return (
    <Link
      class={[style.classButton, style[wowClass], active].join(' ')}
      style={{ color }}
      href={withParams(url, { class: wowClass })}
    ></Link>
  )
}

type Build = { ID: string; 'Build Name': string; Comment: string }
export const ClassButtons = () => {
  const url = useUrl()
  const selectedClass = url.searchParams.get('class') as
    | keyof typeof wowClasses
    | undefined
  const buildRequest = useSheet<ItemData[]>(
    selectedClass &&
      `${selectedClass[0]}${selectedClass.slice(1).toLowerCase()}`,
  )
  const buildItems =
    buildRequest.error || buildRequest.isFetching ? [] : buildRequest.data

  // TODO:
  // Build summary:
  // Total Armor / Total HP / Resistances / Resilience
  // Melee recap: AP / Crit / Hit / Expertise / Haste
  // Spell recap: MP / Spell Power / Crit / Hit / Haste


  // TODO: allow to switch equiped items
  return (
    <>
      <div class="flex flex-wrap justify-center space-x-4 p-10">
        {Object.entries(wowClasses).map(([wowClass, { color }]) => (
          <ClassButton
            key={wowClass}
            wowClass={wowClass}
            url={url}
            color={color}
          />
        ))}
      </div>
      <Build key={selectedClass} build={buildItems} name={selectedClass} />
    </>
  )
}
