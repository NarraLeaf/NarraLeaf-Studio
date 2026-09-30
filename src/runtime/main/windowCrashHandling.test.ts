import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { CRASH_LOOP_LIMIT, CRASH_LOOP_WINDOW_MS } from "@shared/utils/crashLoop";
import { resolveShellText } from "./shellText";
import { describeProcessDeath, installWindowCrashHandling, type WindowCrashHost } from "./windowCrashHandling";

/**
 * Enough of a window to drive the handlers: the two emitters they subscribe to, and the two calls
 * they make. The real thing is exercised by killing a renderer for real; this is here so the
 * decisions - which URL, how many times, when to stop - stay pinned without an Electron process.
 */
function fakeWindow() {
    const webContents = new EventEmitter();
    const win = Object.assign(new EventEmitter(), {
        webContents,
        destroyed: false,
        loaded: [] as string[],
        reloads: 0,
        /** What the next `loadURL` settles with: nothing, or the error it rejects with. */
        nextLoadError: null as Error | null,
        isDestroyed() {
            return this.destroyed;
        },
        loadURL(url: string) {
            this.loaded.push(url);
            const error = this.nextLoadError;
            this.nextLoadError = null;
            return error ? Promise.reject(error) : Promise.resolve();
        },
        reload() {
            this.reloads += 1;
        },
    });
    return win as typeof win & BrowserWindow;
}

function fakeHost(overrides: Partial<WindowCrashHost> = {}) {
    const logged: Array<{ level: string; message: string }> = [];
    /** Every time the game was ended as a crash, by headline. */
    const crashed: string[] = [];
    /** Every time the game was ended as a launch that did not start. */
    const notStarted: Array<{ reason: string; headline: string }> = [];
    let clock = 1_000_000;
    const host: WindowCrashHost = {
        log: (level, message) => { logged.push({ level, message }); },
        logPath: "C:\\profile\\logs\\game.log",
        displayName: () => "Fixture Game",
        // No tags, so the English table: the wording under test is the English one, and a fixture
        // that followed the machine would say something different on a Japanese build agent.
        text: resolveShellText([]),
        policy: () => "details",
        isQuitting: () => false,
        failedToStart: (reason, headline) => { notStarted.push({ reason, headline }); },
        endAfterCrash: headline => { crashed.push(headline); },
        ask: async () => 0,
        now: () => clock,
        ...overrides,
    };
    return {
        host,
        logged,
        crashed,
        notStarted,
        advance: (ms: number) => { clock += ms; },
    };
}

const DEAD = { reason: "crashed", exitCode: 2 };

describe("a renderer that dies outright", () => {
    let win: ReturnType<typeof fakeWindow>;

    beforeEach(() => {
        win = fakeWindow();
    });

    it("records it, because this is the only place the failure exists", async () => {
        const { host, logged } = fakeHost();
        installWindowCrashHandling(win, host);

        win.webContents.emit("render-process-gone", {}, DEAD);
        await vi.waitFor(() => expect(win.loaded).toHaveLength(1));

        expect(logged[0]).toMatchObject({ level: "error" });
        expect(logged[0].message).toContain("renderer exited: crashed (exit code 2)");
    });

    it("takes the window back to the crash screen, carrying the reason", async () => {
        const { host } = fakeHost();
        installWindowCrashHandling(win, host);

        win.webContents.emit("render-process-gone", {}, DEAD);
        await vi.waitFor(() => expect(win.loaded).toHaveLength(1));

        const url = new URL(win.loaded[0]);
        expect(url.pathname).toBe("/index.html");
        expect(url.searchParams.get("nlcrash")).toBe(describeProcessDeath(resolveShellText([]), "crashed", 2));
        // Both go back on the address, because the page that draws this has no preload to ask and
        // the log is the one thing the player can act on.
        expect(url.searchParams.get("nlpolicy")).toBe("details");
        expect(url.searchParams.get("nllog")).toBe(host.logPath);
    });

    it("goes straight back to the game when the project asked it to", async () => {
        const { host } = fakeHost({ policy: () => "restart" });
        installWindowCrashHandling(win, host);

        win.webContents.emit("render-process-gone", {}, DEAD);
        await vi.waitFor(() => expect(win.loaded).toHaveLength(1));

        // No marker: the page boots the game rather than drawing anything about the crash.
        expect(win.loaded[0]).not.toContain("nlcrash");
        // The policy still travels. Without it the fresh page would answer "show the error" at the
        // next crash, in the build whose author asked for the opposite.
        expect(new URL(win.loaded[0]).searchParams.get("nlpolicy")).toBe("restart");
    });

    it("ignores the process this reload is itself replacing", async () => {
        // Chromium discards the old page process on a reload we asked for, which arrives here
        // looking exactly like a crash. Acting on it would mean crashing in response to recovery.
        const { host } = fakeHost();
        installWindowCrashHandling(win, host);

        win.webContents.emit("render-process-gone", {}, DEAD);
        await vi.waitFor(() => expect(win.loaded).toHaveLength(1));
        win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 0 });
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(win.loaded).toHaveLength(1);
    });

    it("says nothing about a clean exit, which is a page being replaced normally", () => {
        const { host, logged } = fakeHost();
        installWindowCrashHandling(win, host);

        win.webContents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });

        expect(logged).toHaveLength(0);
    });

    it("stops reloading once the window is clearly not coming back, and ends the game as crashed", async () => {
        const { host, crashed, notStarted } = fakeHost();
        installWindowCrashHandling(win, host);

        for (let attempt = 0; attempt < CRASH_LOOP_LIMIT; attempt++) {
            win.webContents.emit("render-process-gone", {}, DEAD);
            // Each reload swallows one event; a fresh load makes the next death a real one.
            await new Promise(resolve => setTimeout(resolve, 5));
            win.webContents.emit("did-finish-load");
        }
        await new Promise(resolve => setTimeout(resolve, 10));

        // The crash page is served by the bundle that just died, so a fourth attempt would be the
        // fourth identical death. It ends as a crash - stores out, the box naming the log, exit 4 -
        // rather than the ordinary quit it used to be, which told a launcher the game was closed.
        expect(win.loaded).toHaveLength(CRASH_LOOP_LIMIT - 1);
        expect(crashed).toEqual(["The game window stopped working (crashed)."]);
        expect(notStarted).toEqual([]);
    });

    it("treats deaths spread over an afternoon as separate incidents", async () => {
        const { host, advance, crashed } = fakeHost();
        installWindowCrashHandling(win, host);

        for (let attempt = 0; attempt < 5; attempt++) {
            win.webContents.emit("render-process-gone", {}, DEAD);
            await new Promise(resolve => setTimeout(resolve, 5));
            win.webContents.emit("did-finish-load");
            advance(CRASH_LOOP_WINDOW_MS + 1);
        }

        expect(crashed).toEqual([]);
        expect(win.loaded).toHaveLength(5);
    });

    it("does nothing while the app is already quitting", async () => {
        const { host } = fakeHost({ isQuitting: () => true });
        installWindowCrashHandling(win, host);

        win.webContents.emit("render-process-gone", {}, DEAD);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(win.loaded).toHaveLength(0);
    });
});

describe("a window that stops answering", () => {
    it("asks once, however many times the hang is reported", async () => {
        const win = fakeWindow();
        const asked: unknown[] = [];
        const { host } = fakeHost({
            ask: async request => {
                asked.push(request);
                return new Promise(resolve => setTimeout(() => resolve(0), 20));
            },
        });
        installWindowCrashHandling(win, host);

        win.emit("unresponsive");
        win.emit("unresponsive");
        await new Promise(resolve => setTimeout(resolve, 40));

        // A stack of identical dialogs in front of a frozen window is worse than the freeze.
        expect(asked).toHaveLength(1);
    });

    it("reloads when that is the answer", async () => {
        const win = fakeWindow();
        const { host } = fakeHost({ ask: async () => 1 });
        installWindowCrashHandling(win, host);

        win.emit("unresponsive");
        await vi.waitFor(() => expect(win.reloads).toBe(1));
    });

    it("restarts without asking when the project asked it to", async () => {
        const win = fakeWindow();
        const asked: unknown[] = [];
        const { host } = fakeHost({
            policy: () => "restart",
            ask: async request => { asked.push(request); return 0; },
        });
        installWindowCrashHandling(win, host);

        win.emit("unresponsive");
        await vi.waitFor(() => expect(win.reloads).toBe(1));
        expect(asked).toEqual([]);
    });
});

describe("a preload that never ran", () => {
    it("is recorded, because the page would just look like a game that does not start", () => {
        const win = fakeWindow();
        const { host, logged } = fakeHost();
        installWindowCrashHandling(win, host);

        win.webContents.emit("preload-error", {}, "C:\\app\\preload.js", new Error("Cannot find module"));

        expect(logged[0].level).toBe("error");
        expect(logged[0].message).toContain("Preload script failed");
        expect(logged[0].message).toContain("Cannot find module");
    });
});

/**
 * The game's page not loading into its window.
 *
 * The game's protocol answers a page it cannot read with 404 rather than failing the request, and
 * Chromium treats that as a page that loaded - `did-finish-load`, a resolved `loadURL`, "Not found"
 * in the window - so the status on `did-navigate` is the only sign of it; a request that fails
 * outright arrives as `did-fail-load` and a rejected `loadURL` (both measured on Electron 38). Either
 * way it used to leave the player a window with nothing in it, running until killed.
 */
describe("a page that will not load", () => {
    const GAME_PAGE = "nlgame://runtime/index.html?nlpolicy=details";

    function loadedGame() {
        const win = fakeWindow();
        const probe = fakeHost();
        const handle = installWindowCrashHandling(win, probe.host);
        return { win, handle, ...probe };
    }

    it("is a launch that did not start when the first page answers with an error status", () => {
        const { win, notStarted, crashed } = loadedGame();
        win.webContents.emit("did-navigate", {}, GAME_PAGE, 404, "Not Found");

        expect(notStarted).toEqual([{
            reason: "could not start: the game's page could not be loaded: 404 Not Found",
            headline: "The game window stopped working (404 Not Found).",
        }]);
        expect(crashed).toEqual([]);
    });

    it("is a launch that did not start when the first page's request fails", () => {
        const { win, notStarted } = loadedGame();
        win.webContents.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", GAME_PAGE, true);
        expect(notStarted.map(entry => entry.reason)).toEqual([
            "could not start: the game's page could not be loaded: ERR_FILE_NOT_FOUND (-6)",
        ]);
    });

    it("decides once, though one failure arrives as several signals", () => {
        // `did-fail-load`, then the error page's own `did-finish-load`, then the rejected `loadURL`.
        const { win, handle, notStarted } = loadedGame();
        win.webContents.emit("did-fail-load", {}, -2, "ERR_FAILED", GAME_PAGE, true);
        win.webContents.emit("did-finish-load");
        handle.loadRejected(Object.assign(new Error("ERR_FAILED (-2) loading 'nlgame://runtime/index.html'"), { errno: -2 }));
        expect(notStarted).toHaveLength(1);
    });

    it("takes a load that stopped without either event from the rejected loadURL alone", () => {
        const { handle, notStarted } = loadedGame();
        handle.loadRejected(Object.assign(new Error("ERR_FAILED (-2) loading 'nlgame://runtime/index.html'"), { errno: -2 }));
        expect(notStarted).toHaveLength(1);
    });

    it("is a crash once the game's page had loaded: a later load that fails ends it with the crash code", () => {
        const { win, notStarted, crashed, logged } = loadedGame();
        win.webContents.emit("did-navigate", {}, GAME_PAGE, 200, "OK");
        win.webContents.emit("did-navigate", {}, GAME_PAGE, 404, "Not Found");

        expect(notStarted).toEqual([]);
        expect(crashed).toEqual(["The game window stopped working (404 Not Found)."]);
        expect(logged.at(-1)?.message).toBe("[Crash] The game's page could not be loaded again: 404 Not Found");
    });

    it("ends the game as crashed when the reload after a renderer death fails, as the crash loop does", async () => {
        const { win, crashed } = loadedGame();
        win.webContents.emit("did-navigate", {}, GAME_PAGE, 200, "OK");
        win.nextLoadError = Object.assign(new Error("ERR_FAILED (-2)"), { errno: -2 });
        win.webContents.emit("render-process-gone", {}, DEAD);

        await vi.waitFor(() => expect(crashed).toEqual(["The game window stopped working (ERR_FAILED (-2))."]));
    });

    it("is not a failure when a load was replaced by another navigation", () => {
        // A reload started while the first load was still going ends the first one with ERR_ABORTED;
        // the reload carries on and has its own outcome.
        const { win, handle, notStarted, crashed } = loadedGame();
        win.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", GAME_PAGE, true);
        handle.loadRejected(Object.assign(new Error("ERR_ABORTED (-3)"), { errno: -3 }));
        expect(notStarted).toEqual([]);
        expect(crashed).toEqual([]);
    });

    it("leaves a frame inside the page, and a page outside the game, alone", () => {
        const { win, notStarted, crashed, logged } = loadedGame();
        win.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", GAME_PAGE, false);
        win.webContents.emit("did-fail-load", {}, -20, "ERR_BLOCKED_BY_CLIENT", "https://example.com/", true);
        win.webContents.emit("did-navigate", {}, "https://example.com/", 404, "Not Found");

        expect(notStarted).toEqual([]);
        expect(crashed).toEqual([]);
        // Recorded, without the address the page was sent to.
        expect(logged.map(entry => entry.message)).toEqual([
            "[Crash] The game window was sent to a page outside the game that did not load: ERR_BLOCKED_BY_CLIENT (-20)",
        ]);
    });

    it("does nothing while the game is already quitting", () => {
        const win = fakeWindow();
        const { host, notStarted } = fakeHost({ isQuitting: () => true });
        installWindowCrashHandling(win, host);
        win.webContents.emit("did-navigate", {}, GAME_PAGE, 404, "Not Found");
        expect(notStarted).toEqual([]);
    });
});
