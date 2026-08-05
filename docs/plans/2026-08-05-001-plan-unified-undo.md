# Unified undo: one stack owner, and what still cannot be undone

Status: **stage 1 landed** (the mechanism). Stage 2 (the gaps below) not started.

## Why

Undo was five separate implementations of the same data structure:

| where | shape | limit | merge rule |
| --- | --- | --- | --- |
| `useStorySceneEditorController` | two `useRef` stacks of scene snapshots | 100 | none |
| `StoryMotionEditorTab` | two `useRef` stacks of timelines | 100 | 800 ms, hand-rolled |
| `AudioPreviewEditor` | `{past, present, future}` reducer | 100 | none |
| `UIEditorHistoryService` | `Map<surfaceId, {undo, redo}>` | 100 | `mergeKey` + 800 ms |
| `LocalBlueprintService` | `Map<blueprintId, {undo, redo}>` | 100 | `mergeKey` + 800 ms |

Three consequences, all of which the author could see:

1. **Nothing outside an editor could leave an undo step.** `storySceneUndoBridge` existed only so a
   script import could reach into a mounted tab's refs. Any other whole-document write from a panel
   or a palette command had the same problem and no equivalent workaround.
2. **Closing a tab silently emptied Ctrl+Z**, because the stack was React state.
3. **"Drop the stacks on reload" meant the two the reload service happened to import.** The three
   editor-owned stacks kept snapshots of pre-reload documents across a VCS restore, and one Ctrl+Z
   would write them back — the same loss as a stale auto-save, through a different door.

## What landed

`src/renderer/lib/workspace/services/history/`

- `historyModel.ts` — the entry shape and `HistoryStack`: limit, merge, redo invalidation. Pure, no
  services, no React.
- `HistoryService.ts` — every stack, keyed by scope; scope registry; freeze guard; active scope.
- `historyScopes.ts` — the scope-id constructors, so a stack is never named by a template literal at
  a call site.
- `useHistoryScope` (`apps/workspace/hooks`) — the editor-side binding.

### The entry

One shape, three constructors, so each of the five old mechanisms maps onto one without changing
what the author experiences:

- **checkpoint** — `before` captured on the way in; the "after" side is read live at the first undo.
  This is exactly what `recordHistory()` before a mutation always meant, and it is why un-recorded
  edits in between are not silently dropped from the redo side. Used by story scenes, story motion,
  audio markers.
- **snapshot** — both sides known at push time. Used by UI surfaces and blueprints, which already
  wrapped their mutations in a transaction.
- **command** — the entry carries its own inverse. Nothing uses it in production yet; it is what the
  entity-level gaps below need, because putting a deleted asset back is not a snapshot of one
  document.

Every entry carries a `HistoryLabel`, so a menu item or a toast can say *what* Ctrl+Z would reverse
instead of a bare "Undo" that may or may not do anything.

### Scopes

A scope is a stack plus the pair of functions that read and write the state it undoes. Entries
reference the scope **by id** and resolve those functions when they run, not when they were pushed.
Two things follow:

- a scene's stack outlives its tab — close it, reopen it, Ctrl+Z still works (bounded: the eight
  least-recently-touched unregistered scopes are kept, then evicted);
- an import can checkpoint a scene by *naming* it, with no tab involved, which is what deleted
  `storySceneUndoBridge`.

Undo against a scope with nothing registered returns `false` and leaves the stack alone. That is the
honest answer: applying the snapshot would write a document nothing is showing. The story-script
import dialog already surfaces this ("these scenes have no open editor, so this will not be
undoable"), and now reads it from `HistoryService.hasScope` rather than from a bridge registry.

### Scopes in use

| scope | covers |
| --- | --- |
| `story-scene:<storyId>:<sceneId>` | every block edit, scene metadata, in-scene declarations, paste, reorder, indent, row delete, script import |
| `story-motion:<animationId>` | the timeline |
| `audio-loop:<assetId>` | the in / loop / out markers |
| `ui-surface:<surfaceId>` | the surface's elements and its private blueprints |
| `blueprint:<blueprintId>` | the graph, element behaviours, **and the persistent-variable registry** |
| `project` | *reserved* — nothing pushes to it yet; see stage 2 |

Two stacks are deliberately **not** in `HistoryService`:

- **`RichTextHistory`** (one per story row). Intra-field, coalesces per burst of keystrokes, and
  `KeybindingService` suppresses `Mod+Z` inside editable fields on purpose — story undo works in
  whole blocks and would throw away the paragraph being typed. Different granularity, different
  dispatch, correctly separate.
- **Monaco** (one per open text asset). Owned by the editor component. See gap **T1** below.

---

## The audit

Every author-visible mutation, and whether Ctrl+Z reaches it. "Guard" is what stands between the
author and the loss today.

Severity:
**S1** destroys authored work that cannot be reconstructed from what is on screen ·
**S2** loses real work but it is visible and re-doable by hand ·
**S3** annoying · **S4** fine as is.

### S1 — destroys authored work, no undo

| # | Operation | Where | Guard | Note |
| --- | --- | --- | --- | --- |
| D1 | `deleteAsset` | assets panel | confirm + reference warning | **Hard `fs.deleteFile` / `deleteDir` — no trash.** References are left dangling *by design* (warn, do not block), so putting the record back would restore a working project — but the bytes are gone. |
| D2 | `deleteGroup(cascade)` | assets panel | confirm | Cascades into nested groups and every asset under them. Same hard delete, times N. |
| D3 | `deleteCharacter` | character panel | confirm | Drops the record **and** deletes the baked avatar file. Every story line holding the id becomes dangling. This is the case that prompted this work. |
| D4 | `deleteScene` | story panel | confirm | Destroys the whole scene and its blocks. Note the scene's own undo stack is scoped *to that scene*, so even a mounted editor cannot bring it back. |
| D5 | `deleteChapter` | story panel | confirm | **Cascades: deletes every scene in the chapter** (`StoryService.deleteChapter` splices the chapter and then `delete document.scenes[sceneId]` for each). Re-points the entry scene as a side effect. |
| D6 | `deleteStory` | story panel | confirm | The whole document. |
| D7 | `deleteAnimationAsset` | story motion panel | confirm | Destroys the timeline. Its editor's stack is keyed by the asset id, so it dies with it. |
| D8 | `replaceAssetContent` | asset context menu, properties pane | destructive confirm | Overwrites bytes in place, keeping the id. Nothing anywhere keeps the previous bytes. |

### S2 — loses real work, no undo

| # | Operation | Where | Note |
| --- | --- | --- | --- |
| C1 | `removeLayer` / `removeAxis` / `removeTag` / `removePose` / `removeSnapshot` | character editor | `removeAxis` cascades to every tag under it; `removeLayer` drops the layer's asset binding *and* all its per-tag options. Confirm dialog only. |
| C2 | PSD import into an existing appearance | character editor | Replaces the whole layer set in one go. |
| C3 | Every other `CharacterAppearance` setter (`setLayerAsset`, `setPosePortrait`, avatar crop, canvas size, all puppet fields) | character editor | No history at all in this editor. |
| C4 | `createCharacter` / `renameCharacter`, groups (`create`/`rename`/`delete`/`assign`) | character panel | — |
| V1 | `deleteSavedVariable` / `retype` / `setDefault` | story variables panel | Story-level, so **not** in any scene scope. Persistent variables *are* covered (blueprint scope); saved and scene variables edited from this panel are not. |
| L1 | `removeKey` | localization table | Removes the key and every translation of it. |
| L2 | CSV `applyImportedRows` | localization panel | Bulk-overwrites translations with no checkpoint. The story-script import got one; this import did not. |
| A1 | `deleteTrack` / `reparentTrack` / `moveTrack` | project ▸ audio | Deleting a bus does not rewrite what pointed at it. |
| U1 | Delete / create / rename a UI surface | UI surfaces panel | The `ui-surface` scope covers edits *within* a surface; deleting the surface is outside every scope. |
| U2 | Delete a component definition | component library panel | Same shape. |
| B1 | Delete a blueprint or a binding from the member tree | blueprint editor | Edits *inside* a blueprint are covered; deleting the blueprint targets a scope that is then dead. |
| S1 | Scene snapshots: create / rename / delete / set value | story snapshots panel | Stored on the scene, but written through story-level calls that bypass the scene scope. |
| Vo1 | `removeLocale`, take assignment (`updateUnit`) | voice panel | — |

### S3 — annoying, no undo

`renameAsset`, `updateAssetTags`, `updateAssetDescription`, `moveAssetToGroup`,
`moveGroupToParent`, `duplicateGroup`, asset reorder · `renameStory` / `renameChapter` /
`renameScene` / `moveChapter` / `moveScene` / `setEntryScene` / `setDefaultStory` · project icon
master replacement (re-bakes the derived set) · plugin enable / disable / uninstall.

### S4 — fine

Project configuration (lint rules, mobile / security / network, build targets): all visible and
re-settable in the pane that changed them. Localization **`removeLocale`** belongs here too — the
translations stay on disk and come back when the language is re-added, which the confirm dialog
says.

### Gaps in the mechanism itself

| # | | |
| --- | --- | --- |
| **T1** | **An open text-asset editor does not participate in the workspace reload pass.** `TextEditor` only re-reads the file when the *encoding* is changed (`setReload` has exactly one caller); nothing enrols it in `WorkspaceReloadService`, whose only external participants today are plugin stores. So after a VCS restore the tab still holds the pre-restore buffer *and* its Monaco undo stack, and a save writes it back over the restored file. This is the same defect this work fixed for the five snapshot stacks, in the one stack that is not in `HistoryService`. Confidence: read from source, not reproduced in the app. |
| **T2** | **The Edit menu's Undo / Redo are Electron's `role: "undo"` / `role: "redo"`.** They act on the DOM selection, so in the story editor, the UI editor, the blueprint editor and the motion editor the menu item does nothing. `HistoryService.setActiveScope` now exists and `useHistoryScope` sets it, so wiring the menu is small — the remaining question is only whether the menu should also be labelled with `peekUndo()`. |
| **T3** | **`setActiveScope` is last-mount-wins.** With two story tabs open in a split, the scope-less undo path points at whichever mounted last. Nothing depends on it today (every keybinding passes an explicit scope), but T2 would make it load-bearing; the fix is for the tab, which knows `active`, to drive activation rather than the controller. |

---

## Stage 2, in the order the dependencies fall

1. **`project` scope + a delete-with-inverse pattern.** The scope exists and is empty. The pattern
   the S1 rows need is a **command** entry: capture what is about to be destroyed, delete, and let
   `undo` put it back through the same service calls the author would have used.
2. **Make deletion recoverable before making it undoable.** D1/D2/D3 hard-delete files. Either the
   delete moves the payload to a per-project trash under `.nlstudio/` (which is already excluded
   from the repository) and the command entry moves it back, or the command entry holds the bytes
   in memory — bounded by the history limit, which for a 200 MB video asset is not acceptable. The
   trash is the answer; picking its retention policy is a product decision, not a technical one.
3. **D3 (character) before D1 (asset)**, despite the user framing them together: a character is a
   record plus one small baked avatar file, so it needs the trash mechanism only for the avatar, and
   its cascade (dangling ids in story lines) is *already* the accepted behaviour for assets — so
   undo does not have to reason about references at all. It is the cheapest real proof of the
   pattern.
4. **D4/D5/D6 (story structure)** are pure document edits with no files behind them, so they need
   only step 1. D5's cascade is the interesting one: the entry needs to restore the chapter, its
   scenes, and the entry-scene pointer it re-pointed.
5. **C1–C4 (character editor)** wants a scope of its own (`character:<id>`), not the project scope —
   these are edits *within* a document the author has open, which is what a scope is for.
6. **T1** is independent of all of the above and should not wait for them.
