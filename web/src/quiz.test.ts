import { describe, expect, it } from 'vitest'
import { audioUrl, keysText, replayKey, tone, VERDICTS } from './quiz'

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

  it('explains Enter with several blanks', () => {
    expect(keysText('asking', false, 2)).toMatch(/^Enter moves to the next blank, then checks/)
  })
})
