// The accent bar under every French input: a row of buttons that type é è ê …
// at the cursor without taking the focus away from the input (so a phone
// keyboard stays open and doesn't flicker), plus Alt-shortcuts on desktop.
//
// Shortcuts cycle while Alt is held: Alt+E types é, pressing E again (Alt still
// down) turns it into è, then ê, ë and back to é. Release Alt to type the next
// letter fresh (so "créé" is Alt+E, release, Alt+E). Shift gives capitals, both
// for shortcuts and for a Shift-click on a button.

/** The bar's letters, in order. */
export const ACCENTS = ['é', 'è', 'ê', 'ë', 'à', 'â', 'ç', 'î', 'ï', 'ô', 'ù', 'û', 'œ'] as const

/** Alt-shortcuts by physical key (`KeyboardEvent.code`), each cycling through its letters. */
export const SHORTCUTS: Readonly<Record<string, readonly string[]>> = {
  KeyE: ['é', 'è', 'ê', 'ë'],
  KeyA: ['à', 'â'],
  KeyC: ['ç'],
  KeyI: ['î', 'ï'],
  KeyO: ['ô', 'œ'],
  KeyU: ['ù', 'û'],
}

/** Text to put in place of the input's characters from `start` to `end`. */
export interface Replacement {
  start: number
  end: number
  text: string
}

/** Where a shortcut cycle is: which key, which of its letters, and the cursor just after it. */
export interface Cycle {
  code: string
  index: number
  at: number
}

/** A letter in the case asked for (é → É, œ → Œ). */
export function withCase(letter: string, upper: boolean): string {
  return upper ? letter.toLocaleUpperCase('fr') : letter
}

/** Typing a letter over the selection (or at the cursor). */
export function insertion(letter: string, upper: boolean, start: number, end: number): Replacement {
  return { start, end, text: withCase(letter, upper) }
}

/**
 * What an Alt+key press does: the key's first letter at the cursor, or, when
 * the same key was just pressed and the cursor hasn't moved, the next letter
 * in place of the previous one. Null for keys without a shortcut.
 */
export function shortcut(
  code: string,
  upper: boolean,
  cycle: Cycle | null,
  start: number,
  end: number,
): { replace: Replacement; cycle: Cycle } | null {
  const letters = SHORTCUTS[code]
  if (!letters) return null
  if (cycle && cycle.code === code && start === end && start === cycle.at && start > 0) {
    const index = (cycle.index + 1) % letters.length
    return {
      replace: { start: start - 1, end: start, text: withCase(letters[index], upper) },
      cycle: { code, index, at: start },
    }
  }
  return { replace: insertion(letters[0], upper, start, end), cycle: { code, index: 0, at: start + 1 } }
}

/** The shortcut that types a letter, for button tooltips ("Alt+E ×2" for è). */
export function shortcutHint(letter: string): string | undefined {
  for (const [code, letters] of Object.entries(SHORTCUTS)) {
    const index = letters.indexOf(letter)
    if (index >= 0) return `Alt+${code.slice(3)}${index > 0 ? ` ×${index + 1}` : ''}`
  }
  return undefined
}

type TextInput = HTMLInputElement | HTMLTextAreaElement

/** Apply a replacement and tell listeners, as if the user had typed it. */
function apply(input: TextInput, { start, end, text }: Replacement): void {
  input.setRangeText(text, start, end, 'end')
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Whether the bar may type into an input (not while it is read-only, e.g. during feedback). */
const editable = (input: TextInput) => !input.readOnly && !input.disabled

/**
 * Set up inputs for typing French and make one accent bar for them, which the
 * caller places near them. The bar types into whichever of the inputs had the
 * focus last (the first, until one is focused). The inputs get lang="fr" and
 * lose autocorrect, autocomplete, auto-capitals and spellcheck (a phone
 * keyboard must not fix the answer).
 */
export function attachAccentBar(inputs: TextInput | readonly TextInput[]): HTMLElement {
  const fields: readonly TextInput[] = Array.isArray(inputs) ? inputs : [inputs as TextInput]
  if (fields.length === 0) throw new Error('attachAccentBar needs at least one input')
  let target = fields[0]

  const bar = document.createElement('div')
  bar.className = 'accent-bar'
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', 'Accented letters')
  for (const letter of ACCENTS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.tabIndex = -1 // Tab goes from the input to the next control, not through 13 letters.
    button.textContent = letter
    button.dataset.letter = letter
    const hint = shortcutHint(letter)
    button.title = hint ? `${letter} (${hint}, Shift for capital)` : letter
    bar.append(button)
  }

  // Pressing a button must not move the focus off the input: that would close
  // the phone keyboard and reopen it. Cancelling the press keeps the focus put;
  // the click still comes and does the typing.
  const keepFocus = (event: Event) => {
    if ((event.target as Element).closest('button')) event.preventDefault()
  }
  bar.addEventListener('pointerdown', keepFocus)
  bar.addEventListener('mousedown', keepFocus)

  let cycle: Cycle | null = null
  let usedAlt = false
  const showCapitals = (on: boolean) => bar.classList.toggle('upper', on)

  bar.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button')
    if (!button?.dataset.letter || !editable(target)) return
    if (document.activeElement !== target) target.focus() // e.g. a tap before ever focusing the input
    const end = target.value.length
    apply(target, insertion(button.dataset.letter, event.shiftKey, target.selectionStart ?? end, target.selectionEnd ?? end))
    cycle = null
  })

  const reset = () => {
    cycle = null
    usedAlt = false
    showCapitals(false)
  }

  for (const input of fields) {
    input.lang = 'fr'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.setAttribute('autocapitalize', 'off')
    input.setAttribute('autocorrect', 'off')

    // Typed as HTMLElement so its listeners get typed events (the input union loses them).
    const field: HTMLElement = input
    field.addEventListener('focus', () => {
      target = input
    })

    field.addEventListener('keydown', (event) => {
      showCapitals(event.shiftKey)
      // AltGr arrives as Ctrl+Alt on Windows: leave it to the keyboard layout.
      const altOnly = event.altKey && !event.ctrlKey && !event.metaKey && !event.getModifierState('AltGraph')
      if (!altOnly) {
        if (event.key !== 'Alt') cycle = null
        return
      }
      if (!editable(input)) return
      const end = input.value.length
      const result = shortcut(event.code, event.shiftKey, cycle, input.selectionStart ?? end, input.selectionEnd ?? end)
      if (!result) return
      event.preventDefault()
      apply(input, result.replace)
      cycle = result.cycle
      usedAlt = true
    })

    field.addEventListener('keyup', (event) => {
      showCapitals(event.shiftKey)
      if (event.key !== 'Alt') return
      cycle = null
      // Releasing Alt after a shortcut must not also open the browser's menu bar.
      if (usedAlt) event.preventDefault()
      usedAlt = false
    })

    field.addEventListener('blur', reset)
    field.addEventListener('pointerdown', reset) // moving the cursor by click ends a cycle
  }

  return bar
}
