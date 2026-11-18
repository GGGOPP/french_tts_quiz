// What the app remembers between visits, kept in localStorage. Every read and
// write is guarded, so a blocked or broken storage (private windows, full quota,
// hand-edited JSON) only means nothing is remembered next time; the current
// session keeps working from memory.
//
// `guardedStorage` is the shared core; `createStore` builds the app's store on
// it: per-card stats, the start screen's last choice and the saved custom
// lists. Later parts (learn sets, settings, the LLM verdict cache) add their
// keys and validators here.

import { isMode, type Mode } from './cards'
import { LEVELS, type Level } from './items'
import { isQuestionCount, SOURCES, type QuestionCount, type Selection, type Source } from './selection'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Every key is namespaced and versioned, so a format change can move to v2 cleanly. */
export const KEY_PREFIX = 'french-quiz:v1:'
const STATS_KEY = `${KEY_PREFIX}stats`
const START_KEY = `${KEY_PREFIX}start`
const LISTS_KEY = `${KEY_PREFIX}lists`

/** Answers to one card (an item in one exercise mode). */
export interface CardStats {
  seen: number
  correct: number
  /** When the card was last answered, in ms since the epoch. */
  lastSeen: number
}

/** What was picked on the start screen last time. */
export interface StartChoice extends Selection {
  mode: Mode
  source: Source
  levels: Level[]
  topics: string[]
  points: string[]
  items: string[]
  count: QuestionCount
}

/** A named custom list of item ids. */
export interface SavedList {
  name: string
  ids: string[]
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

function isSavedList(value: unknown): value is SavedList {
  return isRecord(value) && typeof value.name === 'string' && value.name !== '' && isStringArray(value.ids)
}

/** Parse a saved start choice, or undefined if any part of it is malformed. */
export function toStartChoice(value: unknown): StartChoice | undefined {
  if (!isRecord(value)) return undefined
  const { mode, source, levels, topics, points, items, count } = value
  if (!isMode(mode) || !SOURCES.includes(source as Source) || !isQuestionCount(count)) return undefined
  if (![levels, topics, points, items].every(isStringArray)) return undefined
  return {
    mode,
    source: source as Source,
    levels: (levels as string[]).filter((l): l is Level => LEVELS.includes(l as Level)),
    topics: [...(topics as string[])],
    points: [...(points as string[])],
    items: [...(items as string[])],
    count,
  }
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

  // Saved lists: an array on disk (not a map keyed by name, so any name is safe), one per name.
  let lists: Map<string, string[]> | undefined
  function allLists(): Map<string, string[]> {
    if (lists) return lists
    lists = new Map()
    const parsed = disk.read(LISTS_KEY)
    if (Array.isArray(parsed)) for (const l of parsed) if (isSavedList(l)) lists.set(l.name, [...l.ids])
    return lists
  }
  const saveLists = () => disk.write(LISTS_KEY, [...allLists()].map(([name, ids]) => ({ name, ids })))

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

    /** The start screen's last choice, or undefined if none was saved (or it's unreadable). */
    startChoice(): StartChoice | undefined {
      return toStartChoice(disk.read(START_KEY))
    },

    saveStartChoice(choice: StartChoice): void {
      const { mode, source, levels, topics, points, items, count } = choice
      disk.write(START_KEY, { mode, source, levels, topics, points, items, count })
    },

    /** The saved custom lists, sorted by name. */
    savedLists(): SavedList[] {
      return [...allLists()]
        .map(([name, ids]) => ({ name, ids: [...ids] }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    },

    /** Save a list under a name, replacing any list already called that. */
    saveList(name: string, ids: readonly string[]): void {
      allLists().set(name, [...ids])
      saveLists()
    },

    deleteList(name: string): void {
      if (allLists().delete(name)) saveLists()
    },
  }
}

export type Store = ReturnType<typeof createStore>

/** The app's store, backed by the browser's localStorage. */
export const store: Store = createStore()
