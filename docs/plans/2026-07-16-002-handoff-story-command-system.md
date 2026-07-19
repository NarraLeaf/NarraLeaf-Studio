The story editor's inline editing + action model has landed. Your slash-command system
(`docs/plans/2026-07-16-001-feat-story-command-system.md`) builds on top of it. Read
`docs/story-editor-interaction-model.md` first — it is the contract. Below is what you must
respect, and where your plan is now out of date.

## The four rules you inherit — do not renegotiate these

1. **Escape is one exit ladder, one rung per press. It never commits, never destroys.**
   Rung 1 dismisses candidates and keeps the text; rung 2 discards the slot. Leaving an *edit* saves
   (through history, so Mod+Z works); leaving an *uncommitted slot* creates nothing. The old code
   committed `/set` as a line of narration on Escape — do not reintroduce any path where a cancel
   produces a block.

2. **The highlight is Enter's pointer.** Wherever a candidate is highlighted, **Tab and Enter both
   take it** — identical on purpose. Where nothing is highlighted, Enter commits the line.

   This resolves the conflict in your plan's §4.0.1 ("Tab 永远是补全，永不提交. Enter 永远是提交").
   The user overrode it. The binding rule is now:

   > **Must-pick positions default-highlight; optional-next-step positions do not.**

   Command name and speaker name **must** default-highlight the first row. The `k=` parameter
   position **must not** — show the candidates (they are the discovery affordance) but select
   nothing, so Enter there submits the command instead of grabbing `t=`. Without this,
   `/bg forest_day` + Enter can never submit without an extra Escape. This is the single decision
   most likely to be lost. Do not "fix" it into consistency.

3. **Enter advances between rows. Tab advances within a row.** Your "Tab jumps to the next
   parameter" is exactly right and is the reason Tab exists here. Enter, once nothing is
   highlighted, ends the row.

4. **Shift+Enter always ends the line and opens a blank one.** On a `#` line it lands as an invalid
   row (there is no dialogue to keep). Elsewhere it resolves the line. `Mod+Enter` is **removed** —
   do not bring it back; it duplicated Shift+Enter.

## What already exists — use it, don't rebuild it

- `EditorMode.insert` carries **`chooserDismissed`**. The chooser is derived from the `value` prefix,
  so without this flag the menu springs back on the next keystroke after Escape. Verified live. Keep
  it when you restate the slot as a pure function of text+caret (your §4.1) — it is *not* derivable
  from the text.
- **`resolveActionCommandToken(line)`** in `storyActionCommands.ts` is the seam left for you. It
  matches only the first token today (`/note`, `//`). Replace it with your parser; keep the contract:
  *resolves → commit that command; does not resolve → invalid row.*
- **`kind: "invalid"`** (`StoryInvalidPayload { source }`) is the landing place for your "解析失败变为
  无效行" (§2.2 "解析失败不落库" — this is how). Preview skips it with an `error` diagnostic; the
  **build** refuses via `collectInvalidBlocks` in `BuildService.start`. Note: the story compiler runs
  inside the game at startup, **not** at build time — do not try to gate the build from the compiler.
- **Speakers**: `dialogue.speakerName` (bare name) XOR `characterId`. `getSpeakerCandidates()` and
  `collectTempSpeakers()` already exist and are tested.

## The trick you must not flatten

The speaker picker **always appends the typed name as a candidate**, so the list is never empty.
That is deliberate: it deletes "nothing matched" as a state with its own rules, which is what lets
Tab and Enter mean one thing. Your grammar's `{kind:"character"}` param must inherit this — an
unknown name is a valid value, not a validation error. Do the same for any param type where a
free-typed value is legal.

Corollary for your §4.4 error table: "未知值" only applies to types where the value must resolve
(assets, scenes, variables). It must **not** apply to speaker names.

## Corrections to your plan

- **§4.0.1 is superseded** by rule 2 above. Tab and Enter are the same key on a highlight.
- **§4.0.3** ("Esc 一次退出命令模式，文本原样变旁白") is **wrong now**. Escape rung 1 dismisses
  candidates; a `/`-prefixed line then resolves or becomes an **invalid row** — it does not become
  narration. The user accepted the consequence: *narration cannot start with `/`*. Don't re-add an
  escape hatch for it.
- **Tab category cycling is gone** (`moveCategory` deleted). Tab is yours for parameters. The
  category chips remain mouse-only.
- **§3.6 / `actionCommandMatchesQuery`**: the `/`-prefix branch still matches aliases exclusively, so
  typing `/image` in the *sidebar* search returns nothing. Still yours to fix.
- **§5 "InsertRow 三段式"**: the key routing in `InsertRow` is now correct and verified against the
  running app. When you rewrite the rendering, **port the routing rather than re-deriving it**.

## One bug to fix on the way in: Mod+Z is broken inside a row

Do this before or alongside your work — you are rewriting this editor's input layer, so it is yours,
and it is a data-loss bug that survived the whole interaction pass.

**Symptom:** insert a pause chip (or apply a mark, or insert a value) in a row, then press `Mod+Z`.
The text you typed in that row cannot be undone by anything.

**Why — two causes, both required:**

1. `renderRunsToElement` (`richText.ts:268`) starts with `root.textContent = ""`. Every rich-text
   operation re-renders the row this way, which **destroys Chromium's native contentEditable undo
   stack**. Callers: `spliceUnits`, `applyMark`, pause-value edits in `RichTextInput`.
2. Story-level undo is suppressed inside editable fields — `KeybindingService.ts:248`
   (`inEditableField && !keybinding.allowInEditable`). So the app's own `Mod+Z` never fires either.

Neither stack is reachable. `RichTextInput` has no undo handling of its own.

**Do not "fix" it by setting `allowInEditable: true` on the undo binding.** That makes `Mod+Z` inside
a row undo whole *blocks* — the author loses the paragraph they were typing instead of the last
keystroke. Strictly worse.

**The shape of the real fix:** the editor owns an undo history at the **runs** level.
`RichTextInput` keeps a stack of `StoryRichRun[]` snapshots, pushes on each mutation (coalescing
plain typing into one entry — per word or per idle-pause, not per keystroke), and binds `Mod+Z` /
`Mod+Shift+Z` itself. When the row's stack is exhausted, fall through to story history. This also
survives your rewrite, since runs are the model regardless of how the slot renders.

Sanity-check the fix by *driving the app* (see Ground truth): type text → insert a pause → `Mod+Z`
→ the pause should go, then the text, in that order, and nothing outside the row should move.

## Ground truth

- `docs/story-editor-interaction-model.md` — the contract.
- Tests you must keep green: `speakerCandidates.test.ts`, `resolveActionCommandToken.test.ts`,
  `storyModel.test.ts` (invalid blocks + temp speakers), `storyCompiler.integration.test.ts`
  (temp-speaker identity).
- Verify by driving the app, not by running tests: `yarn dev` then `node project/app/cdp.js`
  (port 9222). Running it is how the `#Zoe` → dialogue-body-says-"Zoe" bug was caught; the unit
  tests were all green.
