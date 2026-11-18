import './style.css'
import { cardsFor, MODE_TITLES, MODES } from './cards'
import { loadItems } from './items'

// Placeholder screen until the start screen exists (plan step 19): it loads the
// item bank and shows what is in it.
const app = document.querySelector<HTMLDivElement>('#app')!

async function init(): Promise<void> {
  app.innerHTML = '<main><p>Loading sentences…</p></main>'
  try {
    const bank = await loadItems()
    app.innerHTML = `
      <main>
        <h1>French Practice</h1>
        <p class="lede"></p>
        <ul class="mode-counts"></ul>
        <button class="primary" type="button" disabled>Start</button>
      </main>`
    app.querySelector('.lede')!.textContent =
      `${bank.items.length} sentences, ${bank.grammarPoints.length} grammar points and ${bank.topics.length} topics. ` +
      'The quiz screens are under construction.'
    app.querySelector('.mode-counts')!.append(
      ...MODES.map((mode) => {
        const li = document.createElement('li')
        li.textContent = `${MODE_TITLES[mode]}: ${cardsFor(bank.items, mode).length} cards`
        return li
      }),
    )
  } catch (err) {
    app.innerHTML = '<main><h1>French Practice</h1><p class="error"></p></main>'
    app.querySelector('.error')!.textContent = err instanceof Error ? err.message : String(err)
  }
}

void init()
