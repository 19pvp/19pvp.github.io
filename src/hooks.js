import { useState, useEffect } from 'preact/hooks'

const fetchBody = async (url, fetchOpts) => {
  const state = {}
  try {
    state.response = await fetch(url, fetchOpts)
    if (state.response.status !== 204) {
      state.body = await state.response.text()
    }
    state.error = state.response.ok
      ? undefined
      : Error(state.response.statusText)
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

export const useFetch = (url, fetchOpts, inputs = [url]) => {
  const [state, setState] = useState({ pending: true })
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies defined by the caller
  useEffect(() => {
    const controller = new AbortController()
    const opts = { ...fetchOpts, signal: controller.signal }
    fetchBody(url, opts).then((nextState) => {
      controller.signal.aborted || setState(nextState)
    })
    state.pending || setState({ pending: true })
    return () => controller.abort()
  }, inputs)

  return state
}
