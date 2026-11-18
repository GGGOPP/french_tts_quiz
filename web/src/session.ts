// Results of one quiz session: how each card went, and the running score.

import type { Card } from './cards'

/**
 * How an answer went:
 * - `typo`: right, give or take a typo (English answers only)
 * - `accent`: wrong, but only the accents are off (French answers are strict)
 * - `dont-know`: gave up (the button, or Enter with nothing typed)
 */
export type Outcome = 'correct' | 'typo' | 'accent' | 'wrong' | 'dont-know'

export interface CardResult {
  card: Card
  /** What was typed, one entry per answer box ([] for "Don't know"). */
  typed: string[]
  outcome: Outcome
  /** The answer couldn't be checked, so you marked it yourself (`outcome` is then correct or wrong). */
  selfMarked?: boolean
}

export interface Score {
  right: number
  wrong: number
}

/** Typos in English count as right; accent mistakes in French don't. */
export function isRight(outcome: Outcome): boolean {
  return outcome === 'correct' || outcome === 'typo'
}

export function tally(results: readonly Pick<CardResult, 'outcome'>[]): Score {
  const right = results.filter((r) => isRight(r.outcome)).length
  return { right, wrong: results.length - right }
}

export function scoreText({ right, wrong }: Score): string {
  return `${right} ✓ ${wrong} ✗`
}

/** The cards answered wrong (accent slips and "don't know" included), in the order they were asked. */
export function missed(results: readonly CardResult[]): CardResult[] {
  return results.filter((r) => !isRight(r.outcome))
}

/** The end-of-session headline, e.g. "7 of 10 right (70%)". */
export function summaryText({ right, wrong }: Score): string {
  const total = right + wrong
  if (total === 0) return 'No questions answered.'
  return `${right} of ${total} right (${Math.round((right / total) * 100)}%)`
}

/** Under the headline: how the misses split, and how many you marked yourself. Empty if nothing to say. */
export function breakdownText(results: readonly Pick<CardResult, 'outcome' | 'selfMarked'>[]): string {
  const count = (test: (r: Pick<CardResult, 'outcome' | 'selfMarked'>) => boolean) => results.filter(test).length
  const accents = count((r) => r.outcome === 'accent')
  const unknown = count((r) => r.outcome === 'dont-know')
  const marked = count((r) => r.selfMarked === true)
  return [
    accents > 0 ? `${accents} only off by accents` : '',
    unknown > 0 ? `${unknown} didn’t know` : '',
    marked > 0 ? `${marked} marked by you` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The small tag on a missed card saying how it was missed; undefined for a plain wrong answer. */
export function missedTag({ outcome, selfMarked }: Pick<CardResult, 'outcome' | 'selfMarked'>): string | undefined {
  if (outcome === 'accent') return 'Accents'
  if (outcome === 'dont-know') return 'Didn’t know'
  if (selfMarked) return 'Marked wrong'
  return undefined
}

/** True when nothing was typed in any box (or only spaces and punctuation): that's "don't know". */
export function isBlankAnswer(typed: readonly string[]): boolean {
  return typed.every((t) => !/[\p{L}\p{N}]/u.test(t))
}
