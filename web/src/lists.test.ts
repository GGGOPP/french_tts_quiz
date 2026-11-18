import { describe, expect, it } from 'vitest'
import itemsJson from '../public/items.json?raw'
import { parseItems } from './items'
import { cleanListName, foldForSearch, listLink, matchesSearch, parseListParam, sameIds, searchKey } from './lists'

const KNOWN = new Set(['resto-01', 'resto-02', 'pce-12', 'neg-03'])

describe('parseListParam', () => {
  it('is undefined without a list parameter', () => {
    expect(parseListParam('', KNOWN)).toBeUndefined()
    expect(parseListParam('?other=1', KNOWN)).toBeUndefined()
  })

  it('reads known ids in order, without repeats or blanks', () => {
    expect(parseListParam('?list=pce-12,resto-01, neg-03 ,,resto-01', KNOWN)).toEqual({
      ids: ['pce-12', 'resto-01', 'neg-03'],
      skipped: 0,
    })
  })

  it('counts unknown ids as skipped', () => {
    expect(parseListParam('?list=resto-01,gone-99,typo,gone-99', KNOWN)).toEqual({ ids: ['resto-01'], skipped: 2 })
    expect(parseListParam('?list=gone-99', KNOWN)).toEqual({ ids: [], skipped: 1 })
    expect(parseListParam('?list=', KNOWN)).toEqual({ ids: [], skipped: 0 })
  })

  it('accepts commas encoded as %2C (some apps re-encode links)', () => {
    expect(parseListParam('?list=resto-01%2Cresto-02', KNOWN)?.ids).toEqual(['resto-01', 'resto-02'])
  })
})

describe('listLink', () => {
  it('round-trips through parseListParam', () => {
    const page = 'https://example.github.io/french_tts_quiz/'
    const link = listLink(['resto-02', 'neg-03'], page)
    expect(link).toBe('https://example.github.io/french_tts_quiz/?list=resto-02,neg-03')
    expect(parseListParam(new URL(link).search, KNOWN)?.ids).toEqual(['resto-02', 'neg-03'])
  })

  it('keeps every real item id link-safe', () => {
    const ids = parseItems(JSON.parse(itemsJson)).items.map((i) => i.id)
    const link = listLink(ids, 'https://example.com/')
    expect(parseListParam(new URL(link).search, new Set(ids))).toEqual({ ids, skipped: 0 })
  })
})

describe('search', () => {
  it('ignores accents, case, ligatures, apostrophe style and punctuation', () => {
    expect(foldForSearch('  Œuf, s’il vous plaît !  ')).toBe("oeuf s'il vous plait")
    const key = searchKey({ fr: 'Je voudrais un café, s’il vous plaît.', altFr: ["Je voudrais un café, s'il te plaît."], en: ['I would like a coffee please'] })
    for (const q of ['cafe', 'CAFÉ', "s'il vous", 'café s’il', 'te plait', 'COFFEE', '', '  ']) expect(matchesSearch(key, q)).toBe(true)
    for (const q of ['thé', 'cafés']) expect(matchesSearch(key, q)).toBe(false)
  })

  it('finds every real item by its own French and English', () => {
    for (const item of parseItems(JSON.parse(itemsJson)).items) {
      const key = searchKey(item)
      expect(matchesSearch(key, item.fr)).toBe(true)
      expect(matchesSearch(key, item.en[0])).toBe(true)
    }
  })
})

describe('cleanListName', () => {
  it('trims, collapses spaces and caps the length', () => {
    expect(cleanListName('  Passé   composé ')).toBe('Passé composé')
    expect(cleanListName('   ')).toBe('')
    expect(cleanListName('x'.repeat(60))).toHaveLength(40)
  })
})

describe('sameIds', () => {
  it('compares as sets', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameIds(['a', 'b', 'a'], ['b', 'a'])).toBe(true)
    expect(sameIds(['a'], ['a', 'b'])).toBe(false)
    expect(sameIds([], [])).toBe(true)
  })
})
