---
title: "handoff: 故事行（选中 / 行内编辑）剩余工作"
type: handoff
status: draft
date: 2026-07-16
---

You own the story **row** in `src/renderer/apps/workspace/modules/story/scene-editor/` — selection,
the rich-text row editor, and the row chrome. Read `docs/story-editor-interaction-model.md` first —
it is the contract. Both halves of it, keyboard and mouse, are now implemented and driven in the app;
Job 0 below records what the mouse half turned out to be. What is left is the list under
"Then the rest".

## Job 0 — **DONE (2026-07-16).** Root cause was CSS, not the event plumbing.

`*, *::before, *::after { user-select: none }` (`styles.css:128`) made row text unselectable, so the
browser never created a selection, so `finishTextSelectGesture` hit `range.start === range.end` and
bailed on **every** gesture. The JS below is correct and always was — which is why reading it found
nothing. The model needs a native selection the app's own global reset forbids.

Fix: rows with text opt back in via `.nl-selectable-text`; `setRowTextSelectable` now toggles
`.nl-text-select-suspended` instead of writing an inline `user-select` (an inherited value cannot
override the rows' explicit one — the old inline write was a no-op *twice over*, since everything was
already `none`).

Driven in the app, all four gestures, via CDP `Input.dispatchMouseEvent`:

| gesture | result |
|---|---|
| click | row selected, not editing |
| double-click | editing, editor selection `"The"` — the word carried in |
| drag in row | editing, editor selection `"The town is q"` |
| cross-row drag | 4 rows selected, no text selection, `suspended:true` → `false` after mouseup |

**Double-click stays implicit** (no `onDoubleClick` path for text rows). It now genuinely works, one
rule still covers all three gestures, and an explicit path would duplicate the selection carry-over —
two paths to drift apart, which is what this file is about.

Two traps for whoever drives this next, both of which produced convincing lies mid-investigation:
- A row's `getBoundingClientRect()` reports its layout position **even when the scroll container
  clips it or the Console panel covers it**. Synthetic clicks then land on `<html>` and every probe
  reads "no selection" — indistinguishable from the real bug. Hit-test the point
  (`elementFromPoint(...).closest('[data-story-row-text]')`) before believing any result.
- A restored session can come up with a modal open (a "Build for distribution" dialog was), which
  swallows everything.

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

- `StorySceneEditorRows.tsx` — the row's `onClick` / `onMouseDown` / `onDoubleClick`; `onDoubleClick`
  returns early inside `[data-story-row-text]`, deferring to the mouseup path.
- `StorySceneEditorRows.tsx` — `data-story-row-text` + `nl-selectable-text`, both only when the row
  has text. Empty rows fall through to `onDoubleClick` and open directly.
- `useStorySceneEditorController.ts` `beginDragSelection` / `finishTextSelectGesture` / the window
  `mousemove`/`mouseup`/`pointercancel`/`blur` effect.
- `styles.css` — the global `user-select: none` reset, `.nl-selectable-text`, and
  `.nl-text-select-suspended`.

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

### ~~Vertical arrow navigation has no goal column~~ — **DONE (2026-07-16)**

Built as described: `goalColumnRef` in the controller, seeded from the caret x that `onArrowOut` now
reports, carried to the next row as a new `StoryCaretTarget` variant `{ goalX, line }`, and resolved
there by `resolveInitialCaret` → `unitOffsetFromPoint` (`caretRangeFromPoint` against the arriving
row's own text, clamped into its box). Documented in the interaction model.

The one thing worth knowing: **ending the run on arrow-*out* is not enough.** `ArrowLeft` inside a row
never leaves it, so it never reaches `navigateFromTextEdit`, and the stale column survived to hijack
the next `ArrowDown` — driving it is what caught that (Down → Left → Down landed on the old column).
The rule is now the standard one, in `RichTextInput`: every key except a vertical arrow (bare
modifiers excepted) invalidates the column, plus `mouseup` inside the field, since a click on a
contentEditable is an "interactive target" the row's own mousedown deliberately ignores.

Driven: Down holds the column; Down-then-Up returns to the same x in the same row; Down → Left → Down
follows the new column; Down → type → Down follows the typed column.

### ~~The rich-text toolbar covers the row above it~~ — **DONE (2026-07-16)**

`Math.max(4, rect.top - 34)` is gone. The toolbar now measures against the nearest scrolling ancestor
(`scrollClipRect`): it sits above the row, **flips below** when the pane has no room above, clamps
into the pane, and **unmounts when its row scrolls out of the pane** instead of hovering at `top: 4`
over the tab strip.

Driven: mid row → above, inside pane; row flush with the pane's top edge → below, inside pane; row
scrolled out → gone.

It still overlaps the row above when it sits above one — that is what a floating format bar does, and
it is why it hides and flips rather than pinning. If the overlap itself is the complaint, the fix is
a reserved gutter, not more placement math.

**Trap worth knowing before you "fix" the toolbar again**: it positions itself from
`requestAnimationFrame`, which **Chromium suspends in an occluded window** — and a CDP-driven
Electron window is occluded (`document.visibilityState === "hidden"`). The toolbar then never renders
at all and looks stone dead, with no error. It is fine; you just cannot see it. Its `resize`/`scroll`
listeners still fire, so `window.dispatchEvent(new Event('resize'))` forces a re-measure and the
toolbar appears. Everything else in this file drives fine while hidden — this is the one thing that
does not.

### Blur with the chooser open is a stuck state — **NOT DONE: handing to the slash-command agent**

The bug is real and the description is accurate. I am not fixing it, because it is not the committed
row: it is the `InsertRow` slot's state machine, whose routing this file already assigns to
`2026-07-16-002`. Both obvious fixes are wrong in ways that only show up from inside that machine:

- **`onDismissChooser()`** sets `chooserDismissed: true`, which is sticky and *means something* —
  "I know what I'm typing", a statement about the line. Blur would make that claim on the author's
  behalf, and the candidates would then stay gone when they click back in and keep typing. Trading a
  stuck menu for a menu that never returns is not a fix.
- **`onDiscardSlot()`** throws away text the author typed, on an incidental click. Worse,
  `discardInsertSlot` already interlocks with *this exact blur handler* through `slotDiscardedRef`
  (`focusRoot()` blurs the slot synchronously, and the blur's job is to commit prose) — calling it
  from blur is the re-entrancy that ref exists to guard.

A third option neither of us listed may be the right one: keep the slot and its text, close only the
menu, and do **not** set `chooserDismissed` — i.e. blur is not a statement about the line, so the
candidates come back when the author returns and types. That needs a `chooser`-only reset the machine
does not currently expose, which is why it belongs to whoever owns the machine.

### ~~`aria-multiline="false"` on a field that wraps~~ — **reported but wrong; leave it alone**

`aria-multiline` is about whether the textbox *accepts* multiple lines of input — whether `Enter`
inserts a newline — not whether the text wraps visually. This field always `preventDefault`s `Enter`
and never inserts `\n` (rule 3: rows are the line model), so it accepts exactly one line. `"false"`
is correct. Setting it to `"true"` would announce to a screen-reader user that `Enter` starts a new
line inside the field; it starts a new *row* instead. That is a worse lie than the wrap.

### ~~Row actions are keyboard-unreachable~~ — **DONE (2026-07-16)**, discoverability only

`RowActions` now shows on the **active row** as well as on hover, and each button's `title` names its
shortcut — rendered through `formatKeybinding` against the real binding (`shift+enter`, `delete`)
rather than spelled out, so the hint cannot drift from the key. Driven: inactive rows stay
`opacity: 0 / pointer-events: none`; the active row is `opacity: 1 / pointer-events: auto`; titles
read "Insert a blank row after this one (⇧Enter)" / "Delete this row (Delete)".

They stay `tabIndex={-1}` **deliberately**, which is the part the original note had backwards: `Tab`
indents the row (rule 3), so it is not a focus-traversal key in this editor and these buttons must not
swallow it. "Reachable from the keyboard" here means the shortcut, and the shortcut is now on screen
whenever the row is active — which is what makes it discoverable. `Alt+Arrow` is untouched.

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
node project/app/cdp.js --target workspace reload      # after EVERY edit — see below
```

If the workspace is blank with `ERR_FILE_NOT_FOUND`, you raced the `rimraf`; `yarn build:apps:dev`
then reload, or launch `node project/app/dev-electron.js --cdp --cdp-port=9222` directly. `yarn dev`
also `rimraf`s `dist` out from under any instance already running — check `lsof -iTCP:5588` first.

Drive with **real input**: `Input.dispatchMouseEvent` (press/release, `clickCount` 1 then 2), not
`el.click()` — the browser only word-selects on a *trusted* double-click, which is the whole gesture.
(`Input` is not enable-able; `cdp.enable('Input')` throws.)

Four ways this rig will lie to you, each of which reads exactly like a real bug. All four cost me an
hour on 2026-07-16:

1. **The page is not the bundle.** `grep`ing `dist/` proves the build landed, not that the window
   loaded it. `reload` after every edit — the goal column "did nothing" for three test runs purely
   because the page was stale.
2. **rAF is suspended.** A CDP-driven window is occluded (`document.visibilityState === "hidden"`), so
   anything positioning itself from `requestAnimationFrame` never renders and throws no error. See the
   toolbar section. `Page.bringToFront` does not help.
3. **`getBoundingClientRect()` reports clipped rows anyway.** A row behind the Console panel or
   scrolled out of the pane still has a plausible rect; clicks there hit `<html>` and every probe
   reads "no selection". Gate on `elementFromPoint(x, y).closest('[data-story-row-text]') === el`.
4. **The restored session may open with a modal up** (a "Build for distribution" dialog did), which
   eats every click. Screenshot before believing dead input.

Test projects live in `/Users/nomen/Documents/dev/test/` (`demo2` has 3 scenes / 23 blocks). **Leave
them as you found them** — undo your rows, and note that a confirm dialog's buttons are `Cancel`/`OK`,
not `Delete`.

Tests to keep green: `richText.test.ts`, `speakerCandidates.test.ts`, `storySceneBlockUtils.test.ts`,
`storyEditorSessionStore.test.ts`. They stay green through every bug in this file, which is the point:
jsdom implements neither `user-select`, native selection, nor caret geometry, so **not one line of the
mouse model or the goal column is testable there.** Green means you have not regressed the parsing —
it never means the row works.

You are not alone in this checkout. Another agent is committing to `develop` with `git add -A` and
will sweep your uncommitted files into its own commit under an unrelated message. Work vanishing from
`git status` almost certainly means it was committed by someone else — check
`git show HEAD:<file> | grep <marker>` before redoing it.
