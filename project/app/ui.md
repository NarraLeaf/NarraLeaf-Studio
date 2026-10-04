# Interface CLI

`project/app/ui.js` answers questions about the widget catalogue, shows how the
shipped skeleton uses a widget, and reads and writes a project's interface as
text. It is to `editor/ui/uidoc.json` what `blueprint.js` is to `uigraphs.json`,
and the two are meant to be used together: `ui` puts the elements there, and
`blueprint` hangs the graphs off them.

Everything it knows about widgets comes from the declarations the editor itself
uses - the widget modules, the shared logic table, the value-binding table, the
insert palette. There is no second catalogue to keep in step: a prop renamed in a
widget module is renamed here on the next run.

```sh
node project/app/ui.js --help
```

The first run after any change under `src/` rebuilds a bundle into
`.dev/cache/ui-cli` (about a second). Runs after that take about half.

A flag the command does not declare stops the run rather than being ignored, and
so does a `--slot` or `--surface-kind` value that is not one of the ones there
are.

A `.ui` named without a directory - `title.ui` rather than `./title.ui` - lives in
`.ignored/` at the root of this checkout, which git ignores. It is the same
scratch directory `.bp` files go to, because the two tools are used on the same
task. So the editing loop is three commands and one short name:

```sh
node project/app/ui.js show  --project <dir> --surface Title --out title.ui
node project/app/ui.js check title.ui --project <dir>
node project/app/ui.js apply title.ui --project <dir> --write
```

`--out` with no filename picks one from what is being dumped, so
`show --surface "Save" --out` writes `.ignored/save.ui`.

## Finding a widget

```sh
node project/app/ui.js widgets                   # the catalogue
node project/app/ui.js widgets --insertable      # what the palette offers
node project/app/ui.js widgets --surface-kind stageSurface --slot dialog
node project/app/ui.js widget nl.list
```

`widget <type>` is the one to reach for before writing anything. It prints where
the type may be inserted, whether it takes children, the parts it builds for
itself, every prop with its default, the props a value blueprint may drive, the
event heads a private blueprint on it may carry, and its commands and readable
state:

```
nl.switch
  name       Switch
  palette    overflow, any surface
  children   structural parts only - an author may not add children
  blueprint  private blueprint supported (owner=widgetMain); the player operates it, so panel gestures stand down over it

  parts (built with the widget; do not delete or re-parent)
    Switch Track  [nl.container]  slot=track
    Switch Thumb  [nl.container]  slot=thumb

  props (write these as `key = value` under the element)
    checked              boolean = false
    interactionDisabled  boolean = false
    trackElementId       null    = null
    thumbElementId       null    = null
    hoverSound           unset   = (unset)
    clickSound           unset   = (unset)

  bindable props (a value blueprint may drive these)
    bind checked = blueprint <id>      # boolean

  events (head nodes a private blueprint on this widget may carry)
    init                     lifecycle   blueprint.event.head.init
    flush                    lifecycle   blueprint.event.head.flush
    beforeSurfaceExit        lifecycle   blueprint.event.head.beforeSurfaceExit
    afterSurfaceEnter        lifecycle   blueprint.event.head.afterSurfaceEnter
    unmount                  lifecycle   blueprint.event.head.unmount
    changed                  interaction blueprint.event.head.switchChanged
    turnedOn                 interaction blueprint.event.head.switchTurnedOn
    turnedOff                interaction blueprint.event.head.switchTurnedOff
    mouseClick               interaction blueprint.event.head.mouseClick
    mouseDoubleClick         interaction blueprint.event.head.mouseDoubleClick
    mouseEnter               interaction blueprint.event.head.mouseEnter
    mouseLeave               interaction blueprint.event.head.mouseLeave
    mouseMove                interaction blueprint.event.head.mouseMove
    mouseDown                interaction blueprint.event.head.mouseDown
    mouseUp                  interaction blueprint.event.head.mouseUp
    mouseWheel               interaction blueprint.event.head.mouseWheel
    rightClick               interaction blueprint.event.head.rightClick
    keyDown                  interaction blueprint.event.head.keyDown, blueprint.event.head.anyKeyDown
    keyUp                    interaction blueprint.event.head.keyUp, blueprint.event.head.anyKeyUp
    focus                    interaction blueprint.event.head.focus
    blur                     interaction blueprint.event.head.blur
    onAnyBroadcast           interaction blueprint.event.head.onAnyBroadcast
    onBroadcast              interaction blueprint.event.head.onBroadcast
    windowFullscreenChanged  interaction blueprint.event.head.fullscreenChanged
    windowFocusChanged       interaction blueprint.event.head.windowFocusChanged

  commands (Call Widget Command)
    setVisible  Set visible
    setEnabled  Set enabled
    setVariant  Set variant
    setChecked  Set checked
    toggle  Toggle

  readable state (Get Widget State)
    checked  Checked
    visible  Visible
    enabled  Enabled

  writable props (Set Widget Prop)
    checked  Checked
    interactionDisabled  Interaction disabled

  editor states
    (rest)  Off
    on  On

  notes
    - The track and the thumb are elements the widget built and pointed at through `trackElementId` /
      `thumbElementId`. The on/off look belongs on their appearance variants, and the thumb's travel
      on the `on` variant's `transformOffsetX`.
```

The prop table is what a **new** widget of that type carries, not a closed set: a
widget may hold keys its defaults do not name, which is why writing one is a note
rather than a refusal. The props that say where a widget's words come from - its
translation key (`localizationKey`, a text input's `placeholderLocalizationKey`)
and its marks (`rich`) - are known for each widget that has them and are never
reported. A file written before v13 may carry `localizable = true`: it is left out,
with a note (**`ui.legacy_prop`**), because a widget's own words are translated
whenever the project has a second language.

`hoverSound` and `clickSound` are on every type but `nl.root`, and are what the
inspector's Sound section writes. Each holds an audio asset id or an asset set id,
written as one key of the record: `clickSound.assetId = <id>`. Two more keys are
optional and written the same way: `clickSound.volume = 0.5` (0..1, absent is 1)
and `clickSound.audioTrackId = <track id>` (absent is the SFX track, `sound`). A
sound never loops, whatever its track's default. A click plays the sound of the
nearest element on its way up the tree that has one, so a button's own sound wins
over the card it sits on. The shipped
skeleton's buttons carry theirs this way, and keep a blueprint only for a sound
that depends on something - a locked scene card that stays silent.

A text widget's words and a button's label come from one of three places, which
the inspector offers as one choice: the element's own `text` (a button's
`label`), a translation key, or a Blueprint Value - one source, stored once. In a
file the key is `localizationKey`, and a keyed element holds no `text` or `label`
of its own: the game and the canvas show the key's source text, which `show`
prints as a comment under the key (`# words: Start`). Change the words of a keyed
element by changing the key. Keys are read whether or not the project has a
source language; a key the project does not have shows its name. The element's
own words are translated through its own unit (`ui:<elementId>.text`) whenever
the project has a second language - there is no switch for it.
A text input's `placeholder` is the same choice without the Blueprint Value: its
own words, or the key in `placeholderLocalizationKey`, whose text the canvas and
the game both show. A dialogue line's or NVL line's `text` is sample words the
canvas shows; in their slots the game draws the story's line instead. So is the
`text` or `label` of an element whose words a value blueprint or a row field
answers, or that a blueprint writes over while the game runs (`Set Text`,
`Clear Text`, `Set Label` - `Append Text` keeps the words it adds to): the
canvas shows them, a build carries none of them, and nothing translates them.

`--json` on any of these.

```sh
node project/app/ui.js structs                   # the list-item shapes Studio ships
node project/app/ui.js structs --project <dir>   # and the ones this project declares
```

## How is this normally done

```sh
node project/app/ui.js usage nl.list                   # from the shipped skeleton
node project/app/ui.js usage nl.list --limit 5 --shallow
node project/app/ui.js usage nl.list --prop itemsBinding
node project/app/ui.js usage nl.button --project <dir> # from any project instead
```

`usage` prints real occurrences, subtree and all, in the same format `apply`
reads - so an example can be pasted into a file, edited and applied. `--shallow`
stops at the element itself when the subtree is not the point. `--prop` collapses
it to what one prop is actually set to across every occurrence, with counts,
which is the fastest way to learn what a value like `itemsBinding` or
`repeatDirection` is allowed to be.

## Finding a project's surfaces

```sh
node project/app/ui.js surfaces --project D:/path/to/project
node project/app/ui.js surfaces quit --project D:/path/to/project   # only what matches
```

A project of any size has hundreds of elements, and the one being looked for
usually has a name already. The search word matches a surface, a component, an
element path or an element type; the last line says how much was left out.

```
Title  appSurface  1920x1080  entry
    owner=surfaceMain surface=narraleaf-studio:main-surface
    Root / Title / Quit  [nl.button]  owner=widgetMain surface=narraleaf-studio:… element=281a47c0-…  # Quit

Save slot  component=d8d996da-…  (slot="1" mode="save")
    Save slot / Hit area  [nl.container]  owner=componentWidgetMain component=d8d996da-… element=5d138ead-…
```

The `owner=` lines are the ones `blueprint apply` wants, and a `#` at the end of
a line names the blueprints already hanging off that element. `entry` marks the
page the game starts on.

## The text format

A `.ui` file is line-oriented and **indentation is the tree** - that is the one
difference from `.bp`, where indentation is cosmetic because a graph's shape
lives in its edges.

```
# A comment.

struct demo.artwork
    field id: string
    field caption: string label="Caption"
    field picture: image

action dismiss "Dismiss"
    key Escape

surface "Gallery" id=demo-gallery kind=appSurface size=1920x1080
    setting backgroundColor = "nlbrand:background"
    answers dismiss

    Root: nl.root @0,0 1920x1080
        Grid: nl.list @120,180 1680x760 id=demo-gallery-grid
            itemStructId = demo.artwork
            itemKeyFieldId = id
            repeatDirection = horizontal
            repeatWrap = true
            itemGap = 40

            Cell: nl.container @0,0 380x260
                Shot: nl.image @0,0 380x214
                    bind imageFill.assetId = field picture

        Back: nl.button @120,980 220x56 id=demo-gallery-back
            label = "Back"
```

- **`surface <name> [id=] [kind=] [slot=] [size=WxH]`** opens a surface. `slot=`
  makes it a stage surface mounted into that player slot (`onStage`, `dialog`,
  `notification`, `choice`, `nvl`); without one it is an app surface, which is a
  page. Under it, `setting <key> = <value>` writes surface settings and
  `answers <actionId> [consume=false]` says which of the project's actions this
  surface answers.
- **`component <name> [id=] [size=WxH]`** opens a component definition, with
  `param <id> <name> = <default>` lines for the values each instance supplies.
- **`struct <id>`** and **`action <id> <name>`** declare the two document-wide
  tables: item shapes, and what a gesture means.
- **`document <name> [id=] [entry=]`** names the document itself. `entry=` makes
  a page - by id or by name - the one the game starts on; leaving it out leaves
  the entry where it is, so applying one surface's block can never move it. A
  document that names no entry starts on the page with the id
  `narraleaf-studio:main-surface`, which is the first page a new project has.
  The pages keep their ids either way: the entry is a pointer, and nothing a
  blueprint names changes when it moves.
- **`<name>: <type> [id=<id>] [@x,y] [WxH]`** declares an element, and what is
  indented under it is inside it. The name is what the outline shows; the id is
  yours to choose and is what a blueprint refers to.
- **`<key> = <value>`** sets a prop. A dotted key writes one key of one object:
  `imageFill.assetId = art-1`. The first segment decides where the line goes:
  `layout.` / `style.` / `extra.` reach the element's other bags, `animation` is
  the element's own enter/exit record (`animation = {…}`, or `animation.enter =
  fade` for one field of it), and `props.` is a prop whatever it is called.
- **`props.animation = {…}`** is a Page widget's (`nl.frame`) override of how the
  page it shows enters and leaves inside it; unset, the page's own animation
  plays. It needs the prefix because it is the same shape of record as the
  element's own: written bare, `animation = {…}` on a Page widget is not an error,
  it makes the widget itself fade in and out and leaves the page's animation
  alone. `show` prints the override with the prefix, and `ui widget nl.frame`
  lists it that way.
- **`bind <prop> = blueprint <id>`** points a prop at a value blueprint;
  **`bind <prop> = field <fieldId>`** reads it from the list row the element is
  being drawn for. `ui widget <type>` lists which props accept either. One more
  is open to every type and is not in that list: `bind layout.visible = field
  <fieldId>`, whether the element is drawn at all for this row - the lock on a
  gallery cell, say. It reads a row's field and nothing else; a value blueprint
  for it is refused, because nothing would evaluate one.
- **`component <componentId> [param=value …]`** makes the element an instance of
  a component definition.

Values are JSON where JSON is unambiguous and a bare word otherwise: `cover`,
`1.5`, `true`, `null`, `"a string"`, `["a", "b"]`, `{"k": 1}`. A bare word is
always a string.

## Ids, and why they matter here

An element's id is resolved in three steps: the id the file gave; the id the
element already has **at the same place in the same surface**; a derived one.

The middle step is what makes editing a `ui show` dump safe - every blueprint
hanging off the surface still points at something afterwards. The last step is a
real v5 UUID derived from the surface and the element's path, so writing the same
file into two fresh projects produces the same ids, which is what makes a
template a template.

Give an explicit `id=` to anything a blueprint will refer to. That is the whole
seam between this tool and `blueprint.js`: because a `.ui` file names its own ids,
the graph can be written before or after the element.

```sh
node project/app/ui.js apply gallery.ui --project <dir> --write
node project/app/blueprint.js apply back.bp --project <dir> --write
#   blueprint "Gallery back" owner=widgetMain surface=demo-gallery element=demo-gallery-back
```

## A plugin's widgets

The catalogue is Studio's widgets. A plugin's widget joins it only when the run is
handed the plugin:

```sh
node project/app/ui.js widget acme.rating.meter --plugin D:/path/to/acme.rating
node project/app/ui.js check gauge.ui --project D:/path/to/project --plugin D:/path/to/acme.rating
```

`--plugin` takes a plugin's own directory - the one holding its `manifest.json` -
and may be given more than once. The plugin's studio entry is run the way Studio
runs it, with an `app` that records the widgets it registers and answers every
other call with nothing, and each widget goes into the same registry the editor
reads, through the same declaration checks. So what the editor refuses about a
plugin widget, this refuses too: a child under a widget that declares part slots
is `ui.not_a_part` unless its `extra.partSlot` names one of them, exactly as a
Slider's child must carry its own marker.

The plugin's code runs in this process with this process's rights - Studio's
permission gate is not here - so pass only a plugin you would build yourself.
Without `--plugin`, a plugin's widget type is `ui.unknown_widget_type`, and the
hint says to pass it.

## Checking

```sh
node project/app/ui.js check gallery.ui --project D:/path/to/project
node project/app/ui.js check --project D:/path/to/project   # what is already there
```

Two layers run. The compiler answers whether the file is written against the
widgets that exist - unknown type (with the near misses), a child under a widget
that takes none, a child that is not one of a part-owning widget's own parts, a
binding on a prop nothing can drive, a stage widget on an app surface. Then the
project layer answers whether the interface still agrees with the blueprints
beside it.

Exit code 1 means something at error severity was found; 0 means clean, warnings
and all.

The finding worth knowing about is **`ui.binding_owner_mismatch`**, at error
severity: a prop bound to a blueprint that some *other* element owns. A value
blueprint is evaluated for the element that owns it, so the prop shows nothing at
all - the shipped skeleton had exactly this on two texts of its Confirm page, and
nothing caught it because every check asked the blueprint who owned it rather
than asking the element what it pointed at.

Two more are errors for the same reason Studio's project lint makes them errors
(`ui/frame-target-missing` and `ui/frame-loop`, answered by the same shared
model): a Page widget that does not draw the page it names.

- **`ui.frame_target_missing`** - the page is not in the document.
- **`ui.frame_loop`** - the page leads back to the widget, so drawing it would
  draw the widget again inside itself and the game shows "Page loop blocked"
  instead. A page leads back when it is the widget's own page, when it places
  the component the widget is in, or when a Page widget or a component placed on
  it does, at any depth. So a card whose Page widget names the page the card is
  placed on is refused, and so is the same card in a list row or inside another
  component.

A Page widget inside a component definition is checked where it is written, and
named by the component (`"Card / Window" in component "Card"`). Checking a file
reports these for every block the file writes, and for any the file would create
elsewhere - placing a card on a page is written on the page, while the widget
that then leads back sits in the card.

`entry=` is refused when it names nothing (**`ui.entry_unknown`**) or names a
Game UI (**`ui.entry_not_a_page`**): only a page can be the entry. Checking the
project warns **`ui.entry_missing`** when the stored entry names a page the
document no longer has (the game starts on the fallback page, and Studio drops
the pointer the next time it opens the project), and **`ui.no_entry_page`** when
there is no page at all.

Two more are about words, and need `--project` (the keys are read from it):

- **`ui.words_two_sources`** - a block writes `text` or `label` on an element
  that also names a translation key, with words that are not the key's text: an
  edit that cannot show, since the key's text is what the game and the canvas
  draw. An error, with or without a source language. Words that *are* the key's -
  what `show` printed before v13 - are left out with a note
  (**`ui.words_dropped`**), since a keyed element holds no words of its own.
- **`ui.key_missing`** - a block names a key the project does not have. A warning:
  the widget shows the key's name until the key exists.

Three findings are notes rather than refusals, deliberately:

- **`ui.unknown_prop`** - see the note on the prop table above. Reported once per
  type and key, not once per element.
- **`ui.binding_blueprint_missing`** - the blueprint has not been written yet,
  which is a normal state while authoring in two files.
- **`ui.orphaned_blueprint`** - applying this would drop an element that a
  blueprint hangs off. The blueprint would stay in `uigraphs.json` with an owner
  nothing points at.

Without `--project`, the second layer does not run at all and says so.

## Reading what is already there

```sh
node project/app/ui.js show --project D:/path/to/project
node project/app/ui.js show --project D:/path/to/project --surface Title
node project/app/ui.js show --project D:/path/to/project --component "Save slot"
node project/app/ui.js show --project D:/path/to/project --surface Title --out title.ui
```

`show` prints in the same format `apply` reads, ids and props included, so the
way to change something that exists is to dump it, edit two lines and apply it
back. Printing the shipped skeleton and compiling the result gives the same
document - twelve surfaces, three components and some two hundred and fifty elements of it - which is
asserted in `dsl/roundTrip.test.ts`.

## Writing

```sh
node project/app/ui.js apply gallery.ui --project D:/path/to/project           # dry run
node project/app/ui.js apply gallery.ui --project D:/path/to/project --write
```

`apply` checks first and writes nothing if anything is at error severity.

Four things to know before using it:

- **A block describes a whole surface, or a whole component.** Applying one
  replaces its element tree entire, including elements the file does not mention -
  `ui.element_dropped` and `ui.orphaned_blueprint` name them first. Blocks the
  file does not contain are left alone, so a file may be one surface out of
  twelve. Structs and actions are merged by id rather than replaced. A blueprint
  hanging off a dropped element is `blueprint remove`'s to take away, before the
  apply.
- **An item shape goes with the last list that named it.** That is the editor's
  own rule: a struct no list names is invisible to an author, and left in the
  table it would be picked up again, under its old name, the next time somebody
  declares the same fields. So a shape the apply stops naming is dropped and the
  summary says so. A shape the file itself declares is kept whether or not
  anything names it yet, and one nothing named before the apply is left alone.
- **Close the project in Studio first.** Nothing reloads this file on its own,
  and a running Studio will write its own copy over yours on the next save.
- **The document must already be at the current interface schema version.**
  The migration lives on the renderer's `UIDocumentService` and needs a service to
  run, so `apply` refuses and says to open the project in Studio once. Same refusal
  as `blueprint apply`, same reason. A v12 document is still *read* as v13 by
  `show`, `check` and `surfaces` - through the same step Studio runs on opening it -
  because that step also edits the translation files, which only Studio writes.
- **The first apply reorders the JSON.** The flat `elements` map comes out in
  tree order, surface by surface, rather than in whatever order a project's
  editing history left it. Nothing reads that order - every element is addressed
  by id, and so is the semantic diff - so it is one reshuffle of the text and
  nothing after it.

## Removing a component definition

```sh
node project/app/ui.js remove --project D:/path/to/project --component "Old entry"           # dry run
node project/app/ui.js remove --project D:/path/to/project --component "Old entry" --write
```

`apply` replaces a component's element tree but never takes the definition away,
so a component nothing places any more stays in the library until somebody
deletes it. `remove` does that, and takes everything the definition owns with
it: its elements, which live inside it, and its blueprints in `uigraphs.json`
together with the owner entries that point at them - so no orphan is left for
Studio to collect the next time it opens the project.

- **One definition, named exactly.** `--component` takes an id or a whole name;
  a name two definitions share lists their ids and removes neither.
- **Only a definition nothing uses.** Each of these is a refusal,
  `ui.remove_refused`, that says where it is, and nothing is written:
  - a placement of it, on any surface or inside another component;
  - one of its own blueprints that holds anything - nodes, a script layer,
    members. Removing the definition would throw that work away with it; empty
    the blueprint with `blueprint apply`, or take it out with `blueprint remove`,
    first if that is what is meant;
  - any other blueprint, element or document-wide record that names the
    definition, one of its elements or one of its blueprints - an Element card
    pointing into it, a variable read from one of its blueprints;
  - any other authored file of the project that names one of those ids: what is
    under `editor/` (but Studio's caches), and the scripts under `scripts/` (but
    their generated declarations and installed packages).
- **Close the project in Studio first**, for the same reason as `apply`. Both
  documents must be at the current schema version, and both are checked before
  either is written.

Studio lets an author delete a placed component after one confirm, and every
placement then draws nothing. That is a decision for someone looking at the
canvas; a command run from a script has nobody to ask, which is why this one
refuses instead.

## What this tool does not do

- **It does not write blueprints.** Attaching a graph to a widget is
  `blueprint apply`'s job; this tool reads `uigraphs.json` to check bindings and
  to warn about orphans. The one thing it takes out of that file is what
  `remove` takes with a component definition - its own, empty blueprints.
- **It does not know what a widget means.** The catalogue is derived, and a
  derivation cannot say that a container written with `fillVisible = false` alone
  still paints white. The handful of facts like that are in the `notes` block of
  `ui widget <type>`, hand-written and deliberately few; everything else is
  `ui usage`.

## Where this lives

The wrapper is `project/app/ui.js`; the commands are TypeScript under
`src/renderer/lib/ui-cli/`, because that is where the widget module registry and
the tables it reads are. `dsl/` holds the format: `parse` (text to AST), `compile`
(AST to document records, checked against the catalogue), `print` (the inverse).
The scalar syntax is shared with `.bp` rather than restated -
`blueprint-cli/dsl/values`. `remove.ts` is the `remove` command's plan, and it
writes `uigraphs.json` through the blueprint tool's own reader and writer, so one
place still knows how that file is written.
