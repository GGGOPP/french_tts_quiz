// End-of-session summary: the score, how the misses split, each missed card
// with what you typed against the answer, and "Retry missed".

import { MODE_TITLES, type Card } from './cards'
import { el, labelled } from './dom'
import { gradeCloze, markedCloze } from './modes/cloze'
import { gradeDictee, keepPunctuationTogether, markedSentence } from './modes/dictee'
import { gradeProduce, worthDiffing } from './modes/produce'
import { audioUrl } from './quiz'
import { breakdownText, missed, missedTag, summaryText, tally, type CardResult } from './session'

export interface SummaryHandlers {
  /** Ask the missed cards again (in the order they were asked; the caller shuffles). */
  onRetry(cards: Card[]): void
  /** Leave the summary: back to the start screen, or the rule browser. */
  onDone(): void
}

export interface SummaryOptions {
  /** The label of the button that leaves, e.g. "New session" or "Back to rules". */
  doneLabel?: string
}

const fr = (className: string, text: string) => {
  const p = el('p', className, keepPunctuationTogether(text))
  p.lang = 'fr'
  return p
}

const en = (className: string, text: string) => {
  const p = el('p', className, text)
  p.lang = 'en'
  return p
}

/**
 * A missed card, much as its feedback showed it: what was asked first, then
 * your answer marked against the right one (re-graded from what you typed).
 */
export function missedDetail({ card, typed, outcome }: CardResult): HTMLElement[] {
  const { item } = card
  const gaveUp = outcome === 'dont-know' || typed.length === 0
  const answer = typed.join(' ').trim()

  switch (card.mode) {
    case 'cloze': {
      const parts = item.cloze ?? [item.fr]
      return [markedCloze(parts, gradeCloze(parts, gaveUp ? null : typed).marks), en('missed-en', item.en[0])]
    }
    case 'dictee': {
      const sentence = gaveUp ? fr('dictee-result', item.fr) : markedSentence(item.fr, gradeDictee(item.fr, answer).words)
      return [sentence, en('missed-en', item.en[0])]
    }
    case 'meaning':
      return [
        fr('missed-fr', item.fr),
        ...(gaveUp ? [] : [labelled('You wrote:', answer, 'en', 'missed-typed')]),
        labelled('Answer:', item.en[0], 'en'),
      ]
    case 'produce': {
      const prompt = en('missed-en', item.en[0])
      if (gaveUp) return [prompt, fr('dictee-result', item.fr)]
      const { answer: model, words } = gradeProduce(item, answer)
      if (worthDiffing(words)) return [prompt, markedSentence(model, words)]
      return [prompt, labelled('You wrote:', answer, 'fr', 'missed-typed'), labelled('Answer:', keepPunctuationTogether(model), 'fr')]
    }
  }
}

/** Show the summary of a finished session. Returns a function that stops audio and removes listeners. */
export function renderSummary(
  root: HTMLElement,
  results: readonly CardResult[],
  handlers: SummaryHandlers,
  options: SummaryOptions = {},
): () => void {
  const misses = missed(results)
  const modes = [...new Set(results.map((r) => MODE_TITLES[r.card.mode]))]

  root.innerHTML = `
    <main class="summary-screen">
      <p class="summary-mode"></p>
      <h1>Session done</h1>
      <p class="headline"></p>
      <p class="breakdown"></p>
      <p class="all-right" hidden>Nothing missed. Bravo&nbsp;!</p>
      <div class="summary-actions">
        <button type="button" class="retry primary" hidden></button>
        <button type="button" class="done"></button>
      </div>
      <section class="missed" hidden>
        <h2 class="missed-title"></h2>
        <ol class="missed-list"></ol>
      </section>
    </main>`

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const retry = $<HTMLButtonElement>('.retry')
  const done = $<HTMLButtonElement>('.done')
  const list = $('.missed-list')

  const audio = new Audio()
  /** The button whose clip is playing, lit while it plays. */
  let playing: HTMLButtonElement | undefined
  const listeners = new AbortController()
  const { signal } = listeners

  const markPlaying = (on: boolean) => playing?.classList.toggle('playing', on)
  audio.addEventListener('playing', () => markPlaying(true), { signal })
  for (const ev of ['pause', 'ended'] as const) audio.addEventListener(ev, () => markPlaying(false), { signal })

  function play(button: HTMLButtonElement, path: string): void {
    markPlaying(false)
    playing = button
    audio.src = audioUrl(path)
    audio.play().catch(() => {}) // a tap is a gesture, so this only fails if the clip is missing
  }

  $('.summary-mode').textContent = modes.join(' · ')
  $('.headline').textContent = summaryText(tally(results))
  const breakdown = breakdownText(results)
  $('.breakdown').textContent = breakdown
  $('.breakdown').hidden = breakdown === ''
  done.textContent = options.doneLabel ?? 'New session'

  if (misses.length > 0) {
    $('.missed').hidden = false
    $('.missed-title').textContent = `Missed (${misses.length})`
    for (const result of misses) {
      const { item } = result.card
      const row = el('li')
      const buttons = el('div', 'missed-play')
      const say = el('button', 'say', '▶')
      const slow = el('button', 'say slow', '🐢')
      say.type = slow.type = 'button'
      say.setAttribute('aria-label', 'Play the sentence')
      slow.setAttribute('aria-label', 'Play it slowly')
      slow.title = 'Play it slowly'
      say.addEventListener('click', () => play(say, item.audio), { signal })
      slow.addEventListener('click', () => play(slow, item.audioSlow), { signal })
      buttons.append(say, slow)

      const text = el('div', 'missed-text')
      text.append(...missedDetail(result))
      const tag = missedTag(result)
      if (tag) text.append(el('span', `missed-tag ${result.outcome === 'accent' ? 'accent' : ''}`.trim(), tag))
      row.append(buttons, text)
      list.append(row)
    }
    retry.hidden = false
    retry.textContent = `Retry missed (${misses.length})`
    retry.addEventListener('click', () => handlers.onRetry(misses.map((r) => r.card)), { signal })
  } else if (results.length > 0) {
    $('.all-right').hidden = false
  }

  done.addEventListener('click', () => handlers.onDone(), { signal })
  ;(retry.hidden ? done : retry).focus()

  return () => {
    listeners.abort()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}
