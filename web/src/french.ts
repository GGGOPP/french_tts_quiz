// Checking typed French: the shared normalisation, a strict compare that
// recognises accent-only mistakes, and the word-by-word dictée diff.
//
// Strict means accents, hyphens and apostrophes count: "allee" is wrong, but
// the result says it is an accent mistake rather than a different word. Case,
// punctuation (other than ' and -) and spacing do not count.

/** Apostrophe look-alikes from phone keyboards, Word and the like. */
const APOSTROPHES = /[’‘‛`´ʼʹ′＇]/g
/** Hyphen look-alikes (but not dashes, which are punctuation). */
const HYPHENS = /[‐‑]/g
/** Punctuation that never changes the answer: everything but the apostrophe and hyphen. */
const IGNORED_PUNCTUATION = /(?!['-])\p{P}/gu

/**
 * Tidy a French answer without changing what it says: NFC, one kind of
 * apostrophe and hyphen, punctuation turned into spaces, spaces (including
 * non-breaking ones) collapsed, and no space after an apostrophe ("l' ami" →
 * "l'ami"). Case and accents are kept.
 */
function tidy(text: string): string {
  return text
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(HYPHENS, '-')
    .replace(IGNORED_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .replace(/' /g, "'")
    .trim()
}

/** The form answers are compared in: `tidy`, then lowercase. Accents and hyphens are kept. */
export function normalise(text: string): string {
  return tidy(text).toLowerCase()
}

/** Drop the accents of normalised text, so accent-only differences compare equal (œ counts as oe). */
export function stripAccents(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFC')
}

export type Verdict = 'correct' | 'accent' | 'wrong'

export interface Comparison {
  /** `accent` is still a wrong answer, but only its accents are off. */
  verdict: Verdict
  /** The accepted answer that matched, or the one it misses only by accents. Absent when wrong. */
  answer?: string
}

/** Compare a typed answer with the accepted answers, exactly after `normalise`. */
export function compare(input: string, answers: readonly string[]): Comparison {
  const typed = normalise(input)
  if (typed === '') return { verdict: 'wrong' }

  let accentMiss: string | undefined
  const typedBare = stripAccents(typed)
  for (const answer of answers) {
    const target = normalise(answer)
    if (target === '') continue
    if (typed === target) return { verdict: 'correct', answer }
    if (accentMiss === undefined && typedBare === stripAccents(target)) accentMiss = answer
  }
  return accentMiss === undefined ? { verdict: 'wrong' } : { verdict: 'accent', answer: accentMiss }
}

// ---------------------------------------------------------------------------
// Dictée

export interface Token {
  /** The word as typed or written, minus punctuation (for display). */
  text: string
  /** The word in compare form (`normalise`d). */
  norm: string
}

/**
 * Elided words that are their own token: "l'ami" is l' + ami. Words with an
 * apostrophe inside them (aujourd'hui, quelqu'un, presqu'île) stay whole.
 */
const ELISION = /^(l|j|d|m|t|s|n|c|qu|jusqu|lorsqu|puisqu|quoiqu)'(?=.)/i

/** Split French into words for the dictée diff. Hyphenated words (est-ce, a-t-il) stay whole. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  for (const word of tidy(text).split(' ')) {
    let rest = word
    let elided: RegExpExecArray | null
    while ((elided = ELISION.exec(rest))) {
      tokens.push({ text: elided[0], norm: elided[0].toLowerCase() })
      rest = rest.slice(elided[0].length)
    }
    // A stray apostrophe or hyphen on its own is not a word.
    if (/[\p{L}\p{N}]/u.test(rest)) tokens.push({ text: rest, norm: rest.toLowerCase() })
  }
  return tokens
}

/** How one word of the answer came out. */
export type WordMark = 'right' | 'accent' | 'wrong' | 'missing' | 'extra'

export interface DiffWord {
  mark: WordMark
  /** The word in the sentence; absent for an extra word. */
  expected?: string
  /** The word typed; absent for a missing word. */
  typed?: string
}

export interface Dictation {
  /** The sentence's words in order, with extra typed words where they were typed. */
  words: DiffWord[]
  /** True only when every word is right. */
  correct: boolean
}

/** Levenshtein distance between two strings, by code point. */
function charDistance(a: string, b: string): number {
  const s = Array.from(a)
  const t = Array.from(b)
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j)
  for (let i = 1; i <= s.length; i++) {
    const row = [i]
    for (let j = 1; j <= t.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[t.length]
}

/** How a typed word pairs with an expected one. */
function markPair(typed: Token, expected: Token): WordMark {
  if (typed.norm === expected.norm) return 'right'
  return stripAccents(typed.norm) === stripAccents(expected.norm) ? 'accent' : 'wrong'
}

/**
 * The cost of pairing two words in the alignment. A wrong pair costs between 1
 * and 2 depending on how alike the words look, so it is never worse than a
 * missing word plus an extra one (2), and look-alike words pair up first.
 */
function pairCost(typed: Token, expected: Token): number {
  const mark = markPair(typed, expected)
  if (mark === 'right') return 0
  if (mark === 'accent') return 0.5
  const a = stripAccents(typed.norm)
  const b = stripAccents(expected.norm)
  return 1 + charDistance(a, b) / Math.max(Array.from(a).length, Array.from(b).length)
}

/**
 * Align a typed dictée with the sentence word by word (an edit distance over
 * tokens) and mark every word right, accent, wrong, missing or extra.
 */
export function diffWords(input: string, sentence: string): Dictation {
  const typed = tokenize(input)
  const expected = tokenize(sentence)
  const n = typed.length
  const m = expected.length

  // cost[i][j] = cheapest alignment of the first i typed and first j expected words.
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i][j] = Math.min(
        cost[i - 1][j - 1] + pairCost(typed[i - 1], expected[j - 1]),
        cost[i - 1][j] + 1, // typed word i is extra
        cost[i][j - 1] + 1, // expected word j is missing
      )
    }
  }

  // Walk back from the end, preferring a pair whenever it gives the same cost.
  const words: DiffWord[] = []
  let i = n
  let j = m
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && near(cost[i][j], cost[i - 1][j - 1] + pairCost(typed[i - 1], expected[j - 1]))) {
      words.push({ mark: markPair(typed[i - 1], expected[j - 1]), expected: expected[j - 1].text, typed: typed[i - 1].text })
      i--
      j--
    } else if (j > 0 && (i === 0 || near(cost[i][j], cost[i][j - 1] + 1))) {
      words.push({ mark: 'missing', expected: expected[j - 1].text })
      j--
    } else {
      words.push({ mark: 'extra', typed: typed[i - 1].text })
      i--
    }
  }
  words.reverse()

  return { words, correct: m > 0 && words.every((w) => w.mark === 'right') }
}
