# Designing a visual novel's interface

The interface of a visual novel sits on top of its art. It has to be readable over any background,
quiet enough not to fight the illustrations, and shaped by what a player does - read, choose, save,
come back. This chapter is how to restyle the skeleton into the game's own look, one visible pass at
a time, checking each pass with your own eyes (`ui_screenshot`).

## Think like a VN, not a web app

| Web-app habit | What a VN does | Why |
|---|---|---|
| Rounded card in the middle for dialogue | A band across the bottom, semi-transparent, name above the text with a rule or plate, not a pill | The art must show through; the eye stays low |
| Save slots as cards with a title and a small thumbnail | A grid of large 16:9 screenshots (6 a page), the place and date as one line under each | Players recognise a save by the picture |
| One long form of settings | A category rail on the left, one panel at a time | Thirty settings, the player came to change one |
| Each screen has Back to a hub | Every system screen carries the same side rail (Save, Load, Config, Log, Back, Title) | The screens reach each other; there is no hub |
| A toggle for Skip | Two named buttons, "All text" and "Read only" | Both are things the game does |
| No in-game menu | A quick menu (Auto, Skip, Log, Save, Load, Config, Hide) floating just above the dialogue band | The most recognisable piece of VN UI |
| Saturated blue, big radii | Low-saturation colours drawn from the art, small radii (0-4 px), thin rules | The interface should recede |

The skeleton already has these shapes. Keep them; change the look.

## Palette first

`brand_get` shows the palette. The ids that matter:

| Id | Paints |
|---|---|
| `primary` | Accent: rules, hover glow, active bars, selected fills |
| `secondary` | Second accent, borders by default (`button.border`, `container.border` at 50% alpha) |
| `background` | System-screen background |
| `foreground` | Main text (`text.primary`, `button.text`) |
| `pageBackground` | Title and splash background |
| `panel` | Panels and the dialogue band |
| `raisedFill` | Raised surfaces: slots, tiles |
| `subtleText` / `text.muted` | Secondary text: dates, hints, values |
| `hoverBorder` | Border of a hovered item |
| `selectedFill` | Fill of a selected item |
| `button.*`, `container.*`, `text.*`, `textInput.*` | Control slots; mostly point at the four base colours |

Pick colours **from the art**: sample the dominant dark and light of the key art and backgrounds, and
take the accent from a colour that recurs in it (a character's eyes or clothing, a sky). Keep
saturation low for large areas; let the accent be the one saturated colour. Then
`brand_set {colors:{…}, fonts:[…]}` in one call, and screenshot the Title and the Dialogue box.

Starting points by mood (adjust to the art; check contrast):

| Mood | background / panel | foreground | primary |
|---|---|---|---|
| Warm school / slice of life | `#1B1714` / `#26201B` | `#F4EDE4` | `#C8A869` |
| Cold / winter / melancholy | `#10151C` / `#18202A` | `#E8EEF4` | `#8FB3CF` |
| Romance / soft pastel (light UI) | `#F7F1EE` / `#FFFFFF` | `#2E2629` | `#C97B8E` |
| Horror / mystery | `#0B0A0C` / `#151216` | `#E6E1DA` | `#9E2B2B` |
| Sci-fi | `#0A0F14` / `#111A22` | `#DDE8F0` | `#3FC1C9` |

For a light interface, invert the roles consistently - do not leave dark panels on a light page.

Fonts: import the author's font (TTF/OTF/WOFF2), then `brand_set {fonts:["<font asset name or id>"]}`.
For Chinese or Japanese text pick a font that covers the script; a Latin-only display font falls back
glyph by glyph and looks broken. Use the display font for titles and keep body text in a plain, very
legible face.

## Type and spacing at 1920x1080

Scale proportionally for other resolutions.

| Element | Size |
|---|---|
| Game title | 72-110 px |
| Screen titles (Save, Config) | 40-56 px |
| Dialogue text | 30-36 px, line height 1.5-1.7 |
| Speaker name | 28-34 px, weight 600-700; the skeleton's nametag paints it in the speaker's `nameColor`, or the palette's `primary` when the character has none (its blueprint: Get Speaker Color -> Set Text Color on Init and On Flush - text colour cannot be bound, so a nametag of your own needs the same two nodes) |
| Choice options | 30-34 px |
| Menu / rail buttons | 28-32 px |
| Secondary text (dates, values) | 20-24 px |

Safe margins: keep text and controls at least ~96 px from the left and right edges and ~54 px from the
top and bottom (5%). Spacing on an 8 px grid; one gap size between siblings of the same kind.

The dialogue text box must hold the **longest line in the script** at the chosen size: about 3 lines
of 36-40 CJK characters, or 3 lines of 70-90 Latin characters, in a 1300 px wide box. Test with the
longest real line, not the sample text.

## Build in passes, look after each

Per page, in order, each pass one `ui_patch` (or a few) and one `ui_screenshot`:

1. **Layout** - positions and sizes on the grid, inside the safe margins; alignment of edges and
   baselines; nothing overlapping.
2. **Style** - fills, borders, radii, type sizes and weights, images (the title's key art, background
   images, the logo).
3. **Interaction** - hover and pressed looks (appearance rows with `hovered` / `active`), a transition
   of 120-200 ms on them, click and hover sounds, a selected look for the current rail entry.

Then the self-critique, written in the chat, and fixes before the next page:

- [ ] **Contrast**: text at least 4.5:1 against what is actually behind it (3:1 for 24 px+ or bold
  18.5 px+). Over art, assume the worst part of the picture: give the band or plate enough opacity
  (dialogue band panel at ~75-90%), or add a text shadow.
- [ ] **Overflow**: no text clipped or wrapping where it should not; the longest label in every
  language fits; no element runs off the screen.
- [ ] **Alignment**: edges line up across the page; equal gaps; centred things truly centred.
- [ ] **Consistency**: the same control has the same size, type and states on every page; the rail is
  identical across Save, Load, Config, Log.
- [ ] **Safe margins** respected.
- [ ] **States**: hover and pressed visible on every button; the selected rail entry and setting
  options visibly selected.
- [ ] **Hierarchy**: one obvious primary action per screen (Start on the title); secondary text is
  quieter.
- [ ] **Art first**: the interface does not cover a character's face in the default sprite positions.

How to compute contrast: relative luminance `L = 0.2126 R + 0.7152 G + 0.0722 B` with each channel
linearised (`c/255`, then `c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`); ratio
`(L_light + 0.05) / (L_dark + 0.05)`. `#F2F4F7` on `#15171D` is about 16:1; `#9AA3AE` on `#15171D`
about 7:1; `#6E7681` on `#15171D` about 4:1 (too low for small text).

## Page by page

Element, page and blueprint names in the skeleton are in the project's language (the title's
`Key art` image is named in Chinese in a Chinese project), so find elements with `ui_show` by type and
position rather than by the English names below; page ids such as `narraleaf-studio:main-surface`
are the same in every language.

- **Title** (`narraleaf-studio:main-surface`): set the key art (`Key art` image's `imageFill.assetId`,
  `fillOpacity` 1 when the art is made for it, lower to dim a busy picture), the game title text, and
  the menu column. Keep the menu to Start, Continue, Load, Config, Extra, Quit. If the game has no
  gallery content, hide the Extra button (`ui_patch` `set` with `{"layout.visible": false}`) rather
  than deleting it, so its blueprint is not left without an element; close the gap in the column.
  Screenshot at full size. (`ui_patch` refuses a key the widget does not know and an edit that
  changes nothing, so "Applied" means it changed.)
- **Dialogue** (Game UI, slot `dialog`): the band at the bottom, the nametag plate and rule, the
  sentence box, the avatar. Match the band's height to three lines of text plus the name; keep the
  quick menu clear of it. The nametag rule hides itself when nobody speaks (narration, a choice on
  screen).
- **Choice** (slot `choice`): options centred over the art, each a full-width plate with clear hover;
  room for the longest option; at most 4-5 options visible.
- **Quick menu** (slot `onStage`): small, quiet, just above the band's top-right; Auto and Skip have a
  lit look while active (already wired with variants - restyle the variants, do not remove them).
- **Save / Load**: the rail, the screen title, the 6-slot grid. Slots are a component (`Save slot`):
  restyle the component once and every slot follows.
- **Config**: rail, category rail, one pane at a time. Sliders and toggles are wired; restyle their
  parts (track, handle) and the selected variants.
- **Log** (backlog): a vertical list of speaker + line; readable, the speaker set apart from the line
  by weight or a palette colour (a list row cannot take each speaker's own colour).
- **Splash**: the studio or game wordmark and the disclaimer text; replace the words, keep it brief.
- **Extra**: CG, recollection, music, voice tabs over the Gallery plugin. It shows what the gallery
  catalog holds: fill it with the gallery tools (`agent_guide {chapter:"plugin:narraleaf.gallery"}`),
  then restyle it.
- **Confirm**: the yes/no dialog every risky action uses; make it match the rest.

## Templates instead

`ui_templates` lists ready-made interface sets from Studio's template store and `ui_template_apply`
adds one's pages to the project. Use it only when the author picks one; then restyle it with the
same passes, and make sure the entry page and the title (`narraleaf-studio:main-surface`) are the
ones you expect (`ui_surfaces`, `project_info`).
