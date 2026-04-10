import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { ScopeStoreBridge } from "./ScopeStoreBridge";
import { isAppearanceCapableElementType } from "./appearanceCapableWidgets";

export type DevModeWidgetRuntimePatch = {
    visible?: boolean;
    enabled?: boolean;
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
                emitHostCall(emit, "devtools.log", "call");
                const line = `[Blueprint devtools.${level}] ${message}`;
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
