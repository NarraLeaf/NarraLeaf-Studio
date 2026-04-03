/**
 * Blueprint System — canonical domain model (owner, document, program, members, bindings).
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
    | { kind: "sharedAsset"; assetId: string };

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export type BlueprintDocument = {
    schemaVersion: BlueprintDocumentSchemaVersion;
    blueprints: Record<string, Blueprint>;
    ownerIndex: Record<string, string>;
    meta?: {
        createdAt?: string;
        updatedAt?: string;
    };
};

/** Stable string key for ownerIndex, e.g. globalMain, surfaceMain:<id>, widgetMain:<surfaceId>:<elementId> */
export type BlueprintOwnerIndexKey = string;

// ---------------------------------------------------------------------------
// Blueprint entity
// ---------------------------------------------------------------------------

export type BlueprintFrontendKind = "visual" | "typescript";

export type BlueprintProgramKind = "graph" | "scriptModule";

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
    declarations: Record<string, BlueprintDeclaration>;
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
 * M3-min: single evaluable value source for declaration-backed bindings (surface runtime state only).
 * Further variants (global state, literals, composed refs) extend this union in later milestones.
 */
export type BlueprintDeclarationValueSource = {
    kind: "surfaceState";
    /** Key inside the current surface runtime state container */
    key: string;
};

/**
 * Declaration members are the only binding sources (symbol-first); no arbitrary expression AST in M1.
 */
export type BlueprintDeclaration = {
    id: string;
    name: string;
    /** How the declaration is produced (pure graph, const, etc.); M2+ narrows */
    kind?: "computed" | "constant" | "reference";
    /**
     * M3-min: when set, binding evaluator reads this source (Dev Mode / runtime).
     * Legacy declarations without `valueSource` are not evaluable until upgraded.
     */
    valueSource?: BlueprintDeclarationValueSource;
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
    entries?: Record<string, BlueprintGraphEntry>;
    nodes?: Record<string, BlueprintGraphNode>;
    edges?: BlueprintGraphEdge[];
    variables?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};

export type BlueprintGraphEntry = {
    start: {
        nodeId: string;
        port: string;
    };
    inputs?: Record<string, unknown>;
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
    /** Event execution graph — may contain effectful nodes */
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

export type LiteralValue = string | number | boolean | null;

/** Persisted binding health; `broken` when source declaration is missing or invalid. */
export type BindingDefinitionStatus = "active" | "broken";

export type BindingDefinition = {
    id: string;
    target: BindingTargetRef;
    source: BindingSourceRef;
    mode: "replace";
    fallback?: LiteralValue;
    status?: BindingDefinitionStatus;
    /** Set when status is broken (e.g. declaration deleted). */
    brokenReason?: string;
};

export type BindingTargetRef = {
    kind: "widgetProp";
    surfaceId: string;
    elementId: string;
    propPath: string;
};

export type BindingSourceRef = {
    kind: "declaration";
    blueprintId: string;
    declarationId: string;
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
