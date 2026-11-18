// English → French: see an English sentence, write it in French.
//
// The answer is checked strictly against the sentence and its other accepted
// French (`altFr`): an exact match after normalisation is right, and one that
// differs only by accents is wrong but labelled as an accent mistake. French
// can say the same thing many ways, so any other answer isn't marked wrong:
// the LLM grader will judge it (plan step 24); until then the feedback shows
// your answer word-diffed against the closest model answer and you mark
// yourself.
//
// The clip plays only with the feedback, as it would give the answer away.

import { el, labelled } from '../dom'
import { compare, diffWords, type DiffWord } from '../french'
import type { Item } from '../items'
import type { Graded, ModeModule } from '../quiz'
import { isBlankAnswer, type Outcome } from '../session'
import { keepPunctuationTogether, markedSentence, mistakeSummary } from './dictee'

export interface ProduceGrade {
  outcome: Outcome | 'self-mark'
  /** The model answer to show: the one matched, or the closest one. */
  answer: string
  /** The typed answer word-diffed against `answer` (empty for "Don't know"). */
  words: DiffWord[]
}

/** Every accepted French answer: the sentence, then its alternatives. */
export function answersOf(item: Pick<Item, 'fr' | 'altFr'>): string[] {
  return [item.fr, ...item.altFr]
}

const COST: Record<DiffWord['mark'], number> = { right: 0, accent: 0.5, wrong: 1, missing: 1, extra: 1 }

/** The accepted answer closest to what was typed (fewest words to fix; the first on a tie), with its diff. */
export function closestAnswer(typed: string, answers: readonly string[]): { answer: string; words: DiffWord[] } {
  let best: { answer: string; words: DiffWord[]; cost: number } | undefined
  for (const answer of answers) {
    const { words } = diffWords(typed, answer)
    const cost = words.reduce((sum, w) => sum + COST[w.mark], 0)
    if (!best || cost < best.cost) best = { answer, words, cost }
  }
  if (!best) throw new Error('No answers to compare with')
  return { answer: best.answer, words: best.words }
}

/**
 * Is the typed answer near enough to the model answer for a word diff to
 * help? Not when most of the model's words are wrong or missing: then the diff
 * is mostly red, and the two sentences side by side read better.
 */
export function worthDiffing(words: readonly DiffWord[]): boolean {
  const expected = words.filter((w) => w.mark !== 'extra')
  const kept = expected.filter((w) => w.mark === 'right' || w.mark === 'accent').length
  return kept * 2 >= expected.length
}

/** Grade a French answer to an English prompt, or null for "Don't know". */
export function gradeProduce(item: Pick<Item, 'fr' | 'altFr'>, typed: string | null): ProduceGrade {
  const answers = answersOf(item)
  if (typed === null || isBlankAnswer([typed])) return { outcome: 'dont-know', answer: item.fr, words: [] }
  const { verdict, answer } = compare(typed, answers)
  if (verdict === 'correct') return { outcome: 'correct', answer: answer!, words: diffWords(typed, answer!).words }
  if (verdict === 'accent') return { outcome: 'accent', answer: answer!, words: diffWords(typed, answer!).words }
  return { outcome: 'self-mark', ...closestAnswer(typed, answers) }
}

/** The small tag beside the prompt saying whether tu or vous is expected. */
export const REGISTER_TAGS: Record<NonNullable<Item['register']>, string> = {
  formal: 'formal: vous',
  informal: 'informal: tu',
}

/** The English → French mode. */
export function createProduceMode(): ModeModule {
  return {
    instruction: 'Write it in French',
    audioWhen: 'feedback',
    answer: { lang: 'fr', label: 'Your answer, in French', placeholder: 'Type the French…' },

    ask({ item }, prompt) {
      const p = el('p', 'en-prompt', item.en[0])
      p.lang = 'en'
      if (item.register) p.append(el('span', 'register', REGISTER_TAGS[item.register]))
      prompt.append(p)
    },

    grade({ item }, typed): Graded {
      const answer = typed === null ? null : typed.join(' ').trim()
      const { outcome, answer: model, words } = gradeProduce(item, answer)

      return {
        outcome,
        show(body) {
          if (outcome === 'self-mark') {
            if (worthDiffing(words)) {
              body.append(el('p', 'label', 'Your answer, against the closest model answer:'))
              body.append(markedSentence(model, words))
            } else {
              body.append(labelled('You wrote:', answer ?? '', 'fr'))
              body.append(labelled('Answer:', keepPunctuationTogether(model), 'fr', 'source'))
            }
            body.append(el('p', 'also', 'This couldn’t be checked automatically: another wording can still be right.'))
          } else if (outcome === 'accent') {
            body.append(markedSentence(model, words))
            body.append(el('p', 'also', mistakeSummary(words)))
          } else {
            const p = el('p', 'dictee-result', keepPunctuationTogether(model))
            p.lang = 'fr'
            body.append(p)
          }

          const others = answersOf(item).filter((a) => a !== model)
          if (others.length > 0) {
            const label = outcome === 'correct' ? 'Also correct:' : 'Also accepted:'
            body.append(labelled(label, others.map(keepPunctuationTogether).join(' / '), 'fr', 'also'))
          }
          if (item.explain) body.append(el('p', 'explain', item.explain))
          if (item.notes) body.append(el('p', 'explain', item.notes))
        },
      }
    },
  }
}
