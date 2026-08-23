import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handOverWorkspace, type WorkspaceFrame, type WorkspaceHandOverHost } from "./workspaceHandOver";

const FRAME: WorkspaceFrame = {
    bounds: { x: 120, y: 80, width: 1200, height: 800 },
    maximized: false,
    fullScreen: false,
};

/**
 * A hand-over with both windows faked, and a log of everything either of them was asked to do in
 * the order it was asked. The order is the whole subject here, so the log is the assertion.
 */
function scenario(options: {
    frame?: WorkspaceFrame;
    retire?: () => Promise<void>;
    closedReplacement?: () => boolean;
} = {}) {
    const log: string[] = [];
    let loadResult: ((ok: boolean) => void) | undefined;
    let closed: (() => void) | undefined;

    const host: WorkspaceHandOverHost = {
        opener: {
            clearSwitchingStage: () => log.push("opener:scrim-off"),
            captureFrame: () => {
                log.push("opener:frame-read");
                return options.frame ?? FRAME;
            },
            retire: options.retire ?? (async () => {
                log.push("opener:retired");
            }),
        },
        replacement: {
            isClosed: options.closedReplacement ?? (() => false),
            onLoadResult: fn => {
                loadResult = fn;
            },
            onClose: fn => {
                closed = fn;
            },
            adoptFrame: frame => log.push(`replacement:frame-${frame.maximized ? "maximized" : `${frame.bounds.x},${frame.bounds.y}`}`),
            stepAside: () => log.push("replacement:step-aside"),
            show: () => log.push("replacement:shown"),
            enterFullScreen: () => log.push("replacement:full-screen"),
        },
        timeoutMs: 30_000,
        onTimeout: () => log.push("timed-out"),
    };

    handOverWorkspace(host);

    return {
        log,
        reportLoaded: (ok: boolean) => loadResult?.(ok),
        closeReplacement: () => closed?.(),
    };
}

describe("handOverWorkspace", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows nothing while the replacement is still loading", () => {
        const run = scenario();

        expect(run.log).toEqual([]);
    });

    it("closes the window being replaced before the replacement is shown", async () => {
        const run = scenario();

        run.reportLoaded(true);
        await vi.runAllTimersAsync();

        // The point of the whole module: never a moment with both windows on screen.
        expect(run.log).toEqual([
            "opener:frame-read",
            "opener:retired",
            "replacement:frame-120,80",
            "replacement:shown",
        ]);
    });

    it("hands over a maximised frame as maximised, and does not ask for bounds", async () => {
        const run = scenario({ frame: { ...FRAME, maximized: true } });

        run.reportLoaded(true);
        await vi.runAllTimersAsync();

        expect(run.log).toContain("replacement:frame-maximized");
    });

    it("goes full screen only once the window is up", async () => {
        const run = scenario({ frame: { ...FRAME, fullScreen: true } });

        run.reportLoaded(true);
        await vi.runAllTimersAsync();

        expect(run.log.slice(-2)).toEqual(["replacement:shown", "replacement:full-screen"]);
    });

    it("keeps the workspace when the project fails to open, and puts the error screen beside it", async () => {
        const run = scenario();

        run.reportLoaded(false);
        await vi.runAllTimersAsync();

        expect(run.log).toEqual([
            "opener:scrim-off",
            "replacement:step-aside",
            "replacement:shown",
        ]);
        expect(run.log).not.toContain("opener:retired");
    });

    it("shows the replacement anyway when it never reports a project", async () => {
        const run = scenario();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(run.log).toEqual(["timed-out", "opener:scrim-off", "replacement:shown"]);
    });

    it("stops waiting once the answer has arrived", async () => {
        const run = scenario();

        run.reportLoaded(true);
        await vi.runAllTimersAsync();

        expect(run.log).not.toContain("timed-out");
    });

    it("lifts the scrim when the replacement dies before it ever loaded", async () => {
        const run = scenario();

        run.closeReplacement();
        await vi.runAllTimersAsync();

        expect(run.log).toEqual(["opener:scrim-off"]);
    });

    it("leaves a replacement that closed during the close alone", async () => {
        let closed = false;
        const run = scenario({
            closedReplacement: () => closed,
            retire: async () => {
                closed = true;
            },
        });

        run.reportLoaded(true);
        await vi.runAllTimersAsync();

        expect(run.log).toEqual(["opener:frame-read"]);
    });

    it("still shows the replacement when the close it was waiting on failed", async () => {
        const run = scenario({
            retire: async () => {
                throw new Error("the checkpoint failed");
            },
        });

        run.reportLoaded(true);
        await vi.runAllTimersAsync();

        // A close that threw is not a reason to leave the author with no window at all.
        expect(run.log).toEqual(["opener:frame-read", "replacement:frame-120,80", "replacement:shown"]);
    });
});
