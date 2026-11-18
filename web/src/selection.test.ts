import { describe, expect, it } from 'vitest'
import itemsJson from '../public/items.json?raw'
import { MODES } from './cards'
import { LEVELS, parseItems, type Item } from './items'
import {
  isQuestionCount,
  parseQuestionCount,
  pickCards,
  pointCounts,
  pointDrills,
  practisesPoint,
  selectedItems,
  shuffle,
  topicCounts,
  type Selection,
} from './selection'

function item(id: string, fields: Partial<Item>): Item {
  return {
    id,
    fr: 'Il a mangé.',
    en: ['He ate.'],
    altFr: [],
    level: 'A1',
    grammar: [],
    audio: `audio/${id}.mp3`,
    audioSlow: `audio/${id}.slow.mp3`,
    ...fields,
  }
}

const drill = (id: string, point: string, level: Item['level'] = 'A1', extra: string[] = []) =>
  item(id, { point, level, grammar: [point, ...extra], cloze: ['Il ', { answers: ['a mangé'] }, '.'] })

const ITEMS: Item[] = [
  item('resto-01', { topic: 'restaurant', grammar: ['conditional-politeness'] }),
  item('resto-02', { topic: 'restaurant', level: 'A2', grammar: ['passe-compose-avoir'] }),
  item('travel-01', { topic: 'travel', level: 'A2' }),
  drill('pca-01', 'passe-compose-avoir', 'A2'),
  drill('pca-02', 'passe-compose-avoir', 'A2', ['negation']),
  drill('neg-01', 'negation'),
]

const sel = (fields: Partial<Selection>): Selection => ({
  source: 'grammar',
  levels: LEVELS,
  topics: [],
  points: [],
  items: [],
  ...fields,
})

const ids = (items: readonly { id: string }[]) => items.map((i) => i.id)

describe('question counts', () => {
  it('accepts whole numbers of at least 1, and all', () => {
    expect([1, 10, 'all'].every(isQuestionCount)).toBe(true)
    expect([0, -1, 1.5, '10', NaN, null].some(isQuestionCount)).toBe(false)
    expect(parseQuestionCount(' 15 ')).toBe(15)
    for (const bad of ['', '0', '1.5', '-3', 'ten', '1e3']) expect(parseQuestionCount(bad)).toBeUndefined()
  })
})

describe('practisesPoint', () => {
  it('in cloze, only the drill’s own point; elsewhere, any tag', () => {
    const pca02 = ITEMS[4]
    expect(practisesPoint(pca02, 'passe-compose-avoir', 'cloze')).toBe(true)
    expect(practisesPoint(pca02, 'negation', 'cloze')).toBe(false)
    expect(practisesPoint(pca02, 'negation', 'dictee')).toBe(true)
  })
})

describe('selectedItems', () => {
  it('by topic, narrowed by level; never in cloze', () => {
    expect(ids(selectedItems(ITEMS, 'dictee', sel({ source: 'topic', topics: ['restaurant'] })))).toEqual(['resto-01', 'resto-02'])
    expect(ids(selectedItems(ITEMS, 'dictee', sel({ source: 'topic', topics: ['restaurant'], levels: ['A1'] })))).toEqual(['resto-01'])
    expect(selectedItems(ITEMS, 'cloze', sel({ source: 'topic', topics: ['restaurant', 'travel'] }))).toEqual([])
  })

  it('by grammar: drills in cloze, every tagged sentence in the other modes', () => {
    const pca = sel({ points: ['passe-compose-avoir'] })
    expect(ids(selectedItems(ITEMS, 'cloze', pca))).toEqual(['pca-01', 'pca-02'])
    expect(ids(selectedItems(ITEMS, 'produce', pca))).toEqual(['resto-02', 'pca-01', 'pca-02'])
    expect(ids(selectedItems(ITEMS, 'cloze', sel({ points: ['negation'] })))).toEqual(['neg-01'])
    expect(ids(selectedItems(ITEMS, 'meaning', sel({ points: ['negation'] })))).toEqual(['pca-02', 'neg-01'])
    expect(selectedItems(ITEMS, 'cloze', sel({ points: ['negation'], levels: ['A2'] }))).toEqual([])
  })

  it('a custom list ignores levels, and cloze skips sentences without gaps', () => {
    const list = sel({ source: 'list', items: ['travel-01', 'neg-01', 'gone-99'], levels: [] })
    expect(ids(selectedItems(ITEMS, 'dictee', list))).toEqual(['travel-01', 'neg-01'])
    expect(ids(selectedItems(ITEMS, 'cloze', list))).toEqual(['neg-01'])
  })
})

describe('counts', () => {
  it('per topic and per grammar point, by mode and level', () => {
    expect(topicCounts(ITEMS, 'dictee', LEVELS)).toEqual(new Map([['restaurant', 2], ['travel', 1]]))
    expect(topicCounts(ITEMS, 'dictee', ['A1'])).toEqual(new Map([['restaurant', 1]]))
    expect(topicCounts(ITEMS, 'cloze', LEVELS).size).toBe(0)
    expect(pointCounts(ITEMS, 'cloze', LEVELS)).toEqual(new Map([['passe-compose-avoir', 2], ['negation', 1]]))
    expect(pointCounts(ITEMS, 'dictee', LEVELS).get('passe-compose-avoir')).toBe(3)
    expect(pointCounts(ITEMS, 'dictee', LEVELS).get('negation')).toBe(2)
  })

  it('agree with selectedItems on the real bank', () => {
    const bank = parseItems(JSON.parse(itemsJson))
    for (const mode of MODES) {
      for (const levels of [LEVELS, ['A1'] as const, ['A2', 'B1'] as const]) {
        const points = pointCounts(bank.items, mode, levels)
        for (const g of bank.grammarPoints) {
          expect(selectedItems(bank.items, mode, sel({ points: [g.id], levels })).length).toBe(points.get(g.id) ?? 0)
        }
        const topics = topicCounts(bank.items, mode, levels)
        for (const t of bank.topics) {
          expect(selectedItems(bank.items, mode, sel({ source: 'topic', topics: [t.id], levels })).length).toBe(topics.get(t.id) ?? 0)
        }
      }
    }
    // Every grammar point has drills, every topic has sentences.
    const drills = pointCounts(bank.items, 'cloze', LEVELS)
    expect(bank.grammarPoints.every((g) => (drills.get(g.id) ?? 0) > 0)).toBe(true)
    const all = sel({ points: bank.grammarPoints.map((g) => g.id) })
    expect(selectedItems(bank.items, 'cloze', all).length).toBe(bank.items.filter((i) => i.cloze).length)
  })
})

describe('pickCards', () => {
  it('takes count cards (or all) in the chosen mode, without repeats', () => {
    const all = sel({ source: 'topic', topics: ['restaurant', 'travel'] })
    const two = pickCards(ITEMS, 'meaning', all, 2)
    expect(two).toHaveLength(2)
    expect(two.every((c) => c.mode === 'meaning' && c.id === `${c.item.id}:meaning`)).toBe(true)
    expect(new Set(ids(two.map((c) => c.item))).size).toBe(2)
    expect(pickCards(ITEMS, 'meaning', all, 'all')).toHaveLength(3)
    expect(pickCards(ITEMS, 'meaning', all, 50)).toHaveLength(3)
  })

  it('shuffles with the given random source', () => {
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1])
    expect(shuffle([1, 2, 3, 4], () => 0.999)).toEqual([1, 2, 3, 4])
  })

  it('pointDrills gives one point’s cloze cards at every level', () => {
    const cards = pointDrills(ITEMS, 'passe-compose-avoir', 'all')
    expect(ids(cards.map((c) => c.item)).sort()).toEqual(['pca-01', 'pca-02'])
    expect(cards.every((c) => c.mode === 'cloze')).toBe(true)
    expect(pointDrills(ITEMS, 'negation', 10)).toHaveLength(1)
  })
})
