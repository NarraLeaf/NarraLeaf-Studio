import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import {
    resolveButtonVisualProps,
    resolveImageAppearanceTransitions,
    resolveImageRectangleLike,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    createInitialButtonAppearance,
    createInitialImageAppearanceFromProps,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { ScopeStoreBridge } from "./ScopeStoreBridge";
import { createDevModeBlueprintHostApi, type DevModeWidgetRuntimePatch } from "./BlueprintHostApiBridge";
import { BLUEPRINT_GAME_NAMETAG_STATE_KEY } from "@shared/types/blueprint/hostApi";
import type { BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { displayableMotionFromCurrent } from "@/lib/ui-editor/runtime/displayableMotion";
import { defaultButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";

function createDocument(): UIDocument {
    const imageProps = {
        fillType: "image",
        imageFill: { mode: "cover" as const, assetId: "old-image" },
    };
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "page",
                name: "Page",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
            {
                id: "page-b",
                name: "Page B",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-b",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["slider", "image", "button", "frame"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            slider: {
                id: "slider",
                type: "nl.slider",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 240, height: 40 },
                props: {
                    value: 20,
                    min: 0,
                    max: 100,
                    step: 5,
                    orientation: "horizontal",
                    trackElementId: null,
                    handleElementId: null,
                },
            },
            image: {
                id: "image",
                type: "nl.image",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 48, width: 120, height: 80 },
                props: {
                    ...imageProps,
                    appearance: createInitialImageAppearanceFromProps(imageProps),
                },
            },
            button: {
                id: "button",
                type: "nl.button",
                parentId: "root",
                childrenIds: [],
                layout: { x: 132, y: 48, width: 120, height: 40 },
                props: {
                    ...defaultButtonWidgetProps,
                    label: "Go",
                    appearance: createInitialButtonAppearance(defaultButtonWidgetProps),
                },
            },
            frame: {
                id: "frame",
                type: UI_FRAME_ELEMENT_TYPE,
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 132, width: 160, height: 90 },
                props: {
                    targetSurfaceId: null,
                    params: {},
                    navigationMode: "static",
                },
            },
            "root-b": {
                id: "root-b",
                type: "nl.root",
                parentId: null,
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
        },
    };
}

function resolvedImageAssetId(document: UIDocument): string | null {
    const image = document.elements.image;
    if (!image) {
        return null;
    }
    const appearance = (image.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    return resolveImageRectangleLike(image, appearance, {
        signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    }).imageFill?.assetId ?? null;
}

function createHostApi(options?: {
    document?: UIDocument;
    scope?: ScopeStoreBridge;
    runtimeScopeId?: string;
    pageProps?: Record<string, unknown>;
    frameParams?: Record<string, unknown>;
    onFrameEmit?: (eventName: string, data: unknown) => Promise<void> | void;
    onOpenSurface?: (surfaceId: string, props?: Record<string, unknown>) => Promise<void> | void;
    onQuitApplication?: () => Promise<void> | void;
    onWidgetPatch?: (elementId: string, patch: DevModeWidgetRuntimePatch) => void;
    onWriteSave?: (id: string, metadata: unknown, screenshot?: boolean) => Promise<void> | void;
    onLoadSave?: (id: string) => Promise<void> | void;
    onDeleteSave?: (id: string) => Promise<void> | void;
    onListSaveIds?: () => Promise<string[]> | string[];
    onGetSaveMetadata?: (id: string) => Promise<unknown> | unknown;
    onGetSavePreview?: (id: string) => Promise<BlueprintImageAsset | null> | BlueprintImageAsset | null;
    onGetNametag?: () => string | null;
    onIsInGame?: () => boolean;
    onIsGameOverlay?: () => boolean;
    onQuitGame?: (surfaceId: string) => Promise<void> | void;
    onNext?: () => Promise<void> | void;
    onSkip?: () => Promise<void> | void;
    onShowDialog?: () => Promise<void> | void;
    onHideDialog?: () => Promise<void> | void;
    onToggleDialogDisplay?: () => Promise<void> | void;
    onSetSentenceSpeed?: (cps: number) => Promise<void> | void;
    onCloseLayer?: () => Promise<void> | void;
    widgetRuntimeStore?: WidgetRuntimeStateStore;
}) {
    return createDevModeBlueprintHostApi({
        document: options?.document ?? createDocument(),
        scope: options?.scope ?? new ScopeStoreBridge(),
        activeSurfaceId: "page",
        runtimeScopeId: options?.runtimeScopeId,
        pageProps: options?.pageProps,
        frameParams: options?.frameParams,
        onFrameEmit: options?.onFrameEmit,
        onWriteSave: options?.onWriteSave,
        onLoadSave: options?.onLoadSave,
        onDeleteSave: options?.onDeleteSave,
        onListSaveIds: options?.onListSaveIds,
        onGetSaveMetadata: options?.onGetSaveMetadata,
        onGetSavePreview: options?.onGetSavePreview,
        onGetNametag: options?.onGetNametag,
        onIsInGame: options?.onIsInGame,
        onIsGameOverlay: options?.onIsGameOverlay,
        onQuitGame: options?.onQuitGame,
        onNext: options?.onNext,
        onSkip: options?.onSkip,
        onShowDialog: options?.onShowDialog,
        onHideDialog: options?.onHideDialog,
        onToggleDialogDisplay: options?.onToggleDialogDisplay,
        onSetSentenceSpeed: options?.onSetSentenceSpeed,
        emit: () => undefined,
        onOpenSurface: options?.onOpenSurface ?? (() => undefined),
        onCloseLayer: options?.onCloseLayer ?? (() => undefined),
        onQuitApplication: options?.onQuitApplication,
        onWidgetPatch: options?.onWidgetPatch ?? (() => undefined),
        widgetRuntimeStore: options?.widgetRuntimeStore ?? new WidgetRuntimeStateStore(),
    });
}

describe("createDevModeBlueprintHostApi frame scope", () => {
    it("tracks Frame target page changes as runtime patches so None can clear a runtime page", async () => {
        const onWidgetPatch = vi.fn();
        const document = createDocument();
        const hostApi = createHostApi({ document, onWidgetPatch });

        await hostApi.widget.setFrameProperties("frame", { targetSurfaceId: "page-b" });

        expect(hostApi.widget.getFrameProperties("frame").targetSurfaceId).toBe("page-b");
        expect(onWidgetPatch).toHaveBeenLastCalledWith("frame", expect.objectContaining({
            frame: expect.objectContaining({ targetSurfaceId: "page-b" }),
        }));

        await hostApi.widget.setFrameProperties("frame", { targetSurfaceId: null });

        expect(hostApi.widget.getFrameProperties("frame").targetSurfaceId).toBeNull();
        expect(onWidgetPatch).toHaveBeenLastCalledWith("frame", expect.objectContaining({
            frame: expect.objectContaining({ targetSurfaceId: null }),
        }));
    });

    it("exposes frame params and emits frame events through the parent callback", async () => {
        const onFrameEmit = vi.fn();
        const hostApi = createHostApi({
            frameParams: { tab: "audio", index: 2 },
            onFrameEmit,
        });

        expect(hostApi.frame.getParam("tab")).toBe("audio");
        expect(hostApi.frame.getParam("index")).toBe(2);
        expect(hostApi.frame.getParam("missing")).toBeNull();

        await hostApi.frame.emit(" page:selected ", { id: "settings" });
        await hostApi.frame.emit("   ", { ignored: true });

        expect(onFrameEmit).toHaveBeenCalledTimes(1);
        expect(onFrameEmit).toHaveBeenCalledWith("page:selected", { id: "settings" });
    });

    it("reads current Page props and passes props through page navigation", async () => {
        const opened: Array<{ surfaceId: string; props?: Record<string, unknown> }> = [];
        const closed: boolean[] = [];
        const quitApplication = vi.fn();
        const pageProps = { tab: "audio", nested: { muted: true } };
        const hostApi = createHostApi({
            pageProps,
            onQuitApplication: quitApplication,
            onOpenSurface: (surfaceId, props) => {
                opened.push({ surfaceId, props });
            },
            onCloseLayer: () => {
                closed.push(true);
            },
        });

        const currentProps = hostApi.navigation.getPageProps();
        expect(currentProps).toEqual(pageProps);
        expect(currentProps).not.toBe(pageProps);
        expect(hostApi.frame.getParam("tab")).toBe("audio");

        await hostApi.navigation.openSurface("page-b", { tab: "video", index: 2 });
        await hostApi.navigation.openSurface("page-b");
        await hostApi.navigation.openSurface("");

        expect(opened).toEqual([
            { surfaceId: "page-b", props: { tab: "video", index: 2 } },
            { surfaceId: "page-b", props: {} },
        ]);
        expect(closed).toEqual([true]);

        await hostApi.navigation.quitApplication();
        expect(quitApplication).toHaveBeenCalledTimes(1);
    });

    it("uses runtimeScopeId to isolate surface state between Frame instances", () => {
        const scope = new ScopeStoreBridge();
        const first = createHostApi({ scope, runtimeScopeId: "page/frame:first" });
        const second = createHostApi({ scope, runtimeScopeId: "page/frame:second" });

        first.state.set("surface", "count", 1);
        second.state.set("surface", "count", 2);

        expect(first.state.get("surface", "count")).toBe(1);
        expect(second.state.get("surface", "count")).toBe(2);
        expect(scope.getSurfaceStore("page").get("count")).toBeUndefined();
    });

    it("exposes Dialog game controls and nametag reads", async () => {
        const next = vi.fn();
        const skip = vi.fn();
        const quit = vi.fn();
        const dialogDisplayCalls: string[] = [];
        const cpsValues: number[] = [];
        const hostApi = createHostApi({
            onGetNametag: () => "Alice",
            onIsInGame: () => true,
            onIsGameOverlay: () => true,
            onQuitGame: quit,
            onNext: next,
            onSkip: skip,
            onShowDialog: () => {
                dialogDisplayCalls.push("show");
            },
            onHideDialog: () => {
                dialogDisplayCalls.push("hide");
            },
            onToggleDialogDisplay: () => {
                dialogDisplayCalls.push("toggle");
            },
            onSetSentenceSpeed: cps => {
                cpsValues.push(cps);
            },
        });

        expect(hostApi.game.getNametag()).toBe("Alice");
        expect(hostApi.game.isInGame()).toBe(true);
        expect(hostApi.game.isGameOverlay()).toBe(true);
        await hostApi.game.quit(" page-b ");
        await hostApi.game.next();
        await hostApi.game.skip();
        await hostApi.game.showDialog();
        await hostApi.game.hideDialog();
        await hostApi.game.toggleDialogDisplay();
        await hostApi.game.setSentenceSpeed(24);

        expect(quit).toHaveBeenCalledWith("page-b");
        expect(next).toHaveBeenCalledTimes(1);
        expect(skip).toHaveBeenCalledTimes(1);
        expect(dialogDisplayCalls).toEqual(["show", "hide", "toggle"]);
        expect(cpsValues).toEqual([24]);
    });

    it("routes game save operations through callbacks with normalized ids", async () => {
        const writtenIds: string[] = [];
        const writtenMetadata: unknown[] = [];
        const writtenScreenshots: boolean[] = [];
        const loadedIds: string[] = [];
        const deletedIds: string[] = [];
        const metadata = ["route", { id: "a" }];
        const preview = { kind: "imageAsset" as const, assetId: "dev-mode-save-preview:slot-a" };
        const hostApi = createHostApi({
            onWriteSave: (id, value, screenshot) => {
                writtenIds.push(id);
                writtenMetadata.push(value);
                writtenScreenshots.push(screenshot === true);
            },
            onLoadSave: id => {
                loadedIds.push(id);
            },
            onDeleteSave: id => {
                deletedIds.push(id);
            },
            onListSaveIds: () => ["slot-b", "slot-a"],
            onGetSaveMetadata: id => id === "slot-a" ? metadata : null,
            onGetSavePreview: id => id === "slot-a" ? preview : null,
        });

        await hostApi.game.writeSave(" slot-a ", metadata, true);
        await hostApi.game.loadSave(" slot-b ");
        await hostApi.game.deleteSave(" slot-a ");

        expect(writtenIds).toEqual(["slot-a"]);
        expect(writtenMetadata).toEqual([metadata]);
        expect(writtenScreenshots).toEqual([true]);
        expect(loadedIds).toEqual(["slot-b"]);
        expect(deletedIds).toEqual(["slot-a"]);
        expect(await hostApi.game.listSaveIds()).toEqual(["slot-b", "slot-a"]);
        expect(await hostApi.game.getSaveMetadata(" slot-a ")).toEqual(metadata);
        expect(await hostApi.game.getSavePreview(" slot-a ")).toEqual(preview);
    });

    it("falls back to global nametag state when no dialog callback is installed", () => {
        const scope = new ScopeStoreBridge();
        scope.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, "Narrator");
        const hostApi = createHostApi({ scope });

        expect(hostApi.game.getNametag()).toBe("Narrator");
        expect(hostApi.game.isInGame()).toBe(false);
        expect(hostApi.game.isGameOverlay()).toBe(false);
    });

    it("returns null for missing Dialog nametag values", () => {
        expect(createHostApi().game.getNametag()).toBeNull();
        expect(createHostApi({ onGetNametag: () => null }).game.getNametag()).toBeNull();
        expect(createHostApi({ onGetNametag: () => "" }).game.getNametag()).toBeNull();
        expect(createHostApi({ onGetNametag: () => "   " }).game.getNametag()).toBeNull();
    });

    it("routes persistence get/set through the async store adapter", async () => {
        const scope = new ScopeStoreBridge();
        const store: Record<string, unknown> = { theme: "dark" };
        scope.setPersistenceAdapter({
            getAll: async () => ({ ...store }),
            getValue: async key => store[key],
            setValue: async (key, value) => {
                store[key] = value;
            },
        });
        const hostApi = createHostApi({ scope });

        expect(await hostApi.persistence.get("theme")).toBe("dark");

        await hostApi.persistence.set("theme", "light");

        expect(store.theme).toBe("light");
        expect(scope.getPersistenceSnapshot().get("theme")).toBe("light");
    });

    it("stores Slider value and range changes in runtime state without mutating the UI document", async () => {
        const document = createDocument();
        const hostApi = createHostApi({ document });

        expect(hostApi.widget.getSliderProperties("slider")).toMatchObject({
            value: 20,
            min: 0,
            max: 100,
            step: 5,
            normalizedValue: 0.2,
        });

        await hostApi.widget.setSliderProperties("slider", { value: 88 });

        expect(hostApi.widget.getSliderProperties("slider")).toMatchObject({
            value: 90,
            normalizedValue: 0.9,
        });
        expect((document.elements.slider?.props as Record<string, unknown>).value).toBe(20);

        await hostApi.widget.setSliderProperties("slider", { min: -10, max: 10, step: 4 });

        expect(hostApi.widget.getSliderProperties("slider")).toMatchObject({
            min: -10,
            max: 10,
            step: 4,
            value: 10,
            normalizedValue: 1,
        });
    });

    it("writes Button pointer changes through the default appearance cursor", async () => {
        const document = createDocument();
        const hostApi = createHostApi({ document });

        expect(hostApi.widget.getButtonProperties("button").cursor).toBe("auto");

        await hostApi.widget.setButtonProperties("button", { cursor: "crosshair" });

        const button = document.elements.button!;
        const appearance = (button.props as { appearance: AppearanceModel }).appearance;
        const cursorGroup = appearance.variants[0]?.propertyGroups.find(group => group.key === "cursor");
        expect(hostApi.widget.getButtonProperties("button").cursor).toBe("crosshair");
        expect(cursorGroup?.rows[0]?.value).toBe("crosshair");
        expect(resolveButtonVisualProps(button, appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        }).cursor).toBe("crosshair");
    });

    it("reads and writes ImageAsset values while accepting legacy assetId patches", async () => {
        const document = createDocument();
        const hostApi = createHostApi({ document });

        expect(hostApi.widget.getImageProperties("image").asset).toEqual({
            kind: "imageAsset",
            assetId: "old-image",
        });
        expect(hostApi.widget.getImageProperties("image")).toMatchObject({
            fitMode: "cover",
            cropRect: { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 },
            flipX: false,
            flipY: false,
        });

        await hostApi.widget.setImageProperties("image", {
            asset: { kind: "imageAsset", assetId: "new-image" },
        });
        expect((document.elements.image?.props?.imageFill as Record<string, unknown>).assetId).toBe("new-image");
        expect(resolvedImageAssetId(document)).toBe("new-image");

        await hostApi.widget.setImageProperties("image", {
            fitMode: "contain",
            cropRect: { leftPct: 5, topPct: 6, widthPct: 70, heightPct: 80 },
            flipX: true,
            flipY: true,
        });
        expect(document.elements.image?.props?.imageFill).toMatchObject({
            mode: "contain",
            cropPlacement: { leftPct: 5, topPct: 6, widthPct: 70, heightPct: 80 },
        });
        expect(document.elements.image?.props?.imageFlipX).toBe(true);
        expect(document.elements.image?.props?.imageFlipY).toBe(true);
        expect(hostApi.widget.getImageProperties("image")).toMatchObject({
            fitMode: "contain",
            cropRect: { leftPct: 5, topPct: 6, widthPct: 70, heightPct: 80 },
            flipX: true,
            flipY: true,
        });

        await hostApi.widget.setImageProperties("image", { asset: null });
        expect((document.elements.image?.props?.imageFill as Record<string, unknown>).assetId).toBeNull();
        expect(resolvedImageAssetId(document)).toBeNull();

        await hostApi.widget.setImageProperties("image", { assetId: "legacy-image" });
        expect(hostApi.widget.getImageProperties("image").asset).toEqual({
            kind: "imageAsset",
            assetId: "legacy-image",
        });
        expect(resolvedImageAssetId(document)).toBe("legacy-image");
    });

    it("supports Image appearance variant overrides", async () => {
        const store = new WidgetRuntimeStateStore();
        const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope" });
        const defaultVariantId = hostApi.widget.getCommonProperties("image").variantId;

        expect(defaultVariantId).toBeTruthy();

        await hostApi.widget.setVariant("image", defaultVariantId);
        expect(store.getVariantOverride("scope\0image")).toBe(defaultVariantId);

        await hostApi.widget.setVariant("image", null);
        expect(store.getVariantOverride("scope\0image")).toBeNull();
    });

    it("keeps authored layout opacity as the default Displayable opacity", () => {
        const document = createDocument();
        document.elements.image!.layout.opacity = 0.4;
        const hostApi = createHostApi({ document });

        expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(0.4);
    });

    it("uses one effective Displayable opacity for Variant opacity and waits when requested", async () => {
        vi.useFakeTimers();
        try {
            const document = createDocument();
            const image = document.elements.image!;
            const appearance = (image.props as { appearance: AppearanceModel }).appearance;
            const defaultVariant = appearance.variants[0]!;
            const transparentVariant = {
                ...defaultVariant,
                id: "transparent",
                name: "Transparent",
                propertyGroups: defaultVariant.propertyGroups.map(group =>
                    group.key === "transformOpacity"
                        ? {
                              ...group,
                              rows: [{ conditions: null, value: 0 }],
                              transition: {
                                  type: "tween" as const,
                                  durationMs: 25,
                                  delayMs: 5,
                                  easing: "linear" as const,
                              },
                          }
                        : group,
                ),
            };
            appearance.variants = [...appearance.variants, transparentVariant];
            const store = new WidgetRuntimeStateStore();
            const onWidgetPatch = vi.fn();
            const hostApi = createHostApi({
                document,
                widgetRuntimeStore: store,
                runtimeScopeId: "scope",
                onWidgetPatch,
            });

            expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(1);

            const pending = hostApi.widget.setVariant("image", "transparent", { waitForTransition: true });
            expect(store.getVariantOverride("scope\0image")).toBe("transparent");
            expect(onWidgetPatch).not.toHaveBeenCalled();
            expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(0);
            expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
                target: { opacity: [1, 0] },
                transition: {
                    type: "tween",
                    durationMs: 25,
                    delayMs: 5,
                    easing: "linear",
                },
                resetOnComplete: true,
            });

            await vi.advanceTimersByTimeAsync(30);
            await pending;
        } finally {
            vi.useRealTimers();
        }
    });

    it("lets a held opacity animation replace a transparent Variant opacity", async () => {
        const document = createDocument();
        const image = document.elements.image!;
        const appearance = (image.props as { appearance: AppearanceModel }).appearance;
        const defaultVariant = appearance.variants[0]!;
        const transparentVariant = {
            ...defaultVariant,
            id: "transparent",
            name: "Transparent",
            propertyGroups: defaultVariant.propertyGroups.map(group =>
                group.key === "transformOpacity"
                    ? {
                          ...group,
                          rows: [{ conditions: null, value: 0 }],
                      }
                    : group,
            ),
        };
        appearance.variants = [...appearance.variants, transparentVariant];
        const store = new WidgetRuntimeStateStore();
        const onWidgetPatch = vi.fn();
        const hostApi = createHostApi({
            document,
            widgetRuntimeStore: store,
            runtimeScopeId: "scope",
            onWidgetPatch,
        });

        await hostApi.widget.setDisplayableProperties("image", { opacity: 0.75 });
        expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(0.75);
        onWidgetPatch.mockClear();

        await hostApi.widget.setVariant("image", "transparent");

        expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(0);
        expect(onWidgetPatch).toHaveBeenLastCalledWith("image", {
            layout: {},
        });

        await hostApi.widget.animateDisplayable("image", {
            target: { opacity: displayableMotionFromCurrent(1) },
            transition: { type: "tween", durationMs: 0, easing: "easeOut" },
            resetOnComplete: false,
        });

        expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(1);
        expect(onWidgetPatch).toHaveBeenLastCalledWith("image", {
            layout: { opacity: 1 },
        });
        expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
            target: { opacity: { from: "current", to: 1 } },
            resetOnComplete: false,
        });
    });

    it("commits held Displayable opacity only after natural animation completion", async () => {
        vi.useFakeTimers();
        try {
            const store = new WidgetRuntimeStateStore();
            const onWidgetPatch = vi.fn();
            const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope", onWidgetPatch });
            await hostApi.widget.setDisplayableProperties("image", { opacity: 0 });
            onWidgetPatch.mockClear();

            const animation = hostApi.widget.animateDisplayable("image", {
                target: { opacity: [0, 1] },
                transition: { type: "tween", durationMs: 100, delayMs: 0, easing: "linear" },
                resetOnComplete: false,
            });

            await vi.advanceTimersByTimeAsync(16);
            expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
                target: { opacity: [0, 1] },
            });
            expect(onWidgetPatch).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(83);
            expect(onWidgetPatch).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            await expect(animation).resolves.toMatchObject({
                target: { opacity: [0, 1] },
            });
            expect(onWidgetPatch).toHaveBeenLastCalledWith("image", {
                layout: { opacity: 1 },
            });
            expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("treats Image Variant fill opacity as Displayable opacity without hiding the inner image fill", async () => {
        const document = createDocument();
        const image = document.elements.image!;
        const appearance = (image.props as { appearance: AppearanceModel }).appearance;
        const defaultVariant = appearance.variants[0]!;
        const transparentVariant = {
            ...defaultVariant,
            id: "transparent-fill",
            name: "Transparent Fill",
            propertyGroups: defaultVariant.propertyGroups.map(group =>
                group.key === "fillOpacity"
                    ? {
                          ...group,
                          rows: [{ conditions: null, value: 0 }],
                          transition: {
                              type: "tween" as const,
                              durationMs: 120,
                              delayMs: 0,
                              easing: "linear" as const,
                          },
                      }
                    : group,
            ),
        };
        appearance.variants = [...appearance.variants, transparentVariant];
        const store = new WidgetRuntimeStateStore();
        const onWidgetPatch = vi.fn();
        const hostApi = createHostApi({
            document,
            widgetRuntimeStore: store,
            runtimeScopeId: "scope",
            onWidgetPatch,
        });

        expect(
            resolveImageRectangleLike(image, appearance, {
                variantOverrideId: "transparent-fill",
                signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
            }).fillOpacity,
        ).toBe(1);
        expect(
            resolveImageAppearanceTransitions(appearance, {
                variantOverrideId: "transparent-fill",
                signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
            }).fillOpacity,
        ).toBeUndefined();

        await hostApi.widget.setVariant("image", "transparent-fill");

        expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(0);
        expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
            target: { opacity: [1, 0] },
            transition: {
                type: "tween",
                durationMs: 120,
                delayMs: 0,
                easing: "linear",
            },
            resetOnComplete: true,
        });

        await hostApi.widget.animateDisplayable("image", {
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 0, easing: "easeOut" },
            resetOnComplete: false,
        });

        expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(1);
        expect(onWidgetPatch).toHaveBeenLastCalledWith("image", {
            layout: { opacity: 1 },
        });
    });

    it("treats Image color fill opacity as chrome background opacity", async () => {
        const document = createDocument();
        const image = document.elements.image!;
        const colorImageProps = {
            backgroundColor: "#ff0000",
            fillType: "color",
            fillOpacity: 1,
            fillVisible: true,
            imageFill: { mode: "cover" as const, assetId: null },
        };
        image.props = {
            ...image.props,
            ...colorImageProps,
            appearance: createInitialImageAppearanceFromProps(colorImageProps),
        };
        const appearance = (image.props as { appearance: AppearanceModel }).appearance;
        const defaultVariant = appearance.variants[0]!;
        const transparentColorVariant = {
            ...defaultVariant,
            id: "transparent-color",
            name: "Transparent Color",
            propertyGroups: defaultVariant.propertyGroups.map(group => {
                if (group.key === "fillType") {
                    return { ...group, rows: [{ conditions: null, value: "color" }] };
                }
                if (group.key === "fillOpacity") {
                    return {
                        ...group,
                        rows: [{ conditions: null, value: 0.25 }],
                        transition: {
                            type: "tween" as const,
                            durationMs: 120,
                            delayMs: 0,
                            easing: "linear" as const,
                        },
                    };
                }
                return group;
            }),
        };
        appearance.variants = [...appearance.variants, transparentColorVariant];

        const resolved = resolveImageRectangleLike(image, appearance, {
            variantOverrideId: "transparent-color",
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.fillType).toBe("color");
        expect(resolved.fillOpacity).toBe(0.25);
        expect(
            resolveImageAppearanceTransitions(
                appearance,
                {
                    variantOverrideId: "transparent-color",
                    signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
                },
                resolved,
            ).fillOpacity,
        ).toMatchObject({ durationMs: 120 });

        const store = new WidgetRuntimeStateStore();
        const hostApi = createHostApi({
            document,
            widgetRuntimeStore: store,
            runtimeScopeId: "scope",
        });

        await hostApi.widget.setVariant("image", "transparent-color");

        expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(1);
        expect(store.getDisplayableMotion("scope\0image")).toBeNull();
    });

    it("keeps Image Variant from overriding the Default image fill mode", () => {
        const document = createDocument();
        const image = document.elements.image!;
        const appearance = (image.props as { appearance: AppearanceModel }).appearance;
        const defaultVariant = appearance.variants[0]!;
        defaultVariant.propertyGroups = defaultVariant.propertyGroups.map(group =>
            group.key === "imageFill"
                ? {
                      ...group,
                      rows: [
                          {
                              conditions: null,
                              value: {
                                  mode: "contain",
                                  assetId: "asset-1",
                              },
                          },
                      ],
                  }
                : group,
        );
        const cropVariant = {
            ...defaultVariant,
            id: "transparent-with-stale-crop",
            name: "Transparent With Stale Crop",
            propertyGroups: defaultVariant.propertyGroups.map(group =>
                group.key === "imageFill"
                    ? {
                          ...group,
                          rows: [
                              {
                                  conditions: null,
                                  value: {
                                      mode: "crop",
                                      assetId: "asset-1",
                                      cropPlacement: {
                                          leftPct: 0,
                                          topPct: 0,
                                          widthPct: 100,
                                          heightPct: 100,
                                      },
                                  },
                              },
                          ],
                      }
                    : group,
            ),
        };
        appearance.variants = [defaultVariant, cropVariant];

        expect(
            resolveImageRectangleLike(image, appearance, {
                variantOverrideId: "transparent-with-stale-crop",
                signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
            }).imageFill,
        ).toMatchObject({
            mode: "contain",
            assetId: "asset-1",
        });
    });

    it("stores Displayable property changes as runtime patches", async () => {
        const document = createDocument();
        const onWidgetPatch = vi.fn();
        const store = new WidgetRuntimeStateStore();
        const hostApi = createHostApi({ document, onWidgetPatch, widgetRuntimeStore: store, runtimeScopeId: "scope" });

        expect(hostApi.widget.getDisplayableProperties("image")).toMatchObject({
            position: { x: 0, y: 48 },
            offset: { x: 0, y: 0 },
            size: { width: 120, height: 80 },
            rotation: 0,
            opacity: 1,
            display: true,
            visible: true,
        });

        await hostApi.widget.setDisplayableProperties("image", {
            x: 12,
            width: 160,
            rotation: 15,
            opacity: 0.5,
            display: false,
            visible: false,
        });

        expect(document.elements.image?.layout).toMatchObject({ x: 0, y: 48, width: 120, height: 80 });
        expect(onWidgetPatch).toHaveBeenCalledWith("image", {
            layout: { x: 12, width: 160, rotation: 15, opacity: 0.5 },
            display: false,
            visible: false,
        });
        expect(hostApi.widget.getDisplayableProperties("image")).toMatchObject({
            position: { x: 12, y: 48 },
            size: { width: 160, height: 80 },
            bounds: { x: 12, y: 48, width: 160, height: 80 },
            rotation: 15,
            opacity: 0.5,
            display: false,
            visible: false,
        });

        await hostApi.widget.setDisplayableProperties("image", {
            offsetX: 24,
            offsetY: -12,
        });

        expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
            target: { x: 24, y: -12 },
            transition: { type: "tween", durationMs: 0, easing: "linear" },
            resetOnComplete: false,
        });
        expect(hostApi.widget.getDisplayableProperties("image")).toMatchObject({
            position: { x: 12, y: 48 },
            offset: { x: 24, y: -12 },
        });
    });

    it("reads and writes nested Displayable x/y in surface coordinates", async () => {
        const document = createDocument();
        document.elements.root!.childrenIds = ["slider", "panel", "frame"];
        document.elements.panel = {
            id: "panel",
            type: "nl.container",
            parentId: "root",
            childrenIds: ["image"],
            layout: { x: 30, y: 20, width: 200, height: 100 },
        };
        document.elements.image!.parentId = "panel";
        document.elements.image!.layout = { x: 5, y: 7, width: 120, height: 80 };
        const onWidgetPatch = vi.fn();
        const hostApi = createHostApi({ document, onWidgetPatch });

        expect(hostApi.widget.getDisplayableProperties("image")).toMatchObject({
            position: { x: 35, y: 27 },
            bounds: { x: 35, y: 27, width: 120, height: 80 },
        });

        await hostApi.widget.setDisplayableProperties("image", { x: 80, y: 90 });

        expect(onWidgetPatch).toHaveBeenLastCalledWith("image", {
            layout: { x: 50, y: 70 },
        });
        expect(hostApi.widget.getDisplayableProperties("image")).toMatchObject({
            position: { x: 80, y: 90 },
            bounds: { x: 80, y: 90, width: 120, height: 80 },
        });

        await hostApi.widget.setDisplayableProperties("panel", { x: 42, y: 24 });

        expect(onWidgetPatch).toHaveBeenLastCalledWith("panel", {
            layout: { x: 42, y: 24 },
        });
        expect(hostApi.widget.getDisplayableProperties("image").position).toEqual({ x: 92, y: 94 });
    });

    it("notifies runtime patch subscribers when Displayable properties change", async () => {
        const store = new WidgetRuntimeStateStore();
        const onRuntimePatch = vi.fn();
        store.subscribeRuntimePatches(onRuntimePatch);
        const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope" });

        await hostApi.widget.setDisplayableProperties("image", { display: false });

        expect(onRuntimePatch).toHaveBeenCalledTimes(1);
    });

    it("resolves Displayable properties for component definition elements", async () => {
        const document = createDocument();
        document.components = [
            {
                id: "component",
                name: "Component",
                rootElementId: "component-container",
                elements: {
                    "component-container": {
                        id: "component-container",
                        type: "nl.container",
                        parentId: null,
                        childrenIds: [],
                        layout: { x: 4, y: 8, width: 160, height: 80 },
                    },
                },
            },
        ];
        const onWidgetPatch = vi.fn();
        const hostApi = createHostApi({ document, onWidgetPatch });

        expect(hostApi.widget.getDisplayableProperties("component-container").position).toEqual({ x: 4, y: 8 });

        await hostApi.widget.setDisplayableProperties("component-container", { display: false });

        expect(onWidgetPatch).toHaveBeenLastCalledWith("component-container", expect.objectContaining({
            display: false,
        }));
        expect(hostApi.widget.getDisplayableProperties("component-container").display).toBe(false);
    });

    it("stores and clears Displayable animation requests in runtime state", async () => {
        const store = new WidgetRuntimeStateStore();
        const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope" });

        const motion = await hostApi.widget.animateDisplayable("image", {
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 0, easing: "linear" },
            resetOnComplete: true,
        });

        expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 0, easing: "linear" },
            resetOnComplete: true,
        });

        await hostApi.widget.stopDisplayableAnimation(motion.id);

        expect(store.getDisplayableMotion("scope\0image")).toBeNull();
    });

    it("waits for Displayable animation duration before resolving", async () => {
        vi.useFakeTimers();
        try {
            const store = new WidgetRuntimeStateStore();
            const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope" });
            let resolved = false;
            const animation = hostApi.widget.animateDisplayable("image", {
                target: { opacity: [0, 1] },
                transition: { type: "tween", durationMs: 120, delayMs: 30, easing: "linear" },
                resetOnComplete: true,
            }).then(result => {
                resolved = true;
                return result;
            });

            await vi.advanceTimersByTimeAsync(16);
            expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
                target: { opacity: [0, 1] },
                transition: { type: "tween", durationMs: 120, delayMs: 30, easing: "linear" },
            });
            await vi.advanceTimersByTimeAsync(283);
            expect(resolved).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await expect(animation).resolves.toMatchObject({
                target: { opacity: [0, 1] },
            });
            expect(resolved).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("commits held Displayable x layout after natural animation completion", async () => {
        vi.useFakeTimers();
        try {
            const store = new WidgetRuntimeStateStore();
            const onWidgetPatch = vi.fn();
            const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope", onWidgetPatch });
            const animation = hostApi.widget.animateDisplayable("image", {
                target: { x: [0, 100] },
                transition: { type: "tween", durationMs: 100, delayMs: 0, easing: "linear" },
                resetOnComplete: false,
                commitLayoutOnComplete: { x: 100 },
            });

            await vi.advanceTimersByTimeAsync(16);
            expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
                target: { x: [0, 100] },
            });
            expect(onWidgetPatch).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(100);
            await expect(animation).resolves.toMatchObject({
                target: { x: [0, 100] },
            });

            expect(store.getDisplayableMotion("scope\0image")).toBeNull();
            expect(onWidgetPatch).toHaveBeenLastCalledWith("image", {
                layout: { x: 100 },
            });
            expect(hostApi.widget.getDisplayableProperties("image")).toMatchObject({
                position: { x: 100, y: 48 },
                offset: { x: 0, y: 0 },
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not commit held Displayable x layout when the animation is stopped", async () => {
        vi.useFakeTimers();
        try {
            const store = new WidgetRuntimeStateStore();
            const onWidgetPatch = vi.fn();
            const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope", onWidgetPatch });
            const animation = hostApi.widget.animateDisplayable("image", {
                id: "animation:x",
                target: { x: [0, 100] },
                transition: { type: "tween", durationMs: 1000, delayMs: 0, easing: "linear" },
                resetOnComplete: false,
                commitLayoutOnComplete: { x: 100 },
            });

            await vi.advanceTimersByTimeAsync(100);
            await hostApi.widget.stopDisplayableAnimation("animation:x");
            await expect(animation).resolves.toMatchObject({ id: "animation:x" });

            expect(store.getDisplayableMotion("scope\0image")).toBeNull();
            expect(onWidgetPatch).not.toHaveBeenCalled();
            expect(hostApi.widget.getDisplayableProperties("image").position.x).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("stops Displayable animations by animation id and resolves pending waits", async () => {
        vi.useFakeTimers();
        try {
            const store = new WidgetRuntimeStateStore();
            const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope" });
            let resolved = false;
            const animation = hostApi.widget.animateDisplayable("image", {
                id: "animation:test",
                target: { opacity: [0, 1] },
                transition: { type: "tween", durationMs: 1000, delayMs: 0, easing: "linear" },
                resetOnComplete: true,
            }).then(result => {
                resolved = true;
                return result;
            });

            await vi.advanceTimersByTimeAsync(100);
            expect(resolved).toBe(false);
            expect(store.getDisplayableMotion("scope\0image")).toMatchObject({ id: "animation:test" });

            await hostApi.widget.stopDisplayableAnimation("animation:test");

            await expect(animation).resolves.toMatchObject({ id: "animation:test" });
            expect(resolved).toBe(true);
            expect(store.getDisplayableMotion("scope\0image")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});
