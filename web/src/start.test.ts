import { describe, expect, it } from 'vitest'
import itemsJson from '../public/items.json?raw'
import { LEVELS, parseItems } from './items'
import { initialChoice, summaryText } from './start'
import type { StartChoice } from './storage'

const bank = parseItems(JSON.parse(itemsJson))
const allTopics = bank.topics.map((t) => t.id)
const allPoints = bank.grammarPoints.map((g) => g.id)

const saved = (fields: Partial<StartChoice>): StartChoice => ({
  mode: 'dictee',
  source: 'topic',
  levels: ['A2'],
  topics: ['restaurant'],
  points: ['negation'],
  items: [],
  count: 20,
  ...fields,
})

describe('initialChoice', () => {
  it('defaults to grammar cloze, everything ticked, 10 questions', () => {
    expect(initialChoice(bank, undefined)).toEqual({
      mode: 'cloze',
      source: 'grammar',
      levels: [...LEVELS],
      topics: allTopics,
      points: allPoints,
      items: [],
      count: 10,
    })
  })

  it('keeps a saved choice, dropping what is no longer in the bank', () => {
    const choice = initialChoice(bank, saved({ topics: ['restaurant', 'gone'], items: ['resto-01', 'gone-01'] }))
    expect(choice).toMatchObject({ mode: 'dictee', source: 'topic', levels: ['A2'], topics: ['restaurant'], items: ['resto-01'], count: 20 })
  })

  it('falls back to everything when nothing saved is left', () => {
    const choice = initialChoice(bank, saved({ topics: ['gone'], points: [], levels: [] }))
    expect(choice.topics).toEqual(allTopics)
    expect(choice.points).toEqual(allPoints)
    expect(choice.levels).toEqual([...LEVELS])
  })

  it('a cloze choice is never by topic', () => {
    expect(initialChoice(bank, saved({ mode: 'cloze', source: 'topic' })).source).toBe('grammar')
  })

  it('a linked list replaces the saved list, unless none of it was found', () => {
    expect(initialChoice(bank, saved({ items: ['resto-02'] }), { ids: ['resto-01'], skipped: 1 })).toMatchObject({
      source: 'list',
      items: ['resto-01'],
    })
    expect(initialChoice(bank, saved({ items: ['resto-02'] }), { ids: [], skipped: 2 })).toMatchObject({
      source: 'topic',
      items: ['resto-02'],
    })
  })
})

describe('summaryText', () => {
  it('says how many questions from how many sentences', () => {
    expect(summaryText(40, 10, 'grammar', 'cloze')).toBe('10 questions from 40 sentences. Grammar cloze.')
    expect(summaryText(4, 10, 'topic', 'dictee')).toBe('4 questions from 4 sentences. Dictée.')
    expect(summaryText(1, 'all', 'list', 'meaning')).toBe('1 question from 1 sentence. Listen → meaning.')
    expect(summaryText(3, 'all', 'list', 'cloze', 2)).toBe('3 questions from 3 sentences (2 ticked have no gaps). Grammar cloze.')
  })

  it('says why Start is off', () => {
    expect(summaryText(5, undefined, 'grammar', 'cloze')).toBe('Type how many questions.')
    expect(summaryText(0, 10, 'topic', 'dictee')).toBe('Choose at least one topic.')
    expect(summaryText(0, 10, 'grammar', 'dictee')).toBe('Choose at least one grammar point.')
    expect(summaryText(0, 10, 'list', 'dictee')).toBe('Tick at least one sentence.')
    expect(summaryText(0, 10, 'list', 'cloze', 3)).toMatch(/^None of the ticked sentences has gaps/)
  })
})
