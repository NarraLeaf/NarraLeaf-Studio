/**
 * Blueprint System - canonical domain model (owner, document, program, members, bindings).
 * Does not import ui-editor types to avoid cycles; ui-editor bridges map to these types in M1+.
 */

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
 * Legacy shape, retained only as migration input. Project-level persistent variables left the
 * blueprint document for the project-level variable registry (M-VAR); the v8→v9 migration reads this
 * off the raw document and seeds `editor/variables.json`.
 */
export type BlueprintPersistentVariable = BlueprintVariable & {
    /** Stable storage key used for host persistence. Defaults to id and is not changed by rename. */
    storageKey: string;
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
    events: Record<string, BlueprintEventGraph>;
    functions: Record<string, BlueprintFunctionGraph>;
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
