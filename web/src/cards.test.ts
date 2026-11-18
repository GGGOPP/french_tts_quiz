import { describe, expect, it } from 'vitest'
import { cardId, cardsFor, hasMode, makeCard, modesFor, parseCardId } from './cards'
import type { Item } from './items'

function item(id: string, cloze = false): Item {
  return {
    id,
    fr: 'Il a mangé.',
    ...(cloze ? { cloze: ['Il ', { answers: ['a mangé'] }, '.'], point: 'pc' } : { topic: 'food' }),
    en: ['He ate.'],
    altFr: [],
    level: 'A1',
    grammar: [],
    audio: `audio/${id}.mp3`,
    audioSlow: `audio/${id}.slow.mp3`,
  }
}

describe('card ids', () => {
  it('are item id and mode', () => {
    expect(cardId('resto-03', 'dictee')).toBe('resto-03:dictee')
    expect(makeCard(item('pc-01', true), 'cloze').id).toBe('pc-01:cloze')
  })

  it('parse back', () => {
    expect(parseCardId('resto-03:dictee')).toEqual({ itemId: 'resto-03', mode: 'dictee' })
    expect(parseCardId('a:b:produce')).toEqual({ itemId: 'a:b', mode: 'produce' })
  })

  it('reject anything else', () => {
    expect(parseCardId('resto-03')).toBeUndefined()
    expect(parseCardId('resto-03:numbers')).toBeUndefined()
    expect(parseCardId(':cloze')).toBeUndefined()
  })
})

describe('modes', () => {
  it('gives every item dictée, meaning and production, and cloze only to drills', () => {
    expect(modesFor(item('t'))).toEqual(['dictee', 'meaning', 'produce'])
    expect(modesFor(item('g', true))).toEqual(['cloze', 'dictee', 'meaning', 'produce'])
    expect(hasMode(item('t'), 'cloze')).toBe(false)
  })

  it('makes cards for the items a mode can ask, in order', () => {
    const items = [item('t1'), item('g1', true), item('t2')]
    expect(cardsFor(items, 'cloze').map((c) => c.id)).toEqual(['g1:cloze'])
    expect(cardsFor(items, 'dictee').map((c) => c.id)).toEqual(['t1:dictee', 'g1:dictee', 't2:dictee'])
    expect(cardsFor(items, 'produce')[1]).toEqual({ id: 'g1:produce', item: items[1], mode: 'produce' })
  })
})
