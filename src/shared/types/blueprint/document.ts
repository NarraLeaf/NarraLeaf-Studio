/**
 * Blueprint System - canonical domain model (owner, document, program, members, bindings).
 * Does not import ui-editor types to avoid cycles; ui-editor bridges map to these types in M1+.
 */

import type { AssetVariantMap } from "../assetSet";
import type { BlueprintDocumentSchemaVersion } from "./schema";

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

export type BlueprintOwnerRef =
    | { kind: "globalMain" }
    | { kind: "surfaceMain"; surfaceId: string }
    | { kind: "widgetMain"; surfaceId: string; elementId: string }
    | { kind: "widgetValue"; surfaceId: string; elementId: string; propPath: string }
    | { kind: "componentWidgetMain"; componentId: string; elementId: string }
    /**
     * Story Action Blueprint: an implicit project resource bound 1:1 to a single story action.
     * Self-referential - the owner key equals the blueprint id. Has no surface; its only event is
     * "On Call". Scene membership is derived at compile time, not baked into identity.
     *
     * `mode` distinguishes how the "On Call" graph is consumed:
     *  - "action" (default when absent): a story action block; the graph runs for its side effects
     *     and may use async ("latent") nodes.
     *  - "value": an inline text interpolation; the graph's Return Value is rendered inline and is
     *     therefore evaluated synchronously, so async nodes are disallowed while authoring.
     *  - "condition": a control-flow condition (if / else-if); the graph's Return Value is a boolean
     *     evaluated synchronously each time the branch is tested. Async nodes are disallowed and the
     *     return is type-checked to boolean while authoring.
     */
    | { kind: "storyAction"; blueprintId: string; mode?: "action" | "value" | "condition" };

/**
 * True for synchronous story blueprints whose "On Call" graph must be evaluated inline with no async
 * nodes - both inline value interpolations and control-flow conditions.
 */
export function isStorySyncValueOwner(owner: BlueprintOwnerRef | undefined): boolean {
    return owner?.kind === "storyAction" && (owner.mode === "value" || owner.mode === "condition");
}

/**
 * True for a Blueprint Value graph: the per-property value provider behind one widget prop.
 *
 * Narrow on purpose, and not to be widened to the synchronous story owners above. A Blueprint Value
 * graph is re-run every time a binding's dependencies change, so its palette is cut down to the
 * nodes that are safe to re-run - no event heads but Init and Flush, nothing effectful. A story
 * value or condition also returns a value, but it runs once where the story asks for it, and the
 * only thing it may not do is block: that is {@link isStorySyncValueOwner}, which forbids async
 * nodes and nothing else. Answering this question with "storyAction value too" made every node a
 * condition is written out of - `Get Scene Var` first among them - an error the author could not
 * clear and the command-line tools then refused to write.
 */
export function isBlueprintValueGraphOwner(owner: BlueprintOwnerRef | undefined): boolean {
    return owner?.kind === "widgetValue";
}

/**
 * True for the owners that hang off one interface element, and so can be asked where that element
 * sits: a widget's own graph, one of its value bindings, or a component definition's.
 */
export function isBlueprintWidgetOwner(owner: BlueprintOwnerRef | undefined): boolean {
    return owner?.kind === "widgetMain"
        || owner?.kind === "widgetValue"
        || owner?.kind === "componentWidgetMain";
}

/**
 * How one layer is written: as a graph on the canvas, or as one of the author's script files.
 *
 * A property of the layer and of nothing above it. A slot used to be one or the other as a whole,
 * with the alternative kept beside it as an inactive "revision" - a private version history that
 * only the two frontends needed, that no other part of the product could see, and that answered a
 * question version control already answers. Layers were never exclusive (the dispatcher runs every
 * layer whose head matches), so this is the level the choice always belonged at.
 */
export type BlueprintLayerKind = "graph" | "script";

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/** The blueprint a private owner slot (global / surface / widget main / value) runs. Exactly one. */
export type BlueprintPrivateOwnerRecord = {
    blueprintId: string;
};

export type BlueprintDocument = {
    schemaVersion: BlueprintDocumentSchemaVersion;
    blueprints: Record<string, Blueprint>;
    ownerRecords: Record<string, BlueprintPrivateOwnerRecord>;
    meta?: {
        createdAt?: string;
        updatedAt?: string;
    };
};

/** Stable owner key, e.g. globalMain, surfaceMain:<id>, widgetMain:<surfaceId>:<elementId> */
export type BlueprintOwnerIndexKey = string;

// ---------------------------------------------------------------------------
// Blueprint entity
// ---------------------------------------------------------------------------

export type Blueprint = {
    id: string;
    name: string;
    owner: BlueprintOwnerRef;
    members?: BlueprintMemberIndex;
    bindings?: Record<string, BindingDefinition>;
    /**
     * The layers this slot runs, in the order the author arranged them.
     *
     * Reached directly rather than through a `program: { kind }` wrapper. The wrapper existed to
     * separate a graph blueprint from a script one, and there is no such division any more: a
     * blueprint is a container of layers, and each layer says for itself whether it is a graph or a
     * file. Three fields used to answer the same question - `frontend`, `programKind` and
     * `program.kind` - and none of them could answer it for a blueprint holding one of each.
     */
    graphs: BlueprintGraphIndex;
    meta?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type BlueprintMemberIndex = {
    variables: Record<string, BlueprintVariable>;
    /** Authoring-time fields (binding sources); defined in the member UI, not by graph nodes. */
    fields: Record<string, BlueprintField>;
    functions: Record<string, BlueprintFunctionSignature>;
};

export type BlueprintVariable = {
    id: string;
    name: string;
    /** Opaque type id for editor/runtime; M1 does not enforce a type system */
    valueType?: string;
    defaultValue?: LiteralValue;
    meta?: Record<string, unknown>;
};

/**
 * Evaluable value source for field-backed bindings.
 * M3-min: surfaceState (current page); globalState added for cross-page data flow.
 */
export type BlueprintFieldValueSource =
    | { kind: "surfaceState"; key: string }
    | { kind: "globalState"; key: string }
    | { kind: "listItem"; path?: string }
    | { kind: "listIndex" }
    | { kind: "listCount" };

/**
 * Field members are the only widgetProp binding sources (symbol-first); no arbitrary expression AST in M1.
 */
export type BlueprintField = {
    id: string;
    name: string;
    kind?: "computed" | "constant" | "reference";
    /**
     * M3-min: when set, binding evaluator reads this source (Dev Mode / runtime).
     * Fields without `valueSource` are not evaluable until upgraded.
     */
    valueSource?: BlueprintFieldValueSource;
    meta?: Record<string, unknown>;
};

export type BlueprintFunctionSignature = {
    id: string;
    name: string;
    parameters?: Array<{ name: string; valueType?: string }>;
    returnType?: string;
    meta?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Layer program (a graph, or one of the author's script files)
// ---------------------------------------------------------------------------

/**
 * The author's file a script layer runs, as a project-relative path under `scripts/`.
 *
 * A reference rather than the text, because the text is not Studio's to hold. A script is edited in
 * the author's own editor, and a document service that kept a copy would write that copy back over
 * their edit the next time anything saved - which is what `<project>/scripts/` exists to prevent.
 * See `@shared/project/scriptsDirectory`.
 *
 * Dangling is an ordinary state: a file the author moved or deleted leaves a reference that
 * resolves to nothing, and that is reported as a diagnostic rather than repaired by guessing.
 */
export type BlueprintLayerScript = {
    scriptRef: string;
    /** What the last compile of {@link scriptRef} said. Absent until one has run. */
    diagnostics?: BlueprintDiagnostic[];
};

export type BlueprintGraphIndex = {
    /**
     * The order the author arranged the event layers in, and the only place that order lives.
     *
     * `events` was an ordered map until v10: its key order was the layer list in the member
     * tree, and `eventIds[0]` is which layer the editor opens. Key order is not a property
     * any document format can rely on - canonical serialization sorts keys, and the keys
     * here are UUIDs, so sorting presents the layers in an order related to neither creation
     * nor naming. Nothing about it needed version control to break either: one
     * `{...spread}` rebuild that reinserted a key would have done it.
     *
     * Optional because it is reconciled against `events` on every read (see
     * `listBlueprintEventIds`), which has to cope with the two disagreeing anyway - so a
     * document that has not been migrated is just the degenerate case where nothing is
     * listed. Write it through the service, never by hand.
     */
    eventIds?: string[];
    events: Record<string, BlueprintLayer>;
    /**
     * Authored order of {@link functions}, on the same terms as {@link eventIds}.
     *
     * The stake is smaller but real: there is no function list in the member tree, yet
     * `functionIds[0]` is the graph the editor opens for a blueprint that has no event
     * layers. Sorted keys would make that a UUID lottery, re-rolled by nothing the author
     * did.
     */
    functionIds?: string[];
    functions: Record<string, BlueprintFunctionGraph>;
    /**
     * No `macroIds` companion, because nothing writes this record: it is read defensively in
     * half a dozen walkers and populated by none of them. Whoever makes macros real needs a
     * carrier too - see `blueprintEventOrder.ts` - and a schema bump to add it.
     */
    macros?: Record<string, BlueprintMacroGraph>;
};

/**
 * Graph IR placeholder aligned with future UIGraph-like execution; M1 structural freeze only.
 */
export type BlueprintGraphIr = {
    nodes?: Record<string, BlueprintGraphNode>;
    edges?: BlueprintGraphEdge[];
    variables?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};

export type BlueprintGraphNode = {
    id: string;
    type: string;
    params?: Record<string, unknown>;
    ports?: Record<string, BlueprintGraphPort>;
    meta?: Record<string, unknown>;
    /**
     * What each asset set THIS node's stored params name resolves to, per locale.
     *
     * **Never authored and never on disk under `editor/`.** Written while a package is being
     * assembled (`@shared/build/blueprintAssetSets`) and present only in the bundle a game runs
     * from, exactly as the same field on a story row, a pose, or a widget is.
     *
     * On the node that STORES the id rather than the one that consumes it: an asset pin can be fed
     * by an edge from a literal node, and then the literal is what holds the id and the consumer
     * never sees a set at all.
     */
    assetVariants?: AssetVariantMap;
};

export type BlueprintGraphPort = {
    kind: "input" | "output";
    type?: string;
    label?: string;
};

export type BlueprintGraphEdge = {
    from: {
        nodeId: string;
        port: string;
    };
    to: {
        nodeId: string;
        port: string;
    };
};

/**
 * One layer of a blueprint: a piece of logic that says for itself what it listens to.
 *
 * A graph layer answers the events its head nodes name; a script layer answers the events its
 * module exports a handler for. Neither excludes the other and neither excludes a sibling: the
 * dispatcher runs *every* layer that answers a dispatched event, which is why a script can sit in
 * this list beside a graph rather than replacing the blueprint it would otherwise have to displace.
 *
 * Exactly one of {@link graph} and {@link script} is set. A layer with neither is a graph layer the
 * author has not drawn anything into yet, which is the state a freshly declared one starts in.
 */
export type BlueprintLayer = {
    id: string;
    name?: string;
    /** Event execution graph - may contain effectful nodes */
    graph?: BlueprintGraphIr;
    /** The author's file this layer runs, when it is a script layer rather than a graph one. */
    script?: BlueprintLayerScript;
    meta?: Record<string, unknown>;
};

/** Which of the two a layer is, without reaching into it. */
export function blueprintLayerKind(layer: BlueprintLayer | undefined): BlueprintLayerKind {
    return layer?.script ? "script" : "graph";
}

export type BlueprintFunctionGraph = {
    id: string;
    name?: string;
    graph?: BlueprintGraphIr;
    meta?: Record<string, unknown>;
};

export type BlueprintMacroGraph = {
    id: string;
    name?: string;
    graph?: BlueprintGraphIr;
    meta?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// TypeScript blueprint source
// ---------------------------------------------------------------------------

/**
 * A script's text, as it was stored inside the document before v13.
 *
 * Kept only so the migration can recognise what it is reading and hand the text to something that
 * can write a file. Nothing current holds one: a script's text lives in `scripts/`, and the
 * blueprint holds the path.
 */
export type LegacyInlineScriptSource = {
    language: "typescript";
    code: string;
    compiledModuleId?: string;
    outputPath?: string;
    diagnostics?: BlueprintDiagnostic[];
};

/**
 * Where the migration parks the text it rescued out of a pre-v13 document, on the blueprint's own
 * `meta`, for the one open that writes it to disk.
 *
 * On `meta` rather than in the program because it is not part of the model: it is a hand-off with a
 * lifetime of one open. The service that writes the file clears it.
 */
export const LEGACY_INLINE_SCRIPT_META_KEY = "legacyInlineScript";

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

export type LiteralValue = string | number | boolean | null | LiteralValue[] | { [key: string]: LiteralValue };

/** Persisted binding health; `broken` when source field is missing or invalid. */
export type BindingDefinitionStatus = "active" | "broken";

export type BindingDefinition = {
    id: string;
    target: BindingTargetRef;
    source: BindingSourceRef;
    mode: "replace";
    fallback?: LiteralValue;
    status?: BindingDefinitionStatus;
    /** Set when status is broken (e.g. field deleted). */
    brokenReason?: string;
};

export type BindingTargetRef = {
    kind: "widgetProp";
    surfaceId: string;
    elementId: string;
    propPath: string;
};

export type BindingSourceRef = {
    kind: "field";
    blueprintId: string;
    fieldId: string;
};

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type BlueprintDiagnosticSeverity = "error" | "warning" | "info";

export type BlueprintDiagnostic = {
    severity: BlueprintDiagnosticSeverity;
    message: string;
    code?: string;
    /** Source span or module location; M1 opaque */
    location?: Record<string, unknown>;
};
