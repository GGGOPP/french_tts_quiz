// What the app remembers between visits, kept in localStorage. Every read and
// write is guarded, so a blocked or broken storage (private windows, full quota,
// hand-edited JSON) only means nothing is remembered next time; the current
// session keeps working from memory.
//
// `guardedStorage` is the shared core; `createStore` builds the app's store on
// it. Later parts (start-screen choice, custom lists, learn sets, settings, the
// LLM verdict cache) add their keys and validators here.

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Every key is namespaced and versioned, so a format change can move to v2 cleanly. */
export const KEY_PREFIX = 'french-quiz:v1:'
const STATS_KEY = `${KEY_PREFIX}stats`

/** Answers to one card (an item in one exercise mode). */
export interface CardStats {
  seen: number
  correct: number
  /** When the card was last answered, in ms since the epoch. */
  lastSeen: number
}

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((s) => typeof s === 'string')

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function isStats(value: unknown): value is CardStats {
  if (!isRecord(value)) return false
  const { seen, correct, lastSeen } = value
  return [seen, correct, lastSeen].every(isFiniteNumber)
}

/** Keep only the entries of a parsed JSON object that pass `valid`; anything else is an empty map. */
export function validEntries<T>(parsed: unknown, valid: (v: unknown) => v is T): Record<string, T> {
  const out: Record<string, T> = {}
  if (isRecord(parsed)) for (const [id, v] of Object.entries(parsed)) if (valid(v)) out[id] = v
  return out
}

/** JSON reads and writes that never throw. */
export function guardedStorage(getStorage: () => StorageLike | undefined = () => globalThis.localStorage) {
  function storage(): StorageLike | undefined {
    try {
      return getStorage() ?? undefined // reading window.localStorage itself can throw
    } catch {
      return undefined
    }
  }

  return {
    /** The parsed value at `key`, or undefined if it is missing, corrupt or unreadable. */
    read(key: string): unknown {
      try {
        const raw = storage()?.getItem(key)
        return raw == null ? undefined : (JSON.parse(raw) as unknown)
      } catch {
        return undefined
      }
    },

    /** Save `value` as JSON. Returns false if storage is full or blocked. */
    write(key: string, value: unknown): boolean {
      try {
        const s = storage()
        if (!s) return false
        s.setItem(key, JSON.stringify(value))
        return true
      } catch {
        return false
      }
    },
  }
}

export type GuardedStorage = ReturnType<typeof guardedStorage>

export function createStore(getStorage?: () => StorageLike | undefined) {
  const disk = guardedStorage(getStorage)

  // Loaded once; writes go to memory first so the session works even if saving fails.
  let stats: Record<string, CardStats> | undefined
  const allStats = () => (stats ??= validEntries(disk.read(STATS_KEY), isStats))

  return {
    /** Results for one card, or undefined if it has never been answered. */
    stats(id: string): CardStats | undefined {
      const s = allStats()[id]
      return s && { ...s }
    },

    /** Results for every card answered so far, by id. */
    allStats(): Record<string, CardStats> {
      return structuredClone(allStats())
    },

    /** Count one answer to a card. */
    record(id: string, wasCorrect: boolean, now: number = Date.now()): CardStats {
      const all = allStats()
      const prev = all[id] ?? { seen: 0, correct: 0, lastSeen: 0 }
      const next = { seen: prev.seen + 1, correct: prev.correct + (wasCorrect ? 1 : 0), lastSeen: now }
      all[id] = next
      disk.write(STATS_KEY, all)
      return { ...next }
    },
  }
}

export type Store = ReturnType<typeof createStore>

/** The app's store, backed by the browser's localStorage. */
export const store: Store = createStore()
