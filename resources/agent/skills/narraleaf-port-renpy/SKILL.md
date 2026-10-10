---
name: narraleaf-port-renpy
description: Port a finished Ren'Py visual novel, with its source, into NarraLeaf Studio through Studio's MCP server at the highest fidelity - story, characters and sprites, backgrounds, audio, voice, video, variables and endings, gallery, and an interface traced from the running Ren'Py game. Use when the user has a Ren'Py project (a game/ folder with .rpy scripts) and wants it in NarraLeaf Studio, or asks to convert, migrate or port a Ren'Py game.
---

# Port a Ren'Py game to NarraLeaf Studio

You are moving a finished Ren'Py game into NarraLeaf Studio. Studio is open on the author's machine
and you drive it through its MCP server; every write lands live and is one undo step. This skill is
the porting method. It sits on top of **`narraleaf-make-game`**, which explains the tools, the text
formats and the order of work for any game - read its `SKILL.md` first (or `agent_guide
{chapter:"workflow"}`), and read its chapters when a step below sends you there.

| Chapter | Read it before | File |
|---|---|---|
| Statement mapping | writing the converter | `references/statement-mapping.md` |
| Positions and ATL | placing anything on the stage | `references/positions-and-atl.md` |
| Assets and media | importing | `references/assets-and-media.md` |
| Interface | rebuilding any screen | `references/interface.md` |
| Capture script | taking reference screenshots | `assets/zz_capture.rpy` |

## What "done" means

The ported game plays from the first line to every ending, looks like the Ren'Py game on every
screen the player can reach, and builds. Fidelity is judged against the **running Ren'Py game**, not
against your reading of its code: run it (step 7) and compare screenshots.

## Ground rules

1. **Never modify the Ren'Py source.** Read it in place; anything you change (a capture script, a
   converted file) goes in a copy or your own working folder.
2. **Write a converter, do not hand-port.** A real game is thousands of lines. Parse the scripts into
   an intermediate representation (IR) once, then generate `.story` text per scene from it. When a
   mapping turns out wrong you fix the converter and regenerate, instead of editing hundreds of rows.
   Keep it deterministic: the same source gives the same output.
3. **Keep two files from the first minute** in your working folder and update them after every step:
   - `port-log.md` - the plan, the phase you are in, counts of what is done, every mapping decision
     and why, how to regenerate each part, and "Needs the author" items. A long port outlives one
     context window; this is how you (or a successor) resume.
   - `issues.md` - every problem: the tool and arguments, the exact error text, what you expected,
     the workaround, severity. The author uses it to improve Studio; do not soften it.
4. **Measure, do not assume.** Before mapping a whole category (positions, transitions, video),
   try one case in a scratch scene and look at it with `playtest_screenshot`. Delete the scratch
   scene at the end.
5. **Keep big outputs out of your context.** Write tool results to files and read the parts you
   need; send big payloads from files.

## Step 0 - Access and the project

- `agent_status`. Writes must be on. Call `request_folder_access` once for the Ren'Py `game` folder
  and your working folder (converted media lands there), with a one-line reason. "Pending" means the
  author has not answered yet: carry on with work that needs no import and retry every minute.
- **The project.** Start from a project made from the **skeleton** template: its pages are already
  wired to saving, loading, settings and the backlog, and you restyle them to look like the Ren'Py
  screens. If the author already opened a project made from the empty template, run
  `ui_install_standard_screens {dryRun:true}`, show the author what it adds, then run it. Do not
  rebuild save, load or settings logic by hand from store templates - they are layouts only.
- Resolution: read `gui.init(w, h)` (or `config.screen_width/height`). Set the project to the same
  size with `project_settings_set` so every pixel value carries over unchanged.

## Step 1 - Survey

Read, in this order, and write the facts into `port-log.md`:

1. `options.rpy` (name, version, window/menu config, `config.*`), `gui.rpy` (every `gui.*` value),
   `screens.rpy` and any other file that defines `screen` blocks.
2. Every `image` statement and the image folders (Ren'Py also defines images automatically from file
   names under `images/`). Note: plain files, `Movie(play=..., mask=...)`, `im.*` / `Transform`
   matrix effects, `LayeredImage`, `ConditionSwitch`, `DynamicDisplayable`.
3. `define` / `default` / `persistent.*` - characters, variables, saved vs persistent state.
4. `transform` definitions (ATL) and how often each is used.
5. The scripts: labels and the flow between them (`jump`, `call`, `menu`), endings (what each final
   label does - credits, a movie, `return`), `python` blocks and what they do.
6. `audio/`, `voice` statements and their folders, `tl/` (a folder with only Ren'Py's own strings
   is not a game translation), achievements (`achievement.grant`, Steam), the gallery / music room /
   replay screens.
7. Missing files: Ren'Py games often reference images that do not exist (dead code paths). List them
   and do not invent them.

**Source availability.** `.rpy` files are what you parse. A shipped game may contain only `.rpyc`
(compiled) or `.rpa` archives; those must be unpacked/decompiled first (e.g. unrpa, unrpyc) - only
with the author's rights to the game, and say so in the log.

## Step 2 - Mapping plan

Decide, and write down with reasons (`references/statement-mapping.md` has the defaults):

- **Scenes.** One Studio scene per Ren'Py label that is a unit of story; split very long labels at
  `scene` statements (never inside a `menu`) and chain the parts with `/jump`. A scene of a few
  hundred rows is comfortable to review and to re-apply.
- **Characters.** Studio characters are people. Ren'Py often defines several `Character` objects for
  one person (different sprite tags, a narrator style, a "???" before the name is known): merge by
  display name, and turn "???" into a name change rather than a second character.
- **Stage objects.** A Ren'Py *tag* is one Studio stage object. Standing sprites of the cast become
  character poses; everything else shown with `show` (CGs, overlays, chibis, effects) becomes an
  image object that `/swap` changes.
- **Text styles.** Narrator modes such as an NVL-like full-screen box or white-on-black captions
  become separate dialogue looks the story switches between (see `references/interface.md`).

## Step 3 - Assets

`references/assets-and-media.md` lists every conversion. In short: import what Studio plays as is,
convert the rest offline into your working folder (AVI/OGV/Theora video, masked movies, matrix
colour effects, mis-named files), keep a name → asset-id map from the import results, and remember
that byte-identical files are imported once (the second name points at the first asset).

## Step 4 - Characters and sprites

- Resolve sprites **the way Ren'Py does**, not by looking a name up in a table. `show eileen happy`
  keeps attributes the tag already shows unless they conflict; the image chosen is the one whose
  attributes include all requested ones, then share the most with what was showing. Implement this
  choice (`references/statement-mapping.md` → "Image attributes") in the converter and walk the
  script with a stage model, or a large share of `show` statements resolve to the wrong picture.
- Flattened full-body images per expression → one preset character with a pose per image. Part
  images (base, eyes, mouth) or a PSD → a layered character (`narraleaf-make-game` chapter
  *layered sprites*).
- Set each character's entrance so that `/show <name> <pose>` lands where Ren'Py's default position
  puts the sprite (`references/positions-and-atl.md` → "Sprites"). Verify one with a screenshot.
- Name colours, name-box styles and per-character text styles come from the `Character(...)`
  arguments.

## Step 5 - Variables

`default x = v` → a saved variable; `persistent.x` → a persistent variable; `define` constants
inline. Booleans and numbers map directly; Python objects need a decision (log it).

## Step 6 - Story

Generate `.story` per scene from the IR and send each with `story_apply` (dry run first). Map with
`references/statement-mapping.md`. After each scene: `story_show` it back and check the row count and
that nothing came back as an opaque `»` row you did not expect. Then:

- **Voice.** There is no voice command in `.story`; link takes after the text is written:
  `voice_settings_set`, then `voice_list` and `voice_link` by line id (match on scene + line order
  from your IR, not by file name guessing). **Once voice is linked, do not re-apply a regenerated
  scene file** - new rows get new ids and the links go. Edit through `story_show` → `story_apply`
  instead, which keeps anchors.
- **Menus and flags.** Port conditions on menu options and the variables they set exactly; the
  endings depend on them.
- **Endings.** Mark each final label's end with `/ending` and name the endings (the achievement or
  the credits title usually gives the name).

## Step 7 - Interface: trace the running game

Working the layout out from `screens.rpy` alone is unreliable (nested boxes, style inheritance,
`gui.*` indirection). **Run the Ren'Py game and screenshot every screen**, then rebuild each one in
Studio against the picture. The full method, the capture script and the Ren'Py layout rules for the
parts you still compute are in `references/interface.md`. Per screen:

1. Capture it in Ren'Py at the project's resolution.
2. Write the element table (rectangles, fonts, colours, states) in your working folder.
3. Build or restyle the Studio page / game UI, using the game's own images for frames and buttons.
4. `ui_screenshot` it and compare side by side; then check it **in the running game**
   (`playtest_screenshot`), because the editor render and the game can differ.

## Step 8 - Behaviour

Wire what the Ren'Py screens do with blueprints (`narraleaf-make-game` chapter *blueprint format*):
navigation, confirm prompts, preferences, the gallery's locks, quick-menu actions. Test buttons with
`playtest_click` / `playtest_key`, not by reading the graph.

## Step 9 - Gallery, replay, achievements, extras

- Gallery: entries from the Ren'Py gallery definition; unlock with the same condition (a persistent
  "seen" flag set where the CG first shows).
- Achievements: if the project has an achievements plugin, wire unlocks at the same points; otherwise
  keep a note row at each grant and list them under "Needs the author".

## Step 10 - Verify and hand over

`narraleaf-make-game` chapter *verify and ship*, plus:

- `lint` with `rule` filters to read past the unused-asset noise; before deleting anything lint
  calls unused, confirm with `asset_usage` that nothing uses it.
- `test` reachable-endings and route-coverage; then playtest every ending from its menu.
- Compare a handful of story moments (a line with a sprite change, a menu, a CG, a caption mode)
  Ren'Py vs Studio, screenshot against screenshot.
- Hand over: coverage numbers (scenes, lines, characters, poses, assets by type, screens, voice
  lines, gallery entries, endings), what was not ported and why, the visible differences that remain,
  "Needs the author", and the paths to `port-log.md` and `issues.md`.
