import { h } from 'preact'
import { ClassButtons } from './class-buttons.tsx'
import { ToolTip } from './tooltip.jsx'
import { LoadingIndicator } from './loading-indicator.jsx'
import { ItemDialog } from './item-dialog.tsx'
import "preact/debug"
import { useUrl } from './router.tsx'

export const App = () => {
  const url = useUrl()
  const detailsOpen = url.hash.startsWith('#detail-item-')
  return (
    <div>
      <ItemDialog>
        {detailsOpen ? <ToolTip /> : null}
      </ItemDialog>
      <ClassButtons />
      {detailsOpen ? null : <ToolTip />}
      <LoadingIndicator />
    </div>
  )
}
