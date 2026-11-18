import { describe, expect, it } from 'vitest'
import { createStore, guardedStorage, isRecord, KEY_PREFIX, validEntries } from './storage'

/** An in-memory stand-in for localStorage. */
class FakeStorage {
  data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

/** Storage that throws on every call, like a blocked or full localStorage. */
const broken = {
  getItem(): string | null {
    throw new Error('SecurityError')
  },
  setItem(): void {
    throw new Error('QuotaExceededError')
  },
}

const STATS_KEY = `${KEY_PREFIX}stats`

describe('guarded storage', () => {
  it('round-trips JSON', () => {
    const storage = new FakeStorage()
    const disk = guardedStorage(() => storage)
    expect(disk.write('k', { a: [1, 'é'] })).toBe(true)
    expect(disk.read('k')).toEqual({ a: [1, 'é'] })
  })

  it('reads missing, corrupt or unreadable values as undefined', () => {
    const storage = new FakeStorage()
    const disk = guardedStorage(() => storage)
    expect(disk.read('missing')).toBeUndefined()
    storage.setItem('bad', '{not json')
    expect(disk.read('bad')).toBeUndefined()
    expect(guardedStorage(() => broken).read('k')).toBeUndefined()
  })

  it('reports failed writes instead of throwing', () => {
    expect(guardedStorage(() => broken).write('k', 1)).toBe(false)
    expect(guardedStorage(() => undefined).write('k', 1)).toBe(false)
    const throwingGetter = () => {
      throw new Error('SecurityError')
    }
    expect(guardedStorage(throwingGetter).write('k', 1)).toBe(false)
    expect(guardedStorage(throwingGetter).read('k')).toBeUndefined()
  })

  it('keeps only the valid entries of a map', () => {
    const isNumber = (v: unknown): v is number => typeof v === 'number'
    expect(validEntries({ a: 1, b: 'x', c: 2 }, isNumber)).toEqual({ a: 1, c: 2 })
    for (const notAMap of [undefined, null, [1, 2], 'str', 3]) expect(validEntries(notAMap, isNumber)).toEqual({})
  })

  it('tells plain objects from arrays and null', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
  })
})

describe('card stats', () => {
  it('starts empty', () => {
    const store = createStore(() => new FakeStorage())
    expect(store.stats('resto-03:dictee')).toBeUndefined()
    expect(store.allStats()).toEqual({})
  })

  it('counts seen, correct and when last seen', () => {
    const store = createStore(() => new FakeStorage())
    store.record('resto-03:dictee', true, 1000)
    store.record('resto-03:dictee', false, 2000)
    expect(store.record('resto-03:dictee', true, 3000)).toEqual({ seen: 3, correct: 2, lastSeen: 3000 })
    store.record('pce-01:cloze', false, 4000)
    expect(store.allStats()).toEqual({
      'resto-03:dictee': { seen: 3, correct: 2, lastSeen: 3000 },
      'pce-01:cloze': { seen: 1, correct: 0, lastSeen: 4000 },
    })
  })

  it('persists across page loads under the french-quiz key', () => {
    const storage = new FakeStorage()
    createStore(() => storage).record('pce-01:cloze', true, 1000)
    expect([...storage.data.keys()]).toEqual(['french-quiz:v1:stats'])
    expect(createStore(() => storage).stats('pce-01:cloze')).toEqual({ seen: 1, correct: 1, lastSeen: 1000 })
  })

  it('returns copies, not its own state', () => {
    const store = createStore(() => new FakeStorage())
    store.record('pce-01:cloze', true, 1000)
    store.stats('pce-01:cloze')!.seen = 99
    store.allStats()['pce-01:cloze'].seen = 99
    expect(store.stats('pce-01:cloze')!.seen).toBe(1)
  })
})

describe('when storage misbehaves', () => {
  it('works for the session if localStorage throws', () => {
    const store = createStore(() => broken)
    expect(store.stats('pce-01:cloze')).toBeUndefined()
    store.record('pce-01:cloze', true, 1000)
    expect(store.stats('pce-01:cloze')).toEqual({ seen: 1, correct: 1, lastSeen: 1000 })
  })

  it('works if localStorage is missing or its getter throws', () => {
    for (const getStorage of [
      () => undefined,
      () => {
        throw new Error('SecurityError')
      },
    ]) {
      const store = createStore(getStorage)
      store.record('pce-01:cloze', false, 1000)
      expect(store.stats('pce-01:cloze')).toEqual({ seen: 1, correct: 0, lastSeen: 1000 })
    }
  })

  it('works without the browser default (Node has no localStorage)', () => {
    const store = createStore()
    store.record('pce-01:cloze', true, 1000)
    expect(store.stats('pce-01:cloze')?.seen).toBe(1)
  })

  it('starts fresh from corrupt JSON and skips malformed entries', () => {
    const storage = new FakeStorage()
    storage.setItem(STATS_KEY, '{not json')
    expect(createStore(() => storage).allStats()).toEqual({})

    storage.setItem(
      STATS_KEY,
      JSON.stringify({
        good: { seen: 2, correct: 1, lastSeen: 5 },
        partial: { seen: 2 },
        text: { seen: '2', correct: 1, lastSeen: 5 },
        nothing: null,
      }),
    )
    const mixed = createStore(() => storage)
    expect(Object.keys(mixed.allStats())).toEqual(['good'])

    mixed.record('good', true, 9) // saving rewrites the cleaned-up map
    expect(JSON.parse(storage.getItem(STATS_KEY)!)).toEqual({ good: { seen: 3, correct: 2, lastSeen: 9 } })
  })
})
