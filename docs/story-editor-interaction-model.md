# Story editor: interaction model

The rules the scene editor's keyboard and mouse behaviour derive from. Written down because every
one of them replaced something that did the opposite, and because the slash-command system builds on
top of them (see `docs/plans/2026-07-16-001-feat-story-command-system.md`).

## The four rules

1. **Escape is one exit ladder, one rung per press. It never commits and never destroys.**
   Candidates first, then the slot; an open property editor is its own rung. Leaving an *edit* saves
   (it goes through history, so `Mod+Z` undoes it); leaving an *uncommitted slot* creates nothing;
   closing an *inspector* keeps the row selected.
2. **The highlight is Enter's pointer.** Wherever a candidate is highlighted, Tab and Enter both take
   it — deliberately the same key. Where nothing is highlighted, Enter commits the line. This is why
   "must pick one" positions (command name, speaker name) highlight by default and "optional next
   step" positions (`k=` params) must not.
3. **Enter advances between rows. Tab advances within a row. Shift+Enter always ends the line and
   opens a blank one.**
4. **A line that resolves to nothing becomes an invalid row — never prose.** The author's text
   survives verbatim; preview skips it with an error diagnostic; the build refuses it.

## Key map

| | idle | text edit | insert slot |
|---|---|---|---|
| `Esc` | close inspector, if open | commit + exit | ① dismiss candidates, keep text ② discard slot |
| `Enter` | text row → edit; action row → inspector (or its card-less op) | commit + new same-kind row (carries speaker); **narration → insert slot** | take highlight; else resolve line |
| `Tab` | indent | — | take highlight |
| `Shift+Enter` | blank row after last selected | commit + blank row after | `#` line → invalid row; else resolve line |
| `Shift+Tab` | outdent | — | — |
| double-click | enter edit, native word selection preserved | — | — |

`Mod+Enter` was removed: it did exactly what `Shift+Enter` does, had no UI path, and was silently
downgraded to plain `Enter` inside the slot.

There is no soft line break. `Enter` never inserts `\n` — rows are the line model.

**Narration is the exception to same-kind continuation.** A committed narration row cannot begin with
`/` (see Known gaps), so "narration begets narration" would strand the author in prose with no
keyboard path to an action. Its Enter opens the insert slot instead — the one surface where the next
line can stay narration, turn into an action (`/`), or a line of dialogue (`#`). Dialogue keeps its
successor (a back-and-forth wants the same speaker) and still demotes to the slot on Backspace, so it
is not a trap.

**Card-less action rows run their own operation, not a placeholder inspector.** Conditions and their
branches have no card (`hasInspector`): the branch authors its condition inline on its header chip,
and the container only manages branches. So Enter on a branch adds a line inside its body — the common
next step when building an if/else — and Enter on the condition container folds it. Creating one never
opens a card either (`isInspectorFirstCommand` excludes them).

## Editing in place

A row and the same row *being edited* are one surface: no border, no sunken box, no shift in x or
height. The active/selected row highlight is the only "you are here" signal — the field carries none of
its own — so entering and leaving an edit never makes the text jump (the VS Code feel). The insert
slot is that same surface, indented to its future depth with a badge-sized spacer and its line number
swapped for a `+`, which is what lets narration's Enter fall into it without the text visibly moving.

A filled row's read-only text is a click target the full height of the row and the full width to its
right (`TextClickTarget`), with the glyphs kept vertically centred — so a click anywhere on the line,
including the strip above/below the text or the blank tail, lands the caret in the text rather than
selecting the row underneath it.

## The goal column

Arrows walk out of a row only from its true edges (`ArrowUp` on the first visual line, `ArrowDown` on
the last, `ArrowLeft`/`ArrowRight` at the very ends), so a wrapped row is walked line by line first.

Crossing rows, the caret **keeps its x**: `ArrowDown` then `ArrowUp` puts the author back where they
started, not on a line edge. Rows are separate editors — the browser's own goal column stops at the
field boundary — so the x crosses as data (`{ goalX, line }`) and the arriving row resolves it against
its own text, clamping to the nearest character when that row is shorter or starts further left (a
dialogue's text is indented past its nametag).

The column lives until the author states a new one. **Every key except a vertical arrow ends the run**
— a horizontal arrow, a click in the text, a keystroke — which is the standard editor rule and the
only one that behaves: `ArrowLeft` inside a row never reaches the row-boundary handler, so a run that
only ended on arrow-*out* would drag a stale column across the next `ArrowDown`.

## Selection

A press on a row's own text is a press *into that text* — the row is a line, and clicking a line
edits it (the VS Code rule), so the browser's selection at mouseup carries straight in:

- Click (collapsed) → enter edit, caret where the pointer landed (the blank tail lands it at line end).
- Drag / double-click within one row → enter edit, carrying the selection.
- Crossing a row boundary → abandon the text selection, switch to row-range selection, and suspend
  `user-select` for the rest of the gesture.

**Selecting a row without editing** — for delete / move / indent / multi-select — comes from the parts
that are *not* text: the line-number / grip gutter, a modified click (`Shift` / `Mod` for range /
toggle), a drag that crosses rows, or `Escape` out of an edit (which leaves the row selected). Empty
text rows are a click-to-edit surface too (the caret just clamps to 0 in the empty editor); only action
rows — which have no text — select on click and open their inspector on double-click / `Enter`.

**The whole model rests on one prerequisite: the browser must be allowed to select a row's text.**
`styles.css` resets `user-select: none` onto everything (`*, *::before, *::after`), so a row that
holds text opts back in with `.nl-selectable-text`. Without that opt-in the selection at mouseup is
always collapsed, every gesture reads as a plain click, and no row ever opens — which is exactly how
double-click-to-edit stayed broken for a whole pass while the event plumbing above it was correct and
every unit test passed. jsdom implements neither `user-select` nor native selection, so **only
driving the real app tests this.**

The suspend/restore is the fragile part: teardown must cover `mouseup`, `pointercancel` **and**
`window blur`, or text becomes permanently unselectable. Drag is safe from the row body because
dnd-kit's listeners live only on the grip. Suspending has to come from `.nl-text-select-suspended`
rather than an inline `user-select` on the rows root: the rows' own `user-select: text` is an
explicit value, and an inherited one cannot override it.

## Invalid rows (`kind: "invalid"`)

Not a note, not narration, no runtime behaviour. Payload is `{ source }` — the line as typed, so
re-editing resumes command entry from it.

Preview compiles around it (an unfinished command is normal while writing); the **build** is the gate
— `BuildService.start` scans every story in the library via `collectInvalidBlocks` and refuses. The
story compiler runs inside the game at startup, not at build time, so it cannot be that gate.

## Speakers

A dialogue row points at a real character (`characterId`) **or** a bare name (`speakerName`) — never
both. NLR's dialogue box only displays the name its `Character` carries, so a bare name is a valid
line, not an error.

That fact is what removes "nothing matched" as a state: the speaker picker always offers the typed
name back as a candidate, so the list is never empty and Tab/Enter never need a special case. Live
temp speakers are derived from the document (`collectTempSpeakers`), so one retires exactly when its
last line does.

- Candidate order: real characters → names already used in this story → the name being typed.
- Identity in the compiler keys on the name (`name:<n>`), so every line by one temp speaker shares a
  `Character`. A stale `characterId` falls back to `speakerName` rather than collapsing to "Unknown".
- The nametag is a text field, not a menu — that is how a temp speaker gets renamed, since there is no
  character record to go and edit.
- **Create character** promotes the name: creates it, rebinds every line using it
  (`promoteTempSpeaker`), reveals the Characters panel, and leaves the caret in the line being
  written.

## Known gaps

- Narration cannot begin with `/` — inside a committed narration row `/` is literal text. This is why
  narration's Enter opens the insert slot rather than another narration row: the slot is where `/`
  starts a command.
- The inspector's speaker select is real-characters-only (it speaks in `characterId`). Temp speakers
  are reachable from the nametag and the `#` slot.
