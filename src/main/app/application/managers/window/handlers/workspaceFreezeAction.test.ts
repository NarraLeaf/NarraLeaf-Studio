import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { forgetWorkspaceFreeze, getWorkspaceFreeze } from "../../../utils/workspaceFreeze";
import type { AppWindow } from "../appWindow";
import { WorkspaceReportWriteFreezeHandler } from "./workspaceFreezeAction";

const PROJECT = path.resolve(path.join("/nonexistent", "freeze-handler-project"));

/**
 * A window as this handler uses one. Duck-typed rather than a real AppWindow: building one opens a
 * BrowserWindow, and the only two things being tested are which project the report is keyed by and
 * when the record is dropped.
 */
function makeWindow(projectPath?: string) {
    const closeListeners: (() => void)[] = [];
    return {
        getProps: () => ({ projectPath }),
        onEvent(event: string, fn: () => void) {
            if (event === "closed") {
                closeListeners.push(fn);
            }
            return { cancel: () => undefined };
        },
        /** Fire the real "closed" event - the one that only happens when the window is truly gone. */
        emitClosed() {
            for (const listener of [...closeListeners]) {
                listener();
            }
        },
        closeListenerCount: () => closeListeners.length,
    };
}

afterEach(() => {
    forgetWorkspaceFreeze(PROJECT);
});

describe("WorkspaceReportWriteFreezeHandler", () => {
    const handler = new WorkspaceReportWriteFreezeHandler();

    it("records the freeze against the window's own project", () => {
        const window = makeWindow(PROJECT);
        handler.handle(window as unknown as AppWindow, { reason: "revision" });

        expect(getWorkspaceFreeze(PROJECT)).toBe("revision");
    });

    it("clears the record when the workspace reports it is writable again", () => {
        const window = makeWindow(PROJECT);
        handler.handle(window as unknown as AppWindow, { reason: "manual" });
        handler.handle(window as unknown as AppWindow, { reason: null });

        expect(getWorkspaceFreeze(PROJECT)).toBeNull();
    });

    it("forgets the freeze once the window is closed", () => {
        // Nothing in main can clear this on its own, so a project reopened later would otherwise
        // inherit a freeze nobody could see and its builds would refuse forever.
        const window = makeWindow(PROJECT);
        handler.handle(window as unknown as AppWindow, { reason: "revision" });
        window.emitClosed();

        expect(getWorkspaceFreeze(PROJECT)).toBeNull();
    });

    it("subscribes to the close once, however many times the freeze toggles", () => {
        const window = makeWindow(PROJECT);
        for (let i = 0; i < 12; i++) {
            handler.handle(window as unknown as AppWindow, { reason: i % 2 === 0 ? "revision" : null });
        }
        // One listener per report would earn a MaxListenersExceededWarning for twelve copies of one
        // idempotent delete.
        expect(window.closeListenerCount()).toBe(1);
    });

    it("ignores a window that has no project to freeze", () => {
        const window = makeWindow(undefined);

        expect(() => handler.handle(window as unknown as AppWindow, { reason: "revision" })).not.toThrow();
        expect(window.closeListenerCount()).toBe(0);
    });
});
