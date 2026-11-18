import { describe, expect, it } from 'vitest'
import itemsJson from '../../public/items.json?raw'
import { blanksOf, parseItems, type ClozePart } from '../items'
import { blankWidth, gradeCloze, splitHint } from './cloze'

const one: ClozePart[] = ['Hier, elle ', { answers: ['est allée'], hint: 'aller' }, ' au marché.']
const two: ClozePart[] = ["C'est une ", { answers: ['petite'], hint: 'petit' }, ' ville ', { answers: ['tranquille', 'calme'] }, '.']

describe('gradeCloze', () => {
  it('is correct when the blank matches, ignoring case and spacing', () => {
    expect(gradeCloze(one, ['est allée'])).toEqual({
      outcome: 'correct',
      marks: [{ verdict: 'correct', typed: 'est allée', answer: 'est allée', others: [] }],
    })
    expect(gradeCloze(one, ['  Est   allée '])).toMatchObject({ outcome: 'correct' })
  })

  it('allows no typos', () => {
    expect(gradeCloze(one, ['est allé']).outcome).toBe('wrong')
    expect(gradeCloze(one, ['est alée']).outcome).toBe('wrong')
  })

  it('labels an accent-only mistake, still not right', () => {
    const graded = gradeCloze(one, ['est allee'])
    expect(graded.outcome).toBe('accent')
    expect(graded.marks[0]).toMatchObject({ verdict: 'accent', typed: 'est allee', answer: 'est allée' })
  })

  it('accepts any of a blank’s answers and shows the one matched', () => {
    const graded = gradeCloze(two, ['petite', 'calme'])
    expect(graded.outcome).toBe('correct')
    expect(graded.marks[1]).toMatchObject({ verdict: 'correct', answer: 'calme', others: ['tranquille'] })
  })

  it('is wrong if any blank is wrong, even when another is only off by accents', () => {
    const graded = gradeCloze(two, ['petit', 'tranquile'])
    expect(graded.outcome).toBe('wrong')
    expect(graded.marks.map((m) => m.verdict)).toEqual(['wrong', 'wrong'])
    expect(graded.marks[1]).toMatchObject({ answer: 'tranquille', others: ['calme'] })
  })

  it('is an accent mistake when every blank is right or off only by accents', () => {
    const accented: ClozePart[] = [{ answers: ['Où'] }, ' est la ', { answers: ['gare'] }, ' ?']
    expect(gradeCloze(accented, ['ou', 'gare']).outcome).toBe('accent')
  })

  it('marks a blank left empty in a card where others were filled', () => {
    const graded = gradeCloze(two, ['petite', ''])
    expect(graded.outcome).toBe('wrong')
    expect(graded.marks[1]).toMatchObject({ verdict: 'empty', typed: '', answer: 'tranquille' })
  })

  it('is "don’t know" for null or nothing typed, with every answer shown', () => {
    for (const typed of [null, ['', ' '], ['?', '']]) {
      const graded = gradeCloze(two, typed)
      expect(graded.outcome).toBe('dont-know')
      expect(graded.marks.map((m) => [m.verdict, m.answer])).toEqual([
        ['empty', 'petite'],
        ['empty', 'tranquille'],
      ])
    }
  })

  it('treats missing entries as empty blanks', () => {
    expect(gradeCloze(two, ['petite']).marks[1].verdict).toBe('empty')
  })

  it('grades every real drill right when filled with its own answers, wrong with the wrong ones', () => {
    const drills = parseItems(JSON.parse(itemsJson)).items.filter((i) => i.cloze)
    expect(drills.length).toBeGreaterThan(400)
    for (const { id, cloze } of drills) {
      const blanks = blanksOf(cloze!)
      const own = gradeCloze(cloze!, blanks.map((b) => b.answers[0]))
      expect(own.outcome, id).toBe('correct')
      const curly = gradeCloze(cloze!, blanks.map((b) => b.answers.at(-1)!.replace(/'/g, '’').toUpperCase()))
      expect(curly.outcome, id).toBe('correct')
      expect(gradeCloze(cloze!, blanks.map(() => 'xyz')).outcome, id).toBe('wrong')
    }
  })
})

describe('splitHint', () => {
  it('splits off the first word, keeping the space with the rest', () => {
    expect(splitHint('(aller)')).toEqual(['(aller)', ''])
    expect(splitHint('(your, vous)')).toEqual(['(your,', ' vous)'])
  })
})

describe('blankWidth', () => {
  it('fits the text plus a little, with a minimum', () => {
    expect(blankWidth('')).toBe('5.5ch')
    expect(blankWidth('est allée')).toBe('10.5ch')
    expect(blankWidth('œuf')).toBe('5.5ch')
  })
})
