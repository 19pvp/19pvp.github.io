import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { wowClasses } from './wow-classes'
import { useFetchJSON } from './hooks'

export const ClassButtons = () => {
  const [selectedClass, setSelectedClass] = useState(null) // State for class user clicks.
  const [gear, setGear] = useState(null) // State for gear shown on the page.
    // const { data } = useFetchJSON(
    //   selectedClass ? `https://opensheet.elk.sh/1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ/${selectedClass}: Sub (ALLY)` : null
    // ) Do I need this? 

    useEffect(() => {
      console.log('Fetching data for:', selectedClass)
      useFetchJSON(`https://opensheet.elk.sh/1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ/${selectedClass}: Sub (ALLY)`)
    }, [selectedClass]);
    // This useEffect will log the class on click and attempt to fetch data, will only work for rogue, but im getting errors.

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
    </div>
  )
  }
