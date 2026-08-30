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
  blueprint  private blueprint supported (owner=widgetMain); the player operates it, so panel
             gestures stand down over it

  parts (built with the widget; do not delete or re-parent)
    Switch Track  [nl.container]  slot=track
    Switch Thumb  [nl.container]  slot=thumb

  props (write these as `key = value` under the element)
    checked              boolean = false
    interactionDisabled  boolean = false
    trackElementId       null    = null
    thumbElementId       null    = null

  bindable props (a value blueprint may drive these)
    bind checked = blueprint <id>      # boolean
```

The prop table is what a **new** widget of that type carries, not a closed set: a
widget may hold keys its defaults do not name (`localizationKey` is the common
one), which is why writing one is a note rather than a refusal.

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
```

```
Title  appSurface  1920x1080
    owner=surfaceMain surface=narraleaf-studio:main-surface
    Root / Title / Quit  [nl.button]  owner=widgetMain surface=narraleaf-studio:… element=281a47c0-…  # Quit

Save slot  component=d8d996da-…  (slot="1" mode="save")
    Save slot / Hit area  [nl.container]  owner=componentWidgetMain component=d8d996da-… element=5d138ead-…
```

The `owner=` lines are the ones `blueprint apply` wants, and a `#` at the end of
a line names the blueprints already hanging off that element.

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
- **`<name>: <type> [id=<id>] [@x,y] [WxH]`** declares an element, and what is
  indented under it is inside it. The name is what the outline shows; the id is
  yours to choose and is what a blueprint refers to.
- **`<key> = <value>`** sets a prop. A dotted key writes one key of one object:
  `imageFill.assetId = art-1`. `layout.` / `style.` / `extra.` reach the element's
  other bags, and `animation = {…}` its enter/exit record.
- **`bind <prop> = blueprint <id>`** points a prop at a value blueprint;
  **`bind <prop> = field <fieldId>`** reads it from the list row the element is
  being drawn for. `ui widget <type>` lists which props accept either.
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
node project/app/ui.js show --project D:/path/to/project --out title.ui
```

`show` prints in the same format `apply` reads, ids and props included, so the
way to change something that exists is to dump it, edit two lines and apply it
back. Printing the shipped skeleton and compiling the result gives the same
document - twelve surfaces, eleven components and 260 elements of it - which is
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
  twelve. Structs and actions are merged by id rather than replaced.
- **Close the project in Studio first.** Nothing reloads this file on its own,
  and a running Studio will write its own copy over yours on the next save.
- **The document must already be at the current interface schema version.**
  Eleven versions' worth of migration live on the renderer's `UIDocumentService`
  and need a service to run, so `apply` refuses and says to open the project in
  Studio once. Same refusal as `blueprint apply`, same reason.
- **The first apply reorders the JSON.** The flat `elements` map comes out in
  tree order, surface by surface, rather than in whatever order a project's
  editing history left it. Nothing reads that order - every element is addressed
  by id, and so is the semantic diff - so it is one reshuffle of the text and
  nothing after it.

## What this tool does not do

- **It does not write blueprints.** Attaching a graph to a widget is
  `blueprint apply`'s job; this tool reads `uigraphs.json` to check bindings and
  to warn about orphans, and never writes it.
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
`blueprint-cli/dsl/values`.
