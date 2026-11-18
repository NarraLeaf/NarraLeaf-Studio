// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusManager } from "@/lib/workspace/services/ui/FocusManager";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";

const fixture = vi.hoisted(() => ({
    context: null as unknown,
}));

vi.mock("../context", () => ({ useWorkspace: () => ({ context: fixture.context }) }));
vi.mock("../session/workspaceEditorSession", () => ({
    WORKSPACE_EDITOR_SESSION_SETTINGS_KEY: "legacy",
    getWorkspaceEditorSessionSettingsKey: () => "session-key",
    parseWorkspaceEditorSession: () => null,
    countSessionTabs: () => 0,
    restoreWorkspaceEditorSession: vi.fn(),
    serializeEditorSession: (layout: unknown, activeGroupId: string | null) => ({ layout, activeGroupId }),
}));
const startup = vi.hoisted(() => ({ dashboard: vi.fn() }));
vi.mock("../modules/dashboard/openDashboardTab", () => ({ openDashboardTab: startup.dashboard }));
vi.mock("../modules/welcome/openWelcomeTab", () => ({
    WELCOME_SHOWN_KEY: "welcome-shown",
    openWelcomeTab: vi.fn(),
}));

import { useWorkspaceEditorSession } from "./useWorkspaceEditorSession";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    fixture.context = null;
    startup.dashboard.mockReset();
});

function createWorkspace() {
    const focus = new FocusManager();
    const layout = {
        id: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: { id: "left", tabs: [{ id: "tab-left" }], focus: "tab-left" },
        second: { id: "right", tabs: [{ id: "tab-right" }], focus: "tab-right" },
    };
    const settings = {
        get: vi.fn(async (key: string): Promise<boolean | null> => key === "session-key" ? null : true),
        has: () => true,
        set: vi.fn(async () => undefined),
    };
    const ui = {
        focus,
        getStore: () => ({ getEditorLayout: () => layout }),
        getEvents: () => ({ on: () => () => undefined }),
    };
    fixture.context = {
        project: { getConfig: () => ({ projectPath: "/project" }) },
        services: {
            get: (service: Services) => {
                if (service === Services.UI) return ui;
                if (service === Services.GlobalSettings) return settings;
                if (service === Services.Project) return { getProjectConfig: () => ({ identifier: "project" }) };
                throw new Error(`Unexpected service ${service}`);
            },
        },
    };
    return { focus, layout, settings };
}

describe("workspace editor session focus", () => {
    it("saves the last focused pane even when the editor layout does not change", async () => {
        vi.useFakeTimers();
        const { focus, layout, settings } = createWorkspace();
        renderHook(() => useWorkspaceEditorSession());
        await act(async () => {});
        await act(async () => {
            focus.setFocus(FocusArea.Editor, "tab-right");
            focus.setFocus(FocusArea.LeftPanel, "assets");
            await vi.advanceTimersByTimeAsync(500);
        });

        expect(settings.set).toHaveBeenCalledWith("session-key", {
            layout,
            activeGroupId: "right",
        });
    });

    it("saves a pending session when its owner unmounts", async () => {
        vi.useFakeTimers();
        const { focus, layout, settings } = createWorkspace();
        const view = renderHook(() => useWorkspaceEditorSession());
        await act(async () => {});
        act(() => focus.setFocus(FocusArea.Editor, "tab-right"));
        expect(settings.set).not.toHaveBeenCalled();

        view.unmount();

        expect(settings.set).toHaveBeenCalledWith("session-key", { layout, activeGroupId: "right" });
    });

    it("saves an editor opened while the startup dashboard preference is still loading", async () => {
        vi.useFakeTimers();
        const { focus, layout, settings } = createWorkspace();
        let finishPreference!: (value: boolean) => void;
        const pendingPreference = new Promise<boolean>(resolve => { finishPreference = resolve; });
        settings.get.mockImplementation(async (key: string) => {
            if (key === "session-key") return null;
            if (key === "welcome-shown") return true;
            return pendingPreference;
        });
        renderHook(() => useWorkspaceEditorSession());
        await act(async () => {});
        act(() => focus.setFocus(FocusArea.Editor, "tab-right"));
        await act(async () => {
            finishPreference(false);
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(500);
        });

        expect(settings.set).toHaveBeenCalledWith("session-key", { layout, activeGroupId: "right" });
    });

    it("does not overwrite a session after its restore read fails", async () => {
        vi.useFakeTimers();
        const { focus, settings } = createWorkspace();
        let failRead!: (error: Error) => void;
        const pendingRead = new Promise<boolean | null>((_, reject) => { failRead = reject; });
        settings.get.mockImplementation(() => pendingRead);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        renderHook(() => useWorkspaceEditorSession());
        act(() => focus.setFocus(FocusArea.Editor, "tab-right"));
        await act(async () => {
            failRead(new Error("read failed"));
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(500);
        });

        expect(settings.set).not.toHaveBeenCalled();
        log.mockRestore();
    });
});
