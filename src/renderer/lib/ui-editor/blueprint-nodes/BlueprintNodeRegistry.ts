/**
 * Central registry for blueprint node definitions (editor + runtime).
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING,
    resolveBlueprintEventHeadTypesForUiSlot,
} from "@shared/types/blueprint/graph";
import { listWidgetLogicEventIds } from "@shared/types/ui-editor/widgetLogic";
import { behaviorNodeRegistry } from "../behavior-graph/BehaviorNodeRegistry";
import {
    BLUEPRINT_PIN_INLINE_LITERAL_CUSTOM_VALUE_TYPES,
    BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES,
    type BlueprintMagicElementRefPaletteEntry,
    type BlueprintNodeDef,
    type BlueprintNodeEditorCatalogEntry,
    type BlueprintPaletteContext,
} from "./types";
import { resolveEffectiveBlueprintCatalogEntry } from "./effectivePins";

type BlueprintNodeGraphContextDef = Pick<
    BlueprintNodeDef,
    | "type"
    | "category"
    | "graphKinds"
    | "isPure"
    | "isLatent"
    | "role"
    | "scope"
    | "magicElementTarget"
    | "inspectorParams"
>;

const INLINE_LITERAL_VALUE_TYPES = [
    ...BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES,
    ...BLUEPRINT_PIN_INLINE_LITERAL_CUSTOM_VALUE_TYPES,
];

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
        return def.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT || def.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH;
    }
    // Call Fn is deliberately allowed despite being latent/impure: value graphs call
    // fns with their host widget identity (fn body side effects are the author's choice).
    if (def.type === BLUEPRINT_NODE_TYPE_FN_CALL) {
        return true;
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
        return !def.isLatent &&
            def.type !== BLUEPRINT_NODE_TYPE_FLOW_DELAY &&
            def.type !== BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY;
    }
    if (!def.isPure || def.isLatent) {
        return false;
    }
    if (
        def.type === BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS ||
        def.type === BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING ||
        def.type === BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING ||
        def.type === BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING
    ) {
        return true;
    }
    return (
        def.category === "Data" ||
        def.category === "List" ||
        def.category === "Math" ||
        def.category === "Text" ||
        def.category === "Slider" ||
        def.category === "Displayable" ||
        def.category === "Element" ||
        def.category === "Game"
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
        if (ctx.owner.kind !== "widgetMain" && ctx.owner.kind !== "componentWidgetMain") {
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

function listCompatibleMagicElementRefs(
    def: BlueprintNodeDef,
    ctx: BlueprintPaletteContext,
): BlueprintMagicElementRefPaletteEntry[] {
    const target = def.magicElementTarget;
    if (!target) {
        return [];
    }
    const refs = ctx.magicElementRefs ?? [];
    if (refs.length === 0) {
        return [];
    }
    const elementTypes = target.elementTypes;
    return refs
        .filter(ref => !elementTypes || elementTypes.includes(ref.elementType))
        .map(ref => ref.targetPortId === target.inputPinId ? ref : { ...ref, targetPortId: target.inputPinId });
}

function listMagicElementPaletteTargets(
    def: BlueprintNodeDef,
    ctx: BlueprintPaletteContext,
): Array<BlueprintMagicElementRefPaletteEntry | undefined> {
    const refs = listCompatibleMagicElementRefs(def, ctx);
    if (refs.length <= 1) {
        return refs;
    }
    return [undefined];
}

function canUseImageAssetLiteral(ctx: BlueprintPaletteContext): boolean {
    if (
        (ctx.owner.kind === "widgetMain" || ctx.owner.kind === "componentWidgetMain") &&
        ctx.widgetElementType === "nl.image"
    ) {
        return true;
    }
    return (ctx.magicElementRefs ?? []).some(ref => ref.elementType === "nl.image");
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
    // Sync-only graphs (inline story values) forbid async ("latent") nodes but keep synchronous exec
    // nodes such as branches and Get/Set var, so an inline blueprint's Return Value can be evaluated
    // in the same tick as the dialogue word that renders it.
    if (ctx.isSyncOnlyGraph && def.isLatent) {
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
    if (def.role === "eventHead" && (ctx.owner.kind === "widgetMain" || ctx.owner.kind === "componentWidgetMain")) {
        const allowed = resolveAllowedWidgetEventHeadTypesForPalette(ctx);
        if (!allowed.has(def.type)) {
            return false;
        }
    }
    return true;
}

class BlueprintNodeDefinitionsRegistry {
    private readonly byType = new Map<string, BlueprintNodeDef>();

    public register(def: BlueprintNodeDef, options?: { replaceExisting?: boolean }): void {
        if (this.byType.has(def.type) && !options?.replaceExisting) {
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
        }, { quietOverwrite: true });
    }

    public registerMany(defs: BlueprintNodeDef[], options?: { replaceExisting?: boolean }): void {
        for (const d of defs) {
            this.register(d, options);
        }
    }

    public get(type: string): BlueprintNodeDef | undefined {
        return this.byType.get(type);
    }

    public list(): BlueprintNodeDef[] {
        return Array.from(this.byType.values());
    }

    public toCatalogEntry(def: BlueprintNodeDef): BlueprintNodeEditorCatalogEntry {
        return resolveEffectiveBlueprintCatalogEntry(def);
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
            if (def.type === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL && !canUseImageAssetLiteral(ctx)) {
                continue;
            }
            if (def.requiresListItemContext && !ctx.listItemContextAvailable) {
                continue;
            }
            if (def.magicElementTarget) {
                const magicElementRefs = listMagicElementPaletteTargets(def, ctx);
                if (magicElementRefs.length === 0) {
                    continue;
                }
                if (!isBlueprintNodeAllowedInGraphContext({ ...def, scope: undefined }, ctx)) {
                    continue;
                }
                for (const magicElementRef of magicElementRefs) {
                    const entry = this.toCatalogEntry(def);
                    out.push(magicElementRef ? { ...entry, magicElementRef } : entry);
                }
                continue;
            }
            if (!isBlueprintNodeAllowedInGraphContext(def, ctx)) {
                continue;
            }
            out.push(this.toCatalogEntry(def));
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
            const t = a.type.localeCompare(b.type);
            if (t !== 0) {
                return t;
            }
            return 0;
        });
    }

    private validatePorts(def: BlueprintNodeDef): void {
        const ids = new Set<string>();
        const scalarTypes = new Set<string>(INLINE_LITERAL_VALUE_TYPES);
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
                        `[BlueprintNodeRegistry] allowInlineLiteral requires a supported inline valueType: ${def.type}.${p.id}`,
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
        if (d.pinValueTypeParamKey !== undefined && !d.pinValueTypeParamKey.trim()) {
            throw new Error(`[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.pinValueTypeParamKey is empty`);
        }
        if (d.pinValueTypeOptions !== undefined && d.pinValueTypeOptions.length === 0) {
            throw new Error(`[BlueprintNodeRegistry] Node ${def.type} dynamicInputPins.pinValueTypeOptions is empty`);
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
            const scalarTypes = new Set<string>(INLINE_LITERAL_VALUE_TYPES);
            if (!d.valueType || !scalarTypes.has(d.valueType)) {
                throw new Error(
                    `[BlueprintNodeRegistry] Node ${def.type} dynamic pins allowInlineLiteral requires a supported inline valueType`,
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
                const scalarTypes = new Set<string>(INLINE_LITERAL_VALUE_TYPES);
                if (!template.valueType || !scalarTypes.has(template.valueType)) {
                    throw new Error(
                        `[BlueprintNodeRegistry] Node ${def.type} dynamic pin template allowInlineLiteral requires a supported inline valueType`,
                    );
                }
            }
        }
    }
}

export const blueprintNodeRegistry = new BlueprintNodeDefinitionsRegistry();
