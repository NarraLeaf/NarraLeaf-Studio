# Interface: trace the running Ren'Py game

The interface is what players notice first, and it is where a port most easily drifts. The method:
**capture every screen from the running Ren'Py game, rebuild it in Studio against the picture, and
check it in Studio's running game.** Read `narraleaf-make-game` chapters *interface format* and
*interface design* first.

## 1. Capture references with the Ren'Py SDK

Inferring positions from `screens.rpy` alone fails on exactly the parts that matter (a name plate
inside a frame inside a window with `gui.*` offsets). Run the game instead - with the author's
agreement:

> **Running the game runs its code.** A Ren'Py game, and the capture script you add to it, run with
> the author's own permissions: the game's scripts can read and change their files and reach the
> network. Run only a game the author made or trusts, and ask before the first run. Ask before you
> download or install the SDK or any other tool, and get it from its official source. Never turn off
> or route around a security protection (antivirus, SmartScreen, Gatekeeper, quarantine flags,
> permissions) to make it start; if one blocks the run, tell the author and let them decide. If the
> author does not want the game run, trace from `screens.rpy` and screenshots they provide.

1. Ask the author where the Ren'Py SDK is installed. If it is not, ask whether you may download it
   from renpy.org (the official site) and wait for a yes. An 8.x SDK runs most 7.4+ and 8.x games,
   but a 7.x game whose scripts use Python 2 needs a 7.x SDK - ask the author which version the game
   was made with.
2. Copy the game folder to your working folder, without `game/saves` and `game/cache`. Never add
   files to the original.
3. Write a small capture script into the copy's `game/` (never the original). What works:
   - Replace the splash screen with your own label: `config.label_overrides["splashscreen"] = "<label>"`,
     and point `config.save_directory` somewhere new so the player's saves are never touched.
   - Mute the mixers and set `preferences.text_cps = 0` so captures are quick and identical.
   - For each screen: `renpy.show_screen(name, **args)`, then `renpy.call_screen` a tiny screen of
     your own with `timer 1.2 action Function(save_png)` and `timer 2.0 action Return()`, so the
     screen has been drawn before you capture. Save with
     `renpy.screenshot_to_bytes((1920, 1080))` written to a file - the project's size, so a capture
     and a Studio screenshot compare pixel for pixel.
   - The choice screen needs `items`: objects with `caption`, `action` (`NullAction()`), `chosen`,
     `args` and `kwargs`.
   - Dialogue: the say screen shown on its own lacks the speaker's styles. Use a real line instead -
     `renpy.say(character, text, interact=False)` and then the same timed screen. (A screenshot
     taken from a `show_done` character callback on the first line is the frame *before* it.)
   - Hover states: move the pointer (`renpy.set_mouse_pos`) and post a mouse-motion event, then
     capture again; or take the hover images straight from the game's files.
   - End with `renpy.quit()`.
4. Run `<sdk>/renpy.sh <copy>` (`renpy.exe` / `renpy.app` elsewhere). A window opens on the author's
   screen; keep runs short. If it stops, read `traceback.txt` in the copy. Check every PNG is
   1920x1080.
5. For story moments (a sprite pose, a CG, a caption mode, a menu), jump to a label with
   auto-forward on (`preferences.afm_enable = True`, a short `afm_time`) and capture from a character
   callback on `show_done`, comparing each shot with its line.

Use the game's own images (`gui/`, button `idle`/`hover` files) for hover states the capture cannot
force, and measure rectangles from the captures with a small script (bounding boxes of non-background
pixels) rather than by eye.

## 2. Ren'Py layout rules, for what you still compute

- **Resolve every value.** Screens use styles; styles use `gui.*` variables; `style_prefix "x"` plus
  an element type gives `x_button`, `x_button_text`, `x_label`… Follow the chain in `gui.rpy`,
  `screens.rpy` and the screen itself; the last assignment wins.
- **Positions** follow the model in `references/positions-and-atl.md` (`xpos/xanchor/xoffset`,
  `xalign`, ints = pixels, floats = fractions of the containing area). The project is 1920x1080, so
  multiply every Ren'Py pixel value by 1920/w (w = the game's `config.screen_width`).
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
| `navigation`, `game_menu` | the side rail each menu page carries | the skeleton has no shared frame: every system page holds its own copy of the rail, so restyle it on each (or make it a component of your own) |
| `save`, `load` | the save and load pages | keep the skeleton's slot list wiring; restyle the slot template; page buttons |
| `preferences` | the settings page | bind each Ren'Py preference to the matching setting; volume sliders, text speed, auto-forward, skip |
| `history` | the backlog page | bound to the history list |
| `confirm` | the confirm page | its contract (props in, result out) is in the blueprint chapter |
| `notify` | the notifications game UI | |
| `nvl` | an NVL game UI (`slot=nvl`, built on `nl.nvl.list`) | the skeleton and `ui_install_standard_screens` bring none: make it with `ui_apply` (`ui_widget` on the NVL widgets first) |
| gallery / music room / replay | gallery pages (with the gallery plugin when installed) | unlock with persistent flags set in the story |
| custom screens | new pages or game UIs | port their behaviour with blueprints |
| `splash` / `splashscreen` label | the entry page shown before the title | |

## 4. Rebuild, then compare twice

1. Table every element of the capture: rectangle, image, font, size, colour, states.
2. Build or restyle the Studio page with the game's images (`ui_patch` on the skeleton's elements;
   `ui_apply` for new ones). Keep element names readable for the author; blueprints refer to elements
   by id, so give any element a blueprint will name an explicit `id`.
3. `ui_screenshot` the page and put it next to the Ren'Py capture (or diff them). Fix until the
   rectangles agree to a pixel or two.
4. **Check it in the running game** - `playtest_start`, then `playtest_screenshot` (open the page
   with `playtest_click` / `playtest_key`; the screenshot includes pages open over the game). Fonts, list layouts, text effects and video can differ
   between the editor render and the game; compare the playtest shot with the Ren'Py capture too,
   and log any difference you cannot fix with both screenshots.
5. Wire behaviour (blueprints) and test it with `playtest_click`: every button does what the Ren'Py
   button did.

## 5. Things to watch

- **Fonts in the game.** Confirm the game, not only the editor, draws the font; a fallback font also
  changes where lines wrap.
- **Text outlines.** Ren'Py `outlines` map to a text shadow with spread; check that the game draws it.
- **The dialogue box during a menu.** Ren'Py hides an empty dialogue window for a menu by default
  (`config.window "auto"`). In Studio it is a blueprint on the box's container that hides the
  textbox picture while there is no line - `ui-design` in the make-game guide, "The dialogue box".
  It must live on the Dialogue page: a Choice-page blueprint cannot reach the Dialogue page's
  elements (the checker refuses it).
- **CTC.** Ren'Py shows the click-to-continue indicator only when the line is complete: same section,
  `Is Dialog Waiting` driving the mark's Visible.
- **Default preferences.** Ren'Py's defaults (`preferences.text_cps`, `afm_time`, volumes) are in
  `options.rpy` / `gui.rpy`; set Studio's with `project_settings_set {playerDefaults}`. `text_cps 0`
  (instant) is `cps: 200`, the fastest the engine types; `afm_time` is seconds for a whole line where
  `autoForwardDelay` is milliseconds after the line has finished, so a short pause (1000-2000) is the
  usual match. Volumes are 0-1 in both.
- **Large backgrounds** may still appear a moment late the first time a page opens; Studio holds the
  page until a picture covering most of it has decoded, up to 1.5 s.
