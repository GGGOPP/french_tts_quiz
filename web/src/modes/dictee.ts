// Dictée: hear a French sentence, type it in French. The answer is aligned
// with the sentence word by word (diffWords): it is right only if every word
// is right, an accent mistake if every word is there and the only slips are
// accents, and wrong otherwise. Case and punctuation never count.
//
// The feedback shows the sentence, with its own punctuation, each mistake
// marked where it is: what you typed struck through and the right word after
// it, missing words underlined, extra words struck through. Then the English.

import { diffWords, tokenize, type DiffWord } from '../french'
import type { Graded, ModeModule } from '../quiz'
import type { Outcome } from '../session'

export interface DicteeGrade {
  outcome: Outcome
  /** The sentence's words in order, with extra typed words where they were typed. */
  words: DiffWord[]
}

/** Grade a typed dictée of `sentence`, or null for "Don't know". */
export function gradeDictee(sentence: string, typed: string | null): DicteeGrade {
  const { words, correct } = diffWords(typed ?? '', sentence)
  let outcome: Outcome
  if (typed === null || tokenize(typed).length === 0) outcome = 'dont-know'
  else if (correct) outcome = 'correct'
  else if (words.every((w) => w.mark === 'right' || w.mark === 'accent')) outcome = 'accent'
  else outcome = 'wrong'
  return { outcome, words }
}

/**
 * What lies around the sentence's words: `gaps[j]` is the text just before
 * word j (spaces, punctuation, nothing after an elision like l'), and the last
 * entry is what follows the last word. So gaps[0] + word 0 + gaps[1] + … is the
 * sentence again. Falls back to plain spaces if a word can't be found.
 */
export function sentenceGaps(sentence: string, words: readonly string[]): string[] {
  const text = sentence.normalize('NFC')
  const gaps: string[] = []
  let at = 0
  for (const word of words) {
    const found = text.indexOf(word, at)
    if (found < 0) return words.length === 0 ? [''] : ['', ...words.slice(1).map(() => ' '), '']
    gaps.push(text.slice(at, found))
    at = found + word.length
  }
  gaps.push(text.slice(at))
  return gaps
}

const PLURAL: Record<Exclude<DiffWord['mark'], 'right'>, [string, string]> = {
  wrong: ['wrong word', 'wrong words'],
  accent: ['accent', 'accents'],
  missing: ['missing word', 'missing words'],
  extra: ['extra word', 'extra words'],
}

/** A count of the mistakes, e.g. "1 wrong word · 2 accents · 1 missing word". Empty if there are none. */
export function mistakeSummary(words: readonly DiffWord[]): string {
  return (Object.keys(PLURAL) as (keyof typeof PLURAL)[])
    .map((mark) => {
      const n = words.filter((w) => w.mark === mark).length
      return n === 0 ? '' : `${n} ${PLURAL[mark][n === 1 ? 0 : 1]}`
    })
    .filter(Boolean)
    .join(' · ')
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function srOnly(text: string): HTMLElement {
  return el('span', 'sr-only', text)
}

/** One word of the sentence (or an extra typed word), marked. */
function markedWord(word: DiffWord): Node {
  if (word.mark === 'right') return document.createTextNode(word.expected!)
  const span = el('span', `word-mark ${word.mark}`)
  if (word.mark === 'extra') {
    const del = el('del')
    del.append(srOnly('extra word '), word.typed!)
    span.append(del)
    return span
  }
  if (word.mark === 'missing') {
    const ins = el('ins')
    ins.append(srOnly('missing word '), word.expected!)
    span.append(ins)
    return span
  }
  const del = el('del')
  del.append(srOnly('you typed '), word.typed!)
  const ins = el('ins')
  ins.append(srOnly(', answer '), word.expected!)
  span.append(del, ' ', ins)
  return span
}

/**
 * Lay the diff out as the sentence: its words in order, with the sentence's
 * own spaces and punctuation between them, and extra typed words slotted in
 * where they were typed (after any punctuation, before the final one).
 */
export function layoutSentence(sentence: string, words: readonly DiffWord[]): (string | DiffWord)[] {
  const expected = words.filter((w) => w.mark !== 'extra').map((w) => w.expected!)
  const gaps = sentenceGaps(sentence, expected)
  const parts: (string | DiffWord)[] = []
  let atSpace = true // the layout so far is empty or ends in a space
  const text = (s: string) => {
    if (s === '') return
    parts.push(s)
    atSpace = /\s$/.test(s)
  }
  const word = (w: DiffWord) => {
    parts.push(w)
    atSpace = false
  }

  let j = 0
  let gapDone = false // gaps[j] is already out (extra words came right after it)
  for (const w of words) {
    if (w.mark === 'extra') {
      if (j < expected.length && !gapDone) {
        text(gaps[j])
        gapDone = true
      }
      if (!atSpace) text(' ')
      word(w)
      continue
    }
    text(gapDone ? ' ' : gaps[j])
    word(w)
    j++
    gapDone = false
  }
  text(gaps[expected.length])
  return parts
}

/** French spacing: the space before ? ! : ; » (and after «) never breaks a line. */
export function keepPunctuationTogether(text: string): string {
  return text.replace(/ (?=[?!:;»])/g, ' ').replace(/« /g, '« ')
}

/** The sentence with its own punctuation and every mistake marked in place. */
function markedSentence(sentence: string, words: readonly DiffWord[]): HTMLElement {
  const p = el('p', 'dictee-result')
  p.lang = 'fr'
  for (const part of layoutSentence(sentence, words)) {
    p.append(typeof part === 'string' ? keepPunctuationTogether(part) : markedWord(part))
  }
  return p
}

/** The dictée mode. */
export function createDicteeMode(): ModeModule {
  return {
    instruction: 'Type what you hear',
    audioWhen: 'ask',
    answer: { lang: 'fr', label: 'What you heard, in French', placeholder: 'Type the French…' },

    ask() {},

    grade({ item }, typed): Graded {
      const { outcome, words } = gradeDictee(item.fr, typed === null ? null : typed.join(' '))
      return {
        outcome,
        show(body) {
          if (outcome === 'dont-know') {
            // Nothing typed: just the sentence, not every word marked missing.
            const p = el('p', 'dictee-result', keepPunctuationTogether(item.fr))
            p.lang = 'fr'
            body.append(p)
          } else {
            body.append(markedSentence(item.fr, words))
            const summary = mistakeSummary(words)
            if (summary) body.append(el('p', 'also', summary))
          }
          body.append(el('p', 'translation', item.en[0]))
          if (item.explain) body.append(el('p', 'explain', item.explain))
          if (item.notes) body.append(el('p', 'explain', item.notes))
        },
      }
    },
  }
}
