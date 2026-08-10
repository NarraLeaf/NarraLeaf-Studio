# The blueprint editor in a window of its own

A blueprint is read against something else — the surface it drives, the story
row that fires it, the widget it belongs to. In one window that means switching
tabs and losing the other half of the comparison. The blueprint editor can now
be popped out into its own window: the pop-out control on its title row, or a
middle click anywhere along that row. The tab closes when it goes.

## The decision: one renderer, two windows

**A detached editor is NOT a second renderer.** The workspace opens a blank
same-origin popup with `window.open("")` and portals part of its own React tree
into it (`DetachedWindow` in `lib/components/layout`). The editor over there is
the same React tree, inside the same providers, on the same
`WorkspaceContext` — one service graph, one in-memory document, one undo stack,
one autosave.

The alternative — a real second window loading a workspace entry — was rejected
on correctness, not effort. Every renderer service holds its own copy of the
documents it owns and writes them back on a debounce. Two renderers on one
project is two copies of `editor/ui-graphs.json` overwriting each other's saves,
silently, whenever the author touches both. That is also why the main process
refuses any popup that is not blank (`detachedWindowGuard`): the moment the
window loads a URL of its own it becomes exactly that second renderer.

Verified live end to end: editing, the add-node menu, Escape, Delete and
Cmd+Z all act on the same document from the detached window, and an undo issued
there restores a node deleted there.

## What that costs, and what pays it

Code inside the portal still runs in the workspace's realm, so its bare
`document` is the workspace's document, not the one it is drawn in. Two
consequences had to be paid for:

**Portals and listeners.** A dropdown portalled to `document.body`, an Escape
listener on `document`, a menu measured against `window.innerHeight` — all of
them would land in the window the author is not looking at. `hostWindow.tsx`
adds one context; `useHostWindow()` / `useHostDocument()` fall back to the
renderer's own window, so every existing caller is unchanged, and the overlay
host is now keyed by document. Converted: `Modal`, `ContextMenu`, `Select`,
`BlueprintAddNodeMenu`, `BlueprintJsonValueControl`.

**Keys.** Studio's keybinding service and React Flow's key handling both listen
on the document their module was loaded in. `forwardKeyEvents` re-dispatches the
popup's key events into the opener's document, and does not while the popup's
focus is in a text field — over there the opener would judge the key against ITS
focused element, find nothing being edited, and treat a Delete meant for a text
field as "delete the selected nodes".

## Window chrome

A detached window is **frameless**, like every other Studio window, and the
editor's own title row is its title bar: it carries `titlebar-drag`, reserves the
macOS traffic lights the same 90px `TitleBar` does, and off macOS draws the
minimise / maximise / close buttons itself (`detachedTitleBar.tsx`). It drops the
help trigger — F1 answers into the help panel, a dock panel of the workspace
window, so the answer would appear in the window the author is not looking at.

Those buttons cannot use the ordinary window-control IPC. Every call in it means
"the window that sent this", and a popup sends IPC through its opener, so close
would close the workspace. `appDetachedWindowControl` takes the window's key
instead, and the main process resolves it **among the children of the sender** —
which is also what stops one window from reaching another's.

The popup runs the preload too (Electron gives it the opener's webPreferences),
so the preload now refuses to expose anything to a blank child document. Its
privileged bootstrap bridge is revoked per module instance, and a popup gets a
fresh one; a same-origin opener can reach into it. Nothing is lost — the code
drawing that window calls IPC through the opener's bridge.

## Lifetime

- Chromium closes a popup with its opener window (`outlivesOpener: false`), and
  `closeWithOpenerDocument` closes it when the opener merely *navigates* — a hot
  reload, recovery mode, the workspace reload service. What survives a reload
  otherwise is a window full of DOM nobody owns any more.
- Detached editors are held in a module store (`apps/workspace/detached`), not in
  the editor layout: no group, no tab order, and nothing for the session file to
  restore into a popup it cannot re-parent. What they keep is the tab id, which
  is how view state keyed by tab id (graph viewport, member panel) survives the
  round trip, and the tab's own name, so it comes back under the name it left.
- Navigating to a detached blueprint (a diagnostic, a link from a widget) focuses
  that window rather than opening a second copy in the workspace.

## The close question

Closing the window either hands the editor back to the workspace as a tab or
ends it, per `editor.detachedEditorOnClose` (Settings ▸ 编辑器). Back to a tab by
default: popping out is a change of view, not a decision about the document, and
a view change that can strand work behind a closed window is one authors learn
not to use.
