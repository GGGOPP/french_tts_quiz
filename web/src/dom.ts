// Small helpers for building the feedback of the exercise modes.

/** An element with an optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Text for screen readers only, e.g. "you typed". */
export function srOnly(text: string): HTMLElement {
  return el('span', 'sr-only', text)
}

/** A paragraph like "Answer: …", with a muted label and the text in its own language. */
export function labelled(label: string, text: string, lang: 'fr' | 'en', className = ''): HTMLParagraphElement {
  const p = el('p', className)
  const value = el('span', undefined, text)
  value.lang = lang
  p.append(el('span', 'label', `${label} `), value)
  return p
}
