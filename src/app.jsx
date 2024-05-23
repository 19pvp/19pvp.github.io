import { h } from 'preact'
import { ClassButtons } from './class-buttons.jsx'
import { ToolTip } from './tooltip.jsx'
import "preact/debug"

export const App = () => {
  return (
    <div>
      <ClassButtons />
      <ToolTip />
    </div>
  )
}
