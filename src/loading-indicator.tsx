import { h } from 'preact'
import { pendingRequests } from './hooks.ts'
import { spinner } from './spinner.tsx'

export const LoadingIndicator = () => {
  const hasRequests = pendingRequests.use()
  return (
    <div
      class={`
        h-10 top-6 right-6
        fixed pointer-events-none
        transition-opacity delay-50
        ${hasRequests ? 'opacity-100' : 'opacity-0'}`}
    >
      {spinner}
    </div>
  )
}
