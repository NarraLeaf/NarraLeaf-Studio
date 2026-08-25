# Blueprint CLI

`project/app/blueprint.js` answers questions about the blueprint node catalogue,
compiles blueprints written as text into a project, and checks them before they
get there. It exists so that authoring a blueprint does not mean either grepping
fifty files under `src/renderer/lib/ui-editor/blueprint-nodes/built-in` or
driving the canvas through CDP.

Everything it knows comes from the registry the editor itself uses. There is no
second catalogue to keep in step: a node added to the registry is in
`blueprint nodes` on the next run, and a pin renamed there renames here.

```sh
node project/app/blueprint.js --help
```

The first run after any change under `src/` rebuilds a bundle into
`.dev/cache/blueprint-cli` (about a second). Runs after that take about half.

## Finding a node

```sh
node project/app/blueprint.js nodes save slot        # search name, type, keywords, category
node project/app/blueprint.js nodes --category Sound
node project/app/blueprint.js nodes --owner widgetMain --widget nl.button
node project/app/blueprint.js categories
node project/app/blueprint.js node blueprint.sound.play
```

`node <type>` is the one to reach for before writing anything. It prints the
pins with their direction and value type, the inspector fields and where their
options come from, the graph kinds the node is allowed in, and its scope:

```
blueprint.sound.play
  name       Play Sound
  graphs     event, macro
  traits     effectful, async (not allowed in function graphs)

  inputs
    in       exec  - In
    loop     data:boolean, optional, takes a literal  - Loop
    volume   data:float, optional, takes a literal  - Volume

  outputs
    next    exec  - Next
    handle  data:SoundHandle  - Handle

  fields (write these as `key = value` under the node)
    soundAssetId  audioAsset  - Audio Clip
    audioTrackId  choose from the project's audioTracks  - Track
```

`--owner` filters to what the add-node palette would offer for that owner kind
(`globalMain`, `surfaceMain`, `widgetMain`, `widgetValue`, `componentWidgetMain`,
`sharedAsset`, `storyAction`); `--widget` narrows a widget owner to one element
type, which is what decides its event heads. `--all` includes nodes kept for old
graphs but hidden from the palette. `--json` on any of these.

## Finding a project's surfaces, components and elements

An owner line needs ids. This prints them, already spelled as owner fields:

```sh
node project/app/blueprint.js targets --project D:/path/to/project
```

```
Title  owner=surfaceMain surface=narraleaf-studio:main-surface
    Root / Title / Quit  [nl.button]  owner=widgetMain surface=narraleaf-studio:main-surface element=281a47c0-…

Save slot  component=d8d996da-…  (slot="1")
    Save slot / Hit area  [nl.container]  owner=componentWidgetMain component=d8d996da-… element=5d138ead-…
```

The component sections come after the surfaces, with each definition's params in brackets. A
component's elements live in its own table rather than in the document's, so they are the ids a
`componentWidgetMain` blueprint refers to - and the params are what a `Get Component Param` node
picks from. **A blueprint on a component definition runs once per instance, with that instance's
param values**, which is the whole reason to write one: twelve save slots that differ by a string
are one graph, not twelve.

## The text format

A `.bp` file is line-oriented. Indentation is cosmetic - what a line means comes
from what it contains and from the block it is in.

```
# A comment.

blueprint "Quit confirm" owner=widgetMain surface=<surfaceId> element=<elementId>

event "On click"
    click: blueprint.event.head.mouseClick
    ask: blueprint.layer.confirm surfaceId=<surfaceId>
        message = "Really quit?"
        __confirmButtonPins = ["button_1_label", "button_1_pressed"]
        button_1_label = "Quit"
    bye: blueprint.game.quit

    click -> ask
    ask.button_1_pressed -> bye
```

- **`blueprint <name> owner=<kind> …`** opens a blueprint. Owner fields are
  `surface` / `element` / `prop` / `component` / `asset` / `blueprint` / `mode`,
  whichever that owner kind needs. `id=` is optional; without it, the blueprint
  that already occupies the same owner keeps its id.
- **`event <name>`** and **`function <name>`** open a graph. `id=` optional; a
  layer is matched to an existing one by name when no id is given.
- **`<nodeId>: <nodeType> [key=value …] [@x,y]`** declares a node. The id is
  yours to choose and is what edges refer to. `@x,y` places the card; without
  it, a node keeps the position it already had in the project, or gets one from
  the shape of the graph.
- **`<key> = <value>`** under a node sets an inspector field, or writes a
  literal into an unwired data input pin. Either spelling of the same idea -
  `blueprint node <type>` lists both.
- **`<pin> <- <node>.<port>`** under a node wires one of its inputs.
- **`<a>.<port> -> <b>.<port>`** wires an edge, and chains: `a -> b -> c`.
  Leave a port off and it means the node's only execution pin on that side, or
  its only data pin if it has no execution pins - so `click -> ask` and
  `text -> log.value` both work. A node with two execution outputs (`if`) has to
  be told which.
- **`var <name> [type=…] [default=…]`** under a blueprint declares a member
  variable.

Values are JSON where JSON is unambiguous and a bare word otherwise: `sound`,
`1.5`, `true`, `null`, `"a string"`, `["a", "b"]`, `{"k": 1}`. A bare word is
always a string.

## Checking

```sh
node project/app/blueprint.js check my.bp --project D:/path/to/project
node project/app/blueprint.js check --project D:/path/to/project   # what is already there
```

Two layers run. The compiler answers whether the file is written against the
catalogue that exists - unknown node type (with the near misses), unknown pin
(with the pins the node does have), a field the node does not declare, two pins
that could not be joined on the canvas. Then the editor's own graph validator
answers whether it is a graph that would run - an event layer with no head, a Fn
call with no target, a variable ref that resolves to nothing.

Exit code 1 means something at error severity was found; 0 means clean, warnings
and all.

Three findings are warnings rather than refusals, deliberately:

- **`compile.unknown_param`** - a node definition declares the fields its
  inspector renders, not every key the editor may store on it. `Element` keeps
  the surface and element it points at in params and declares neither.
- **`compile.incompatible_pins`** - the canvas refuses to *draw* a pairing whose
  value types do not fit, but a document already holding one loads and runs, and
  the shipped skeleton contains one.
- **`compile.graph_dropped`** - see below.

One finding is a note rather than silence, and one thing is filled in rather than demanded:

- **`compile.element_type_unknown`** - an `Element` node names an id the project does not hold.
  Every node that follows an element reference checks its type before doing anything, so a
  reference that cannot be resolved reads as nothing at all and whatever consumed it quietly does
  not fire.
- An `Element` node written with `surfaceId` and `elementId` gets `elementType` **filled in** from
  the project, so a hand-written reference does not have to carry a line no author would think to
  write. Without `--project` there is nothing to look it up in, so write the type yourself.

Two limits worth knowing:

- A `Get Persistent` / `Get Saved` node is checked against the project's variable
  registry (`editor/variables.json`). The same scopes can also be declared by a
  `/save` or `/global` row inside a story document, and those are not read here,
  so a node pointing at one is reported as unresolved. Warning, never a refusal.
- Widget scope checks need the interface document, so pass `--project` when
  checking a `widgetMain` blueprint or they are skipped rather than guessed at.

## Reading what is already there

```sh
node project/app/blueprint.js list --project D:/path/to/project
node project/app/blueprint.js show --project D:/path/to/project --blueprint "Quit"
node project/app/blueprint.js show --project D:/path/to/project --out quit.bp
```

`show` prints in the same format `apply` reads, ids and positions included, so
the way to change an existing blueprint is to dump it, edit two lines and apply
it back. Printing a blueprint and compiling the result gives the same graph -
that is asserted against all 390 blueprints in the shipped skeleton.

## Writing

```sh
node project/app/blueprint.js apply my.bp --project D:/path/to/project           # dry run
node project/app/blueprint.js apply my.bp --project D:/path/to/project --write
```

`apply` checks first and writes nothing if anything is at error severity. It
writes `editor/ui/uigraphs.json` the way `UIGraphService` does, so the file it
leaves and the file Studio leaves are the same shape.

Three things to know before using it:

- **A file describes a whole blueprint.** Applying it replaces every graph of
  the blueprint that occupies that owner, including layers the file does not
  mention - `compile.graph_dropped` names them before it happens. Start from
  `show` when editing something that exists.
- **Close the project in Studio first.** Nothing reloads this file on its own,
  and a running Studio will write its own copy over yours on the next save.
- **The document must already be at the current blueprint schema version.** The
  migration that lifts an older one needs a service to seed the variable
  registry as it runs, so it cannot happen here; `apply` refuses and says to
  open the project in Studio once.

## Where this lives

The wrapper is `project/app/blueprint.js`; the commands are TypeScript under
`src/renderer/lib/blueprint-cli/`, because that is where the node registry and
the graph validator are. `dsl/` holds the format: `parse` (text to AST),
`compile` (AST to graphs, checked against the registry), `print` (the inverse),
`layout` (positions for nodes nobody placed).
