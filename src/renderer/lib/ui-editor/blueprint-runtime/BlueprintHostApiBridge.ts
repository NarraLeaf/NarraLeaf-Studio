import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import {
    normalizeBlueprintImageAssetValue,
    toBlueprintImageAsset,
    type BlueprintElementRef,
    type BlueprintImageAsset,
} from "@shared/types/blueprint/valueTypes";
import { truncateDebugEventMessage } from "./DebugBridge";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues, type ElementEffectValues } from "@shared/types/ui-editor/effects";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { ScopeStoreBridge } from "./ScopeStoreBridge";
import { isAppearanceCapableElementType } from "./appearanceCapableWidgets";
import { getTextProps } from "@/lib/ui-editor/widget-modules/builtin/text/helpers";
import { getSliderProps } from "@/lib/ui-editor/widget-modules/builtin/slider/helpers";
import { getListProps } from "@/lib/ui-editor/widget-modules/builtin/list/helpers";
import { getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import { getContainerProps } from "@/lib/ui-editor/widget-modules/builtin/container/helpers";
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { getFrameProps } from "@/lib/ui-editor/widget-modules/builtin/frame/helpers";
import { buildImageFillPropsUpdate } from "@/lib/ui-editor/widget-modules/shared/chrome/imageFillProps";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type {
    TextAlign,
    TextVerticalAlign,
    TextWidgetProps,
    TextWrapMode,
} from "@/lib/ui-editor/widget-modules/builtin/text/types";
import type { UISliderRuntimeValue, UISliderWidgetProps } from "@shared/types/ui-editor/slider";
import { resolveSliderRuntimeValue } from "@shared/types/ui-editor/slider";

export type DevModeWidgetRuntimePatch = {
    visible?: boolean;
    enabled?: boolean;
};

export type BlueprintElementFlushPayload = {
    element: BlueprintElementRef;
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

export type BlueprintSliderProperties = UISliderRuntimeValue;

export type BlueprintSliderPropertiesPatch = Partial<Pick<UISliderWidgetProps, "value" | "min" | "max" | "step">>;

export type BlueprintListProperties = {
    items: unknown[];
    selectedIndex: number;
};

export type BlueprintDisplayableProperties = {
    position: { x: number; y: number };
    size: { width: number; height: number };
    bounds: { x: number; y: number; width: number; height: number };
    rotation: number;
    opacity: number;
    visible: boolean;
};

export type BlueprintWidgetCommonProperties = {
    visible: boolean;
    enabled: boolean;
    variantId: string | null;
};

export type BlueprintButtonProperties = {
    label: string;
};

export type BlueprintContainerProperties = {
    clipContent: boolean;
};

export type BlueprintImageProperties = {
    asset: BlueprintImageAsset | null;
    /** Legacy patch/read alias kept so older saved graph nodes can still run. */
    assetId: string | null;
};

export type BlueprintFrameProperties = {
    targetSurfaceId: string | null;
    params: Record<string, unknown>;
};

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
        getCommonProperties: (elementId: string) => BlueprintWidgetCommonProperties;
        getTextProperties: (elementId: string) => BlueprintTextProperties;
        setTextProperties: (elementId: string, patch: BlueprintTextPropertiesPatch) => Promise<void>;
        getButtonProperties: (elementId: string) => BlueprintButtonProperties;
        setButtonProperties: (elementId: string, patch: Partial<BlueprintButtonProperties>) => Promise<void>;
        getContainerProperties: (elementId: string) => BlueprintContainerProperties;
        setContainerProperties: (elementId: string, patch: Partial<BlueprintContainerProperties>) => Promise<void>;
        getImageProperties: (elementId: string) => BlueprintImageProperties;
        setImageProperties: (elementId: string, patch: Partial<BlueprintImageProperties>) => Promise<void>;
        getSliderProperties: (elementId: string) => BlueprintSliderProperties;
        setSliderProperties: (elementId: string, patch: BlueprintSliderPropertiesPatch) => Promise<void>;
        getListProperties: (elementId: string) => BlueprintListProperties;
        setListItems: (elementId: string, items: readonly unknown[]) => Promise<void>;
        setListSelectedIndex: (elementId: string, index: number) => Promise<void>;
        scrollListToIndex: (elementId: string, index: number) => Promise<void>;
        scrollListToTop: (elementId: string) => Promise<void>;
        scrollListToBottom: (elementId: string) => Promise<void>;
        getDisplayableProperties: (elementId: string) => BlueprintDisplayableProperties;
        getFrameProperties: (elementId: string) => BlueprintFrameProperties;
        setFrameProperties: (elementId: string, patch: Partial<BlueprintFrameProperties>) => Promise<void>;
    };
    state: {
        get: (scope: string, key: string) => unknown;
        set: (scope: string, key: string, value: unknown) => void;
    };
    persistence: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<void>;
    };
    frame: {
        getParam: (key: string) => unknown;
        emit: (eventName: string, data: unknown) => Promise<void>;
    };
    devtools: {
        log: (level: string, message: string) => void;
    };
};

export type CreateBlueprintHostApiRuntimeOptions = {
    document: UIDocument;
    scope: ScopeStoreBridge;
    activeSurfaceId: string;
    runtimeScopeId?: string;
    frameParams?: Record<string, unknown>;
    onFrameEmit?: (eventName: string, data: unknown) => Promise<void> | void;
    emit: (event: BlueprintDebugEvent) => void;
    onOpenSurface: (surfaceId: string) => void;
    onCloseLayer: () => void;
    onWidgetPatch: (elementId: string, patch: DevModeWidgetRuntimePatch) => void;
    onElementFlush?: (elementId: string, payload: BlueprintElementFlushPayload) => Promise<void> | void;
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

function assertSliderElement(document: UIDocument, elementId: string) {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`slider: element not found: ${elementId}`);
    }
    if (el.type !== "nl.slider") {
        throw new Error(`slider: element is not a Slider widget: ${el.type}`);
    }
    return el;
}

function assertListElement(document: UIDocument, elementId: string) {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`list: element not found: ${elementId}`);
    }
    if (el.type !== "nl.list") {
        throw new Error(`list: element is not a List widget: ${el.type}`);
    }
    return el;
}

function assertButtonElement(document: UIDocument, elementId: string) {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`button: element not found: ${elementId}`);
    }
    if (el.type !== "nl.button") {
        throw new Error(`button: element is not a Button widget: ${el.type}`);
    }
    return el;
}

function assertContainerElement(document: UIDocument, elementId: string) {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`container: element not found: ${elementId}`);
    }
    if (el.type !== "nl.container") {
        throw new Error(`container: element is not a Container widget: ${el.type}`);
    }
    return el;
}

function assertImageElement(document: UIDocument, elementId: string) {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`image: element not found: ${elementId}`);
    }
    if (el.type !== "nl.image") {
        throw new Error(`image: element is not an Image widget: ${el.type}`);
    }
    return el;
}

function assertFrameElement(document: UIDocument, elementId: string) {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`frame: element not found: ${elementId}`);
    }
    if (el.type !== "nl.frame") {
        throw new Error(`frame: element is not a Frame widget: ${el.type}`);
    }
    return el;
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function jsonEquals(a: unknown, b: unknown): boolean {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return a === b;
    }
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

function readAuthoredSliderProperties(document: UIDocument, elementId: string): UISliderWidgetProps {
    const el = assertSliderElement(document, elementId);
    return getSliderProps(el);
}

function readListItemsFallback(
    document: UIDocument,
    scope: ScopeStoreBridge,
    stateScopeId: string,
    elementId: string,
): unknown[] {
    const el = assertListElement(document, elementId);
    const props = getListProps(el);
    const binding = props.itemsBinding;
    if (binding) {
        const source =
            binding.kind === "globalState"
                ? scope.globalGet(binding.key)
                : scope.getSurfaceStore(stateScopeId).get(binding.key);
        if (Array.isArray(source)) {
            return cloneJson(source);
        }
    }
    if (props.previewItems.length > 0) {
        return cloneJson(props.previewItems);
    }
    return Array.from({ length: props.previewCount }, (_, index) => ({ index }));
}

function readListProperties(
    document: UIDocument,
    scope: ScopeStoreBridge,
    widgetRuntimeStore: WidgetRuntimeStateStore,
    runtimeScopeId: string | undefined,
    activeSurfaceId: string,
    stateScopeId: string,
    elementId: string,
): BlueprintListProperties {
    assertListElement(document, elementId);
    const scopedKey = scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId);
    const items = widgetRuntimeStore.getListItems(scopedKey) ?? readListItemsFallback(document, scope, stateScopeId, elementId);
    const selectedIndex = widgetRuntimeStore.getListSelectedIndex(scopedKey) ?? getListProps(document.elements[elementId]!).selectedIndex;
    return {
        items,
        selectedIndex,
    };
}

function readSliderProperties(
    document: UIDocument,
    widgetRuntimeStore: WidgetRuntimeStateStore,
    runtimeScopeId: string | undefined,
    activeSurfaceId: string,
    elementId: string,
): BlueprintSliderProperties {
    const authored = readAuthoredSliderProperties(document, elementId);
    const scopedKey = scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId);
    return widgetRuntimeStore.getSliderProperties(scopedKey) ?? resolveSliderRuntimeValue(authored);
}

function readDisplayableProperties(document: UIDocument, elementId: string): BlueprintDisplayableProperties {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`displayable: element not found: ${elementId}`);
    }
    const layout = el.layout;
    return {
        position: { x: layout.x, y: layout.y },
        size: { width: layout.width, height: layout.height },
        bounds: { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
        rotation: layout.rotation ?? 0,
        opacity: layout.opacity ?? 1,
        visible: layout.visible !== false,
    };
}

function readVariantId(document: UIDocument, widgetRuntimeStore: WidgetRuntimeStateStore, scopedKey: string, elementId: string): string | null {
    const override = widgetRuntimeStore.getVariantOverride(scopedKey);
    if (override) {
        return override;
    }
    const el = document.elements[elementId];
    const appearance = (el?.props as Record<string, unknown> | undefined)?.appearance as
        | { defaultVariantId?: unknown; variants?: Array<{ id?: unknown }> }
        | undefined;
    const defaultVariantId = typeof appearance?.defaultVariantId === "string" ? appearance.defaultVariantId.trim() : "";
    if (defaultVariantId) {
        return defaultVariantId;
    }
    const first = Array.isArray(appearance?.variants) ? appearance.variants[0]?.id : undefined;
    return typeof first === "string" && first.trim() ? first.trim() : null;
}

function readCommonProperties(
    document: UIDocument,
    widgetRuntimeStore: WidgetRuntimeStateStore,
    runtimePatches: Map<string, DevModeWidgetRuntimePatch>,
    scopedKey: string,
    elementId: string,
): BlueprintWidgetCommonProperties {
    const el = document.elements[elementId];
    if (!el) {
        throw new Error(`widget: element not found: ${elementId}`);
    }
    const patch = runtimePatches.get(elementId);
    const props = (el.props ?? {}) as Record<string, unknown>;
    return {
        visible: patch?.visible ?? el.layout.visible !== false,
        enabled: patch?.enabled ?? !Boolean(props.interactionDisabled),
        variantId: readVariantId(document, widgetRuntimeStore, scopedKey, elementId),
    };
}

function readButtonProperties(document: UIDocument, elementId: string): BlueprintButtonProperties {
    return { label: getButtonProps(assertButtonElement(document, elementId)).label };
}

function readContainerProperties(document: UIDocument, elementId: string): BlueprintContainerProperties {
    return { clipContent: getContainerProps(assertContainerElement(document, elementId)).clipContent };
}

function readImageProperties(document: UIDocument, elementId: string): BlueprintImageProperties {
    const p = getImageWidgetRectangleProps(assertImageElement(document, elementId));
    const assetId = p.imageFill?.assetId?.trim() || null;
    return { asset: toBlueprintImageAsset(assetId), assetId };
}

function readFrameProperties(document: UIDocument, elementId: string): BlueprintFrameProperties {
    const p = getFrameProps(assertFrameElement(document, elementId));
    return {
        targetSurfaceId: p.targetSurfaceId,
        params: cloneJson(p.params ?? {}),
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

function normalizeNullableString(raw: unknown): string | null {
    if (raw === null) {
        return null;
    }
    const s = String(raw ?? "").trim();
    return s.length > 0 ? s : null;
}

function normalizeRecord(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === "object" && !Array.isArray(raw)
        ? cloneJson(raw as Record<string, unknown>)
        : {};
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

function textPatchChanges(current: BlueprintTextProperties, patch: BlueprintTextPropertiesPatch): boolean {
    for (const [key, value] of Object.entries(patch) as Array<[keyof BlueprintTextProperties, unknown]>) {
        if (!jsonEquals(current[key], value)) {
            return true;
        }
    }
    return false;
}

function sliderPropertiesEqual(a: BlueprintSliderProperties, b: BlueprintSliderProperties): boolean {
    return (
        a.value === b.value &&
        a.normalizedValue === b.normalizedValue &&
        a.min === b.min &&
        a.max === b.max &&
        a.step === b.step
    );
}

function emitHostCall(emit: (event: BlueprintDebugEvent) => void, capabilityId: string, phase: "call" | "return"): void {
    if (phase === "call") {
        emit({ type: "function.call", functionId: capabilityId });
    } else {
        emit({ type: "function.return", functionId: capabilityId });
    }
}

function scopedWidgetRuntimeKey(runtimeScopeId: string | undefined, activeSurfaceId: string, elementId: string): string {
    return `${runtimeScopeId ?? activeSurfaceId}\0${elementId}`;
}

/**
 * Unified Host API implementation for Dev Mode (M3-full). Workspace editor does not instantiate this.
 */
export function createDevModeBlueprintHostApi(options: CreateBlueprintHostApiRuntimeOptions): BlueprintHostApiRuntime {
    const {
        document,
        scope,
        activeSurfaceId,
        runtimeScopeId,
        frameParams,
        onFrameEmit,
        emit,
        onOpenSurface,
        onCloseLayer,
        onWidgetPatch,
        onElementFlush,
        widgetRuntimeStore,
    } =
        options;
    const stateScopeId = runtimeScopeId ?? activeSurfaceId;
    const pendingFlushElementIds = new Set<string>();
    const runtimePatches = new Map<string, DevModeWidgetRuntimePatch>();
    let flushScheduled = false;

    const scheduleElementFlush = (elementId: string) => {
        if (!onElementFlush) {
            return;
        }
        const el = document.elements[elementId];
        if (!el) {
            return;
        }
        pendingFlushElementIds.add(elementId);
        if (flushScheduled) {
            return;
        }
        flushScheduled = true;
        queueMicrotask(() => {
            flushScheduled = false;
            const elementIds = [...pendingFlushElementIds];
            pendingFlushElementIds.clear();
            for (const id of elementIds) {
                const target = document.elements[id];
                if (!target) {
                    continue;
                }
                void onElementFlush(id, {
                    element: {
                        surfaceId: activeSurfaceId,
                        elementId: id,
                        elementType: target.type,
                    },
                });
            }
        });
    };

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
                const previous = readCommonProperties(
                    document,
                    widgetRuntimeStore,
                    runtimePatches,
                    scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                    elementId,
                ).visible;
                runtimePatches.set(elementId, {
                    ...(runtimePatches.get(elementId) ?? {}),
                    visible,
                });
                onWidgetPatch(elementId, { visible });
                if (previous !== visible) {
                    scheduleElementFlush(elementId);
                }
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
                const previous = readCommonProperties(
                    document,
                    widgetRuntimeStore,
                    runtimePatches,
                    scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                    elementId,
                ).enabled;
                runtimePatches.set(elementId, {
                    ...(runtimePatches.get(elementId) ?? {}),
                    enabled,
                });
                onWidgetPatch(elementId, { enabled });
                if (previous !== enabled) {
                    scheduleElementFlush(elementId);
                }
                emitHostCall(emit, cap, "return");
            },
            setVariant: async (elementId: string, variantId: string | null) => {
                const cap = "widget.setVariant";
                emitHostCall(emit, cap, "call");
                assertAppearanceVariantId(document, elementId, variantId);
                const scopedKey = scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId);
                const previous = widgetRuntimeStore.getVariantOverride(scopedKey);
                widgetRuntimeStore.setVariantOverride(scopedKey, variantId);
                if (previous !== variantId) {
                    scheduleElementFlush(elementId);
                }
                emitHostCall(emit, cap, "return");
            },
            getCommonProperties: (elementId: string) => {
                const cap = "widget.getCommonProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readCommonProperties(
                        document,
                        widgetRuntimeStore,
                        runtimePatches,
                        scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                        elementId,
                    );
                } finally {
                    emitHostCall(emit, cap, "return");
                }
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
                    const normalized = normalizeTextPatch(current, patch);
                    if (!textPatchChanges(current, normalized)) {
                        return;
                    }
                    el.props = {
                        ...(el.props ?? {}),
                        ...normalized,
                    };
                    onWidgetPatch(elementId, {});
                    scheduleElementFlush(elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getButtonProperties: (elementId: string) => {
                const cap = "widget.getButtonProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readButtonProperties(document, elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setButtonProperties: async (elementId: string, patch: Partial<BlueprintButtonProperties>) => {
                const cap = "widget.setButtonProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const el = assertButtonElement(document, elementId);
                    const current = readButtonProperties(document, elementId);
                    const nextLabel = normalizeString(patch.label, current.label);
                    if (nextLabel === current.label) {
                        return;
                    }
                    el.props = { ...(el.props ?? {}), label: nextLabel };
                    onWidgetPatch(elementId, {});
                    scheduleElementFlush(elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getContainerProperties: (elementId: string) => {
                const cap = "widget.getContainerProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readContainerProperties(document, elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setContainerProperties: async (elementId: string, patch: Partial<BlueprintContainerProperties>) => {
                const cap = "widget.setContainerProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const el = assertContainerElement(document, elementId);
                    const current = readContainerProperties(document, elementId);
                    const clipContent = patch.clipContent === undefined ? current.clipContent : patch.clipContent === true;
                    if (clipContent === current.clipContent) {
                        return;
                    }
                    el.props = { ...(el.props ?? {}), clipContent };
                    onWidgetPatch(elementId, {});
                    scheduleElementFlush(elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getImageProperties: (elementId: string) => {
                const cap = "widget.getImageProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readImageProperties(document, elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setImageProperties: async (elementId: string, patch: Partial<BlueprintImageProperties>) => {
                const cap = "widget.setImageProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const el = assertImageElement(document, elementId);
                    const current = readImageProperties(document, elementId);
                    const hasAssetPatch = Object.prototype.hasOwnProperty.call(patch, "asset");
                    const assetId = hasAssetPatch
                        ? normalizeBlueprintImageAssetValue(patch.asset)?.assetId ?? null
                        : patch.assetId === undefined
                          ? current.assetId
                          : normalizeNullableString(patch.assetId);
                    if (assetId === current.assetId) {
                        return;
                    }
                    const previousFill = getImageWidgetRectangleProps(el).imageFill;
                    const nextFill: ImageFill = {
                        ...previousFill,
                        mode: previousFill?.mode ?? "cover",
                        assetId,
                    };
                    el.props = buildImageFillPropsUpdate(el, nextFill);
                    onWidgetPatch(elementId, {});
                    scheduleElementFlush(elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getSliderProperties: (elementId: string) => {
                const cap = "widget.getSliderProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readSliderProperties(
                        document,
                        widgetRuntimeStore,
                        runtimeScopeId,
                        activeSurfaceId,
                        elementId,
                    );
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setSliderProperties: async (elementId: string, patch: BlueprintSliderPropertiesPatch) => {
                const cap = "widget.setSliderProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const before = readSliderProperties(
                        document,
                        widgetRuntimeStore,
                        runtimeScopeId,
                        activeSurfaceId,
                        elementId,
                    );
                    const authored = readAuthoredSliderProperties(document, elementId);
                    const after = widgetRuntimeStore.setSliderProperties(
                        scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                        authored,
                        patch,
                    );
                    if (!sliderPropertiesEqual(before, after)) {
                        scheduleElementFlush(elementId);
                    }
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getListProperties: (elementId: string) => {
                const cap = "widget.getListProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readListProperties(
                        document,
                        scope,
                        widgetRuntimeStore,
                        runtimeScopeId,
                        activeSurfaceId,
                        stateScopeId,
                        elementId,
                    );
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setListItems: async (elementId: string, items: readonly unknown[]) => {
                const cap = "widget.setListItems";
                emitHostCall(emit, cap, "call");
                try {
                    assertListElement(document, elementId);
                    widgetRuntimeStore.setListItems(
                        scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                        items,
                    );
                    scheduleElementFlush(elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setListSelectedIndex: async (elementId: string, index: number) => {
                const cap = "widget.setListSelectedIndex";
                emitHostCall(emit, cap, "call");
                try {
                    assertListElement(document, elementId);
                    const before = readListProperties(
                        document,
                        scope,
                        widgetRuntimeStore,
                        runtimeScopeId,
                        activeSurfaceId,
                        stateScopeId,
                        elementId,
                    ).selectedIndex;
                    const next = Math.trunc(index);
                    widgetRuntimeStore.setListSelectedIndex(
                        scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                        next,
                    );
                    if (before !== next) {
                        scheduleElementFlush(elementId);
                    }
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            scrollListToIndex: async (elementId: string, index: number) => {
                const cap = "widget.scrollListToIndex";
                emitHostCall(emit, cap, "call");
                try {
                    assertListElement(document, elementId);
                    widgetRuntimeStore.requestListScroll(
                        scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                        { kind: "index", index: Math.max(0, Math.trunc(index)) },
                    );
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            scrollListToTop: async (elementId: string) => {
                const cap = "widget.scrollListToTop";
                emitHostCall(emit, cap, "call");
                try {
                    assertListElement(document, elementId);
                    widgetRuntimeStore.requestListScroll(
                        scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                        { kind: "top" },
                    );
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            scrollListToBottom: async (elementId: string) => {
                const cap = "widget.scrollListToBottom";
                emitHostCall(emit, cap, "call");
                try {
                    assertListElement(document, elementId);
                    widgetRuntimeStore.requestListScroll(
                        scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId),
                        { kind: "bottom" },
                    );
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getDisplayableProperties: (elementId: string) => {
                const cap = "widget.getDisplayableProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const props = readDisplayableProperties(document, elementId);
                    const patch = runtimePatches.get(elementId);
                    return {
                        ...props,
                        visible: patch?.visible ?? props.visible,
                    };
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getFrameProperties: (elementId: string) => {
                const cap = "widget.getFrameProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readFrameProperties(document, elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setFrameProperties: async (elementId: string, patch: Partial<BlueprintFrameProperties>) => {
                const cap = "widget.setFrameProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const el = assertFrameElement(document, elementId);
                    const current = readFrameProperties(document, elementId);
                    const targetSurfaceId = patch.targetSurfaceId === undefined
                        ? current.targetSurfaceId
                        : normalizeNullableString(patch.targetSurfaceId);
                    const params = patch.params === undefined ? current.params : normalizeRecord(patch.params);
                    if (targetSurfaceId === current.targetSurfaceId && jsonEquals(params, current.params)) {
                        return;
                    }
                    el.props = {
                        ...(el.props ?? {}),
                        targetSurfaceId,
                        params,
                    };
                    onWidgetPatch(elementId, {});
                    scheduleElementFlush(elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
        },
        state: {
            get: (scopeKind: string, key: string) => {
                emit({ type: "state.read", scope: scopeKind, key });
                if (scopeKind === "surface") {
                    return scope.getSurfaceStore(stateScopeId).get(key);
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
                    scope.getSurfaceStore(stateScopeId).set(key, value);
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
                try {
                    return await scope.persistenceGetAsync(key);
                } finally {
                    emitHostCall(emit, "persistence.get", "return");
                }
            },
            set: async (key: string, value: unknown) => {
                emitHostCall(emit, "persistence.set", "call");
                try {
                    await scope.persistenceSetAsync(key, value);
                    emit({ type: "state.write", scope: "persistence", key });
                } finally {
                    emitHostCall(emit, "persistence.set", "return");
                }
            },
        },
        frame: {
            getParam: (key: string) => {
                emitHostCall(emit, "frame.getParam", "call");
                const value = frameParams?.[key];
                emitHostCall(emit, "frame.getParam", "return");
                return value;
            },
            emit: async (eventName: string, data: unknown) => {
                const cap = "frame.emit";
                emitHostCall(emit, cap, "call");
                const safeEventName = String(eventName ?? "").trim();
                if (safeEventName && onFrameEmit) {
                    await onFrameEmit(safeEventName, data);
                }
                emitHostCall(emit, cap, "return");
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
