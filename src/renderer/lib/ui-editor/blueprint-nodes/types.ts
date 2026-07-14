/**
 * Single source of truth for blueprint node metadata + runtime binding.
 * Comments in English per project convention.
 */

import type { BlueprintGraphKind } from "@shared/types/blueprint/graph";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
} from "@shared/types/blueprint/valueTypes";
import type { BehaviorNodeDefinition, BehaviorNodeExecutionContext } from "../behavior-graph/BehaviorNodeRegistry";

export type BlueprintPinSemantic = "exec" | "data";

/**
 * Data pin value types that support optional on-card literal editing (see allowInlineLiteral).
 * Other types (e.g. json, boolean) must not use inline literals.
 */
export const BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES = ["string", "integer", "float"] as const;
export const BLUEPRINT_PIN_INLINE_LITERAL_CUSTOM_VALUE_TYPES = [
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
] as const;
export type BlueprintPinInlineLiteralValueType = (typeof BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES)[number];

/** Persisted on node.params: pin ids whose inline literal editor is expanded on the node card. */
export const BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY = "__inlineLiteralPins" as const;
/** Persisted on node.params: show the manually wired Element target pin for a derived palette instance. */
export const BLUEPRINT_NODE_PARAM_SHOW_MAGIC_ELEMENT_TARGET_PIN = "__showMagicElementTargetPin" as const;
/** Persisted on Animate Property nodes when the user explicitly edits the optional From field. */
export const BLUEPRINT_NODE_PARAM_DISPLAYABLE_ANIMATION_FROM_EXPLICIT = "__displayableAnimationFromExplicit" as const;

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
    /** Optional inputs render as inactive until wired and resolve to runtime default/undefined when omitted. */
    optional?: boolean;
    /**
     * When true, the flow node may show a hover-only control to open an on-card input for this pin
     * when it is unwired. Only valid with kind=input, semantic=data, and valueType string|integer|float.
     */
    allowInlineLiteral?: boolean;
};

/**
 * Optional variadic pins: fixed pins from `pins` stay forever; extra ids are stored in params[storageKey].
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
    /**
     * Optional grouped pins generated from one add action. When omitted, one pin id
     * `${prefix}_${n}` is created with valueType / allowInlineLiteral above.
     */
    generatedPinTemplates?: readonly {
        /** Generated ids use `${prefix}_${n}_${idSuffix}`. */
        idSuffix: string;
        label: string;
        kind?: "input" | "output";
        semantic?: BlueprintPinSemantic;
        valueType?: string;
        optional?: boolean;
        allowInlineLiteral?: boolean;
    }[];
    /** When dynamic output pins exist, insert them before this static output pin id. */
    outputInsertBeforePinId?: string;
    /** Optional display label prefix for generated pins. Defaults to "Input". */
    labelPrefix?: string;
    /** Optional label for the node-card add button. */
    addButtonLabel?: string;
    /** Optional param key storing user-visible labels by generated pin id. */
    pinLabelParamKey?: string;
    /** Optional prefix used when initializing labels in pinLabelParamKey. */
    defaultPinLabelPrefix?: string;
    /** Optional param key storing per-pin valueType overrides (Record<pinId, valueType>). */
    pinValueTypeParamKey?: string;
    /** Allowed valueTypes for the on-card per-pin type picker; presence enables the picker. */
    pinValueTypeOptions?: readonly string[];
    /** When true, generated OUTPUT pins also get remove/label/type controls (default: inputs only). */
    editableGeneratedOutputPins?: boolean;
};

export type BlueprintJsonValueSchema = {
    kind: "object" | "array" | "string" | "number" | "boolean" | "null";
    label?: string;
    /** Object fields are fixed schema entries. Unknown fields are rejected unless allowExtraFields is true. */
    fields?: readonly {
        key: string;
        label?: string;
        kind: "object" | "array" | "string" | "number" | "boolean" | "null";
        required?: boolean;
    }[];
    allowExtraFields?: boolean;
};

export type BlueprintInspectorParamKind =
    | "string"
    | "number"
    | "json"
    | "color"
    | "keyboardBinding"
    | "literal"
    | "variableRef"
    | "persistentVariableRef"
    | "sceneVariableRef"
    | "savedVariableRef"
    | "select"
    | "imageAsset"
    | "buttonCursor";

export type BlueprintInspectorParamSelectOption = {
    value: string;
    label: string;
    meta?: Record<string, string>;
};

export type BlueprintInspectorParamDef = {
    key: string;
    label: string;
    kind: BlueprintInspectorParamKind;
    /** Optional fixed schema for structured JSON-like values such as Vector2D. */
    jsonSchema?: BlueprintJsonValueSchema;
    /**
     * For `kind: "select"`: static options rendered as a `<select>` dropdown.
     * When omitted with `kind: "select"`, the node card will look for
     * dynamically provided options via `dynamicOptionsSource`.
     */
    options?: BlueprintInspectorParamSelectOption[];
    /**
     * For `kind: "select"` without static `options`: the flow projection
     * populates options from context data keyed by this source id.
     * Known sources include `"surfaces"` (available App Surfaces) and
     * `"frameTargetSurfaces"` (Page targets filtered for the inferred Frame).
     */
    dynamicOptionsSource?: string;
    /** Label for the empty select option. Defaults to "-". */
    emptyOptionLabel?: string;
    /**
     * Filter dynamic select options by comparing another param value with option metadata.
     * Used for dependent dropdowns such as Story -> Scene.
     */
    dynamicOptionsFilter?: {
        paramKey: string;
        optionMetaKey: string;
    };
};

/** Owner kinds that can appear on Blueprint.owner */
export type BlueprintNodeScopeOwnerKind = BlueprintOwnerRef["kind"];

/**
 * Optional palette / validation scope. If omitted, node is available in all owners
 * that match graphKind (still filtered by graphKinds list).
 */
export type BlueprintNodeScope = {
    anyOf?: BlueprintNodeScope[];
    ownerKinds?: BlueprintNodeScopeOwnerKind[];
    /** When set, node only appears for widgetMain blueprints whose element.type matches. */
    widgetElementTypes?: string[];
};

export type BlueprintNodeRole =
    | "normal"
    | "eventHead"
    | "fnHead"
    | "functionEntry"
    | "reroute"
    | "dataLiteral"
    | "elementLiteral"
    | "elementEventHead"
    | "imageAssetLiteral"
    | "valueReturn"
    | "comment";

export type BlueprintMagicElementRefPaletteEntry = {
    sourceNodeId: string;
    sourcePortId: string;
    targetPortId: string;
    surfaceId: string;
    elementId: string;
    elementType: string;
    label: string;
};

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
    /** Creates palette entries for bound Element outputs that can be manually wired to this input. */
    magicElementTarget?: {
        inputPinId: string;
        elementTypes?: readonly string[];
    };
    /** Pure nodes have no side effects; used for validation hints */
    isPure: boolean;
    /** Palette-only guard for nodes that read the active List item template scope. */
    requiresListItemContext?: boolean;
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
    /** Blueprint Value graphs have a restricted palette and value-return sink. */
    isBlueprintValueGraph?: boolean;
    /**
     * Sync-only graphs (e.g. inline story value blueprints) forbid async/"latent" nodes but still
     * allow synchronous exec nodes (branches, Get/Set var). Distinct from `isBlueprintValueGraph`,
     * which additionally restricts to the pure widget-value node whitelist.
     */
    isSyncOnlyGraph?: boolean;
    /** Current widget owner is rendered inside an nl.list item template. */
    listItemContextAvailable?: boolean;
    /** Bound Element Literal nodes in the active graph, same Surface only. */
    magicElementRefs?: readonly BlueprintMagicElementRefPaletteEntry[];
    /** Component definition graphs run inside a virtual component canvas; Element refs are scoped to that canvas. */
    isComponentDefinitionGraph?: boolean;
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
        optional?: boolean;
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
    /** Label for the node-card add-input control. */
    dynamicInputPinAddLabel?: string;
    /** Param key storing user-visible labels for dynamic input pins, if editable. */
    dynamicInputPinLabelParamKey?: string;
    /** Param key storing per-pin valueType overrides for dynamic pins, if editable. */
    dynamicInputPinTypeParamKey?: string;
    /** Allowed valueTypes for the on-card per-pin type picker. */
    dynamicInputPinTypeOptions?: readonly string[];
    /** When true, generated dynamic pins are outputs; the add-pin button renders in the output column. */
    dynamicPinsGenerateOutputs?: boolean;
    /** Present when this palette entry was derived from a bound Element output. */
    magicElementRef?: BlueprintMagicElementRefPaletteEntry;
};

export type { BehaviorNodeExecutionContext };
