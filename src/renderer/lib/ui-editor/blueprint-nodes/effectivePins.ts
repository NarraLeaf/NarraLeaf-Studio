/**
 * Merge static node pin definitions with instance params for variadic input nodes.
 * Comments in English per project convention.
 */

import type {
    BlueprintNodeDef,
    BlueprintNodeDynamicInputPinsConfig,
    BlueprintNodeEditorCatalogEntry,
    BlueprintNodePinDef,
} from "./types";

export type EffectiveCatalogPin = BlueprintNodeEditorCatalogEntry["pins"][number];

/** Read ordered dynamic input pin ids from node.params. */
export function readDynamicInputPinIds(
    params: Record<string, unknown> | undefined,
    storageKey: string,
): string[] {
    if (!params) {
        return [];
    }
    const raw = params[storageKey];
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

/** Next unused id `${prefix}_${n}` avoiding static pins and existing dynamic ids. */
export function generateNextDynamicInputPinId(def: BlueprintNodeDef, params: Record<string, unknown>): string {
    const cfg = def.dynamicInputPins;
    if (!cfg) {
        throw new Error("[effectivePins] Node has no dynamicInputPins config");
    }
    const staticIds = new Set(def.pins.map(p => p.id));
    const dynamicIds = new Set(readDynamicInputPinIds(params, cfg.storageKey));
    let n = 1;
    for (;;) {
        const id = `${cfg.generatedIdPrefix}_${n}`;
        if (!staticIds.has(id) && !dynamicIds.has(id)) {
            return id;
        }
        n += 1;
    }
}

/**
 * Effective pin defs for execution / validation: exec inputs, fixed data inputs, dynamic data inputs, outputs.
 */
export function resolveEffectiveBlueprintNodePins(
    def: BlueprintNodeDef,
    params?: Record<string, unknown>,
): BlueprintNodePinDef[] {
    const cfg = def.dynamicInputPins;
    if (!cfg || !params) {
        return def.pins;
    }

    const extraIds = readDynamicInputPinIds(params, cfg.storageKey);
    const inputs = def.pins.filter(p => p.kind === "input");
    const outputs = def.pins.filter(p => p.kind === "output");

    const execInputs = inputs.filter(p => p.semantic === "exec");
    const fixedDataInputs = inputs.filter(
        p => p.semantic === "data" && cfg.fixedDataInputIds.includes(p.id),
    );

    const fixedSet = new Set(cfg.fixedDataInputIds);
    const dynamicPins: BlueprintNodePinDef[] = [];
    let dynOrdinal = 0;
    for (const id of extraIds) {
        if (def.pins.some(p => p.id === id)) {
            continue;
        }
        dynOrdinal += 1;
        dynamicPins.push({
            id,
            kind: "input",
            semantic: "data",
            valueType: cfg.valueType,
            allowInlineLiteral: cfg.allowInlineLiteral,
            label: `Input ${fixedDataInputs.length + dynOrdinal}`,
        });
    }

    return [...execInputs, ...fixedDataInputs, ...dynamicPins, ...outputs];
}

function pinDefToCatalogPin(p: BlueprintNodePinDef, removable: boolean): EffectiveCatalogPin {
    return {
        id: p.id,
        kind: p.kind,
        semantic: p.semantic,
        valueType: p.valueType,
        label: p.label,
        allowInlineLiteral: p.allowInlineLiteral,
        removable,
    };
}

/**
 * Editor catalog entry with pins merged from params (dynamic inputs + removable flags).
 */
export function resolveEffectiveBlueprintCatalogEntry(
    def: BlueprintNodeDef,
    params?: Record<string, unknown>,
): BlueprintNodeEditorCatalogEntry {
    const base = {
        type: def.type,
        category: def.category,
        displayName: def.displayName,
        keywords: def.keywords,
        isPure: def.isPure,
        inspectorParams: def.inspectorParams,
        graphKinds: def.graphKinds,
        role: def.role,
        scope: def.scope,
    };

    const effective = resolveEffectiveBlueprintNodePins(def, params);
    const cfg = def.dynamicInputPins;
    const dynamicIdSet = cfg
        ? new Set(readDynamicInputPinIds(params, cfg.storageKey))
        : new Set<string>();

    const pins: EffectiveCatalogPin[] = effective.map(p => {
        const removable =
            Boolean(cfg) &&
            p.kind === "input" &&
            p.semantic === "data" &&
            dynamicIdSet.has(p.id);
        return pinDefToCatalogPin(p, removable);
    });

    return {
        ...base,
        pins,
        supportsDynamicInputPins: Boolean(def.dynamicInputPins),
    };
}
