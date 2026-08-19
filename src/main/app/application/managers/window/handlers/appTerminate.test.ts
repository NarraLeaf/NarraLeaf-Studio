import { describe, expect, it } from "vitest";
import { WindowAppType } from "@shared/types/window";
import type { AppWindow } from "../appWindow";
import { AppTerminateHandler } from "./appAction";

/**
 * The app and the windows as this handler uses them. Duck-typed rather than real: building an
 * AppWindow opens a BrowserWindow, and what is being tested is only which of the three exits the
 * handler takes.
 */
function makeApp() {
    const calls: string[] = [];
    const windows: { window: unknown; closed: boolean }[] = [];

    const app = {
        logger: { error: () => undefined, warn: () => undefined },
        windowManager: {
            getWindows: () => windows.map(entry => entry.window),
        },
        crash: () => calls.push("crash"),
        quit: () => calls.push("quit"),
    };

    function addWindow(type: WindowAppType) {
        const entry = { window: null as unknown, closed: false };
        const window = {
            app,
            getApp: () => app,
            getWindowType: () => type,
            isClosed: () => entry.closed,
            forceClose: () => {
                entry.closed = true;
                calls.push(`close:${type}`);
            },
        };
        entry.window = window;
        windows.push(entry);
        return window as unknown as AppWindow;
    }

    return { app, addWindow, calls };
}

describe("AppTerminateHandler", () => {
    const handler = new AppTerminateHandler();

    it("closes only the window that failed while others are open", () => {
        const { addWindow, calls } = makeApp();
        const failing = addWindow(WindowAppType.Workspace);
        addWindow(WindowAppType.Workspace);

        handler.handle(failing, { err: "boom" });

        // The other project keeps its window, and its unsaved work with it.
        expect(calls).toEqual(["close:workspace"]);
    });

    it("ends the app when the failed window is the only one", () => {
        const { addWindow, calls } = makeApp();
        const failing = addWindow(WindowAppType.Launcher);

        handler.handle(failing, { err: "boom" });

        // Nothing behind it to keep, and nothing to explain the failure with either.
        expect(calls).toEqual(["crash"]);
    });

    it("ignores windows that are already gone when counting what is left", () => {
        const { addWindow, calls } = makeApp();
        const other = addWindow(WindowAppType.Workspace);
        const failing = addWindow(WindowAppType.Workspace);
        other.forceClose();
        calls.length = 0;

        handler.handle(failing, { err: "boom" });

        expect(calls).toEqual(["crash"]);
    });

    it("still quits when a renderer asks to terminate without an error", () => {
        const { addWindow, calls } = makeApp();
        const window = addWindow(WindowAppType.Workspace);
        addWindow(WindowAppType.Workspace);

        handler.handle(window, { err: null });

        expect(calls).toEqual(["quit"]);
    });
});
