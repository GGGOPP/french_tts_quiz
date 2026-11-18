import { describe, expect, it } from 'vitest'
import itemsJson from '../public/items.json?raw'
import { compare, diffWords, normalise, stripAccents, tokenize, type DiffWord } from './french'

describe('normalise', () => {
  it.each([
    ['Hier, elle est allée au marché.', 'hier elle est allée au marché'],
    ['  Je   voudrais un café ', 'je voudrais un café'],
    ['l’ami', "l'ami"], // curly apostrophe
    ['l‘ami', "l'ami"],
    ["l' ami", "l'ami"], // space after an apostrophe
    ['Tu viens ?', 'tu viens'], // non-breaking space before ?
    ['Quoi !', 'quoi'], // narrow no-break space
    ['« Bonjour » — dit-il…', 'bonjour dit-il'],
    ['Dépêche‑toi !', 'dépêche-toi'], // non-breaking hyphen
    ['ÉCOLE', 'école'],
    ['été', 'été'], // decomposed accents → NFC
    ["à l'", "à l'"], // a trailing elided article is kept
    ['', ''],
  ])('%j → %j', (text, expected) => {
    expect(normalise(text)).toBe(expected)
  })

  it('keeps accents and hyphens', () => {
    expect(normalise('Est-ce que tu as été là ?')).toBe('est-ce que tu as été là')
  })
})

describe('stripAccents', () => {
  it.each([
    ['allée', 'allee'],
    ['ça', 'ca'],
    ['où', 'ou'],
    ['naïf', 'naif'],
    ['cœur', 'coeur'],
    ['ex æquo', 'ex aequo'],
  ])('%j → %j', (text, expected) => {
    expect(stripAccents(text)).toBe(expected)
  })
})

describe('compare', () => {
  it('accepts an exact answer', () => {
    expect(compare('est allée', ['est allée'])).toEqual({ verdict: 'correct', answer: 'est allée' })
  })

  it('labels an accent-only mistake, which is still not correct', () => {
    expect(compare('allee', ['allée'])).toEqual({ verdict: 'accent', answer: 'allée' })
    expect(compare('allée', ['allee'])).toEqual({ verdict: 'accent', answer: 'allee' }) // an extra accent too
    expect(compare('a la', ['à la'])).toEqual({ verdict: 'accent', answer: 'à la' })
    expect(compare('coeur', ['cœur'])).toEqual({ verdict: 'accent', answer: 'cœur' })
    expect(compare('ou', ['où'])).toEqual({ verdict: 'accent', answer: 'où' })
  })

  it('has no typo tolerance', () => {
    expect(compare('allez', ['allons'])).toEqual({ verdict: 'wrong' })
    expect(compare('allé', ['allée'])).toEqual({ verdict: 'wrong' }) // agreement matters
    expect(compare('Dépêche toi', ['Dépêche-toi'])).toEqual({ verdict: 'wrong' }) // hyphens matter
    expect(compare('lami', ["l'ami"])).toEqual({ verdict: 'wrong' })
  })

  it('treats curly and straight apostrophes as the same', () => {
    expect(compare('l’ami', ["l'ami"]).verdict).toBe('correct')
    expect(compare("l'ami", ['l’ami']).verdict).toBe('correct')
  })

  it('ignores case, spacing and punctuation', () => {
    expect(compare("  l' Ami ", ["L'ami"]).verdict).toBe('correct')
    expect(compare('je voudrais un café s’il vous plaît', ["Je voudrais un café, s'il vous plaît."]).verdict).toBe(
      'correct',
    )
    expect(compare('Tu viens ?', ['Tu viens?']).verdict).toBe('correct')
  })

  it('accepts any of the alternatives', () => {
    expect(compare('Je suis', ['Je suis allé', 'Je suis']).answer).toBe('Je suis')
  })

  it('prefers an exact match over an earlier accent-only one', () => {
    expect(compare('a', ['à', 'a'])).toEqual({ verdict: 'correct', answer: 'a' })
  })

  it('rejects an empty or blank answer', () => {
    expect(compare('', ['à'])).toEqual({ verdict: 'wrong' })
    expect(compare(' ?! ', ['à'])).toEqual({ verdict: 'wrong' })
    expect(compare('à', [])).toEqual({ verdict: 'wrong' })
  })
})

describe('tokenize', () => {
  const words = (text: string) => tokenize(text).map((t) => t.text)

  it('splits elided words into their own tokens', () => {
    expect(words("J'ai vu l'ami qu'il aime.")).toEqual(["J'", 'ai', 'vu', "l'", 'ami', "qu'", 'il', 'aime'])
    expect(words("C'est jusqu'à demain, s'il te plaît.")).toEqual([
      "C'",
      'est',
      "jusqu'",
      'à',
      'demain',
      "s'",
      'il',
      'te',
      'plaît',
    ])
    expect(words("Je n'en sais rien.")).toEqual(['Je', "n'", 'en', 'sais', 'rien'])
  })

  it("keeps words with an apostrophe inside them whole", () => {
    expect(words("Aujourd'hui, quelqu'un est venu.")).toEqual(["Aujourd'hui", "quelqu'un", 'est', 'venu'])
  })

  it('keeps hyphenated words whole', () => {
    expect(words("Qu'est-ce que c'est ? A-t-il fini ?")).toEqual(["Qu'", 'est-ce', 'que', "c'", 'est', 'A-t-il', 'fini'])
  })

  it('gives each token its compare form', () => {
    expect(tokenize('L’Été')).toEqual([
      { text: "L'", norm: "l'" },
      { text: 'Été', norm: 'été' },
    ])
  })

  it('drops stray marks and gives nothing for an empty answer', () => {
    expect(words(" - ' ")).toEqual([])
    expect(words('')).toEqual([])
  })
})

describe('diffWords', () => {
  const marks = (words: DiffWord[]) => words.map((w) => `${w.mark}:${w.expected ?? ''}/${w.typed ?? ''}`)

  it('marks a perfect dictée correct', () => {
    const result = diffWords('hier elle est allée au marché', 'Hier, elle est allée au marché.')
    expect(result.correct).toBe(true)
    expect(result.words.every((w) => w.mark === 'right')).toBe(true)
    expect(result.words[0]).toEqual({ mark: 'right', expected: 'Hier', typed: 'hier' })
  })

  it('marks an accent-only word, which makes the answer wrong', () => {
    const result = diffWords('Elle est allee au marche', 'Elle est allée au marché.')
    expect(result.correct).toBe(false)
    expect(marks(result.words)).toEqual([
      'right:Elle/Elle',
      'right:est/est',
      'accent:allée/allee',
      'right:au/au',
      'accent:marché/marche',
    ])
  })

  it('marks a missing word', () => {
    const result = diffWords('Je allé au cinéma', 'Je suis allé au cinéma.')
    expect(result.correct).toBe(false)
    expect(marks(result.words)).toEqual(['right:Je/Je', 'missing:suis/', 'right:allé/allé', 'right:au/au', 'right:cinéma/cinéma'])
  })

  it('marks an extra word where it was typed', () => {
    const result = diffWords('Je ne vais pas au au cinéma', 'Je ne vais pas au cinéma.')
    expect(result.correct).toBe(false)
    expect(result.words.filter((w) => w.mark === 'extra')).toEqual([{ mark: 'extra', typed: 'au' }])
    expect(result.words).toHaveLength(7)
  })

  it('marks a wrong word against the word it replaces', () => {
    const result = diffWords('Nous allez au parc', 'Nous allons au parc.')
    expect(marks(result.words)).toEqual(['right:Nous/Nous', 'wrong:allons/allez', 'right:au/au', 'right:parc/parc'])
  })

  it('pairs a misspelt word with its look-alike rather than a neighbour', () => {
    // "chate" should pair with "chat", leaving "noir" missing, not the other way round.
    const result = diffWords('le chate', 'le chat noir')
    expect(marks(result.words)).toEqual(['right:le/le', 'wrong:chat/chate', 'missing:noir/'])
  })

  it('treats a dropped elision apostrophe as a wrong word', () => {
    const result = diffWords('je lai vu', "Je l'ai vu.")
    expect(result.correct).toBe(false)
    expect(result.words.map((w) => w.mark)).toContain('missing')
  })

  it('accepts curly apostrophes and extra spaces', () => {
    expect(diffWords('j’ai  faim', "J'ai faim.").correct).toBe(true)
    expect(diffWords("j' ai faim", "J'ai faim.").correct).toBe(true)
  })

  it('marks everything missing for an empty answer', () => {
    const result = diffWords('', 'Bonjour madame.')
    expect(result.correct).toBe(false)
    expect(marks(result.words)).toEqual(['missing:Bonjour/', 'missing:madame/'])
  })

  it('marks everything extra against an empty sentence, and is never correct', () => {
    expect(diffWords('', '').correct).toBe(false)
    expect(marks(diffWords('oui', '').words)).toEqual(['extra:/oui'])
  })
})

describe('the real items', () => {
  type ClozePart = string | { answers: string[]; hint?: string }
  const { items } = JSON.parse(itemsJson) as {
    items: { id: string; fr: string; altFr?: string[]; cloze?: ClozePart[] }[]
  }

  it('loads them', () => {
    expect(items.length).toBeGreaterThan(600)
  })

  it('every sentence is a correct dictée of itself, with no empty tokens', () => {
    for (const item of items) {
      const result = diffWords(item.fr, item.fr)
      expect(result.correct, item.id).toBe(true)
      expect(tokenize(item.fr).every((t) => t.norm !== ''), item.id).toBe(true)
    }
  })

  it('every sentence and cloze answer matches itself and its curly-apostrophe form', () => {
    for (const item of items) {
      const answers = [item.fr, ...(item.altFr ?? [])]
      for (const part of item.cloze ?? []) if (typeof part !== 'string') answers.push(...part.answers)
      for (const answer of answers) {
        expect(compare(answer, [answer]).verdict, `${item.id}: ${answer}`).toBe('correct')
        expect(compare(answer.replace(/'/g, '’'), [answer]).verdict, `${item.id}: ${answer}`).toBe('correct')
      }
    }
  })
})
