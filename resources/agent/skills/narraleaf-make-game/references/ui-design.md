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

## A project with no interface yet

A project made from the empty template has one blank page: no title, no dialogue box, no save, load,
settings or log. Store templates (`ui_templates`) do not fix that - they are layouts, and the answer
of `ui_template_apply` says how much logic each page brought, usually none. Get the working screens
first, then restyle them like the skeleton's:

1. `ui_install_standard_screens {dryRun: true}` - it lists the pages, Game UIs and components that
   would arrive, any Game UI slot the project already fills (skipped unless `replace: true`) and any
   page left out because the project lacks a plugin its logic needs (the Extra page without the
   Gallery), with the buttons that only opened it. It refuses outright when the project already has
   working screens (a page that starts the story and loads saves): restyle those instead.
2. The same call without `dryRun`. One step of undo takes back the interface it added and its input
   actions; the files, palette entries, translation keys, variable and save field it brought stay (the
   answer lists them). The splash becomes the entry page in place
   of the blank one (when the entry page is not blank it stays, and the answer says so - move it with
   `ui_page_set_entry`), and Start begins the project's default story at the scene that is its entry
   at install time. That scene is written into the Start Game node by id, so a later
   `scene_set_entry` does not move Start - set the node's `sceneId` (`blueprint-format`, "The title
   screen's Start button").
3. Check what arrived:
   - [ ] `project_info` names the splash (or the title) as the entry page; `ui_surfaces` lists Title,
     Save, Load, Config, Log, Confirm and the Dialogue, Choice, Quick menu and Notifications Game UIs,
     and no leftover blank page;
   - [ ] the title's Start blueprint (`ui_show` the title, find the button whose `localizationKey`
     is `menu.start`, then `blueprint_show` the name in the `# blueprint:` note on its line) starts
     the scene you mean (`story_list` shows ids);
   - [ ] `lint` reports nothing dangling: no page nothing reaches, no missing asset, no node naming
     something gone;
   - [ ] `ui_screenshot` of the title and the dialogue box looks like the skeleton's.
4. If the author picked a store look instead, apply it as well, wire or replace what it lacks, make
   its title the entry (`ui_page_set_entry`) and remove the pages it replaced (`ui_page_delete`,
   once nothing opens them).

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
   of 120-200 ms on them, click and hover sounds, a selected look for the current rail entry. Check
   each look with `ui_screenshot {surface, element, state:"hovered"}` (or `"active"`, `"selected"`).

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
are the same in every language. Screens brought in by `ui_install_standard_screens` keep their names
but get ids of their own, so find those pages by name (`ui_surfaces`).

- **Title** (`narraleaf-studio:main-surface`): set the key art (`Key art` image's `imageFill.assetId`,
  `fillOpacity` 1 when the art is made for it, lower to dim a busy picture), the game title text, and
  the menu column. Keep the menu to Start, Continue, Load, Config, Extra, Quit. If the game has no
  gallery content, hide the Extra button (`ui_patch` `set` with `{"layout.visible": false}`) rather
  than deleting it, so its blueprint is not left without an element; close the gap in the column.
  Screenshot at full size. (`ui_patch` refuses a key the widget does not know and skips an edit
  that changes nothing, listing it under `skipped`, so "Applied N" counts real changes.)
- **Dialogue** (Game UI, slot `dialog`): the band at the bottom, the nametag plate and rule, the
  sentence box, the avatar. Match the band's height to three lines of text plus the name; keep the
  quick menu clear of it. The nametag rule hides itself when nobody speaks (narration, a choice on
  screen).
- **Choice** (slot `choice`): options centred over the art, each a full-width plate with clear hover;
  room for the longest option; at most 4-5 options visible.
- **Quick menu** (slot `onStage`): small, quiet, just above the band's top-right; Auto and Skip have a
  lit look while active (already wired with variants - restyle the variants, do not remove them).
- **Notifications** (slot `notification`): the short messages the game raises over the stage, top
  right in the skeleton; a list whose `Toast` row is the template - restyle the row and keep its
  `message` field binding.
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
- **Confirm**: the yes/no dialog every risky action uses; make it match the rest. Restyle it freely,
  but keep its two page params, its `Buttons` list bound to the `buttons` prop and the list's row
  click graph: that is the contract Show Confirm talks through (`blueprint-format`, "The Confirm
  page"). A second confirm page of your own must keep the same contract.

## The dialogue box

Two behaviours players expect of the dialogue box are not settings; each is a small blueprint. Both
follow the pattern the skeleton's own nametag uses: the blueprint sits on an element that **stays on
screen** - the box's container (the skeleton's `Dialogue band`) - and shows, hides or fades an
element through an Element node. `Init` runs when the box appears and `On Flush` each time it shows a
new line or the line finishes typing, so the state is re-read at every change. Both layers can live in
one block on the container (`blueprint_show` it first if it already has one: a block replaces every
layer of its owner). Find the ids in any language with `ui_surfaces {query:"nl.dialog.sentence"}` -
it lists the Game UI with `slot=dialog`, and the Sentence's path names the container it sits in -
then `ui_show` that page.

**A click-to-continue mark shown only once the line is complete.** Add the mark (an `nl.image`, say,
with an explicit `id`) inside the container, then:

```
blueprint "Dialogue band" owner=widgetMain surface=<Dialogue page id> element=<container id>

event "Show the continue mark once the line is complete"
    appear: blueprint.event.head.init
    appearDone: blueprint.game.isDialogWaiting
    appearMark: blueprint.element.ref
        surfaceId = <Dialogue page id>
        elementId = <mark id>
    appearShow: blueprint.element.displayable.setProperty property=visible
    line: blueprint.event.head.flush
    lineDone: blueprint.game.isDialogWaiting
    lineMark: blueprint.element.ref
        surfaceId = <Dialogue page id>
        elementId = <mark id>
    lineShow: blueprint.element.displayable.setProperty property=visible

    appear.then -> appearShow.in
    appearDone.isWaiting -> appearShow.value
    appearMark.element -> appearShow.element
    line.then -> lineShow.in
    lineDone.isWaiting -> lineShow.value
    lineMark.element -> lineShow.element
```

`Is Dialog Waiting` is true once the line has finished typing and the game waits for the click.

**The empty box stepping aside while a menu shows.** During a choice menu with no question the box
has no line. In the skeleton the container is the box: `Dialogue band` paints the panel itself and
holds only the top rule, the nametag, the sentence and the avatar - there is no separate picture to
hide. So a second layer in the same block fades the container itself whenever there is no line. Use
Opacity, not Visible: the container carries the graph that brings it back, so it stays on screen,
only transparent.

```
event "Step aside while there is no line"
    boxInit: blueprint.event.head.init
    boxLine: blueprint.event.head.flush
    lineText: blueprint.game.getDialogText
    noLine: blueprint.string.isBlank
    check: if
    hideRef: blueprint.element.ref
        surfaceId = <Dialogue page id>
        elementId = <container id>
    hide: blueprint.element.displayable.setProperty property=opacity value=0
    showRef: blueprint.element.ref
        surfaceId = <Dialogue page id>
        elementId = <container id>
    show: blueprint.element.displayable.setProperty property=opacity value=1

    boxInit.then -> check.in
    boxLine.then -> check.in
    lineText.text -> noLine.value
    noLine.result -> check.condition
    check.true -> hide.in
    hideRef.element -> hide.element
    check.false -> show.in
    showRef.element -> show.element
```

A box of your own whose panel is a picture inside the container can hide that picture with Visible
instead, the way the first layer shows the mark. Do not put this on the Choice page: a blueprint
reaches only the elements of its own page (`blueprint-format`).

## Pitfalls met in real builds

- **A button drawn from the game's own art** is an `nl.button` with `fillType: "image"`, the label
  emptied (`localizationKey: null`, `label: ""`), and an `appearance` whose `imageFill` group has one
  row per state: no condition (normal), `hovered`, `focused` (same picture as hover, so pads and
  keyboards see it) and `active` (pressed). A toggle that stays lit (fullscreen on/off, a page tab) gets
  a second variant `selected` with the lit picture - the skeleton's toggles switch variants, so keep
  the variant ids `default` and `selected`.
- **Outlined text** (light text over busy art) is an `effectTextShadow` row with offset 0, blur 0 and
  `spread` as the outline width - set it through the text's `appearance`, because the row, not the flat
  prop, is what draws.
- **Name colours.** The skeleton colours the nametag with the speaker's colour on every line through a
  blueprint layer on the nametag; a fixed colour you set on the text is overwritten. If every name
  should look the same, remove that layer (`blueprint_show` the nametag's blueprints, `blueprint_remove`
  the colouring one) or give every character the same `nameColor`.
- **Game menus over the stage.** Save, Load, Config and Log open over the running game; a page whose
  `backgroundColor` setting is opaque hides it. Make it `transparent` (`ui_patch` `setting` op) when
  the design shows the game behind a frame.
- **A page that looks different with saved state** (a title that changes once the game is cleared, a
  button locked until then) keeps every look on the page and switches with a blueprint that reads the
  persistent variable (`Get Persistent` -> `If` -> `Set Element Property visible / x`). Start it from
  the page's own blueprint with `blueprint.event.head.surfaceInit`, or from the root container's
  `Init`; the page's own blueprint refuses a plain `Init`.
- **The choice list does not recentre by count.** It sits where you put it; with menus of different
  lengths, place it for the most common count and check the longest.
- **A list has one gap.** `itemGap` spaces items both ways in a wrapping grid; for a larger gap between
  rows than between columns, make the row template taller than its picture.
- **One template, every row.** A list draws every row from one template, and its events do not hand
  you a row to restyle, so rows cannot each carry a different picture (a confirm dialog's "Yes" and
  "No" drawn as two different images). Give such buttons words on a shared plate, or place fixed
  buttons instead of the list.
- **Ids you choose work in blueprints.** `add` with an `id` such as `title-locked-extra` is a stable
  target for `Element` nodes. When you replace an element a blueprint points at, point the blueprint at
  the new one in the same pass: lint reports the dangling reference as `blueprint/element-ref-missing`.

## A phone chat (a page the story opens)

A text conversation in the middle of a scene - the phone buzzes, the player reads, picks a reply,
and the story goes on knowing what they said. Four pieces; check each node with `blueprint_node`.

**1. The page** (`ui_apply`, `kind=appSurface`, `backgroundColor = transparent` so the scene shows
round the phone, a dimming `nl.container` over the whole screen, the phone body on top):

- A struct for one message: `struct chatMsg` with `field id: string`, `field text: string`,
  `field them: boolean`, `field me: boolean`. A `struct` block stands at the top level of the file,
  beside the `surface` (not inside it); `param` lines go inside the `surface`, before its root.
- A page param holding the opening messages as its default:
  `param messages messages type=list struct=chatMsg = [{"id":"o1","text":"在吗？","them":true,"me":false}]`.
  `/page` passes no parameters, so the default is what the page opens with; a different opening per
  scene is a different page, or an `init` blueprint that reads a saved variable.
- The history: an `nl.list` with `itemsBinding = {"kind":"pageProp","key":"messages"}`,
  `itemStructId = chatMsg`, `itemKeyFieldId = id`. Its row template is one `nl.container` with
  `extra.listSlot = itemTemplate` holding **two** bubbles, left and right, each with
  `bind layout.visible = field them` / `field me` and a text inside with `bind text = field text`.
  A row cannot take its colour or side from a field any other way: the two-bubble switch is the
  pattern. Bubbles are a fixed size; size them for the longest line.
- The replies: a second `nl.list` (struct `chatReply`: `id`, `text`, the answer `reply`, a `score`,
  a `tag`, a `round`), its rows containers with `navigation.focusable = always` so a pad or the
  keyboard can pick one - and give that container a look for `{"conditions":{"focused":true}}`
  (an appearance row, as hover looks are written; `ui-format`), or the player cannot see which reply
  the focus is on.
- A "put the phone down" `nl.button`, `layout.visible = false` until the last round.

**2. The replies' blueprint** (on the reply list, `widgetMain`). The list nodes come twice: the
`blueprint.list.*` ones act on the list whose blueprint they are in, the `blueprint.element.list.*`
ones on the list an `Element` node points at - use those for the history.

- `blueprint.event.head.init` -> `blueprint.list.setItems` with round one's replies (a blueprint
  var of type array).
- `blueprint.event.head.itemClick` -> `blueprint.data.memo` the item -> read its fields with
  `blueprint.data.jsonGet` (Get JSON Field, `path = text`) -> `blueprint.data.jsonMakeObject` a
  `chatMsg` (`them=false`, `me=true`) -> `blueprint.element.list.appendItem` on the history ->
  `blueprint.element.list.scrollToBottom` -> `blueprint.flow.delay` 0.8 -> the answer as a
  `chatMsg` with `them=true` -> append -> scroll.
- Record what was chosen with `blueprint.saved.set`. A field read out of the item is JSON: put
  `blueprint.data.toFloat` before adding a score, `To String` before a `Concat`. Branch on `round`:
  the next round's replies, or hide the list and show the button.

**3. Closing**: the button's `Mouse Click` -> `Close This Layer` with a `result` (say `true`).

**4. The story**:

```
The phone buzzes on the desk.
/page 手机 into=看完聊天
/if 好感 >= 3
  I keep smiling at the screen.
```

The story waits on the `/page` row until the page closes; `into=` gets the result (Back - Esc -
closes it with none, and the variable keeps its default, which is how "put it down without
answering" reads). The saved variables the replies set are there for every `/if` after it.

A page opened over the story covers what is under it: a quick-menu element (an affection meter,
say) sitting where the phone is drawn is hidden while it is open.

**Check it**: `playtest_click` a reply row by `index`; the answer names the words the history
gained and the variables that changed. `playtest_variables` shows them all.
`ui_screenshot` the page with its `items` sample to judge the bubbles before playing.

## Templates instead

`ui_templates` lists ready-made interface sets from Studio's template store and `ui_template_apply`
adds one's pages to the project as new pages. They are visual layouts: a description says what a
screen looks like, not that it works, and the answer of `ui_template_apply` counts each page's
blueprints and bound props - for the store's themes, none. Their Start does nothing, their save
slots are not bound to saves, their log to the history or their sliders to volumes until you wire
them (`blueprint-format`; `ui_usage` and `blueprint_show` on the standard screens show how). Use them
only when the author picks one. Then:

- make its title the entry page with `ui_page_set_entry` - an applied page never is one;
- wire every control the game uses, or keep the standard screen for it and borrow only the look;
- delete the pages it replaced with `ui_page_delete` once nothing opens them, and check with
  `ui_surfaces` and `project_info` that the entry page is the one you expect.
