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

/** True when nothing was typed in any box (or only spaces and punctuation): that's "don't know". */
export function isBlankAnswer(typed: readonly string[]): boolean {
  return typed.every((t) => !/[\p{L}\p{N}]/u.test(t))
}
