import { describe, expect, it } from 'vitest'
import itemsJson from '../public/items.json?raw'
import { parseItems } from './items'
import { parseInline, parseMarkdown, type Block, type Line } from './markdown'

const { grammarPoints } = parseItems(JSON.parse(itemsJson))

const plain = (line: Line) => line.map((s) => s.text).join('')

describe('parseInline', () => {
  it('splits bold and italic runs', () => {
    expect(parseInline('elle **est** venue *hier*')).toEqual([
      { text: 'elle ' },
      { text: 'est', bold: true },
      { text: ' venue ' },
      { text: 'hier', italic: true },
    ])
  })

  it('handles bold inside a word', () => {
    expect(parseInline('allé**es**')).toEqual([{ text: 'allé' }, { text: 'es', bold: true }])
  })

  it('leaves unmatched or spaced-out stars, and underscores, as text', () => {
    expect(parseInline('2 * 3 and **open')).toEqual([{ text: '2 * 3 and **open' }])
    expect(parseInline('ils_avaient')).toEqual([{ text: 'ils_avaient' }])
  })

  it('gives no spans for empty text', () => {
    expect(parseInline('')).toEqual([])
  })
})

describe('parseMarkdown', () => {
  it('keeps single newlines as lines of one paragraph and splits paragraphs at blank lines', () => {
    const blocks = parseMarkdown('One.\nTwo.\n\nThree.')
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ text: 'One.' }], [{ text: 'Two.' }]] },
      { type: 'paragraph', lines: [[{ text: 'Three.' }]] },
    ])
  })

  it('reads bullet lists, even right after a paragraph line', () => {
    const blocks = parseMarkdown('Forms:\n- il est allé\n- elle est allé**e**\nAfter.')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'paragraph'])
    const list = blocks[1] as Extract<Block, { type: 'list' }>
    expect(list.ordered).toBe(false)
    expect(list.items.map(plain)).toEqual(['il est allé', 'elle est allée'])
  })

  it('reads numbered lists with their first number', () => {
    const [list] = parseMarkdown('2. two\n3. three')
    expect(list).toMatchObject({ type: 'list', ordered: true, start: 2 })
  })

  it('reads a table with a head row, and row heads when the corner cell is empty', () => {
    const [table] = parseMarkdown('| | masc | fem |\n|---|---|---|\n| the | **le** | la |\n| a | un | une |')
    expect(table.type).toBe('table')
    const t = table as Extract<Block, { type: 'table' }>
    expect(t.head?.map(plain)).toEqual(['', 'masc', 'fem'])
    expect(t.rowHeads).toBe(true)
    expect(t.rows.map((r) => r.map(plain))).toEqual([
      ['the', 'le', 'la'],
      ['a', 'un', 'une'],
    ])
    expect(t.rows[0][1]).toEqual([{ text: 'le', bold: true }])
  })

  it('has no row heads when the corner cell has text, and no head without a rule line', () => {
    const [withHead] = parseMarkdown('| 1 | 2 |\n|---|---|\n| me | le |')
    expect(withHead).toMatchObject({ type: 'table', rowHeads: false })
    const [noHead] = parseMarkdown('| a | b |\n| c | d |')
    expect(noHead).toMatchObject({ type: 'table', head: undefined, rows: [[[{ text: 'a' }], [{ text: 'b' }]], expect.anything()] })
  })

  it('handles Windows line endings', () => {
    expect(parseMarkdown('A\r\nB\r\n\r\n- c')).toHaveLength(2)
  })

  describe('every real rule card', () => {
    it.each(grammarPoints.map((p) => [p.id, p.rule]))('%s parses with no markup left in the text', (_, rule) => {
      const blocks = parseMarkdown(rule)
      expect(blocks.length).toBeGreaterThan(0)
      const lines: Line[] = blocks.flatMap((b) =>
        b.type === 'paragraph' ? b.lines : b.type === 'list' ? b.items : [...(b.head ?? []), ...b.rows.flat()],
      )
      for (const line of lines) {
        for (const span of line) expect(span.text).not.toMatch(/\*|^\s*\||\|\s*$/)
      }
      for (const block of blocks) {
        if (block.type !== 'table') continue
        const width = block.head?.length ?? block.rows[0].length
        for (const row of block.rows) expect(row).toHaveLength(width)
      }
    })

    it('includes the tables and the numbered list the rules are written with', () => {
      const all = grammarPoints.flatMap((p) => parseMarkdown(p.rule))
      expect(all.filter((b) => b.type === 'table').length).toBeGreaterThanOrEqual(8)
      expect(all.some((b) => b.type === 'list' && b.ordered)).toBe(true)
    })
  })
})
