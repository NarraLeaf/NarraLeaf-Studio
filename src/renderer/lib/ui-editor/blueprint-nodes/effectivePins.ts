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
import { BLUEPRINT_NODE_TYPE_ELEMENT_REF } from "@shared/types/blueprint/graph";
import { blueprintElementValueType } from "@shared/types/blueprint/valueTypes";

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

/** Read dynamic input pin labels from node.params. */
export function readDynamicInputPinLabels(
    params: Record<string, unknown> | undefined,
    storageKey: string | undefined,
): Record<string, string> {
    if (!params || !storageKey) {
        return {};
    }
    const raw = params[storageKey];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim().length > 0) {
            out[key] = value.trim();
        }
    }
    return out;
}

function dynamicIdsForBase(cfg: BlueprintNodeDynamicInputPinsConfig, baseId: string): string[] {
    const templates = cfg.generatedPinTemplates;
    if (!templates?.length) {
        return [baseId];
    }
    return templates.map(template => `${baseId}_${template.idSuffix}`);
}

function readDynamicGroupBaseId(
    cfg: BlueprintNodeDynamicInputPinsConfig,
    pinId: string,
): string | undefined {
    for (const template of cfg.generatedPinTemplates ?? []) {
        const suffix = `_${template.idSuffix}`;
        if (pinId.endsWith(suffix)) {
            return pinId.slice(0, -suffix.length);
        }
    }
    return undefined;
}

function readDynamicPinTemplate(
    cfg: BlueprintNodeDynamicInputPinsConfig,
    pinId: string,
): NonNullable<BlueprintNodeDynamicInputPinsConfig["generatedPinTemplates"]>[number] | undefined {
    for (const template of cfg.generatedPinTemplates ?? []) {
        if (pinId.endsWith(`_${template.idSuffix}`)) {
            return template;
        }
    }
    return undefined;
}

/** Next unused id set, avoiding static pins and existing dynamic ids. */
export function generateNextDynamicInputPinIds(def: BlueprintNodeDef, params: Record<string, unknown>): string[] {
    const cfg = def.dynamicInputPins;
    if (!cfg) {
        throw new Error("[effectivePins] Node has no dynamicInputPins config");
    }
    const staticIds = new Set(def.pins.map(p => p.id));
    const dynamicIds = new Set(readDynamicInputPinIds(params, cfg.storageKey));
    let n = 1;
    for (;;) {
        const baseId = `${cfg.generatedIdPrefix}_${n}`;
        const ids = dynamicIdsForBase(cfg, baseId);
        if (
            !dynamicIds.has(baseId) &&
            ids.every(id => !staticIds.has(id) && !dynamicIds.has(id))
        ) {
            return ids;
        }
        n += 1;
    }
}

/** Next unused id `${prefix}_${n}` avoiding static pins and existing dynamic ids. */
export function generateNextDynamicInputPinId(def: BlueprintNodeDef, params: Record<string, unknown>): string {
    return generateNextDynamicInputPinIds(def, params)[0];
}

/** Dynamic ids removed together when a generated grouped pin is deleted. */
export function getDynamicInputPinRemovalIds(
    def: BlueprintNodeDef,
    params: Record<string, unknown> | undefined,
    pinId: string,
): string[] {
    const cfg = def.dynamicInputPins;
    if (!cfg) {
        return [pinId];
    }
    const dynamicIdSet = new Set(readDynamicInputPinIds(params, cfg.storageKey));
    const baseId = readDynamicGroupBaseId(cfg, pinId);
    if (!baseId) {
        return [pinId];
    }
    const ids = dynamicIdsForBase(cfg, baseId).filter(id => dynamicIdSet.has(id));
    return ids.length > 0 ? ids : [pinId];
}

/**
 * Effective pin defs for execution / validation: exec inputs, fixed data inputs, dynamic data inputs, outputs.
 */
export function resolveEffectiveBlueprintNodePins(
    def: BlueprintNodeDef,
    params?: Record<string, unknown>,
): BlueprintNodePinDef[] {
    if (def.type === BLUEPRINT_NODE_TYPE_ELEMENT_REF) {
        const elementType = typeof params?.elementType === "string" ? params.elementType : undefined;
        return def.pins.map(pin =>
            pin.kind === "output" && pin.semantic === "data" && pin.id === "element"
                ? {
                      ...pin,
                      valueType: blueprintElementValueType(elementType),
                  }
                : pin,
        );
    }
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

    const labels = readDynamicInputPinLabels(params, cfg.pinLabelParamKey);
    const dynamicPins: BlueprintNodePinDef[] = [];
    let dynOrdinal = 0;
    for (const id of extraIds) {
        if (def.pins.some(p => p.id === id)) {
            continue;
        }
        dynOrdinal += 1;
        const template = readDynamicPinTemplate(cfg, id);
        const kind = template?.kind ?? "input";
        const semantic = template?.semantic ?? "data";
        const isDataPin = semantic === "data";
        dynamicPins.push({
            id,
            kind,
            semantic,
            valueType: isDataPin ? template?.valueType ?? cfg.valueType : undefined,
            allowInlineLiteral: kind === "input" && isDataPin
                ? template?.allowInlineLiteral ?? cfg.allowInlineLiteral
                : undefined,
            label:
                labels[id] ??
                template?.label ??
                `${cfg.labelPrefix ?? "Input"} ${fixedDataInputs.length + dynOrdinal}`,
        });
    }

    const dynamicInputs = dynamicPins.filter(p => p.kind === "input");
    const dynamicOutputs = dynamicPins.filter(p => p.kind === "output");
    const insertBefore = cfg.outputInsertBeforePinId
        ? outputs.findIndex(p => p.id === cfg.outputInsertBeforePinId)
        : -1;
    const staticOutputsBeforeDynamic = insertBefore >= 0 ? outputs.slice(0, insertBefore) : outputs;
    const staticOutputsAfterDynamic = insertBefore >= 0 ? outputs.slice(insertBefore) : [];

    return [
        ...execInputs,
        ...fixedDataInputs,
        ...dynamicInputs,
        ...staticOutputsBeforeDynamic,
        ...dynamicOutputs,
        ...staticOutputsAfterDynamic,
    ];
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
    const cfg = def.dynamicInputPins;
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
        dynamicInputPinLabelParamKey: cfg?.pinLabelParamKey,
        dynamicInputPinAddLabel: cfg?.addButtonLabel,
    };

    const effective = resolveEffectiveBlueprintNodePins(def, params);
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
