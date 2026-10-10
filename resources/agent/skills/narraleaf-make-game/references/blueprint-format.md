# The `.bp` format and wiring behaviour

Blueprints are node graphs that give the interface behaviour: a button that opens a page, a page that
fills a list, a value that drives a text. `blueprint_show` prints one in the `.bp` text format and
`blueprint_apply` writes one back. This page is a condensed reference. **The catalogue tools are the
truth**: `blueprint_nodes {query}` searches node types (including those of plugins loaded in the
project), and `blueprint_node {type}` prints a node's pins, its inspector fields, the graph kinds it is
allowed in and a description. Call `blueprint_node` for every node type before you use it.

## First, do you need one?

The skeleton already wires starting and continuing a game, save/load slots, every setting, the
backlog, skip, auto, hide, the quick menu, the confirm dialog and quitting. Most games need **no new
blueprint**. Reach for one only for behaviour the skeleton lacks - a button on a page you added, a
route-select screen, an unlock. And prefer a setting where there is one:

- A sound on click or hover is the element's `clickSound` / `hoverSound` prop, not a graph.
- A row's content in a list is a field binding (`bind text = field …`), not Set Text.

## A blueprint, read

```
blueprint Quit owner=widgetMain surface=narraleaf-studio:main-surface element=281a47c0-277d-4ffb-83b9-8bee6a984480

event "Ask, then quit the game"
    pressed: blueprint.event.head.mouseClick
    no: blueprint.localization.getText key=confirm.cancel
    yes: blueprint.localization.getText key=confirm.quitAnswer
    question: blueprint.localization.getText key=confirm.quit
    ask: blueprint.layer.confirm
        surfaceId = b7c1f3ae-4d2a-4a1e-9c05-6f8f2a1d4e70
        __confirmButtonPins = ["button_1_label","button_1_pressed","button_2_label","button_2_pressed"]
    quit: blueprint.page.quit

    pressed.then -> no.in
    no.next -> yes.in
    yes.next -> question.in
    question.next -> ask.in
    question.value -> ask.message
    yes.value -> ask.button_1_label
    no.value -> ask.button_2_label
    ask.button_1_pressed -> quit.in
```

- **`blueprint <name> owner=<kind> …`** opens a blueprint and says what it hangs off. Owner kinds:
  `widgetMain` (an element: `surface=` + `element=`), `surfaceMain` (a page: `surface=`),
  `componentWidgetMain` (an element inside a component definition: `component=` + `element=`; runs once
  per placement), `widgetValue` (a value blueprint driving one prop: `surface=` `element=` `prop=`),
  `globalMain` (the game's own). `ui_surfaces` prints owner fields ready to paste. `id=` is optional.
- **`event <name>`** opens a graph (a layer). Name it for its job ("Open the route map"), never
  "Layer 1". A blueprint can hold several; every event head in every layer fires.
- **`<nodeId>: <nodeType> [key=value …] [@x,y]`** declares a node. The node id is yours (`pressed`,
  `ask`); edges use it. `@x,y` is optional - unplaced nodes are laid out automatically.
- **`<key> = <value>`** under a node sets an inspector field or a literal on an unwired input.
- **`<a>.<port> -> <b>.<port>`** wires an edge; chains work (`a -> b -> c`). Leaving the port off means
  the node's only execution pin on that side. A node with two execution outputs (`if`: `true` /
  `false`) must be told which.
- **`<pin> <- <node>.<port>`** under a node is the same edge written from the input side.
- **`var <name> type=… default=…`** declares a member variable; **`script <path>`** a layer that runs one
  of the project's script files.
- Values are JSON where unambiguous, otherwise a bare word is a string.

## Writing one

1. Find the owner: `ui_surfaces {query:"<element name>"}` gives `owner=… surface=… element=…`.
2. See what is there: `blueprint_list {query}`; if the owner already has a blueprint,
   `blueprint_show {blueprint}` and edit that text. **A block replaces every graph of its owner** -
   layers you leave out are dropped.
3. Look up each node: `blueprint_nodes {query:"go page"}`, then `blueprint_node {type:"blueprint.page.go"}`.
4. `blueprint_apply {source, dryRun:true}`, read the findings, then apply for real.
5. Exercise it in a playtest (`verify-and-ship`).

Elements a blueprint refers to need stable ids: give them an explicit `id` when you add them with
`ui_patch`.

## Nodes you will reach for

Verify each with `blueprint_node` - pins and fields change.

| Type | Name | Use |
|---|---|---|
| `blueprint.event.head.mouseClick` | Mouse Click | Head: the element was clicked (`then` output). |
| `blueprint.event.head.surfaceInit` | Surface Init | Head on a page's blueprint: the page opened. |
| `blueprint.page.go` | Go Page | Open a page on top (`surfaceId` field; one `param_<id>` input per page param). |
| `blueprint.page.back` | Go back | Close the current page, back to the one under it. |
| `blueprint.page.replace` | Replace Page | Swap the current page for another (no way back). |
| `blueprint.game.startStory` | Start Game | New game, optionally at a `storyId` / `sceneId`. |
| `blueprint.game.quit` | Quit Game | Leave the playthrough. |
| `blueprint.page.quit` | Quit Application | Close the game window. |
| `blueprint.layer.confirm` | Show Confirm | Ask a question on the Confirm page; buttons are extra pins. |
| `blueprint.localization.getText` | Get Text | A translation key's text in the player's language. |
| `blueprint.saved.get` / `.set` | Get / Set Saved Var | A `saved` variable. |
| `blueprint.persistent.get` / `.set` | Get / Set Persistent | A `persistent` variable (endings seen, unlocks). |
| `blueprint.game.getEndings` / `isEndingReached` | Endings | What the player has reached. |
| `blueprint.element.ref` | Element | Points at an element (`surfaceId`, `elementId`, `elementType`). |
| `blueprint.element.displayable.setProperty` | Set Element Property | Show / hide (Property: Visible) and other props. |
| `blueprint.element.displayable.setVariant` | Set Element Variant | Switch an element's appearance variant (`variantId=selected`). |
| `blueprint.sound.play` | Play Sound | A sound that depends on something (a locked item); plain click sounds are props. |
| `if` | If | Branch on a boolean (`true` / `false` outputs). |

Conventions the skeleton follows and you should too: show and hide with Set Element Property, not
Set Element Display (which cannot revive a hidden element); one Element node per consumer; a value
typed into a node's field rather than a separate literal node where the field exists.

## The title screen's Start button

Its blueprint (`blueprint_show {blueprint:"Start"}`) holds one Start Game node whose `sceneId` names
the skeleton's first scene by id. If your opening scene is a different scene (not the renamed demo
scene), set `sceneId` to its id (from `story_list`) and apply the blueprint again, or Start will open
the old scene.

## Plugins

Nodes from plugins loaded in the project are in `blueprint_nodes` (the skeleton depends on the
bundled Gallery plugin for its Extra screen). A node from a plugin the project does not load is
`compile.unknown_node_type`. Filling the gallery with CGs and music is done in Studio's Gallery panel;
there is no tool for it - put it on the hand-over list.

## Findings

Errors (nothing is written): unknown node type (with near misses), unknown pin (with the pins the node
has), two pins that cannot be joined, an event layer with no head, a call with no target.

Warnings, deliberately: `compile.unknown_param` (a field the node does not declare - usually harmless),
`compile.incompatible_pins`, `compile.graph_dropped` (your source drops a layer the owner had - make
sure you meant it), `compile.element_type_unknown` (an Element node naming an id the project does not
hold: whatever consumes it will silently do nothing - fix it).
