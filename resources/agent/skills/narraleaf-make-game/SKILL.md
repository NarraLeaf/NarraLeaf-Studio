---
name: narraleaf-make-game
description: Make a complete, playable visual novel (VN, galgame, AVG) in NarraLeaf Studio through its MCP server - brief, project, assets, characters, branching story, restyled interface, verification and a built game. Use when the user wants to create, adapt, port or finish a visual novel in NarraLeaf Studio, hands over a script and art to turn into a game, or when the narraleaf-studio MCP tools (agent_status, story_apply, ui_patch ...) are available.
---

# Make a visual novel in NarraLeaf Studio

You are driving NarraLeaf Studio, a desktop visual-novel editor, through its MCP server. The author
has Studio open and **watches every edit land live**: each write is one undo step in Studio, and the
author can pause you from the status bar at any time. Your job is to take the author from an idea
(or a finished script and a folder of art) to a game that builds and plays end to end.

This file is the order of work. Detail lives in the reference chapters; read a chapter before the
step that needs it, not all at once.

| Chapter | Read it before | File | Also served as |
|---|---|---|---|
| Workflow | starting a game (this file) | `SKILL.md` | `agent_guide {chapter:"workflow"}` |
| Story format | writing any scene | `references/story-format.md` | `agent_guide {chapter:"story-format"}` |
| Interface format | reading or writing a page | `references/ui-format.md` | `agent_guide {chapter:"ui-format"}` |
| Interface design | restyling the interface | `references/ui-design.md` | `agent_guide {chapter:"ui-design"}` |
| Blueprint format | wiring any behaviour | `references/blueprint-format.md` | `agent_guide {chapter:"blueprint-format"}` |
| Script adaptation | turning a script into scenes, or writing prose | `references/script-adaptation.md` | `agent_guide {chapter:"script-adaptation"}` |
| Verify and ship | lint, tests, playtest, build | `references/verify-and-ship.md` | `agent_guide {chapter:"verify-and-ship"}` |
| Troubleshooting | after any refusal you do not understand | `references/troubleshooting.md` | `agent_guide {chapter:"troubleshooting"}` |
| Brief template | step 1 | `assets/brief-template.md` | (copy it into the chat) |

The same chapters are MCP resources at `narraleaf://guide/<chapter>`. If you cannot open the files,
call `agent_guide`.

## Ground rules

1. **Tools are named exactly** - `agent_status`, `story_apply`, `ui_patch` and so on. Every tool
   description says when to use it; read them.
2. **Never guess a name, a prop, a command or a node.** The catalogue tools answer from the code
   Studio runs, so they are always current and this guide may not be: `story_commands` /
   `story_command`, `story_targets`, `ui_widgets` / `ui_widget`, `ui_usage`, `blueprint_nodes` /
   `blueprint_node`. Ask before you write something for the first time.
3. **Read, edit, write.** Every page and scene is changed by reading it (`story_show`, `ui_show`,
   `blueprint_show`), editing that text, and writing it back with the `revision` the read returned as
   `baseRevision`. A `stale_revision` refusal means the author changed it meanwhile: read it again and
   redo your edit on the new text. Never re-send your old text.
4. **Small visible steps.** One scene per `story_apply`, one pass over one page per `ui_patch`.
   The author is watching; a whole game in one call is a wall nobody can follow or undo sensibly.
5. **Dry-run when unsure.** `story_apply`, `ui_apply`, `ui_patch` and `blueprint_apply` take
   `dryRun: true`, which checks and writes nothing.
6. **The author's words are the author's.** Keep a supplied script verbatim. Write or polish prose
   only where the author asked for it, following `script-adaptation`.
7. **A refusal is an answer.** It carries a `code`, a message and often a `hint` saying what to do.
   Act on it; look the code up in `troubleshooting` if it is not obvious. Do not retry the same call
   unchanged.
8. **Say what you are about to do** in the chat before each step below, and what you did after it.

## Step 0 - Connect

Call `agent_status`. It reports the open projects, whether write access is on, whether you are
paused, and the directories you may import files from.

- **No answer at all / tools missing** - the MCP server is not connected. Tell the author: open
  NarraLeaf Studio, *Settings -> Agent access*, switch on agent access, copy the configuration for
  their agent, and reconnect (the README next to this skill folder has every agent's recipe).
- **Writes off** - tell the author: *Settings -> Agent access -> allow agents to make changes*.
- **Paused** - the author paused you from the status bar. Wait for them to resume.
- **Import directories** - if the author's art lives outside the listed directories, ask them to add
  that folder under *Settings -> Agent access* (or to copy the files into the project folder).
- **No project open** - fine for a new game (step 2). For an existing one, ask for its folder.

Name Studio's controls in the author's language. In Chinese Studio the settings section is
*设置 → 智能体接入* (switches 允许智能体连接 / 允许智能体修改工程), and the same switches are in the
menu bar's *智能体* menu; in Japanese, *設定 → エージェント連携*.

Checkpoint: you know whether you can write, which project is open, and where assets may come from.

## Step 1 - Brief

Agree on what is being made before touching the project. Paste `assets/brief-template.md` into the
chat and fill it in with the author; ask only what you cannot infer. Minimum: title, game text
language, resolution (default 1920x1080), art style and palette mood, characters, number and kind
of endings, which assets exist.

If the author hands you **a script and assets**, inventory them before writing anything (read
`script-adaptation`):

- scenes in order, and where the script branches and rejoins;
- every speaker (including one-off ones like "???" or "Clerk"), merged where one person has
  several labels;
- every background, sprite (by character and expression), CG, music cue, sound effect, video;
- a **name map**: script label -> asset file -> story-friendly asset name (`bg_classroom_day`,
  `aoi_smile`, `bgm_theme`). Flag every script reference with no file, and every file the script
  never uses.

Show the author the inventory and the gaps. Agree which gaps get placeholders.

Checkpoint: a filled brief and, for a supplied script, an inventory and name map the author accepted.

## Step 2 - Project

- **New game:** `project_create` with `name`, `language` (the game text language, e.g. `zh-CN`,
  `en`, `ja`), `width`/`height`, and `template: "skeleton"`. `dir` is the **parent** folder; the
  project folder is created inside it, named after an ASCII slug of the name (`末班车` ->
  `mo-ban-che`) - the result gives the full path. The game carries `language` only; add
  `languages: ["en"]` (or later `project_settings_set {languages}`) only for languages the author
  wants translated. The skeleton is a small working game: splash, title, dialogue box, choice menu,
  quick menu, save/load, settings, backlog, extras, and a three-scene demo story - all wired. You
  restyle and refill it; you do not build those screens from nothing.
- **Existing game:** `project_open` with its folder.
- Name, resolution or languages wrong? `project_settings_set` - now, before the interface work:
  changing the resolution later does not rescale pages already built. `languages` is the full list
  (source language included); a language holding translations goes only when `removeLanguages`
  names it.

Then `project_info` (resolution, languages, entry page and scene, counts) and `story_list`,
`characters_list`, `variables_list`, `assets_list`, `ui_surfaces` to learn what is there. **The
skeleton's content is named in the project's language**, so never hard-code the English names below
- find each by listing (`story_list`, `characters_list`, `variables_list`, `blueprint_list`,
`ui_surfaces`). In an English skeleton: scenes *The corridor* (entry), *The clubroom*, *Last light*;
characters *Narra* (with a sprite) and *Aoi*; variables *Honest* (saved) and *Location* (persistent -
the save screen shows it, keep it); asset folders *Backgrounds*, *Characters*, *Music*, *UI sounds*;
UI sounds `ui-confirm`, `ui-hover`, `ui-back` that the buttons use (keep them). In a Chinese one the
scenes are 走廊 / 社团活动室 / 最后的光, the variables 真心 / 地点, and so on.

**Reuse the skeleton's demo content** instead of piling new beside it: rename the story
(`story_rename`; the skeleton's is *Skeleton* / 骨架), rename and rewrite the demo scenes - clearing
their own opening picture and music (step 5) - re-cast the demo characters (`character_upsert` with
their `id`), rename or re-type the demo variables (`variable_upsert` with their `id`). What you do not
reuse, delete once nothing refers to it: `scene_delete`, `character_delete`, `variable_delete`,
`asset_delete` (the demo pictures and music lint lists as `assets/unused`) refuse while something
still does and list what. Pages are not deleted - hide what the game does not need.

Checkpoint: the project is open in Studio and you have its overview.

## Step 3 - Assets

1. `assets_import` the author's files with `names` chosen from your name map and a `folder` per kind
   (`Backgrounds`, `Sprites`, `CG`, `Music`, `SFX`, `Video`). Paths must be absolute and inside an
   allowed directory.
2. Formats: images PNG/JPEG/WebP/GIF/AVIF/SVG; audio MP3/OGG/Opus/WAV/M4A/AAC/FLAC; video WebM or
   MP4 (H.264); fonts TTF/OTF/WOFF/WOFF2. AVI, WMV, FLV, MPEG, TS, TIFF and AIFF are refused; HEVC
   MP4, ProRes MOV and Theora OGV import but play sound over a black picture. Tell the author which
   files need converting rather than importing broken ones.
3. **Sprites need a transparent background** - an opaque one shows as a rectangle. `assets_import`
   and `character_upsert` return `warnings` for an opaque sprite; ask the author for a cut-out, and
   list it on the hand-over if none comes. A sprite is drawn at its own pixel size times its
   character's entrance `zoom`, centred where the `/show` row places it; the character's
   `entranceTransform` sets zoom and baseline (step 4). For 1920x1080, standing sprites about
   900-1080 px tall and 500-900 wide.
4. For each missing asset, `assets_placeholder` with a clear `caption` ("BG: rooftop at dusk") and a
   colour that fits the palette; backgrounds at the project resolution, sprites around 600x950.
   **Tell the author every placeholder you made**; they go on the hand-over list.
5. `assets_list` to confirm the names a story line will use. Story lines name assets **by name**;
   interface props name them **by id** (both are in the listing).

Checkpoint: every asset in the name map exists in the project under its agreed name.

## Step 4 - Cast and variables

- `character_upsert` per character: `name` exactly as the script's speaker label, `nicknames` for
  the other labels the script uses, `nameColor`, `poses` (`[{name:"smile", asset:"aoi_smile"}]`) and
  `defaultPose`. Pose names are what `/show Aoi smile` and `/char Aoi sad` say, so keep them short
  and consistent across characters (`normal`, `smile`, `sad`, `angry`, `surprised`).
- Reuse the skeleton's characters for your first two: `characters_list`, then `character_upsert`
  with their `id` and your name and poses. A reused character keeps the entrance tuned for the demo
  sprite (zoom 0.624): pass `entranceTransform: "standing"` with the new poses. A new character
  given poses gets a standing entrance by itself - feet on the bottom edge, at its own pixel size
  (art taller than the stage is scaled to fit). `characters_list` shows each one's `drawnAtCenter`
  box; the lower third of a full-height sprite behind the dialogue band is normal VN framing.
- A speaker with no sprite still deserves a character (name colour, backlog, voice later). Truly
  one-off speakers may stay plain `Name: text` lines.
- `variable_upsert` for every flag, counter and route switch the story needs: `saved` for anything
  belonging to one playthrough (affection, choices made), `persistent` for anything that survives
  across saves (endings seen, unlocks). Name them as a script would (`trust_aoi`, `took_the_key`).
  Turn a demo variable into one of yours with `variable_upsert {id, name, valueType, description}`
  (a retype warns with every row whose value no longer fits - rewrite those); `variable_delete` the
  rest (it refuses, listing users, while anything still reads it).

Checkpoint: `story_targets` lists every speaker, asset and variable the script will name.

## Step 5 - Story

Read `story-format` first. Then, for each scene in order:

1. **Have a scene.** First scenes: `scene_rename` the skeleton's demo scenes (that keeps the title
   screen's Start button, which names the first scene by id, pointing at your opening; it returns
   the scene's new revision). Further scenes: `scene_create {name, chapter, after}`.
2. `story_show {scene}` - note the `revision`.
3. Write the scene as a `.story` document: keep the `#nlstory`/`#story`/`#scene` header that
   `story_show` printed, replace the body with your rows. The header's `#background` / `#music` are
   the scene's own opening picture and music: a reused demo scene has the demo's (`#background
   classroom`) - write `#background none` and `#music none` (or your own), or it flashes before your
   first `/bg`; a header without them keeps them. Open the scene with its stage: `/bg`, then `/show`
   each character present, then `/bgm` if the music changes. Every scene starts with an empty stage.
4. `story_apply {source, baseRevision}` (add `dryRun: true` the first time you use an unfamiliar
   command). One scene per call. Fix every error the check reports; nothing was written if it failed.
5. If a name fails to resolve, `story_targets {query}` shows what does resolve. Do not invent a
   one-off speaker by misspelling a character.

Branching: `/menu` with `- option` lines (each option's rows indented under it), `/if` with
`? condition` / `? else` branches, `/set` `/inc` to change variables, `/jump 'Scene name'` to move
between scenes. Every route ends in an `/ending Name` row (unique names) - that is what the endings
test and the extras screen count. Put shared material in shared scenes and jump to it rather than
duplicating it.

Never put `/bg` inside an `/if` branch or a menu option - the game crashes at start. Change the
picture with `/show <image> name=...` / `/swap` there instead (`story-format` has the pattern).

When every scene is written: `scene_set_entry` on the opening scene, then find the title's Start
button blueprint - `ui_show` the title page and read the `# blueprint: <name>` after the Start
button (its name is in the project's language), then `blueprint_show` that name - and check its
Start Game node's `sceneId` is your opening scene's id (`story_list` shows ids); fix it with
`blueprint_apply` if not.

Checkpoint: `story_list` shows every scene; each applies cleanly; every route reaches an `/ending`.

## Step 6 - Interface

Read `ui-design` and `ui-format` first. **Restyle the skeleton; do not rebuild it.** Its screens are
wired to save, load, settings and backlog logic that a rebuilt page would lose.

1. **Palette first.** `brand_get`, then `brand_set` with colours for the art style (background,
   panel, primary/accent, foreground text, muted text, borders) and the game's font if the author
   supplied one (import it in step 3). Interface props refer to palette entries as `nlbrand:<id>`, so
   this one call restyles every screen at once. Screenshot the title and dialogue box after it.
2. **Then page by page**, in this order: Title, Dialogue, Choice, Quick menu, Save, Load, Config,
   Log, Splash, Extra, Confirm. For each page, three passes, each one `ui_show` -> `ui_patch` (with
   `baseRevision`) -> `ui_screenshot`:
   - **layout** - positions and sizes, safe margins, alignment to a grid;
   - **style** - fills, borders, type sizes, the title's key art and game title text;
   - **interaction** - hover and pressed looks (appearance rows), sounds, focus order.
3. After every screenshot, write a short self-critique in the chat against this checklist, and fix
   before moving on:
   - [ ] text contrast at least 4.5:1 (3:1 for text 24 px and larger) against what is behind it;
   - [ ] nothing overflows, clips or overlaps; the longest real line fits the dialogue box;
   - [ ] edges line up; spacing is consistent; content stays inside the safe margins (about 5% of
     the screen on every side);
   - [ ] the same control looks the same on every page;
   - [ ] every button has a visible hover and pressed state;
   - [ ] it looks like a visual novel, not a web dashboard (`ui-design` explains).
4. `ui_usage {type}` shows how the skeleton itself uses a widget, in pasteable `.ui` text - the
   fastest way to get a new element right. `ui_templates` / `ui_template_apply` add a ready-made set
   of pages from Studio's template store when the author prefers one; restyle it the same way.
5. When the author says "this" or "the selected one", `ui_selection` tells you what they selected.

Checkpoint: every page screenshot passes the checklist, and the title shows the game's title and art.

## Step 7 - Interaction

The skeleton already does starting, continuing, saving, loading, settings, backlog, skip, auto and
quitting. Write blueprints **only for behaviour it lacks** - a new button, a page of your own, an
unlock. Read `blueprint-format`, then:

1. `ui_surfaces {query}` for the owner ids (surface and element), `blueprint_list` /
   `blueprint_show` for what already hangs there.
2. `blueprint_nodes {query}` to find nodes, `blueprint_node {type}` for a node's pins before using it.
3. `blueprint_apply {source}` (try `dryRun: true` first). A block replaces every graph of its owner,
   so start from `blueprint_show` when the owner already has one.

Prefer settings to blueprints where one exists: a button's click and hover sounds are its
`clickSound` / `hoverSound` props, not a graph.

Checkpoint: every new control does what it says, checked in step 8.

## Step 8 - Verify

Read `verify-and-ship`. In short:

1. `lint` until there are **zero errors**; read the warnings and fix the ones that are yours.
2. `test {id:"narraleaf-studio:route-coverage"}` (every scene reachable) and
   `test {id:"narraleaf-studio:reachable-endings"}` (every ending reachable).
3. Play it: `playtest_start {scene}` at the opening and at each route's key moments,
   `playtest_advance {steps}` / `{choice}` (1-based, top option is 1) through them. One step = one
   line; rows without a line are not steps; when it returns, the line it names is on screen, whole.
   At an ending it names the ending and the page the game went to (title or ending page) - the run is
   done. `playtest_screenshot` at every new background, character entrance, menu, last line and
   ending. Look at each image: right picture, sprite size and position, text readable and inside the
   box, choice menu legible.
4. `console_read {level:"error"}` after each run for runtime errors; fix the row or graph named.
5. `playtest_stop` when done.

Checkpoint: lint has no errors, both tests pass, every route was played to its ending, the console
is clean.

## Step 9 - Ship

`build {target:"current"}` (or the platform the author asked for). Then report to the author:

- what was made: scenes, routes and endings, characters, pages restyled, behaviour added;
- **every placeholder asset still in the game** and what it stands for;
- anything left for them to do in Studio (leftover demo content, gallery entries, files to convert,
  untranslated languages, the app icon and signing);
- the file to open (the build result's `artifacts`), and that they can keep editing in Studio and
  ask you for more.

## Working while the author watches

- The author sees each edit arrive and Studio follows you to the page or scene you change. Keep each
  call to one scene or one page pass so what arrives is readable and one Ctrl+Z undoes one thing.
- Before a big step (writing a whole route, restyling the interface, building), say what you are
  going to do and roughly how many edits it takes.
- If the author edits something you were working on, you get `stale_revision`: re-read, merge your
  intent into their version, write again. Their edit wins over your plan.
- If the author undoes one of your edits, treat that as a "no": ask before doing it again.
- `paused` means stop. Summarise where you are so you can resume cleanly.
- Never touch files in the project folder directly; everything goes through the tools, so the author
  can see and undo it.
