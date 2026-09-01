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
    | { kind: "sharedAsset"; assetId: string }
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

export type BlueprintFrontendKind = "visual" | "typescript";

export type BlueprintProgramKind = "graph" | "scriptModule";

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Per private owner slot (global / surface / widget main): multiple blueprint revisions may exist,
 * but only one is active for runtime resolution and default editor targeting (Blueprint M5).
 */
export type BlueprintPrivateOwnerRecord = {
    activeBlueprintId: string;
    privateBlueprintIds: string[];
    /** Set when the owner slot was first initialized (informational). */
    initializedFrontend?: BlueprintFrontendKind;
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
    frontend: BlueprintFrontendKind;
    programKind: BlueprintProgramKind;
    members?: BlueprintMemberIndex;
    bindings?: Record<string, BindingDefinition>;
    program: BlueprintProgram;
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
// Program (graph vs script module)
// ---------------------------------------------------------------------------

export type BlueprintProgram =
    | {
          kind: "graph";
          graphs: BlueprintGraphIndex;
      }
    | {
          kind: "scriptModule";
          source: TypeScriptBlueprintSource;
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
    events: Record<string, BlueprintEventGraph>;
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

export type BlueprintEventGraph = {
    id: string;
    name?: string;
    /** Event execution graph - may contain effectful nodes */
    graph?: BlueprintGraphIr;
    meta?: Record<string, unknown>;
};

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

export type TypeScriptBlueprintSource = {
    language: "typescript";
    code: string;
    compiledModuleId?: string;
    outputPath?: string;
    diagnostics?: BlueprintDiagnostic[];
};

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

// ---------------------------------------------------------------------------
// Shared asset wrapper (M5 target; typed in M1 for contract completeness)
// ---------------------------------------------------------------------------

export type SharedBlueprintAsset = {
    assetId: string;
    name: string;
    frontend: BlueprintFrontendKind;
    blueprint: Blueprint;
    meta?: {
        tags?: string[];
        category?: string;
    };
};
