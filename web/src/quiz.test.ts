import { describe, expect, it } from 'vitest'
import { audioUrl, keysText, replayKey, revealScroll, selfMarkKey, tone, VERDICTS } from './quiz'

const key = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('replayKey', () => {
  it('replays on Ctrl+Space and ↑', () => {
    expect(replayKey(key(' ', 'Space', { ctrlKey: true }))).toBe('normal')
    expect(replayKey(key('ArrowUp', 'ArrowUp'))).toBe('normal')
  })

  it('replays slowly on Ctrl+Shift+Space and ↓', () => {
    expect(replayKey(key(' ', 'Space', { ctrlKey: true, shiftKey: true }))).toBe('slow')
    expect(replayKey(key('ArrowDown', 'ArrowDown'))).toBe('slow')
  })

  it('ignores plain Space (it types a space), other keys and other modifiers', () => {
    expect(replayKey(key(' ', 'Space'))).toBeUndefined()
    expect(replayKey(key('Enter', 'Enter'))).toBeUndefined()
    expect(replayKey(key('ArrowUp', 'ArrowUp', { shiftKey: true }))).toBeUndefined() // selects text
    expect(replayKey(key('ArrowDown', 'ArrowDown', { shiftKey: true }))).toBeUndefined()
    expect(replayKey(key(' ', 'Space', { metaKey: true }))).toBeUndefined()
    expect(replayKey(key(' ', 'Space', { ctrlKey: true, altKey: true }))).toBeUndefined()
    expect(replayKey(key('e', 'KeyE', { altKey: true }))).toBeUndefined() // the accent shortcut
    expect(replayKey(key('a', 'KeyA', { ctrlKey: true }))).toBeUndefined()
  })
})

describe('audioUrl', () => {
  it('puts the clip under the base URL', () => {
    expect(audioUrl('audio/resto-03.mp3', '/')).toBe('/audio/resto-03.mp3')
    expect(audioUrl('audio/resto-03.slow.mp3', '/french_tts_quiz/')).toBe('/french_tts_quiz/audio/resto-03.slow.mp3')
    expect(audioUrl('/audio/resto-03.mp3', '/french_tts_quiz')).toBe('/french_tts_quiz/audio/resto-03.mp3')
  })
})

describe('verdicts and tone', () => {
  it('has a heading for every outcome', () => {
    expect(VERDICTS.accent).toMatch(/accent/)
    expect(Object.keys(VERDICTS).sort()).toEqual(['accent', 'correct', 'dont-know', 'typo', 'wrong'])
  })

  it('is green when right, amber for accents, red otherwise', () => {
    expect(tone('correct')).toBe('right')
    expect(tone('typo')).toBe('right')
    expect(tone('accent')).toBe('accent')
    expect(tone('wrong')).toBe('wrong')
    expect(tone('dont-know')).toBe('wrong')
  })
})

describe('keysText', () => {
  it('lists replays only when the clip may be heard', () => {
    expect(keysText('asking', true)).toMatch(/^Ctrl\+Space or ↑ replays · Ctrl\+Shift\+Space or ↓ slowly · Enter checks/)
    expect(keysText('asking', false)).toMatch(/^Enter checks/)
    expect(keysText('feedback', true)).toBe('Ctrl+Space or ↑ replays · Ctrl+Shift+Space or ↓ slowly · Enter for the next question')
  })

  it('lists Y and N while you mark your own answer', () => {
    expect(keysText('marking', true)).toBe('Ctrl+Space or ↑ replays · Ctrl+Shift+Space or ↓ slowly · Y if you were right · N if not')
  })

  it('explains Enter with several blanks', () => {
    expect(keysText('asking', false, 2)).toMatch(/^Enter moves to the next blank, then checks/)
  })
})

describe('selfMarkKey', () => {
  it('marks right on Y and wrong on N, either case', () => {
    expect(selfMarkKey(key('y', 'KeyY'))).toBe('right')
    expect(selfMarkKey(key('Y', 'KeyY', { shiftKey: true }))).toBe('right')
    expect(selfMarkKey(key('n', 'KeyN'))).toBe('wrong')
  })

  it('ignores other keys and shortcuts', () => {
    expect(selfMarkKey(key('Enter', 'Enter'))).toBeUndefined()
    expect(selfMarkKey(key('n', 'KeyN', { ctrlKey: true }))).toBeUndefined()
    expect(selfMarkKey(key('y', 'KeyY', { altKey: true }))).toBeUndefined()
  })
})

describe('revealScroll', () => {
  it('scrolls just enough to show the whole feedback when the answer row stays on screen', () => {
    expect(revealScroll(120, 300)).toBe(120)
  })

  it('stops with the answer row at the top when the feedback is taller than the screen', () => {
    expect(revealScroll(900, 250)).toBe(250)
  })

  it('never scrolls up', () => {
    expect(revealScroll(-40, 300)).toBe(0) // the feedback already fits
    expect(revealScroll(200, -10)).toBe(0) // the answer row is already above the top
  })
})
