import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import {
    normalizeBlueprintImageAssetValue,
    toBlueprintImageAsset,
    type BlueprintElementRef,
    type BlueprintImageAsset,
} from "@shared/types/blueprint/valueTypes";
import { truncateDebugEventMessage } from "./DebugBridge";
import {
    BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY,
    BLUEPRINT_GAME_NAMETAG_STATE_KEY,
    BLUEPRINT_GAME_NOTIFICATIONS_STATE_KEY,
    BLUEPRINT_GAME_NVL_MODE_STATE_KEY,
} from "@shared/types/blueprint/hostApi";
import { LOCALE_STORAGE_KEY, type GameLocalizationBundle } from "@shared/types/localization";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { isListLikeWidgetType } from "@shared/types/ui-editor/list";
import { normalizeElementEffectValues, type ElementEffectValues } from "@shared/types/ui-editor/effects";
import type {
    UIDisplayableMotionOverride,
    UIDisplayableMotionTarget,
    UIDisplayableMotionTransition,
    WidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { ScopeStoreBridge } from "./ScopeStoreBridge";
import { isAppearanceCapableElementType } from "./appearanceCapableWidgets";
import { finalDisplayableMotionValue } from "@/lib/ui-editor/runtime/displayableMotion";
import { getElementSurfaceTopLeftEx } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { getTextProps } from "@/lib/ui-editor/widget-modules/builtin/text/helpers";
import { getSliderProps } from "@/lib/ui-editor/widget-modules/builtin/slider/helpers";
import { getListProps } from "@/lib/ui-editor/widget-modules/builtin/list/helpers";
import { getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import { getContainerProps } from "@/lib/ui-editor/widget-modules/builtin/container/helpers";
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { getFrameProps } from "@/lib/ui-editor/widget-modules/builtin/frame/helpers";
import { buildImageFillPropsUpdate } from "@/lib/ui-editor/widget-modules/shared/chrome/imageFillProps";
import type { ImageFill, ImageFillCropPlacement, ImageFillMode } from "@shared/types/ui-editor/imageFill";
import { DEFAULT_RECTANGLE_CROP_PLACEMENT } from "@shared/types/ui-editor/rectangleLike";
import type {
    TextAlign,
    TextVerticalAlign,
    TextWidgetProps,
    TextWrapMode,
} from "@/lib/ui-editor/widget-modules/builtin/text/types";
import type { UISliderRuntimeValue, UISliderWidgetProps } from "@shared/types/ui-editor/slider";
import { resolveSliderRuntimeValue } from "@shared/types/ui-editor/slider";
import type { DevModeStartStoryRequest } from "@shared/types/devMode";
import {
    isButtonCursorValue,
    type AppearanceFieldTransition,
    type AppearanceModel,
    type AppearancePropertyGroup,
    type AppearanceVariant,
    type ButtonCursorValue,
} from "@shared/types/ui-editor/appearance";
import {
    DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    type SystemInteractionSignals,
} from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import {
    resolveAppearanceDisplayableOpacity,
    resolveImageDisplayableOpacityKeys,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    createInitialButtonAppearance,
    ensureButtonAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";

export type DevModeWidgetRuntimePatch = {
    display?: boolean;
    visible?: boolean;
    enabled?: boolean;
    frame?: {
        targetSurfaceId?: string | null;
        params?: Record<string, unknown>;
    };
    layout?: Partial<Pick<BlueprintDisplayableProperties["bounds"], "x" | "y" | "width" | "height">> &
        Partial<Pick<BlueprintDisplayableProperties, "rotation" | "opacity">>;
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
    offset: { x: number; y: number };
    size: { width: number; height: number };
    bounds: { x: number; y: number; width: number; height: number };
    rotation: number;
    opacity: number;
    display: boolean;
    visible: boolean;
};

export type BlueprintDisplayablePropertiesPatch = Partial<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    display: boolean;
    visible: boolean;
}>;

export type BlueprintDisplayableMotionRequest = {
    id?: string;
    target: UIDisplayableMotionTarget;
    transition: UIDisplayableMotionTransition;
    resetOnComplete?: boolean;
    commitLayoutOnComplete?: Partial<Pick<BlueprintDisplayablePropertiesPatch, "x" | "y">>;
};

export type BlueprintWidgetCommonProperties = {
    visible: boolean;
    enabled: boolean;
    variantId: string | null;
};

export type BlueprintButtonProperties = {
    label: string;
    cursor: ButtonCursorValue;
};

export type BlueprintContainerProperties = {
    clipContent: boolean;
};

export type BlueprintImageProperties = {
    asset: BlueprintImageAsset | null;
    /** Legacy patch/read alias kept so older saved graph nodes can still run. */
    assetId: string | null;
    fitMode: ImageFillMode;
    cropRect: ImageFillCropPlacement;
    flipX: boolean;
    flipY: boolean;
};

export type BlueprintFrameProperties = {
    targetSurfaceId: string | null;
    params: Record<string, unknown>;
};

export type BlueprintGamePreferenceKey =
    | "autoForward"
    | "skip"
    | "showDialog"
    | "gameSpeed"
    | "cps"
    | "voiceVolume"
    | "voiceFadeDuration"
    | "voiceEndMode"
    | "bgmVolume"
    | "soundVolume"
    | "globalVolume"
    | "skipDelay"
    | "skipInterval";

export type BlueprintGamePreferenceVoiceEndMode = "fade" | "stop" | "none";

export type BlueprintGamePreferenceValue = boolean | number | BlueprintGamePreferenceVoiceEndMode;

export type BlueprintHostApiRuntime = {
    navigation: {
        openSurface: (surfaceId: string, props?: unknown) => Promise<void>;
        getPageProps: () => Record<string, unknown>;
        closeLayer: () => Promise<void>;
        quitApplication: () => Promise<void>;
    };
    widget: {
        setVisible: (elementId: string, visible: boolean) => Promise<void>;
        setEnabled: (elementId: string, enabled: boolean) => Promise<void>;
        /** `null` clears runtime override and restores authored default variant resolution. */
        setVariant: (elementId: string, variantId: string | null, options?: { waitForTransition?: boolean }) => Promise<void>;
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
        setDisplayableProperties: (elementId: string, patch: BlueprintDisplayablePropertiesPatch) => Promise<void>;
        animateDisplayable: (elementId: string, request: BlueprintDisplayableMotionRequest) => Promise<UIDisplayableMotionOverride>;
        stopDisplayableAnimation: (animationId: string) => Promise<void>;
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
    localization: {
        /** Localization setup of the running game, or null when the project has none. */
        getConfig: () => GameLocalizationConfigSnapshot | null;
        /** Effective current locale (stored player choice, else the source locale). */
        getLocale: () => Promise<string>;
        /** Persist the player's language choice; callers validate against getConfig(). */
        setLocale: (code: string) => Promise<void>;
    };
    frame: {
        getParam: (key: string) => unknown;
        emit: (eventName: string, data: unknown) => Promise<void>;
    };
    game: {
        startStory: (request: DevModeStartStoryRequest) => Promise<void>;
        isInGame: () => boolean;
        isGameOverlay: () => boolean;
        quit: (surfaceId: string) => Promise<void>;
        writeSave: (id: string, metadata?: unknown, screenshot?: boolean) => Promise<void>;
        loadSave: (id: string) => Promise<void>;
        deleteSave: (id: string) => Promise<void>;
        listSaveIds: () => Promise<string[]>;
        getSaveMetadata: (id: string) => Promise<unknown>;
        getSavePreview: (id: string) => Promise<BlueprintImageAsset | null>;
        getHistory: () => Promise<BlueprintGameHistoryEntry[]>;
        /** Jump back to a history entry by id; omit the id to undo the last entry. */
        restoreHistory: (id?: string) => Promise<void>;
        getNametag: () => string | null;
        getNotifications: () => BlueprintGameNotification[];
        getChoiceCount: () => number;
        isNvlMode: () => boolean;
        choose: (index: number) => Promise<void>;
        next: () => Promise<void>;
        skip: () => Promise<void>;
        showDialog: () => Promise<void>;
        hideDialog: () => Promise<void>;
        toggleDialogDisplay: () => Promise<void>;
        setSentenceSpeed: (cps: number) => Promise<void>;
        getPreference: (key: BlueprintGamePreferenceKey) => BlueprintGamePreferenceValue;
        setPreference: (key: BlueprintGamePreferenceKey, value: BlueprintGamePreferenceValue) => Promise<void>;
        /**
         * Set the runtime output (render) resolution — the fixed pixel size the stage rasterizes at
         * before being upscaled to fill the window. `width:height` must match the design aspect
         * ratio; a mismatch is reported as a diagnostic and ignored (never applied silently).
         */
        setOutputResolution: (width: number, height: number) => Promise<void>;
    };
    devtools: {
        log: (level: string, message: string) => void;
    };
};

/**
 * Localization payload of the running game as exposed to blueprint nodes.
 * Hosts pass the full bundle (locales + translation tables + named keys) so
 * text-resolution nodes (Get Text / Has Text) can look translations up; a
 * bare config (no tables) still satisfies the language-management nodes.
 */
export type GameLocalizationConfigSnapshot = Pick<GameLocalizationBundle, "sourceLocale" | "locales">
    & Partial<Pick<GameLocalizationBundle, "tables" | "keys">>;

export type CreateBlueprintHostApiRuntimeOptions = {
    document: UIDocument;
    scope: ScopeStoreBridge;
    activeSurfaceId: string;
    runtimeScopeId?: string;
    pageProps?: Record<string, unknown>;
    frameParams?: Record<string, unknown>;
    onFrameEmit?: (eventName: string, data: unknown) => Promise<void> | void;
    onStartStory?: (request: DevModeStartStoryRequest) => Promise<void> | void;
    onIsInGame?: () => boolean;
    onIsGameOverlay?: () => boolean;
    onQuitGame?: (surfaceId: string) => Promise<void> | void;
    onWriteSave?: (id: string, metadata: unknown, screenshot?: boolean) => Promise<void> | void;
    onLoadSave?: (id: string) => Promise<void> | void;
    onDeleteSave?: (id: string) => Promise<void> | void;
    onListSaveIds?: () => Promise<string[]> | string[];
    onGetSaveMetadata?: (id: string) => Promise<unknown> | unknown;
    onGetSavePreview?: (id: string) => Promise<BlueprintImageAsset | null> | BlueprintImageAsset | null;
    onGetHistory?: () => Promise<BlueprintGameHistoryEntry[]> | BlueprintGameHistoryEntry[];
    onRestoreHistory?: (id?: string) => Promise<void> | void;
    onGetNametag?: () => string | null;
    onGetNotifications?: () => BlueprintGameNotification[];
    onGetChoiceCount?: () => number;
    onIsNvlMode?: () => boolean;
    onSelectChoice?: (index: number) => Promise<void> | void;
    onNext?: () => Promise<void> | void;
    onSkip?: () => Promise<void> | void;
    onShowDialog?: () => Promise<void> | void;
    onHideDialog?: () => Promise<void> | void;
    onToggleDialogDisplay?: () => Promise<void> | void;
    onSetSentenceSpeed?: (cps: number) => Promise<void> | void;
    onGetGamePreference?: (key: BlueprintGamePreferenceKey) => BlueprintGamePreferenceValue;
    onSetGamePreference?: (key: BlueprintGamePreferenceKey, value: BlueprintGamePreferenceValue) => Promise<void> | void;
    onSetOutputResolution?: (width: number, height: number) => Promise<void> | void;
    emit: (event: BlueprintDebugEvent) => void;
    onOpenSurface: (surfaceId: string, props?: Record<string, unknown>) => void | Promise<void>;
    onCloseLayer: () => void | Promise<void>;
    onQuitApplication?: () => void | Promise<void>;
    onWidgetPatch: (elementId: string, patch: DevModeWidgetRuntimePatch) => void;
    onElementFlush?: (elementId: string, payload: BlueprintElementFlushPayload) => Promise<void> | void;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    /** Component definition graphs should pass a component-scoped document so Element Host API stays local. */
    componentDefinitionMode?: boolean;
    /** Game localization setup (from the bundle); absent when the project has none. */
    localizationConfig?: GameLocalizationConfigSnapshot | null;
};

function readDocumentElement(document: UIDocument, elementId: string): UIElement | undefined {
    const element = document.elements[elementId];
    if (element) {
        return element;
    }
    for (const component of document.components ?? []) {
        const componentElement = component.elements[elementId];
        if (componentElement) {
            return componentElement;
        }
    }
    return undefined;
}

function requireDocumentElement(document: UIDocument, elementId: string, label: string): UIElement {
    const element = readDocumentElement(document, elementId);
    if (!element) {
        throw new Error(`${label}: element not found: ${elementId}`);
    }
    return element;
}

function readPatchedDocumentElement(
    document: UIDocument,
    runtimePatches: ReadonlyMap<string, DevModeWidgetRuntimePatch> | undefined,
    elementId: string,
): UIElement | undefined {
    const element = readDocumentElement(document, elementId);
    const layoutPatch = runtimePatches?.get(elementId)?.layout;
    if (!element || !layoutPatch) {
        return element;
    }
    return {
        ...element,
        layout: {
            ...element.layout,
            ...layoutPatch,
        },
    };
}

function readPatchedElementLayout(
    document: UIDocument,
    runtimePatches: ReadonlyMap<string, DevModeWidgetRuntimePatch> | undefined,
    elementId: string,
): UIElement["layout"] {
    const element = requireDocumentElement(document, elementId, "displayable");
    return {
        ...element.layout,
        ...(runtimePatches?.get(elementId)?.layout ?? {}),
    };
}

function readDisplayableSurfaceTopLeft(
    document: UIDocument,
    runtimePatches: ReadonlyMap<string, DevModeWidgetRuntimePatch> | undefined,
    elementId: string,
): { x: number; y: number } {
    requireDocumentElement(document, elementId, "displayable");
    return getElementSurfaceTopLeftEx(id => readPatchedDocumentElement(document, runtimePatches, id), elementId);
}

function readDisplayableParentSurfaceTopLeft(
    document: UIDocument,
    runtimePatches: ReadonlyMap<string, DevModeWidgetRuntimePatch> | undefined,
    elementId: string,
): { x: number; y: number } {
    const element = requireDocumentElement(document, elementId, "displayable");
    if (!element.parentId) {
        return { x: 0, y: 0 };
    }
    return getElementSurfaceTopLeftEx(id => readPatchedDocumentElement(document, runtimePatches, id), element.parentId);
}

function assertAppearanceVariantId(document: UIDocument, elementId: string, variantId: string | null): void {
    const el = requireDocumentElement(document, elementId, "setVariant");
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

function readAppearanceModel(document: UIDocument, elementId: string): AppearanceModel | null {
    const raw = (readDocumentElement(document, elementId)?.props as Record<string, unknown> | undefined)?.appearance;
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const model = raw as AppearanceModel;
    return Array.isArray(model.variants) ? model : null;
}

function resolveVariantForSetVariant(model: AppearanceModel | null, variantId: string | null): AppearanceVariant | null {
    if (!model || model.variants.length === 0) {
        return null;
    }
    if (variantId) {
        return model.variants.find(variant => variant.id === variantId) ?? null;
    }
    return model.variants.find(variant => variant.id === model.defaultVariantId) ?? model.variants[0] ?? null;
}

function transitionWaitMs(transition: AppearanceFieldTransition | null | undefined): number {
    if (!transition) {
        return 0;
    }
    const delay = Math.max(0, transition.delayMs ?? 0);
    if (transition.type === "tween") {
        return delay + Math.max(0, transition.durationMs);
    }
    return delay + 300;
}

function displayableMotionWaitMs(transition: UIDisplayableMotionTransition | null | undefined): number {
    if (!transition) {
        return 0;
    }
    const delay = Math.max(0, transition.delayMs ?? 0);
    if (transition.type === "tween") {
        return delay + Math.max(0, transition.durationMs);
    }
    return delay + 300;
}

function hasExplicitDisplayableMotionKeyframes(target: UIDisplayableMotionTarget): boolean {
    return Object.values(target).some(value => Array.isArray(value));
}

function waitForDisplayableMotionStartFrame(): Promise<void> {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve());
        });
    });
}

function variantWaitMs(variant: AppearanceVariant | null): number {
    if (!variant) {
        return 0;
    }
    return Math.max(0, ...variant.propertyGroups.map(group => transitionWaitMs(group.transition)));
}

function variantTransitionForKey(variant: AppearanceVariant | null, key: string): AppearanceFieldTransition | null {
    return variant?.propertyGroups.find(group => group.key === key)?.transition ?? null;
}

function toDisplayableTransition(transition: AppearanceFieldTransition): UIDisplayableMotionTransition {
    return transition.type === "spring"
        ? {
              type: "spring",
              delayMs: transition.delayMs,
              stiffness: transition.stiffness,
              damping: transition.damping,
              mass: transition.mass,
          }
        : {
              type: "tween",
              durationMs: transition.durationMs,
              delayMs: transition.delayMs,
              easing: transition.easing,
          };
}

function sleepMs(durationMs: number): Promise<void> {
    const waitMs = Math.max(0, durationMs);
    return waitMs > 0 ? new Promise(resolve => setTimeout(resolve, waitMs)) : Promise.resolve();
}

function assertTextElement(document: UIDocument, elementId: string) {
    const el = requireDocumentElement(document, elementId, "text");
    if (el.type !== "nl.text") {
        throw new Error(`text: element is not a Text widget: ${el.type}`);
    }
    return el;
}

function assertSliderElement(document: UIDocument, elementId: string) {
    const el = requireDocumentElement(document, elementId, "slider");
    if (el.type !== "nl.slider") {
        throw new Error(`slider: element is not a Slider widget: ${el.type}`);
    }
    return el;
}

function assertListElement(document: UIDocument, elementId: string) {
    const el = requireDocumentElement(document, elementId, "list");
    if (!isListLikeWidgetType(el.type)) {
        throw new Error(`list: element is not a List widget: ${el.type}`);
    }
    return el;
}

function assertButtonElement(document: UIDocument, elementId: string) {
    const el = requireDocumentElement(document, elementId, "button");
    if (el.type !== "nl.button") {
        throw new Error(`button: element is not a Button widget: ${el.type}`);
    }
    return el;
}

function assertContainerElement(document: UIDocument, elementId: string) {
    const el = requireDocumentElement(document, elementId, "container");
    if (el.type !== "nl.container") {
        throw new Error(`container: element is not a Container widget: ${el.type}`);
    }
    return el;
}

function assertImageElement(document: UIDocument, elementId: string) {
    const el = requireDocumentElement(document, elementId, "image");
    if (el.type !== "nl.image") {
        throw new Error(`image: element is not an Image widget: ${el.type}`);
    }
    return el;
}

function assertFrameElement(document: UIDocument, elementId: string) {
    const el = requireDocumentElement(document, elementId, "frame");
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
    const selectedIndex = widgetRuntimeStore.getListSelectedIndex(scopedKey) ??
        getListProps(requireDocumentElement(document, elementId, "list")).selectedIndex;
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

function readDisplayableProperties(
    document: UIDocument,
    elementId: string,
    runtimePatches?: ReadonlyMap<string, DevModeWidgetRuntimePatch>,
): BlueprintDisplayableProperties {
    const layout = readPatchedElementLayout(document, runtimePatches, elementId);
    const patch = runtimePatches?.get(elementId);
    const position = readDisplayableSurfaceTopLeft(document, runtimePatches, elementId);
    return {
        position,
        offset: { x: 0, y: 0 },
        size: { width: layout.width, height: layout.height },
        bounds: { x: position.x, y: position.y, width: layout.width, height: layout.height },
        rotation: layout.rotation ?? 0,
        opacity: layout.opacity ?? 1,
        display: patch?.display ?? true,
        visible: patch?.visible ?? layout.visible !== false,
    };
}

function hasRuntimeOpacityPatch(patch: DevModeWidgetRuntimePatch | undefined): boolean {
    return Boolean(patch?.layout && Object.prototype.hasOwnProperty.call(patch.layout, "opacity"));
}

function normalizeDisplayableOpacity(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function displayableOpacityKeysForElement(
    document: UIDocument,
    elementId: string,
    variantId: string | null,
    signals: SystemInteractionSignals,
): readonly string[] {
    const element = readDocumentElement(document, elementId);
    if (element?.type !== "nl.image") {
        return ["transformOpacity"];
    }
    return resolveImageDisplayableOpacityKeys(element, readAppearanceModel(document, elementId), {
        variantOverrideId: variantId,
        signals,
    });
}

function readAppearanceOpacity(
    document: UIDocument,
    widgetRuntimeStore: WidgetRuntimeStateStore,
    scopedKey: string,
    elementId: string,
    variantId?: string | null,
): number | null {
    const appearance = readAppearanceModel(document, elementId);
    const activeVariantId =
        variantId === undefined ? widgetRuntimeStore.getVariantOverride(scopedKey) ?? null : variantId;
    const signals = widgetRuntimeStore.getSignalsForElement(scopedKey, false) ?? DEFAULT_SYSTEM_INTERACTION_SIGNALS;
    return resolveAppearanceDisplayableOpacity(appearance, {
        variantOverrideId: activeVariantId,
        signals,
        displayableOpacityKeys: displayableOpacityKeysForElement(document, elementId, activeVariantId, signals),
    });
}

function variantDisplayableOpacityTransition(
    document: UIDocument,
    elementId: string,
    variant: AppearanceVariant | null,
): AppearanceFieldTransition | null {
    for (const key of displayableOpacityKeysForElement(
        document,
        elementId,
        variant?.id ?? null,
        DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    )) {
        const transition = variantTransitionForKey(variant, key);
        if (transition) {
            return transition;
        }
    }
    return null;
}

function readEffectiveDisplayableProperties(
    document: UIDocument,
    widgetRuntimeStore: WidgetRuntimeStateStore,
    runtimePatches: Map<string, DevModeWidgetRuntimePatch>,
    runtimeScopeId: string | undefined,
    activeSurfaceId: string,
    elementId: string,
): BlueprintDisplayableProperties {
    const patch = runtimePatches.get(elementId);
    const merged = readDisplayableProperties(document, elementId, runtimePatches);
    const scopedKey = scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId);
    const motion = widgetRuntimeStore.getDisplayableMotion(scopedKey);
    merged.offset = {
        x: finalDisplayableMotionValue(motion?.target.x) ?? 0,
        y: finalDisplayableMotionValue(motion?.target.y) ?? 0,
    };
    if (!hasRuntimeOpacityPatch(patch)) {
        const appearanceOpacity = readAppearanceOpacity(document, widgetRuntimeStore, scopedKey, elementId);
        if (appearanceOpacity !== null) {
            merged.opacity = appearanceOpacity;
        }
    }
    return merged;
}

function readVariantId(document: UIDocument, widgetRuntimeStore: WidgetRuntimeStateStore, scopedKey: string, elementId: string): string | null {
    const override = widgetRuntimeStore.getVariantOverride(scopedKey);
    if (override) {
        return override;
    }
    const el = readDocumentElement(document, elementId);
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
    const el = requireDocumentElement(document, elementId, "widget");
    const patch = runtimePatches.get(elementId);
    const props = (el.props ?? {}) as Record<string, unknown>;
    return {
        visible: patch?.visible ?? el.layout.visible !== false,
        enabled: patch?.enabled ?? !Boolean(props.interactionDisabled),
        variantId: readVariantId(document, widgetRuntimeStore, scopedKey, elementId),
    };
}

function readButtonDefaultCursor(appearance: AppearanceModel | null | undefined, fallback: ButtonCursorValue): ButtonCursorValue {
    if (!isUsableAppearanceModel(appearance)) {
        return fallback;
    }
    const variant =
        appearance.variants.find(v => v.id === appearance.defaultVariantId) ??
        appearance.variants[0];
    const value = variant?.propertyGroups.find(group => group.key === "cursor")?.rows[0]?.value;
    return isButtonCursorValue(value) ? value : fallback;
}

function patchButtonDefaultCursorAppearance(
    appearance: AppearanceModel | null | undefined,
    flat: ReturnType<typeof getButtonProps>,
    cursor: ButtonCursorValue,
): AppearanceModel {
    const model = isUsableAppearanceModel(appearance)
        ? ensureButtonAppearanceHasAllKeys(appearance, flat)
        : createInitialButtonAppearance({ ...flat, cursor });
    const defaultVariantId = model.variants.some(variant => variant.id === model.defaultVariantId)
        ? model.defaultVariantId
        : model.variants[0]?.id;
    if (!defaultVariantId) {
        return model;
    }

    let changed = model !== appearance;
    const variants = model.variants.map(variant => {
        if (variant.id !== defaultVariantId) {
            return variant;
        }
        let foundCursorGroup = false;
        const propertyGroups = variant.propertyGroups.map(group => {
            if (group.key !== "cursor") {
                return group;
            }
            foundCursorGroup = true;
            const firstRow = group.rows[0] ?? { conditions: null, value: cursor };
            if (group.rows[0] && firstRow.value === cursor) {
                return group;
            }
            changed = true;
            return {
                ...group,
                rows: [{ ...firstRow, value: cursor }, ...group.rows.slice(1)],
            };
        });
        if (foundCursorGroup) {
            return { ...variant, propertyGroups };
        }
        changed = true;
        const cursorGroup: AppearancePropertyGroup = {
            key: "cursor",
            rows: [{ conditions: null, value: cursor }],
        };
        return { ...variant, propertyGroups: [...propertyGroups, cursorGroup] };
    });
    return changed ? { ...model, variants } : model;
}

function readButtonProperties(document: UIDocument, elementId: string): BlueprintButtonProperties {
    const p = getButtonProps(assertButtonElement(document, elementId));
    const fallbackCursor = isButtonCursorValue(p.cursor) ? p.cursor : "auto";
    return {
        label: p.label,
        cursor: readButtonDefaultCursor(p.appearance, fallbackCursor),
    };
}

function readContainerProperties(document: UIDocument, elementId: string): BlueprintContainerProperties {
    return { clipContent: getContainerProps(assertContainerElement(document, elementId)).clipContent };
}

function readImageProperties(document: UIDocument, elementId: string): BlueprintImageProperties {
    const p = getImageWidgetRectangleProps(assertImageElement(document, elementId));
    const fill = p.imageFill ?? null;
    const assetId = fill?.assetId?.trim() || null;
    return {
        asset: toBlueprintImageAsset(assetId),
        assetId,
        fitMode: fill?.mode ?? "cover",
        cropRect: fill?.cropPlacement ?? { ...DEFAULT_RECTANGLE_CROP_PLACEMENT },
        flipX: p.imageFlipX === true,
        flipY: p.imageFlipY === true,
    };
}

function readFrameProperties(document: UIDocument, elementId: string): BlueprintFrameProperties {
    const p = getFrameProps(assertFrameElement(document, elementId));
    return {
        targetSurfaceId: p.targetSurfaceId,
        params: cloneJson(p.params ?? {}),
    };
}

function readEffectiveFrameProperties(
    document: UIDocument,
    runtimePatches: Map<string, DevModeWidgetRuntimePatch>,
    elementId: string,
): BlueprintFrameProperties {
    const current = readFrameProperties(document, elementId);
    const patch = runtimePatches.get(elementId)?.frame;
    return {
        targetSurfaceId: patch && Object.prototype.hasOwnProperty.call(patch, "targetSurfaceId")
            ? patch.targetSurfaceId ?? null
            : current.targetSurfaceId,
        params: cloneJson(patch?.params ?? current.params),
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

function toBlueprintVisibleValue(value: unknown): unknown {
    return value === undefined ? null : value;
}

function normalizeBlueprintNametag(value: unknown): string | null {
    if (value == null) {
        return null;
    }
    const text = String(value);
    return text.trim().length > 0 ? text : null;
}

/** One NarraLeaf notification mirrored into the blueprint runtime. */
export type BlueprintGameNotification = {
    id: string;
    message: string;
};

function normalizeBlueprintGameNotifications(value: unknown): BlueprintGameNotification[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: BlueprintGameNotification[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const record = item as Record<string, unknown>;
        out.push({
            id: String(record.id ?? ""),
            message: String(record.message ?? ""),
        });
    }
    return out;
}

/**
 * One dialogue/menu backlog entry mirrored from NarraLeaf's `LiveGame.getHistory()`.
 * Flattened so a backlog List widget can bind each field directly, and `id` can be fed
 * back into the Restore From History node (NLR `LiveGame.undo(id)`).
 */
export type BlueprintGameHistoryEntry = {
    /** History token; pass to Restore From History to jump the game back to this point. */
    id: string;
    /** "say" for spoken lines, "menu" for a resolved choice. */
    type: "say" | "menu";
    /** Sentence text (say) or the menu prompt (menu); empty string when the source had none. */
    text: string;
    /** Speaker nametag for a say entry; null for menu entries or narration. */
    character: string | null;
    /** Voice clip id for a say entry; null when absent. */
    voice: string | null;
    /** Chosen option text for a menu entry; null for say entries or an unresolved menu. */
    selected: string | null;
    /** True while the entry is the line currently being shown (not yet committed). */
    isPending: boolean;
};

function normalizeNullableHistoryString(raw: unknown): string | null {
    if (raw == null) {
        return null;
    }
    const text = String(raw);
    return text.length > 0 ? text : null;
}

function normalizeBlueprintGameHistory(value: unknown): BlueprintGameHistoryEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: BlueprintGameHistoryEntry[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const record = item as Record<string, unknown>;
        out.push({
            id: String(record.id ?? ""),
            type: record.type === "menu" ? "menu" : "say",
            text: record.text == null ? "" : String(record.text),
            character: normalizeNullableHistoryString(record.character),
            voice: normalizeNullableHistoryString(record.voice),
            selected: normalizeNullableHistoryString(record.selected),
            isPending: record.isPending === true,
        });
    }
    return out;
}

function normalizeBlueprintChoiceCount(value: unknown): number {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 ? count : 0;
}

function normalizeNullableString(raw: unknown): string | null {
    if (raw === null) {
        return null;
    }
    const s = String(raw ?? "").trim();
    return s.length > 0 ? s : null;
}

const IMAGE_FILL_MODES: readonly ImageFillMode[] = ["cover", "contain", "stretch", "crop", "tile"];

function normalizeImageFillMode(raw: unknown, fallback: ImageFillMode): ImageFillMode {
    return IMAGE_FILL_MODES.includes(raw as ImageFillMode) ? raw as ImageFillMode : fallback;
}

function normalizeImageCropPlacement(
    raw: unknown,
    fallback: ImageFillCropPlacement,
): ImageFillCropPlacement {
    const obj = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Partial<Record<keyof ImageFillCropPlacement, unknown>>
        : {};
    return {
        leftPct: finiteNumber(obj.leftPct, fallback.leftPct),
        topPct: finiteNumber(obj.topPct, fallback.topPct),
        widthPct: finiteNumber(obj.widthPct, fallback.widthPct),
        heightPct: finiteNumber(obj.heightPct, fallback.heightPct),
    };
}

function imageCropPlacementEqual(a: ImageFillCropPlacement, b: ImageFillCropPlacement): boolean {
    return a.leftPct === b.leftPct &&
        a.topPct === b.topPct &&
        a.widthPct === b.widthPct &&
        a.heightPct === b.heightPct;
}

function normalizeRecord(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === "object" && !Array.isArray(raw)
        ? cloneJson(raw as Record<string, unknown>)
        : {};
}

function normalizeJsonValue(raw: unknown): unknown {
    if (raw === undefined) {
        return null;
    }
    try {
        const serialized = JSON.stringify(raw);
        return serialized === undefined ? null : JSON.parse(serialized);
    } catch {
        return null;
    }
}

function normalizeJsonRecord(raw: unknown): Record<string, unknown> {
    const value = normalizeJsonValue(raw);
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
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

function elementIdFromScopedWidgetRuntimeKey(scopedKey: string): string {
    const separatorIndex = scopedKey.indexOf("\0");
    return separatorIndex >= 0 ? scopedKey.slice(separatorIndex + 1) : scopedKey;
}

function normalizeGameSaveId(operation: string, id: string): string {
    const safe = String(id ?? "").trim();
    if (!safe) {
        throw new Error(`${operation}: save id is required`);
    }
    return safe;
}

function normalizeSentenceCps(cps: unknown): number {
    const value = typeof cps === "number" ? cps : Number(cps);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error("setSentenceSpeed: CPS must be a positive number");
    }
    return value;
}

const GAME_PREFERENCE_KEYS = new Set<BlueprintGamePreferenceKey>([
    "autoForward",
    "skip",
    "showDialog",
    "gameSpeed",
    "cps",
    "voiceVolume",
    "voiceFadeDuration",
    "voiceEndMode",
    "bgmVolume",
    "soundVolume",
    "globalVolume",
    "skipDelay",
    "skipInterval",
]);

function normalizeGamePreferenceKey(key: unknown): BlueprintGamePreferenceKey {
    const safeKey = String(key ?? "").trim() as BlueprintGamePreferenceKey;
    if (!GAME_PREFERENCE_KEYS.has(safeKey)) {
        throw new Error(`game preference key is not supported: ${String(key ?? "")}`);
    }
    return safeKey;
}

function normalizeGamePreferenceNumber(operation: string, key: BlueprintGamePreferenceKey, value: unknown): number {
    const safeValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(safeValue)) {
        throw new Error(`${operation}: ${key} must be a finite number`);
    }
    switch (key) {
        case "gameSpeed":
        case "cps":
        case "skipInterval":
            if (safeValue <= 0) {
                throw new Error(`${operation}: ${key} must be a positive number`);
            }
            break;
        case "voiceVolume":
        case "voiceFadeDuration":
        case "bgmVolume":
        case "soundVolume":
        case "globalVolume":
        case "skipDelay":
            if (safeValue < 0) {
                throw new Error(`${operation}: ${key} must be zero or greater`);
            }
            break;
        default:
            break;
    }
    return safeValue;
}

function normalizeGamePreferenceValue(
    operation: string,
    key: BlueprintGamePreferenceKey,
    value: unknown,
): BlueprintGamePreferenceValue {
    switch (key) {
        case "autoForward":
        case "skip":
        case "showDialog":
            if (typeof value !== "boolean") {
                throw new Error(`${operation}: ${key} must be a boolean`);
            }
            return value;
        case "voiceEndMode": {
            const mode = String(value ?? "").trim();
            if (mode !== "fade" && mode !== "stop" && mode !== "none") {
                throw new Error(`${operation}: voiceEndMode must be "fade", "stop", or "none"`);
            }
            return mode;
        }
        case "gameSpeed":
        case "cps":
        case "voiceVolume":
        case "voiceFadeDuration":
        case "bgmVolume":
        case "soundVolume":
        case "globalVolume":
        case "skipDelay":
        case "skipInterval":
            return normalizeGamePreferenceNumber(operation, key, value);
        default:
            throw new Error(`${operation}: ${key} is not supported`);
    }
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
        pageProps,
        frameParams,
        onFrameEmit,
        onStartStory,
        onIsInGame,
        onIsGameOverlay,
        onQuitGame,
        onWriteSave,
        onLoadSave,
        onDeleteSave,
        onListSaveIds,
        onGetSaveMetadata,
        onGetSavePreview,
        onGetHistory,
        onRestoreHistory,
        onGetNametag,
        onGetNotifications,
        onGetChoiceCount,
        onIsNvlMode,
        onSelectChoice,
        onNext,
        onSkip,
        onShowDialog,
        onHideDialog,
        onToggleDialogDisplay,
        onSetSentenceSpeed,
        onGetGamePreference,
        onSetGamePreference,
        onSetOutputResolution,
        emit,
        onOpenSurface,
        onCloseLayer,
        onQuitApplication,
        onWidgetPatch,
        onElementFlush,
        widgetRuntimeStore,
    } =
        options;
    const stateScopeId = runtimeScopeId ?? activeSurfaceId;
    const currentPageProps = normalizeJsonRecord(pageProps);
    const pendingFlushElementIds = new Set<string>();
    const runtimePatches = new Map<string, DevModeWidgetRuntimePatch>();
    type DisplayableAnimationWaitReason = "completed" | "stopped";

    const displayableAnimationWaiters = new Map<
        string,
        Set<(reason: DisplayableAnimationWaitReason) => void>
    >();
    let flushScheduled = false;

    const emitWidgetPatch = (
        elementId: string,
        patch: DevModeWidgetRuntimePatch,
        options?: { widgetStateChanged?: boolean },
    ) => {
        onWidgetPatch(elementId, patch);
        widgetRuntimeStore.notifyRuntimePatchesChanged(options);
    };

    const scheduleElementFlush = (elementId: string) => {
        if (!onElementFlush) {
            return;
        }
        const el = readDocumentElement(document, elementId);
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
                const target = readDocumentElement(document, id);
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

    const notifyDisplayableAnimationDone = (
        animationId: string,
        reason: DisplayableAnimationWaitReason = "stopped",
    ): void => {
        const waiters = displayableAnimationWaiters.get(animationId);
        if (!waiters || waiters.size === 0) {
            return;
        }
        displayableAnimationWaiters.delete(animationId);
        for (const resolve of Array.from(waiters)) {
            resolve(reason);
        }
    };

    const waitForDisplayableAnimation = async (
        animationId: string,
        waitMs: number,
    ): Promise<DisplayableAnimationWaitReason> => {
        if (waitMs <= 0) {
            return "completed";
        }
        return new Promise<DisplayableAnimationWaitReason>(resolve => {
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const finish = (reason: DisplayableAnimationWaitReason) => {
                if (timeoutId !== undefined) {
                    clearTimeout(timeoutId);
                }
                const waiters = displayableAnimationWaiters.get(animationId);
                waiters?.delete(finish);
                if (waiters?.size === 0) {
                    displayableAnimationWaiters.delete(animationId);
                }
                resolve(reason);
            };
            let waiters = displayableAnimationWaiters.get(animationId);
            if (!waiters) {
                waiters = new Set<(reason: DisplayableAnimationWaitReason) => void>();
                displayableAnimationWaiters.set(animationId, waiters);
            }
            waiters.add(finish);
            timeoutId = setTimeout(() => finish("completed"), waitMs);
        });
    };

    const createDisplayableLayoutPatch = (
        elementId: string,
        patch: BlueprintDisplayablePropertiesPatch,
    ): NonNullable<DevModeWidgetRuntimePatch["layout"]> => {
        const layoutPatch: NonNullable<DevModeWidgetRuntimePatch["layout"]> = {};
        const assignFinite = (value: unknown): number | undefined => {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                return undefined;
            }
            return value;
        };
        const x = assignFinite(patch.x);
        const y = assignFinite(patch.y);
        const width = assignFinite(patch.width);
        const height = assignFinite(patch.height);
        const rotation = assignFinite(patch.rotation);
        const opacity = assignFinite(patch.opacity);
        const currentLayout = readPatchedElementLayout(document, runtimePatches, elementId);
        const nextWidth = width ?? currentLayout.width;
        const nextHeight = height ?? currentLayout.height;
        const parentPosition =
            x !== undefined || y !== undefined
                ? readDisplayableParentSurfaceTopLeft(document, runtimePatches, elementId)
                : null;
        if (x !== undefined) {
            layoutPatch.x = x - (parentPosition?.x ?? 0) - Math.min(0, nextWidth);
        }
        if (y !== undefined) {
            layoutPatch.y = y - (parentPosition?.y ?? 0) - Math.min(0, nextHeight);
        }
        if (width !== undefined) {
            layoutPatch.width = width;
        }
        if (height !== undefined) {
            layoutPatch.height = height;
        }
        if (rotation !== undefined) {
            layoutPatch.rotation = rotation;
        }
        if (opacity !== undefined) {
            layoutPatch.opacity = opacity;
        }
        return layoutPatch;
    };

    return {
        navigation: {
            openSurface: async (surfaceId: string, props?: unknown) => {
                const cap = "navigation.openSurface";
                emitHostCall(emit, cap, "call");
                const targetSurfaceId = String(surfaceId ?? "").trim();
                if (!targetSurfaceId) {
                    await onCloseLayer();
                    emitHostCall(emit, cap, "return");
                    return;
                }
                const target = document.surfaces.find(s => s.id === targetSurfaceId);
                if (!target) {
                    emitHostCall(emit, cap, "return");
                    throw new Error(`openSurface: surface not found: ${targetSurfaceId}`);
                }
                await onOpenSurface(targetSurfaceId, normalizeJsonRecord(props));
                emitHostCall(emit, cap, "return");
            },
            getPageProps: () => {
                const cap = "navigation.getPageProps";
                emitHostCall(emit, cap, "call");
                const props = normalizeJsonRecord(currentPageProps);
                emitHostCall(emit, cap, "return");
                return props;
            },
            closeLayer: async () => {
                const cap = "navigation.closeLayer";
                emitHostCall(emit, cap, "call");
                await onCloseLayer();
                emitHostCall(emit, cap, "return");
            },
            quitApplication: async () => {
                const cap = "navigation.quitApplication";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onQuitApplication) {
                        throw new Error("quitApplication: application runtime is not available");
                    }
                    await onQuitApplication();
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
        },
        widget: {
            setVisible: async (elementId: string, visible: boolean) => {
                const cap = "widget.setVisible";
                emitHostCall(emit, cap, "call");
                if (!readDocumentElement(document, elementId)) {
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
                emitWidgetPatch(elementId, { visible });
                if (previous !== visible) {
                    scheduleElementFlush(elementId);
                }
                emitHostCall(emit, cap, "return");
            },
            setEnabled: async (elementId: string, enabled: boolean) => {
                const cap = "widget.setEnabled";
                emitHostCall(emit, cap, "call");
                if (!readDocumentElement(document, elementId)) {
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
                emitWidgetPatch(elementId, { enabled });
                if (previous !== enabled) {
                    scheduleElementFlush(elementId);
                }
                emitHostCall(emit, cap, "return");
            },
            setVariant: async (elementId: string, variantId: string | null, options?: { waitForTransition?: boolean }) => {
                const cap = "widget.setVariant";
                emitHostCall(emit, cap, "call");
                assertAppearanceVariantId(document, elementId, variantId);
                const scopedKey = scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId);
                const previous = widgetRuntimeStore.getVariantOverride(scopedKey);
                const before = readEffectiveDisplayableProperties(
                    document,
                    widgetRuntimeStore,
                    runtimePatches,
                    runtimeScopeId,
                    activeSurfaceId,
                    elementId,
                );
                const model = readAppearanceModel(document, elementId);
                const targetVariant = resolveVariantForSetVariant(model, variantId);
                const targetOpacity =
                    readAppearanceOpacity(document, widgetRuntimeStore, scopedKey, elementId, variantId) ??
                    readDisplayableProperties(document, elementId).opacity;
                widgetRuntimeStore.setVariantOverride(scopedKey, variantId);
                const previousPatch = runtimePatches.get(elementId) ?? {};
                if (hasRuntimeOpacityPatch(previousPatch)) {
                    const layout = { ...(previousPatch.layout ?? {}) };
                    delete layout.opacity;
                    const nextPatch: DevModeWidgetRuntimePatch = {
                        ...previousPatch,
                        layout,
                    };
                    runtimePatches.set(elementId, nextPatch);
                    emitWidgetPatch(elementId, nextPatch);
                }
                const opacityTransition = variantDisplayableOpacityTransition(document, elementId, targetVariant);
                if (opacityTransition && before.opacity !== targetOpacity) {
                    widgetRuntimeStore.setDisplayableMotion(scopedKey, {
                        target: { opacity: [before.opacity, targetOpacity] },
                        transition: toDisplayableTransition(opacityTransition),
                        resetOnComplete: true,
                    });
                }
                if (previous !== variantId || before.opacity !== targetOpacity) {
                    scheduleElementFlush(elementId);
                }
                if (options?.waitForTransition) {
                    await sleepMs(variantWaitMs(targetVariant));
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
                    emitWidgetPatch(elementId, {});
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
                    const hasLabelPatch = Object.prototype.hasOwnProperty.call(patch, "label");
                    const hasCursorPatch = Object.prototype.hasOwnProperty.call(patch, "cursor");
                    const nextLabel = hasLabelPatch ? normalizeString(patch.label, current.label) : current.label;
                    const nextCursor =
                        hasCursorPatch && isButtonCursorValue(patch.cursor)
                            ? patch.cursor
                            : current.cursor;

                    let changed = false;
                    const nextProps = { ...(el.props ?? {}) };
                    if (hasLabelPatch && nextLabel !== current.label) {
                        nextProps.label = nextLabel;
                        changed = true;
                    }
                    if (hasCursorPatch && nextCursor !== current.cursor) {
                        const flat = { ...getButtonProps(el), cursor: nextCursor };
                        nextProps.cursor = nextCursor;
                        nextProps.appearance = patchButtonDefaultCursorAppearance(flat.appearance, flat, nextCursor);
                        changed = true;
                    }
                    if (!changed) {
                        return;
                    }
                    el.props = nextProps;
                    emitWidgetPatch(elementId, {});
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
                    emitWidgetPatch(elementId, {});
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
                    const fitMode = patch.fitMode === undefined
                        ? current.fitMode
                        : normalizeImageFillMode(patch.fitMode, current.fitMode);
                    const cropRect = patch.cropRect === undefined
                        ? current.cropRect
                        : normalizeImageCropPlacement(patch.cropRect, current.cropRect);
                    const flipX = patch.flipX === undefined ? current.flipX : patch.flipX === true;
                    const flipY = patch.flipY === undefined ? current.flipY : patch.flipY === true;
                    const fillChanged = assetId !== current.assetId ||
                        fitMode !== current.fitMode ||
                        !imageCropPlacementEqual(cropRect, current.cropRect);
                    const flipChanged = flipX !== current.flipX || flipY !== current.flipY;
                    if (!fillChanged && !flipChanged) {
                        return;
                    }
                    let nextProps: Record<string, unknown> = { ...(el.props ?? {}) };
                    if (fillChanged) {
                        const previousFill = getImageWidgetRectangleProps(el).imageFill;
                        const nextFill: ImageFill = {
                            ...previousFill,
                            mode: fitMode,
                            assetId,
                            cropPlacement: cropRect,
                        };
                        nextProps = buildImageFillPropsUpdate(el, nextFill);
                    }
                    el.props = { ...nextProps, imageFlipX: flipX, imageFlipY: flipY };
                    emitWidgetPatch(elementId, {});
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
                    return readEffectiveDisplayableProperties(
                        document,
                        widgetRuntimeStore,
                        runtimePatches,
                        runtimeScopeId,
                        activeSurfaceId,
                        elementId,
                    );
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setDisplayableProperties: async (elementId: string, patch: BlueprintDisplayablePropertiesPatch) => {
                const cap = "widget.setDisplayableProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const current = readEffectiveDisplayableProperties(
                        document,
                        widgetRuntimeStore,
                        runtimePatches,
                        runtimeScopeId,
                        activeSurfaceId,
                        elementId,
                    );
                    const assignFinite = (value: unknown): number | undefined => {
                        if (typeof value !== "number" || !Number.isFinite(value)) {
                            return undefined;
                        }
                        return value;
                    };
                    const offsetX = assignFinite(patch.offsetX);
                    const offsetY = assignFinite(patch.offsetY);
                    const layoutPatch = createDisplayableLayoutPatch(elementId, patch);
                    const scopedKey = scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId);
                    if (offsetX !== undefined || offsetY !== undefined) {
                        widgetRuntimeStore.setDisplayableMotion(scopedKey, {
                            target: {
                                x: offsetX ?? current.offset.x,
                                y: offsetY ?? current.offset.y,
                            },
                            transition: { type: "tween", durationMs: 0, delayMs: 0, easing: "linear" },
                            resetOnComplete: false,
                        });
                    }
                    const previousPatch = runtimePatches.get(elementId) ?? {};
                    const nextPatch: DevModeWidgetRuntimePatch = {
                        ...previousPatch,
                        layout: {
                            ...(previousPatch.layout ?? {}),
                            ...layoutPatch,
                        },
                    };
                    if (patch.visible !== undefined) {
                        nextPatch.visible = patch.visible;
                    }
                    if (patch.display !== undefined) {
                        nextPatch.display = patch.display;
                    }
                    if (Object.keys(nextPatch.layout ?? {}).length === 0) {
                        delete nextPatch.layout;
                    }
                    runtimePatches.set(elementId, nextPatch);
                    emitWidgetPatch(elementId, nextPatch);
                    const next = readEffectiveDisplayableProperties(
                        document,
                        widgetRuntimeStore,
                        runtimePatches,
                        runtimeScopeId,
                        activeSurfaceId,
                        elementId,
                    );
                    if (
                        current.position.x !== next.position.x ||
                        current.position.y !== next.position.y ||
                        current.size.width !== next.size.width ||
                        current.size.height !== next.size.height ||
                        current.rotation !== next.rotation ||
                        current.opacity !== next.opacity ||
                        current.offset.x !== next.offset.x ||
                        current.offset.y !== next.offset.y ||
                        current.display !== next.display ||
                        current.visible !== next.visible
                    ) {
                        scheduleElementFlush(elementId);
                    }
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            animateDisplayable: async (elementId: string, request: BlueprintDisplayableMotionRequest) => {
                const cap = "widget.animateDisplayable";
                emitHostCall(emit, cap, "call");
                try {
                    const current = readEffectiveDisplayableProperties(
                        document,
                        widgetRuntimeStore,
                        runtimePatches,
                        runtimeScopeId,
                        activeSurfaceId,
                        elementId,
                    );
                    const heldOpacity = request.resetOnComplete
                        ? undefined
                        : finalDisplayableMotionValue(request.target.opacity);
                    const waitMs = displayableMotionWaitMs(request.transition) * (request.resetOnComplete ? 2 : 1);
                    const scopedKey = scopedWidgetRuntimeKey(runtimeScopeId, activeSurfaceId, elementId);
                    const motion = widgetRuntimeStore.setDisplayableMotion(
                        scopedKey,
                        request,
                    );
                    if (waitMs > 0 && hasExplicitDisplayableMotionKeyframes(request.target)) {
                        await waitForDisplayableMotionStartFrame();
                        if (widgetRuntimeStore.getDisplayableMotion(scopedKey)?.id !== motion.id) {
                            return motion;
                        }
                    }
                    const waitReason = await waitForDisplayableAnimation(motion.id, waitMs);
                    if (waitReason === "completed" && heldOpacity !== undefined) {
                        const currentMotion = widgetRuntimeStore.getDisplayableMotion(scopedKey);
                        if (currentMotion?.id === motion.id) {
                            const opacity = normalizeDisplayableOpacity(heldOpacity);
                            const previousPatch = runtimePatches.get(elementId) ?? {};
                            const nextPatch: DevModeWidgetRuntimePatch = {
                                ...previousPatch,
                                layout: {
                                    ...(previousPatch.layout ?? {}),
                                    opacity,
                                },
                            };
                            runtimePatches.set(elementId, nextPatch);
                            emitWidgetPatch(elementId, nextPatch);
                            if (current.opacity !== opacity) {
                                scheduleElementFlush(elementId);
                            }
                        }
                    }
                    const commitLayoutOnComplete = request.resetOnComplete ? undefined : request.commitLayoutOnComplete;
                    if (waitReason === "completed" && commitLayoutOnComplete) {
                        const currentMotion = widgetRuntimeStore.getDisplayableMotion(scopedKey);
                        if (currentMotion?.id === motion.id) {
                            const beforeCommit = readEffectiveDisplayableProperties(
                                document,
                                widgetRuntimeStore,
                                runtimePatches,
                                runtimeScopeId,
                                activeSurfaceId,
                                elementId,
                            );
                            const layoutPatch = createDisplayableLayoutPatch(elementId, commitLayoutOnComplete);
                            const previousPatch = runtimePatches.get(elementId) ?? {};
                            const nextPatch: DevModeWidgetRuntimePatch = {
                                ...previousPatch,
                                layout: {
                                    ...(previousPatch.layout ?? {}),
                                    ...layoutPatch,
                                },
                            };
                            if (Object.keys(nextPatch.layout ?? {}).length === 0) {
                                delete nextPatch.layout;
                            }
                            runtimePatches.set(elementId, nextPatch);
                            const motionCleared = widgetRuntimeStore.clearDisplayableMotion(scopedKey, {
                                silent: true,
                            });
                            emitWidgetPatch(elementId, nextPatch, { widgetStateChanged: motionCleared });
                            const afterCommit = readEffectiveDisplayableProperties(
                                document,
                                widgetRuntimeStore,
                                runtimePatches,
                                runtimeScopeId,
                                activeSurfaceId,
                                elementId,
                            );
                            if (
                                beforeCommit.position.x !== afterCommit.position.x ||
                                beforeCommit.position.y !== afterCommit.position.y ||
                                beforeCommit.offset.x !== afterCommit.offset.x ||
                                beforeCommit.offset.y !== afterCommit.offset.y
                            ) {
                                scheduleElementFlush(elementId);
                            }
                        }
                    }
                    return motion;
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            stopDisplayableAnimation: async (animationId: string) => {
                const cap = "widget.stopDisplayableAnimation";
                emitHostCall(emit, cap, "call");
                try {
                    const cleared = widgetRuntimeStore.clearDisplayableMotionById(animationId);
                    if (cleared) {
                        scheduleElementFlush(elementIdFromScopedWidgetRuntimeKey(cleared.elementId));
                    }
                    notifyDisplayableAnimationDone(animationId, "stopped");
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getFrameProperties: (elementId: string) => {
                const cap = "widget.getFrameProperties";
                emitHostCall(emit, cap, "call");
                try {
                    return readEffectiveFrameProperties(document, runtimePatches, elementId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setFrameProperties: async (elementId: string, patch: Partial<BlueprintFrameProperties>) => {
                const cap = "widget.setFrameProperties";
                emitHostCall(emit, cap, "call");
                try {
                    const el = assertFrameElement(document, elementId);
                    const current = readEffectiveFrameProperties(document, runtimePatches, elementId);
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
                    const nextPatch: DevModeWidgetRuntimePatch = {
                        ...(runtimePatches.get(elementId) ?? {}),
                        frame: {
                            targetSurfaceId,
                            params,
                        },
                    };
                    runtimePatches.set(elementId, nextPatch);
                    emitWidgetPatch(elementId, nextPatch);
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
                    return toBlueprintVisibleValue(scope.getSurfaceStore(stateScopeId).get(key));
                }
                if (scopeKind === "global") {
                    return toBlueprintVisibleValue(scope.globalGet(key));
                }
                if (scopeKind === "persistence") {
                    return toBlueprintVisibleValue(scope.persistenceGet(key));
                }
                return null;
            },
            set: (scopeKind: string, key: string, value: unknown) => {
                const nextValue = toBlueprintVisibleValue(value);
                if (scopeKind === "surface") {
                    scope.getSurfaceStore(stateScopeId).set(key, nextValue);
                } else if (scopeKind === "global") {
                    scope.globalSet(key, nextValue);
                } else if (scopeKind === "persistence") {
                    scope.persistenceSet(key, nextValue);
                }
                emit({ type: "state.write", scope: scopeKind, key });
            },
        },
        persistence: {
            get: async (key: string) => {
                emitHostCall(emit, "persistence.get", "call");
                try {
                    return toBlueprintVisibleValue(await scope.persistenceGetAsync(key));
                } finally {
                    emitHostCall(emit, "persistence.get", "return");
                }
            },
            set: async (key: string, value: unknown) => {
                emitHostCall(emit, "persistence.set", "call");
                try {
                    await scope.persistenceSetAsync(key, toBlueprintVisibleValue(value));
                    emit({ type: "state.write", scope: "persistence", key });
                } finally {
                    emitHostCall(emit, "persistence.set", "return");
                }
            },
        },
        localization: {
            getConfig: () => options.localizationConfig ?? null,
            getLocale: async () => {
                emitHostCall(emit, "localization.getLocale", "call");
                try {
                    const config = options.localizationConfig;
                    const stored = await scope.persistenceGetAsync(LOCALE_STORAGE_KEY);
                    if (typeof stored === "string" && stored && config?.locales.some(locale => locale.code === stored)) {
                        return stored;
                    }
                    return config?.sourceLocale ?? "";
                } finally {
                    emitHostCall(emit, "localization.getLocale", "return");
                }
            },
            setLocale: async (code: string) => {
                emitHostCall(emit, "localization.setLocale", "call");
                try {
                    await scope.persistenceSetAsync(LOCALE_STORAGE_KEY, code);
                    emit({ type: "state.write", scope: "persistence", key: LOCALE_STORAGE_KEY });
                } finally {
                    emitHostCall(emit, "localization.setLocale", "return");
                }
            },
        },
        frame: {
            getParam: (key: string) => {
                emitHostCall(emit, "frame.getParam", "call");
                const source = frameParams && Object.prototype.hasOwnProperty.call(frameParams, key)
                    ? frameParams
                    : currentPageProps;
                const value = source[key];
                emitHostCall(emit, "frame.getParam", "return");
                return toBlueprintVisibleValue(value);
            },
            emit: async (eventName: string, data: unknown) => {
                const cap = "frame.emit";
                emitHostCall(emit, cap, "call");
                const safeEventName = String(eventName ?? "").trim();
                if (safeEventName && onFrameEmit) {
                    await onFrameEmit(safeEventName, toBlueprintVisibleValue(data));
                }
                emitHostCall(emit, cap, "return");
            },
        },
        game: {
            startStory: async (request: DevModeStartStoryRequest) => {
                const cap = "game.startStory";
                emitHostCall(emit, cap, "call");
                try {
                    const storyId = String(request?.storyId ?? "").trim();
                    const sceneId = String(request?.sceneId ?? "").trim();
                    if (!storyId) {
                        throw new Error("startStory: storyId is required");
                    }
                    if (!sceneId) {
                        throw new Error("startStory: sceneId is required");
                    }
                    if (!onStartStory) {
                        throw new Error("startStory: game runtime is not available");
                    }
                    await onStartStory({ storyId, sceneId });
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            isInGame: () => {
                const cap = "game.isInGame";
                emitHostCall(emit, cap, "call");
                try {
                    return onIsInGame ? onIsInGame() === true : false;
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            isGameOverlay: () => {
                const cap = "game.isGameOverlay";
                emitHostCall(emit, cap, "call");
                try {
                    return onIsGameOverlay ? onIsGameOverlay() === true : false;
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            quit: async (surfaceId: string) => {
                const cap = "game.quit";
                emitHostCall(emit, cap, "call");
                try {
                    const targetSurfaceId = String(surfaceId ?? "").trim();
                    if (!targetSurfaceId) {
                        throw new Error("quit: surfaceId is required");
                    }
                    if (!onQuitGame) {
                        throw new Error("quit: game runtime is not available");
                    }
                    await onQuitGame(targetSurfaceId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            writeSave: async (id: string, metadata?: unknown, screenshot?: boolean) => {
                const cap = "game.writeSave";
                emitHostCall(emit, cap, "call");
                try {
                    const saveId = normalizeGameSaveId("writeSave", id);
                    if (!onWriteSave) {
                        throw new Error("writeSave: game save runtime is not available");
                    }
                    await onWriteSave(saveId, normalizeJsonValue(metadata), screenshot === true);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            loadSave: async (id: string) => {
                const cap = "game.loadSave";
                emitHostCall(emit, cap, "call");
                try {
                    const saveId = normalizeGameSaveId("loadSave", id);
                    if (!onLoadSave) {
                        throw new Error("loadSave: game save runtime is not available");
                    }
                    await onLoadSave(saveId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            deleteSave: async (id: string) => {
                const cap = "game.deleteSave";
                emitHostCall(emit, cap, "call");
                try {
                    const saveId = normalizeGameSaveId("deleteSave", id);
                    if (!onDeleteSave) {
                        throw new Error("deleteSave: game save runtime is not available");
                    }
                    await onDeleteSave(saveId);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            listSaveIds: async () => {
                const cap = "game.listSaveIds";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onListSaveIds) {
                        throw new Error("listSaveIds: game save runtime is not available");
                    }
                    const ids = await onListSaveIds();
                    return [...ids].map(id => String(id));
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getSaveMetadata: async (id: string) => {
                const cap = "game.getSaveMetadata";
                emitHostCall(emit, cap, "call");
                try {
                    const saveId = normalizeGameSaveId("getSaveMetadata", id);
                    if (!onGetSaveMetadata) {
                        throw new Error("getSaveMetadata: game save runtime is not available");
                    }
                    return normalizeJsonValue(await onGetSaveMetadata(saveId));
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getSavePreview: async (id: string) => {
                const cap = "game.getSavePreview";
                emitHostCall(emit, cap, "call");
                try {
                    const saveId = normalizeGameSaveId("getSavePreview", id);
                    if (!onGetSavePreview) {
                        throw new Error("getSavePreview: game save runtime is not available");
                    }
                    return normalizeBlueprintImageAssetValue(await onGetSavePreview(saveId));
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getHistory: async () => {
                const cap = "game.getHistory";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onGetHistory) {
                        throw new Error("getHistory: game runtime is not available");
                    }
                    return normalizeBlueprintGameHistory(await onGetHistory());
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            restoreHistory: async (id?: string) => {
                const cap = "game.restoreHistory";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onRestoreHistory) {
                        throw new Error("restoreHistory: game runtime is not available");
                    }
                    const safeId = String(id ?? "").trim();
                    await onRestoreHistory(safeId ? safeId : undefined);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getNametag: () => {
                const cap = "game.getNametag";
                emitHostCall(emit, cap, "call");
                try {
                    const value = onGetNametag ? onGetNametag() : scope.globalGet(BLUEPRINT_GAME_NAMETAG_STATE_KEY);
                    return normalizeBlueprintNametag(value);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getNotifications: () => {
                const cap = "game.getNotifications";
                emitHostCall(emit, cap, "call");
                try {
                    const value = onGetNotifications
                        ? onGetNotifications()
                        : scope.globalGet(BLUEPRINT_GAME_NOTIFICATIONS_STATE_KEY);
                    return normalizeBlueprintGameNotifications(value);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getChoiceCount: () => {
                const cap = "game.getChoiceCount";
                emitHostCall(emit, cap, "call");
                try {
                    const value = onGetChoiceCount
                        ? onGetChoiceCount()
                        : scope.globalGet(BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY);
                    return normalizeBlueprintChoiceCount(value);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            isNvlMode: () => {
                const cap = "game.isNvlMode";
                emitHostCall(emit, cap, "call");
                try {
                    const value = onIsNvlMode
                        ? onIsNvlMode()
                        : scope.globalGet(BLUEPRINT_GAME_NVL_MODE_STATE_KEY);
                    return value === true;
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            choose: async (index: number) => {
                const cap = "game.choose";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onSelectChoice) {
                        throw new Error("choose: choice runtime is not available");
                    }
                    await onSelectChoice(index);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            next: async () => {
                const cap = "game.next";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onNext) {
                        throw new Error("next: game runtime is not available");
                    }
                    await onNext();
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            skip: async () => {
                const cap = "game.skip";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onSkip) {
                        throw new Error("skip: game runtime is not available");
                    }
                    await onSkip();
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            showDialog: async () => {
                const cap = "game.showDialog";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onShowDialog) {
                        throw new Error("showDialog: game runtime is not available");
                    }
                    await onShowDialog();
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            hideDialog: async () => {
                const cap = "game.hideDialog";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onHideDialog) {
                        throw new Error("hideDialog: game runtime is not available");
                    }
                    await onHideDialog();
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            toggleDialogDisplay: async () => {
                const cap = "game.toggleDialogDisplay";
                emitHostCall(emit, cap, "call");
                try {
                    if (!onToggleDialogDisplay) {
                        throw new Error("toggleDialogDisplay: game runtime is not available");
                    }
                    await onToggleDialogDisplay();
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setSentenceSpeed: async (cps: number) => {
                const cap = "game.setSentenceSpeed";
                emitHostCall(emit, cap, "call");
                try {
                    const safeCps = normalizeSentenceCps(cps);
                    if (!onSetSentenceSpeed) {
                        throw new Error("setSentenceSpeed: game runtime is not available");
                    }
                    await onSetSentenceSpeed(safeCps);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setOutputResolution: async (width: number, height: number) => {
                const cap = "game.setOutputResolution";
                emitHostCall(emit, cap, "call");
                try {
                    const w = Number(width);
                    const h = Number(height);
                    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
                        throw new Error("setOutputResolution: width and height must be positive numbers");
                    }
                    if (!onSetOutputResolution) {
                        throw new Error("setOutputResolution: game runtime is not available");
                    }
                    // Aspect-ratio consistency vs. the design size is validated by the host (it owns
                    // the active surface's design size) and surfaced as a diagnostic there.
                    await onSetOutputResolution(w, h);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            getPreference: (key: BlueprintGamePreferenceKey) => {
                const cap = "game.getPreference";
                emitHostCall(emit, cap, "call");
                try {
                    const safeKey = normalizeGamePreferenceKey(key);
                    if (!onGetGamePreference) {
                        throw new Error("getPreference: game runtime is not available");
                    }
                    return normalizeGamePreferenceValue(
                        "getPreference",
                        safeKey,
                        onGetGamePreference(safeKey),
                    );
                } finally {
                    emitHostCall(emit, cap, "return");
                }
            },
            setPreference: async (key: BlueprintGamePreferenceKey, value: BlueprintGamePreferenceValue) => {
                const cap = "game.setPreference";
                emitHostCall(emit, cap, "call");
                try {
                    const safeKey = normalizeGamePreferenceKey(key);
                    const safeValue = normalizeGamePreferenceValue("setPreference", safeKey, value);
                    if (!onSetGamePreference) {
                        throw new Error("setPreference: game runtime is not available");
                    }
                    await onSetGamePreference(safeKey, safeValue);
                } finally {
                    emitHostCall(emit, cap, "return");
                }
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
