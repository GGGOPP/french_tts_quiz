import './style.css'
import type { Card } from './cards'
import { LEVELS, loadItems, type ItemBank } from './items'
import { parseListParam, type LinkedList } from './lists'
import { createClozeMode } from './modes/cloze'
import { createDicteeMode } from './modes/dictee'
import { createMeaningMode } from './modes/meaning'
import { createProduceMode } from './modes/produce'
import { renderQuiz, type Modes } from './quiz'
import { renderRules } from './rules'
import { DEFAULT_COUNT, pointCounts, pointDrills, shuffle } from './selection'
import type { CardResult } from './session'
import { renderStart } from './start'
import { store } from './storage'
import { renderSummary } from './summary'

const app = document.querySelector<HTMLDivElement>('#app')!
const RULES_HASH = '#rules'

/** Tears down the current screen (stops audio, removes listeners) before the next one is shown. */
let leaveScreen: () => void = () => {}

function show(render: () => (() => void) | void): void {
  leaveScreen()
  leaveScreen = render() ?? (() => {})
  window.scrollTo(0, 0)
}

interface App {
  bank: ItemBank
  modes: Modes
}

function showStart(ctx: App, options: { linked?: LinkedList } = {}): void {
  show(() =>
    renderStart(
      app,
      ctx.bank,
      store,
      {
        onStart: (cards) => showQuiz(ctx, cards, 'start'),
        onRules: () => {
          // Its own history entry, so the phone's Back button returns to the start screen.
          history.pushState({ rules: true }, '', RULES_HASH)
          showRules(ctx)
        },
      },
      options,
    ),
  )
}

function showRules(ctx: App): void {
  const drills = pointCounts(ctx.bank.items, 'cloze', LEVELS)
  show(() =>
    renderRules(app, ctx.bank.grammarPoints, drills, {
      onBack: () => {
        if (history.state?.rules) history.back() // popstate shows the start screen
        else {
          history.replaceState(null, '', location.pathname + location.search)
          showStart(ctx)
        }
      },
      onPractise: (point) => {
        const count = store.startChoice()?.count ?? DEFAULT_COUNT
        showQuiz(ctx, pointDrills(ctx.bank.items, point.id, count), 'rules')
      },
    }),
  )
}

/** Where a session was started from, and so where it returns to. */
type From = 'start' | 'rules'

function backTo(ctx: App, from: From): void {
  if (from === 'rules') showRules(ctx)
  else showStart(ctx)
}

/** Run a session, show its summary, then go back to the screen it was started from. */
function showQuiz(ctx: App, cards: Card[], from: From): void {
  show(() =>
    renderQuiz(app, cards, ctx.modes, store, {
      onFinish: (results) => showSummary(ctx, results, from),
      onQuit: () => backTo(ctx, from),
    }),
  )
}

function showSummary(ctx: App, results: CardResult[], from: From): void {
  show(() =>
    renderSummary(
      app,
      results,
      {
        onRetry: (cards) => showQuiz(ctx, shuffle(cards), from),
        onDone: () => backTo(ctx, from),
      },
      { doneLabel: from === 'rules' ? 'Back to rules' : 'New session' },
    ),
  )
}

/**
 * Read a `?list=` link, then drop it from the address bar: it has been loaded
 * into the picker, and a reload should show what was picked since, not the link again.
 */
function takeLinkedList(bank: ItemBank): LinkedList | undefined {
  const linked = parseListParam(location.search, new Set(bank.items.map((i) => i.id)))
  if (linked) {
    const params = new URLSearchParams(location.search)
    params.delete('list')
    const query = params.toString()
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
  }
  return linked
}

async function init(): Promise<void> {
  app.innerHTML = '<main><p>Loading sentences…</p></main>'
  try {
    const bank = await loadItems()
    const ctx: App = {
      bank,
      modes: {
        cloze: createClozeMode(bank.grammarPoints),
        dictee: createDicteeMode(),
        meaning: createMeaningMode(),
        produce: createProduceMode(),
      },
    }
    window.addEventListener('popstate', () => (location.hash === RULES_HASH ? showRules(ctx) : showStart(ctx)))
    const linked = takeLinkedList(bank)
    if (location.hash === RULES_HASH && !linked) showRules(ctx)
    else showStart(ctx, { linked })
  } catch (err) {
    app.innerHTML = '<main><h1>French Practice</h1><p class="error"></p></main>'
    app.querySelector('.error')!.textContent = err instanceof Error ? err.message : String(err)
  }
}

void init()
