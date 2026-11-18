import { describe, expect, it } from 'vitest'
import itemsJson from '../public/items.json?raw'
import { blanksOf, parseItems, type Item } from './items'

const real = JSON.parse(itemsJson) as unknown

/** A minimal valid items.json with one item, overridable per test. */
function bank(item: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    topics: [{ id: 'cafe', title: 'Café' }],
    grammarPoints: [{ id: 'pc', title: 'Passé composé', level: 'A2', rule: 'Use **avoir**.' }],
    items: [
      {
        id: 'cafe-01',
        fr: 'Un café, s’il vous plaît.',
        en: ['A coffee, please.'],
        level: 'A1',
        topic: 'cafe',
        audio: 'audio/cafe-01.mp3',
        audioSlow: 'audio/cafe-01.slow.mp3',
        ...item,
      },
    ],
    ...extra,
  }
}

describe('parseItems', () => {
  it('accepts the real items.json', () => {
    const { items, topics, grammarPoints } = parseItems(real)
    expect(items.length).toBeGreaterThan(600)
    const topicIds = new Set(topics.map((t) => t.id))
    const pointIds = new Set(grammarPoints.map((g) => g.id))
    for (const item of items) {
      // every item belongs to a known topic or grammar point, and drills have blanks
      if (item.topic) expect(topicIds.has(item.topic), item.id).toBe(true)
      if (item.point) {
        expect(pointIds.has(item.point), item.id).toBe(true)
        expect(item.cloze, item.id).toBeDefined()
      }
      for (const g of item.grammar) expect(pointIds.has(g), `${item.id}: ${g}`).toBe(true)
    }
  })

  it('fills in absent lists as empty', () => {
    const [item] = parseItems(bank()).items
    expect(item.altFr).toEqual([])
    expect(item.grammar).toEqual([])
  })

  it('keeps optional fields', () => {
    const cloze = ['Il ', { answers: ['a mangé'], hint: 'manger' }, '.']
    const [item] = parseItems(
      bank({ topic: undefined, point: 'pc', cloze, explain: 'avoir', register: 'formal', altFr: ['x'], grammar: ['pc'] }),
    ).items
    expect(item).toMatchObject({ point: 'pc', cloze, explain: 'avoir', register: 'formal', altFr: ['x'], grammar: ['pc'] })
  })

  it.each([
    ['no French', { fr: '' }, /cafe-01: no fr/],
    ['no slow clip', { audioSlow: undefined }, /no audioSlow/],
    ['no English', { en: [] }, /no English/],
    ['a bad level', { level: 'C2' }, /unknown level "C2"/],
    ['no topic or point', { topic: undefined }, /neither a topic nor a grammar point/],
    ['a bad register', { register: 'polite' }, /unknown register/],
    ['a cloze with no blanks', { cloze: ['Il a mangé.'] }, /no blanks/],
    ['a blank with no answers', { cloze: ['Il ', { answers: [] }] }, /blank has no answers/],
    ['altFr not a list', { altFr: 'x' }, /altFr/],
  ])('rejects an item with %s', (_, item, message) => {
    expect(() => parseItems(bank(item))).toThrow(message)
  })

  it('rejects duplicate ids', () => {
    const data = bank()
    data.items.push({ ...data.items[0] })
    expect(() => parseItems(data)).toThrow(/cafe-01: duplicate id/)
  })

  it('rejects malformed files', () => {
    expect(() => parseItems(null)).toThrow(/not an object/)
    expect(() => parseItems(bank({}, { version: 2 }))).toThrow(/version 2/)
    expect(() => parseItems(bank({}, { topics: undefined }))).toThrow(/topics/)
    expect(() => parseItems(bank({}, { grammarPoints: [{ id: 'x', title: 'X', level: 'A1' }] }))).toThrow(/grammar points/)
    expect(() => parseItems(bank({}, { items: [] }))).toThrow(/no items/)
  })
})

describe('blanksOf', () => {
  it('lists the blanks in order', () => {
    const cloze: NonNullable<Item['cloze']> = ['Je ', { answers: ['me'] }, ' ', { answers: ['lève'], hint: 'lever' }, '.']
    expect(blanksOf(cloze)).toEqual([{ answers: ['me'] }, { answers: ['lève'], hint: 'lever' }])
  })
})
