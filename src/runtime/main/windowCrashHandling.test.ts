import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { CRASH_LOOP_LIMIT, CRASH_LOOP_WINDOW_MS } from "@shared/utils/crashLoop";
import {
  describeProcessDeath,
  installWindowCrashHandling,
  type WindowCrashHost
} from "./windowCrashHandling";

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
    isDestroyed() {
      return this.destroyed;
    },
    loadURL(url: string) {
      this.loaded.push(url);
      return Promise.resolve();
    },
    reload() {
      this.reloads += 1;
    }
  });
  return win as typeof win & BrowserWindow;
}

function fakeHost(overrides: Partial<WindowCrashHost> = {}) {
  const logged: Array<{ level: string; message: string }> = [];
  const fatal: string[] = [];
  let quits = 0;
  let clock = 1_000_000;
  const host: WindowCrashHost = {
    log: (level, message) => {
      logged.push({ level, message });
    },
    logPath: "C:\\profile\\logs\\game.log",
    displayName: () => "Fixture Game",
    policy: () => "details",
    isQuitting: () => false,
    quit: () => {
      quits += 1;
    },
    reportFatal: (headline) => {
      fatal.push(headline);
    },
    ask: async () => 0,
    now: () => clock,
    ...overrides
  };
  return {
    host,
    logged,
    fatal,
    quits: () => quits,
    advance: (ms: number) => {
      clock += ms;
    }
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
    expect(url.searchParams.get("nlcrash")).toBe(describeProcessDeath("crashed", 2));
  });

  it("goes straight back to the game when the project asked it to", async () => {
    const { host } = fakeHost({ policy: () => "restart" });
    installWindowCrashHandling(win, host);

    win.webContents.emit("render-process-gone", {}, DEAD);
    await vi.waitFor(() => expect(win.loaded).toHaveLength(1));

    // No marker: the page boots the game rather than drawing anything about the crash.
    expect(win.loaded[0]).not.toContain("nlcrash");
  });

  it("ignores the process this reload is itself replacing", async () => {
    // Chromium discards the old page process on a reload we asked for, which arrives here
    // looking exactly like a crash. Acting on it would mean crashing in response to recovery.
    const { host } = fakeHost();
    installWindowCrashHandling(win, host);

    win.webContents.emit("render-process-gone", {}, DEAD);
    await vi.waitFor(() => expect(win.loaded).toHaveLength(1));
    win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(win.loaded).toHaveLength(1);
  });

  it("says nothing about a clean exit, which is a page being replaced normally", () => {
    const { host, logged } = fakeHost();
    installWindowCrashHandling(win, host);

    win.webContents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });

    expect(logged).toHaveLength(0);
  });

  it("stops reloading once the window is clearly not coming back", async () => {
    const { host, fatal, quits } = fakeHost();
    installWindowCrashHandling(win, host);

    for (let attempt = 0; attempt < CRASH_LOOP_LIMIT; attempt++) {
      win.webContents.emit("render-process-gone", {}, DEAD);
      // Each reload swallows one event; a fresh load makes the next death a real one.
      await new Promise((resolve) => setTimeout(resolve, 5));
      win.webContents.emit("did-finish-load");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The crash page is served by the bundle that just died, so a fourth attempt would be the
    // fourth identical death. It reports natively - which names the log - and goes.
    expect(win.loaded).toHaveLength(CRASH_LOOP_LIMIT - 1);
    expect(fatal).toEqual(["The game window stopped working (crashed)."]);
    expect(quits()).toBe(1);
  });

  it("treats deaths spread over an afternoon as separate incidents", async () => {
    const { host, advance, fatal } = fakeHost();
    installWindowCrashHandling(win, host);

    for (let attempt = 0; attempt < 5; attempt++) {
      win.webContents.emit("render-process-gone", {}, DEAD);
      await new Promise((resolve) => setTimeout(resolve, 5));
      win.webContents.emit("did-finish-load");
      advance(CRASH_LOOP_WINDOW_MS + 1);
    }

    expect(fatal).toEqual([]);
    expect(win.loaded).toHaveLength(5);
  });

  it("does nothing while the app is already quitting", async () => {
    const { host } = fakeHost({ isQuitting: () => true });
    installWindowCrashHandling(win, host);

    win.webContents.emit("render-process-gone", {}, DEAD);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(win.loaded).toHaveLength(0);
  });
});

describe("a window that stops answering", () => {
  it("asks once, however many times the hang is reported", async () => {
    const win = fakeWindow();
    const asked: unknown[] = [];
    const { host } = fakeHost({
      ask: async (request) => {
        asked.push(request);
        return new Promise((resolve) => setTimeout(() => resolve(0), 20));
      }
    });
    installWindowCrashHandling(win, host);

    win.emit("unresponsive");
    win.emit("unresponsive");
    await new Promise((resolve) => setTimeout(resolve, 40));

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
      ask: async (request) => {
        asked.push(request);
        return 0;
      }
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

    win.webContents.emit(
      "preload-error",
      {},
      "C:\\app\\preload.js",
      new Error("Cannot find module")
    );

    expect(logged[0].level).toBe("error");
    expect(logged[0].message).toContain("Preload script failed");
    expect(logged[0].message).toContain("Cannot find module");
  });
});
