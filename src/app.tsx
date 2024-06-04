import { h } from 'preact'
import { ClassButtons } from './class-buttons.tsx'
import { ToolTip } from './tooltip.jsx'
import { LoadingIndicator } from './loading-indicator.jsx'
import "preact/debug"

export const App = () => {
  return (
    <div>
      <ClassButtons />
      <ToolTip />
      <LoadingIndicator />
    </div>
  )
}
