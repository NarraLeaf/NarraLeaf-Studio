/**
 * Central registry for blueprint node definitions (editor + runtime).
 * Comments in English per project convention.
 */

import { resolveBlueprintEventHeadTypesForUiSlot } from "@shared/types/blueprint/graph";
import { behaviorNodeRegistry } from "../behavior-graph/BehaviorNodeRegistry";
import {
    BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES,
    type BlueprintNodeDef,
    type BlueprintNodeEditorCatalogEntry,
    type BlueprintPaletteContext,
} from "./types";
import { resolveEffectiveBlueprintCatalogEntry } from "./effectivePins";

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

    if (slots.length === 0) {
        if (catalog && catalog.length > 0) {
            for (const ev of catalog) {
                addSlot(ev.id);
            }
        } else {
            addSlot("init");
            if (widgetElementType === "nl.button") {
                addSlot("click");
            }
        }
        return allow;
    }
    for (const s of slots) {
        addSlot(s);
    }
    return allow;
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
            if (def.hideInPalette) {
                continue;
            }
            if (!def.graphKinds.includes(ctx.graphKind)) {
                continue;
            }
            if (!this.matchesScope(def, ctx)) {
                continue;
            }
            if (ctx.graphKind === "function" && (def.isLatent || !def.isPure)) {
                // Function graphs: only pure, non-latent nodes (framework rule)
                if (!def.isPure || def.isLatent) {
                    continue;
                }
            }
            if (ctx.graphKind === "function" && def.role === "eventHead") {
                continue;
            }
            if (ctx.graphKind === "event" && def.role === "functionEntry") {
                continue;
            }
            if (ctx.graphKind === "function" && def.role === "functionEntry" && ctx.hasFunctionEntry) {
                continue;
            }
            if (def.role === "eventHead" && ctx.owner.kind === "widgetMain") {
                const allowed = resolveAllowedWidgetEventHeadTypesForPalette(ctx);
                if (!allowed.has(def.type)) {
                    continue;
                }
            }
            out.push(this.toCatalogEntry(def));
        }
        return out.sort((a, b) => {
            const c = a.category.localeCompare(b.category);
            if (c !== 0) {
                return c;
            }
            return a.displayName.localeCompare(b.displayName);
        });
    }

    private matchesScope(def: BlueprintNodeDef, ctx: BlueprintPaletteContext): boolean {
        const scope = def.scope;
        if (!scope) {
            return true;
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
    }
}

export const blueprintNodeRegistry = new BlueprintNodeDefinitionsRegistry();
