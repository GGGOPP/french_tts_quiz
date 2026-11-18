// The quiz screen, shared by every exercise mode. It runs the session (header,
// progress, score, audio, Check / Next, the feedback panel, stats) and hands
// what differs to the card's mode module: the prompt, how to grade, and what
// the feedback says.
//
// Audio on phones: browsers only let a page start sound from a user gesture.
// A single <audio> element is reused for every clip, so once one play() has
// been allowed (the Start tap usually counts; if not, the ▶ tap does), the
// following cards can play automatically.
//
// A card's result is saved and scored when you move on from its feedback.

import { attachAccentBar } from './accentbar'
import type { Card, Mode } from './cards'
import { isBlankAnswer, isRight, scoreText, tally, type CardResult, type Outcome } from './session'
import type { Store } from './storage'

/** A graded answer: the outcome, and how to show the feedback for it. */
export interface Graded {
  /**
   * `self-mark`: the answer couldn't be checked (no match, and no LLM grader to
   * ask), so the feedback shows the answer and you say whether you were right.
   */
  outcome: Outcome | 'self-mark'
  /** Fill the feedback panel under its heading: the answer, a word diff, the rule… */
  show(body: HTMLElement): void
}

/** What one exercise mode supplies to the quiz screen. */
export interface ModeModule {
  /** The line above the prompt, e.g. "Type what you hear". */
  instruction: string
  /**
   * When the clip plays: while asking (it is the question), or only with the
   * feedback (in cloze and English → French it would give the answer away).
   */
  audioWhen: 'ask' | 'feedback'
  /** The answer box: its language (French gets the accent bar), label and placeholder. */
  answer: { lang: 'fr' | 'en'; label: string; placeholder: string }
  /**
   * Fill the prompt area for a card. Return French answer boxes placed inside
   * it (a cloze's blanks) to use them instead of the answer box.
   */
  ask(card: Card, prompt: HTMLElement): HTMLInputElement[] | void
  /** Grade what was typed (one entry per box), or null for "Don't know". May wait (the LLM grader). */
  grade(card: Card, typed: string[] | null): Graded | Promise<Graded>
}

export type Modes = Partial<Record<Mode, ModeModule>>

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/**
 * Which replay a key asks for: Ctrl+Space or ↑ replays the clip, Ctrl+Shift+Space
 * or ↓ replays it slowly. Undefined for any other key.
 */
export function replayKey(e: KeyLike): 'normal' | 'slow' | undefined {
  if (e.altKey || e.metaKey) return undefined
  if (e.ctrlKey) {
    if (e.code !== 'Space' && e.key !== ' ') return undefined
    return e.shiftKey ? 'slow' : 'normal'
  }
  if (e.shiftKey) return undefined // Shift+↑/↓ selects text
  if (e.key === 'ArrowUp') return 'normal'
  if (e.key === 'ArrowDown') return 'slow'
  return undefined
}

/** URL of a clip (a path relative to the site root), under the site's base URL. */
export function audioUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  return `${base.replace(/\/?$/, '/')}${path.replace(/^\//, '')}`
}

/** The heading of the feedback panel. */
export const VERDICTS: Record<Outcome, string> = {
  correct: '✓ Correct',
  typo: '✓ Almost: check the spelling',
  accent: '✗ Check the accents',
  wrong: '✗ Not quite',
  'dont-know': '✗ The answer was',
}

/** The feedback heading while you mark your own answer, and once you have. */
export const SELF_MARK = {
  ask: 'Were you right?',
  right: '✓ Marked right',
  wrong: '✗ Marked wrong',
} as const

/** Which self-mark a key gives: Y for right, N for wrong. Undefined for any other key. */
export function selfMarkKey(e: KeyLike): 'right' | 'wrong' | undefined {
  if (e.ctrlKey || e.altKey || e.metaKey) return undefined
  if (e.key === 'y' || e.key === 'Y') return 'right'
  if (e.key === 'n' || e.key === 'N') return 'wrong'
  return undefined
}

/** The tone of the feedback panel: green, amber for accent-only mistakes, red. */
export function tone(outcome: Outcome): 'right' | 'accent' | 'wrong' {
  if (isRight(outcome)) return 'right'
  return outcome === 'accent' ? 'accent' : 'wrong'
}

/** The keyboard help line under the quiz (hidden on touch screens). */
export function keysText(phase: 'asking' | 'marking' | 'feedback', withAudio: boolean, blanks = 1): string {
  const replay = withAudio ? ['Ctrl+Space or ↑ replays', 'Ctrl+Shift+Space or ↓ slowly'] : []
  if (phase === 'marking') return [...replay, 'Y if you were right', 'N if not'].join(' · ')
  if (phase === 'feedback') return [...replay, 'Enter for the next question'].join(' · ')
  const enter = blanks > 1 ? ['Enter moves to the next blank, then checks'] : ['Enter checks']
  return [...replay, ...enter, 'Enter with nothing typed if you don’t know'].join(' · ')
}

/**
 * How far to scroll down to show the feedback: enough to bring its bottom into
 * view, but never so far that the answer row (with Check / Next) leaves the top.
 * `overflow`: how far the feedback's bottom is below the visible area;
 * `anchorTop`: the answer row's top, from the top of the visible area.
 */
export function revealScroll(overflow: number, anchorTop: number): number {
  return Math.max(0, Math.min(overflow, anchorTop))
}

export type QuizStore = Pick<Store, 'record'>

export interface QuizHandlers {
  /** The last card's result is final. `results` has one entry per card, in order. */
  onFinish(results: CardResult[]): void
  /** The user left the session early. */
  onQuit(): void
  /** One card's result is final (called before the next card, or before onFinish). */
  onResult?(result: CardResult): void
}

/** Show the quiz for `cards`. Returns a function that stops audio and removes listeners. */
export function renderQuiz(
  root: HTMLElement,
  cards: readonly Card[],
  modes: Modes,
  store: QuizStore,
  handlers: QuizHandlers,
): () => void {
  root.innerHTML = `
    <main class="quiz">
      <header class="quiz-bar">
        <button type="button" class="quit">✕ Quit</button>
        <span class="progress" aria-live="polite"></span>
        <span class="score"></span>
      </header>
      <div class="listen">
        <button type="button" class="play" aria-label="Play the sentence">
          <span class="play-icon" aria-hidden="true">▶</span>
        </button>
        <button type="button" class="play-slow" aria-label="Play it slowly" title="Play it slowly">
          <span aria-hidden="true">🐢</span>
        </button>
      </div>
      <p class="play-hint" aria-live="polite"></p>
      <form class="answer-form" autocomplete="off">
        <p class="instruction"></p>
        <div class="prompt"></div>
        <div class="answer-row">
          <input class="answer" type="text" name="answer" autocapitalize="off" autocorrect="off"
            spellcheck="false" enterkeyhint="go" />
          <button type="submit" class="check primary">Check</button>
        </div>
        <div class="bar-slot"></div>
      </form>
      <button type="button" class="dont-know">Don’t know</button>
      <section class="feedback" aria-live="polite" hidden>
        <h2 class="verdict"></h2>
        <div class="feedback-body"></div>
        <div class="self-mark" role="group" aria-label="Mark your answer" hidden>
          <button type="button" class="mark-right" aria-pressed="false">✓ I was right</button>
          <button type="button" class="mark-wrong" aria-pressed="false">✗ I was wrong</button>
        </div>
      </section>
      <p class="keys"></p>
    </main>`

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const screen = $('.quiz')
  const progress = $('.progress')
  const score = $('.score')
  const listen = $('.listen')
  const playButton = $<HTMLButtonElement>('.play')
  const slowButton = $<HTMLButtonElement>('.play-slow')
  const hint = $('.play-hint')
  const form = $<HTMLFormElement>('.answer-form')
  const instruction = $('.instruction')
  const prompt = $('.prompt')
  const input = $<HTMLInputElement>('.answer')
  const checkButton = $<HTMLButtonElement>('.check')
  const barSlot = $('.bar-slot')
  const dontKnow = $<HTMLButtonElement>('.dont-know')
  const feedback = $('.feedback')
  const verdict = $('.verdict')
  const feedbackBody = $('.feedback-body')
  const selfMark = $('.self-mark')
  const markRight = $<HTMLButtonElement>('.mark-right')
  const markWrong = $<HTMLButtonElement>('.mark-wrong')
  const keys = $('.keys')

  // The answer box and its accent bar stay for the whole session, so the phone
  // keyboard stays up from one card to the next.
  const inputBar = attachAccentBar(input)
  barSlot.append(inputBar)
  /** The accent bar of the current card's own boxes (a cloze's blanks), if any. */
  let blanksBar: HTMLElement | undefined

  const audio = new Audio()
  audio.preload = 'auto'
  /** The clip URL the audio element has loaded. */
  let loaded = ''
  /** The button that started the clip, which shows it playing. */
  let playing = playButton
  const listeners = new AbortController()
  const { signal } = listeners

  let index = 0
  /** `marking`: the feedback is up, waiting for you to mark your own answer. */
  let phase: 'asking' | 'grading' | 'marking' | 'feedback' | 'done' = 'asking'
  /** Bumped per answer, so a late grade for an earlier card (or after leaving) is dropped. */
  let ticket = 0
  let module: ModeModule
  /** Where the answer is typed: the answer box, or the card's own boxes. */
  let boxes: HTMLInputElement[] = [input]
  let current: CardResult | undefined
  const results: CardResult[] = []

  const card = () => cards[index]
  const audioNow = () => module.audioWhen === 'ask' || phase === 'marking' || phase === 'feedback'

  function setHint(text: string, needsTap = false): void {
    hint.textContent = text
    playButton.classList.toggle('needs-tap', needsTap)
  }

  function play(slow = false): void {
    if (!audioNow()) return
    const { item } = card()
    const src = audioUrl(slow ? item.audioSlow : item.audio)
    if (loaded !== src) {
      audio.src = src
      loaded = src
    }
    audio.currentTime = 0
    playing = slow ? slowButton : playButton
    audio.play().then(
      () => setHint(''),
      (err: unknown) => {
        // NotAllowedError: no gesture yet, so ask for a tap. AbortError: a newer play() took over.
        if (err instanceof DOMException && err.name === 'NotAllowedError') setHint('Tap ▶ to listen', true)
      },
    )
  }

  function showScore(): void {
    const { right, wrong } = tally(results)
    score.textContent = scoreText({ right, wrong })
    score.setAttribute('aria-label', `${right} right, ${wrong} wrong`)
  }

  /** Focus the first empty box (or the first), where typing goes next. */
  function focusAnswer(): void {
    const box = boxes.find((b) => b.value === '') ?? boxes[0]
    box.focus()
  }

  function showCard(): void {
    phase = 'asking'
    const now = card()
    const mod = modes[now.mode]
    if (!mod) throw new Error(`No module for mode ${now.mode}`)
    module = mod
    screen.dataset.phase = phase
    screen.dataset.mode = now.mode
    progress.textContent = `Question ${index + 1} of ${cards.length}`

    instruction.textContent = module.instruction
    instruction.hidden = module.instruction === ''
    prompt.replaceChildren()
    const own = module.ask(now, prompt) ?? []
    prompt.hidden = prompt.childNodes.length === 0

    blanksBar?.remove()
    blanksBar = undefined
    if (own.length > 0) {
      boxes = own
      blanksBar = attachAccentBar(own)
      barSlot.append(blanksBar)
    } else {
      boxes = [input]
      input.lang = module.answer.lang
      input.placeholder = module.answer.placeholder
      input.setAttribute('aria-label', module.answer.label)
    }
    screen.toggleAttribute('data-blanks', own.length > 0)
    input.hidden = own.length > 0
    input.value = ''
    for (const box of boxes) box.readOnly = false
    inputBar.hidden = own.length > 0 || module.answer.lang !== 'fr'
    barSlot.hidden = false

    checkButton.textContent = 'Check'
    checkButton.disabled = false
    dontKnow.hidden = false
    feedback.hidden = true
    listen.hidden = !audioNow()
    setHint('')
    keys.textContent = keysText('asking', module.audioWhen === 'ask', boxes.length)
    window.scrollTo(0, 0) // the last card's feedback may have scrolled the page
    focusAnswer()

    if (module.audioWhen === 'ask') {
      play()
    } else {
      audio.pause()
    }
  }

  function submit(): void {
    if (phase !== 'asking') return
    const now = card()
    const typed = boxes.map((b) => b.value.trim())
    const blank = isBlankAnswer(typed)
    for (const box of boxes) box.readOnly = true // keeps the focus (and the phone keyboard), so Enter moves on

    const settle = (graded: Graded) => {
      const result: CardResult = { card: now, typed: blank ? [] : typed, outcome: 'wrong' } // until you mark it
      if (graded.outcome === 'self-mark') result.selfMarked = true
      else result.outcome = graded.outcome
      current = result
      toFeedback(graded)
    }

    let result: Graded | Promise<Graded>
    try {
      result = module.grade(now, blank ? null : typed)
    } catch (err) {
      backToAsking(err)
      return
    }
    if (!(result instanceof Promise)) {
      settle(result)
      return
    }
    phase = 'grading'
    screen.dataset.phase = phase
    checkButton.textContent = 'Checking…'
    checkButton.disabled = true
    const mine = ++ticket
    result.then(
      (graded) => {
        if (mine === ticket && phase === 'grading') settle(graded)
      },
      (err: unknown) => {
        if (mine === ticket && phase === 'grading') backToAsking(err)
      },
    )
  }

  /** Grading failed: say so and let the answer be checked again. */
  function backToAsking(err: unknown): void {
    phase = 'asking'
    screen.dataset.phase = phase
    for (const box of boxes) box.readOnly = false
    checkButton.textContent = 'Check'
    checkButton.disabled = false
    setHint(`Couldn't check that answer: ${err instanceof Error ? err.message : String(err)}`)
  }

  function toFeedback(graded: Graded): void {
    const marking = graded.outcome === 'self-mark'
    phase = marking ? 'marking' : 'feedback'
    screen.dataset.phase = 'feedback'
    checkButton.textContent = index === cards.length - 1 ? 'Finish' : 'Next'
    checkButton.disabled = marking
    dontKnow.hidden = true
    barSlot.hidden = true
    keys.textContent = keysText(phase, true)

    feedback.hidden = false
    feedback.dataset.outcome = graded.outcome === 'self-mark' ? 'unsure' : tone(graded.outcome)
    verdict.textContent = graded.outcome === 'self-mark' ? SELF_MARK.ask : VERDICTS[graded.outcome]
    selfMark.hidden = !marking
    markRight.setAttribute('aria-pressed', 'false')
    markWrong.setAttribute('aria-pressed', 'false')
    feedbackBody.replaceChildren()
    graded.show(feedbackBody)
    revealFeedback()

    if (listen.hidden) {
      listen.hidden = false
      play() // the clip was held back while asking
    }
    if (!boxes.includes(document.activeElement as HTMLInputElement)) focusAnswer()
  }

  /**
   * Scroll the feedback into view, keeping Check / Next on screen: a long panel
   * (an open rule card) is then read by scrolling down, not up to find Next.
   * Measured against the visual viewport, which the phone keyboard shrinks.
   */
  function revealFeedback(): void {
    const view = window.visualViewport
    const top = view ? view.offsetTop : 0
    const bottom = view ? view.offsetTop + view.height : window.innerHeight
    const margin = 8
    const overflow = feedback.getBoundingClientRect().bottom + margin - bottom
    const anchorTop = $('.answer-row').getBoundingClientRect().top - margin - top
    const by = revealScroll(overflow, anchorTop)
    if (by > 0) window.scrollBy(0, by)
  }

  /** Mark your own answer. It can be changed until you move on. */
  function mark(right: boolean): void {
    if (!current?.selfMarked || (phase !== 'marking' && phase !== 'feedback')) return
    current.outcome = right ? 'correct' : 'wrong'
    phase = 'feedback'
    verdict.textContent = right ? SELF_MARK.right : SELF_MARK.wrong
    feedback.dataset.outcome = tone(current.outcome)
    markRight.setAttribute('aria-pressed', String(right))
    markWrong.setAttribute('aria-pressed', String(!right))
    checkButton.disabled = false
    setHint('')
    keys.textContent = keysText('feedback', true)
  }

  function next(): void {
    if (phase !== 'feedback' || !current) return
    store.record(current.card.id, isRight(current.outcome))
    handlers.onResult?.(current)
    results.push(current)
    current = undefined
    showScore()
    index += 1
    if (index >= cards.length) {
      phase = 'done'
      audio.pause()
      handlers.onFinish([...results])
    } else {
      showCard()
    }
  }

  const markPlaying = (on: boolean) => {
    playButton.classList.toggle('playing', on && playing === playButton)
    slowButton.classList.toggle('playing', on && playing === slowButton)
  }
  audio.addEventListener('playing', () => markPlaying(true), { signal })
  for (const ev of ['pause', 'ended'] as const) {
    audio.addEventListener(ev, () => markPlaying(false), { signal })
  }
  audio.addEventListener('error', () => setHint("Couldn't load this sentence's audio."), { signal })

  // Tapping ▶, 🐢 or a self-mark button shouldn't take the focus off the answer
  // box (that would close the phone keyboard).
  for (const button of [playButton, slowButton, markRight, markWrong]) {
    for (const type of ['pointerdown', 'mousedown'] as const) {
      button.addEventListener(type, (e) => e.preventDefault(), { signal })
    }
  }
  playButton.addEventListener('click', () => play(false), { signal })
  slowButton.addEventListener('click', () => play(true), { signal })
  markRight.addEventListener('click', () => mark(true), { signal })
  markWrong.addEventListener('click', () => mark(false), { signal })
  $('.quit').addEventListener('click', () => handlers.onQuit(), { signal })

  document.addEventListener(
    'keydown',
    (e) => {
      const replay = replayKey(e)
      if (replay && audioNow() && phase !== 'done') {
        e.preventDefault()
        play(replay === 'slow')
        return
      }
      const marked = current?.selfMarked && (phase === 'marking' || phase === 'feedback') ? selfMarkKey(e) : undefined
      if (marked) {
        e.preventDefault()
        mark(marked === 'right')
      }
    },
    { signal },
  )

  // Enter in a blank that isn't the last moves on to the next blank; while you
  // still have to mark your own answer, it says so.
  form.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && phase === 'marking') {
        // Next is disabled until you mark your answer, so the form won't submit: say why.
        e.preventDefault()
        setHint('Mark your answer first: were you right?')
        return
      }
      if (e.key !== 'Enter' || phase !== 'asking' || boxes.length < 2) return
      const at = boxes.indexOf(e.target as HTMLInputElement)
      if (at < 0 || at === boxes.length - 1) return
      e.preventDefault()
      boxes[at + 1].focus()
    },
    { signal },
  )

  // Enter (or the Check / Next button) checks the answer, then moves on.
  form.addEventListener(
    'submit',
    (e) => {
      e.preventDefault()
      if (phase === 'asking') submit()
      else if (phase === 'feedback') next()
    },
    { signal },
  )

  dontKnow.addEventListener(
    'click',
    () => {
      if (phase !== 'asking') return
      for (const box of boxes) box.value = ''
      submit()
    },
    { signal },
  )

  showScore()
  if (cards.length === 0) {
    phase = 'done'
    handlers.onFinish([])
  } else {
    showCard()
  }

  return () => {
    phase = 'done'
    ticket++
    listeners.abort()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}
