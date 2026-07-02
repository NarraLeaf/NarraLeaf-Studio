# UI Editor Blueprint Node Development Guide

This guide explains how Studio blueprint nodes are defined, registered, displayed in the editor palette, and executed at runtime. It is intended for contributors who need to add new nodes after the built-in catalog was reduced to the current starter set.

## Current built-in catalog

The current core catalog includes event heads, local variables, flow branching and sequencing, Data utilities, Math utilities, Debug nodes, and documented UI-domain nodes.

| Node type | Display name | Category | Purpose |
| --- | --- | --- | --- |
| `blueprint.event.head.appBoot` | `App Boot` | `Events` | Entry node for the global UI runtime startup event. It is only available on `globalMain` blueprints. |
| `blueprint.event.head.surfaceInit` | `Surface Init` | `Events` | Entry node for Page/Game UI surface initialization. It is only available on `surfaceMain` blueprints. |
| `blueprint.event.head.surfaceUnmount` | `Surface Unmount` | `Events` | Entry node for Page/Game UI surface unmount. It is only available on `surfaceMain` blueprints. |
| `blueprint.event.head.keyDown` | `On Key Down` | `Events` | Entry node for runtime window keyboard down events filtered by a case-insensitive `KeyboardEvent.key` card field. It is available on `globalMain`, active `surfaceMain`, and mounted widget private blueprints. |
| `blueprint.event.head.keyUp` | `On Key Up` | `Events` | Entry node for runtime window keyboard up events filtered by a case-insensitive `KeyboardEvent.key` card field. It is available on `globalMain`, active `surfaceMain`, and mounted widget private blueprints. |
| `blueprint.event.head.anyKeyDown` | `Any Key Down` | `Events` | Entry node for any runtime window keyboard down event. It outputs `key` plus modifier pins. |
| `blueprint.event.head.anyKeyUp` | `Any Key Up` | `Events` | Entry node for any runtime window keyboard up event. It outputs `key` plus modifier pins. |
| `blueprint.event.head.init` | `Init` | `Events` | Entry node for widget initialization and Blueprint Value initial evaluation. It is available to widgets that expose the `init` lifecycle event and to `widgetValue` blueprints. |
| `blueprint.event.head.mouseClick` | `Mouse Click` | `Events` | Entry node for widget mouse click interactions and Surface-level click events. In `surfaceMain` blueprints it fires for any click inside the current Surface and outputs `x` / `y` in Surface design coordinates. |
| `blueprint.event.head.flush` | `On Flush` | `Events` | Entry node fired on the current widget after explicit Host API element property changes trigger a redraw. It also acts as a Blueprint Value refresh entry and outputs the flushed Element reference. |
| `blueprint.event.head.elementFlush` | `Element Flush` | `Events` | Element-bound event head that listens for another same-Surface element's flush event and outputs that Element reference. |
| `blueprint.event.head.elementClick` | `Element Click` | `Events` | Element-bound event head that listens for another same-Surface element's own mouse click and outputs that Element reference plus click payload. |
| `blueprint.event.head.scroll` | `Scroll` | `Events` | Entry node for List scroll interactions. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.scrollEnd` | `Scroll End` | `Events` | Entry node fired when a List runtime scrolls from non-end to the scroll end. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.itemRender` | `Item Render` | `Events` | Entry node fired for each rendered List item scope. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.itemClick` | `Item Click` | `Events` | Entry node fired when a rendered List item is clicked. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.itemHover` | `Item Hover` | `Events` | Entry node fired when the pointer enters a rendered List item. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.selectionChanged` | `Selection Changed` | `Events` | Entry node fired when a List item click changes the runtime selected index. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.listItemRefresh` | `List Item Refresh` | `Events` | Entry node fired on item template descendant elements when a List item instance receives `props`, `item`, `index`, `count`, and `key`. |
| `blueprint.event.head.sliderDragStart` | `Drag Start` | `Events` | Entry node fired when a Slider runtime drag starts. It is available to `nl.slider` widget private blueprints and outputs the mapped `value`. |
| `blueprint.event.head.sliderValueChanged` | `Value Changed` | `Events` | Entry node fired when a Slider runtime value changes by interaction. It outputs mapped `value` and `previousValue`. |
| `blueprint.event.head.sliderDragEnd` | `Drag End` | `Events` | Entry node fired when a Slider runtime drag ends. It outputs the mapped `value`. |
| `blueprint.event.head.pageEvent` | `Page Event` | `Events` | Entry node for Page component child-to-parent events. It is available to `nl.frame` widget private blueprints. |
| `blueprint.page.go` | `Go Page` | `Page` | Terminal exec node that opens a selected Page through the host navigation path with optional Page props; during an active game it opens the Page as a UI overlay above the game stage. |
| `blueprint.page.getProps` | `Get Page Props` | `Page` | Pure node that reads the current Page props object. It is available to Page/Widget and Blueprint Value graphs, and is not available in Global blueprints. |
| `blueprint.page.quit` | `Quit` | `Page` | Terminal latent node that exits the current application runtime. In Studio Dev Mode it stops the Dev Mode session instead of terminating Studio itself. |
| `blueprint.game.startStory` | `Start Game` | `Game` | Terminal latent node that starts a selected Story / Scene in the NarraLeaf game runtime and hides the current app Page stack behind the game stage. |
| `blueprint.game.getNametag` | `Get Nametag` | `Game` | Pure node that reads the current NarraLeaf Dialog speaker name, returning `null` when none is active; usable in Blueprint Value. |
| `blueprint.game.isInGame` | `Is In Game` | `Game` | Pure node that returns whether Dev Mode currently has an active NarraLeaf game stage, including while a Page UI overlay is open; usable in Blueprint Value. |
| `blueprint.game.quit` | `Quit Game` | `Game` | Terminal latent node that exits the active NarraLeaf game state and opens the selected return Page. |
| `blueprint.game.next` | `Next` | `Game` | Latent exec node that triggers NarraLeaf's virtual click path for the active live game. |
| `blueprint.game.skip` | `Skip` | `Game` | Latent exec node that calls NarraLeaf `LiveGame.skipDialog()` for the active game session. |
| `blueprint.game.showDialog` | `Show Dialog` | `Game` | Latent exec node that sets NarraLeaf React `showDialog` preference to `true`. |
| `blueprint.game.hideDialog` | `Hide Dialog` | `Game` | Latent exec node that sets NarraLeaf React `showDialog` preference to `false`. |
| `blueprint.game.toggleDialogDisplay` | `Toggle Dialog Display` | `Game` | Latent exec node that toggles the current NarraLeaf React `showDialog` preference. |
| `blueprint.game.setSentenceSpeed` | `Set Sentence Speed` | `Game` | Latent exec node that writes sentence `cps` through the NarraLeaf Preference API. |
| `blueprint.game.save.write` | `Write Save` | `Game` | Latent node that serializes the active NarraLeaf live game into a project-scoped local save id, with optional blueprint `json` metadata. |
| `blueprint.game.save.load` | `Load Save` | `Game` | Terminal latent node that abandons current game progress, deserializes a project-scoped local save, and leaves subsequent Page navigation as game-stage UI overlays. |
| `blueprint.game.save.delete` | `Delete Save` | `Game` | Latent node that deletes a project-scoped local save id and continues even when the target is already absent. |
| `blueprint.game.save.listIds` | `List Saves` | `Game` | Latent node that lists project-scoped local save ids as an `Array<String>` / `string[]` contract over the blueprint `array` pin type. |
| `blueprint.game.save.getMetadata` | `Get Save Metadata` | `Game` | Latent node that reads user metadata from a project-scoped local save as the standard blueprint `json` pin type. |
| `blueprint.game.save.getPreview` | `Get Save Preview` | `Game` | Latent node that reads a save preview image as a temporary `ImageAsset|null` without importing it into project assets. |
| `blueprint.frameWidget.setTargetPage` | `Set Frame Page` | `Frame` | Exec node that switches the current `nl.frame` Page control to the selected Page and can optionally write Page props into the Frame params. It is available in `nl.frame` private blueprints. |
| `blueprint.element.frame.setTargetPage` | `Set Frame Page` | `Element` | Exec node that switches a bound `nl.frame` Element reference to the selected Page and can optionally write Page props into the Frame params. It can be derived from a bound Frame Element reference. |
| `blueprint.data.returnValue` | `Return Value` | `Data` | Exec sink that returns the produced value from a Blueprint Value graph. It is only available on `widgetValue` blueprints. |
| `blueprint.element.ref` | `Element` | `Element` | Same-Surface magic element literal. It stores `{ surfaceId, elementId, elementType }`, outputs `element` or `element:<widgetType>`, and can fan out like other literals. |
| `blueprint.element.continueEventBubble` | `Continue Event Bubble` | `Element` | Latent node for widget event graphs that re-dispatches the active element event to the current element's parent and then continues through `next`. |
| `blueprint.element.text.*` | Text element nodes | `Text` | Element-targeted Text nodes with a separated top `element:nl.text` input. Read nodes are pure; write nodes remain event/macro only. |
| `blueprint.element.displayable.*` | Displayable element nodes | `Element` | Element-targeted `Get Element Display` / `Set Element Display`, `Get Element Property` / `Set Element Property`, `Set Element Variant`, property animation, and token-targeted animation stopping. Old fixed Displayable get nodes remain registered for compatibility but are hidden from new authoring. |
| `blueprint.local.declareVar` | `Var` | `Variables` | Pinless graph declaration node for blueprint-level lifecycle locals. It is available on all blueprint owners except Blueprint Value (`widgetValue`). |
| `blueprint.local.get` | `Get Var` | `Variables` | Pure data node that reads an execution-local blueprint variable. |
| `blueprint.local.set` | `Set Var` | `Variables` | Exec node that writes an execution-local blueprint variable and continues through `next`. |
| `blueprint.persistent.get` | `Get Persistent` | `Variables` | Latent exec node that reads a project-level Persistent variable from host-managed storage and outputs the authored default when no saved value exists. |
| `blueprint.persistent.set` | `Set Persistent` | `Variables` | Latent exec node that writes a project-level Persistent variable through host-managed storage. |
| `if` | `If` | `Flow` | Exec branch node that routes execution through `true` or `false` based on a boolean condition. |
| `blueprint.flow.ifElse` | `If Else` | `Flow` | Exec branch node with addable `If` conditions, matching `Then` outputs, and a final `Else` fallback output. |
| `blueprint.flow.*` | Flow utilities | `Flow` | `Noop`, `Sequence`, `Switch String`, bounded loops, `Delay`, `Skip Delay`, and `Return`. |
| `blueprint.data.*` | Data utilities | `Data` | String, Integer, Float, Boolean, Null, Color, Vector2D, and Rect literals, explicit conversions, JSON helpers, string helpers, parse helpers, and type/empty-value checks. |
| `blueprint.collection.*` | Collection utilities | `Data` | Pure array/object helpers for length/get/set/push/insert/remove/removeAt/contains/slice/join and object keys/values/merge/set/remove. `arrayFind/filter/map/sort` are reserved planned/disabled ids and are not registered in the palette/runtime. |
| `blueprint.math.*` | Math utilities | `Math` | Pure arithmetic, modulo, increment/decrement, abs, min/max, rounding, random numbers, boolean logic, strict equality, numeric comparison, and legacy numeric comparison nodes. |
| `blueprint.boolean.*` | Boolean logic | `Math` | Pure `And`, `Or`, `Not`, and `Xor`; grouped under Math in the palette. |
| `blueprint.compare.*` | Value comparison | `Math` | Pure strict equality and numeric comparison nodes grouped under Math. `Equal` / `Not Equal` use JavaScript `===` / `!==` semantics. |
| `blueprint.slider.*` | Slider utilities | `Slider` | Element-derived nodes for a bound `nl.slider` Element Literal, Element Flush, or Element Click, including `Get Value` for mapped values; the derived label appears as `Slider:Get Value`. Derived entries do not auto-connect. |
| `blueprint.list.*` | List utilities | `List` | Element-derived nodes for a bound `nl.list` Element Literal, Element Flush, or Element Click plus item-template context reads. Derived entries do not auto-connect. |
| `blueprint.flow.comment` | `Comment` | `Debug` | Graph-only multi-line comment box with color, background, and size controls. Background-off comments sit behind other nodes for framing. It does not participate in execution. |
| `blueprint.log` | `Log` | `Debug` | Exec node that writes a string value to DevTools/browser logs and continues through `next`. |

Node categories are still part of the node API and palette model. Do not remove category handling when trimming or adding nodes; categories are how the add-node palette groups nodes.

Event-head nodes are surfaced in the canvas add-node palette for the current Blueprint owner and widget event slot. The left member tree's `Layers > New` flow also has an optional Event field; it defaults to `-` and creates an empty layer unless the user explicitly selects an event head to insert.

## Important files

| File | Responsibility |
| --- | --- |
| `src/renderer/lib/ui-editor/blueprint-nodes/types.ts` | Public TypeScript model for node definitions, pins, inspector params, categories, graph-kind availability, scopes, and palette entries. |
| `src/renderer/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry.ts` | Central editor/runtime registry. It validates node definitions, stores them by `type`, exposes palette entries, and registers runtime behavior definitions. |
| `src/renderer/lib/ui-editor/blueprint-nodes/defineBlueprintNode.ts` | Public helper API for registering one or more node definitions. |
| `src/renderer/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes.ts` | One-shot registration entry point for built-in nodes. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/index.ts` | Built-in node catalog aggregation. Add a new built-in node here when it should ship in Studio by default. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/events/eventHeadNodes.ts` | Built-in event entry-head nodes, including lifecycle, widget input, scroll, broadcast, and Page Event heads. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/collectionNodes.ts` | Built-in Data / Collection array and object pure nodes. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/gameNodes.ts` | Built-in Game nodes for NarraLeaf runtime state/control, Dialog operations, and local save read/list/write/delete/preview operations. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/listNodes.ts` | Built-in List runtime nodes for content, selection, scrolling, and item context reads. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/frameNodes.ts` | Built-in Page navigation plus Page component host nodes for Frame params and child-to-parent Page events. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/sliderNodes.ts` | Built-in Slider widget nodes for value/range reads and runtime value/range writes. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/localVariableNodes.ts` | Built-in local variable nodes. Currently `Var`, `Get Var`, and `Set Var`. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/persistentVariableNodes.ts` | Built-in Persistent variable nodes. Currently `Get Persistent` and `Set Persistent`. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/mathNodes.ts` | Built-in basic math and comparison nodes. |
| `src/shared/types/blueprint/graph.ts` | Shared graph taxonomy and stable node type constants. Use this for node type ids that are persisted or shared across process boundaries. |
| `src/shared/types/ui-editor/widgetLogic.ts` | Widget logic capability catalog. Event slots here determine what widget event heads can appear for each widget type. |
| `src/shared/types/ui-editor/blueprintLifecycle.ts` | Global and surface owner event capability catalog for `globalMain` and `surfaceMain` owners. |
| `src/shared/types/ui-editor/graph.ts` | Persisted graph IR shape used by UI graph documents. |
| `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintDispatcher.ts` | Runtime dispatch for widget, broadcast, surface owner, and global owner event graphs. |
| `src/renderer/lib/ui-editor/behavior-graph/BehaviorNodeRegistry.ts` | Runtime behavior-node registry and execution context type. |

## Blueprint document concepts

A blueprint is not just a node list. The main concepts are:

- **Owner**: where the blueprint belongs. Supported owner kinds include `globalMain`, `surfaceMain`, `widgetMain`, `widgetValue`, `componentWidgetMain`, and `sharedAsset`.
- **Program kind**: currently graph-based visual programs and script modules are represented separately.
- **Graph kind**: each graph declares semantic rules through `event`, `function`, or `macro`.
- **Members**: blueprint-owned variables, fields, and function signatures.
- **Bindings**: data connections between blueprint fields and UI/widget properties.
- **Graph IR**: persisted nodes and edges, including node `params`, `meta`, and editor layout.

When adding a node, make sure you know which owner kinds and graph kinds it should support. A node that mutates UI state usually belongs in `event` and/or `macro` graphs, while a pure calculation node can also be available in `function` graphs.

## Variables and JSON-safe defaults

`BlueprintVariable.defaultValue` and `BlueprintPersistentVariable.defaultValue` store JSON-safe recursive values directly. String, numeric, boolean, `null`, JSON object, and Array defaults should be persisted as their real values, not stringified JSON. Blueprint lifecycle variables are initialized from their `Var` defaults the first time that blueprint owner/runtime scope needs a local store, then reused across event chains until that blueprint owner instance is released or remounted. Defaults are deep-cloned at store creation so object/array mutations do not mutate authored defaults. All blueprint owner kinds except `widgetValue` declare blueprint-level variables with graph `Var` nodes; `widgetValue` blueprints cannot declare `Var` nodes and may only read/write accessible Page/Blueprint/Global variables through `Get Var` / `Set Var` when available. Legacy `members.variables` entries remain a hidden compatibility fallback. Persistent variable definitions live in the Blueprint document as project-level members; saved values live in host-managed Studio storage under the variable's stable `storageKey`.

`Get Var` and `Set Var` infer their `value` pin type from the currently selected variable. The editor uses this inferred type for pin labels, connection previews, and graph validation. If a later variable type change makes an existing edge incompatible, the edge remains in the graph and validation reports the type mismatch instead of deleting the connection.

The variable creation UI includes `JSON` with default `{}` and `Array` with default `[]`. The `array` variable/pin type can feed `json` inputs because arrays are JSON values. `Any` variables are initialized to `null`; the Var node shows this as a disabled single-line `null` field because the initial runtime value is intentionally not author-editable.

## Blueprint Value

Blueprint Value is a per-property dynamic value provider. A `widgetValue` private owner is keyed as `widgetValue:<surfaceId>:<elementId>:<encodedPropPath>`, and the UI document stores the active binding on the element in `valueBindings`. The current supported targets are `nl.text` -> `props.text`, `nl.button` -> `props.label`, `nl.frame` -> `props.params`, and `nl.slider` -> `props.value`.

Value blueprints are visual graph programs only. They are seeded with one `init` event graph that returns the current literal value through `blueprint.data.returnValue`. `string` values seed a String literal, `json` values seed a JSON literal, and `float` values seed a Float literal. On mount, the value runtime executes the available value head (`init` or `flush`), records Element/property reads made while resolving data pins, and reruns the binding when those recorded Same-Surface element properties change. Host global state changes refresh all started value bindings so pure host reads such as Game `Get Nametag` and `Is In Game` can update without remounting. Evaluation is serialized per binding so an in-flight run is followed by at most one latest pending rerun.

If a value graph does not execute `returnValue`, the runtime keeps the previous resolved value. If there is no previous resolved value, the widget uses its literal prop from the UI document. String results are coerced to string, and `null` becomes an empty string. Page `params` expects a JSON object; non-object results fall back to `{}`. Slider `value` expects a finite float and is clamped/snapped against the authored `min` / `max` / `step` range.

When a Blueprint Value belongs to an element repeated by an `nl.list` item template, evaluation receives the current `listItemScope` and an item-specific `instanceKey`. Pure List item context nodes (`Get List Item Props`, `Index`, `Count`, `Key`) read that scope, and each repeated item keeps a separate runtime value even though the source element id is the same.

The Blueprint Value palette is intentionally restricted to safe value-producing nodes: the `Init` and `On Flush` event heads, non-latent flow, graph comments, pure Data/Math/List nodes, local variable reads/writes, Element literals, pure Element-targeted Text/Displayable/Slider reads, and pure Game reads such as `Get Nametag` and `Is In Game`. Surface/global state read/write nodes are not part of the core catalog; `Var` declarations, widget mutations, navigation, Persistent variable reads/writes, broadcasts, latent nodes, and TypeScript revisions are blocked for `widgetValue` owners.

## List runtime and item context

`Set List Content` writes an instance-level runtime item array for an `nl.list`. List mutation nodes (`append`, `insert`, `remove`, `clear`, `refresh`) update the same runtime store and cause the List to render from that store. List control nodes are exposed from bound `nl.list` Element Literals in the active graph rather than globally in every blueprint. `itemsBinding` is only a fallback when no runtime items have been written. When the List component instance fully unmounts, runtime items, selection, and scroll commands are cleared; authors should persist and restore list content explicitly through variables or state when needed.

List item template descendants receive `blueprint.event.head.listItemRefresh` when an item instance refreshes. The event payload provides `props`, `item`, `index`, `count`, and `key`. `props` is the item object when `item` is an object; otherwise it is `{ value: item }`. The same values are available to event graphs and Blueprint Value graphs through pure List context nodes.

Repeated item descendants are isolated by `instanceKey` and `listItemScope`. This prevents multiple rendered copies of the same source element id from sharing Blueprint event locals or Blueprint Value runtime values.

## Node definition API

Every editor/runtime node is a `BlueprintNodeDef` object.

```ts
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";

export const exampleNode: BlueprintNodeDef = {
    type: "blueprint.example.doThing",
    displayName: "Do thing",
    category: "Example",
    keywords: ["example", "demo"],
    graphKinds: ["event", "macro"],
    isPure: false,
    pins: [
        { id: "in", kind: "input", semantic: "exec", label: "In" },
        { id: "next", kind: "output", semantic: "exec", label: "Next" },
        { id: "value", kind: "input", semantic: "data", valueType: "string", label: "Value" },
    ],
    inspectorParams: [
        { key: "target", label: "Target", kind: "string" },
    ],
    execute(ctx) {
        // Runtime logic goes here.
        return { nextPort: "next" };
    },
};
```

### Required fields

| Field | Meaning |
| --- | --- |
| `type` | Stable node type id. It is persisted in graph documents, so treat it as a compatibility contract. |
| `displayName` | Human-readable card/palette label. |
| `category` | Palette group name. Categories must remain meaningful even when the catalog is reduced. |
| `graphKinds` | Graph kinds where the node is allowed: `event`, `function`, `macro`. |
| `isPure` | Whether the node has no side effects. Pure nodes are data providers/calculations. |
| `pins` | Ordered list of input/output pins shown on the node card. |
| `execute` | Runtime behavior. It may be synchronous or async. |

### Optional fields

| Field | Meaning |
| --- | --- |
| `keywords` | Extra search terms in the add-node palette. |
| `hideInPalette` | Keep the node registered for old graphs/runtime but hide it from new graph authoring. |
| `isLatent` | Marks async/latent execution. Latent or effectful nodes are filtered out of function graphs. |
| `dynamicInputPins` | Enables user-added variadic data input pins. |
| `inspectorParams` | Node-level configuration edited in the inspector/card. |
| `scope` | Restricts palette availability by owner kind or widget element type. |
| `role` | Special node role such as `eventHead`, `functionEntry`, `reroute`, `dataLiteral`, `valueReturn`, or `comment`. |

Terminal exec nodes (nodes with an exec input and no exec output, such as `Go Page`, `Return Value`, and Flow `Return`) use the right-edge terminal card accent in the visual editor.

## Node categories

Categories are simple strings on `BlueprintNodeDef.category`. They are not separate objects and should not be deleted when nodes are removed. The palette sorts first by category and then by display name.

Recommended category names:

| Category | Use for |
| --- | --- |
| `Events` | Event entry heads such as `Init`, `Mouse Click`, `On Key Down`, `Any Key Down`, `Surface Init`, `App Boot`, broadcast receivers, and `Page Event`. |
| `Variables` | Blueprint-level `Var` declarations, local variable reads/writes through `Get Var` / `Set Var`, and project-level Persistent reads/writes through `Get Persistent` / `Set Persistent`. |
| `Flow` | Branching, string switching, bounded loops, array iteration, delay, and delay skipping. |
| `Data` | Literals, objects, arrays, Collection nodes, JSON helpers, string helpers, parsing, and type conversion. |
| `Math` | Numeric calculation, rounding, min/max, random numbers, boolean logic, and comparisons. |
| `Element` | Magic element literals and same-Surface element references. |
| `Displayable` | Displayable `Get Display` / `Set Display`, `Get Property` / `Set Property`, `Set Variant`, property animation, and token-targeted animation stopping nodes for Self and Element-targeted forms. |
| `Text` | Text property reads/writes for the current Text owner or explicit Text element references. |
| `Widget` | UI element mutations and reads. |
| `Page` | Page navigation, Page component host reads, and child-to-parent Page events. |
| `Game` | NarraLeaf game runtime control and project-scoped local save operations. |
| `Slider` | Slider value/range reads and runtime value/range writes for `nl.slider`. |
| `List` | List runtime content, selection, scroll, and item context nodes for `nl.list`. |
| `Navigation` | Page and modal navigation. |
| `Debug` | Logs, graph comments, assertions, and debug overlays. |

## Pins

Pins define how nodes connect.

```ts
type BlueprintNodePinDef = {
    id: string;
    kind: "input" | "output";
    semantic: "exec" | "data";
    valueType?: string;
    label?: string;
    allowInlineLiteral?: boolean;
};
```

### Exec pins

Use exec pins for control flow.

Common conventions:

- Input exec pin: `in`
- Normal continuation output: `next`
- Event-head continuation output: `then`
- Branch outputs: `true`, `false`, `then`, `else`
- Sequence outputs: `then0`, `then1`, `then2`, `then3`

Example:

```ts
pins: [
    { id: "in", kind: "input", semantic: "exec", label: "In" },
    { id: "next", kind: "output", semantic: "exec", label: "Next" },
]
```

### Data pins

Use data pins for values.

Common `valueType` strings:

- `string`
- `integer`
- `float`
- `boolean`
- `array`
- `json`
- `Vector2D`
- `RGBAColor`
- `Timer`
- `AnimationToken`
- `any`

Connection compatibility is strict by default. `any` is the wildcard type. `integer` outputs may connect to `float` inputs. `integer` and `float` outputs may connect to `string` inputs and are converted to strings when the input is read. `array` outputs may connect to `json` inputs because arrays are JSON values. `json`, `Vector2D`, `RGBAColor`, `Timer`, and `AnimationToken` are not wildcards; use an explicit Data conversion node when a scalar value must feed a JSON input. Collection/List array inputs normalize non-array values to `[]`.

Data input pins accept one incoming edge. Exec input pins may accept multiple incoming exec edges, which lets branches merge back into a shared continuation. Most output pins replace their previous outgoing edge when reconnected, but Data literal output pins may fan out to multiple targets.

Example:

```ts
pins: [
    { id: "value", kind: "input", semantic: "data", valueType: "json", label: "Value" },
    { id: "result", kind: "output", semantic: "data", valueType: "json", label: "Result" },
]
```

### Optional input pins

Set `optional: true` on input pins that are intentionally nullable or may use a runtime default when unwired. The node card renders an optional unwired input label in gray italic text; once connected, the label returns to the normal style. The input handle keeps the normal exec/data color in both states.

```ts
{ id: "props", kind: "input", semantic: "data", valueType: "json", label: "Page props", optional: true }
```

### Inline literal pins

`allowInlineLiteral` lets users type a value directly on a node card when a data input is unwired. It is only valid for input data pins whose `valueType` is `string`, `integer`, or `float`.

```ts
{ id: "name", kind: "input", semantic: "data", valueType: "string", label: "Name", allowInlineLiteral: true }
```

### Dynamic input pins

Use `dynamicInputPins` for variadic nodes such as `Concat`, `Add`, `If Else`, or `Make array`.

```ts
dynamicInputPins: {
    storageKey: "__dynamicInputPinIds",
    fixedDataInputIds: ["a", "b"],
    generatedIdPrefix: "in",
    valueType: "string",
    allowInlineLiteral: true,
    labelPrefix: "Input",
    pinLabelParamKey: "__inputLabels",
    defaultPinLabelPrefix: "field",
}
```

Dynamic pin ids and optional dynamic pin labels are stored in node `params`, so never treat them as temporary UI-only state. `pinLabelParamKey` is only needed for legacy or custom nodes where the user-visible pin label itself has runtime meaning. Prefer an explicit data input when that value should be connectable.

When one add action must create several related pins, set `generatedPinTemplates`. The stored dynamic id list still contains concrete pin ids, but each add action generates one base id and expands it into template ids:

```ts
dynamicInputPins: {
    storageKey: "__jsonObjectInputPins",
    fixedDataInputIds: [],
    generatedIdPrefix: "field",
    valueType: "any",
    allowInlineLiteral: false,
    generatedPinTemplates: [
        { idSuffix: "name", label: "Name", valueType: "string", allowInlineLiteral: true },
        { idSuffix: "value", label: "Value", valueType: "any", allowInlineLiteral: false },
    ],
}
```

`Make JSON Object` uses this grouped form and new nodes start with one `Name` / `Value` field pair. Pressing the node-card add button creates `field_N_name` (`string`) and `field_N_value` (`any`); the runtime reads the field name from the `Name` input, so the name can be typed inline or wired from another string node. Older graphs that stored field names in `__jsonObjectFieldNames` are still resolved for compatibility.

`If Else` uses the same grouped dynamic-pin path for branch authoring. Its fixed first branch uses `condition` -> `then`; each add action creates one additional boolean condition input and one matching exec output, inserted before the fixed `else` fallback output.

## Inspector params

Inspector params are node configuration values stored on `node.params`.

Supported kinds:

| Kind | Use for |
| --- | --- |
| `string` | Plain text config. |
| `number` | Numeric config. |
| `json` | Structured JSON config, optionally with a fixed schema for fields such as `Vector2D.x` / `Vector2D.y` or Rect bounds. |
| `color` | RGBA color config rendered with the shared Studio color picker. |
| `literal` | Generic literal editor. |
| `variableRef` | Select a blueprint member variable. |
| `select` | Static or dynamic dropdown. |

Static select example:

```ts
inspectorParams: [
    {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
            { value: "replace", label: "Replace" },
            { value: "append", label: "Append" },
        ],
    },
]
```

Dynamic select example:

```ts
inspectorParams: [
    { key: "elementId", label: "Target element", kind: "select", dynamicOptionsSource: "elements" },
]
```

Known dynamic option sources include sources such as `surfaces` and `elements` when the surrounding editor context provides them.

## Execution API

A node's `execute` function receives a `BehaviorNodeExecutionContext`.

Important context fields:

| Field | Meaning |
| --- | --- |
| `graph` | Current graph IR. |
| `entry` | Current graph entry. |
| `node` | Current node instance. |
| `params` | Current node params. |
| `hostAdapter` | Runtime host bridge. Host APIs live under `hostAdapter.blueprintRuntime?.hostApi`. |
| `trace` | Optional debug trace emitter. |
| `blueprintLocals` | Blueprint lifecycle variable accessors backed by owner/runtime-scoped stores. |
| `listItemScope` | Current List item scope when executing an item template descendant graph. |
| `instanceKey` | Runtime instance key used to isolate repeated List item descendants. |

Return shape:

```ts
return { nextPort: "next" };
```

- For exec nodes, return the output exec port to follow.
- For multi-output exec nodes such as `Sequence`, return `nextPorts` with the output exec ports to enqueue in order.
- For event heads, return `{ nextPort: "then" }`.
- Pure nodes usually return `{}` because their values are resolved by data-pin evaluation helpers when consumed.
- Async nodes may `await` host calls and should set `isLatent: true`.

## Reading wired data

When an exec node needs a value from a data input pin, use `resolveDataPinValue` from `built-in/graphParamResolvers` rather than reading `ctx.params` directly.

```ts
import { resolveDataPinValue } from "./graphParamResolvers";

const value = resolveDataPinValue(
    ctx.graph,
    ctx.node.id,
    "value",
    ctx.params,
    ctx.blueprintLocals,
);
```

`resolveDataPinValue` already falls back to the inline/default param stored on the node when no edge is connected. Blueprint-visible empty data should be represented as `null`.

## Host API nodes

Host API nodes call runtime services such as navigation, widget mutation, persistence, or state. Use `requireHostApi` to fail with a blueprint execution error when the runtime host is unavailable.

```ts
import { requireHostApi } from "./hostApi";

async execute(ctx) {
    const api = requireHostApi(ctx);
    await api.widget.setVisible("element-id", true);
    return { nextPort: "next" };
}
```

Host API nodes are usually:

- `isPure: false`
- `isLatent: true` if they await runtime work
- limited to `event` and `macro` graph kinds

Page Host API nodes use `navigation.openSurface(surfaceId, props?)` for `Go Page`, `navigation.getPageProps()` for `Get Page Props`, `navigation.quitApplication()` for `Quit`, and `frame.getParam(key)` for single-field reads. `Go Page` normalizes missing or non-object props to `{}`. Frame Widget Property `Set Frame Page` keeps its target Page selector in the card, and its optional `Page props` input writes Frame `params`; when that input is not connected, existing params are preserved. `Get Page Props` is scoped to `surfaceMain` / `widgetMain` / `widgetValue` owners and must not appear in `globalMain`. `Quit` is terminal; in Studio Dev Mode its host implementation stops Dev Mode rather than terminating the Studio process.

Game Host API nodes follow the same rules. `Get Nametag` and `Is In Game` are pure and can be evaluated from Blueprint Value or event graphs; `Get Nametag` returns `null` when no speaker is active, and `Is In Game` returns `false` outside an active NarraLeaf game state. Page UI overlays opened above the game stage still count as game state. The default Dialog Nametag widgetMain graph uses `Init` / `On Flush` and reads `Get Nametag` separately for the null check and text update, and the NarraLeaf Dialog hook dispatches flush for Dialog elements with Blueprint Value or `On Flush` logic when the dialog text/speaker changes. The default Dialog Content widgetMain graph centralizes advancement: Content `Mouse Click`, `Element Click` bound to the full-screen Dialog Interaction Layer, the visible Dialog Panel, and default content children, and Space `keyUp` all feed one `Next` node. `Next`, `Skip`, `Show Dialog`, `Hide Dialog`, `Toggle Dialog Display`, `Set Sentence Speed`, `Write Save`, `Delete Save`, `List Saves`, and `Get Save Preview` continue through `next` after the awaited host call, while `Start Game`, `Quit Game`, `Load Save`, and `Go Page` are terminal because they replace, exit, or navigate away from the active execution context and must not continue the old execution chain. After `Start Game` or `Load Save`, `Go Page` keeps the shared Page Surface animation/lifecycle path but renders the target Page as a UI layer over the game stage. Dialog display nodes write or toggle the NarraLeaf React `showDialog` preference, and `Set Sentence Speed` writes the `cps` preference key through the NarraLeaf Preference API.

## Scoping and palette availability

Use `scope` when a node should only appear for certain owner kinds or widget types.

Owner-kind scope:

```ts
scope: { ownerKinds: ["widgetMain"] }
```

Widget-type scope:

```ts
scope: { widgetElementTypes: ["nl.button", "nl.image", "nl.container", "nl.text"] }
```

Event-head nodes should set `role: "eventHead"`. The palette uses widget event capabilities to decide which event heads are valid for the selected widget/event layer.

## Widget event capabilities

Widget event slots are declared in `src/shared/types/ui-editor/widgetLogic.ts`.

To make a widget expose `Init` and `Mouse Click`, its logic API should include the `init` lifecycle event and the `mouseClick` interaction event with these head types:

```ts
{
    id: "init",
    displayName: "Init",
    dispatchKind: "lifecycle",
    headNodeTypes: ["blueprint.event.head.init"],
}

{
    id: "mouseClick",
    displayName: "Mouse click",
    dispatchKind: "interaction",
    headNodeTypes: ["blueprint.event.head.mouseClick"],
}
```

The current built-in widgets expose event heads through capability catalogs rather than aliases. Do not add duplicate node ids for the same user action; add or update the event capability first, then add the matching event-head node definition.

Owner-level events are declared in `src/shared/types/ui-editor/blueprintLifecycle.ts`, and widget-level events are declared in `src/shared/types/ui-editor/widgetLogic.ts`. Surface `mouseClick` uses the same `blueprint.event.head.mouseClick` node type as widget clicks, but dispatches to the current `surfaceMain` blueprint for any click inside that Surface and outputs `x` / `y` in Surface design coordinates. Nested Page surfaces receive their own Surface click before the event can bubble to the parent Surface.

Owner-level keyboard events (`On Key Down` / `On Key Up` and `Any Key Down` / `Any Key Up`) listen at the runtime window level and dispatch to `globalMain`, the current active `surfaceMain`, and mounted widgets that expose those event heads. `On Key` heads match the card `Key` field against `KeyboardEvent.key` case-insensitively and only output modifier pins; `Any Key` heads also output `key`. Widget listeners are registered while the component is mounted and removed on unmount; they do not depend on element focus or `tabIndex`.

`nl.slider` exposes `Drag Start`, `Value Changed`, and `Drag End` event heads through this catalog. Slider events output the mapped `value`; `Value Changed` also outputs `previousValue`. They do not output normalized 0-1 progress. Use `Get Normalized Value` when a graph needs normalized progress, and `Get Value` when it needs the mapped value.

## Adding a new built-in node

1. Pick a stable `type` id.
   - Use a namespaced id such as `blueprint.widget.setText`.
   - Add a shared constant in `src/shared/types/blueprint/graph.ts` if the id is persisted or used across modules.
2. Decide category, graph kinds, purity, latency, and scope.
3. Define pins.
4. Define inspector params.
5. Implement `execute`.
6. Add the node definition to an appropriate file under `src/renderer/lib/ui-editor/blueprint-nodes/built-in/`.
7. Export it from that file if tests or other modules need direct access.
8. Add it to `allBuiltinBlueprintNodes` in `built-in/index.ts` when it should appear in the core catalog.
9. Add or update tests.
10. If it is a widget event head, update `widgetLogic.ts` and the event-head dispatch mapping in shared graph code.

## Example: add a simple exec node

```ts
export const exampleBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.example.noop",
        displayName: "Noop",
        category: "Flow",
        keywords: ["noop", "pass"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        execute: () => ({ nextPort: "next" }),
    },
];
```

Then register it in the built-in aggregation file:

```ts
import { exampleBlueprintNodes } from "./exampleNodes";

export const allBuiltinBlueprintNodes: BlueprintNodeDef[] = [
    ...eventHeadBlueprintNodes,
    ...localVariableBlueprintNodes,
    ...exampleBlueprintNodes,
];
```

## Example: add a pure data node

Pure data nodes should not perform host mutations or choose an exec output.

```ts
export const stringLengthNode: BlueprintNodeDef = {
    type: "blueprint.string.length",
    displayName: "Length",
    category: "Data",
    graphKinds: ["event", "function", "macro"],
    isPure: true,
    pins: [
        { id: "value", kind: "input", semantic: "data", valueType: "string", label: "Value" },
        { id: "result", kind: "output", semantic: "data", valueType: "integer", label: "Length" },
    ],
    execute: () => ({}),
};
```

Pure output values are usually produced by the data-pin resolver. If the node is a new pure operation, update the resolver so consumers can compute its output when another node reads the output pin.

## Example: add a widget mutation node

```ts
export const setWidgetTextNode: BlueprintNodeDef = {
    type: "blueprint.widget.setText",
    displayName: "Set text",
    category: "Widget",
    graphKinds: ["event", "macro"],
    isPure: false,
    isLatent: true,
    scope: { ownerKinds: ["widgetMain"] },
    pins: [
        { id: "in", kind: "input", semantic: "exec", label: "In" },
        { id: "next", kind: "output", semantic: "exec", label: "Next" },
        { id: "text", kind: "input", semantic: "data", valueType: "string", label: "Text", allowInlineLiteral: true },
    ],
    inspectorParams: [
        { key: "elementId", label: "Target element", kind: "select", dynamicOptionsSource: "elements" },
    ],
    async execute(ctx) {
        const api = requireHostApi(ctx);
        const elementId = String(ctx.params.elementId ?? "").trim();
        const wired = resolveDataPinValue(ctx.graph, ctx.node.id, "text", ctx.params, ctx.blueprintLocals);
        const text = String(wired ?? ctx.params.text ?? "");
        await api.widget.setText(elementId, text);
        return { nextPort: "next" };
    },
};
```

The example assumes a matching `hostApi.widget.setText` exists. Add host API types and runtime implementation before registering such a node.

## Testing checklist

When adding or changing nodes, test the following:

- The node registers without duplicate type errors.
- The palette includes the node for allowed graph kinds.
- The palette excludes the node for disallowed graph kinds and scopes.
- Pins have unique ids.
- Optional input pins render as inactive when unwired and return to normal pin styling when wired.
- Inline literals are only enabled on supported data input pins.
- Function graphs only show pure, non-latent nodes.
- Runtime `execute` returns the expected `nextPort`.
- Pure data nodes are resolvable through data-pin evaluation when consumed.
- Host API nodes fail clearly when the host API is unavailable.
- Existing saved graphs with hidden/legacy nodes still resolve if compatibility is required.

## Compatibility notes

Node `type` ids are persisted. Renaming a node type breaks old graph documents unless a migration or compatibility alias exists. Prefer these approaches:

1. Keep old node type registered with `hideInPalette: true`.
2. Add a document migration that rewrites old node types to new node types.
3. Keep shared constants stable and only change `displayName` if the UI label needs to improve.

## Minimal-node policy

The built-in catalog is currently reduced by design. Add nodes deliberately and keep each node's API small. When a node belongs to a future category, use the category string now, but only add it to `allBuiltinBlueprintNodes` when it should become available to authors.
