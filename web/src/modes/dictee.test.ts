import { describe, expect, it } from 'vitest'
import itemsJson from '../../public/items.json?raw'
import { diffWords, tokenize, type DiffWord } from '../french'
import { parseItems } from '../items'
import { gradeDictee, keepPunctuationTogether, layoutSentence, mistakeSummary, sentenceGaps } from './dictee'

const sentence = 'Hier, elle est allée au marché.'

/** The layout as text: right words as they are, others as [mark:typed>expected]. */
function show(parts: (string | DiffWord)[]): string {
  return parts
    .map((p) => {
      if (typeof p === 'string') return p
      if (p.mark === 'right') return p.expected
      return `[${p.mark}:${p.typed ?? ''}>${p.expected ?? ''}]`
    })
    .join('')
}

describe('gradeDictee', () => {
  it('is correct when every word is right, ignoring case and punctuation', () => {
    expect(gradeDictee(sentence, 'hier elle est allée au marché').outcome).toBe('correct')
    expect(gradeDictee(sentence, 'Hier,  elle est allée au marché !').outcome).toBe('correct')
  })

  it('labels accent-only mistakes, still not right', () => {
    expect(gradeDictee(sentence, 'Hier elle est allee au marche').outcome).toBe('accent')
  })

  it('is wrong with any wrong, missing or extra word, even alongside accent slips', () => {
    expect(gradeDictee(sentence, 'Hier elle est allé au marche').outcome).toBe('wrong')
    expect(gradeDictee(sentence, 'Hier elle allée au marché').outcome).toBe('wrong')
    expect(gradeDictee(sentence, 'Hier elle est est allée au marché').outcome).toBe('wrong')
  })

  it('is don’t-know for null or nothing but punctuation, with every word missing', () => {
    for (const typed of [null, '', '  ', '?!']) {
      const graded = gradeDictee(sentence, typed)
      expect(graded.outcome).toBe('dont-know')
      expect(graded.words.every((w) => w.mark === 'missing')).toBe(true)
    }
  })
})

describe('sentenceGaps', () => {
  it('finds the punctuation and spaces around each word', () => {
    const words = tokenize(sentence).map((t) => t.text)
    expect(sentenceGaps(sentence, words)).toEqual(['', ', ', ' ', ' ', ' ', ' ', '.'])
  })

  it('has no gap after an elision', () => {
    const text = "Je l'ai vu, d'accord ?"
    const words = tokenize(text).map((t) => t.text)
    expect(words).toEqual(['Je', "l'", 'ai', 'vu', "d'", 'accord'])
    expect(sentenceGaps(text, words)).toEqual(['', ' ', '', ' ', ', ', '', ' ?'])
  })

  it('falls back to spaces when a word is not in the sentence', () => {
    expect(sentenceGaps('Bonjour madame.', ['Bonjour', 'monsieur'])).toEqual(['', ' ', ''])
    expect(sentenceGaps('', [])).toEqual([''])
  })
})

describe('layoutSentence', () => {
  const layout = (typed: string, text = sentence) => show(layoutSentence(text, diffWords(typed, text).words))

  it('rebuilds the sentence with its punctuation when all is right', () => {
    expect(layout('hier elle est allée au marché')).toBe(sentence)
  })

  it('marks wrong, accent and missing words in place', () => {
    expect(layout('Hier elle allee au marche')).toBe(
      'Hier, elle [missing:>est] [accent:allee>allée] au [accent:marche>marché].',
    )
    expect(layout('Hier elle est allé au marché')).toBe('Hier, elle est [wrong:allé>allée] au marché.')
  })

  it('slots extra words where they were typed, keeping the final punctuation last', () => {
    expect(layout('Hier elle est est allée au marché')).toBe('Hier, elle [extra:est>] est allée au marché.')
    expect(layout('alors hier elle est allée au marché')).toBe('[extra:alors>] Hier, elle est allée au marché.')
    expect(layout('hier elle est allée au marché hier')).toBe('Hier, elle est allée au marché [extra:hier>].')
    expect(layout('hier oui elle est allée au marché')).toBe('Hier, [extra:oui>] elle est allée au marché.')
  })

  it('keeps elisions joined and separates an extra word after one', () => {
    const text = "Je l'ai vu."
    expect(layout("je l'ai vu", text)).toBe(text)
    expect(layout('je le ai vu', text)).toBe("Je [wrong:le>l']ai vu.")
    expect(layout("je l' bien ai vu", text)).toBe("Je l' [extra:bien>] ai vu.")
  })
})

describe('keepPunctuationTogether', () => {
  it('makes the space before ? ! : ; » and after « non-breaking', () => {
    expect(keepPunctuationTogether('Quel âge as-tu ?')).toBe('Quel âge as-tu ?')
    expect(keepPunctuationTogether('Il a dit : « Oui ! »')).toBe('Il a dit : « Oui ! »')
    expect(keepPunctuationTogether('Hier, elle est allée au marché.')).toBe('Hier, elle est allée au marché.')
  })
})

describe('mistakeSummary', () => {
  it('counts each kind of mistake, with plurals', () => {
    const words = diffWords('Hier elle allee au marche fromage', sentence).words
    expect(mistakeSummary(words)).toBe('2 accents · 1 missing word · 1 extra word')
    expect(mistakeSummary(diffWords('hier elle sont allé au marché', sentence).words)).toBe('2 wrong words')
  })

  it('is empty when every word is right', () => {
    expect(mistakeSummary(diffWords(sentence, sentence).words)).toBe('')
  })
})

describe('the real sentences', () => {
  const { items } = parseItems(JSON.parse(itemsJson))

  it('each grade correct as a dictée of themselves, also with curly apostrophes and no punctuation', () => {
    for (const item of items) {
      expect(gradeDictee(item.fr, item.fr).outcome, item.id).toBe('correct')
      expect(gradeDictee(item.fr, item.fr.replace(/'/g, '’')).outcome, item.id).toBe('correct')
      expect(gradeDictee(item.fr, item.fr.replace(/[^\p{L}\p{N}'\s-]/gu, '').toLowerCase()).outcome, item.id).toBe('correct')
    }
  })

  it('each have every word found in place, so the feedback keeps their punctuation', () => {
    for (const item of items) {
      const words = tokenize(item.fr).map((t) => t.text)
      const gaps = sentenceGaps(item.fr, words)
      expect(gaps.map((g, i) => g + (words[i] ?? '')).join(''), item.id).toBe(item.fr.normalize('NFC'))
      expect(show(layoutSentence(item.fr, diffWords(item.fr, item.fr).words)), item.id).toBe(item.fr.normalize('NFC'))
    }
  })
})
