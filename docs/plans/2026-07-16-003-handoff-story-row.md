---
title: "handoff: 故事行（选中 / 行内编辑）剩余工作"
type: handoff
status: draft
date: 2026-07-16
---

You own the story **row** in `src/renderer/apps/workspace/modules/story/scene-editor/` — selection,
the rich-text row editor, and the row chrome. Read `docs/story-editor-interaction-model.md` first —
it is the contract. The keyboard half of it is implemented and verified; the **mouse half is not**,
and that is Job 0 below.

## Job 0 — the mouse interaction is broken. Walk it from scratch.

**Double-click on a row with text does not enter edit mode.** Reported from real use. Take this as
your starting point and rebuild the whole mouse path — press, click, drag, double-click, cross-row
drag — from first principles until each one is something you have personally watched work in the
running app.

Read this next paragraph as a warning, not as background. The code below *looks* finished and is
commented as if it works. A previous pass wrote those comments, marked the work done, and even put
"double-click preserves the native word selection" into a handoff as **verified** — without ever
double-clicking a row. Tests were green the whole time. **Trust nothing here that you have not driven
yourself.**

### The intended design (this part is sound — keep it)

One rule decides all three gestures: **is the selection collapsed at mouseup?**

- Collapsed (a plain click) → select the row.
- Non-collapsed within one row (a drag, or a double-click's word) → enter edit, carrying the
  selection into the editor.
- Crossing a row boundary → abandon the text selection, switch to row-range selection, suspend
  `user-select` for the rest of the gesture.

Double-click is deliberately *not* its own path — it is "drag-select" whose selection happens to be a
word. That collapse is the good idea in here; the bug is in the execution, not the model.

### Where it lives

- `StorySceneEditorRows.tsx:133-146` — the row's `onClick` / `onMouseDown` / `onDoubleClick`. Note
  `onDoubleClick` **returns early** when the target is inside `[data-story-row-text]`, deliberately
  deferring to the mouseup path. So on a text row, double-click depends *entirely* on that path.
- `StorySceneEditorRows.tsx:1701,1715` — `data-story-row-text={hasValue ? "" : undefined}`. Present
  only when the row has text. Empty rows fall through to `onDoubleClick` and open directly.
- `useStorySceneEditorController.ts:1215` `beginDragSelection` — a plain press on row text stores
  `textSelectRef` and returns *without* starting a row drag, letting the browser select natively.
- `useStorySceneEditorController.ts:254` `finishTextSelectGesture` — reads
  `getSelectionUnitRange(textEl)`, bails if collapsed, else sets `{ kind: "text", caret: range }`.
- `useStorySceneEditorController.ts:315-366` — the window `mousemove` / `mouseup` / `pointercancel` /
  `blur` effect.

### Ruled out already — don't spend time re-checking these

- The window `mouseup` listener is **not** gated on `dragSelectActive`; the effect mounts
  unconditionally, so the listener is always attached.
- `selectRow` does **not** reset `editorMode`, so the `click` that fires after mouseup is not
  clobbering the edit mode that `finishTextSelectGesture` just set.
- `data-story-row-text` **is** rendered on rows that have text.

I narrowed it that far and did not find the cause. Reproduce it first, instrument the real event
order (`mousedown → mouseup → click → dblclick`, twice), and find out which step actually fails
before changing anything. Suspect areas worth instrumenting: whether `getSelectionUnitRange` returns
non-collapsed for a double-clicked word in the **read-only** view's DOM, and whether anything clears
the selection between mousedown #2 and mouseup #2.

Once it works, decide whether keeping double-click implicit (via mouseup) is worth it, or whether an
explicit `onDoubleClick` path is simply more honest. Either is fine if it works and the three
gestures stay consistent — but if you make it explicit, it must still carry the word selection into
the editor rather than resetting the caret.

## The rest of the model — already landed, don't renegotiate

Verified by driving the app. Changing these semantics is a regression:

- **Escape is one exit ladder, one rung per press, and never commits or destroys.** Leaving an edit
  saves (through history); leaving an uncommitted slot creates nothing.
- **`Enter` = new same-kind row. `Shift+Enter` = blank row. No soft line break.** `Mod+Enter` was
  removed on purpose (it duplicated `Shift+Enter`).
- **`RichTextView` and `renderRunsToElement` are one renderer.** They had silently drifted (ruby/cps
  rendered in edit mode, invisible in the read-only row). Keep them unified — the selection carry-over
  in Job 0 depends on both producing the same unit structure.

Two things reported early that were **wrong** — the current code is correct, leave it alone:

- The `lineHeight * 0.6` edge detection in `RichTextInput.getCaretEdges` is right. A single-line row
  being both `atFirstLine` and `atLastLine` is correct: there is no line above or below to go to.
  Rows still wrap (long text), so the geometry is load-bearing.
- The focus guard is a `commitGuardRef` boolean now, not the old 500ms timer. Fine as-is.

## Not yours

`Mod+Z` inside a row is broken (the native undo stack is wiped by `renderRunsToElement`, and story
undo is suppressed in editable fields). It is **assigned to the slash-command-system agent** —
see `docs/plans/2026-07-16-002-handoff-story-command-system.md`. Don't touch it; you'll collide.

The `InsertRow` slot's key routing is also that agent's. You own the *committed* row.

## Then the rest — smaller, and none of it blocks Job 0

Ordered by how much a real author would feel it.

### Vertical arrow navigation has no goal column

`useStorySceneEditorController.ts:778` — `caret: goingBack ? "end" : "start"`. ArrowDown lands at
the start of the next row, ArrowUp at the end of the previous. **Down-then-up does not return you to
where you were.** Every text editor maintains a goal column: the desired x-offset persists across
vertical moves until a horizontal move or an edit resets it.

Hold the goal column in a ref (it is not state — it must not re-render), seed it from the caret's
client x on the first vertical move, and consume it when entering the next row (map x → unit offset
via `caretClientRect`-style hit-testing). Reset on any horizontal arrow, click, or text change.

### The rich-text toolbar covers the row above it

`RichTextToolbar.tsx:218` portals to `document.body` as `fixed z-[55]`, positioned at
`Math.max(4, rect.top - 34)`. It is **not clipped to the editor pane and never flips below**.

Observed: editing a row renders the toolbar chip opaquely over the *previous* row's text (a
background row read as "ckground unassigned" — the label was covered). Also: edit the top row and it
floats over the tab strip; scroll the row out of view and it stays pinned at `top: 4` over unrelated
UI.

Fix: clip to the scroll container, flip below when there is no room above, and hide it when the
anchor row scrolls out of view.

### Blur with the chooser open is a stuck state

`StorySceneEditorRows.tsx:900` — `onBlur` only acts when `chooser === "none"`. The menus
`preventDefault` on mousedown so they never take focus; click any *other* element while the chooser
is open and the slot keeps rendering, with its menu, with nothing focused and no dismiss path.

Decide it deliberately and match the Escape ladder: blurring away from an open chooser should
dismiss the candidates and leave the line, or discard the slot. It must not commit.

### Row actions are keyboard-unreachable

`StorySceneEditorRows.tsx:474-475` — Insert / Delete are `tabIndex={-1}` inside an `opacity-0`
group-hover container. They exist only for the mouse. `Alt+Arrow` reorder has the inverse problem:
keyboard-only, with drag as its only visible equivalent.

Neither needs to become a permanent control. The cheap fix is discoverability: make them reachable
when the row is focused, and surface the shortcut in their `title`.

### `initialRuns` is read once

`RichTextInput.tsx:144` — the mount effect has `[]` deps by design ("render initial content once;
edits are model/DOM driven from here"). Consequence: **external changes to a row being edited never
reflect.** Renaming a variable does not refresh its chip label mid-edit either — the label ref
updates but nothing re-renders the chip.

This is a deliberate trade (the DOM is the source of truth while editing), so don't naively add deps
— that would clobber the author's caret on every keystroke. Handle the *specific* external updates
that matter (chip labels) by patching those nodes in place.

### `aria-multiline="false"` on a field that wraps

`RichTextInput.tsx:520`. Screen readers announce a wrapping, multi-visual-line editor as single-line.

## How to verify

**Drive the app. Do not stop at tests** — the unit tests were fully green while `#Zoe` + Tab was
putting the speaker's own name into their first line of dialogue. Only running it caught that.

```
yarn dev                              # NB: starts with `rimraf dist` — wait for the rebuild
node project/app/cdp.js list          # port 9222
node project/app/cdp.js --target workspace eval "…"
```

If the workspace is blank with `ERR_FILE_NOT_FOUND`, you raced the `rimraf`; `yarn build:apps:dev`
then reload, or launch `node project/app/dev-electron.js --cdp --cdp-port=9222` directly.

Test projects live in `/Users/nomen/Documents/dev/test/` (`demo2` has 3 scenes / 23 blocks). **Leave
them as you found them** — undo your rows, and note that a confirm dialog's buttons are `Cancel`/`OK`,
not `Delete`.

Tests to keep green: `richText.test.ts`, `speakerCandidates.test.ts`, `storySceneBlockUtils.test.ts`,
`storyEditorSessionStore.test.ts`.
