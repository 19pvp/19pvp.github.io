import { useState, useEffect } from 'preact/hooks'

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

export const useFetch = (url, fetchOpts, inputs = [url]) => {
  const [state, setState] = useState({ isLoading: true })
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies defined by the caller
  useEffect(() => {
    if (url == null) return
    const controller = new AbortController()
    const opts = { ...fetchOpts, signal: controller.signal }
    fetchBody(url, opts).then((nextState) => {
      controller.signal.aborted || setState(nextState)
    })
    state.isLoading || setState({ ...state, isFetching: true })
    return () => controller.abort()
  }, inputs)

  return state
}
