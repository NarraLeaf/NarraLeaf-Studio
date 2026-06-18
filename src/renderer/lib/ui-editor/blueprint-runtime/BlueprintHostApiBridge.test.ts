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
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
        },
    };
}

function createHostApi(options?: {
    scope?: ScopeStoreBridge;
    runtimeScopeId?: string;
    frameParams?: Record<string, unknown>;
    onFrameEmit?: (eventName: string, data: unknown) => Promise<void> | void;
}) {
    return createDevModeBlueprintHostApi({
        document: createDocument(),
        scope: options?.scope ?? new ScopeStoreBridge(),
        activeSurfaceId: "page",
        runtimeScopeId: options?.runtimeScopeId,
        frameParams: options?.frameParams,
        onFrameEmit: options?.onFrameEmit,
        emit: () => undefined,
        onOpenSurface: () => undefined,
        onCloseLayer: () => undefined,
        onWidgetPatch: () => undefined,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
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
});
