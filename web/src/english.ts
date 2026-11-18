// Checking a typed English answer (listen → meaning) against a sentence's
// accepted translations. Ported from the Greek app's grading.ts, where answers
// were single words, and adapted to sentences:
//
// - contractions are expanded (I'd = I would, don't = do not), British and
//   American spellings fold together, and number words equal digits;
// - typos are allowed word by word, never across the whole sentence, and
//   short words must be exact: one letter turns "he" into "she" and "went"
//   into "want", which is a different meaning, not a typo.
//
// Anything that doesn't match is not marked wrong here: it goes to the LLM
// grader (plan step 24) or, without one, you mark it yourself.

export type EnglishVerdict = 'correct' | 'typo' | 'wrong'

export interface EnglishGrade {
  verdict: EnglishVerdict
  /** The accepted answer that matched (the closest one for a typo); absent when wrong. */
  answer?: string
}

/** Contractions, applied in order (won't before n't). The text is lowercase, with straight apostrophes. */
const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bshan't\b/g, 'shall not'],
  [/n't\b/g, ' not'],
  [/\blet's\b/g, 'let us'],
  [/\b(it|that|he|she|there|here|what|where|who|how|when)'s\b/g, '$1 is'],
  [/'m\b/g, ' am'],
  [/'re\b/g, ' are'],
  [/'ve\b/g, ' have'],
  [/'ll\b/g, ' will'],
  [/'d\b/g, ' would'],
]

/** British spellings → American, for whole words. */
const SPELLINGS: Record<string, string> = {
  colour: 'color',
  colours: 'colors',
  favourite: 'favorite',
  favourites: 'favorites',
  neighbour: 'neighbor',
  neighbours: 'neighbors',
  centre: 'center',
  theatre: 'theater',
  metre: 'meter',
  metres: 'meters',
  kilometre: 'kilometer',
  kilometres: 'kilometers',
  litre: 'liter',
  litres: 'liters',
  grey: 'gray',
  programme: 'program',
  travelled: 'traveled',
  travelling: 'traveling',
  traveller: 'traveler',
  travellers: 'travelers',
  cancelled: 'canceled',
  cancelling: 'canceling',
  realise: 'realize',
  realised: 'realized',
  organise: 'organize',
  organised: 'organized',
  recognise: 'recognize',
  apologise: 'apologize',
  mum: 'mom',
}

const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const NUMBER_WORDS = new Map<string, number>([
  ...UNITS.map((w, n): [string, number] => [w, n]),
  ...TENS.flatMap((w, n): [string, number][] => (w ? [[w, n * 10]] : [])),
])

/** Number words to digits, "twenty five" (from twenty-five) to 25. Words are already split. */
function numbersToDigits(words: string[]): string[] {
  const out: string[] = []
  let tensWord = false // the last word out was a tens word (twenty…ninety), not typed digits
  for (const word of words) {
    const n = NUMBER_WORDS.get(word)
    if (n !== undefined && n >= 1 && n <= 9 && tensWord) {
      out[out.length - 1] = String(Number(out[out.length - 1]) + n) // twenty five → 25
      tensWord = false
      continue
    }
    out.push(n === undefined ? word : String(n))
    tensWord = n !== undefined && n >= 20
  }
  return out
}

const LEADING_WORD = /^(?:the|a|an|to) (?=\S)/

/**
 * Normalise an English answer for comparison: strip accents, lowercase,
 * expand contractions, drop other apostrophes, turn punctuation into spaces
 * ("good-looking" → "good looking", "8:15" → "8 15"), fold British spellings
 * and number words, collapse spaces, and drop one leading the/a/an/to
 * ("a coffee" → "coffee") unless it is the whole answer.
 */
export function clean(text: string): string {
  let s = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘`´ʼ]/g, "'")
  for (const [pattern, expansion] of CONTRACTIONS) s = s.replace(pattern, expansion)
  s = s
    .replace(/'/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s === '') return ''
  const words = numbersToDigits(s.split(' ').map((w) => SPELLINGS[w] ?? w))
  return words.join(' ').replace(LEADING_WORD, '')
}

/**
 * Damerau-Levenshtein distance (optimal string alignment): insertions,
 * deletions, substitutions and swaps of two adjacent characters each cost 1.
 */
export function editDistance(a: string, b: string): number {
  const s = Array.from(a)
  const t = Array.from(b)
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) =>
    Array.from({ length: t.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[s.length][t.length]
}

/**
 * How many edits still count as a typo of this (cleaned) word. Words of up to
 * four letters and numbers must be exact (he/she, went/want, 5/6).
 */
export function typoAllowance(word: string): number {
  const length = Array.from(word).length
  if (/\d/.test(word) || length <= 4) return 0
  return length <= 7 ? 1 : 2
}

/** At most this many words of a sentence may have a typo. */
const MAX_TYPO_WORDS = 2

/**
 * The total edits if `typed` is `target` with a few typos (same words, each
 * within its allowance, at most two of them off), else undefined.
 */
function typoDistance(typed: string, target: string): number | undefined {
  const a = typed.split(' ')
  const b = target.split(' ')
  if (a.length !== b.length) return undefined
  let total = 0
  let off = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    const distance = editDistance(a[i], b[i])
    if (distance > typoAllowance(b[i])) return undefined
    total += distance
    off += 1
  }
  return off <= MAX_TYPO_WORDS ? total : undefined
}

/** Grade an English answer against the accepted ones. */
export function gradeEnglish(input: string, answers: readonly string[]): EnglishGrade {
  const typed = clean(input)
  if (typed === '') return { verdict: 'wrong' }

  let best: { answer: string; distance: number } | undefined
  for (const answer of answers) {
    const target = clean(answer)
    if (target === '') continue
    if (typed === target) return { verdict: 'correct', answer }
    const distance = typoDistance(typed, target)
    if (distance !== undefined && (!best || distance < best.distance)) best = { answer, distance }
  }
  return best ? { verdict: 'typo', answer: best.answer } : { verdict: 'wrong' }
}
