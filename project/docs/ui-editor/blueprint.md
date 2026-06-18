# UI Editor Blueprint Node Development Guide

This guide explains how Studio blueprint nodes are defined, registered, displayed in the editor palette, and executed at runtime. It is intended for contributors who need to add new nodes after the built-in catalog was reduced to the current starter set.

## Current built-in catalog

The current core catalog includes event heads, local and runtime variables, basic flow branching, data/string/math utilities, and documented UI-domain nodes.

| Node type | Display name | Category | Purpose |
| --- | --- | --- | --- |
| `blueprint.event.head.appBoot` | `App Boot` | `Events` | Entry node for the global UI runtime startup event. It is only available on `globalMain` blueprints. |
| `blueprint.event.head.surfaceInit` | `Surface Init` | `Events` | Entry node for Page/Game UI surface initialization. It is only available on `surfaceMain` blueprints. |
| `blueprint.event.head.surfaceUnmount` | `Surface Unmount` | `Events` | Entry node for Page/Game UI surface unmount. It is only available on `surfaceMain` blueprints. |
| `blueprint.event.head.init` | `Init` | `Events` | Entry node for widget initialization and Blueprint Value initial evaluation. It is available to widgets that expose the `init` lifecycle event and to `widgetValue` blueprints. |
| `blueprint.event.head.flush` | `Flush` | `Events` | Refresh entry node for Blueprint Value graphs. It is only available on `widgetValue` blueprints and is queued by the runtime. |
| `blueprint.event.head.mouseClick` | `Mouse Click` | `Events` | Entry node for widget mouse click interactions. It is available through the widget logic capability catalog. |
| `blueprint.event.head.scroll` | `Scroll` | `Events` | Entry node for List scroll interactions. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.scrollEnd` | `Scroll End` | `Events` | Entry node fired when a List runtime scrolls from non-end to the scroll end. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.itemRender` | `Item Render` | `Events` | Entry node fired for each rendered List item scope. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.itemClick` | `Item Click` | `Events` | Entry node fired when a rendered List item is clicked. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.itemHover` | `Item Hover` | `Events` | Entry node fired when the pointer enters a rendered List item. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.selectionChanged` | `Selection Changed` | `Events` | Entry node fired when a List item click changes the runtime selected index. It is available to `nl.list` widget private blueprints. |
| `blueprint.event.head.pageEvent` | `Page Event` | `Events` | Entry node for Page component child-to-parent events. It is available to `nl.frame` widget private blueprints. |
| `blueprint.data.returnValue` | `Return Value` | `Data` | Exec sink that returns the produced value from a Blueprint Value graph. It is only available on `widgetValue` blueprints. |
| `blueprint.local.get` | `Get Var` | `Variables` | Pure data node that reads an execution-local blueprint variable. |
| `blueprint.local.set` | `Set Var` | `Variables` | Exec node that writes an execution-local blueprint variable and continues through `next`. |
| `blueprint.state.get` | `Get state` | `Variables` | Pure data node that reads a Page/App runtime variable by scope and key. |
| `blueprint.state.set` | `Set state` | `Variables` | Exec node that writes a Page/App runtime variable and continues through `next`. |
| `if` | `If` | `Flow` | Exec branch node that routes execution through `true` or `false` based on a boolean condition. |
| `blueprint.math.*` | Basic math operators | `Math` | Pure arithmetic, increment/decrement, and comparison nodes such as `+`, `−`, `×`, `÷`, `+1`, `−1`, `=`, `≠`, `<`, `≤`, `>`, and `≥`. |

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
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/frameNodes.ts` | Built-in Page component host nodes for Frame params and child-to-parent Page events. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/localVariableNodes.ts` | Built-in local variable nodes. Currently `Get Var` and `Set Var`. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/stateNodes.ts` | Built-in Page/App runtime variable nodes. Currently `Get state` and `Set state`, both under `Variables`. |
| `src/renderer/lib/ui-editor/blueprint-nodes/built-in/mathNodes.ts` | Built-in basic math and comparison nodes. |
| `src/shared/types/blueprint/graph.ts` | Shared graph taxonomy and stable node type constants. Use this for node type ids that are persisted or shared across process boundaries. |
| `src/shared/types/ui-editor/widgetLogic.ts` | Widget logic capability catalog. Event slots here determine what widget event heads can appear for each widget type. |
| `src/shared/types/ui-editor/blueprintLifecycle.ts` | Global and surface lifecycle event capability catalog for `globalMain` and `surfaceMain` owners. |
| `src/shared/types/ui-editor/graph.ts` | Persisted graph IR shape used by UI graph documents. |
| `src/renderer/lib/ui-editor/blueprint-runtime/BlueprintDispatcher.ts` | Runtime dispatch for widget, broadcast, surface lifecycle, and global lifecycle event graphs. |
| `src/renderer/lib/ui-editor/behavior-graph/BehaviorNodeRegistry.ts` | Runtime behavior-node registry and execution context type. |

## Blueprint document concepts

A blueprint is not just a node list. The main concepts are:

- **Owner**: where the blueprint belongs. Supported owner kinds include `globalMain`, `surfaceMain`, `widgetMain`, `widgetValue`, and `sharedAsset`.
- **Program kind**: currently graph-based visual programs and script modules are represented separately.
- **Graph kind**: each graph declares semantic rules through `event`, `function`, or `macro`.
- **Members**: blueprint-owned variables, fields, and function signatures.
- **Bindings**: data connections between blueprint fields and UI/widget properties.
- **Graph IR**: persisted nodes and edges, including node `params`, `meta`, and editor layout.

When adding a node, make sure you know which owner kinds and graph kinds it should support. A node that mutates UI state usually belongs in `event` and/or `macro` graphs, while a pure calculation node can also be available in `function` graphs.

## Blueprint Value

Blueprint Value is a per-property dynamic value provider. A `widgetValue` private owner is keyed as `widgetValue:<surfaceId>:<elementId>:<encodedPropPath>`, and the UI document stores the active binding on the element in `valueBindings`. The current supported targets are `nl.text` -> `props.text`, `nl.button` -> `props.label`, and `nl.frame` -> `props.params`.

Value blueprints are visual graph programs only. They are seeded with one `init` event graph that returns the current literal value through `blueprint.data.returnValue`. `string` values seed a Text literal, while `json` values seed a JSON literal. `Flush` is an available automatic refresh head, but Studio does not create a default `flush` layer. On mount, the value runtime executes `init` and then attempts `flush`; if both return values, `flush` wins. Surface or global state updates queue `flush` automatically. Evaluation is serialized per binding so an in-flight run is followed by the latest pending `flush`.

If a value graph does not execute `returnValue`, the runtime keeps the previous resolved value. If there is no previous resolved value, the widget uses its literal prop from the UI document. String results are coerced to string, and `null` or `undefined` become an empty string. Page `params` expects a JSON object; non-object results fall back to `{}`.

The Blueprint Value palette is intentionally restricted to safe value-producing nodes: event heads, non-latent flow, pure Data/String/Math/JSON nodes, surface/global variable reads, and local variables. Surface/global variable writes, widget mutations, navigation, persistence writes, broadcasts, latent nodes, and TypeScript revisions are blocked for `widgetValue` owners.

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
| `role` | Special node role such as `eventHead`, `functionEntry`, `reroute`, or `dataLiteral`. |

## Node categories

Categories are simple strings on `BlueprintNodeDef.category`. They are not separate objects and should not be deleted when nodes are removed. The palette sorts first by category and then by display name.

Recommended category names:

| Category | Use for |
| --- | --- |
| `Events` | Event entry heads such as `Init`, `Mouse Click`, `Surface Init`, `App Boot`, broadcast receivers, and `Page Event`. |
| `Variables` | Local variables, blueprint/member variables, and Page/App runtime variables. |
| `Flow` | Branching, string switching, bounded loops, array iteration, and delay. |
| `Data` | Literals, objects, arrays, type conversion. |
| `Math` | Numeric calculation and comparisons. |
| `String` | Text operations and formatting. |
| `Widget` | UI element mutations and reads. |
| `Page` | Page component host reads and child-to-parent Page events. |
| `Navigation` | Page and modal navigation. |
| `Persistence` | Save/load key-value data. |
| `Debug` | Logs, assertions, debug overlays. |

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
- Branch outputs: `true`, `false`

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
- `json`
- `any`

Connection compatibility is strict by default. `any` is the wildcard type. `integer` and `float` outputs may connect to `string` inputs and are converted to strings when the input is read. `json` is not a wildcard; use an explicit Data conversion node when a scalar value must feed a JSON input.

Data input pins accept one incoming edge. Exec input pins may accept multiple incoming exec edges, which lets branches merge back into a shared continuation. Most output pins replace their previous outgoing edge when reconnected, but Data literal output pins may fan out to multiple targets.

Example:

```ts
pins: [
    { id: "value", kind: "input", semantic: "data", valueType: "json", label: "Value" },
    { id: "result", kind: "output", semantic: "data", valueType: "json", label: "Result" },
]
```

### Inline literal pins

`allowInlineLiteral` lets users type a value directly on a node card when a data input is unwired. It is only valid for input data pins whose `valueType` is `string`, `integer`, or `float`.

```ts
{ id: "name", kind: "input", semantic: "data", valueType: "string", label: "Name", allowInlineLiteral: true }
```

### Dynamic input pins

Use `dynamicInputPins` for variadic nodes such as `Concat`, `Add`, or `Make array`.

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

When one add action must create several related inputs, set `generatedPinTemplates`. The stored dynamic id list still contains concrete pin ids, but each add action generates one base id and expands it into template ids:

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

## Inspector params

Inspector params are node configuration values stored on `node.params`.

Supported kinds:

| Kind | Use for |
| --- | --- |
| `string` | Plain text config. |
| `number` | Numeric config. |
| `json` | Structured JSON config. |
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
| `blueprintLocals` | Per-dispatch local variables initialized from blueprint members. |

Return shape:

```ts
return { nextPort: "next" };
```

- For exec nodes, return the output exec port to follow.
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

If the pin may also have an inline/default param, use the wired value first and then fall back to `ctx.params`.

```ts
const wired = resolveDataPinValue(ctx.graph, ctx.node.id, "value", ctx.params, ctx.blueprintLocals);
const value = wired !== undefined ? wired : ctx.params.value;
```

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
    category: "String",
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
