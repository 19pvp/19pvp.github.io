import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { wowClasses } from './wow-classes'
import { useFetchJSON } from './hooks'
import { Item } from './item.jsx'

export const ClassButtons = () => {
  const [selectedClass, setSelectedClass] = useState(null)
  const buildRequest = useFetchJSON(`https://opensheet.elk.sh/1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ/Build+List`)
  const builds = buildRequest.data
  const matchingBuilds = builds?.filter(build => build['Build Name'].startsWith(selectedClass))
  const bisBuild = matchingBuilds?.find(build => build['Build Name'].endsWith(' (BiS)'))
  const bisSetRequest = useFetchJSON(bisBuild?.['Build Name'] && `https://opensheet.elk.sh/1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ/${encodeURIComponent(bisBuild['Build Name'])}/`)

  return (
    <div className="flex flex-wrap justify-center space-x-4">
      {wowClasses.map((className) => (
        <button
          key={className}
          className="class-button px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-opacity-50"
          onClick={() => setSelectedClass(className)}
        >
          {className}
        </button>
      ))}
      {bisSetRequest?.data && (
        <div>
          {bisSetRequest.data.map((item) => (
            <Item id={item.ID} />
          ))}
        </div>
      )}
    </div>
  )
}
