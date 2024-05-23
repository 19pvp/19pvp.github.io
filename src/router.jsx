import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'

// Simple router
// Known drawbacks:
// - Only works for changes that use navigate or the Link element
// - 100 navigate + can crash on old safari devices
// - No path matching is done here just a hook and a trigger

let currentUrl = new URL(location.href)

const subs = new Set()
export const useUrl = () => {
  const [url, setUrl] = useState(currentUrl)

  // We register our hook to be updated on url changes
  useEffect(() => {
    subs.add(setUrl)
    return () => subs.delete(setUrl)
  })

  return url
}

const dispatchNavigation = () => {
  // If the path did change, we update the local state and trigger the change
  if (currentUrl.href === location.href) return
  currentUrl = new URL(location.href)
  for (const sub of subs) sub(currentUrl)
}

addEventListener('popstate', dispatchNavigation)

export const navigate = (to, { replace = false } = {}) => {
  history[replace ? 'replaceState' : 'pushState']({}, null, to)
  dispatchNavigation()
}

export const withParams = (url, newParams) => {
  const newURL = new URL(url)
  for (const [key, value] of Object.entries(newParams)) {
    newURL.searchParams.set(key, value)
  }
  return newURL.href
}

export const Link = ({ href, children, onClick, ...props }) => (
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
  >
    {children}
  </a>
)
