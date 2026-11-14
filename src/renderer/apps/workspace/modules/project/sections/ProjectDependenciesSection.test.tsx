// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDependencyResolution } from "@shared/types/pluginDependencies";
import { ProjectDependenciesSection } from "./ProjectDependenciesSection";
import type { ProjectSectionProps } from "./types";

const mocks = vi.hoisted(() => ({
    context: null as unknown,
    rescan: vi.fn(),
}));

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: mocks.context }) }));
vi.mock("@/lib/plugins/rescanDependencies", () => ({ rescanProjectDependencies: mocks.rescan }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        tn: (key: string) => key,
        formatList: (items: string[]) => items.join(", "),
        locale: "en",
    }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "frozen") };
});

afterEach(() => {
    cleanup();
    mocks.rescan.mockReset();
});

const empty: ProjectDependencyResolution = { entries: [], suppressedPluginIds: [], overall: "ok" };
const current: ProjectDependencyResolution = {
    entries: [{
        dependency: { id: "example.plugin", name: "Example plugin", authoredVersion: "1.0.0", builtIn: false, hard: true, usedBy: {} },
        status: "satisfied",
        suppressed: false,
    }],
    suppressedPluginIds: [],
    overall: "ok",
};

function mount(previewResolve: () => Promise<ProjectDependencyResolution>) {
    let resolution = empty;
    let listener: () => void = () => undefined;
    const service = {
        getResolution: () => resolution,
        previewResolve,
        onResolutionChanged: (next: () => void) => { listener = next; return () => undefined; },
    };
    mocks.context = { services: { get: () => service } };
    const notify = vi.fn();
    render(<ProjectDependenciesSection {...({ uiService: { showNotification: notify } } as unknown as ProjectSectionProps)} />);
    return {
        notify,
        publish(next: ProjectDependencyResolution) {
            resolution = next;
            act(() => listener());
        },
    };
}

describe("ProjectDependenciesSection", () => {
    it("keeps a newer resolution when the opening preview finishes later", async () => {
        let finishPreview!: (value: ProjectDependencyResolution) => void;
        const page = mount(() => new Promise(resolve => { finishPreview = resolve; }));

        page.publish(current);
        expect(screen.getByText("Example plugin")).toBeTruthy();
        await act(async () => { finishPreview(empty); });

        expect(screen.getByText("Example plugin")).toBeTruthy();
    });

    it("reports a failed rescan to the author", async () => {
        const page = mount(() => Promise.resolve(empty));
        await waitFor(() => expect((screen.getByRole("button", { name: "project.dependencies.rescan" }) as HTMLButtonElement).disabled).toBe(false));
        mocks.rescan.mockRejectedValueOnce(new Error("disk full"));

        fireEvent.click(screen.getByRole("button", { name: "project.dependencies.rescan" }));

        await waitFor(() => expect(page.notify).toHaveBeenCalledWith("disk full", "error"));
    });
});
