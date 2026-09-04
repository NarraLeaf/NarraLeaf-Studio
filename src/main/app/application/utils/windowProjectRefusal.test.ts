import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitWorkspaceConsoleLog = vi.fn();

// The console helper is doubled rather than driven: where a line lands once it has a project is
// `findWorkspaceForProject`'s own question, already answered where that lookup lives. What is under
// test here is which project is handed to it, what the line says, and how often it is written.
vi.mock("./workspaceConsole", () => ({
    emitWorkspaceConsoleLog: (...args: unknown[]) => emitWorkspaceConsoleLog(...args),
}));

const { reportWindowProjectRefusal, resetWindowProjectRefusalReporting } =
    await import("./windowProjectRefusal");

type Window = Parameters<typeof reportWindowProjectRefusal>[0];

const MINE = "D:/games/mine";
const THEIRS = "D:/games/theirs";

const warn = vi.fn();

/** A window on a project, with the two things the reporter reads: its props and its web contents. */
function windowOn(projectPath: string | undefined, webContentsId = 1): Window {
    return {
        getProps: () => (projectPath === undefined ? {} : { projectPath }),
        getApp: () => ({ logger: { warn } }),
        getWebContents: () => ({ id: webContentsId }),
    } as unknown as Window;
}

function lastLine(): { level: string; source: string; message: string } {
    return emitWorkspaceConsoleLog.mock.calls.at(-1)![2] as never;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));
    emitWorkspaceConsoleLog.mockClear();
    warn.mockClear();
    resetWindowProjectRefusalReporting();
});

afterEach(() => {
    vi.useRealTimers();
});

/**
 * Where a refusal goes when nobody is waiting for one.
 *
 * The guard has always answered the caller. That is enough for a button, which can put the refusal
 * on screen, and worth nothing for a status poll, a watcher, or a save flush on the way into a run -
 * the operation does not happen and the return value is dropped. This is the half that makes such a
 * refusal findable.
 */
describe("reportWindowProjectRefusal", () => {
    it("writes to the console of the window's own project, as an error", () => {
        reportWindowProjectRefusal(windowOn(MINE), "vcs.restoreRevision");

        expect(emitWorkspaceConsoleLog).toHaveBeenCalledTimes(1);
        expect(emitWorkspaceConsoleLog.mock.calls[0][1]).toBe(MINE);
        expect(lastLine().level).toBe("error");
    });

    /** The request is the half that says what did not happen, so the line is useless without it. */
    it("names the request that was refused", () => {
        reportWindowProjectRefusal(windowOn(MINE), "vcs.abortMerge");

        expect(lastLine().message).toContain("vcs.abortMerge");
    });

    /**
     * The property this line has to have. The path that was named belongs to something the author of
     * this window is not editing; printed in their console it reads as part of their own project,
     * and it would turn every window into a way of learning where other projects live.
     */
    it("never puts the project that was named into the line", () => {
        reportWindowProjectRefusal(windowOn(MINE), "vcs.restoreRevision");

        expect(lastLine().message).not.toContain(THEIRS);
        expect(JSON.stringify(emitWorkspaceConsoleLog.mock.calls)).not.toContain(THEIRS);
    });

    /**
     * A window with no project has no console of its own, and no author whose project this would be.
     * The application log still records it, because a request naming a project from the launcher or
     * settings is a renderer that has gone wrong and somebody will eventually want to know.
     */
    it("writes only to the application log for a window with no project", () => {
        reportWindowProjectRefusal(windowOn(undefined), "vcs.abortMerge");

        expect(emitWorkspaceConsoleLog).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    /**
     * Two of the guarded channels are polled once a second. Without this, a renderer stuck asking
     * about the wrong project writes a line a second for as long as it is open, and a console that
     * fills with one repeated sentence is a console the author stops reading - which costs more than
     * the lines are worth.
     */
    it("writes one line for a request repeated inside the interval", () => {
        const window = windowOn(MINE);
        for (let i = 0; i < 60; i++) {
            reportWindowProjectRefusal(window, "devMode.getStatus");
        }

        expect(emitWorkspaceConsoleLog).toHaveBeenCalledTimes(1);
    });

    /** Suppressed is not lost: the next line says how many it stands for. */
    it("counts what it folded into the next line", () => {
        const window = windowOn(MINE);
        reportWindowProjectRefusal(window, "devMode.getStatus");
        reportWindowProjectRefusal(window, "devMode.getStatus");
        reportWindowProjectRefusal(window, "devMode.getStatus");

        vi.advanceTimersByTime(60_000);
        reportWindowProjectRefusal(window, "devMode.getStatus");

        expect(emitWorkspaceConsoleLog).toHaveBeenCalledTimes(2);
        expect(lastLine().message).toContain("2 more");
    });

    /** A first line has nothing to stand for, and must not claim to. */
    it("says nothing about a count when there is none", () => {
        reportWindowProjectRefusal(windowOn(MINE), "devMode.getStatus");

        expect(lastLine().message).not.toContain("more like it");
    });

    /**
     * The throttle is per request and per window, not per process: a second channel refusing, or a
     * second window refusing, is a different fact and has to be able to say so while the first is
     * still inside its interval.
     */
    it("throttles each request and each window separately", () => {
        reportWindowProjectRefusal(windowOn(MINE), "devMode.getStatus");
        reportWindowProjectRefusal(windowOn(MINE), "devMode.stop");
        reportWindowProjectRefusal(windowOn(MINE, 2), "devMode.getStatus");

        expect(emitWorkspaceConsoleLog).toHaveBeenCalledTimes(3);
    });
});
