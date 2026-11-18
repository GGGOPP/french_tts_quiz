import { describe, expect, it } from 'vitest'
import itemsJson from '../../public/items.json?raw'
import { parseItems } from '../items'
import { answersOf, closestAnswer, gradeProduce, REGISTER_TAGS, worthDiffing } from './produce'

const ITEM = {
  fr: 'Vous êtes en vacances ?',
  altFr: ['Tu es en vacances ?', 'Êtes-vous en vacances ?', 'Est-ce que vous êtes en vacances ?'],
}

describe('gradeProduce', () => {
  it('is correct on the sentence or any alternative, and shows the one matched', () => {
    expect(gradeProduce(ITEM, 'vous êtes en vacances')).toMatchObject({ outcome: 'correct', answer: ITEM.fr })
    expect(gradeProduce(ITEM, 'Tu es en vacances?')).toMatchObject({ outcome: 'correct', answer: ITEM.altFr[0] })
    expect(gradeProduce(ITEM, 'Êtes‑vous en vacances ?')).toMatchObject({ outcome: 'correct', answer: ITEM.altFr[1] })
  })

  it('labels an accent-only mistake, with the words marked', () => {
    const graded = gradeProduce(ITEM, 'Vous etes en vacances')
    expect(graded).toMatchObject({ outcome: 'accent', answer: ITEM.fr })
    expect(graded.words.map((w) => w.mark)).toEqual(['right', 'accent', 'right', 'right'])
  })

  it('allows no typos: anything else goes to self-marking, against the closest answer', () => {
    const graded = gradeProduce(ITEM, 'Est-ce que vous êtes en vacance')
    expect(graded.outcome).toBe('self-mark')
    expect(graded.answer).toBe(ITEM.altFr[2]) // only vacance(s) differs
    expect(graded.words.filter((w) => w.mark !== 'right')).toEqual([{ mark: 'wrong', expected: 'vacances', typed: 'vacance' }])

    // Two words off either way (Est-ce que extra, or tu/es wrong): the first listed wins.
    expect(gradeProduce(ITEM, 'Est-ce que tu es en vacances ?').answer).toBe(ITEM.altFr[0])

    expect(gradeProduce(ITEM, 'Vous êtes en vacance').outcome).toBe('self-mark')
  })

  it('is don’t-know for null or nothing typed, showing the sentence', () => {
    for (const typed of [null, '', '  ', '…']) {
      expect(gradeProduce(ITEM, typed)).toEqual({ outcome: 'dont-know', answer: ITEM.fr, words: [] })
    }
  })
})

describe('closestAnswer', () => {
  it('picks the answer with the fewest words to fix, the first on a tie', () => {
    expect(closestAnswer('tu es en vacance', answersOf(ITEM)).answer).toBe(ITEM.altFr[0])
    expect(closestAnswer('bonjour', ['Salut.', 'Bonsoir.']).answer).toBe('Salut.')
  })

  it('counts an accent slip as less than a wrong word', () => {
    expect(closestAnswer('etes vous en vacances', ['Vous êtes en vacances ?', 'Êtes-vous en vacances ?']).answer).toBe(
      'Vous êtes en vacances ?',
    )
  })
})

describe('worthDiffing', () => {
  const words = (typed: string, model = 'Je ne parle pas en mangeant.') => gradeProduce({ fr: model, altFr: [] }, typed).words

  it('is true when at least half the model’s words are there (accent slips count)', () => {
    expect(worthDiffing(words('Je ne parle pas quand je mange'))).toBe(true) // 4 of 5 kept
    expect(worthDiffing(words('Je parle pas en mangent'))).toBe(true) // 3 of 5, an extra word doesn't count
  })

  it('is false when most of the model is wrong or missing', () => {
    expect(worthDiffing(words('Quand tu pars du boulot'))).toBe(false)
    expect(worthDiffing(words('Bonjour'))).toBe(false)
  })
})

describe('the real items', () => {
  const { items } = parseItems(JSON.parse(itemsJson))

  it('accept their own sentence and every alternative', () => {
    for (const item of items) {
      for (const answer of answersOf(item)) expect(gradeProduce(item, answer).outcome, `${item.id}: ${answer}`).toBe('correct')
    }
  })

  it('have a tag for every register used', () => {
    for (const item of items) if (item.register) expect(REGISTER_TAGS[item.register]).toBeTruthy()
  })
})
