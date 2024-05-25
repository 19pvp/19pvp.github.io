import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { wowClasses } from './wow-classes.js'
import { useSheet } from './hooks.js'
import { Item } from './item.jsx'
import { Link, useUrl, withParams } from './router.jsx'
import * as style from './class-button.module.css'

const ClassButton = ({ wowclass, url }) => {
  const active = url.searchParams.get('class') === wowclass ? style.active : ''
  return (
    <Link
      class={[style.classButton, style[wowclass], active].join(' ')}
      href={withParams(url, { class: wowclass })}
    ></Link>
  )
}
export const ClassButtons = () => {
  const url = useUrl()
  const selectedClass = url.searchParams.get('class')
  const buildRequest = useSheet('Build List')
  const builds = buildRequest.data
  const bisBuild = builds?.find(build => {
    const name = build['Build Name'].toUpperCase()
    return name === (selectedClass)
  })
  const bisSetRequest = useSheet(bisBuild?.['Build Name'])

  return (
    <div class="flex flex-col items-center">
      <div class="flex flex-wrap justify-center space-x-4 p-10">
        {wowClasses.map(wowClass => (
          <ClassButton
            key={wowClass}
            wowclass={wowClass.toUpperCase()}
            url={url}
          />
        ))}
      </div>
      {bisSetRequest?.data && (
        <div class="flex flex-col gap-2 w-[520px]">
          {bisSetRequest.data.map(item => (
            <Item
              id={item.ID}
              wowclass={selectedClass}
              rand={item['Random Enchant']}
              enchant={item['Enchant ID']}
            />
          ))}
        </div>
      )}
    </div>
  )
}
