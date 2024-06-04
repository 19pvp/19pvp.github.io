import { h } from 'preact'
import { nanoEvent } from './nano-event.js'

// Simple router
// Known drawbacks:
// - Only works for changes that use navigate or the Link element
// - 100 navigate + can crash on old safari devices
// - No path matching is done here just a hook and a trigger

const urlEvent = nanoEvent(new URL(location.href))
export const useUrl = urlEvent.use

const dispatchNavigation = () => {
  // If the path did change, we update the local state and trigger the change
  if (urlEvent.getState().href === location.href) return
  urlEvent.trigger(new URL(location.href))
}

addEventListener('popstate', dispatchNavigation)

export const navigate = (to: string, { replace = false } = {}) => {
  history[replace ? 'replaceState' : 'pushState']({}, '', to)
  dispatchNavigation()
}

export const withParams = (url: URL, newParams: { [k: string]: string }) => {
  const newURL = new URL(url)
  for (const [key, value] of Object.entries(newParams)) {
    newURL.searchParams.set(key, value)
  }
  return newURL.href
}

interface LinkProps extends h.JSX.HTMLAttributes<HTMLAnchorElement> {
  href: string
  onClick?: (event: h.JSX.TargetedMouseEvent<HTMLAnchorElement>) => void
}

export const Link = ({ href, onClick, ...props }: LinkProps) => (
  <a
    href={href}
    onClick={event => {
      onClick?.(event)
      // We don't want to skip if it's a special click
      // that would break the default browser behaviour
      const shouldSkip =
        event.defaultPrevented ||
        event.button ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      if (shouldSkip) return

      // In the normal case we handle the routing internally
      event.preventDefault()
      navigate(href)
    }}
    {...props}
  />
)
