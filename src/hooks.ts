import { useState, useEffect } from 'preact/hooks'
import { nanoEvent } from './nano-event.ts'
import cachedItemsData from './cached-items.json'
import cachedBuildsData from './cached-builds.json'


type AddEventListenerParams = Parameters<typeof addEventListener>
type EventType = keyof WindowEventMap
type EventOpts = AddEventListenerParams[2]
export const useEvent = <EventName extends EventType>(eventName: EventName, opts?: EventOpts) => {
  const [event, setEvent] = useState<WindowEventMap[EventName] | null>(null)
  useEffect(() => {
    addEventListener(eventName, setEvent, opts || false)
    return () => removeEventListener(eventName, setEvent)
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

export const pendingRequests = nanoEvent(false)
const tracked = new Set<Promise<unknown>>()
const track = <T>(promise: Promise<T>) => {
  tracked.add(promise)
  pendingRequests.trigger(true)
  promise.finally(() => {
    tracked.delete(promise)
    pendingRequests.trigger(tracked.size > 0)
  })
  return promise
}

type FetchState = {
  response?: Response
  body?: string
  error?: Error
  isLoading?: boolean
  isFetching?: boolean
  fromCache?: boolean
}
type FetchParams = Parameters<typeof fetch>
const fetchBody = async (input: FetchParams[0], init?: FetchParams[1]) => {
  const state: FetchState = {}
  try {
    state.response = await fetch(input, init)
    if (state.response.status !== 204) {
      state.body = await state.response.text()
    }
    if (!state.response.ok) {
      state.error = Error(state.response.statusText)
    }
  } catch (error) {
    error instanceof Error && (state.error = error)
  }
  return state
}

type FetchJSONState<T> = { data?: T } & FetchState
export const useFetchJSON = <T>(input: FetchParams[0] | undefined | null, init?: FetchParams[1]) => {
  const state: FetchJSONState<T> = useFetch(input, init)
  if (!state.body) return state
  try {
    state.data = JSON.parse(state.body)
  } catch (error) {
    error instanceof Error && (state.error = error)
  }
  return state
}

type UseEffectInputs = Parameters<typeof useEffect>[1]
const cache = new Map<FetchParams[0], FetchState>()
export const useFetch = (input: FetchParams[0] | undefined | null, init?: FetchParams[1], inputs?: UseEffectInputs) => {
  const withCache = !init?.method || init.method === 'GET'
  const [state, setState] = useState<FetchState>({
      isLoading: true,
      isFetching: true,
    },
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies defined by the caller
  useEffect(() => {
    if (input == null) return setState({ isLoading: true, isFetching: true })
    const controller = new AbortController()
    const initWithSignal = { ...init, signal: controller.signal }
    track(fetchBody(input, initWithSignal)).then(nextState => {
      if (controller.signal.aborted) return
      withCache &&
        !nextState.error &&
        cache.set(input, { ...nextState, fromCache: true })
      setState(nextState)
    })
    state.isLoading ||
        setState({ ...state, isFetching: true })
    return () => controller.abort('timeout')
  }, inputs || [input])

  if (!input || !withCache || (!state.isLoading && !state.isFetching)) return state
  return cache.get(input) || state
}

const sheetsDocumentId = '1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ'
export const useSheet = <T>(sheetName: string | undefined | null) =>
  useFetchJSON<T>(
    sheetName && `https://opensheet.elk.sh/${sheetsDocumentId}/${sheetName}`,
  )

// Populate cache !
for (const item of Object.values(cachedItemsData)) {
  cache.set(`https://19pvp.github.io/data/items/${item.id}.json`, {
    fromCache: true,
    body: JSON.stringify(item),
  })
}
for (const [className, build] of Object.entries(cachedBuildsData)) {
  cache.set(`https://opensheet.elk.sh/${sheetsDocumentId}/${className}`, {
    fromCache: true,
    body: JSON.stringify(build),
  })
}

console.log(cache)
