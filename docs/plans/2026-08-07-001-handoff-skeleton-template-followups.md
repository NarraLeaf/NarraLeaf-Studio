# Handoff — finish the skeleton template

Hand this whole file to the next agent. It is written to be self-contained.

The template itself shipped. What is left is the tail: defects found and not fixed,
things never exercised at all, and whatever the project owner turns up playing it
by hand — **§3 is deliberately empty for that, and it is the part that matters
most.** Read §3 before planning anything: an owner-reported defect outranks
everything in §2.

---

## 0. What exists now

`resources/templates/skeleton/` on `develop` (`f4ccb97c`). A new author picking
**骨架 / Skeleton** on the wizard's first page gets a small visual novel that
already plays: three scenes reaching a branching choice, plus title, save, load,
config, backlog and quick-menu screens whose blueprints are wired to the engine.
39 content files, ~12 MB.

- **The source project is `D:/Temp/nls-skeleton`**, byte-identical to the shipped
  `content/`. Change the template by changing that project and re-syncing — never
  by editing the JSON under `resources/` by hand.
- Screens came from the `narraleaf.coffee` theme in the UI template store, imported
  through the store and then wired.
- Story: English source, full zh-CN translation (27 units). A fresh project runs in
  English; the translation is there to be read and switched.
- Characters: **Narra** (one preset pose, one sprite, one baked avatar) and **Aoi**
  (no sprite — she speaks, she is never on stage).

Design decisions that will look arbitrary unless you know why:

- **Save and Load are two surfaces, not one with a mode flag.** Two pages each
  doing one thing keeps every slot graph down to "refresh, then act", which matters
  for a template whose job is to be taken apart.
- **The title screen IS the main surface.** A game always boots into the surface
  whose id is `narraleaf-studio:main-surface`; that surface cannot be deleted and
  no other surface can take the id, so the imported title was moved onto it.
- **Controls that led nowhere were removed, not left dead.** The theme's `Extra`
  became `Back` on the three in-game screens and was deleted from the title; the
  config rail lost `Voice` and `Display` (no panes behind them); the save screen
  lost ten page tabs (nothing paged them).
- **`* -text` in `resources/templates/.gitattributes`.** `content/` is copied byte
  for byte over a new project, so what git hands back on checkout is literally what
  an author receives — line-ending normalisation would make that depend on their
  `core.autocrlf`.

## 1. Working practice — read before you touch anything

**Author through Studio's services, never by hand.** Every graph in that project
was built by reaching the workspace's service registry over CDP and calling the
same APIs the editor's own panels call. The memory `authoring-projects-through-services`
has the full recipe; the short version is: BFS the React fiber tree for
`memoizedProps.value.context.services`, then `svc.get("uiDocument" | "localBlueprint" |
"story" | "assets" | "character" | "localization" | "variableRegistry")`.

**The node catalogue is dumpable.** `svc.get("blueprintNodeCatalog").get(type)`
returns a node's exact pins. Grep every `BLUEPRINT_NODE_TYPE_* = "…"` out of
`src/shared/types/blueprint/graph.ts` and ask for each one — 440 nodes, one eval.
Do not read the 21k lines of node definitions, and do not trust the constant name:
`BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED` is `blueprint.game.getCps`.

**Traps that cost hours last round**, all still live:

- `Input.dispatchMouseEvent` takes CSS pixels; screenshots are device pixels and
  this machine runs devicePixelRatio **1.25**. Never read a click coordinate off a
  screenshot — query `getBoundingClientRect()` through `Runtime.evaluate`. A miss
  reads exactly like "the button has no handler".
- An element created from defaults renders **white**, and `props.fillVisible=false`
  does not stop it: what renders is `props.appearance.variants[0].propertyGroups`,
  whose default `backgroundColor` is `#ffffff`. Copy the whole `props` object off a
  container the theme already made transparent.
- **A widget only receives a click whose nearest `[data-ui-element-id]` ancestor is
  that widget** (`blueprintEventTargeting.ts`). Containers full of children need a
  transparent full-size catcher child to be clickable as a unit. This is why each
  save slot has a `Hit area`.
- `Set Element Display` cannot revive an element authored `visible: false` — it is
  not in the tree, so there is nothing to patch. Write `Set Element Property →
  visible` instead.
- **Editing anything under `src/shared/**` restarts Electron**, drops you at the
  launcher and invalidates every CDP target id.
- The scratchpad drivers from last round (`drive.js`, `lib_services.js`,
  `a_wire.js`, `dumpui.js`, `dumpbp.js`, `synctpl.js`, `nodecatalog.json`) live in a
  session temp directory and **will not survive**. `tools/ui-verify/` in the repo is
  the natural home for them; promoting the useful ones there is a reasonable first
  task, and `tools/ui-verify/file-dialog.ps1` (drives native file dialogs over
  Win32) is already there and still works.

**Hard constraints:**

- **Never run `git worktree remove`** without first breaking the `node_modules`
  junction from PowerShell (`[System.IO.Directory]::Delete($j, $false)`) and
  asserting `Test-Path` is false. This has emptied the shared `node_modules` seven
  times.
- **Never run `yarn install`** or `yarn <script>`. Call binaries by absolute path:
  `node D:/Dev/org/NarraLeaf/NarraLeaf-Studio/node_modules/typescript/bin/tsc
  --project src/<p>/tsconfig.json --noEmit`. `npx tsc` can silently resolve to a
  global TypeScript 6 that reports 0 errors on broken code. **Always `--noEmit`** —
  `shared` and `renderer` emit otherwise.
- On win32, 5–9 pre-existing vitest failures (build / signing / storage /
  runtimeProtocol) are baseline, not regressions.
- Work on a branch off `origin/develop` in your own worktree; merge back per the
  `session-branch-workflow` memory.

## 2. Known open, found by me, not fixed

Ordered by how much they cost a real author. **§3 outranks all of these.**

### 2.1 List rows are not addressable through the widget runtime

`scopedWidgetRuntimeKey` (`BlueprintHostApiBridge.ts:1532`) and its read-side twin
`useWidgetRuntimeElementKey` (`WidgetRuntimeStateContext.tsx:55`) both key on
`(runtimeScopeId ?? surfaceId, elementId)` with **no instance component**. Every row
of an `nl.list` shares one element id, so `Set Text`, `setVisible` and variant
overrides can only ever address the item template — the backlog drew its newest
entry four times over. The fix is threading `instanceKey` through both sides plus
~18 `scopedWidgetRuntimeKey` call sites.

Blueprint Value bindings *are* per-item (they carry `listItemScope` and
`instanceKey`), and that is what the template uses, so nothing is broken today. But
"a list row can be driven imperatively" is a reasonable thing for an author to
assume, and it silently is not true.

### 2.2 The avatar bake never re-runs after a crop change

`avatarBakeFingerprint` includes the crop, so a changed `setPosePortrait` *should*
invalidate the bake. It does not: the bake is a panel-open effect, and I could not
get it to fire again — toggling panels, switching panels, and reopening the project
all left `avatars.<pose>.baked` untouched. I worked around it by reverting the crop
to the one the PNG on disk was actually baked from, so the shipped project is
self-consistent. That means **Narra's avatar is framed slightly tight at the chin**,
and the better crop is not applied.

Consequence beyond this template: an author who reframes an avatar sees nothing
happen, with no error.

### 2.3 The screens' own text is not localized

The story is bilingual; the UI is not. Every label on the shipped screens —
`Start`, `Continue`, `Load`, `Config`, `Quit`, `Save`, `No Data`, `Auto`, `Skip`,
`Log` — is a hardcoded English string in a widget's props. A zh player gets Chinese
dialogue inside an English menu. `blueprint.localization.getText` exists and takes a
key, so the mechanism is there; nothing in the template uses it.

This is arguably the largest remaining gap in the template *as a demonstration*: it
ships a localization pipeline and then does not use it where a player would look
first.

### 2.4 Never exercised at all

Do not assume these work; nobody has looked.

- **Notification toasts.** The surface is wired and its item text is bound, but the
  story never raises a notification, so the screen has never rendered a real one.
- **Quick menu Auto and Skip.** Wired (`Get/Set Auto Forward` with a `Not`, and
  `Skip`); the navigation buttons beside them were verified, these two were not.
- **Preview and production builds.** Everything was verified in Dev Mode only. That
  is not a neutral gap: the value-binding defect fixed this round was
  *Dev-Mode-specific* (StrictMode), so dev and packaged genuinely diverge on this
  path. A real `Run ▸ Build` of a project made from the template is unproven.
- **Version control.** Projects were created with Lore enabled and never committed
  to or restored from.

### 2.5 Smaller things

- `washroom` ships in the asset library and no scene uses it. Either give it a scene
  or drop it.
- The two BGM files are 7.5 MB of the template's 12 MB. Another session is actively
  cutting installer size (`chore/build-size`, "stop shipping 280 MB of vendored
  binaries"); re-encoding these is easy volume.
- The intro→loop audio track feature is not used — both music files are the authors'
  own pre-cut loops, so plain looping is correct, but the template therefore does not
  demonstrate the feature.
- The config category rail highlights `Text` statically and the Log rail highlights
  `Back` statically. `nl.button` exposes no runtime colour command and the theme gave
  these buttons no appearance variants; an honest highlight needs a moving accent bar
  like the nav rail's.

---

## 3. Found by the project owner — fill this in

> Everything below this line is the owner's own hands-on testing. **Treat it as
> outranking §2**: it is measured against what the thing is actually for, and I only
> ever drove this over CDP.
>
> For each one, the useful shape is: what you did, what you expected, what happened.
> A screenshot path or a scene/screen name is usually enough to make it
> reproducible — I do not need a diagnosis, and a guess at the cause is more likely
> to send the next agent down the wrong path than to help.
>
> If a defect makes the template embarrassing to ship, say so — that changes the
> order of work, not just its content.

### 3.1

*(what you did — what you expected — what happened)*

### 3.2

### 3.3

### 3.4

### 3.5

---

## 4. Suggested order

Once §3 is filled in, that decides the order. Absent anything there, mine would be:

1. **§2.3 (localize the screens)** — it is the gap most visible to the audience the
   template exists for, and it is content work with no unknowns.
2. **§2.4 (build a project from the template for real)** — the largest unknown, and
   the one that could invalidate the claim that the template works.
3. **§2.2 (avatar re-bake)** — small, self-contained, and it silently wastes an
   author's time today.
4. **§2.1 (list row addressability)** — the deepest change, and nothing needs it yet.

## 5. Definition of done

1. Everything in §3 is either fixed or explicitly declined in writing, with a reason.
2. A project created from the template through the wizard plays start to finish on
   both branches, verified by driving the app — not by reading files.
3. It also **builds and runs as a packaged game**, not only in Dev Mode.
4. Four projects typecheck (`shared`, `main`, `renderer`, `runtime`), relevant vitest
   passes, `node scripts/style-ratchet.mjs` shows no increase.
5. `resources/templates/skeleton/content/` is byte-identical to `D:/Temp/nls-skeleton`
   (minus the excluded `.nlstudio/`, `.lore/`, `.loreignore`, `_import/`,
   `editor/cache/`, `*.nlproj`).
6. `CREDITS.md` still describes what actually ships.

## 6. Context worth reading first

Memories, in the order they will save you time:
`skeleton-project-template` (this deliverable), `authoring-projects-through-services`
(how to build any of it), `list-row-content-broken` (§2.1 and the defect behind it),
`isolated-worktree-testing` (read the body, not the index line),
`dev-app-cdp-drive`, `native-file-dialog-acceptance`, `session-branch-workflow`.

The brief this replaces: `docs/plans/2026-08-06-001-handoff-skeleton-project-template.md`.
