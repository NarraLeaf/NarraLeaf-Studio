# The `.story` format

`story_show` prints one scene in this format and `story_apply` writes one back. This page is a
condensed reference; **the catalogue tools are the truth**. Before using a command for the first
time, call `story_command {token}` - it prints the positional order, the named parameters with their
allowed values and defaults, and examples, straight from the spec Studio commits through. `story_commands`
lists all of them by category; `story_targets` lists every name a line can resolve.

## A whole scene

```
#nlstory 1
#story Skeleton
#scene Rooftop ⟦9c41d2e0-5b7a-4c1e-9f0a-2d6b8e1c3a77⟧
#background none
#music none

/bg bg_rooftop_dusk t=fade d=1
/bgm bgm_evening track=Music vol=0.7 fade=1.5 loop
/show Aoi normal pos=left
/show Ren pos=right
The wind up here never stops.
Aoi: You came.
Ren: You said it was important.
/char Aoi sad
Aoi: It is. I just don't know how to start.
/menu What do you say?
  - Take your time.
    /inc trust_aoi
    Ren: Take your time. I'm not going anywhere.
  - Just say it.
    Ren: Just say it.
    /char Aoi angry
    Aoi: ...Fine.
/if trust_aoi >= 2
  /jump 'Confession'
/jump 'Walk home'
```

- `#nlstory 1`, `#story <story name>` and `#scene <name> ⟦<scene id>⟧` are the header. Copy them from
  `story_show`; the scene named here is the one replaced.
- `#background` and `#music` are the **scene's own settings**, not rows: the picture and the music the
  scene opens on, put up before its first row runs. `story_show` always prints both (`none` when
  unset). Values: `#background <image>` / `none`; `#music <audio> [track=<track>] [volume=0.7]
  [loop=true] [fade=1200]` (fade in ms) / `none`. Names with spaces in single quotes, as
  `story_targets` prints them.
- A header **without** them keeps whatever the scene had - the `story_apply` answer then says what the
  scene still opens with. **A reused skeleton demo scene opens on its demo picture** (`#background
  classroom` and the like): write `#background none` (or your own picture) and `#music none` in your
  source, or that picture shows for a beat before your first `/bg` - in the game the player sees.
  `story_targets {query}` lists, under "scene settings", which scenes open on which picture.
- Two spaces per nesting level. The rows under a menu option or an `/if` branch are indented one level
  deeper than it.
- A blank line is spacing, not a row.

## Line shapes

What a line is depends only on how it starts:

| Line | Meaning |
|---|---|
| `/token args` | A command. A line starting with `/` is **always** a command; an unknown one is an error, never prose. |
| `Name: words` | Dialogue. Everything before the first `: ` is the speaker. A name no character or nickname answers to becomes a one-off speaker. |
| any other text | Narration. |
| `// text` | A note for the author. Never shown to the player. |
| `- text` | A choice option, directly under a `/menu` row. |
| `? expression` / `? else` | A branch of the bare `/if` above it (see Branching). |
| `» label` | A row this format cannot spell; its payload is in the `#data` footer. Never edit the label. |
| `.` | An empty row. |

Escape with a backslash: a line of narration that starts with `/`, `-`, `?`, `//`, `»` or contains
`: ` (which would read as dialogue) needs `\` before the marker - `\...Huh.`, `\- not an option`,
`It said\: closed.` Leading or trailing spaces need it too. `story_show` writes escapes for you.

## Anchors: the row's identity

`story_show` ends each line with `⟦…⟧` - the first characters of the row's id, optionally followed by
`disabled`. Keep the anchor on a line you edit: the row keeps its id, and with it its translations and
any save that points at it. A line without an anchor is a new row. **A line you delete deletes its
row**: a source describes the whole scene, and `story_apply` removes every row the source does not
mention. When rewriting a skeleton demo scene from scratch, drop all its anchors and `»` lines except
those you deliberately keep.

## The stage

- **Each scene starts with an empty stage.** Bring on what the scene uses: `/bg` first, then `/show`
  for every character present. A `/hide`, `/char` or `/transform` on something not brought on earlier
  in the same scene is refused (`story/stage-object-missing`).
- **Characters** are addressed by name: `/show Aoi smile pos=left in=fade d=0.4`, `/char Aoi sad`
  (change pose), `/transform Aoi pos=right d=0.5`, `/hide Aoi out=fade d=0.3`. The pose name must be one
  of the character's poses (`compile.unknownForm` otherwise).
- **Backgrounds**: `/bg <image> t=<transition> d=<seconds>`; also a colour, `/bg #000000`. A background
  covers the stage whatever the picture's size.
- **Other pictures** (a CG over the background, a letter, a flashback frame): `/show <image asset>
  name=<name> pos=center in=fade d=0.5` creates the picture and reveals it in one row. **Always write
  `name=`**, even when it repeats the asset name - later rows (`/hide`, `/swap`, `/transform`) address
  the picture by that name, and a `/show` without `name=` means "reveal the object already called
  that". `/image` alone only creates a picture without showing it (`story/declared-never-shown`); use
  `/show <asset> name=`.
- **Declare, then show.** `/image`, `/text` and `/vfx` rows only declare an object; nothing is on screen
  until a `/show <name>` row. `/text name=title pos=center Chapter One` then `/show title in=fade d=0.5`;
  `/vfx snow name=snow` then `/show snow` (and `/hide snow` to stop it). `story_command <token>`
  prints these pairs under "together".
- Do not create the same name twice in one scene (`story/stage-object-duplicate`): change the picture
  of an existing one with `/swap <name> <asset>`, bring it back with `/show <name>`.
- **Video**: `/play <video asset> name=<name>` plays it to the end and clears it away (`wait=false`,
  `hide=false`, `muted` change that). `/show` refuses videos.
- **Camera**: `/transform camera zoom=1.1 d=2 ease=easeOut`.
- **Positions.** `/show`, `/image` and `/text` take a word: `pos=left|center|right`. `/transform`
  takes the word or an exact pair, `pos=x,y` (no spaces):
  - `x` and `y` are **shares of the stage, not pixels and not percentages**. `x` runs from the left
    edge (0) to the right edge (1); `y` runs from the **bottom** edge (0) up to the top (1).
  - The pair says where the object's **centre** goes. There is no anchor: the engine always places
    the centre. `left`/`center`/`right` are `0.25,0.5` / `0.5,0.5` / `0.75,0.5`.
  - Values a little outside 0..1 park the object off screen - `pos=-0.3,0.5` is a slide-in start.
    Anything below -1 or above 2 is refused (`pos=100,200` is pixels typed where shares belong).
  - Pixel offsets (`xoffset`/`yoffset`, design pixels, + is up) have no spelling on a line; a
    character's `entranceTransform` carries them, and a row holding one prints as `»`.
  A sprite is drawn at its own pixel size times its character's entrance `zoom`. `pos=` words write
  `xalign` 0.25/0.5/0.75 and `yalign` 0.5, so the baseline comes from the character's
  `entranceTransform.position.yoffset`, never from `yalign`. `characters_list` gives `drawnAtCenter`.
- `/transform` moves images, texts, layers, characters and the camera. It refuses videos and `/vfx`
  overlays (the engine gives them no transform); `/transform camera ...` moves them with the stage.

## Sound

- `/bgm <audio> track=Music vol=0.7 fade=1.5 loop` - starts (or crossfades to) background music.
  Repeat the line in each scene where the music should change.
- `/sound <audio> name=<name>` - a sound effect. Give it `name=` if a later row must `/stop` it;
  `/stop <name> fade=0.5`. The music is the reserved name `bgm`: `/stop bgm fade=1`, `/vol bgm 0.5`,
  `/pause bgm`. `music` is not a name - it only works if a row created something called that.
- `track=` names an audio track from `audio_tracks_list` (Music, SFX, Voice, or custom ones).

## Branching and flow

- **Choice:** `/menu Question text` then `- option` lines, each with its rows indented under it. An
  option with no rows is an empty choice (lint warning). After the menu the scene continues for every
  option that does not jump away.
- **Condition, short form:** `/if <expression>` with the rows to run indented under it.
- **Condition with else:** a bare `/if`, then `? <expression>` (the if), more `? <expression>` lines
  (else-ifs) and finally `? else`, each with its rows indented under it:
  ```
  /if
    ? trust_aoi >= 3
      Aoi: I knew you'd understand.
    ? trust_aoi >= 1
      Aoi: Thanks. I think.
    ? else
      Aoi: Forget it.
  ```
- **Scene to scene:** `/jump 'Scene name' t=fade d=0.6`. Quote names with spaces. A scene with no jump
  and no ending at its end stops dead (`story` lint reports dead ends).
- **Within a scene:** `/label name` and `/goto name`.
- **Endings:** `/ending Name of the ending` records the ending, ends the playthrough and takes the
  player to the build's ending page. Rows after it never run. Names must be unique across the story.
- **Leave to a page without an ending:** `/quit Title` (any page from `story_targets`).
- **Loops:** `/repeat 3`, `/until <expression>`, `/break` - rare in a VN.
- `/wait 1.5` pauses; `/wait click` waits for a click.

## Variables and expressions

- Global variables are declared with `variable_upsert` (step 4) and named in rows by name:
  `/set took_the_key true`, `/set route "aoi"`, `/inc trust_aoi`, `/inc trust_aoi 2`, `/dec trust_aoi`,
  `/toggle met`.
- A scene-only variable is a row: `/local tries 0`.
- Expressions are C-like: `trust_aoi >= 3`, `met && !took_the_key`, `route == "aoi" || route == "ren"`,
  arithmetic `+ - * /`, parentheses. Strings take **double quotes**; `and` / `or` / `not` and
  single-quoted strings are refused (`compile.expressionError`). `==` is strict.
- `random()` is allowed only on the right of a `/set` (and in a loop condition), never in an `/if`.
- `visited(<scene>)` (the player has entered a scene) and `picked(<option>)` (the player chose an
  option) exist, but their spelling with multi-word names is easy to get wrong - prefer a variable you
  `/set` yourself, or confirm the line with `dryRun: true`.

## The `»` rows and `#data`

Some rows have no line spelling - a character entrance with a custom motion, a jump with a
through-colour transition, a `/set` of a scene reference. `story_show` prints them as `» label` lines
whose payload is in a JSON `#data` footer keyed by the anchor. Keep such a line (with its anchor) to
keep the row; delete it to delete the row; editing the label changes nothing.

The skeleton opens each demo scene with `» Location = <scene>`: it stores the current scene in the
persistent `Location` variable, which the save screen shows as the slot's place. To keep that in a
scene of your own, copy one such `»` line and its `#data` entry from a skeleton scene, give the row a
fresh UUID (its first 8 characters become the anchor and the `#data` key, the whole UUID goes in the
entry's `"id"`), and set `"value"` to `"scene:<your scene id>"`. Check it with `dryRun: true`. If it
gives trouble, leave it out: saves then show no place, nothing else breaks.

## Rules that cause refusals or broken games

| Symptom | Cause | Fix |
|---|---|---|
| `compile.unknownCommand` | A `/` line with a token that does not exist | `story_commands {query}` |
| `compile.unknownTarget` | A name nothing answers to | `story_targets {query}`; import or declare it first |
| `compile.unknownForm` | A pose the character does not have | `characters_list`; add the pose with `character_upsert` |
| `compile.expressionError` | `and`/`or`/`not`, single quotes, or a typo in an expression | Use `&&` `\|\|` `!` and double quotes |
| `compile.bad_indent` | Rows indented under a row that holds none (or one level too deep) | Only `/menu`, options, `/if`, `?` branches and loops hold rows; two spaces per level |
| `story/stage-object-missing` | Acting on something not brought on in this scene, or `/show <asset>` without `name=` before a row that names it | Bring it on earlier in the scene; write `name=` |
| `story/stage-object-duplicate` | Creating the same name twice | `/swap` or `/show <name>` the existing one |
| `story/declared-never-shown` | `/image` without a `/show` | Use `/show <asset> name=` |
| `story/ending-name-duplicate` | Two endings share a name | Rename one |
| Game fails to start, "stringify is not a function", no row named | `/bg` inside an `/if` branch or menu option | Before the condition `/show <asset> name=bgx` with a picture at the project resolution; inside it `/swap bgx <asset>`. Or jump to a scene that opens with the other `/bg` |
| Rows vanished after apply | The source left them out | Always start from `story_show`; keep anchors |

## Writing efficiently

- Write one scene per `story_apply`. If the source is long (several hundred rows), it is still one
  scene; split the *scene* in the script's natural break instead of splitting the call.
- A `dryRun` costs nothing and returns every error at once. Use it on the first scene, then whenever
  you use a command for the first time.
- Dialogue lines are rows the player clicks through: one sentence or two per line, as the script has
  them. Do not merge script lines into paragraphs.
