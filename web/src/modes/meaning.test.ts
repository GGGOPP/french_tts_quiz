import { describe, expect, it } from 'vitest'
import { gradeMeaning } from './meaning'

const EN = ['Are you on holiday?', 'Are you on vacation?']

describe('gradeMeaning', () => {
  it('is correct on a match and names the translation matched', () => {
    expect(gradeMeaning(EN, 'are you on vacation')).toEqual({ outcome: 'correct', answer: EN[1] })
  })

  it('counts a typo in a longer word as right, with the spelling to show', () => {
    expect(gradeMeaning(EN, 'Are you on vaccation?')).toEqual({ outcome: 'typo', answer: EN[1] })
  })

  it('asks you to mark yourself when nothing matches, rather than calling it wrong', () => {
    expect(gradeMeaning(EN, 'Are you away on your holidays?')).toEqual({ outcome: 'self-mark' })
    expect(gradeMeaning(EN, 'I like cheese')).toEqual({ outcome: 'self-mark' })
  })

  it('is don’t-know for null, nothing typed, or only punctuation', () => {
    for (const typed of [null, '', '   ', '?']) expect(gradeMeaning(EN, typed)).toEqual({ outcome: 'dont-know' })
  })
})
