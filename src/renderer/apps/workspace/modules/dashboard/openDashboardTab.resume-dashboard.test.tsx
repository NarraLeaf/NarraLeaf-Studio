import { describe, expect, it, vi } from "vitest";
import { EditorService } from "@/lib/workspace/services/ui/EditorService";
import { UIStore } from "@/lib/workspace/services/ui/UIStore";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { DASHBOARD_TAB_ID } from "./dashboardTabId";
import { createDashboardTab, openDashboardTab } from "./openDashboardTab";
import { dashboardPanelModule } from "./index";

vi.mock("@/lib/i18n", () => ({ translate: (key: string) => key }));
vi.mock("./DashboardTab", () => ({ DashboardTab: () => null }));

describe("dashboard tab entry", () => {
    it("opens once in the current group and can focus it through the rail action", () => {
        const store = new UIStore();
        const editor = new EditorService(store);
        const context = { services: { get: () => ({ editor }) } } as unknown as WorkspaceContext;
        editor.open({ id: "other", title: "Other", component: () => null });
        openDashboardTab(context, { activate: false });
        let layout = store.getEditorLayout();
        if (!("tabs" in layout)) throw new Error("Expected one editor group");
        expect(layout.focus).toBe("other");
        expect(layout.tabs.filter(tab => tab.id === DASHBOARD_TAB_ID)).toHaveLength(1);

        dashboardPanelModule.railAction?.(context);
        layout = store.getEditorLayout();
        if (!("tabs" in layout)) throw new Error("Expected one editor group");
        expect(layout.focus).toBe(DASHBOARD_TAB_ID);
        expect(layout.tabs.filter(tab => tab.id === DASHBOARD_TAB_ID)).toHaveLength(1);
        expect(createDashboardTab().closable).toBe(true);
    });
});
