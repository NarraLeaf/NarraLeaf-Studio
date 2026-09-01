import { describe, expect, it, vi } from "vitest";
import {
    projectDistrustedMessage,
    projectDistrustedRefusal,
    refuseDistrustedOperation,
    type DistrustedOperation,
} from "./projectTrustGate";

const emitWorkspaceConsoleLog = vi.hoisted(() => vi.fn());
vi.mock("./workspaceConsole", () => ({ emitWorkspaceConsoleLog }));

function host(trusted: boolean) {
    return { projectTrustManager: { isTrusted: () => trusted } } as never;
}

/** Every operation a distrusted project is refused. Named here so removing a gate fails. */
const REFUSED: DistrustedOperation[] = [
    "production build",
    "patch export",
    "preview",
    "Dev Mode",
    "test run",
    "weather clip bake",
];

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
