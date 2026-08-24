import { describe, expect, it } from "vitest";
import { claimSingleInstance, type SingleInstanceHost, type SingleInstanceWindow } from "./singleInstance";

function fakeWindow(state: Partial<{ destroyed: boolean; minimized: boolean; visible: boolean }> = {}) {
    const calls: string[] = [];
    const win: SingleInstanceWindow & { calls: string[] } = {
        calls,
        isDestroyed: () => state.destroyed === true,
        isMinimized: () => state.minimized === true,
        isVisible: () => state.visible !== false,
        restore: () => { calls.push("restore"); },
        show: () => { calls.push("show"); },
        focus: () => { calls.push("focus"); },
    };
    return win;
}

function fakeHost(overrides: Partial<SingleInstanceHost> = {}) {
    const logged: Array<{ level: string; message: string }> = [];
    let quits = 0;
    let secondInstance: (() => void) | null = null;
    const host: SingleInstanceHost = {
        requestLock: () => true,
        quit: () => { quits += 1; },
        onSecondInstance: listener => { secondInstance = listener; },
        window: () => null,
        log: (level, message) => { logged.push({ level, message }); },
        ...overrides,
    };
    return {
        host,
        logged,
        quits: () => quits,
        launchAnother: () => secondInstance?.(),
        listening: () => secondInstance !== null,
    };
}

describe("claimSingleInstance", () => {
    it("stands down when another copy holds the lock", () => {
        const fake = fakeHost({ requestLock: () => false });
        expect(claimSingleInstance(fake.host)).toBe(false);
        expect(fake.quits()).toBe(1);
        expect(fake.listening()).toBe(false);
        expect(fake.logged).toHaveLength(1);
    });

    it("keeps running when it takes the lock", () => {
        const fake = fakeHost();
        expect(claimSingleInstance(fake.host)).toBe(true);
        expect(fake.quits()).toBe(0);
        expect(fake.logged).toEqual([]);
    });

    it("raises a window that is merely behind others", () => {
        const win = fakeWindow();
        const fake = fakeHost({ window: () => win });
        claimSingleInstance(fake.host);
        fake.launchAnother();
        expect(win.calls).toEqual(["focus"]);
    });

    it("restores a minimised window", () => {
        const win = fakeWindow({ minimized: true, visible: false });
        const fake = fakeHost({ window: () => win });
        claimSingleInstance(fake.host);
        fake.launchAnother();
        expect(win.calls).toEqual(["restore", "show", "focus"]);
    });

    it("shows a hidden window", () => {
        const win = fakeWindow({ visible: false });
        const fake = fakeHost({ window: () => win });
        claimSingleInstance(fake.host);
        fake.launchAnother();
        expect(win.calls).toEqual(["show", "focus"]);
    });

    it("has nothing to raise while the window is gone", () => {
        const win = fakeWindow({ destroyed: true });
        const fake = fakeHost({ window: () => win });
        claimSingleInstance(fake.host);
        fake.launchAnother();
        expect(win.calls).toEqual([]);
        const noWindow = fakeHost({ window: () => null });
        claimSingleInstance(noWindow.host);
        expect(() => noWindow.launchAnother()).not.toThrow();
    });
});
