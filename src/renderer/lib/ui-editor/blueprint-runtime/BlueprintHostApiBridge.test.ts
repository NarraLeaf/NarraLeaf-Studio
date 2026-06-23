import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { ScopeStoreBridge } from "./ScopeStoreBridge";
import { createDevModeBlueprintHostApi } from "./BlueprintHostApiBridge";

function createDocument(): UIDocument {
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
                childrenIds: ["slider"],
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
        },
    };
}

function createHostApi(options?: {
    document?: UIDocument;
    scope?: ScopeStoreBridge;
    runtimeScopeId?: string;
    frameParams?: Record<string, unknown>;
    onFrameEmit?: (eventName: string, data: unknown) => Promise<void> | void;
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
        onWidgetPatch: () => undefined,
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
});
