// The item bank written by the pipeline (public/items.json): French sentences
// and phrases, the grammar points with their rule cards, and the topics.

export type Level = 'A1' | 'A2' | 'B1'
export const LEVELS: readonly Level[] = ['A1', 'A2', 'B1']

/** A gap in a cloze sentence: the accepted forms and the hint shown in it (e.g. the infinitive). */
export interface Blank {
  answers: string[]
  hint?: string
}

/** A cloze sentence as alternating text runs and blanks. */
export type ClozePart = string | Blank

export type Register = 'formal' | 'informal'

export interface Item {
  id: string
  /** The sentence as spoken, blanks filled in. */
  fr: string
  /** Present on grammar drills: the sentence with its blanks. */
  cloze?: ClozePart[]
  /** Accepted English meanings (the first is the main one). */
  en: string[]
  /** More accepted French, for English → French. Empty if none. */
  altFr: string[]
  level: Level
  /** Topic id, for topic sentences. */
  topic?: string
  /** Grammar point id, for grammar drills. */
  point?: string
  /** Grammar point ids the sentence practises. Empty if none. */
  grammar: string[]
  /** When tu/vous matters to the meaning. */
  register?: Register
  /** Why the cloze answer is what it is. */
  explain?: string
  notes?: string
  /** Clip paths relative to the site root: normal speed and slow. */
  audio: string
  audioSlow: string
}

export interface Topic {
  id: string
  title: string
}

export interface GrammarPoint {
  id: string
  title: string
  level: Level
  /** The rule card, in Markdown. */
  rule: string
}

export interface ItemBank {
  topics: Topic[]
  grammarPoints: GrammarPoint[]
  items: Item[]
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)
const isLevel = (v: unknown): v is Level => LEVELS.includes(v as Level)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function problemWithBlank(part: unknown): string | undefined {
  if (!isObject(part)) return 'a cloze part is neither text nor a blank'
  if (!isStrings(part.answers) || part.answers.length === 0) return 'a blank has no answers'
  if (part.hint !== undefined && !isString(part.hint)) return 'a blank hint is not text'
  return undefined
}

/** Why an item is malformed, or undefined if it is fine. */
function problemWithItem(v: unknown): string | undefined {
  if (!isObject(v)) return 'not an object'
  for (const key of ['id', 'fr', 'audio', 'audioSlow'] as const) {
    if (!isString(v[key]) || v[key] === '') return `no ${key}`
  }
  if (!isStrings(v.en) || v.en.length === 0) return 'no English'
  if (v.altFr !== undefined && !isStrings(v.altFr)) return 'altFr is not a list of text'
  if (v.grammar !== undefined && !isStrings(v.grammar)) return 'grammar is not a list of text'
  if (!isLevel(v.level)) return `unknown level ${JSON.stringify(v.level)}`
  if (!isString(v.topic) && !isString(v.point)) return 'neither a topic nor a grammar point'
  if (v.register !== undefined && v.register !== 'formal' && v.register !== 'informal') return 'unknown register'
  for (const key of ['explain', 'notes'] as const) {
    if (v[key] !== undefined && !isString(v[key])) return `${key} is not text`
  }
  if (v.cloze !== undefined) {
    if (!Array.isArray(v.cloze)) return 'cloze is not a list'
    let blanks = 0
    for (const part of v.cloze) {
      if (isString(part)) continue
      const problem = problemWithBlank(part)
      if (problem) return problem
      blanks++
    }
    if (blanks === 0) return 'cloze has no blanks'
  }
  return undefined
}

/** Check the shape of parsed items.json; throws with a short reason if it's wrong. */
export function parseItems(data: unknown): ItemBank {
  if (!isObject(data)) throw new Error('items.json is not an object')
  if (data.version !== 1) throw new Error(`items.json has unknown version ${JSON.stringify(data.version)}`)

  const { topics, grammarPoints, items } = data
  if (!Array.isArray(topics) || !topics.every((t) => isObject(t) && isString(t.id) && isString(t.title))) {
    throw new Error('items.json has no list of topics')
  }
  if (
    !Array.isArray(grammarPoints) ||
    !grammarPoints.every((g) => isObject(g) && isString(g.id) && isString(g.title) && isLevel(g.level) && isString(g.rule))
  ) {
    throw new Error('items.json has no list of grammar points')
  }
  if (!Array.isArray(items) || items.length === 0) throw new Error('items.json has no items')

  const ids = new Set<string>()
  const out: Item[] = []
  for (const [i, raw] of items.entries()) {
    const problem = problemWithItem(raw)
    const where = isObject(raw) && isString(raw.id) ? raw.id : `#${i}`
    if (problem) throw new Error(`items.json item ${where}: ${problem}`)
    const item = raw as unknown as Item & { altFr?: string[]; grammar?: string[] }
    if (ids.has(item.id)) throw new Error(`items.json item ${where}: duplicate id`)
    ids.add(item.id)
    out.push({ ...item, altFr: item.altFr ?? [], grammar: item.grammar ?? [] })
  }
  return { topics: topics as Topic[], grammarPoints: grammarPoints as GrammarPoint[], items: out }
}

/** Fetch and check items.json, relative to the site's base URL. */
export async function loadItems(url = `${import.meta.env.BASE_URL}items.json`): Promise<ItemBank> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load the sentences (HTTP ${res.status})`)
  return parseItems(await res.json())
}

/** The blanks of a cloze sentence, in order. */
export function blanksOf(cloze: readonly ClozePart[]): Blank[] {
  return cloze.filter((part): part is Blank => typeof part !== 'string')
}
