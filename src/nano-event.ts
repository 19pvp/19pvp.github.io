import { useState, useEffect } from 'preact/hooks'

const defaultCompare = <T>(a: T, b: T) => a === b
export const nanoEvent = <T>(currentState: T, compare: (a: T, b: T) => Boolean = defaultCompare) => {
  const listenners = new Set<Function>()
  const register = (fn: Function) => {
    if (typeof fn !== "function") throw Error('fn must be a function')
    listenners.add(fn)
    return () => listenners.delete(fn)
  }
  return {
    trigger(state: T) {
      if (compare(currentState, state)) return
      currentState = state
      for (const fn of listenners) fn(state)
    },
    getState: () => currentState,
    register,
    use() {
      const [state, setState] = useState(currentState)
      useEffect(() => register(setState))
      return state
    }
  }
}

export type NanoEvent = typeof nanoEvent
