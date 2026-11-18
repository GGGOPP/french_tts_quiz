// Grammar rule cards. A card is a collapsible panel titled with the grammar
// point, holding its rule (Markdown). The cloze feedback shows one; the rule
// browser (plan step 19) lists them all.

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
