// Choosing the cards for a session: by topic, by grammar point or from a
// custom list, narrowed by level, in one exercise mode, then a random
// selection of the chosen size.

import { hasMode, makeCard, type Card, type Mode } from './cards'
import { LEVELS, type Item, type Level } from './items'

/** How many questions: a number, or every card that matches. */
export type QuestionCount = number | 'all'
/** The counts offered as one-tap choices on the start screen. */
export const PRESET_COUNTS: readonly QuestionCount[] = [10, 20, 'all']
export const DEFAULT_COUNT: QuestionCount = 10

export function isQuestionCount(value: unknown): value is QuestionCount {
  return value === 'all' || (Number.isSafeInteger(value) && (value as number) >= 1)
}

/** A typed question count ("15", " 7 "), or undefined unless it's a whole number of at least 1. */
export function parseQuestionCount(text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const n = Number(trimmed)
  return isQuestionCount(n) ? n : undefined
}

/** Where a session's sentences come from. */
export type Source = 'topic' | 'grammar' | 'list'
export const SOURCES: readonly Source[] = ['topic', 'grammar', 'list']

/** What the start screen chooses from (everything except the mode and the count). */
export interface Selection {
  source: Source
  /** Levels to include (topic and grammar sources only; a custom list is taken as picked). */
  levels: readonly Level[]
  topics: readonly string[]
  points: readonly string[]
  /** Item ids of the custom list. */
  items: readonly string[]
}

/**
 * Whether an item practises a grammar point. A cloze card tests the point of
 * its drill; in the other modes, any sentence tagged with the point counts
 * (a topic sentence using the passé composé is passé composé practice by ear).
 */
export function practisesPoint(item: Item, point: string, mode: Mode): boolean {
  return mode === 'cloze' ? item.point === point : item.grammar.includes(point)
}

/** The items a selection takes in a mode, in bank order (before the count is applied). */
export function selectedItems(items: readonly Item[], mode: Mode, sel: Selection): Item[] {
  const usable = items.filter((item) => hasMode(item, mode))
  if (sel.source === 'list') {
    const ids = new Set(sel.items)
    return usable.filter((item) => ids.has(item.id))
  }
  const levels = new Set(sel.levels)
  const inLevel = usable.filter((item) => levels.has(item.level))
  if (sel.source === 'topic') {
    const topics = new Set(sel.topics)
    return inLevel.filter((item) => item.topic !== undefined && topics.has(item.topic))
  }
  return inLevel.filter((item) => sel.points.some((p) => practisesPoint(item, p, mode)))
}

/** How many items each topic has in a mode and levels. */
export function topicCounts(items: readonly Item[], mode: Mode, levels: readonly Level[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const item of items) {
    if (!item.topic || !levels.includes(item.level) || !hasMode(item, mode)) continue
    out.set(item.topic, (out.get(item.topic) ?? 0) + 1)
  }
  return out
}

/** How many items practise each grammar point in a mode and levels. */
export function pointCounts(items: readonly Item[], mode: Mode, levels: readonly Level[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const item of items) {
    if (!levels.includes(item.level) || !hasMode(item, mode)) continue
    const points = mode === 'cloze' ? (item.point ? [item.point] : []) : item.grammar
    for (const p of new Set(points)) out.set(p, (out.get(p) ?? 0) + 1)
  }
  return out
}

/** A shuffled copy of `list` (Fisher–Yates). */
export function shuffle<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The cards for one session: `count` of the selected items (or all), in random order. */
export function pickCards(
  items: readonly Item[],
  mode: Mode,
  sel: Selection,
  count: QuestionCount,
  random: () => number = Math.random,
): Card[] {
  const pool = shuffle(selectedItems(items, mode, sel), random)
  return (count === 'all' ? pool : pool.slice(0, count)).map((item) => makeCard(item, mode))
}

/** Cloze cards for one grammar point (the rule browser's Practise button). */
export function pointDrills(items: readonly Item[], point: string, count: QuestionCount, random: () => number = Math.random): Card[] {
  const sel: Selection = { source: 'grammar', levels: LEVELS, topics: [], points: [point], items: [] }
  return pickCards(items, 'cloze', sel, count, random)
}
