/**
 * Single source of truth for blueprint node metadata + runtime binding.
 * Comments in English per project convention.
 */

import type { BlueprintGraphKind } from "@shared/types/blueprint/graph";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import type { BehaviorNodeDefinition, BehaviorNodeExecutionContext } from "../behavior-graph/BehaviorNodeRegistry";

export type BlueprintPinSemantic = "exec" | "data";

/**
 * Data pin value types that support optional on-card literal editing (see allowInlineLiteral).
 * Other types (e.g. json, boolean) must not use inline literals.
 */
export const BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES = ["string", "integer", "float"] as const;
export type BlueprintPinInlineLiteralValueType = (typeof BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES)[number];

/** Persisted on node.params: pin ids whose inline literal editor is expanded on the node card. */
export const BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY = "__inlineLiteralPins" as const;

export type BlueprintNodePinDef = {
    id: string;
    kind: "input" | "output";
    semantic: BlueprintPinSemantic;
    /** Loose type tag for data pins (e.g. boolean, string) */
    valueType?: string;
    label?: string;
    /**
     * When true, the flow node may show a hover-only control to open an on-card input for this pin
     * when it is unwired. Only valid with kind=input, semantic=data, and valueType string|integer|float.
     */
    allowInlineLiteral?: boolean;
};

export type BlueprintInspectorParamKind = "string" | "number" | "json" | "literal" | "variableRef";

export type BlueprintInspectorParamDef = {
    key: string;
    label: string;
    kind: BlueprintInspectorParamKind;
};

/** Owner kinds that can appear on Blueprint.owner */
export type BlueprintNodeScopeOwnerKind = BlueprintOwnerRef["kind"];

/**
 * Optional palette / validation scope. If omitted, node is available in all owners
 * that match graphKind (still filtered by graphKinds list).
 */
export type BlueprintNodeScope = {
    ownerKinds?: BlueprintNodeScopeOwnerKind[];
    /** When set, node only appears for widgetMain blueprints whose element.type matches. */
    widgetElementTypes?: string[];
};

export type BlueprintNodeRole = "normal" | "eventHead" | "functionEntry" | "reroute" | "dataLiteral";

export type BlueprintNodeExecuteFn = BehaviorNodeDefinition["execute"];

/**
 * Full node definition: editor pins + inspector + runtime execute.
 * Registered via defineBlueprintNode().
 */
export type BlueprintNodeDef = {
    type: string;
    displayName: string;
    category: string;
    keywords?: string[];
    /** Graph kinds where this node may appear */
    graphKinds: BlueprintGraphKind[];
    /** Pure nodes have no side effects; used for validation hints */
    isPure: boolean;
    /** Latent/async execution (delay, host awaits) — disallowed in function graphs */
    isLatent?: boolean;
    pins: BlueprintNodePinDef[];
    inspectorParams?: BlueprintInspectorParamDef[];
    scope?: BlueprintNodeScope;
    role?: BlueprintNodeRole;
    execute: BlueprintNodeExecuteFn;
};

/** Context for palette filtering in the editor */
export type BlueprintPaletteContext = {
    graphKind: BlueprintGraphKind;
    owner: BlueprintOwnerRef;
    /** Element type (e.g. nl.button) when owner is widgetMain */
    widgetElementType?: string;
    /**
     * When set (widgetMain event graph), restricts palette event heads to slots wired to this layer.
     * Empty array means the layer exists but is not wired yet — offer all heads valid for this widget type.
     */
    widgetEventLayerSlots?: string[];
    /** Current graph already contains an event head — do not offer another */
    hasEventHead?: boolean;
    /** Current function graph already has an entry node */
    hasFunctionEntry?: boolean;
};

/** Legacy editor catalog entry shape (kept for incremental UI migration) */
export type BlueprintNodeEditorCatalogEntry = {
    type: string;
    category: string;
    displayName: string;
    keywords?: string[];
    isPure: boolean;
    pins: Array<{
        id: string;
        kind: "input" | "output";
        semantic: BlueprintPinSemantic;
        valueType?: string;
        label?: string;
        allowInlineLiteral?: boolean;
    }>;
    inspectorParams?: BlueprintInspectorParamDef[];
    graphKinds: BlueprintGraphKind[];
    role?: BlueprintNodeRole;
    scope?: BlueprintNodeScope;
};

export type { BehaviorNodeExecutionContext };
