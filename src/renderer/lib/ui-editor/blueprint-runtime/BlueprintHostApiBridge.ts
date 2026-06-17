import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import { truncateDebugEventMessage } from "./DebugBridge";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues, type ElementEffectValues } from "@shared/types/ui-editor/effects";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { ScopeStoreBridge } from "./ScopeStoreBridge";
import { isAppearanceCapableElementType } from "./appearanceCapableWidgets";
import { getTextProps } from "@/lib/ui-editor/widget-modules/builtin/text/helpers";
import type {
    TextAlign,
    TextVerticalAlign,
    TextWidgetProps,
    TextWrapMode,
} from "@/lib/ui-editor/widget-modules/builtin/text/types";

export type DevModeWidgetRuntimePatch = {
    visible?: boolean;
    enabled?: boolean;
};

export type BlueprintTextProperties = Pick<
    TextWidgetProps,
    | "text"
    | "fontAssetId"
    | "fontSize"
    | "fontWeight"
    | "color"
    | "textAlign"
    | "textVerticalAlign"
    | "lineHeight"
    | "textWrapMode"
    | "effects"
>;

export type BlueprintTextPropertiesPatch = Partial<BlueprintTextProperties>;

export type BlueprintHostApiRuntime = {
    navigation: {
        openSurface: (surfaceId: string) => Promise<void>;
        closeLayer: () => Promise<void>;
    };
    widget: {
        setVisible: (elementId: string, visible: boolean) => Promise<void>;
        setEnabled: (elementId: string, enabled: boolean) => Promise<void>;
        /** `null` clears runtime override and restores authored default variant resolution. */
        setVariant: (elementId: string, variantId: string | null) => Promise<void>;
        getTextProperties: (elementId: string) => BlueprintTextProperties;
        setTextProperties: (elementId: string, patch: BlueprintTextPropertiesPatch) => Promise<void>;
    };
    state: {
        get: (scope: string, key: string) => unknown;
        set: (scope: string, key: string, value: unknown) => void;
    };
    persistence: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<void>;
    };
    devtools: {
        log: (level: string, message: string) => void;
    };
};

export type CreateBlueprintHostApiRuntimeOptions = {
    document: UIDocument;
    scope: ScopeStoreBridge;
    activeSurfaceId: string;
    emit: (event: BlueprintDebugEvent) => void;
    onOpenSurface: (surfaceId: string) => void;
    onCloseLayer: () => void;
    onWidgetPatch: (elementId: string, patch: DevModeWidgetRuntimePatch) => void;
    widgetRuntimeStore: WidgetRuntimeStateStore;
};

function assertAppearanceVariantId(document: UIDocument, elementId: string, variantId: string | null): void {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`setVariant: element not found: ${elementId}`);
    }
    if (!isAppearanceCapableElementType(el.type)) {
        throw new Error(`setVariant: element type does not support appearance variants: ${el.type}`);
    }
    if (variantId === null) {
        return;
    }
    const rawAppearance = (el.props as Record<string, unknown> | undefined)?.appearance;
    if (!rawAppearance || typeof rawAppearance !== "object") {
        throw new Error(`setVariant: element has no appearance model: ${elementId}`);
    }
    const variants = (rawAppearance as { variants?: { id: string }[] }).variants;
    if (!Array.isArray(variants) || variants.length === 0) {
        throw new Error(`setVariant: element has no appearance variants: ${elementId}`);
    }
    if (!variants.some(v => v.id === variantId)) {
        throw new Error(`setVariant: unknown variant id "${variantId}" for element ${elementId}`);
    }
}

function assertTextElement(document: UIDocument, elementId: string) {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`text: element not found: ${elementId}`);
    }
    if (el.type !== "nl.text") {
        throw new Error(`text: element is not a Text widget: ${el.type}`);
    }
    return el;
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function readTextProperties(document: UIDocument, elementId: string): BlueprintTextProperties {
    const el = assertTextElement(document, elementId);
    const p = getTextProps(el);
    return {
        text: p.text,
        fontAssetId: p.fontAssetId,
        fontSize: p.fontSize,
        fontWeight: p.fontWeight,
        color: p.color,
        textAlign: p.textAlign,
        textVerticalAlign: p.textVerticalAlign,
        lineHeight: p.lineHeight,
        textWrapMode: p.textWrapMode,
        effects: cloneJson(p.effects),
    };
}

function finiteNumber(raw: unknown, fallback: number): number {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeFontAssetId(raw: unknown): string | null {
    if (raw === null) {
        return null;
    }
    const s = String(raw ?? "").trim();
    return s.length > 0 ? s : null;
}

function normalizeString(raw: unknown, fallback: string): string {
    return raw == null ? fallback : String(raw);
}

function normalizeColor(raw: unknown, fallback: string): string {
    const s = String(raw ?? "").trim();
    return s.length > 0 ? s : fallback;
}

function normalizeTextAlign(raw: unknown, fallback: TextAlign): TextAlign {
    return raw === "left" || raw === "center" || raw === "right" ? raw : fallback;
}

function normalizeTextVerticalAlign(raw: unknown, fallback: TextVerticalAlign): TextVerticalAlign {
    return raw === "start" || raw === "center" || raw === "end" ? raw : fallback;
}

function normalizeFontWeight(raw: unknown, fallback: BlueprintTextProperties["fontWeight"]) {
    return raw === "normal" || raw === "600" || raw === "bold" ? raw : fallback;
}

function normalizeTextWrapMode(raw: unknown, fallback: TextWrapMode): TextWrapMode {
    return raw === "word" || raw === "character" || raw === "nowrap" ? raw : fallback;
}

function patchHas<K extends keyof BlueprintTextProperties>(
    patch: BlueprintTextPropertiesPatch,
    key: K,
): patch is BlueprintTextPropertiesPatch & Pick<BlueprintTextProperties, K> {
    return Object.prototype.hasOwnProperty.call(patch, key);
}

function normalizeTextPatch(
    current: BlueprintTextProperties,
    patch: BlueprintTextPropertiesPatch,
): BlueprintTextPropertiesPatch {
    const next: BlueprintTextPropertiesPatch = {};
    if (patchHas(patch, "text")) {
        next.text = normalizeString(patch.text, current.text);
    }
    if (patchHas(patch, "fontAssetId")) {
        next.fontAssetId = normalizeFontAssetId(patch.fontAssetId);
    }
    if (patchHas(patch, "fontSize")) {
        next.fontSize = Math.max(1, finiteNumber(patch.fontSize, current.fontSize));
    }
    if (patchHas(patch, "fontWeight")) {
        next.fontWeight = normalizeFontWeight(patch.fontWeight, current.fontWeight);
    }
    if (patchHas(patch, "color")) {
        next.color = normalizeColor(patch.color, current.color);
    }
    if (patchHas(patch, "textAlign")) {
        next.textAlign = normalizeTextAlign(patch.textAlign, current.textAlign);
    }
    if (patchHas(patch, "textVerticalAlign")) {
        next.textVerticalAlign = normalizeTextVerticalAlign(patch.textVerticalAlign, current.textVerticalAlign);
    }
    if (patchHas(patch, "lineHeight")) {
        next.lineHeight = Math.max(0.1, finiteNumber(patch.lineHeight, current.lineHeight));
    }
    if (patchHas(patch, "textWrapMode")) {
        next.textWrapMode = normalizeTextWrapMode(patch.textWrapMode, current.textWrapMode);
    }
    if (patchHas(patch, "effects")) {
        next.effects = cloneJson<ElementEffectValues>(normalizeElementEffectValues(patch.effects));
    }
    return next;
}

function emitHostCall(emit: (event: BlueprintDebugEvent) => void, capabilityId: string, phase: "call" | "return"): void {
    if (phase === "call") {
        emit({ type: "function.call", functionId: capabilityId });
    } else {
        emit({ type: "function.return", functionId: capabilityId });
    }
}

/**
 * Unified Host API implementation for Dev Mode (M3-full). Workspace editor does not instantiate this.
 */
export function createDevModeBlueprintHostApi(options: CreateBlueprintHostApiRuntimeOptions): BlueprintHostApiRuntime {
    const { document, scope, activeSurfaceId, emit, onOpenSurface, onCloseLayer, onWidgetPatch, widgetRuntimeStore } =
        options;

    return {
        navigation: {
            openSurface: async (surfaceId: string) => {
                const cap = "navigation.openSurface";
                emitHostCall(emit, cap, "call");
                const target = document.surfaces.find(s => s.id === surfaceId);
                if (!target) {
                    emitHostCall(emit, cap, "return");
                    throw new Error(`openSurface: surface not found: ${surfaceId}`);
                }
                onOpenSurface(surfaceId);
                emitHostCall(emit, cap, "return");
            },
            closeLayer: async () => {
                const cap = "navigation.closeLayer";
                emitHostCall(emit, cap, "call");
                onCloseLayer();
                emitHostCall(emit, cap, "return");
            },
        },
        widget: {
            setVisible: async (elementId: string, visible: boolean) => {
                const cap = "widget.setVisible";
                emitHostCall(emit, cap, "call");
                const el = document.elements[elementId];
                if (!el) {
                    emitHostCall(emit, cap, "return");
                    throw new Error(`setVisible: element not found: ${elementId}`);
                }
                if (isAppearanceCapableElementType(el.type)) {
                    emitHostCall(emit, cap, "return");
                    throw new Error(
                        `setVisible: not supported for ${el.type}; use widget.setVariant to change appearance`,
                    );
                }
                onWidgetPatch(elementId, { visible });
                emitHostCall(emit, cap, "return");
            },
            setEnabled: async (elementId: string, enabled: boolean) => {
                const cap = "widget.setEnabled";
                emitHostCall(emit, cap, "call");
                const el = document.elements[elementId];
                if (!el) {
                    emitHostCall(emit, cap, "return");
                    throw new Error(`setEnabled: element not found: ${elementId}`);
                }
                if (isAppearanceCapableElementType(el.type)) {
                    emitHostCall(emit, cap, "return");
                    throw new Error(
                        `setEnabled: not supported for ${el.type}; use widget.setVariant to change appearance`,
                    );
                }
                onWidgetPatch(elementId, { enabled });
                emitHostCall(emit, cap, "return");
            },
            setVariant: async (elementId: string, variantId: string | null) => {
                const cap = "widget.setVariant";
                emitHostCall(emit, cap, "call");
                assertAppearanceVariantId(document, elementId, variantId);
                widgetRuntimeStore.setVariantOverride(elementId, variantId);
                emitHostCall(emit, cap, "return");
            },
            getTextProperties: (elementId: string) => {
                const cap = "widget.getTextProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readTextProperties(document, elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setTextProperties: async (elementId: string, patch: BlueprintTextPropertiesPatch) => {
                const cap = "widget.setTextProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const current = readTextProperties(document, elementId);
                    const el = assertTextElement(document, elementId);
                    el.props = {
                        ...(el.props ?? {}),
                        ...normalizeTextPatch(current, patch),
                    };
                    onWidgetPatch(elementId, {});
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
        },
        state: {
            get: (scopeKind: string, key: string) => {
                emit({ type: "state.read", scope: scopeKind, key });
                if (scopeKind === "surface") {
                    return scope.getSurfaceStore(activeSurfaceId).get(key);
                }
                if (scopeKind === "global") {
                    return scope.globalGet(key);
                }
                if (scopeKind === "persistence") {
                    return scope.persistenceGet(key);
                }
                return undefined;
            },
            set: (scopeKind: string, key: string, value: unknown) => {
                if (scopeKind === "surface") {
                    scope.getSurfaceStore(activeSurfaceId).set(key, value);
                } else if (scopeKind === "global") {
                    scope.globalSet(key, value);
                } else if (scopeKind === "persistence") {
                    scope.persistenceSet(key, value);
                }
                emit({ type: "state.write", scope: scopeKind, key });
            },
        },
        persistence: {
            get: async (key: string) => {
                emitHostCall(emit, "persistence.get", "call");
                const v = scope.persistenceGet(key);
                emitHostCall(emit, "persistence.get", "return");
                return v;
            },
            set: async (key: string, value: unknown) => {
                emitHostCall(emit, "persistence.set", "call");
                scope.persistenceSet(key, value);
                emit({ type: "state.write", scope: "persistence", key });
                emitHostCall(emit, "persistence.set", "return");
            },
        },
        devtools: {
            log: (level: string, message: string) => {
                const safeMessage = truncateDebugEventMessage(String(message));
                emitHostCall(emit, "devtools.log", "call");
                emit({ type: "devtools.log", level, message: safeMessage });
                const line = `[Blueprint devtools.${level}] ${safeMessage}`;
                if (level === "error") {
                    console.error(line);
                } else if (level === "warn") {
                    console.warn(line);
                } else {
                    console.info(line);
                }
                emitHostCall(emit, "devtools.log", "return");
            },
        },
    };
}
