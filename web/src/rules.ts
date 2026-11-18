// Grammar rule cards. A card is a collapsible panel titled with the grammar
// point, holding its rule (Markdown). The cloze feedback shows one; the rule
// browser (`renderRules`) lists them all, each with a Practise button.

import type { GrammarPoint } from './items'
import { renderMarkdown } from './markdown'

/** A collapsible rule card for a grammar point, open or closed to start with. */
export function ruleCard(point: GrammarPoint, open: boolean, doc: Document = document): HTMLDetailsElement {
  const card = doc.createElement('details')
  card.className = 'rule-card'
  card.open = open
  card.dataset.point = point.id

  const summary = doc.createElement('summary')
  const title = doc.createElement('span')
  title.className = 'rule-title'
  title.textContent = `Rule: ${point.title}`
  const level = doc.createElement('span')
  level.className = 'level'
  level.textContent = point.level
  summary.append(title, ' ', level)

  const body = doc.createElement('div')
  body.className = 'rule'
  body.append(renderMarkdown(point.rule, doc))
  card.append(summary, body)
  return card
}

export interface RulesHandlers {
  onBack(): void
  /** Start a cloze session on one grammar point. */
  onPractise(point: GrammarPoint): void
}

/**
 * The rule browser: every grammar point's rule card, grouped by level, each
 * with a button to drill it. `drills` is each point's number of cloze drills.
 */
export function renderRules(
  root: HTMLElement,
  points: readonly GrammarPoint[],
  drills: ReadonlyMap<string, number>,
  handlers: RulesHandlers,
): void {
  const doc = root.ownerDocument
  const main = doc.createElement('main')
  main.className = 'rules-screen'

  const head = doc.createElement('header')
  head.className = 'start-head'
  const back = doc.createElement('button')
  back.type = 'button'
  back.className = 'back'
  back.textContent = '← Back'
  back.addEventListener('click', () => handlers.onBack())
  const h1 = doc.createElement('h1')
  h1.textContent = 'Grammar rules'
  head.append(h1, back)

  const lede = doc.createElement('p')
  lede.className = 'lede'
  lede.textContent = 'Open a rule to read it. Practise starts a grammar cloze session on that point.'

  const toggle = doc.createElement('button')
  toggle.type = 'button'
  toggle.className = 'link-button rules-toggle'
  main.append(head, lede, toggle)

  const cards: HTMLDetailsElement[] = []
  for (const level of new Set(points.map((p) => p.level))) {
    const section = doc.createElement('section')
    section.className = 'rules-level'
    const h2 = doc.createElement('h2')
    h2.textContent = level
    section.append(h2)
    for (const point of points.filter((p) => p.level === level)) {
      const card = ruleCard(point, false, doc)
      const n = drills.get(point.id) ?? 0
      const practise = doc.createElement('button')
      practise.type = 'button'
      practise.className = 'practise'
      practise.textContent = `Practise (${n} drill${n === 1 ? '' : 's'})`
      practise.disabled = n === 0
      practise.addEventListener('click', () => handlers.onPractise(point))
      card.querySelector('.rule')!.append(practise)
      cards.push(card)
      section.append(card)
    }
    main.append(section)
  }

  // "Open all" until every card is open, then "Close all".
  const showToggle = () => (toggle.textContent = cards.every((c) => c.open) ? 'Close all' : 'Open all')
  toggle.addEventListener('click', () => {
    const open = !cards.every((c) => c.open)
    for (const c of cards) c.open = open
    showToggle()
  })
  for (const c of cards) c.addEventListener('toggle', showToggle)
  showToggle()

  root.replaceChildren(main)
}
