// Listen → meaning: hear a French sentence, type what it means in English.
//
// The answer is checked against the sentence's accepted translations, with
// some give for English (contractions, British/American spelling, a typo or
// two in longer words: see english.ts). A different wording can still be
// right, so an answer that doesn't match isn't marked wrong: the LLM grader
// will judge it (plan step 24); until then you see the answer and mark
// yourself.

import { el, labelled } from '../dom'
import { gradeEnglish } from '../english'
import type { Graded, ModeModule } from '../quiz'
import { isBlankAnswer, type Outcome } from '../session'
import { keepPunctuationTogether } from './dictee'

export interface MeaningGrade {
  outcome: Outcome | 'self-mark'
  /** The translation that matched (the closest one for a typo); absent otherwise. */
  answer?: string
}

/** Grade an English answer against the accepted translations, or null for "Don't know". */
export function gradeMeaning(en: readonly string[], typed: string | null): MeaningGrade {
  if (typed === null || isBlankAnswer([typed])) return { outcome: 'dont-know' }
  const { verdict, answer } = gradeEnglish(typed, en)
  if (verdict === 'wrong') return { outcome: 'self-mark' }
  return { outcome: verdict, answer }
}

/** The listen → meaning mode. */
export function createMeaningMode(): ModeModule {
  return {
    instruction: 'What does it mean? Type it in English',
    audioWhen: 'ask',
    answer: { lang: 'en', label: 'What it means, in English', placeholder: 'Type the English…' },

    ask() {},

    grade({ item }, typed): Graded {
      const answer = typed === null ? null : typed.join(' ').trim()
      const graded = gradeMeaning(item.en, answer)
      const { outcome } = graded

      return {
        outcome,
        show(body) {
          const source = el('p', 'source', keepPunctuationTogether(item.fr))
          source.lang = 'fr'
          body.append(source)

          const shown = graded.answer ?? item.en[0]
          if (outcome === 'correct') {
            body.append(el('p', 'translation', shown))
          } else {
            if (answer && outcome !== 'dont-know') body.append(labelled('You wrote:', answer, 'en'))
            body.append(labelled(outcome === 'typo' ? 'Spelled:' : 'Answer:', shown, 'en'))
            const others = item.en.filter((e) => e !== shown)
            if (outcome !== 'typo' && others.length > 0) body.append(labelled('Also accepted:', others.join(' / '), 'en', 'also'))
          }
          if (item.explain) body.append(el('p', 'explain', item.explain))
          if (item.notes) body.append(el('p', 'explain', item.notes))
        },
      }
    },
  }
}
