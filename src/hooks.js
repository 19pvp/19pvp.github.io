import { useState, useEffect } from 'preact/hooks'

export const useEvent = (eventName, opts = false) => {
  const [event, setEvent] = useState({})
  useEffect(() => {
    addEventListener(eventName, setEvent, opts)
    return () => removeEventListener(eventName)
  }, [eventName, opts])
  return event
}

export const useWindowSize = () => {
  useEvent('resize') // We don't need the event, just to retrigger
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }
}

const fetchBody = async (url, fetchOpts) => {
  const state = {}
  try {
    state.response = await fetch(url, fetchOpts)
    if (state.response.status !== 204) {
      state.body = await state.response.text()
    }
    if (!state.response.ok) {
      state.error = Error(state.response.statusText)
    }
  } catch (error) {
    state.error = error
  }
  return state
}

export const useFetchJSON = (...args) => {
  const state = useFetch(...args)
  if (!state.body) return state
  try {
    state.data = JSON.parse(state.body)
  } catch (error) {
    state.error = error
  }
  return state
}

const cache = new Map()
export const useFetch = (url, fetchOpts, inputs = [url]) => {
  const withCache = (!fetchOpts?.method || fetchOpts.method === 'GET')
  const initialState = (withCache && cache.get(url)) || { isLoading: true }
  const [state, setState] = useState(initialState)
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies defined by the caller
  useEffect(() => {
    if (url == null) return
    const controller = new AbortController()
    const opts = { ...fetchOpts, signal: controller.signal }
    fetchBody(url, opts).then((nextState) => {
      if (controller.signal.aborted) return
      withCache && !nextState.error && cache.set(url, { ...nextState, fromCache: true })
      setState(nextState)
    })
    state.isLoading || setState({ ...state, isFetching: true })
    return () => controller.abort()
  }, inputs)

  return state
}
