# Story editor: interaction model

The rules the scene editor's keyboard and mouse behaviour derive from. Written down because every
one of them replaced something that did the opposite, and because the slash-command system builds on
top of them (see `docs/plans/2026-07-16-001-feat-story-command-system.md`).

## The four rules

1. **Escape is one exit ladder, one rung per press. It never commits and never destroys.**
   Candidates first, then the slot. Leaving an *edit* saves (it goes through history, so `Mod+Z`
   undoes it); leaving an *uncommitted slot* creates nothing.
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
| `Esc` | — | commit + exit | ① dismiss candidates, keep text ② discard slot |
| `Enter` | text row → edit; action row → inspector | commit + new same-kind row (carries speaker) | take highlight; else resolve line |
| `Tab` | indent | — | take highlight |
| `Shift+Enter` | blank row after last selected | commit + blank row after | `#` line → invalid row; else resolve line |
| `Shift+Tab` | outdent | — | — |
| double-click | enter edit, native word selection preserved **(intended; currently broken — see Selection)** | — | — |

`Mod+Enter` was removed: it did exactly what `Shift+Enter` does, had no UI path, and was silently
downgraded to plain `Enter` inside the slot.

There is no soft line break. `Enter` never inserts `\n` — rows are the line model.

## Selection

One rule decides all three mouse gestures: **is the selection collapsed at mouseup?**

- Collapsed (a click) → select the row.
- Non-collapsed within one row (a drag, or a double-click) → enter edit, carrying the selection.
- Crossing a row boundary → abandon the text selection, switch to row-range selection, and suspend
  `user-select` for the rest of the gesture.

> **This section describes intent, not current behaviour.** Double-click on a row with text does not
> actually enter edit mode. The model is sound; the implementation is not. Being rebuilt — see
> `docs/plans/2026-07-16-003-handoff-story-row.md`.

The suspend/restore is the fragile part: teardown must cover `mouseup`, `pointercancel` **and**
`window blur`, or text becomes permanently unselectable. Drag is safe from the row body because
dnd-kit's listeners live only on the grip.

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

- Narration cannot begin with `/` — it resolves as a command or becomes an invalid row. Accepted;
  create such a line via a command instead.
- The inspector's speaker select is real-characters-only (it speaks in `characterId`). Temp speakers
  are reachable from the nametag and the `#` slot.
