# Interface: trace the running Ren'Py game

The interface is what players notice first, and it is where a port most easily drifts. The method:
**capture every screen from the running Ren'Py game, rebuild it in Studio against the picture, and
check it in Studio's running game.** Read `narraleaf-make-game` chapters *interface format* and
*interface design* first.

## 1. Capture references with the Ren'Py SDK

Inferring positions from `screens.rpy` alone fails on exactly the parts that matter (a name plate
inside a frame inside a window with `gui.*` offsets). Run the game instead:

1. Ask the author where the Ren'Py SDK is installed (or download it from renpy.org with their
   consent). Any 8.x SDK runs 7.4+/8.x games.
2. Copy the game folder to your working folder, without `game/saves` and `game/cache`. Never add
   files to the original.
3. Put `assets/zz_capture.rpy` (in this skill) into the copy's `game/`. Set `CAP_DIR`, adjust
   `SCREENS` to the screens the game defines and `SAY_LINES` to the game's character variables (one
   line per distinct dialogue look: each speaker style, the narrator, caption modes).
4. Run `<sdk>/renpy.sh <copy>` (`renpy.exe` / `renpy.app` elsewhere). It shows each screen, saves a
   PNG at the game's resolution, optionally hovers a point for a second shot, and quits. If it stops,
   read `traceback.txt` in the copy. A window opens on the author's screen; keep runs short.
5. For story moments (a sprite pose, a CG, a caption mode, a menu), set `STORY_LABEL` to a label and
   capture its first lines with auto-forward on.

Use the game's own images (`gui/`, button `idle`/`hover` files) for hover states the capture cannot
force, and measure rectangles from the captures with a small script (bounding boxes of non-background
pixels) rather than by eye.

## 2. Ren'Py layout rules, for what you still compute

- **Resolve every value.** Screens use styles; styles use `gui.*` variables; `style_prefix "x"` plus
  an element type gives `x_button`, `x_button_text`, `x_label`… Follow the chain in `gui.rpy`,
  `screens.rpy` and the screen itself; the last assignment wins.
- **Positions** follow the model in `references/positions-and-atl.md` (`xpos/xanchor/xoffset`,
  `xalign`, ints = pixels, floats = fractions of the containing area).
- **Containers.** `fixed` stacks its children at their own positions; `hbox`/`vbox` place them in a
  row/column with `spacing` (from the style, often `gui.*_spacing`); `grid c r` / `vpgrid` fill
  cells; `frame` draws `background` (often `Frame("img.png", left, top, right, bottom)` - a
  nine-slice) inside `padding`; `window` is a frame; `side` places children at edges; `viewport`
  scrolls. `null width N` / `null height N` are spacers.
- **Sizes.** `xysize`, `xsize`, `xmaximum`, `xminimum`, `xfill`, `yfill`; without them a container
  shrinks to its children.
- **Buttons.** `imagebutton auto "path_%s.png"` expands to `idle`, `hover`, `selected_idle`,
  `selected_hover`, `insensitive`; `textbutton` styles its text per state through
  `*_text` styles with `idle_color`, `hover_color`, `selected_color`, `insensitive_color`.
  `imagemap` + `hotspot` are rectangles over a ground image.
- **Text.** Font, size, colour, `outlines [(size, colour, x, y)]`, `kerning`, `line_spacing`,
  `text_align`, `xmaximum` for wrapping. The say screen's `what` text uses `gui.dialogue_*`; the name
  uses `gui.name_*` and the name box `gui.namebox_*` - per-character overrides come from the
  `Character(...)` call (`who_color`, `window_background`, `namebox_background`).

## 3. Where each screen goes in Studio

| Ren'Py screen | Studio | Notes |
|---|---|---|
| `say` (+ namebox, CTC) | the Dialogue game UI | per-speaker looks: name plate image, colours; caption modes (white-on-black, NVL-like) as alternate looks the story switches between |
| `choice` | the Choice game UI | row template = one option button; check row pitch in the running game |
| `quick_menu` | the Quick menu game UI | |
| `main_menu` | the title page | video backgrounds are video elements; check them in a playtest (the editor screenshot may not draw video) |
| `navigation`, `game_menu` | a shared component or the frame the menu pages share | |
| `save`, `load` | the save and load pages | keep the skeleton's slot list wiring; restyle the slot template; page buttons |
| `preferences` | the settings page | bind each Ren'Py preference to the matching setting; volume sliders, text speed, auto-forward, skip |
| `history` | the backlog page | bound to the history list |
| `confirm` | the confirm page | its contract (props in, result out) is in the blueprint chapter |
| `notify` | the notifications game UI | |
| gallery / music room / replay | gallery pages (with the gallery plugin when installed) | unlock with persistent flags set in the story |
| custom screens | new pages or game UIs | port their behaviour with blueprints |
| `splash` / `splashscreen` label | the entry page shown before the title | |

## 4. Rebuild, then compare twice

1. Table every element of the capture: rectangle, image, font, size, colour, states.
2. Build or restyle the Studio page with the game's images (`ui_patch` on the skeleton's elements;
   `ui_apply` for new ones). Keep element names readable; blueprints refer to them.
3. `ui_screenshot` the page and put it next to the Ren'Py capture (or diff them). Fix until the
   rectangles agree to a pixel or two.
4. **Check it in the running game** - `playtest_start`, then `playtest_screenshot` (open the page
   with `playtest_click` / `playtest_key`). Fonts, list layouts, text effects and video can differ
   between the editor render and the game; compare the playtest shot with the Ren'Py capture too,
   and log any difference you cannot fix with both screenshots.
5. Wire behaviour (blueprints) and test it with `playtest_click`: every button does what the Ren'Py
   button did.

## 5. Things to watch

- **Fonts in the game.** Confirm the game, not only the editor, draws the font; a fallback font also
  changes where lines wrap.
- **Text outlines.** Ren'Py `outlines` map to a text shadow with spread; check that the game draws it.
- **The dialogue box during a menu.** Ren'Py hides an empty dialogue window for a menu by default
  (`config.window "auto"`); check what Studio shows under the options and match it.
- **CTC.** Ren'Py shows the click-to-continue indicator only when the line is complete.
- **Default preferences.** Ren'Py's defaults (`preferences.text_cps`, `afm_time`, volumes) are in
  `options.rpy` / `gui.rpy`; set Studio's defaults to the same values.
- **Large backgrounds** may appear a moment late the first time a page opens; preload or use the
  same image on the page before it.
