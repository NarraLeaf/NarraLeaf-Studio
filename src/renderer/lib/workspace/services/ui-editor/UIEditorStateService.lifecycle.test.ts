import { describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "../services";
import { UIEditorStateService } from "./UIEditorStateService";

function contextWith(settings: Map<string, unknown>) {
    const settingsService = {
        getSync: (key: string) => settings.get(key),
        set: vi.fn(async (key: string, value: unknown) => { settings.set(key, value); }),
    };
    const store = {
        getSelection: () => ({ type: null, data: null }),
        getEvents: () => ({ on: () => () => undefined }),
    };
    const services: Record<string, unknown> = {
        [Services.UI]: { getStore: () => store },
        [Services.UIDocument]: {},
        [Services.GlobalSettings]: settingsService,
        [Services.PanelState]: { getPanelState: () => undefined },
    };
    return { ctx: { services: { get: (id: string) => services[id] } } as unknown as WorkspaceContext, settingsService };
}

describe("UIEditorStateService workspace lifetime", () => {
    it("persists closing the last expanded border section when the workspace closes immediately", async () => {
        const key = "uiEditor.editingArea.appearanceBorderSidesExpandedByElementId";
        const settings = new Map<string, unknown>([[key, { element: true }]]);
        const { ctx } = contextWith(settings);
        const service = new UIEditorStateService();
        await service.initialize(ctx, async () => undefined);
        service.setAppearanceBorderSidesExpanded("element", false);
        await service.teardown(ctx);
        expect(settings.get(key)).toEqual({});
    });

    it("starts a new workspace without the previous workspace's tool, entered state or viewport memory", async () => {
        const settings = new Map<string, unknown>();
        const first = contextWith(settings);
        const second = contextWith(settings);
        const service = new UIEditorStateService();
        await service.initialize(first.ctx, async () => undefined);
        service.setTool({ kind: "insert", nodeType: "nl.text" });
        service.setEnteredState({ surfaceId: "page", elementId: "element", variantId: "hover" });
        service.adoptSurfaceViewport("page");
        service.updateViewport({ scale: 2, offsetX: 10, offsetY: 20 });
        await service.teardown(first.ctx);
        await service.initialize(second.ctx, async () => undefined);

        expect(service.getTool()).toEqual({ kind: "select" });
        expect(service.getEnteredState()).toBeNull();
        expect(service.adoptSurfaceViewport("page")).toEqual({ mode: "contain", chosen: false });
        await service.teardown(second.ctx);
    });
});
