// A card is one item asked in one exercise mode. Stats, learn sets and lists
// are kept per card, so knowing a sentence by ear (dictée) is tracked apart
// from producing it (English → French).

import type { Item } from './items'

/**
 * - cloze: fill the blanks of a grammar drill
 * - dictee: hear French, type French
 * - meaning: hear French, type English
 * - produce: read English, type French
 */
export type Mode = 'cloze' | 'dictee' | 'meaning' | 'produce'
export const MODES: readonly Mode[] = ['cloze', 'dictee', 'meaning', 'produce']

export const MODE_TITLES: Record<Mode, string> = {
  cloze: 'Grammar cloze',
  dictee: 'Dictée',
  meaning: 'Listen → meaning',
  produce: 'English → French',
}

export interface Card {
  /** `<item id>:<mode>`, e.g. "resto-03:dictee". */
  id: string
  item: Item
  mode: Mode
}

export const isMode = (value: unknown): value is Mode => MODES.includes(value as Mode)

export function cardId(itemId: string, mode: Mode): string {
  return `${itemId}:${mode}`
}

/** The item id and mode of a card id, or undefined if it isn't one. */
export function parseCardId(id: string): { itemId: string; mode: Mode } | undefined {
  const at = id.lastIndexOf(':')
  if (at <= 0) return undefined
  const mode = id.slice(at + 1)
  return isMode(mode) ? { itemId: id.slice(0, at), mode } : undefined
}

/** Whether an item can be asked in a mode: cloze needs blanks, every item has the others. */
export function hasMode(item: Item, mode: Mode): boolean {
  return mode !== 'cloze' || item.cloze !== undefined
}

/** The modes an item can be asked in. */
export function modesFor(item: Item): Mode[] {
  return MODES.filter((mode) => hasMode(item, mode))
}

export function makeCard(item: Item, mode: Mode): Card {
  return { id: cardId(item.id, mode), item, mode }
}

/** Cards for the items that can be asked in `mode`, in the items' order. */
export function cardsFor(items: readonly Item[], mode: Mode): Card[] {
  return items.filter((item) => hasMode(item, mode)).map((item) => makeCard(item, mode))
}
