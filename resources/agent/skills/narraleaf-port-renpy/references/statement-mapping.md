# Ren'Py statements → NarraLeaf `.story`

Defaults that hold for most games. Before you rely on a row form, check it with `story_command
{token:"/…"}` - the catalogue is generated from the code Studio runs and wins over this table.
Measure anything visual once in a scratch scene before you generate thousands of rows.

## Parsing

- Parse every `.rpy` under `game/` into an IR of blocks with their indentation: labels, say
  statements, `show/hide/scene`, `with`, `play/stop/queue/voice`, `pause`, `menu` with options and
  their conditions, `if/elif/else`, `jump/call/return`, `$` one-liners and `python:` blocks, `window`
  statements, `nvl` statements. Count anything you do not recognise and drive that count to zero
  before generating; an unknown line is a silent hole in the port.
- Expand `call` the way the game uses it: a called label that returns is usually a shared routine -
  inline it or give it its own scene and `/jump` back explicitly.
- Walk the IR with a **stage model** (what each tag shows, with which attributes, at which
  transform) so every generated row knows the state it changes. Most mapping bugs are state bugs.

## Dialogue

| Ren'Py | `.story` | Notes |
|---|---|---|
| `e "Hello."` | `Eileen: Hello.` (dialogue row) | speaker = the merged Studio character |
| `"Narration."` | narration row | |
| `extend " more"` | append to the previous line's text | count them; Studio has no separate row |
| `e "…" (multiple=2)`, `nvl` mode | `/nvl` block | check `story_command /nvl` |
| `"???" "…"` before a name is known | `/rename` the character, then dialogue | not a second character |
| text tags `{w}`, `{p}`, `{nw}` | inline pause / line break forms from `story_command` | |
| `{color}`, `{b}`, `{size}`, `{font}` | not expressible in `.story` text yet | strip them; log what styling was lost |
| `[var]` interpolation | the story format's interpolation form | see `narraleaf-make-game` story format |

Keep the speaker's Ren'Py `Character` arguments (`who_color`, `window_background`, `what_prefix`
quotes, `ctc`) for the interface step; they are not story rows.

## Stage

| Ren'Py | `.story` | Notes |
|---|---|---|
| `scene bg room` | `/bg room` **and** `/hide` every object still shown | Ren'Py's `scene` clears the layer; Studio's `/bg` does not |
| `scene black` / `scene white` | `/bg` with a solid colour, or a 1x1 asset | |
| `show eileen happy` (cast sprite) | first time `/show Eileen <pose>`, then `/char Eileen <pose>` | pose = resolved image (see "Image attributes") |
| `show cg01` (anything else) | `/image` declare + `/show <name>`; later images on the same tag `/swap` | one stage object per Ren'Py tag |
| `show x at left` | placement on `/show`, or `/transform` after it | `references/positions-and-atl.md` |
| `hide x` | `/hide x` | |
| `show x behind y`, `zorder` | `/front` on the one that must be on top | |
| `with dissolve` / `Dissolve(t)` / `fade` | the row's transition params (`t=fade d=…` on `/bg`, `in=fade d=…` on `/show`) | a `with` after several statements applies to all of them: put the transition on each row it covers |
| `with vpunch` / `hpunch` | a short `/transform camera` shake | |
| `window show` / `window hide` | usually nothing | Studio shows the dialogue box with lines; verify once in a playtest |
| `pause 1.5` | `/wait 1.5` | |
| `pause` (no time) | `/wait click` form | |

## Image attributes

Ren'Py picks the image for `show <tag> <attrs>` like this, and the converter must do the same:

1. **Required** = the attributes written in the statement. **Optional** = the attributes the tag
   currently shows (kept unless the new ones replace them).
2. Candidates = images of that tag whose attributes are all in required ∪ optional and that contain
   every required attribute.
3. Choose the candidate with the most attributes. A tie is an error in Ren'Py; log it.
4. A `-attr` in the statement removes that attribute from optional first.

Without step 1's optional set, a large fraction of `show` statements in a typical game resolve to the
wrong or no image. Record unresolvable statements with their line numbers.

## Sound and video

| Ren'Py | `.story` | Notes |
|---|---|---|
| `play music "x.ogg" fadein 1` | `/bgm x fade=1` | `bgm` is the reserved music object name |
| `stop music fadeout 2` | `/stop bgm fade=2` | |
| `play sound "x.ogg"` | `/sound x` | |
| `queue music` | the next `/bgm` after the current one ends, or a loop setting | check `story_command /bgm` |
| `voice "v001.ogg"` | nothing in text; link the take with `voice_link` afterwards | match by scene + line order |
| `renpy.movie_cutscene("op.webm")` | `/play op` (waits by default) | |
| `show movie_tag` (a `Movie` image) | `/vfx <video> name=…` + `/show …`, or `/play … wait=false hide=false` | looping overlays; masks need baking (assets chapter) |
| `stop music` in a scene whose music started in an earlier scene | `/stop bgm` still works; Dev Mode may warn that nothing played *in this scene* | |

## Flow and data

| Ren'Py | `.story` | Notes |
|---|---|---|
| `label x:` | a scene, or a `/label` inside one | |
| `jump x` | `/jump 'Scene'` or `/goto label` | |
| `menu:` with options | `/menu` with indented options | conditions on options carry over |
| `if / elif / else` | `/if` blocks | port the expression; the story expression language is documented in `narraleaf-make-game` |
| `$ x = True`, `$ x += 1` | `/set`, `/inc`, `/dec`, `/toggle` | |
| `$ persistent.x = True` | `/set` on the persistent variable | |
| `return` at a route's end | `/ending <name>` | |
| `$ renpy.notify("…")` | a notification (see the interface chapter) | |
| `$ achievement.grant("X")` | the achievements plugin's unlock where available, else a `/note` row | list in "Needs the author" |
| other `python` | decide per block; log each | |

## Splitting and naming

Name scenes after the chapter and part (`Chapter 3 · 02`), keep a source map (scene → Ren'Py file and
line range) in the log, and keep scene ids in a file so a re-apply targets the same scene.
