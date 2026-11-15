// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_OPEN_DEFAULT_KEY, getDashboardOpenProjectKey } from "@shared/constants/dashboard";
import { createEmptyProjectStats } from "@shared/types/stats";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { ProjectStatsSnapshot } from "@/lib/workspace/stats/projectStatsSnapshot";
import { DashboardTab } from "./DashboardTab";

const mocks = vi.hoisted(() => ({ context: null as unknown, state: null as unknown, snapshot: vi.fn() }));
vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ app: { state: mocks.state } }) }));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: mocks.context }) }));
vi.mock("@/lib/i18n", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        tn: (key: string) => key,
        formatNumber: (value: number) => String(value),
        formatDate: () => "date",
    }),
}));
vi.mock("@/lib/workspace/stats/projectStatsSnapshot", () => ({
    computeProjectStatsSnapshot: mocks.snapshot,
}));
vi.mock("./LastBuildSection", () => ({ LastBuildSection: () => null }));

type Change = { key: string; value: unknown };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function setup(values: Record<string, unknown>, pendingRead?: ReturnType<typeof deferred<unknown>>) {
    mocks.snapshot.mockImplementation(() => new Promise(() => {}));
    const listeners = new Set<(change: Change) => void>();
    const state = {
        getAllGlobalState: vi.fn(async () => ({ success: true, data: { settings: { ...values } } })),
        getGlobalState: vi.fn(async () => ({
            success: true,
            data: { value: pendingRead ? await pendingRead.promise : undefined },
        })),
        setGlobalState: vi.fn(async () => ({ success: true, data: {} })),
        onGlobalStateChanged: (listener: (change: Change) => void) => {
            listeners.add(listener);
            return { cancel: () => listeners.delete(listener) };
        },
    };
    mocks.state = state;
    const settings = new GlobalSettingsService();
    const project = { projectPath: "/dashboard-test", projectIdentifier: "dashboard-test" };
    const projectKey = getDashboardOpenProjectKey(project);
    const statsStore = { stats: createEmptyProjectStats() };
    const statsService = { getStats: () => statsStore.stats, onChanged: () => () => {} };
    const context = {
        project: { getConfig: () => project },
        services: { get: (key: Services) => {
            if (key === Services.Project) return { getProjectConfig: () => ({ name: "Project", identifier: project.projectIdentifier }) };
            if (key === Services.GlobalSettings) return settings;
            if (key === Services.ProjectStats) return statsService;
            throw new Error(`Unexpected service: ${key}`);
        } },
    } as unknown as WorkspaceContext;
    await settings.initialize(context, async () => {});
    mocks.context = context;
    const emit = (key: string, value: unknown) => {
        act(() => { for (const listener of listeners) listener({ key, value }); });
    };
    return { projectKey, settings, state, emit, statsStore };
}

afterEach(() => { cleanup(); mocks.context = null; mocks.state = null; mocks.snapshot.mockReset(); });

describe("DashboardTab open-on-workspace setting", () => {
    it("inherits the global default after a project override is reset and keeps following it", async () => {
        const projectKey = getDashboardOpenProjectKey({ projectPath: "/dashboard-test", projectIdentifier: "dashboard-test" });
        const { emit } = await setup({ [projectKey]: true, [DASHBOARD_OPEN_DEFAULT_KEY]: false });
        render(<DashboardTab tabId="dashboard" active />);
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");

        emit(projectKey, undefined);
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
        emit(DASHBOARD_OPEN_DEFAULT_KEY, true);
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
        emit(DASHBOARD_OPEN_DEFAULT_KEY, false);
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    });

    it("keeps a choice made while an initial settings read is pending", async () => {
        const pending = deferred<unknown>();
        const { projectKey, state } = await setup({ [DASHBOARD_OPEN_DEFAULT_KEY]: true }, pending);
        render(<DashboardTab tabId="dashboard" active />);
        fireEvent.click(screen.getByRole("switch"));
        expect(state.setGlobalState).toHaveBeenCalledWith(projectKey, false);
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");

        await act(async () => { pending.resolve(undefined); await pending.promise; });
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    });

    it("keeps a project override when the global default changes", async () => {
        const projectKey = getDashboardOpenProjectKey({ projectPath: "/dashboard-test", projectIdentifier: "dashboard-test" });
        const { emit } = await setup({ [projectKey]: false, [DASHBOARD_OPEN_DEFAULT_KEY]: false });
        render(<DashboardTab tabId="dashboard" active />);
        await act(async () => {});
        emit(DASHBOARD_OPEN_DEFAULT_KEY, true);
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    });

    it("disables the project setting when its settings service is unavailable", async () => {
        await setup({});
        const context = mocks.context as WorkspaceContext;
        mocks.context = { ...context, services: { get: (key: Services) => {
            if (key === Services.GlobalSettings) throw new Error("unavailable");
            return context.services.get(key);
        } } };
        render(<DashboardTab tabId="dashboard" active />);
        expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    });

});

describe("DashboardTab project snapshot", () => {
    it("hides the previous project's figures while the next project loads", async () => {
        await setup({});
        const firstContext = mocks.context as WorkspaceContext;
        const first = deferred<ProjectStatsSnapshot>();
        const second = deferred<ProjectStatsSnapshot>();
        mocks.snapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const view = render(<DashboardTab tabId="dashboard" active />);
        await act(async () => {
            first.resolve({
                scale: {
                    stories: 0, chapters: 0, scenes: 12, dialogueLines: 0, narrationLines: 0,
                    choices: 0, totalWords: 0, characters: 0, assets: 0, assetsByType: {},
                    blueprintNodes: 0, uiSurfaces: 0, variables: { scene: 0, saved: 0, persistent: 0 },
                },
                cast: { speakers: [], overflow: null }, structure: { branches: 0 }, localization: [],
            });
            await first.promise;
        });
        expect(screen.getByText("dashboard.scale.scenes").parentElement?.textContent).toContain("12");

        mocks.context = { ...firstContext };
        view.rerender(<DashboardTab tabId="dashboard" active />);
        expect(screen.queryByText("dashboard.scale.scenes")).toBeNull();
        expect(screen.getByText("dashboard.loading")).toBeTruthy();

        await act(async () => {
            second.resolve({ ...await first.promise, scale: { ...(await first.promise).scale, scenes: 7 } });
            await second.promise;
        });
        expect(screen.getByText("dashboard.scale.scenes").parentElement?.textContent).toContain("7");
    });

    it("reads the new project's activity when the stats service instance is reused", async () => {
        const { statsStore } = await setup({});
        const today = new Date();
        const key = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
        statsStore.stats.days[key] = { words: 50, edits: 17, activeSeconds: 60 };
        const view = render(<DashboardTab tabId="dashboard" active />);
        expect(screen.getByText("dashboard.activity.edits").parentElement?.textContent).toContain("17");

        statsStore.stats = createEmptyProjectStats();
        mocks.context = { ...(mocks.context as WorkspaceContext) };
        view.rerender(<DashboardTab tabId="dashboard" active />);
        expect(screen.getByText("dashboard.activity.edits").parentElement?.textContent).toContain("0");
    });
});
