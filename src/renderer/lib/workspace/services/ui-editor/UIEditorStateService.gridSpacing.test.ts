import { describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "../services";
import { UIEditorStateService } from "./UIEditorStateService";
import { UI_EDITOR_GRID_PANEL_STATE_ID } from "./uiEditorGridPreference";

/** One project's `.nlstudio` panel state store, as `PanelStateService` holds it. */
function projectStore() {
    const panels = new Map<string, Record<string, unknown>>();
    return {
        panels,
        getPanelState: (id: string) => panels.get(id),
        setPanelState: vi.fn((id: string, partial: Record<string, unknown>) => {
            panels.set(id, { ...(panels.get(id) ?? {}), ...partial });
        }),
    };
}

/**
 * A state service brought up for one project. Global settings are shared between projects, the way
 * Studio's are; the panel store is the project's own. The document service is an empty object on
 * purpose: the spacing is editor state, so any path from it into the document would throw here.
 */
async function bootService(project: ReturnType<typeof projectStore>, globalSettings: Map<string, unknown>) {
    const settingsService = {
        getSync: (key: string) => globalSettings.get(key),
        set: vi.fn(async (key: string, value: unknown) => {
            globalSettings.set(key, value);
        }),
    };
    const store = {
        getSelection: () => ({ type: null, data: null }),
        getEvents: () => ({ on: () => () => undefined }),
    };
    const services: Record<string, unknown> = {
        [Services.UI]: { getStore: () => store },
        [Services.UIDocument]: {},
        [Services.GlobalSettings]: settingsService,
        [Services.PanelState]: project,
    };
    const ctx = { services: { get: (name: string) => services[name] } } as unknown as WorkspaceContext;
    const service = new (UIEditorStateService as unknown as new () => UIEditorStateService)();
    await (service as unknown as {
        init(ctx: WorkspaceContext, depend: () => Promise<void>): Promise<void>;
    }).init(ctx, async () => undefined);
    return { service, settingsService };
}

describe("UIEditorStateService grid spacing", () => {
    it("starts at 20 in a project that never set one, with grid snapping off", async () => {
        const { service } = await bootService(projectStore(), new Map());
        expect(service.getGridSpacing()).toBe(20);
        expect(service.getSmartSnapDetailSettings().snapGrid).toBe(false);
    });

    it("keeps a new spacing in the project's own store, not in Studio settings", async () => {
        const project = projectStore();
        const globalSettings = new Map<string, unknown>();
        const { service, settingsService } = await bootService(project, globalSettings);
        const heard: number[] = [];
        service.on("gridSpacingChanged", spacing => heard.push(spacing));

        service.setGridSpacing(50);
        service.setGridSpacing(50);

        expect(service.getGridSpacing()).toBe(50);
        expect(heard).toEqual([50]);
        expect(project.setPanelState).toHaveBeenCalledTimes(1);
        expect(project.panels.get(UI_EDITOR_GRID_PANEL_STATE_ID)).toEqual({ spacing: 50 });
        expect(settingsService.set).not.toHaveBeenCalled();
    });

    it("remembers the spacing per project", async () => {
        const globalSettings = new Map<string, unknown>();
        const projectA = projectStore();
        const projectB = projectStore();

        const first = await bootService(projectA, globalSettings);
        first.service.setGridSpacing(50);

        expect((await bootService(projectA, globalSettings)).service.getGridSpacing()).toBe(50);
        expect((await bootService(projectB, globalSettings)).service.getGridSpacing()).toBe(20);
    });

    it("ignores a spacing that is not a whole number of pixels in range", async () => {
        const project = projectStore();
        const { service } = await bootService(project, new Map());
        service.setGridSpacing(0);
        service.setGridSpacing(-10);
        service.setGridSpacing(Number.NaN);
        service.setGridSpacing(5000);
        expect(service.getGridSpacing()).toBe(20);
        expect(project.setPanelState).not.toHaveBeenCalled();
    });

    it("reads a damaged stored value as the default", async () => {
        const project = projectStore();
        project.panels.set(UI_EDITOR_GRID_PANEL_STATE_ID, { spacing: "fifty" });
        expect((await bootService(project, new Map())).service.getGridSpacing()).toBe(20);
    });

    it("keeps the Grid toggle with the other snap targets in Studio settings", async () => {
        const globalSettings = new Map<string, unknown>();
        const first = await bootService(projectStore(), globalSettings);
        first.service.patchSmartSnapDetailSettings({ snapGrid: true });
        const second = await bootService(projectStore(), globalSettings);
        expect(second.service.getSmartSnapDetailSettings()).toEqual({
            snapElementLayout: true,
            snapElementBorder: true,
            snapCanvasLayout: true,
            snapGrid: true,
        });
    });
});

describe("UIEditorStateService grid style", () => {
    it("draws lines until the author picks dots", async () => {
        const { service } = await bootService(projectStore(), new Map());
        expect(service.getGridStyle()).toBe("lines");
    });

    it("keeps the style in Studio settings, so it follows the author to another project", async () => {
        const globalSettings = new Map<string, unknown>();
        const project = projectStore();
        const first = await bootService(project, globalSettings);
        const heard: string[] = [];
        first.service.on("gridStyleChanged", style => heard.push(style));

        first.service.setGridStyle("dots");
        first.service.setGridStyle("dots");

        expect(heard).toEqual(["dots"]);
        expect(first.settingsService.set).toHaveBeenCalledTimes(1);
        expect(project.setPanelState).not.toHaveBeenCalled();
        expect((await bootService(projectStore(), globalSettings)).service.getGridStyle()).toBe("dots");
    });

    it("reads a damaged stored style as lines", async () => {
        const globalSettings = new Map<string, unknown>([["uiEditor.grid.style", "hatched"]]);
        expect((await bootService(projectStore(), globalSettings)).service.getGridStyle()).toBe("lines");
    });
});
