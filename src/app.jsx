import { h } from 'preact'
import { Item } from './wowhead.jsx'
import { ClassButtons } from './class-buttons'

export const App = () => {
  return (
    <div>
      <Item id={1482} />
      <ClassButtons />
    </div>
  )
}
