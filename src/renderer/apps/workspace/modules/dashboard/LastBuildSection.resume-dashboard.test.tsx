// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameBuildStateSnapshot, LastGameBuildRun } from "@shared/types/gameBuild";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { LastBuildSection } from "./LastBuildSection";

vi.mock("@/lib/i18n", () => ({
    useTranslation: () => ({ t: (key: string) => key, formatNumber: (value: number) => String(value) }),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function run(name: string): LastGameBuildRun {
    return { kind: "build", appTagName: name, cancelled: false, state: { status: "done", progress: null } };
}

afterEach(cleanup);

describe("LastBuildSection", () => {
    it("keeps the latest finished build when an earlier read resolves later", async () => {
        const first = deferred<LastGameBuildRun | null>();
        const second = deferred<LastGameBuildRun | null>();
        let notify!: (state: GameBuildStateSnapshot) => void;
        const service = {
            loadLastRun: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
            onStateChanged: (listener: typeof notify) => { notify = listener; return () => {}; },
        };
        const context = { services: { get: () => service } } as unknown as WorkspaceContext;
        render(<LastBuildSection context={context} />);
        act(() => notify({ status: "done", progress: null }));
        await act(async () => { second.resolve(run("New build")); await second.promise; });
        expect(screen.getByText("New build")).toBeTruthy();

        await act(async () => { first.resolve(run("Old build")); await first.promise; });
        expect(screen.getByText("New build")).toBeTruthy();
        expect(screen.queryByText("Old build")).toBeNull();
    });

    it("hides the previous project's build while the new project's record loads", async () => {
        const next = deferred<LastGameBuildRun | null>();
        const makeContext = (loadLastRun: () => Promise<LastGameBuildRun | null>) => ({
            services: { get: () => ({ loadLastRun, onStateChanged: () => () => {} }) },
        }) as unknown as WorkspaceContext;
        const view = render(<LastBuildSection context={makeContext(async () => run("First project"))} />);
        expect(await screen.findByText("First project")).toBeTruthy();

        view.rerender(<LastBuildSection context={makeContext(() => next.promise)} />);
        expect(screen.queryByText("First project")).toBeNull();
        await act(async () => { next.resolve(run("Second project")); await next.promise; });
        expect(screen.getByText("Second project")).toBeTruthy();
    });

    it("retains the last loaded build and can refresh after a read rejects", async () => {
        const failed = deferred<LastGameBuildRun | null>();
        const retry = deferred<LastGameBuildRun | null>();
        let notify!: (state: GameBuildStateSnapshot) => void;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const service = {
                loadLastRun: vi.fn().mockResolvedValueOnce(run("Saved build"))
                    .mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise),
                onStateChanged: (listener: typeof notify) => { notify = listener; return () => {}; },
            };
            const context = { services: { get: () => service } } as unknown as WorkspaceContext;
            render(<LastBuildSection context={context} />);
            expect(await screen.findByText("Saved build")).toBeTruthy();
            act(() => notify({ status: "done", progress: null }));
            await act(async () => { failed.reject(new Error("read failed")); await failed.promise.catch(() => {}); });
            expect(warn).toHaveBeenCalled();
            expect(screen.getByText("Saved build")).toBeTruthy();

            act(() => notify({ status: "done", progress: null }));
            await act(async () => { retry.resolve(run("Recovered build")); await retry.promise; });
            expect(screen.getByText("Recovered build")).toBeTruthy();
        } finally {
            warn.mockRestore();
        }
    });
});
