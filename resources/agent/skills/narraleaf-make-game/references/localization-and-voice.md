# Translating the game and wiring voice-over

Two jobs that work the same way: the game's text and its recordings are attached to the lines,
pages and keys the game already has, unit by unit, and every write is one step of undo in Studio.
Neither one changes the story itself - translations and takes are layered on top of it.

**One id runs through everything.** A story line's unit id is its translation unit and its voice
line; interface words are `ui:<element>.<prop>`, named keys `key:<name>`, character names
`char:<id>`, scene names `scene:<id>`, ending names `ending:<id>`, `/rename` words `rename:<id>`.
Take ids from the list tools; never build one by hand.

## Part 1 - Translating

### Languages

- The **source language** is the one the game is written in (`project_info` -> `sourceLanguage`).
  It is never translated: its text *is* the story rows, pages and keys. `localization_set` refuses it.
- **Target languages** are added with `project_settings_set {languages: [<source>, <target>, ...]}`.
  A new language starts untranslated. `localization_status` shows how far each one is.

### Statuses

| Status | Meaning |
|---|---|
| `missing` | No translation yet. |
| `machine` | Translated by a machine - by you. The default when you write. |
| `translated` | Final text from a translator. Use it only when the author asked for final text. |
| `reviewed` | Signed off by the author. Never set it unless the author says they reviewed those lines. |
| `stale` | Translated, but the source line changed afterwards. Translate the new source. |

`todo` (a filter, not a status) means `missing` or `stale` - what still needs work. The author
signs off your `machine` lines in the translation table's Review mode.

### The order of work

1. **Plan.** `localization_status {language}` gives the totals per origin (`story`, `names`,
   `interface`, `keys`, `plugins`) and each scene's lines left to do. Tell the author how many lines
   that is and in how many batches you will write them.
2. **Glossary first.** Translate the names before any line: `localization_list {language,
   origin:"names"}` (characters, scenes, endings, `/rename` words). Agree the character names with
   the author, then write them. Keep a glossary in the chat - names, places, recurring terms, how
   each character addresses the others, honorifics, the register of each voice - and follow it in
   every batch. A name translated two ways in one game is the most visible translation mistake.
3. **Interface and keys next** - they are short and the player sees them first:
   `localization_list {language, origin:"interface"}` (or `page:"Title"` for one page) and
   `origin:"keys"`. Keep button labels short enough for their buttons; check with `ui_screenshot`
   when the target language runs long.
4. **Then the story, scene by scene, in story order**:
   `localization_list {language, scene, status:"todo"}` -> translate -> `localization_set {language,
   entries}` with every unit's `rev`. One scene per call when scenes are a few hundred lines or
   fewer; split a longer scene into batches of about 300 (`limit` + `nextCursor`). The author watches
   the table fill as you go. For a 20 000-line game that is many calls - work steadily, report
   progress every few scenes, and do not try to translate the whole game in one call.
5. **Re-check.** `localization_status {language}` until `todo` is zero, then `lint`: the
   `localization/missing`, `localization/stale` and `localization/markup` findings name what is left.

### Writing a batch

```json
{"language": "en", "entries": [
  {"unitId": "t-8f2c", "target": "It was raining.", "rev": "1a2b3c4d"},
  {"unitId": "t-91aa", "target": "That was ‹1›really‹/1› close.", "rev": "77e0f1c2"}
]}
```

- **Always pass `rev`.** It covers the source and the translation as you listed them. A unit whose
  source the author changed since is skipped and returned under `changedSinceRead` with its new
  source - translate that and send it again. A unit whose translation the author typed or reviewed
  since is skipped and returned under `translationChangedSinceRead` with what it holds now - leave it,
  or send yours again with that entry's `rev` only if it should replace the author's words.
- **Unknown ids refuse the whole call** and nothing is written; list again (an edited row may have a
  new id).
- `target: ""` clears a translation. `note` leaves a translator's note in the table.
- `dryRun: true` checks the batch (ids, warnings) without writing.

### Keep the markup

The `source` a list returns shows everything a translation has to carry:

- `{0}`, `{1}` - a value the game fills in (a variable, the player's name). Keep every one, in the
  place the target language's grammar wants it.
- `‹1›word‹/1›` - a styled span (bold, colour, ruby, emphasis). Wrap the translated word or phrase
  in the same tag. `‹2/›` - a pause or an inline event (an expression change, a sound) at that
  point; keep it where the moment falls in the translated sentence.
- `{name}` in an interface word or a key - a placeholder a blueprint fills. Keep it as it is; never
  translate the word inside the braces.
- Line breaks - keep the same number unless the author asked otherwise.

A batch that loses any of these is written but returned with `warnings` per unit. Fix those units
and send them again; do not leave a warning behind.

### Style

- Translate meaning and voice, not words. A character who is curt in the source is curt in the
  translation; keep each speaker's register consistent across the whole game.
- Keep lines about the length of the source: the dialogue box was sized for it.
- Do not translate proper names the glossary keeps, file names, or anything inside `{}`.
- When the source is ambiguous, ask the author rather than guess, and leave a `note` on the unit.

## Part 2 - Voice-over

Studio never records. A voiced line is **linked** to an audio asset already imported into the
project, and the director **approves** the take. Voice languages are separate from the text
languages: a game can be read in English and dubbed in Japanese. Each voice language has its own
takes; the text of a line in a voice language is its translation in that language when there is one.

### Setting up

1. `voice_status` - the voice languages, the file-name rule and coverage per language and character.
2. `voice_settings_set {languages: ["ja"]}` adds a voice language. Set `namingPattern` now, before
   anything is recorded, if the author's booth names files another way. `voiceChoices: true` makes
   choice options voiced lines too (off by default).

### The file-name rule

The default rule is `{scene}_{index}_{character}`: the scene name, the line's position among the
voiced lines of its scene (`001`, `002`, ...), and the speaker. Narration and choice options have
labels of their own. `voice_list {language}` gives every line's exact name as `expect` - hand that
list to the author or the booth when files still need naming. Matching ignores case, spaces,
punctuation, extensions and folders, so `Opening_001_Aoi.ogg`, `opening 001 aoi.wav` and
`voice/ja/Opening-001-Aoi.mp3` all match `Opening_001_Aoi`. It matches against an asset's **name in
the library**, so a misnamed take can be fixed by renaming the asset.

### Wiring the takes

1. `assets_import` the recordings (type `audio`) into a folder of their own, e.g. `Voice JA`.
2. `voice_auto_link {language, assetFolder:"Voice JA", dryRun:true}` - read the answer:
   - `linked` - lines that will get their take;
   - `ambiguous` - a name two assets share, or a name the rule gives two lines (two identical names
     in one scene). Never guessed at: link those with `voice_link` by id;
   - `missingSample` - lines with no take and no file of their name, with the name they expect;
   - `unmatchedAssets` - files whose name is no line's: a misspelling, or a line that moved since
     the script was exported. Compare with `expect` and link them by hand.
   - `keptOtherTake` - lines that already have a different take; `relink:true` replaces them.
3. Run it again without `dryRun`. One step of undo, however many takes it links.
4. `voice_list {language, unlinkedOnly:true}` - the gaps. Link what you can with
   `voice_link {language, links:[{unitId, asset}]}` (asset by id or library name), and list the rest
   for the author as missing recordings.
5. `voice_status {language}` to report coverage per character.

### Approval, stale takes, playback

- New takes are `linked`. `voice_link {links:[{unitId, status:"approved"}]}` signs a take off -
  only when the author says they listened to it.
- A take goes `stale` when its line's text changes after linking (or its translation, for a dubbed
  language). Report stale takes to the author; the line may need a pickup recording.
- The game plays a line's take as the line is shown, on the character's voice track. A Gallery
  voice tab (`plugin:narraleaf.gallery`) unlocks voice lines by itself.
- `lint` reports `voice/missing`, `voice/stale` and `voice/orphan` (a take whose line is gone).

## Reporting

In the hand-over, give per language: how many units are translated and how many still `machine`
(awaiting the author's review), and per voice language how many lines have a take, how many are
approved, and which recordings are missing (scene and expected file name).
