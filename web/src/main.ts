import './style.css'
import { cardsFor, MODE_TITLES, MODES, type Card } from './cards'
import { loadItems, type ItemBank } from './items'
import { createClozeMode } from './modes/cloze'
import { createDicteeMode } from './modes/dictee'
import { createMeaningMode } from './modes/meaning'
import { createProduceMode } from './modes/produce'
import { renderQuiz, type Modes } from './quiz'
import { scoreText, tally } from './session'
import { store } from './storage'

// Placeholder screen until the start screen exists (plan step 19): it shows
// what is in the item bank and starts 10 random cards of each mode that has
// been built so far.
const app = document.querySelector<HTMLDivElement>('#app')!
const SESSION_LENGTH = 10

function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function showHome(bank: ItemBank, modes: Modes, message = ''): void {
  app.innerHTML = `
    <main>
      <h1>French Practice</h1>
      <p class="lede"></p>
      <p class="last-score" hidden></p>
      <ul class="mode-counts"></ul>
    </main>`
  app.querySelector('.lede')!.textContent =
    `${bank.items.length} sentences, ${bank.grammarPoints.length} grammar points and ${bank.topics.length} topics. ` +
    `The start screen is under construction: the modes built so far run ${SESSION_LENGTH} random cards.`
  const last = app.querySelector<HTMLElement>('.last-score')!
  last.textContent = message
  last.hidden = message === ''

  app.querySelector('.mode-counts')!.append(
    ...MODES.map((mode) => {
      const li = document.createElement('li')
      const cards = cardsFor(bank.items, mode)
      const label = `${MODE_TITLES[mode]}: ${cards.length} cards`
      if (!modes[mode]) {
        li.textContent = label
        return li
      }
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'primary'
      button.textContent = `Try ${MODE_TITLES[mode]}`
      button.addEventListener('click', () => startQuiz(bank, modes, shuffled(cards).slice(0, SESSION_LENGTH)))
      li.append(label, ' ', button)
      return li
    }),
  )
}

function startQuiz(bank: ItemBank, modes: Modes, cards: Card[]): void {
  const stop = renderQuiz(app, cards, modes, store, {
    onFinish(results) {
      stop()
      showHome(bank, modes, `Last session: ${scoreText(tally(results))}`)
    },
    onQuit() {
      stop()
      showHome(bank, modes)
    },
  })
}

async function init(): Promise<void> {
  app.innerHTML = '<main><p>Loading sentences…</p></main>'
  try {
    const bank = await loadItems()
    const modes: Modes = {
      cloze: createClozeMode(bank.grammarPoints),
      dictee: createDicteeMode(),
      meaning: createMeaningMode(),
      produce: createProduceMode(),
    }
    showHome(bank, modes)
  } catch (err) {
    app.innerHTML = '<main><h1>French Practice</h1><p class="error"></p></main>'
    app.querySelector('.error')!.textContent = err instanceof Error ? err.message : String(err)
  }
}

void init()
