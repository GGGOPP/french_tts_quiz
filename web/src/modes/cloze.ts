// Grammar cloze: a drill sentence with one to three blanks, each with a hint
// (the infinitive, or an English cue). You type the missing forms in the
// sentence itself. Each blank must match an accepted answer exactly after
// normalisation: no typo allowance (allez is not allons), and a blank that is
// off only by its accents is wrong but labelled as an accent mistake.
//
// The feedback shows the sentence with every blank marked, the English, why
// the answer is what it is, and the grammar point's rule card (open after a
// wrong answer). The clip plays only then, as it would give the answer away.

import { compare } from '../french'
import { blanksOf, type ClozePart, type GrammarPoint, type Item } from '../items'
import type { Graded, ModeModule } from '../quiz'
import { ruleCard } from '../rules'
import { isBlankAnswer, type Outcome } from '../session'

/** How one blank went. `empty` means nothing was typed in it (or "Don't know"). */
export type BlankVerdict = 'correct' | 'accent' | 'wrong' | 'empty'

export interface BlankMark {
  verdict: BlankVerdict
  /** What was typed in the blank, trimmed. */
  typed: string
  /** The answer to show: the one matched (or missed only by accents), else the main one. */
  answer: string
  /** The blank's other accepted answers. */
  others: string[]
}

export interface ClozeGrade {
  outcome: Outcome
  /** One mark per blank, in order. */
  marks: BlankMark[]
}

/**
 * Grade the blanks of a cloze sentence. `typed` has one entry per blank, or is
 * null for "Don't know". Right only if every blank is right; an accent
 * mistake only if the rest are right and at least one is off by its accents.
 */
export function gradeCloze(cloze: readonly ClozePart[], typed: readonly string[] | null): ClozeGrade {
  const blanks = blanksOf(cloze)
  const gaveUp = typed === null || isBlankAnswer(typed)
  const marks = blanks.map((blank, i): BlankMark => {
    const text = gaveUp ? '' : (typed[i] ?? '').trim()
    const result: { verdict: BlankVerdict; answer?: string } = isBlankAnswer([text])
      ? { verdict: 'empty' }
      : compare(text, blank.answers)
    const answer = result.answer ?? blank.answers[0]
    return { verdict: result.verdict, typed: text, answer, others: blank.answers.filter((a) => a !== answer) }
  })

  let outcome: Outcome
  if (gaveUp) outcome = 'dont-know'
  else if (marks.every((m) => m.verdict === 'correct')) outcome = 'correct'
  else if (marks.every((m) => m.verdict === 'correct' || m.verdict === 'accent')) outcome = 'accent'
  else outcome = 'wrong'
  return { outcome, marks }
}

/** Width for a blank holding `text`: room for the text plus a little, never narrower than a short word. */
export function blankWidth(text: string): string {
  return `${Math.max(Array.from(text).length, 4) + 1.5}ch`
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Text for screen readers only, e.g. "you typed". */
function srOnly(text: string): HTMLElement {
  return el('span', 'sr-only', text)
}

/** A blank in the feedback sentence: the answer, after what was typed if that was wrong. */
function markedBlank(mark: BlankMark): HTMLElement {
  const span = el('span', `blank-mark ${mark.verdict}`)
  if (mark.verdict === 'correct') {
    span.append(mark.answer)
    return span
  }
  if (mark.verdict !== 'empty') {
    const del = el('del')
    del.append(srOnly('you typed '), mark.typed)
    span.append(del, ' ')
  }
  const ins = el('ins')
  ins.append(srOnly(mark.verdict === 'empty' ? 'answer ' : ', answer '), mark.answer)
  span.append(ins)
  return span
}

/** A hint's first word, and the rest (with its leading space), e.g. "(your," + " vous)". */
export function splitHint(hint: string): [string, string] {
  const at = hint.indexOf(' ')
  return at < 0 ? [hint, ''] : [hint.slice(0, at), hint.slice(at)]
}

/** Part of a blank's hint. Hidden from screen readers: the box's label already says it. */
function hintSpan(text: string): HTMLElement {
  const span = el('span', 'blank-hint', text)
  span.lang = 'en'
  span.setAttribute('aria-hidden', 'true')
  return span
}

function clozeOf(item: Item): ClozePart[] {
  if (!item.cloze) throw new Error(`${item.id} has no blanks`)
  return item.cloze
}

/** The cloze mode, with the grammar points whose rule cards the feedback shows. */
export function createClozeMode(points: readonly GrammarPoint[]): ModeModule {
  const pointsById = new Map(points.map((p) => [p.id, p]))
  /** The current card's blanks, marked right or wrong once graded. */
  let boxes: HTMLInputElement[] = []

  return {
    instruction: 'Complete the sentence',
    audioWhen: 'feedback',
    answer: { lang: 'fr', label: 'Your answer', placeholder: '' },

    ask({ item }, prompt) {
      const parts = clozeOf(item)
      const total = blanksOf(parts).length
      const sentence = el('p', 'cloze-sentence')
      sentence.lang = 'fr'
      boxes = []
      for (const part of parts) {
        if (typeof part === 'string') {
          sentence.append(part)
          continue
        }
        const n = boxes.length + 1
        const box = el('input', 'blank')
        box.type = 'text'
        box.autocomplete = 'off'
        box.enterKeyHint = n < total ? 'next' : 'go'
        const which = total > 1 ? `Blank ${n} of ${total}` : 'Blank'
        box.setAttribute('aria-label', part.hint ? `${which}, hint: ${part.hint}` : which)
        box.style.width = blankWidth('')
        box.addEventListener('input', () => {
          box.style.width = blankWidth(box.value)
        })
        boxes.push(box)

        // The box and the hint's first word never wrap apart (.blank-wrap is
        // nowrap); the rest of a longer hint, like "(your, vous)", can.
        const wrap = el('span', 'blank-wrap')
        wrap.append(box)
        sentence.append(wrap)
        if (part.hint) {
          const [head, tail] = splitHint(`(${part.hint})`)
          wrap.append(' ', hintSpan(head))
          if (tail) sentence.append(hintSpan(tail))
        }
      }
      prompt.append(sentence)
      return boxes
    },

    grade({ item }, typed): Graded {
      const parts = clozeOf(item)
      const { outcome, marks } = gradeCloze(parts, typed)
      const graded = boxes

      return {
        outcome,
        show(body) {
          marks.forEach((mark, i) => {
            if (graded[i]) graded[i].dataset.verdict = mark.verdict
          })

          const sentence = el('p', 'cloze-result')
          sentence.lang = 'fr'
          let b = 0
          for (const part of parts) sentence.append(typeof part === 'string' ? part : markedBlank(marks[b++]))
          body.append(sentence)

          const also = marks.filter((m) => m.verdict !== 'correct' && m.others.length > 0).flatMap((m) => m.others)
          if (also.length > 0) {
            const p = el('p', 'also', 'Also accepted: ')
            const fr = el('span', undefined, also.join(', '))
            fr.lang = 'fr'
            p.append(fr)
            body.append(p)
          }

          body.append(el('p', 'translation', item.en[0]))
          if (item.explain) body.append(el('p', 'explain', item.explain))

          const point = item.point ? pointsById.get(item.point) : undefined
          if (point) body.append(ruleCard(point, outcome === 'wrong' || outcome === 'dont-know'))
        },
      }
    },
  }
}
