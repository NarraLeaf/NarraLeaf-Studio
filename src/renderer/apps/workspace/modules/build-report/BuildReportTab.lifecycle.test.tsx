// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameBuildStateSnapshot, LastGameBuildRun } from "@shared/types/gameBuild";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { BuildReportTab } from "./BuildReportTab";

const fixture = vi.hoisted(() => ({ context: null as WorkspaceContext | null }));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: fixture.context, isInitialized: true }) }));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    fixture.context = null;
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function run(name: string): LastGameBuildRun {
    return { kind: "build", appTagName: name, cancelled: false, state: { status: "done", progress: null, artifacts: [] } };
}

describe("build report loading", () => {
    it("keeps the latest finished build when an older read finishes later", async () => {
        const oldRead = deferred<LastGameBuildRun | null>();
        const newRead = deferred<LastGameBuildRun | null>();
        let onChanged!: (state: GameBuildStateSnapshot) => void;
        const buildService = {
            loadLastRun: vi.fn().mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise),
            onStateChanged: (listener: typeof onChanged) => { onChanged = listener; return () => undefined; },
        };
        fixture.context = { services: { get: () => buildService } } as unknown as WorkspaceContext;
        render(<BuildReportTab />);

        act(() => onChanged({ status: "done", progress: null }));
        await act(async () => newRead.resolve(run("New build")));
        await waitFor(() => expect(screen.getByText("New build")).toBeTruthy());
        await act(async () => oldRead.resolve(run("Old build")));

        expect(screen.getByText("New build")).toBeTruthy();
        expect(screen.queryByText("Old build")).toBeNull();
    });

    it("does not display the previous project's report while another project loads", async () => {
        const next = deferred<LastGameBuildRun | null>();
        const service = (loadLastRun: () => Promise<LastGameBuildRun | null>) => ({
            loadLastRun, onStateChanged: () => () => undefined,
        });
        fixture.context = { services: { get: () => service(async () => run("First project")) } } as unknown as WorkspaceContext;
        const view = render(<BuildReportTab />);
        await waitFor(() => expect(screen.getByText("First project")).toBeTruthy());

        fixture.context = { services: { get: () => service(() => next.promise) } } as unknown as WorkspaceContext;
        view.rerender(<BuildReportTab />);
        expect(screen.queryByText("First project")).toBeNull();

        await act(async () => next.resolve(run("Second project")));
        expect(screen.getByText("Second project")).toBeTruthy();
    });

    it("keeps the last report if a refresh fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        let onChanged!: (state: GameBuildStateSnapshot) => void;
        const buildService = {
            loadLastRun: vi.fn().mockResolvedValueOnce(run("Saved build"))
                .mockRejectedValueOnce(new Error("read failed")),
            onStateChanged: (listener: typeof onChanged) => { onChanged = listener; return () => undefined; },
        };
        fixture.context = { services: { get: () => buildService } } as unknown as WorkspaceContext;
        render(<BuildReportTab />);
        await waitFor(() => expect(screen.getByText("Saved build")).toBeTruthy());

        act(() => onChanged({ status: "done", progress: null }));
        await waitFor(() => expect(warn).toHaveBeenCalled());
        expect(screen.getByText("Saved build")).toBeTruthy();
    });
});
