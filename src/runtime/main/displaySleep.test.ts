import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import type { BrowserWindow } from "electron";
import { installDisplaySleepInhibitor, type DisplaySleepHost } from "./displaySleep";

/**
 * Enough of a window to drive the inhibitor: the three questions it asks, and the events it
 * listens to. The real thing is a display that does or does not blank an hour later, which no test
 * can wait for - what is pinned here is that a block is held exactly while the window is on screen.
 */
function fakeWindow() {
    const win = Object.assign(new EventEmitter(), {
        destroyed: false,
        visible: true,
        minimized: false,
        isDestroyed() {
            return this.destroyed;
        },
        isVisible() {
            return this.visible;
        },
        isMinimized() {
            return this.minimized;
        },
    });
    return win as typeof win & BrowserWindow;
}

function fakeHost(overrides: Partial<DisplaySleepHost> = {}) {
    const held: number[] = [];
    const released: number[] = [];
    const logged: Array<{ level: string; message: string }> = [];
    let nextId = 1;
    const host: DisplaySleepHost = {
        hold: () => {
            const id = nextId++;
            held.push(id);
            return id;
        },
        release: id => { released.push(id); },
        log: (level, message) => { logged.push({ level, message }); },
        ...overrides,
    };
    return { host, held, released, logged };
}

describe("installDisplaySleepInhibitor", () => {
    it("holds a block for a window that is already on screen", () => {
        const win = fakeWindow();
        const { host, held } = fakeHost();
        installDisplaySleepInhibitor(win, host);
        expect(held).toEqual([1]);
    });

    it("waits for the first paint on a window built hidden", () => {
        const win = fakeWindow();
        win.visible = false;
        const { host, held } = fakeHost();
        installDisplaySleepInhibitor(win, host);
        expect(held).toEqual([]);
        win.visible = true;
        win.emit("show");
        expect(held).toEqual([1]);
    });

    it("drops the block while the window is minimised and takes it again on restore", () => {
        const win = fakeWindow();
        const { host, held, released } = fakeHost();
        installDisplaySleepInhibitor(win, host);
        win.minimized = true;
        win.emit("minimize");
        expect(released).toEqual([1]);
        win.minimized = false;
        win.emit("restore");
        expect(held).toEqual([1, 2]);
        expect(released).toEqual([1]);
    });

    it("never stacks a second block", () => {
        const win = fakeWindow();
        const { host, held } = fakeHost();
        installDisplaySleepInhibitor(win, host);
        win.emit("show");
        win.emit("restore");
        expect(held).toEqual([1]);
    });

    it("releases the block when the window goes away", () => {
        const win = fakeWindow();
        const { host, released } = fakeHost();
        installDisplaySleepInhibitor(win, host);
        win.destroyed = true;
        win.emit("closed");
        expect(released).toEqual([1]);
    });

    it("reports a platform that cannot keep the display awake once, then stops asking", () => {
        const win = fakeWindow();
        let attempts = 0;
        const { host, logged } = fakeHost({
            hold: () => {
                attempts += 1;
                throw new Error("no service");
            },
        });
        installDisplaySleepInhibitor(win, host);
        win.emit("show");
        win.emit("restore");
        expect(attempts).toBe(1);
        expect(logged).toHaveLength(1);
        expect(logged[0]?.level).toBe("warning");
        expect(logged[0]?.message).toContain("no service");
    });
});
