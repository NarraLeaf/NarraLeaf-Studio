import { describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import {
    DISTRUSTED_OPERATIONS,
    refuseDistrustedWindow,
    projectDistrustedMessage,
    projectDistrustedRefusal,
    refuseDistrustedOperation,
} from "./projectTrustGate";

const emitWorkspaceConsoleLog = vi.hoisted(() => vi.fn());
vi.mock("./workspaceConsole", () => ({ emitWorkspaceConsoleLog }));

function host(trusted: boolean) {
    return { projectTrustManager: { isTrusted: () => trusted } } as never;
}

/**
 * Every operation a distrusted project is refused.
 *
 * Taken from the source list rather than restated, so an operation added there is exercised here
 * the moment it exists. A hand-kept copy would have quietly stopped covering the media probe and
 * the remote asset download, both of which were added after it was written.
 */
const REFUSED = DISTRUSTED_OPERATIONS;

describe("project trust gate", () => {
    it.each(REFUSED)("refuses %s for a distrusted project", operation => {
        expect(projectDistrustedRefusal(host(false), "D:/games/theirs", operation)).toContain(operation);
    });

    it.each(REFUSED)("allows %s for a trusted project", operation => {
        expect(projectDistrustedRefusal(host(true), "D:/games/mine", operation)).toBeNull();
    });

    it("says what is true now and what to do, not why the mechanism exists", () => {
        const message = projectDistrustedMessage("preview");
        expect(message).toContain("not trusted");
        expect(message).toContain("Settings");
    });

    it("puts the refusal where the author is looking", () => {
        // Several of these are started by something other than a click - a watcher relaunching a
        // preview, the bake settling after a project opens - so a silent refusal reads as Studio
        // quietly not working.
        emitWorkspaceConsoleLog.mockClear();
        refuseDistrustedOperation(host(false), "D:/games/theirs", "preview");
        expect(emitWorkspaceConsoleLog).toHaveBeenCalledOnce();
        expect(emitWorkspaceConsoleLog.mock.calls[0][2]).toMatchObject({ level: "error", source: "Trust" });
    });

    it("says nothing when it is not refusing", () => {
        emitWorkspaceConsoleLog.mockClear();
        expect(refuseDistrustedOperation(host(true), "D:/games/mine", "preview")).toBeNull();
        expect(emitWorkspaceConsoleLog).not.toHaveBeenCalled();
    });
});

describe("refusing a window", () => {
    /** A window as the gate reads one: its type, the project it was launched on, and its app. */
    function windowDouble(options: { type: WindowAppType; projectPath?: string; trusted: boolean }) {
        const app = host(options.trusted);
        return {
            getWindowType: () => options.type,
            getProps: () => ({ projectPath: options.projectPath }),
            getApp: () => app,
            app,
        } as never;
    }

    it("refuses a workspace window whose project is not trusted", () => {
        const window = windowDouble({
            type: WindowAppType.Workspace,
            projectPath: "D:/games/theirs",
            trusted: false,
        });
        expect(refuseDistrustedWindow(window, "remote asset download")).toContain("not trusted");
    });

    it("allows a workspace window whose project is trusted", () => {
        const window = windowDouble({
            type: WindowAppType.Workspace,
            projectPath: "D:/games/mine",
            trusted: true,
        });
        expect(refuseDistrustedWindow(window, "remote asset download")).toBeNull();
    });

    it("does not govern a window that has no project", () => {
        // The launcher and the settings window are not opened on a project, so there is nothing for
        // project trust to have an opinion about. Refusing them would break Studio's own surfaces.
        const window = windowDouble({ type: WindowAppType.Launcher, trusted: false });
        expect(refuseDistrustedWindow(window, "remote asset download")).toBeNull();
    });

    it("does not govern a workspace window that was launched without a project path", () => {
        const window = windowDouble({ type: WindowAppType.Workspace, trusted: false });
        expect(refuseDistrustedWindow(window, "preview")).toBeNull();
    });
});
