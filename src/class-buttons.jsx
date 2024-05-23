import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { wowClasses } from './wow-classes'
import { useFetchJSON } from './hooks'

export const ClassButtons = () => {
  const [selectedClass, setSelectedClass] = useState(null)
  const [gear, setGear] = useState(null) 
  const { data } = useFetchJSON(`https://opensheet.elk.sh/1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ/Build+List`)

  // useEffect(()=> {
  //   console.log(gear)
  // }, [selectedClass]) 
  // This is just for debugging, uncomment to see we are indeed getting the right urls.

  const handleClick = (className) => {
    setSelectedClass(className)
    const matchingBuilds = data?.filter(item => item['Build Name'].startsWith(className))
    const bisBuild = matchingBuilds?.find(item => item['Build Name'].endsWith(' (BiS)'))
    // Not the cleanest solution but this is what I came up with.
    setGear(`https://opensheet.elk.sh/1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ/${encodeURIComponent(bisBuild['Build Name'])}/`)
  /* obviously we dont want to setGear to a url, but 
  I am having trouble using the useFetchJSON hook without errors here, 
  I need some help on this step. I AM SO CLOSE */
  }

  return (
    <div className="flex flex-wrap justify-center space-x-4">
      {wowClasses.map((className) => (
        <button
          key={className}
          className="class-button px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-opacity-50"
          onClick={() => handleClick(className)}
        >
          {className}
        </button>
      ))}
    </div>
  )
}

