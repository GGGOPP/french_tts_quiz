# Quiz data

All quiz content lives here as YAML. The pipeline turns it into audio and `web/public/items.json`. Check it with:

```sh
cd pipeline
uv run python -m french_tts.data      # prints a summary, or every problem with file and item id
uv run pytest                         # includes the same check on this folder
```

```
data/
  topics/<topic>.yaml     sentences and phrases about one situation (restaurant, travel…)
  grammar/<point>.yaml    one grammar point: a rule card plus cloze drills
```

Every item gets the dictée, listen→meaning and English→French modes. Items with a `{blank}` in `fr` also get the cloze mode.

## Topic files

```yaml
# data/topics/restaurant.yaml   (the file name is the topic's id)
topic: Café & restaurant
items:
  - id: resto-03
    fr: Je voudrais un café, s'il vous plaît.
    en:
      - I would like a coffee, please.
      - I'd like a coffee, please.
    alt_fr:
      - Je voudrais un café, s'il te plaît.
    level: A1
    grammar: [conditional-politeness]
    register: formal
    notes: Je voudrais is the polite way to order.
```

## Grammar files

```yaml
# data/grammar/passe-compose-etre.yaml   (the file name must equal `point`)
point: passe-compose-etre
title: Passé composé with être
level: A2
rule: |
  Verbs of movement (aller, venir, partir…) and reflexive verbs take **être**.
  The participle agrees with the subject: elle est allée, ils sont partis.
items:
  - id: pce-01
    fr: Hier, elle {est allée|aller} au marché.
    en: [Yesterday she went to the market.]
    explain: aller takes être; feminine subject → allée.
```

- `rule` is a short rule card in Markdown. It is shown after a wrong answer and in the rule-card browser.
- Every item is a cloze drill, so it needs at least one `{blank}` and an `explain`.
- `level` is the default for the file's items. An item can override it.
- An item belongs to its file's point automatically. Use `grammar:` only for *other* points it also practises.
- `items: []` is allowed: a rule card with no drills yet. This lets topic items be tagged with a point before its drills are written.

## Item fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique across all files. Lowercase letters, digits and hyphens, with a short per-file prefix: `resto-03`, `pce-01`. **Never change or reuse an id**: the audio files and the learner's progress are keyed by it. To retire an item, delete it. |
| `fr` | yes | The French sentence, which may include cloze blanks (see below). This is what is spoken and what dictée expects. |
| `en` | yes | A list of accepted English translations. The first is shown as *the* translation, and all are used when marking listen→meaning. |
| `alt_fr` | no | Other correct French answers for English→French, such as tu/vous or on/nous variants and other word orders. Plain French, no blanks. |
| `level` | topic items | `A1` or `A2`. Grammar items inherit their file's level. |
| `grammar` | no | Grammar points the item practises. Each one must have a file in `grammar/`. |
| `register` | no | `formal` (vous expected) or `informal` (tu expected). Leave it out when either is fine. It tells the grader whether tu/vous matters. |
| `explain` | grammar items | Why the blank takes that form. One or two short lines, in English. |
| `notes` | no | Usage notes shown with the feedback. |
| `voice` | no | Override the voice (`denise`, `henri`, `vivienne`, `remy`, `eloise`). By default items alternate between Denise and Henri. |
| `tts_text` | no | Text to speak instead of `fr`, for fixing a mispronunciation found in QA (step 12). The learner never sees it. |

Any other key is an error, which catches typos such as `alt-fr`.

## Cloze blanks

`{answer|hint}` marks a blank in `fr`:

- **`answer`** is the exact form the learner must type. List alternatives with `/`, for example `{sont arrivés/sont venus|arriver}`. The first alternative is the one spoken and shown in the full sentence.
- **`hint`** is optional and is shown in the blank, usually the infinitive (`aller`) or a cue (`negative`, `my`). Leave it out only when the context makes the answer unambiguous: `{hier}`.
- A sentence may have more than one blank.

## Conventions

- Write a straight apostrophe `'` (not `’`) and single spaces. Put a normal space before `? ! : ;`, as in French (`Tu as faim ?`). The app handles display and normalisation.
- Start every `fr`, `alt_fr` and `en` entry with a capital letter, as a sentence. End with punctuation where the sentence would have it.
- Write numbers in words (`quatre-vingt-dix`), so dictée has a single right spelling. The numbers mode practises digits.
- Keep sentences short and natural. Use A1–A2 vocabulary, and one new difficulty per sentence.
- **Every sentence is also a dictée**, so its spelling must follow from the audio plus grammar. Avoid sentences that sound the same as another spelling:
  - *il parle* / *ils parlent*: use a subject you can hear is plural (*mes amis parlent*), or a verb whose plural sounds different (*ils ont*, *ils prennent*, *ils invitent*).
  - *je suis allé* / *je suis allée*, *je suis fatigué(e)*, *nous sommes prêts/prêtes*: only je, tu, nous and vous hide the gender. Use il, elle or a name instead (*Sophie s'est levée*).
  - *leur vélo* / *leurs vélos*: the plural must be heard somewhere (*leurs amis* has a z sound).

  Agreement that grammar decides (*elle est allée*, *les fleurs blanches*) is fine. That is what dictée practises.
- Give `en` the natural English translations a learner might write (contractions, word-order variants). The LLM grader handles other paraphrases.

## YAML pitfalls

The validator catches each of these, but it is quicker to avoid them:

- **Commas split entries inside `[...]`.** `en: [Yes, please.]` is two entries, `Yes` and `please.`. Quote the entry (`["Yes, please."]`) or use a block list (`- Yes, please.`).
- **A `?` just before `]` breaks a flow list.** `en: [Are you hungry?]` is a parse error. Write lists in block style (`- Are you hungry?` on its own line), as the data files do.
- **A value can't start with `{` or `"`.** `fr: {Où|where} est la gare ?` would be read as a mapping. Quote the whole value: `fr: "{Où|where} est la gare ?"`.
- **`yes`, `no`, `on` and `off` become booleans.** `en: [No]` gives `false`. Write `["No."]`.
- **`: ` and ` #` inside a plain value** start a mapping or a comment. Quote values that contain them.
- **Duplicate keys** in one item are an error. Plain YAML would silently keep the last one.
