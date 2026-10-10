# Verify and ship

A clean `story_apply` says the rows are well formed. It does not say the game plays well. Verify in
four layers, cheapest first, and do not build until all four are clean.

## 1. Lint

`lint` runs every project rule (story, interface, blueprints, assets, variables, localization…) and
returns findings, errors first. `lint {severity:"error"}` shows only errors.

- **Fix every error.** A build refuses a project with lint errors.
- Read every warning; fix the ones your work caused. Common ones and what they mean:

| Finding | Meaning | Action |
|---|---|---|
| `story/stage-object-missing` (error) | A row acts on something not brought on in its scene | Add the `/show`, or write `name=` on the `/show <asset>` |
| `story/declared-never-shown` | A picture created but never revealed | `/show <name>` it, or remove the `/image` row |
| `story/stage-object-duplicate` | The same name created twice in a scene | `/swap` the existing one |
| `story/background-unchanged` | A `/bg` repeats the picture already on screen | Drop the row or its transition |
| `story/ending-name-duplicate` | Two endings share a name | Rename one |
| dead end / unreachable scene | A scene with no way out, or none in | Add the `/jump` or `/ending`; jump to it from somewhere |
| `assets/unused` | An asset nothing uses | Expected for the skeleton's demo images; list for the author |
| `variables/unused` | A variable nothing reads | Expected for the skeleton's `Honest` once its scenes are rewritten |
| `ui/empty-behavior` | A control with no behaviour | Ships with the skeleton (about three dozen); not yours unless you added the control |
| `story/input-action-missing` | `/waitinput` etc. naming an input action that does not exist | Pick one from `story_targets` |

## 2. Tests

`test` runs a built-in test headlessly:

- `test {id:"narraleaf-studio:route-coverage"}` - every scene can be reached from the entry scene.
- `test {id:"narraleaf-studio:reachable-endings"}` - every `/ending` can be reached.
- `test {id:"narraleaf-studio:project-diagnostics"}` - a general health check.

A scene the coverage test cannot reach is usually a missing `/jump`, a jump inside a branch that can
never be true, or a leftover skeleton demo scene (`scene_delete` it once nothing jumps to it).

## 3. Playtest

`playtest_start` opens the game in Dev Mode, which the author sees too. With `scene` (and optionally
`row`) it starts there; without, it starts as a player would, on the splash and title.

How the playtest tools behave:

- `playtest_start {scene}` returns once the scene's first line is shown in full, and names that line
  (speaker and text); from the title page it returns when the page is up.
- `playtest_advance {steps:N}` reads on **line by line**. One step is one line: a click on the line
  shown in full, then a wait until the game is at rest on the next line, finished typing. Rows with
  no line (`/show`, `/sound`, `/bg`, a transition) are not steps; the call waits them out. When it
  returns, the line it names is exactly the one on screen, whole, so a screenshot right after shows
  it - no need to pause between calls.
- It stops early at a choice menu, when a click does not move the game, when no line comes up for
  10 s (a timed pause, a video), and at an **ending**: the answer names the ending reached (`Read on
  3 line(s) and reached the ending "Sunrise"`) and the page the game went to - the project's ending
  page, or the title page when it has none (the skeleton has none). That is the run finished, not an
  error.
- `steps` past an ending are simply unused, and the click that ends the story leaves its last line:
  to screenshot a route's last line, advance one step at a time near the end.
- Every result names the line it is on (and a menu's options), so take a `playtest_screenshot` only
  when you need to see the picture.
- `playtest_advance {choice:K}`: K is **1-based** in the order the options are shown (1 is the top
  one); the pick counts as one step. `playtest_advance` does nothing on the title page: start from a
  scene.
- A failing `playtest_screenshot` fails within about 15 s and says why; when it says the window is not
  responding or drew no frame, call `playtest_stop` and then `playtest_start`.

You cannot press interface buttons in the playtest, so: check the title and system screens with
`ui_screenshot` - `ui_screenshot {surface, element, state:"hovered"}` (or `"active"`, `"focused"`,
`"selected"`, `"disabled"`) draws one control and what is inside it in that state, which is how you
check hover and pressed looks - and play the story by starting at scenes.

For each route:

1. `playtest_start {scene:"<first scene of the route>"}`.
2. `playtest_screenshot` - the opening frame: background, characters, music started (check the
   console if unsure).
3. `playtest_advance {steps:N}` (N lines) to the next moment that matters - a new background, an
   entrance, an expression change, a CG, a menu - and screenshot it.
4. At a menu, screenshot it, then `playtest_advance {choice:K}` for the option this route takes.
5. Continue to the `/ending`: one step at a time over the last lines, screenshot the last line, then
   one more step - the answer names the ending - and screenshot the page it landed on.
6. `console_read {level:"error"}` - any runtime error names the row or graph; fix and replay.
7. `playtest_stop` before starting the next route (or start the next one directly).

What to look for in each screenshot:

- [ ] the right background and sprites, at a believable size and position (a sprite is its pixel size
  times its character's entrance `zoom`; fix a floating or shrunken one with `character_upsert
  {id, entranceTransform:"standing"}`);
- [ ] the speaker's name and colour correct; the line fully inside the box, no overflow;
- [ ] the dialogue band readable over this background (contrast);
- [ ] the choice menu legible and not covering a face;
- [ ] nothing left on stage that should have gone (a forgotten `/hide`);
- [ ] placeholders where you expect them and nowhere else.

Write a one-line verdict per screenshot in the chat; fix and replay what fails.

## 4. Console

`console_read` returns Studio's recent console lines; filter with `level` (`error`, `warning`) and
`channel` (build, story, blueprint, runtime). Read it after each playtest and after the build. A
runtime error with no row to point at, on game start, is very often a `/bg` inside an `/if` or menu
option (see `story-format`).

## 5. Build

When lint has no errors, both tests pass, every route was played to its ending and the console is
clean:

`build {target:"current"}` builds for the platform Studio runs on (`windows`, `macos`, `linux`,
`web` for the others; `output` to choose the directory). It runs the same pipeline as Studio's Build
menu and returns the output directory. It is refused when:

- the project is not trusted (`untrusted`) - the author must trust it in Studio;
- lint has errors - fix them;
- writes are off (`writes_disabled`) - building counts as a write.

A build can take minutes. Then `console_read {channel:"build"}` for warnings.

## 6. Hand-over report

Tell the author, in this order:

1. **What you made** - title, scenes and routes, endings, characters, pages restyled, behaviour
   added.
2. **Placeholders** - every placeholder asset, what it stands for, and its name, so they can replace
   it (in Studio, replacing an asset's file keeps every reference).
3. **For them to do in Studio** - leftover skeleton content you could not delete, files that need
   converting, the app icon, signing, anything you could not do with the tools.
4. **Translation and voice** - per language, how much is translated and how much is still
   `machine` awaiting their review (`localization_status`); per voice language, how many lines have
   a take, how many are approved, and which recordings are missing (`voice_status`, `voice_list
   {unlinkedOnly:true}`).
5. **How to run it** - the file to open, from the build result's `artifacts` (the `.app`, installer or
   app folder); an unsigned macOS build has to be allowed once in System Settings > Privacy &
   Security. Or press Play in Studio.
6. **Known limits** - anything you simplified from their script, and why.
