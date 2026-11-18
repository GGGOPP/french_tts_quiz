import { describe, expect, it } from 'vitest'
import { ACCENTS, insertion, shortcut, shortcutHint, SHORTCUTS, withCase, type Cycle } from './accentbar'

/** Apply a replacement to a string, as `setRangeText(…, 'end')` does; returns the text and cursor. */
function applyTo(value: string, r: { start: number; end: number; text: string }) {
  return { value: value.slice(0, r.start) + r.text + value.slice(r.end), cursor: r.start + r.text.length }
}

/** Press Alt+key on `value` with the cursor at `cursor`, carrying the cycle along. */
function press(state: { value: string; cursor: number; cycle: Cycle | null }, code: string, upper = false) {
  const result = shortcut(code, upper, state.cycle, state.cursor, state.cursor)
  if (!result) throw new Error(`no shortcut for ${code}`)
  return { ...applyTo(state.value, result.replace), cycle: result.cycle }
}

describe('ACCENTS and SHORTCUTS', () => {
  it('has the letters from the plan', () => {
    expect(ACCENTS.join('')).toBe('éèêëàâçîïôùûœ')
  })

  it('reaches every bar letter by a shortcut, and nothing else', () => {
    expect(Object.values(SHORTCUTS).flat().sort()).toEqual([...ACCENTS].sort())
  })
})

describe('withCase', () => {
  it.each([
    ['é', 'É'],
    ['à', 'À'],
    ['ç', 'Ç'],
    ['œ', 'Œ'],
    ['ù', 'Ù'],
  ])('%s → %s', (lower, upper) => {
    expect(withCase(lower, true)).toBe(upper)
    expect(withCase(lower, false)).toBe(lower)
  })
})

describe('insertion', () => {
  it('types at the cursor', () => {
    expect(applyTo('tre', insertion('ê', false, 1, 1))).toEqual({ value: 'têre', cursor: 2 })
  })

  it('types over a selection', () => {
    expect(applyTo('allee', insertion('é', false, 3, 4))).toEqual({ value: 'allée', cursor: 4 })
  })

  it('types a capital when asked', () => {
    expect(applyTo('cole', insertion('é', true, 0, 0))).toEqual({ value: 'École', cursor: 1 })
  })
})

describe('shortcut', () => {
  const start = (value: string, cursor = value.length) => ({ value, cursor, cycle: null })

  it('types the first letter of the key', () => {
    expect(press(start('caf'), 'KeyE')).toMatchObject({ value: 'café', cursor: 4 })
    expect(press(start('gar'), 'KeyC')).toMatchObject({ value: 'garç', cursor: 4 })
  })

  it('cycles through the letters while the key is pressed again', () => {
    let s = press(start('tr'), 'KeyE')
    expect(s.value).toBe('tré')
    s = press(s, 'KeyE')
    expect(s.value).toBe('trè')
    s = press(s, 'KeyE')
    expect(s.value).toBe('trê')
    s = press(s, 'KeyE')
    expect(s.value).toBe('trë')
    s = press(s, 'KeyE')
    expect(s).toMatchObject({ value: 'tré', cursor: 3 }) // wraps round
  })

  it('cycles in the middle of a word', () => {
    let s = press(start('ftre', 1), 'KeyE')
    expect(s).toMatchObject({ value: 'fétre', cursor: 2 })
    s = press(s, 'KeyE')
    s = press(s, 'KeyE')
    expect(s).toMatchObject({ value: 'fêtre', cursor: 2 })
  })

  it('types a fresh letter once the cycle is reset (Alt released), so créé works', () => {
    let s = press(start('cr'), 'KeyE')
    s = press({ ...s, cycle: null }, 'KeyE')
    expect(s.value).toBe('créé')
  })

  it('starts a new cycle for a different key', () => {
    let s = press(start('o'), 'KeyE')
    s = press(s, 'KeyU')
    expect(s.value).toBe('oéù')
  })

  it('starts fresh if the cursor moved since the last press', () => {
    const s = press(start('ab'), 'KeyE') // "abé", cursor 3
    const moved = press({ ...s, cursor: 1 }, 'KeyE')
    expect(moved.value).toBe('aébé')
  })

  it('replaces a selection rather than cycling', () => {
    const s = press(start('x'), 'KeyE')
    const result = shortcut('KeyE', false, s.cycle, 0, 2)!
    expect(applyTo(s.value, result.replace).value).toBe('é')
  })

  it('cycles a single-letter key in place', () => {
    let s = press(start(''), 'KeyC')
    s = press(s, 'KeyC')
    expect(s).toMatchObject({ value: 'ç', cursor: 1 })
  })

  it('gives capitals with Shift, including mid-cycle', () => {
    let s = press(start(''), 'KeyE', true)
    expect(s.value).toBe('É')
    s = press(s, 'KeyE', true)
    expect(s.value).toBe('È')
    s = press(start('c'), 'KeyO', true)
    s = press(s, 'KeyO', true)
    expect(s.value).toBe('cŒ')
  })

  it('ignores keys without a shortcut', () => {
    expect(shortcut('KeyZ', false, null, 0, 0)).toBeNull()
    expect(shortcut('AltLeft', false, null, 0, 0)).toBeNull()
  })
})

describe('shortcutHint', () => {
  it.each([
    ['é', 'Alt+E'],
    ['è', 'Alt+E ×2'],
    ['ë', 'Alt+E ×4'],
    ['ç', 'Alt+C'],
    ['œ', 'Alt+O ×2'],
  ])('%s → %s', (letter, hint) => {
    expect(shortcutHint(letter)).toBe(hint)
  })

  it('has a hint for every bar letter', () => {
    for (const letter of ACCENTS) expect(shortcutHint(letter), letter).toBeDefined()
  })
})
