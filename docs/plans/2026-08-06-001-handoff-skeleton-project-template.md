# Handoff — build the bundled skeleton project template

Hand this whole file to the next agent. It is written to be self-contained.

---

## What you are building

A **project template** named `skeleton`: the thing a new author gets when they
pick it on the first page of the project wizard. It must be a *small but complete
visual novel* — not a folder of stubs. Someone who creates it, presses Run, and
plays for two minutes should see every basic feature of the engine working, and
then be able to open any part of it and understand how it was done.

Concretely it needs:

- **A few-line story.** Three or four scenes, enough to reach a choice and see the
  choice change what follows. Two characters at most. It is a demo, not a novel —
  but the writing should read like a real game's opening, not `test line 1`.
- **The screens**, taken from the `narraleaf.coffee` theme in the UI template
  store (see below) and then **wired**: the title screen's Start actually starts,
  Load actually opens the load screen, the save grid actually saves and loads, the
  config sliders actually move volume and text speed, the quick menu's Auto / Skip
  / Log actually do those things.
- **Blueprints connected.** This is the part that distinguishes this task from
  what has already been done. The shipped templates are pure layout — every one of
  them has `blueprints=0`. Your job includes connecting them.
- **Assets**: backgrounds, a character sprite, BGM and UI sound, all prepared for
  you (below).

## The decisive constraint: author it in Studio, do not hand-write it

A real project's `editor/ui/uidoc.json` runs to thousands of lines, its asset
metadata is sharded across files keyed by content hash, and its story documents,
blueprints and variable registry all reference each other by id. **Do not try to
write those files by hand.** The pipeline is built to take a real project:

1. Create a normal project in Studio (a running dev instance — see *Driving the
   app*), somewhere outside the repo, e.g. `D:/Temp/nls-skeleton`.
2. Build the game inside it: import the assets, write the story, add the screens
   from the template store, wire the blueprints, play it in Dev Mode until it
   works.
3. Copy that project's content into
   `resources/templates/skeleton/content/`, and write
   `resources/templates/skeleton/template.json` beside it.

That is the whole delivery. The copying is verbatim and already handled — see
below.

## The pipeline you are plugging into (already built and tested)

`src/main/app/application/managers/projectTemplates.ts` — reads
`resources/templates/*/template.json`, and `scaffoldProjectFromTemplate` copies a
template's `content/` tree over a freshly written project. Covered by
`projectTemplates.test.ts` (7 tests). Things already decided:

- **Copy is verbatim.** Ids inside an authored project reference each other across
  every file format Studio has; anything that rewrote them on the way in would
  have to parse them all. Two projects made from one template share those ids and
  never meet.
- **`*.nlproj` is never copied** — it would rename the author's project. The
  wizard writes that file itself from the name / app id / resolution they typed.
- **It runs after the skeleton is written and before version control is enabled**,
  so the project's first revision is the project they actually received.
- **A template id that would read outside `resources/templates` is refused** twice,
  by pattern and by resolved path.

`template.json` shape (`ProjectTemplateDescriptor` in
`src/shared/types/projectTemplate.ts`):

```json
{
  "name": "Skeleton",
  "description": "A small, complete visual novel to read and take apart.",
  "version": "1.0.0",
  "designSize": { "width": 1920, "height": 1080 },
  "locales": { "zh": { "name": "骨架", "description": "一个可以直接跑、可以拆开看的小型视觉小说" } }
}
```

Wording lives in the manifest, not in `src/shared/i18n`, because a template is
content: it is added by dropping a directory into `resources/`, and a template
added after a release cannot add keys to the app's catalogs.

The wizard already merges bundled templates into its first page and sets
`contentTemplateId`; `ProjectService.createProject` already calls the scaffold.
**You should not need to change any of that** — if you do, something is wrong,
say so rather than working around it.

## Assets, prepared and licence-checked

`D:/Dev/org/NarraLeaf/demo-assets/` — read its `CREDITS.md` first.

| | |
|---|---|
| `bg/classroom.jpg`, `bg/corridor.jpg`, `bg/washroom.jpg`, `bg/room-warm.png` | CC0 anime school backgrounds |
| `audio/bgm-daily-loop.ogg`, `audio/bgm-quiet-loop.ogg` | CC0, already the authors' loop cuts — feed them to the intro→loop audio track |
| `audio/ui-sfx.zip` | CC0, 51 clips; unzip and pick two or three, do not ship all of them |
| `narra.png` | **Narra**, NarraLeaf's mascot, 1289×1620 |

**About Narra:** she is upper-body only, and the project owner intends to replace
her with a full-body sprite. Set her up so that swapping the file is a one-place
change. She is centred on the *head*, so a stage placement that centres the image
horizontally will look right.

Everything here is redistributable — bundling into the installer *is*
redistribution, which is why several otherwise-free packs were rejected (the
reasons are in `CREDITS.md`, so nobody researches them twice).

## Where the screens come from

The store now browses **themes**, then the screens inside one. Take the
`narraleaf.coffee` theme (`https://github.com/NarraLeaf/UI-Templates`): title,
save/load, config, backlog, dialogue, choice, notification, quick menu, and a
component library of nine pieces.

Add them through the store in the UI panel (**Start from a template**) rather than
copying files — that exercises the import path and gives you correctly re-idded
surfaces.

**They arrive as layout only.** Wiring them is your work, and it is the substance
of this task.

## Wiring: the engine already has everything you need

Blueprint node types (`src/shared/types/blueprint/graph.ts`):

- **Save/load** — `GAME_SAVE_LIST_IDS`, `GAME_SAVE_GET_METADATA`,
  `GAME_SAVE_GET_PREVIEW` (the slot thumbnail), `GAME_SAVE_WRITE`,
  `GAME_SAVE_LOAD`, `GAME_SAVE_DELETE`, plus `GAME_AUTO_SAVE_*`
- **Config** — `GAME_GET/SET_SENTENCE_SPEED`, `GAME_SET_AUTO_FORWARD`,
  `GAME_SET_SKIP_READ_TEXT` (the "read only" half of Skip),
  `GAME_GET/SET_{GLOBAL,BGM,SOUND,VOICE,TRACK}_VOLUME`, `APP_SET_FULLSCREEN`
- **Quick menu** — `GAME_SKIP`, `GAME_SET_AUTO_FORWARD`,
  `GAME_TOGGLE_DIALOG_DISPLAY`, `GAME_IS_IN_GAME`
- **Backlog** — `GAME_HISTORY_GET`, `GAME_HISTORY_RESTORE`
- **Navigation** — `PAGE_GO`, `PAGE_QUIT`, `FRAME_WIDGET_SET_PAGE`
- **Story** — `GAME_START_STORY`, `GAME_NEXT`, `GAME_CHOOSE`

A judgement call that is yours to make and worth making deliberately: the config
screen's category rail can switch panes either by toggling sibling containers'
visibility inside one surface, or with `nl.frame` embedding one surface per
category. Cross-surface frame references survive import correctly (fixed and
tested this round), so both work. Pick one and say why in the commit.

## Traps that will cost you an hour each

- **`nl.dialog.nametag` does not exist.** It is not a registered widget module and
  the insert palette has a test asserting its absence. A nametag is a plain
  `nl.text`, fed by a value binding on `GAME_GET_NAMETAG`.
- **All four list widgets take their item template as their `childrenIds`**, and
  share one `ListWidgetProps` shape. There is no `itemElementId` prop — I invented
  one in an earlier pass and it silently rendered a single non-repeating row.
- **`nl.image` with no asset draws a white rectangle**, because it renders through
  `RectangleChromeRenderer` and the default `backgroundColor` is `#ffffff`. Give
  every image a fill.
- **`nl.list` is one-dimensional** — `repeatDirection` is horizontal or vertical,
  it does not wrap. A grid is laid out explicitly, or is a vertical list whose item
  template is a horizontal row.
- **`StoryScene` identity never changes** — `StoryService` mutates documents in
  place, so a `useMemo(..., [scene])` misses updates. See the
  `story-scene-identity-never-changes` memory.
- **Do not run `yarn install` or `yarn <script>` in a worktree**, and call
  binaries by absolute path (`node <repo>/node_modules/typescript/bin/tsc`). The
  `isolated-worktree-testing` memory explains why; read it fully before creating a
  worktree, especially the deletion sequence.

## Driving the app

`docs`-adjacent memories `dev-app-cdp-drive` and `cdp-screenshot-stale-frame`
cover this. The short version:

```
NLS_DEV_RELOAD_PORT=<free> node project/app/dev-electron.js --cdp --cdp-port=<free> --disable-features=CalculateNativeWinOcclusion
```

**Before trusting any screenshot, run a marker test**: inject a fixed full-viewport
magenta div and confirm it appears in the capture. CDP screenshots return stale
frames that look exactly like successful captures — identical byte sizes across
runs are the tell. Evaluate-and-capture over a single connection
(`scratchpad/drive.js` from this session) rather than two processes.

For layout iteration that does not need the app, `scratchpad/render_template.py`
rasterizes a `UIDocument` straight to PNG — approximate, but a far faster loop.

## Definition of done

1. `resources/templates/skeleton/{template.json,content/}` exists and the wizard
   offers a Skeleton card.
2. Creating a project from it produces a project that **opens, plays and reaches
   its choice**, verified by actually running it — not by inspecting files.
3. Save, load, config, backlog and the quick menu all do what they say.
4. `CREDITS.md` travels with the shipped assets.
5. Four projects typecheck (`shared`, `main`, `renderer`, `runtime`), relevant
   vitest passes, `node scripts/style-ratchet.mjs` shows no increase.
6. On win32, five pre-existing test failures are baseline, not yours:
   build / signing / storage / runtimeProtocol. See the `windows-test-baseline`
   memory before reporting them as regressions.

Work on a branch off `origin/develop` in your own worktree, and merge back per the
`session-branch-workflow` memory.

## Open question for the owner, not for you to decide alone

The skeleton ships an upper-body Narra. Whether the demo's staging should be
written around a half-body sprite (bust framing, closer camera) or around the
full-body sprite that is coming later is a product call. Ask before building the
scene composition around one of them.
