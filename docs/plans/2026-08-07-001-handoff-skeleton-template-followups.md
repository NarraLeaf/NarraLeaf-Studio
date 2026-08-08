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

**All of the below were reported by the owner on 2026-08-07 and are fixed on
`ui/skeleton-polish`.** Each entry records what turned out to be behind it, because in four
of the nine cases the cause was not what the symptom suggested.

### 3.1 The character sits too high — the art runs out before the frame does

Narra's sprite is bottom-anchored full-body, but the PNG stops above the knee, so the cut edge
was visible. All three `character enter` rows now carry `yoffset: -50`. **The sign is not a
typo**: NLR's y origin is the bottom edge (`PositionUtils.D2PositionToCSS` maps y to `bottom`),
so down is negative. The cut now sits behind the dialogue band.

### 3.2 Scene changes should fade

They were `dissolve` 600ms and read as a cut, because a scene mounts with its own
`defaultBackgroundAssetId` and a dissolve from an image to *itself* is invisible.

**The transition belongs on the `jump` row, not on the next scene's `setBackground`.**
`StoryJumpPayload.transition` compiles to `Scene.jumpTo(target, transition)`, and the engine runs
it as `_transitionToScene(transition, targetScene.background)` on the **outgoing** scene, before
unmount — so it is a genuine fade out and back in. A transition on the incoming scene's
`setBackground` can never be that: by the time it runs, that scene has already mounted with its own
background.

Now: both jump rows carry `throughColor` 800ms through `#000`. The entry scene has no jump into
it, so its opening `setBackground` keeps `throughColor` as the game's fade-up; the other two scenes'
opening `setBackground` went back to `dissolve` (invisible, and a second fade there would stutter).
Verified frame by frame: 170ms into the jump the corridor is at near-black, 340ms in the clubroom
has emerged.

**Known cosmetic residual:** the character sprite does not dim with the background, because the
transition targets the scene's background image and a sprite is a separate displayable. Corridor
and Clubroom would look better with a `character exit` before their jump — Last light already has
one. Not done: it changes the staging, which is the owner's call.

### 3.3 Page switches lag, and the config controls lie

Two unrelated things.

**The lag was never asset loading.** Frame-cadence sampling: fonts ready at 0.7ms, images already
decoded. The prepaint gate nonetheless waited *two* animation frames, and on a busy page each of
those is 100ms+. It now waits the second one only when the asset waits actually deferred
(`PREPAINT_ASSET_WAIT_SIGNIFICANT_MS`), and images get their own short budget instead of the 900ms
font budget. Click → page visible went **302ms → 143ms** on the worst page.

**Where the remaining ~140ms goes**, from a devtools timeline trace across one Title → Config
switch (`disabled-by-default-devtools.timeline`):

| | |
|---|---|
| click → navigation state updated | **3.4ms** (blueprint graph + `Go Page` are not the cost) |
| one React render + commit | **97ms** |
| style + layout + paint, whole 700ms window | **~20ms total** (`Layout` 5.3ms across 3 events) |
| one animation frame before reveal | 9ms (Title) – 38ms (Config) |

So it is React, not the browser and not I/O. An earlier read of this as "layout and paint" came
from a sampling profile whose `(program)` bucket I took for browser work; the trace says otherwise.

**And it is the cross-fade that makes it expensive.** Mount cost by target: Title (10 widgets)
62–65ms, Config (61) 88–98ms, Load (66) 92ms. But the *same Config page* opened from inside the
game — where the page underneath is hidden, so only one layer is in the tree — costs **62–70ms**.
Keeping both pages mounted so they can dissolve is roughly a third of the bill. Each authored
widget expands to ~5 DOM nodes, most of them animated `motion` components.

That leaves three honest options, none free: keep the dissolve and the cost, go back to
`exitBlocking: true` (out-then-in, one layer at a time, no cross-fade), or make widgets cheaper to
mount. Tuning the prepaint gate further buys nothing — it is already down to one frame.

**The controls were static props, not state.** The theme baked "selected" into `All text` and
`On` as flat props, so the pair read as a label. All six selectable buttons (`Text`/`Sound`,
`All text`/`Read only`, `On`/`Off`) now carry `default` + `selected` appearance variants, every
click repaints its whole group through `Set Element Variant`, and three `Surface Init` heads seed
the initial state from the live values (`Get Skip Read Text`, `Get Fullscreen`). **Note the
redesign:** `nl.button` cannot drive its text colour from a variant (`color` is not a
`ButtonAppearancePropertyKey`), so the old solid-gold-slab-with-dark-text look could not survive
being toggled. Selection is carried by fill + border with one ink colour per group.

### 3.4 The title screen has no background

It had one all along — `Key art` was assigned `room-warm` and shipped with `fillVisible: false`,
which `RectangleChromeRenderer` renders at `opacity: 0`. Flipped on at `fillOpacity: 0.3` so the
title and the menu still read over it.

### 3.5 In-game overlays cover the stage completely

Surfaces opened over a running game now composite their background at
`GAME_OVERLAY_BACKGROUND_ALPHA`, applied only when the nav entry's presentation is `gameOverlay`.
Needed three changes, not one: the animation layer's colour, the design-size layer underneath it
(which repainted the authored colour opaque), and the pages' own full-bleed containers — whose
`appearance` model overrode the flat `fillVisible: false` and put the sheet back.

Shipped at **0.85**. 0.5 was tried first and the owner rejected it: the stage competed with the
page's own labels and the screens became hard to read. At 0.85 the scene is a reminder that it is
still there, not a view of it.

### 3.6 Subtle motion on key buttons

The five title buttons take a gold `effectTextShadow` halo and 8px of travel on hover, tweened
over 160ms. Glyph glow rather than box glow, because those buttons have no chrome to light up.

### 3.7 The dialogue does not always advance where you click

Not the click host, and not `Sentence` or the nametag — those already bubble. The **notification
slot** was eating it: its toast list is a 440×400 box pinned to the top right of the stage,
present whether or not a notification exists. NarraLeaf's own wrapper is `pointer-events: none`,
but every widget wrapper sets it back to `auto`, so an ancestor could not switch it off. Hit-test
mapping showed a dead rectangle at roughly (1010–1290, 240–480) CSS px. The slot is now rendered
`passive` (`SurfacePassiveContext`), and the same map comes back with no dead zone at all.

### 3.8 Surfaces should dissolve

Every app surface was `pageAnimation: none/none`. Now `fade`/`fade` at 0.22s with
`exitBlocking: false`, which is what puts both layers on screen at once — a true cross-dissolve
rather than out-then-in. This is also what makes the residual mount cost tolerable: the outgoing
page starts fading immediately, so a click is never silent.

### 3.9 Loading a save renders nothing (`app://fs/…` 404)

The headline defect, and a Studio bug rather than a template one. `app://fs/{token}` is a
**capability grant, not a content address**: `StorageManager.allocateHash` mints
`crypto.randomBytes(32)` per read and holds it in an in-memory `Map` that Dev Mode scopes to its
window. The compiler bakes that URL into `Image` state, the engine serializes `state.currentSrc`
verbatim, and `deserialize` puts the dead token back over the fresh compile — so every stage image
in any save older than the current window 404s. The packaged runtime never had this, because it
mints `nlr://asset/{assetId}`.

Fixed in `StorageManager.stabilizeSessionRead`: the Dev Mode resolver re-keys each grant to a
token derived from `(resolved path, size, mtime)`, so the same file yields the same URL in every
run. Including the bytes' identity is what keeps the handler's `max-age=3600` honest — a replaced
asset mints a different token instead of serving a stale cache. Verified by writing a save,
**restarting Studio completely**, and loading it: background, sprite, nametag and line all come
back, and the log has no `Hash not found`.

⚠ **Saves written before this fix cannot be recovered.** The stale tokens carry no information
about what they pointed at — no asset id, no path — so there is nothing to remap. The owner's
repro slot (`D:\tmp\skeleton`, dev slot 1) stays broken; delete it.

---

## 4. Suggested order

§3 is done. What remains, in the order I would take it:

1. **§2.3 (localize the screens)** — still the gap most visible to the audience the
   template exists for, and it is content work with no unknowns.
2. **§2.4 (build a project from the template for real)** — the largest unknown, and
   the one that could invalidate the claim that the template works. Note that §3's round
   was again Dev-Mode-only.
3. **Save screenshots are 1.2 MB each.** `liveGame.capturePng()` returns the frame at full
   resolution and Studio stores the data URI whole, so six filled slots is ~7 MB of save data and a
   Load screen that decodes 7 MB of PNG. Downscaling before storing is the obvious fix and would
   also take the remaining edge off §3.3.
4. **§2.2 (avatar re-bake)** — small, self-contained, and it silently wastes an
   author's time today.
5. **§2.1 (list row addressability)** — the deepest change, and nothing needs it yet.

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
