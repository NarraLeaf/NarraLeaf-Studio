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

/**
 * Persisted on node.params: ordered list of extra data input pin ids (beyond fixedDataInputIds).
 * Used when BlueprintNodeDef.dynamicInputPins is set.
 */
export const BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY = "__dynamicInputPinIds" as const;

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

/**
 * Optional variadic data inputs: fixed pins from `pins` stay forever; extra ids are stored in params[storageKey].
 */
export type BlueprintNodeDynamicInputPinsConfig = {
    /** Param key on node.params for string[] of additional input pin ids. */
    storageKey: string;
    /** Data input pin ids from def.pins that cannot be removed. */
    fixedDataInputIds: readonly string[];
    /** Generated ids use `${prefix}_${n}` with n increasing until unused. */
    generatedIdPrefix: string;
    valueType: string;
    allowInlineLiteral: boolean;
};

export type BlueprintInspectorParamKind = "string" | "number" | "json" | "literal" | "variableRef" | "select";

export type BlueprintInspectorParamSelectOption = {
    value: string;
    label: string;
};

export type BlueprintInspectorParamDef = {
    key: string;
    label: string;
    kind: BlueprintInspectorParamKind;
    /**
     * For `kind: "select"`: static options rendered as a `<select>` dropdown.
     * When omitted with `kind: "select"`, the node card will look for
     * dynamically provided options via `dynamicOptionsSource`.
     */
    options?: BlueprintInspectorParamSelectOption[];
    /**
     * For `kind: "select"` without static `options`: the flow projection
     * populates options from context data keyed by this source id.
     * Known sources: `"surfaces"` (available App Surfaces).
     */
    dynamicOptionsSource?: string;
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
    /** Keep registered for old graphs/runtime, but omit from add-node palette. */
    hideInPalette?: boolean;
    /** Pure nodes have no side effects; used for validation hints */
    isPure: boolean;
    /** Latent/async execution (delay, host awaits) — disallowed in function graphs */
    isLatent?: boolean;
    pins: BlueprintNodePinDef[];
    /** When set, users may add/remove extra data input pins (persisted in params). */
    dynamicInputPins?: BlueprintNodeDynamicInputPinsConfig;
    inspectorParams?: BlueprintInspectorParamDef[];
    scope?: BlueprintNodeScope;
    role?: BlueprintNodeRole;
    execute: BlueprintNodeExecuteFn;
};

/** Context for palette filtering in the editor */
/** Declared widget UI event slots from WidgetModule.logicApi.events (optional per-slot head override). */
export type BlueprintWidgetEventCapabilityRef = {
    id: string;
    headNodeTypes?: readonly string[];
};

export type BlueprintPaletteContext = {
    graphKind: BlueprintGraphKind;
    owner: BlueprintOwnerRef;
    /** Element type (e.g. nl.button) when owner is widgetMain */
    widgetElementType?: string;
    /**
     * Widget module event catalog; drives which event-head node types appear in the palette when slots are empty.
     */
    widgetBlueprintEvents?: readonly BlueprintWidgetEventCapabilityRef[];
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
        /** True for user-added dynamic inputs; show remove control on the node card. */
        removable?: boolean;
    }>;
    inspectorParams?: BlueprintInspectorParamDef[];
    graphKinds: BlueprintGraphKind[];
    role?: BlueprintNodeRole;
    scope?: BlueprintNodeScope;
    /** When true, node card may offer add-input control (see dynamicInputPins on def). */
    supportsDynamicInputPins?: boolean;
};

export type { BehaviorNodeExecutionContext };
