/**
 * Blueprint graph taxonomy — kinds, node type constants, and rules for editors / validators.
 * Comments in English per project convention.
 */

/** Persisted on BlueprintGraphIr.meta to disambiguate slot semantics (events vs functions vs macros). */
export type BlueprintGraphKind = "event" | "function" | "macro";

/** Well-known blueprint node type ids (stable contract). */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD = "blueprint.event.head" as const;
export const BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY = "blueprint.function.entry" as const;
export const BLUEPRINT_NODE_TYPE_REROUTE = "blueprint.flow.reroute" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL = "blueprint.data.literal" as const;

/** IR meta key for graph kind (string value matches BlueprintGraphKind). */
export const BLUEPRINT_GRAPH_IR_META_KIND = "graphKind" as const;

export type BlueprintGraphKindRules = {
    /** Graph kind id */
    kind: BlueprintGraphKind;
    /** Whether effectful / Host API nodes are allowed */
    allowsEffectfulNodes: boolean;
    /** Whether a dedicated entry node type is required at runtime */
    requiresDedicatedEntryNode: boolean;
    /** Node type id for the entry node, if required */
    entryNodeType?: typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD | typeof BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY;
    /** Whether UI may bind widget events directly to this graph slot */
    bindableFromWidgetUi: boolean;
};

const RULES: Record<BlueprintGraphKind, BlueprintGraphKindRules> = {
    event: {
        kind: "event",
        allowsEffectfulNodes: true,
        requiresDedicatedEntryNode: true,
        entryNodeType: BLUEPRINT_NODE_TYPE_EVENT_HEAD,
        bindableFromWidgetUi: true,
    },
    function: {
        kind: "function",
        allowsEffectfulNodes: false,
        requiresDedicatedEntryNode: true,
        entryNodeType: BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
        bindableFromWidgetUi: false,
    },
    macro: {
        kind: "macro",
        allowsEffectfulNodes: true,
        requiresDedicatedEntryNode: false,
        bindableFromWidgetUi: false,
    },
};

export function getBlueprintGraphKindRules(kind: BlueprintGraphKind): BlueprintGraphKindRules {
    return RULES[kind];
}

export function parseBlueprintGraphKind(raw: unknown): BlueprintGraphKind | undefined {
    if (raw === "event" || raw === "function" || raw === "macro") {
        return raw;
    }
    return undefined;
}
