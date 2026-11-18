import { describe, expect, it } from 'vitest'
import { isBlankAnswer, isRight, scoreText, tally, type Outcome } from './session'

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
