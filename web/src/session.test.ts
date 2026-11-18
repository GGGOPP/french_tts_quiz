import { describe, expect, it } from 'vitest'
import type { Card } from './cards'
import { breakdownText, isBlankAnswer, isRight, missed, missedTag, scoreText, summaryText, tally, type CardResult, type Outcome } from './session'

describe('isRight', () => {
  it.each<[Outcome, boolean]>([
    ['correct', true],
    ['typo', true],
    ['accent', false],
    ['wrong', false],
    ['dont-know', false],
  ])('%s → %s', (outcome, right) => {
    expect(isRight(outcome)).toBe(right)
  })
})

describe('tally and scoreText', () => {
  it('counts right and wrong', () => {
    const score = tally([{ outcome: 'correct' }, { outcome: 'typo' }, { outcome: 'accent' }, { outcome: 'dont-know' }])
    expect(score).toEqual({ right: 2, wrong: 2 })
    expect(scoreText(score)).toBe('2 ✓ 2 ✗')
    expect(tally([])).toEqual({ right: 0, wrong: 0 })
  })
})

describe('isBlankAnswer', () => {
  it('is true when no box has a letter or digit', () => {
    expect(isBlankAnswer([''])).toBe(true)
    expect(isBlankAnswer(['  ', ' ?! '])).toBe(true)
    expect(isBlankAnswer([])).toBe(true)
  })

  it('is false once any box has something', () => {
    expect(isBlankAnswer(['', 'à'])).toBe(false)
    expect(isBlankAnswer(['7'])).toBe(false)
    expect(isBlankAnswer(['é'])).toBe(false)
  })
})

const result = (id: string, outcome: Outcome, selfMarked?: boolean): CardResult => ({
  card: { id } as Card,
  typed: [],
  outcome,
  ...(selfMarked ? { selfMarked } : {}),
})

describe('missed', () => {
  it('keeps the wrong, accent and don’t-know cards in the order asked', () => {
    const results = [
      result('a', 'correct'),
      result('b', 'accent'),
      result('c', 'typo'),
      result('d', 'dont-know'),
      result('e', 'wrong', true),
    ]
    expect(missed(results).map((r) => r.card.id)).toEqual(['b', 'd', 'e'])
    expect(missed([])).toEqual([])
  })
})

describe('summaryText', () => {
  it('gives the score and percentage', () => {
    expect(summaryText({ right: 7, wrong: 3 })).toBe('7 of 10 right (70%)')
    expect(summaryText({ right: 2, wrong: 1 })).toBe('2 of 3 right (67%)')
    expect(summaryText({ right: 0, wrong: 4 })).toBe('0 of 4 right (0%)')
  })

  it('says when nothing was answered', () => {
    expect(summaryText({ right: 0, wrong: 0 })).toBe('No questions answered.')
  })
})

describe('breakdownText', () => {
  it('counts accent slips, don’t-knows and self-marked answers', () => {
    const results = [
      result('a', 'accent'),
      result('b', 'accent'),
      result('c', 'dont-know'),
      result('d', 'correct', true),
      result('e', 'wrong', true),
      result('f', 'wrong'),
    ]
    expect(breakdownText(results)).toBe('2 only off by accents · 1 didn’t know · 2 marked by you')
  })

  it('leaves out what didn’t happen, and is empty when nothing did', () => {
    expect(breakdownText([result('a', 'dont-know'), result('b', 'correct')])).toBe('1 didn’t know')
    expect(breakdownText([result('a', 'wrong'), result('b', 'typo')])).toBe('')
  })
})

describe('missedTag', () => {
  it('names how a card was missed', () => {
    expect(missedTag(result('a', 'accent'))).toBe('Accents')
    expect(missedTag(result('a', 'dont-know'))).toBe('Didn’t know')
    expect(missedTag(result('a', 'wrong', true))).toBe('Marked wrong')
    expect(missedTag(result('a', 'wrong'))).toBeUndefined()
  })
})
