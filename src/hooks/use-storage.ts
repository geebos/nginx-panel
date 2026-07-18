import * as React from "react"

const LOCAL_STORAGE_EVENT = "local-storage"

function readLocalStorage<T>(key: string, initialValue: T): T {
  try {
    const item = window.localStorage.getItem(key)
    return item === null ? initialValue : (JSON.parse(item) as T)
  } catch {
    return initialValue
  }
}

// Reads a value from localStorage as an external store. SSR uses the provided
// initial value, then the client snapshot takes over after hydration.
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const snapshotRef = React.useRef<{ raw: string | null; value: T } | null>(
    null,
  )
  const getSnapshot = React.useCallback(
    () => {
      try {
        const raw = window.localStorage.getItem(key)
        if (snapshotRef.current?.raw === raw) {
          return snapshotRef.current.value
        }

        const value = raw === null ? initialValue : (JSON.parse(raw) as T)
        snapshotRef.current = { raw, value }
        return value
      } catch {
        snapshotRef.current = null
        return initialValue
      }
    },
    [initialValue, key],
  )

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      const handleStorageChange = (event: Event) => {
        if (event instanceof StorageEvent && event.key !== key) return
        onStoreChange()
      }

      window.addEventListener("storage", handleStorageChange)
      window.addEventListener(LOCAL_STORAGE_EVENT, handleStorageChange)
      return () => {
        window.removeEventListener("storage", handleStorageChange)
        window.removeEventListener(LOCAL_STORAGE_EVENT, handleStorageChange)
      }
    },
    [key],
  )

  const value = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => initialValue,
  )

  const set = React.useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = readLocalStorage(key, initialValue)
      const resolved =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next

      try {
        window.localStorage.setItem(key, JSON.stringify(resolved))
        window.dispatchEvent(new Event(LOCAL_STORAGE_EVENT))
      } catch {
        // Ignore write errors
      }
    },
    [initialValue, key],
  )

  return [value, set]
}
