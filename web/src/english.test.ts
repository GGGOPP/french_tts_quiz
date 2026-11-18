import { describe, expect, it } from 'vitest'
import itemsJson from '../public/items.json?raw'
import { clean, editDistance, gradeEnglish, typoAllowance } from './english'
import { parseItems } from './items'

describe('clean', () => {
  it.each([
    ['The House', 'house'],
    ['  a   big  house ', 'big house'],
    ['to eat', 'eat'],
    ['Café crème', 'cafe creme'],
    ['good-looking', 'good looking'],
    ['Are you on holiday?!', 'are you on holiday'],
    ['the', 'the'], // never cleaned away entirely
    ['theatre', 'theater'], // only whole leading words; British spelling folded
    ['', ''],
    ['?!', ''],
  ])('%j → %j', (text, expected) => {
    expect(clean(text)).toBe(expected)
  })

  it.each([
    ["I don't know", 'i do not know'],
    ['I don’t know', 'i do not know'], // curly apostrophe
    ["I won't go, I can't", 'i will not go i can not'],
    ['I cannot', 'i can not'],
    ["I'm tired, you're late", 'i am tired you are late'],
    ["I'd like a coffee", 'i would like a coffee'],
    ["We've got time, we'll see", 'we have got time we will see'],
    ["It's late, that's fine, let's go", 'it is late that is fine let us go'],
    ["Julie's car", 'julies car'], // a possessive just loses its apostrophe
  ])('expands contractions: %j → %j', (text, expected) => {
    expect(clean(text)).toBe(expected)
  })

  it.each([
    ['My favourite colour is grey', 'my favorite color is gray'],
    ['We travelled to the city centre', 'we traveled to city center'.replace('to city', 'to the city')],
  ])('folds British spellings: %j', (text, expected) => {
    expect(clean(text)).toBe(expected)
  })

  it.each([
    ['at nine', 'at 9'],
    ['twenty-five euros', '25 euros'],
    ['twenty five euros', '25 euros'],
    ['thirty', '30'],
    ['at 8:15', 'at 8 15'],
    ['at eight fifteen', 'at 8 15'],
    ['20 5', '20 5'], // digits are never merged
  ])('turns number words into digits: %j → %j', (text, expected) => {
    expect(clean(text)).toBe(expected)
  })
})

describe('editDistance', () => {
  it.each([
    ['house', 'house', 0],
    ['hous', 'house', 1],
    ['housse', 'house', 1],
    ['hoyse', 'house', 1],
    ['huose', 'house', 1], // adjacent swap
    ['hsoue', 'house', 2],
    ['', 'abc', 3],
    ['car', 'house', 5],
  ])('%j vs %j = %i', (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected)
    expect(editDistance(b, a)).toBe(expected)
  })
})

describe('typoAllowance', () => {
  it.each([
    ['he', 0],
    ['went', 0],
    ['walk', 0],
    ['25', 0],
    ['house', 1],
    ['kitchen', 1],
    ['children', 2],
    ['restaurant', 2],
  ])('%j allows %i', (word, expected) => {
    expect(typoAllowance(word)).toBe(expected)
  })
})

describe('gradeEnglish', () => {
  const COFFEE = ['I would like a coffee please.', "I'd like a coffee, please."]
  const BED = ['Last night the children went to bed at nine because they were tired.']

  it('accepts any accepted translation, ignoring case, punctuation and contractions', () => {
    expect(gradeEnglish('i would like a coffee please', COFFEE)).toEqual({ verdict: 'correct', answer: COFFEE[0] })
    expect(gradeEnglish("I'd like a coffee please!", COFFEE).verdict).toBe('correct')
    expect(gradeEnglish('I would like a coffee, please', ["I'd like a coffee, please."]).verdict).toBe('correct')
    expect(gradeEnglish('last night the children went to bed at 9 because they were tired', BED).verdict).toBe('correct')
  })

  it('calls a slip in a longer word a typo and names the intended answer', () => {
    expect(gradeEnglish('Last night the childern went to bed at nine becuase they were tired', BED)).toEqual({
      verdict: 'typo',
      answer: BED[0],
    })
    expect(gradeEnglish('I would like a cofee please', COFFEE).verdict).toBe('typo')
  })

  it('needs short words and numbers exact: a different word is not a typo', () => {
    expect(gradeEnglish('Last night the children want to bed at nine because they were tired', BED).verdict).toBe('wrong')
    expect(gradeEnglish('Last night the children went to bed at five because they were tired', BED).verdict).toBe('wrong')
    expect(gradeEnglish('She is tired', ['He is tired.']).verdict).toBe('wrong')
  })

  it('allows typos in at most two words', () => {
    expect(gradeEnglish('Last nigth the childern went to bed at nine becuase they were tired', BED).verdict).toBe('wrong')
  })

  it('leaves a different wording or word count to the grader', () => {
    expect(gradeEnglish('I want a coffee please', COFFEE).verdict).toBe('wrong')
    expect(gradeEnglish('I would like one coffee', COFFEE).verdict).toBe('wrong')
  })

  it('marks blank input wrong', () => {
    expect(gradeEnglish('', COFFEE).verdict).toBe('wrong')
    expect(gradeEnglish(' ? ', COFFEE).verdict).toBe('wrong')
  })

  it('accepts every real translation as itself, and every one cleans to something', () => {
    const { items } = parseItems(JSON.parse(itemsJson))
    for (const item of items) {
      for (const en of item.en) {
        expect(clean(en), `${item.id}: ${en}`).not.toBe('')
        expect(gradeEnglish(en, item.en), item.id).toEqual({ verdict: 'correct', answer: expect.any(String) })
      }
    }
  })
})
