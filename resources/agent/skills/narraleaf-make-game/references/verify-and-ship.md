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
never be true, or a leftover skeleton demo scene (tell the author to delete it in Studio).

## 3. Playtest

`playtest_start` opens the game in Dev Mode, which the author sees too. With `scene` (and optionally
`row`) it starts there; without, it starts as a player would, on the splash and title.

You cannot press interface buttons in the playtest, so: check the title and system screens with
`ui_screenshot`, and play the story by starting at scenes.

For each route:

1. `playtest_start {scene:"<first scene of the route>"}`.
2. `playtest_screenshot` - the opening frame: background, characters, music started (check the
   console if unsure).
3. `playtest_advance {steps:N}` to the next moment that matters - a new background, an entrance, an
   expression change, a CG, a menu - and screenshot it.
4. At a menu, screenshot it, then `playtest_advance {choice:K}` for the option this route takes.
5. Continue to the `/ending`. Screenshot the last line and what follows it.
6. `console_read {level:"error"}` - any runtime error names the row or graph; fix and replay.
7. `playtest_stop` before starting the next route (or start the next one directly).

What to look for in each screenshot:

- [ ] the right background and sprites, at a believable size and position (sprites are drawn at their
  pixel size; a sprite cut off at the top or tiny in the corner needs resizing - tell the author);
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
3. **For them to do in Studio** - leftover skeleton scenes or variables to delete, sprite scales, the
   gallery (Extra) contents, files that need converting, anything you could not do with the tools.
4. **How to run it** - the build directory and the file to open; or press Play in Studio.
5. **Known limits** - anything you simplified from their script, and why.
