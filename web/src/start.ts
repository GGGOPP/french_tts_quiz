// Start screen: choose the exercise mode, then the sentences (by topic, by
// grammar point or a hand-picked custom list, narrowed by level) and how many
// questions, then start a session. A link at the top opens the rule browser.

import { MODE_TITLES, MODES, type Card, type Mode } from './cards'
import { LEVELS, type Item, type ItemBank, type Level } from './items'
import { cleanListName, listLink, matchesSearch, MAX_LIST_NAME, sameIds, searchKey, type LinkedList } from './lists'
import {
  DEFAULT_COUNT,
  parseQuestionCount,
  pickCards,
  pointCounts,
  PRESET_COUNTS,
  selectedItems,
  topicCounts,
  type QuestionCount,
  type Source,
} from './selection'
import type { StartChoice, Store } from './storage'

export const MODE_BLURBS: Record<Mode, string> = {
  cloze: 'Fill the gaps in a sentence',
  dictee: 'Hear French, type French',
  meaning: 'Hear French, type English',
  produce: 'Read English, type French',
}

const SOURCE_LABELS: Record<Source, string> = { topic: 'By topic', grammar: 'By grammar', list: 'Custom list' }

export type StartStore = Pick<Store, 'startChoice' | 'saveStartChoice' | 'savedLists' | 'saveList' | 'deleteList'>

export interface StartHandlers {
  onStart(cards: Card[]): void
  /** Open the rule browser. */
  onRules(): void
}

export interface StartOptions {
  /** A `?list=` link's items, given only to the first start screen of a visit. */
  linked?: LinkedList
  /** A line to show at the top, e.g. the last session's score. */
  message?: string
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Saved ids still in the bank; none left means all of them. */
function keepKnown<T extends string>(saved: readonly string[] | undefined, all: readonly T[]): T[] {
  const kept = (saved ?? []).filter((id): id is T => all.includes(id as T))
  return kept.length > 0 ? kept : [...all]
}

/**
 * The saved choice, with anything no longer in the bank dropped. A link's
 * list, if it has any known items, replaces the saved custom list. Cloze has
 * no topic sentences, so a cloze choice is always by grammar or list.
 */
export function initialChoice(bank: ItemBank, saved: StartChoice | undefined, linked?: LinkedList): StartChoice {
  const known = new Set(bank.items.map((i) => i.id))
  const choice: StartChoice = {
    mode: saved?.mode ?? 'cloze',
    source: saved?.source ?? 'grammar',
    levels: keepKnown(saved?.levels, LEVELS),
    topics: keepKnown(
      saved?.topics,
      bank.topics.map((t) => t.id),
    ),
    points: keepKnown(
      saved?.points,
      bank.grammarPoints.map((g) => g.id),
    ),
    items: saved?.items.filter((id) => known.has(id)) ?? [],
    count: saved?.count ?? DEFAULT_COUNT,
  }
  if (linked && linked.ids.length > 0) Object.assign(choice, { source: 'list', items: linked.ids })
  if (choice.mode === 'cloze' && choice.source === 'topic') choice.source = 'grammar'
  return choice
}

function linkNotice(linked: LinkedList | undefined): string {
  if (!linked) return ''
  if (linked.ids.length === 0) return 'None of the sentences in that link were found.'
  const skipped =
    linked.skipped > 0
      ? ` ${plural(linked.skipped, 'sentence')} in the link ${linked.skipped === 1 ? "wasn't" : "weren't"} found.`
      : ''
  return `Opened a shared list of ${plural(linked.ids.length, 'sentence')}.${skipped} Save it to keep it on this device.`
}

/** What the session will hold, or why Start is off. */
export function summaryText(available: number, count: QuestionCount | undefined, source: Source, mode: Mode, skipped = 0): string {
  if (available === 0) {
    if (source === 'list') {
      return skipped > 0 ? `None of the ticked sentences has gaps to fill. Tick grammar drills, or pick another exercise.` : 'Tick at least one sentence.'
    }
    return source === 'topic' ? 'Choose at least one topic.' : 'Choose at least one grammar point.'
  }
  if (count === undefined) return 'Type how many questions.'
  const questions = count === 'all' ? available : Math.min(count, available)
  const noGaps = skipped > 0 ? ` (${skipped} ticked ${skipped === 1 ? 'has' : 'have'} no gaps)` : ''
  return `${plural(questions, 'question')} from ${plural(available, 'sentence')}${noGaps}. ${MODE_TITLES[mode]}.`
}

export function renderStart(root: HTMLElement, bank: ItemBank, store: StartStore, handlers: StartHandlers, options: StartOptions = {}): void {
  const { linked, message } = options
  const known = new Set(bank.items.map((i) => i.id))
  const initial = initialChoice(bank, store.startChoice(), linked)
  const initialItems = new Set(initial.items)
  const notice = linked ? linkNotice(linked) : (message ?? '')

  const radio = (name: string, value: string, label: string, checked: boolean, extra = '') => `
      <label class="pill"${extra}>
        <input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''} />
        <span>${label}</span>
      </label>`

  const modeOptions = MODES.map(
    (mode) => `
      <label class="mode-option">
        <input type="radio" name="mode" value="${mode}"${mode === initial.mode ? ' checked' : ''} />
        <span class="mode-title">${escapeHtml(MODE_TITLES[mode])}</span>
        <span class="mode-blurb">${escapeHtml(MODE_BLURBS[mode])}</span>
      </label>`,
  ).join('')

  const levelBoxes = LEVELS.map(
    (level) => `
      <label class="pill">
        <input type="checkbox" name="level" value="${level}"${initial.levels.includes(level) ? ' checked' : ''} />
        <span>${level}</span>
      </label>`,
  ).join('')

  const option = (name: string, value: string, title: string) => `
      <label class="option">
        <input type="checkbox" name="${name}" value="${escapeHtml(value)}" />
        <span class="option-text">
          <span class="option-name">${escapeHtml(title)}</span>
          <span class="option-detail" data-count="${escapeHtml(value)}"></span>
        </span>
      </label>`

  const topicBoxes = bank.topics.map((t) => option('topic', t.id, t.title)).join('')
  const pointGroups = LEVELS.map((level) => {
    const points = bank.grammarPoints.filter((g) => g.level === level)
    if (points.length === 0) return ''
    return `
      <section class="option-group" data-level="${level}">
        <h3><span>${level}</span><button type="button" class="link-button" data-tick-level="${level}">Tick all ${level}</button></h3>
        <div class="options">${points.map((g) => option('point', g.id, g.title)).join('')}</div>
      </section>`
  }).join('')

  // Every item, grouped under its topic or grammar point; a checkbox's value is the item's index in bank.items.
  const groupsOf: { title: string; items: { item: Item; index: number }[] }[] = [
    ...bank.topics.map((t) => ({ title: t.title, key: (i: Item) => i.topic === t.id })),
    ...bank.grammarPoints.map((g) => ({ title: `Grammar: ${g.title}`, key: (i: Item) => i.point === g.id })),
  ].map(({ title, key }) => ({
    title,
    items: bank.items.map((item, index) => ({ item, index })).filter(({ item }) => key(item)),
  }))
  const itemGroups = groupsOf
    .filter((g) => g.items.length > 0)
    .map(
      (g) => `
      <details class="item-group">
        <summary><span class="group-title">${escapeHtml(g.title)}</span> <span class="group-ticked"></span></summary>
        ${g.items
          .map(
            ({ item, index }) => `
          <label class="item-row">
            <input type="checkbox" name="item" value="${index}"${initialItems.has(item.id) ? ' checked' : ''} />
            <span class="item-text">
              <span class="item-fr" lang="fr">${escapeHtml(item.fr)}</span>
              <span class="item-en">${escapeHtml(item.en[0])}</span>
            </span>
          </label>`,
          )
          .join('')}
      </details>`,
    )
    .join('')

  const isPreset = PRESET_COUNTS.includes(initial.count)
  const presetRadios = PRESET_COUNTS.map((n) => radio('count', String(n), n === 'all' ? 'All' : String(n), n === initial.count)).join('')
  // Any other number: a fourth pill holding a small number box.
  const otherRadio = `
      <label class="pill count-other">
        <input type="radio" name="count" value="other"${isPreset ? '' : ' checked'} />
        <input type="text" class="count-input" inputmode="numeric" pattern="[0-9]*" maxlength="4"
          autocomplete="off" placeholder="Other" aria-label="Other number of questions"
          value="${isPreset ? '' : initial.count}" />
      </label>`

  root.innerHTML = `
    <main class="start">
      <header class="start-head">
        <h1>French Practice</h1>
        <button type="button" class="rules-button">Grammar rules</button>
      </header>
      <p class="notice" role="status"${notice ? '' : ' hidden'}>${escapeHtml(notice)}</p>
      <form class="start-form">
        <fieldset>
          <legend>Exercise</legend>
          <div class="mode-options">${modeOptions}</div>
        </fieldset>
        <fieldset>
          <legend>Sentences</legend>
          <div class="pills segmented" role="radiogroup" aria-label="Choose sentences">
            ${(['topic', 'grammar', 'list'] as const).map((s) => radio('source', s, SOURCE_LABELS[s], s === initial.source)).join('')}
          </div>
          <p class="source-note" hidden>Grammar cloze has gaps only in the grammar drills.</p>
          <div class="levels" role="group" aria-label="Levels">
            <span class="levels-label" aria-hidden="true">Levels</span>
            <div class="pills">${levelBoxes}</div>
          </div>
          <div class="by-topic">
            <div class="select-actions">
              <button type="button" data-select="topic:all">Select all</button>
              <button type="button" data-select="topic:none">Select none</button>
            </div>
            <div class="options">${topicBoxes}</div>
          </div>
          <div class="by-grammar">
            <p class="hint grammar-hint"></p>
            <div class="select-actions">
              <button type="button" data-select="point:all">Select all</button>
              <button type="button" data-select="point:none">Select none</button>
            </div>
            ${pointGroups}
          </div>
          <div class="by-list">
            <div class="list-row saved-lists">
              <select class="list-select" aria-label="Saved lists"></select>
              <button type="button" class="list-delete">Delete</button>
            </div>
            <div class="list-row">
              <input type="text" class="list-name text-input" maxlength="${MAX_LIST_NAME}" autocomplete="off"
                enterkeyhint="done" placeholder="Name this list" aria-label="List name" />
              <button type="button" class="list-save">Save</button>
              <button type="button" class="list-share">Get link</button>
            </div>
            <p class="list-status" aria-live="polite"></p>
            <input type="text" class="list-link text-input" readonly aria-label="Link to this list" hidden />
            <input type="search" class="item-search text-input" autocomplete="off" enterkeyhint="search"
              placeholder="Search French or English" aria-label="Search sentences" lang="fr" />
            <div class="select-actions">
              <button type="button" class="tick-shown">Tick all</button>
              <button type="button" class="untick-all">Untick all</button>
              <label class="ticked-only"><input type="checkbox" /> Ticked only</label>
            </div>
            <div class="item-groups">${itemGroups}</div>
            <p class="no-matches" hidden>No sentences match.</p>
          </div>
        </fieldset>
        <fieldset>
          <legend>Questions</legend>
          <div class="pills">${presetRadios}${otherRadio}</div>
        </fieldset>
        <div class="start-footer">
          <p class="summary" aria-live="polite"></p>
          <button type="submit" class="start-button primary">Start</button>
        </div>
      </form>
    </main>`

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const all = <T extends HTMLElement>(selector: string) => [...root.querySelectorAll<T>(selector)]
  const form = $<HTMLFormElement>('.start-form')
  const topicBoxesEl = all<HTMLInputElement>('input[name="topic"]')
  const pointBoxesEl = all<HTMLInputElement>('input[name="point"]')
  const levelBoxesEl = all<HTMLInputElement>('input[name="level"]')
  const itemBoxes = all<HTMLInputElement>('input[name="item"]')
  const itemRows = itemBoxes.map((box) => box.closest<HTMLElement>('.item-row')!)
  const itemGroupsEl = all<HTMLDetailsElement>('.item-group')
  const searchKeys = bank.items.map(searchKey)
  const topicRadio = $<HTMLInputElement>('input[name="source"][value="topic"]')
  const topicPill = topicRadio.closest<HTMLLabelElement>('.pill')!
  const summary = $<HTMLParagraphElement>('.summary')
  const startButton = $<HTMLButtonElement>('.start-button')
  const otherButton = $<HTMLInputElement>('input[name="count"][value="other"]')
  const otherInput = $<HTMLInputElement>('.count-input')
  const savedListsRow = $('.saved-lists')
  const listSelect = $<HTMLSelectElement>('.list-select')
  const deleteButton = $<HTMLButtonElement>('.list-delete')
  const nameInput = $<HTMLInputElement>('.list-name')
  const saveButton = $<HTMLButtonElement>('.list-save')
  const shareButton = $<HTMLButtonElement>('.list-share')
  const listStatus = $<HTMLParagraphElement>('.list-status')
  const linkInput = $<HTMLInputElement>('.list-link')
  const search = $<HTMLInputElement>('.item-search')
  const tickShown = $<HTMLButtonElement>('.tick-shown')
  const tickedOnly = $<HTMLInputElement>('.ticked-only input')
  const noMatches = $<HTMLParagraphElement>('.no-matches')

  for (const b of topicBoxesEl) b.checked = initial.topics.includes(b.value)
  for (const b of pointBoxesEl) b.checked = initial.points.includes(b.value)

  const checkedValue = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value
  const mode = (): Mode => (checkedValue('mode') as Mode | undefined) ?? 'cloze'
  const source = (): Source => (checkedValue('source') as Source | undefined) ?? 'grammar'
  const ticked = (boxes: HTMLInputElement[]) => boxes.filter((b) => b.checked).map((b) => b.value)
  const tickedIds = () => itemBoxes.filter((b) => b.checked).map((b) => bank.items[Number(b.value)].id)

  /** The current choice; `count` is undefined when "Other" is picked but its box isn't a valid number. */
  function currentChoice(): Omit<StartChoice, 'count'> & { count: QuestionCount | undefined } {
    const raw = checkedValue('count')
    const count: QuestionCount | undefined = raw === 'other' ? parseQuestionCount(otherInput.value) : raw === 'all' ? 'all' : Number(raw)
    return {
      mode: mode(),
      source: source(),
      levels: ticked(levelBoxesEl) as Level[],
      topics: ticked(topicBoxesEl),
      points: ticked(pointBoxesEl),
      items: tickedIds(),
      count,
    }
  }

  /** Each topic's and grammar point's count of sentences in this mode and these levels. */
  function showCounts(m: Mode, levels: readonly Level[]): void {
    const topics = topicCounts(bank.items, m, levels)
    const points = pointCounts(bank.items, m, levels)
    for (const [boxes, counts] of [
      [topicBoxesEl, topics],
      [pointBoxesEl, points],
    ] as const) {
      for (const box of boxes) {
        const n = counts.get(box.value) ?? 0
        const label = box.closest<HTMLElement>('.option')!
        label.querySelector('.option-detail')!.textContent = plural(n, m === 'cloze' ? 'drill' : 'sentence')
        label.classList.toggle('is-empty', n === 0)
      }
    }
  }

  function update(): void {
    const choice = currentChoice()
    const { mode: m, source: s, count } = choice

    // Cloze has no topic sentences: the topic tab is off, and a topic choice moves to grammar.
    topicRadio.disabled = m === 'cloze'
    topicPill.classList.toggle('is-disabled', m === 'cloze')
    $('.source-note').hidden = m !== 'cloze'
    if (m === 'cloze' && s === 'topic') {
      $<HTMLInputElement>('input[name="source"][value="grammar"]').checked = true
      return update()
    }

    $('.by-topic').hidden = s !== 'topic'
    $('.by-grammar').hidden = s !== 'grammar'
    $('.by-list').hidden = s !== 'list'
    $('.levels').hidden = s === 'list'
    $('.grammar-hint').textContent =
      m === 'cloze'
        ? 'Each grammar point gives its own drills.'
        : 'Each grammar point gives its drills and every topic sentence that uses it.'
    showCounts(m, choice.levels)

    const tickedCount = choice.items.length
    saveButton.disabled = tickedCount === 0
    shareButton.disabled = tickedCount === 0
    deleteButton.disabled = listSelect.value === ''

    const available = selectedItems(bank.items, m, choice).length
    const skipped = s === 'list' ? tickedCount - available : 0
    let text = summaryText(available, count, s, m, skipped)
    if (available === 0 && s !== 'list' && choice.levels.length === 0) text = 'Choose at least one level.'
    else if (available === 0 && s !== 'list' && (s === 'topic' ? choice.topics : choice.points).length > 0) {
      text = 'Nothing at these levels. Tick another level.'
    }
    summary.textContent = text
    startButton.disabled = available === 0 || count === undefined
  }

  // ---- Search and filters (custom list) ----

  /** Groups opened by a search, closed again when it's cleared (ones you opened stay open). */
  const autoOpened = new Set<HTMLDetailsElement>()

  function applyFilter(): void {
    const query = search.value
    const onlyTicked = tickedOnly.checked
    const filtering = query.trim() !== '' || onlyTicked
    let shown = 0
    itemRows.forEach((row, i) => {
      const visible = matchesSearch(searchKeys[i], query) && (!onlyTicked || itemBoxes[i].checked)
      row.hidden = !visible
      if (visible) shown++
    })
    for (const group of itemGroupsEl) {
      const rows = [...group.querySelectorAll<HTMLElement>('.item-row')]
      group.hidden = rows.every((r) => r.hidden)
      if (filtering && !group.hidden && !group.open) {
        group.open = true
        autoOpened.add(group)
      }
      if (!filtering && autoOpened.has(group)) {
        group.open = false
        autoOpened.delete(group)
      }
    }
    noMatches.hidden = shown > 0
    noMatches.textContent = onlyTicked && query.trim() === '' ? 'No sentences ticked yet.' : 'No sentences match.'
    tickShown.textContent = filtering ? 'Tick shown' : 'Tick all'
    showTickedCounts()
  }

  function showTickedCounts(): void {
    for (const group of itemGroupsEl) {
      const n = group.querySelectorAll('input[name="item"]:checked').length
      group.querySelector('.group-ticked')!.textContent = n > 0 ? `${n} ticked` : ''
    }
  }

  // ---- Saved lists ----

  /** The saved lists, keeping only ids still in the bank. */
  const savedLists = () => store.savedLists().map((l) => ({ ...l, ids: l.ids.filter((id) => known.has(id)) }))

  function fillListSelect(selected: string): void {
    const lists = savedLists()
    listSelect.replaceChildren(new Option('New list', ''), ...lists.map((l) => new Option(`${l.name} (${l.ids.length})`, l.name)))
    listSelect.value = lists.some((l) => l.name === selected) ? selected : ''
    savedListsRow.hidden = lists.length === 0
  }

  function setTicks(ids: Iterable<string>): void {
    const wanted = new Set(ids)
    itemBoxes.forEach((box, i) => (box.checked = wanted.has(bank.items[i].id)))
    ticksChanged()
  }

  /** After ticks change: an old link no longer matches, and a loaded list may now differ from its saved copy. */
  function ticksChanged(): void {
    linkInput.hidden = true
    const loaded = savedLists().find((l) => l.name === listSelect.value)
    listStatus.textContent = loaded && !sameIds(loaded.ids, tickedIds()) ? `Changed since saved. Save to update “${loaded.name}”.` : ''
    applyFilter()
  }

  listSelect.addEventListener('change', () => {
    const list = savedLists().find((l) => l.name === listSelect.value)
    if (list) {
      nameInput.value = list.name
      setTicks(list.ids)
      listStatus.textContent = `Loaded “${list.name}”.`
    } else {
      nameInput.value = '' // "New list": keep the ticks, ready to save under a new name
      listStatus.textContent = ''
    }
    update()
  })

  function saveList(): void {
    const name = cleanListName(nameInput.value)
    const ids = tickedIds()
    if (ids.length === 0) return
    if (name === '') {
      listStatus.textContent = 'Type a name for the list first.'
      nameInput.focus()
      return
    }
    const exists = savedLists().some((l) => l.name === name)
    if (exists && name !== listSelect.value && !confirm(`Replace the saved list “${name}”?`)) return
    store.saveList(name, ids)
    fillListSelect(name)
    nameInput.value = name
    listStatus.textContent = `Saved “${name}” (${plural(ids.length, 'sentence')}).`
    update()
  }

  saveButton.addEventListener('click', saveList)

  deleteButton.addEventListener('click', () => {
    const name = listSelect.value
    if (name === '' || !confirm(`Delete the list “${name}”? The ticked sentences stay ticked.`)) return
    store.deleteList(name)
    fillListSelect('')
    nameInput.value = ''
    listStatus.textContent = `Deleted “${name}”.`
    update()
  })

  shareButton.addEventListener('click', async () => {
    const ids = tickedIds()
    if (ids.length === 0) return
    linkInput.value = listLink(ids, location.origin + location.pathname)
    linkInput.hidden = false
    linkInput.select()
    try {
      await navigator.clipboard.writeText(linkInput.value)
      listStatus.textContent = 'Link copied. Open it on another device to get this list there.'
    } catch {
      listStatus.textContent = 'Copy this link to open the list on another device:'
    }
  })
  linkInput.addEventListener('focus', () => linkInput.select())

  // ---- Wiring ----

  $('.rules-button').addEventListener('click', () => handlers.onRules())

  form.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement
    if (target === otherButton) otherInput.focus() // picked "Other": ready to type
    if (target.name === 'item') ticksChanged()
    if (target === tickedOnly) applyFilter()
    update()
  })
  form.addEventListener('input', (e) => {
    if (e.target === search) applyFilter()
    update() // the number box, as each digit is typed
  })

  // Enter in the search or name box shouldn't start the quiz.
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      search.blur() // closes the phone keyboard
    }
  })
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveList()
    }
  })

  // Tapping or typing in the number box selects "Other".
  otherInput.addEventListener('focus', () => {
    if (!otherButton.checked) {
      otherButton.checked = true
      update()
    }
  })

  form.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!button) return
    const select = button.dataset.select
    if (select) {
      const [name, which] = select.split(':')
      for (const b of name === 'topic' ? topicBoxesEl : pointBoxesEl) b.checked = which === 'all'
      update()
    }
    const level = button.dataset.tickLevel
    if (level) {
      const boxes = [...button.closest('.option-group')!.querySelectorAll<HTMLInputElement>('input[name="point"]')]
      const tick = !boxes.every((b) => b.checked)
      for (const b of boxes) b.checked = tick
      update()
    }
  })

  tickShown.addEventListener('click', () => {
    itemBoxes.forEach((box, i) => {
      if (!itemRows[i].hidden) box.checked = true
    })
    ticksChanged()
    update()
  })
  $('.untick-all').addEventListener('click', () => {
    setTicks([])
    update()
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const choice = currentChoice()
    if (choice.count === undefined) return
    const cards = pickCards(bank.items, choice.mode, choice, choice.count)
    if (cards.length === 0) return
    store.saveStartChoice({ ...choice, count: choice.count })
    handlers.onStart(cards)
  })

  // A saved list holding exactly the starting ticks shows as loaded.
  const matching = initial.items.length > 0 ? savedLists().find((l) => sameIds(l.ids, initial.items)) : undefined
  fillListSelect(matching?.name ?? '')
  nameInput.value = matching?.name ?? ''
  applyFilter()
  update()
}
