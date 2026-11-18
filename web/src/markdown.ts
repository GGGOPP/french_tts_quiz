// A small Markdown renderer for the grammar rule cards. It covers what the
// rules use and nothing more: paragraphs (a single newline is a line break),
// bullet and numbered lists, pipe tables, **bold** and *italic*. Underscores
// are not emphasis: the rules use them for liaisons (ils_avaient).
//
// The text is parsed into blocks first (pure, so it can be tested without a
// DOM), then built with DOM calls, never innerHTML, so nothing in a rule can
// turn into markup.

/** A run of text in one style. */
export interface Span {
  text: string
  bold?: true
  italic?: true
}

/** One line of styled text. */
export type Line = Span[]

export type Block =
  | { type: 'paragraph'; lines: Line[] }
  | { type: 'list'; ordered: boolean; start: number; items: Line[] }
  | {
      type: 'table'
      head?: Line[]
      rows: Line[][]
      /** The first column labels the rows (the head's first cell is empty). */
      rowHeads: boolean
    }

/** `**bold**` or `*italic*` (an opening `*` must touch the text it styles). */
const EMPHASIS = /\*\*([^*]+)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*/g

/** Split text into spans by its `**bold**` and `*italic*` markers. Unmatched markers stay as text. */
export function parseInline(text: string): Line {
  const spans: Line = []
  let at = 0
  for (const m of text.matchAll(EMPHASIS)) {
    if (m.index > at) spans.push({ text: text.slice(at, m.index) })
    spans.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], italic: true })
    at = m.index + m[0].length
  }
  if (at < text.length) spans.push({ text: text.slice(at) })
  return spans
}

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
const TABLE_ROW = /^\s*\|/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** The cells of a `| a | b |` row, trimmed. */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Parse rule-card Markdown into blocks. */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }

    if (TABLE_ROW.test(line)) {
      const rows: string[] = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(lines[i++])
      const hasHead = rows.length > 1 && TABLE_RULE.test(rows[1])
      const head = hasHead ? cells(rows[0]) : undefined
      const body = (hasHead ? rows.slice(2) : rows).map((row) => cells(row).map(parseInline))
      blocks.push({ type: 'table', head: head?.map(parseInline), rows: body, rowHeads: head?.[0] === '' })
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      const ordered = numbered !== null
      const marker = ordered ? NUMBERED : BULLET
      const items: Line[] = []
      let m: RegExpExecArray | null
      while (i < lines.length && (m = marker.exec(lines[i]))) {
        items.push(parseInline(ordered ? m[2] : m[1]))
        i++
      }
      blocks.push({ type: 'list', ordered, start: numbered ? Number(numbered[1]) : 1, items })
      continue
    }

    // A paragraph runs until a blank line, a list or a table.
    const para: Line[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !TABLE_ROW.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i])
    ) {
      para.push(parseInline(lines[i].trim()))
      i++
    }
    blocks.push({ type: 'paragraph', lines: para })
  }
  return blocks
}

/** Append a line's spans to an element. */
export function appendLine(el: HTMLElement, line: Line): void {
  const doc = el.ownerDocument
  for (const span of line) {
    let node: Node = doc.createTextNode(span.text)
    if (span.italic) {
      const em = doc.createElement('em')
      em.append(node)
      node = em
    }
    if (span.bold) {
      const strong = doc.createElement('strong')
      strong.append(node)
      node = strong
    }
    el.append(node)
  }
}

function lineElement<K extends 'p' | 'li' | 'th' | 'td'>(doc: Document, tag: K, line: Line): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag)
  appendLine(el, line)
  return el
}

/** Build the DOM for rule-card Markdown. */
export function renderMarkdown(md: string, doc: Document = document): DocumentFragment {
  const out = doc.createDocumentFragment()
  for (const block of parseMarkdown(md)) {
    if (block.type === 'paragraph') {
      const p = doc.createElement('p')
      block.lines.forEach((line, n) => {
        if (n > 0) p.append(doc.createElement('br'))
        appendLine(p, line)
      })
      out.append(p)
    } else if (block.type === 'list') {
      const list = doc.createElement(block.ordered ? 'ol' : 'ul')
      if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start))
      list.append(...block.items.map((item) => lineElement(doc, 'li', item)))
      out.append(list)
    } else {
      // A wrapper scrolls sideways if a table is wider than a phone.
      const wrap = doc.createElement('div')
      wrap.className = 'table-wrap'
      const table = doc.createElement('table')
      if (block.head) {
        const row = doc.createElement('tr')
        for (const cell of block.head) {
          const th = lineElement(doc, 'th', cell)
          th.scope = 'col'
          row.append(th)
        }
        table.createTHead().append(row)
      }
      const body = table.createTBody()
      for (const cellsOfRow of block.rows) {
        const row = doc.createElement('tr')
        cellsOfRow.forEach((cell, n) => {
          const el = lineElement(doc, block.rowHeads && n === 0 ? 'th' : 'td', cell)
          if (el.tagName === 'TH') el.scope = 'row'
          row.append(el)
        })
        body.append(row)
      }
      wrap.append(table)
      out.append(wrap)
    }
  }
  return out
}
