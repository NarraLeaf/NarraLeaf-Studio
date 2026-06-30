import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import {
    resolveImageAppearanceTransitions,
    resolveImageRectangleLike,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { ScopeStoreBridge } from "./ScopeStoreBridge";
import { createDevModeBlueprintHostApi, type DevModeWidgetRuntimePatch } from "./BlueprintHostApiBridge";

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
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["slider", "image"],
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
    frameParams?: Record<string, unknown>;
    onFrameEmit?: (eventName: string, data: unknown) => Promise<void> | void;
    onWidgetPatch?: (elementId: string, patch: DevModeWidgetRuntimePatch) => void;
    widgetRuntimeStore?: WidgetRuntimeStateStore;
}) {
    return createDevModeBlueprintHostApi({
        document: options?.document ?? createDocument(),
        scope: options?.scope ?? new ScopeStoreBridge(),
        activeSurfaceId: "page",
        runtimeScopeId: options?.runtimeScopeId,
        frameParams: options?.frameParams,
        onFrameEmit: options?.onFrameEmit,
        emit: () => undefined,
        onOpenSurface: () => undefined,
        onCloseLayer: () => undefined,
        onWidgetPatch: options?.onWidgetPatch ?? (() => undefined),
        widgetRuntimeStore: options?.widgetRuntimeStore ?? new WidgetRuntimeStateStore(),
    });
}

describe("createDevModeBlueprintHostApi frame scope", () => {
    it("exposes frame params and emits frame events through the parent callback", async () => {
        const onFrameEmit = vi.fn();
        const hostApi = createHostApi({
            frameParams: { tab: "audio", index: 2 },
            onFrameEmit,
        });

        expect(hostApi.frame.getParam("tab")).toBe("audio");
        expect(hostApi.frame.getParam("index")).toBe(2);
        expect(hostApi.frame.getParam("missing")).toBeUndefined();

        await hostApi.frame.emit(" page:selected ", { id: "settings" });
        await hostApi.frame.emit("   ", { ignored: true });

        expect(onFrameEmit).toHaveBeenCalledTimes(1);
        expect(onFrameEmit).toHaveBeenCalledWith("page:selected", { id: "settings" });
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

    it("reads and writes ImageAsset values while accepting legacy assetId patches", async () => {
        const document = createDocument();
        const hostApi = createHostApi({ document });

        expect(hostApi.widget.getImageProperties("image").asset).toEqual({
            kind: "imageAsset",
            assetId: "old-image",
        });

        await hostApi.widget.setImageProperties("image", {
            asset: { kind: "imageAsset", assetId: "new-image" },
        });
        expect((document.elements.image?.props?.imageFill as Record<string, unknown>).assetId).toBe("new-image");
        expect(resolvedImageAssetId(document)).toBe("new-image");

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
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 0, easing: "easeOut" },
            resetOnComplete: false,
        });

        expect(hostApi.widget.getDisplayableProperties("image").opacity).toBe(1);
        expect(onWidgetPatch).toHaveBeenLastCalledWith("image", {
            layout: { opacity: 1 },
        });
        expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
            target: { opacity: [0, 1] },
            resetOnComplete: false,
        });
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
        const hostApi = createHostApi({ document, onWidgetPatch });

        expect(hostApi.widget.getDisplayableProperties("image")).toMatchObject({
            position: { x: 0, y: 48 },
            size: { width: 120, height: 80 },
            rotation: 0,
            opacity: 1,
            visible: true,
        });

        await hostApi.widget.setDisplayableProperties("image", {
            x: 12,
            width: 160,
            rotation: 15,
            opacity: 0.5,
            visible: false,
        });

        expect(document.elements.image?.layout).toMatchObject({ x: 0, y: 48, width: 120, height: 80 });
        expect(onWidgetPatch).toHaveBeenCalledWith("image", {
            layout: { x: 12, width: 160, rotation: 15, opacity: 0.5 },
            visible: false,
        });
        expect(hostApi.widget.getDisplayableProperties("image")).toMatchObject({
            position: { x: 12, y: 48 },
            size: { width: 160, height: 80 },
            bounds: { x: 12, y: 48, width: 160, height: 80 },
            rotation: 15,
            opacity: 0.5,
            visible: false,
        });
    });

    it("stores and clears Displayable animation requests in runtime state", async () => {
        const store = new WidgetRuntimeStateStore();
        const hostApi = createHostApi({ widgetRuntimeStore: store, runtimeScopeId: "scope" });

        await hostApi.widget.animateDisplayable("image", {
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 0, easing: "linear" },
            resetOnComplete: true,
        });

        expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 0, easing: "linear" },
            resetOnComplete: true,
        });

        await hostApi.widget.stopDisplayableAnimation("image");

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

            expect(store.getDisplayableMotion("scope\0image")).toMatchObject({
                target: { opacity: [0, 1] },
                transition: { type: "tween", durationMs: 120, delayMs: 30, easing: "linear" },
            });
            await vi.advanceTimersByTimeAsync(149);
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
});
