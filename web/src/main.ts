import './style.css'

// Placeholder screen until the quiz screens exist (plan steps 15–20).
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main>
    <h1>French Practice</h1>
    <p class="lede">Grammar, dictée and English → French at A1–A2. Under construction.</p>
    <button class="primary" type="button" disabled>Start</button>
  </main>
`
