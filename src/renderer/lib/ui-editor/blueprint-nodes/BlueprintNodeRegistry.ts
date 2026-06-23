/**
 * Central registry for blueprint node definitions (editor + runtime).
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    resolveBlueprintEventHeadTypesForUiSlot,
} from "@shared/types/blueprint/graph";
import { listWidgetLogicEventIds } from "@shared/types/ui-editor/widgetLogic";
import { behaviorNodeRegistry } from "../behavior-graph/BehaviorNodeRegistry";
import {
    BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES,
    type BlueprintNodeDef,
    type BlueprintNodeEditorCatalogEntry,
    type BlueprintPaletteContext,
} from "./types";
import { resolveEffectiveBlueprintCatalogEntry } from "./effectivePins";

type BlueprintNodeGraphContextDef = Pick<
    BlueprintNodeDef,
    "type" | "category" | "graphKinds" | "isPure" | "isLatent" | "role" | "scope"
>;

function headTypesForWidgetSlot(
    slotId: string,
    widgetElementType: string | undefined,
    widgetBlueprintEvents: BlueprintPaletteContext["widgetBlueprintEvents"],
): readonly string[] {
    const ev = widgetBlueprintEvents?.find(e => e.id === slotId);
    return ev?.headNodeTypes ?? resolveBlueprintEventHeadTypesForUiSlot(slotId, widgetElementType);
}

function resolveAllowedWidgetEventHeadTypesForPalette(ctx: BlueprintPaletteContext): Set<string> {
    const allow = new Set<string>();
    const slots = ctx.widgetEventLayerSlots ?? [];
    const widgetElementType = ctx.widgetElementType;
    const catalog = ctx.widgetBlueprintEvents;

    const addSlot = (slotId: string) => {
        for (const t of headTypesForWidgetSlot(slotId, widgetElementType, catalog)) {
            allow.add(t);
        }
    };
    const finalize = () => {
        if (!ctx.listItemContextAvailable) {
            allow.delete(BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH);
        }
        return allow;
    };

    if (slots.length === 0) {
        if (catalog && catalog.length > 0) {
            for (const ev of catalog) {
                addSlot(ev.id);
            }
        } else {
            for (const eventId of listWidgetLogicEventIds(widgetElementType)) {
                addSlot(eventId);
            }
        }
        return finalize();
    }
    for (const s of slots) {
        addSlot(s);
    }
    return finalize();
}

export function isBlueprintNodeAllowedInBlueprintValueGraph(def: BlueprintNodeGraphContextDef): boolean {
    if (def.role === "eventHead") {
        return def.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT;
    }
    if (def.role === "valueReturn" || def.type === BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE) {
        return true;
    }
    if (def.role === "comment") {
        return true;
    }
    if (def.type === BLUEPRINT_NODE_TYPE_LOCAL_GET || def.type === BLUEPRINT_NODE_TYPE_LOCAL_SET) {
        return !def.isLatent;
    }
    if (def.category === "Flow") {
        return !def.isLatent && def.type !== BLUEPRINT_NODE_TYPE_FLOW_DELAY;
    }
    if (!def.isPure || def.isLatent) {
        return false;
    }
    return (
        def.category === "Data" ||
        def.category === "List" ||
        def.category === "Math" ||
        def.category === "Text" ||
        def.category === "Displayable" ||
        def.category === "Element"
    );
}

function matchesBlueprintNodeScopeValue(
    scope: NonNullable<BlueprintNodeDef["scope"]>,
    ctx: BlueprintPaletteContext,
): boolean {
    if (scope.anyOf && scope.anyOf.length > 0) {
        return scope.anyOf.some(item => matchesBlueprintNodeScopeValue(item, ctx));
    }
    if (scope.ownerKinds && scope.ownerKinds.length > 0) {
        if (!scope.ownerKinds.includes(ctx.owner.kind)) {
            return false;
        }
    }
    if (scope.widgetElementTypes && scope.widgetElementTypes.length > 0) {
        if (ctx.owner.kind !== "widgetMain") {
            return false;
        }
        const t = ctx.widgetElementType;
        if (!t || !scope.widgetElementTypes.includes(t)) {
            return false;
        }
    }
    return true;
}

function matchesBlueprintNodeScope(def: BlueprintNodeGraphContextDef, ctx: BlueprintPaletteContext): boolean {
    const scope = def.scope;
    if (!scope) {
        return true;
    }
    return matchesBlueprintNodeScopeValue(scope, ctx);
}

export function isBlueprintNodeAllowedInGraphContext(
    def: BlueprintNodeGraphContextDef,
    ctx: BlueprintPaletteContext,
): boolean {
    if (!def.graphKinds.includes(ctx.graphKind)) {
        return false;
    }
    if (!matchesBlueprintNodeScope(def, ctx)) {
        return false;
    }
    if (ctx.isBlueprintValueGraph && !isBlueprintNodeAllowedInBlueprintValueGraph(def)) {
        return false;
    }
    if (ctx.graphKind === "function" && (def.isLatent || !def.isPure)) {
        return false;
    }
    if (ctx.graphKind === "function" && def.role === "eventHead") {
        return false;
    }
    if (ctx.graphKind === "event" && def.role === "functionEntry") {
        return false;
    }
    if (ctx.graphKind === "function" && def.role === "functionEntry" && ctx.hasFunctionEntry) {
        return false;
    }
    if (def.role === "eventHead" && ctx.owner.kind === "widgetMain") {
        const allowed = resolveAllowedWidgetEventHeadTypesForPalette(ctx);
        if (!allowed.has(def.type)) {
            return false;
        }
    }
    return true;
}

class BlueprintNodeDefinitionsRegistry {
    private readonly byType = new Map<string, BlueprintNodeDef>();

    public register(def: BlueprintNodeDef): void {
        if (this.byType.has(def.type)) {
            throw new Error(`[BlueprintNodeRegistry] Duplicate node type: ${def.type}`);
        }
        this.validatePorts(def);
        this.validateDynamicInputPins(def);
        this.validateGraphKinds(def);
        this.byType.set(def.type, def);
        behaviorNodeRegistry.register({
            type: def.type,
            displayName: def.displayName,
            execute: def.execute,
        });
    }

    public registerMany(defs: BlueprintNodeDef[]): void {
        for (const d of defs) {
            this.register(d);
        }
    }

    public get(type: string): BlueprintNodeDef | undefined {
        return this.byType.get(type);
    }

    public list(): BlueprintNodeDef[] {
        return Array.from(this.byType.values());
    }

    public toCatalogEntry(def: BlueprintNodeDef): BlueprintNodeEditorCatalogEntry {
        return {
            type: def.type,
            category: def.category,
            displayName: def.displayName,
            keywords: def.keywords,
            isPure: def.isPure,
            pins: def.pins.map(p => ({
                id: p.id,
                kind: p.kind,
                semantic: p.semantic,
                valueType: p.valueType,
                label: p.label,
                allowInlineLiteral: p.allowInlineLiteral,
            })),
            inspectorParams: def.inspectorParams,
            graphKinds: def.graphKinds,
            role: def.role,
            scope: def.scope,
            supportsDynamicInputPins: Boolean(def.dynamicInputPins),
            dynamicInputPinAddLabel: def.dynamicInputPins?.addButtonLabel,
            dynamicInputPinLabelParamKey: def.dynamicInputPins?.pinLabelParamKey,
        };
    }

    public resolveCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry {
        const def = this.byType.get(type);
        if (def) {
            return this.toCatalogEntry(def);
        }
        const runtime = behaviorNodeRegistry.get(type);
        return {
            type,
            category: "Other",
            displayName: runtime?.displayName ?? type,
            isPure: false,
            graphKinds: ["event", "function", "macro"],
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
        };
    }

    /**
     * Catalog entry with pins merged from node instance params (dynamic input pins).
     */
    public resolveCatalogEntryForNode(type: string, params?: Record<string, unknown>): BlueprintNodeEditorCatalogEntry {
        const def = this.byType.get(type);
        if (def) {
            return resolveEffectiveBlueprintCatalogEntry(def, params);
        }
        return this.resolveCatalogEntry(type);
    }

    /**
     * Palette entries visible for the given graph + owner context.
     */
    public listPaletteEntries(ctx: BlueprintPaletteContext): BlueprintNodeEditorCatalogEntry[] {
        const out: BlueprintNodeEditorCatalogEntry[] = [];
        for (const def of this.byType.values()) {
            if (def.magicElementTarget) {
                continue;
            }
            if (def.hideInPalette) {
                continue;
            }
            if (!isBlueprintNodeAllowedInGraphContext(def, ctx)) {
                continue;
            }
            out.push(this.toCatalogEntry(def));
        }
        for (const def of this.byType.values()) {
            if (!def.magicElementTarget) {
                continue;
            }
            if (def.hideInPalette) {
                continue;
            }
            if (!isBlueprintNodeAllowedInGraphContext(def, ctx)) {
                continue;
            }
            const elementTypes = def.magicElementTarget.elementTypes;
            for (const ref of ctx.magicElementRefs ?? []) {
                if (elementTypes && !elementTypes.includes(ref.elementType)) {
                    continue;
                }
                out.push({
                    ...this.toCatalogEntry(def),
                    displayName: `${ref.label}: ${def.displayName}`,
                    keywords: [
                        ...(def.keywords ?? []),
                        ref.label,
                        ref.elementId,
                        ref.elementType,
                    ],
                    magicElementRef: {
                        ...ref,
                        targetPortId: def.magicElementTarget.inputPinId,
                    },
                });
            }
        }
        return out.sort((a, b) => {
            const c = a.category.localeCompare(b.category);
            if (c !== 0) {
                return c;
            }
            const n = a.displayName.localeCompare(b.displayName);
            if (n !== 0) {
                return n;
            }
            return (a.magicElementRef?.sourceNodeId ?? "").localeCompare(b.magicElementRef?.sourceNodeId ?? "");
        });
    }

    private validatePorts(def: BlueprintNodeDef): void {
        const ids = new Set<string>();
        const scalarTypes = new Set<string>(BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES);
        for (const p of def.pins) {
            if (!p.id) {
                throw new Error(`[BlueprintNodeRegistry] Node ${def.type} has pin without id`);
            }
            if (ids.has(p.id)) {
                throw new Error(`[BlueprintNodeRegistry] Node ${def.type} duplicate pin id: ${p.id}`);
            }
            ids.add(p.id);
            if (p.allowInlineLiteral) {
                if (p.kind !== "input" || p.semantic !== "data") {
                    throw new Error(
                        `[BlueprintNodeRegistry] allowInlineLiteral only on data inputs: ${def.type}.${p.id}`,
                    );
                }
                const vt = p.valueType;
                if (!vt || !scalarTypes.has(vt)) {
                    throw new Error(
                        `[BlueprintNodeRegistry] allowInlineLiteral requires valueType string|integer|float: ${def.type}.${p.id}`,
                    );
                }
            }
        }
    }

    private validateGraphKinds(def: BlueprintNodeDef): void {
        if (!def.graphKinds.length) {
            throw new Error(`[BlueprintNodeRegistry] Node ${def.type} must allow at least one graphKind`);
        }
    }

    private validateDynamicInputPins(def: BlueprintNodeDef): void {
        const d = def.dynamicInputPins;
        if (!d) {
            return;
        }
        if (!d.storageKey.trim()) {
            throw new Error(`[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.storageKey is empty`);
        }
        if (!d.generatedIdPrefix.trim()) {
            throw new Error(`[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.generatedIdPrefix is empty`);
        }
        if (d.pinLabelParamKey !== undefined && !d.pinLabelParamKey.trim()) {
            throw new Error(`[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.pinLabelParamKey is empty`);
        }
        if (d.outputInsertBeforePinId !== undefined) {
            const outputIds = new Set(def.pins.filter(p => p.kind === "output").map(p => p.id));
            if (!outputIds.has(d.outputInsertBeforePinId)) {
                throw new Error(
                    `[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.outputInsertBeforePinId contains unknown output pin: ${d.outputInsertBeforePinId}`,
                );
            }
        }
        const dataInputIds = new Set(
            def.pins.filter(p => p.kind === "input" && p.semantic === "data").map(p => p.id),
        );
        for (const fid of d.fixedDataInputIds) {
            if (!dataInputIds.has(fid)) {
                throw new Error(
                    `[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.fixedDataInputIds contains unknown pin: ${fid}`,
                );
            }
        }
        if (d.allowInlineLiteral) {
            const scalarTypes = new Set<string>(BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES);
            if (!d.valueType || !scalarTypes.has(d.valueType)) {
                throw new Error(
                    `[BlueprintNodeRegistry] Node ${def.type} dynamic pins allowInlineLiteral requires valueType string|integer|float`,
                );
            }
        }
        const templateSuffixes = new Set<string>();
        for (const template of d.generatedPinTemplates ?? []) {
            if (!template.idSuffix.trim()) {
                throw new Error(
                    `[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.generatedPinTemplates idSuffix is empty`,
                );
            }
            if (templateSuffixes.has(template.idSuffix)) {
                throw new Error(
                    `[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.generatedPinTemplates has duplicate idSuffix: ${template.idSuffix}`,
                );
            }
            templateSuffixes.add(template.idSuffix);
            if (!template.label.trim()) {
                throw new Error(
                    `[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.generatedPinTemplates label is empty`,
                );
            }
            if (template.kind === "output" && template.allowInlineLiteral) {
                throw new Error(
                    `[BlueprintNodeRegistry] Node ${def.type} dynamic output pin template cannot allow inline literals`,
                );
            }
            if (template.allowInlineLiteral) {
                const scalarTypes = new Set<string>(BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES);
                if (!template.valueType || !scalarTypes.has(template.valueType)) {
                    throw new Error(
                        `[BlueprintNodeRegistry] Node ${def.type} dynamic pin template allowInlineLiteral requires valueType string|integer|float`,
                    );
                }
            }
        }
    }
}

export const blueprintNodeRegistry = new BlueprintNodeDefinitionsRegistry();
