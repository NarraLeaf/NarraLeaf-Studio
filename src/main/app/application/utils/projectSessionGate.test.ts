import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSessionHolder } from "@shared/types/projectSession";
import {
    HELD_ELSEWHERE_OPERATIONS,
    projectHeldElsewhereMessage,
    projectHeldElsewhereRefusal,
    refuseProjectHeldElsewhere,
} from "./projectSessionGate";

const emitWorkspaceConsoleLog = vi.hoisted(() => vi.fn());
vi.mock("./workspaceConsole", () => ({ emitWorkspaceConsoleLog }));

const ELSEWHERE: ProjectSessionHolder = { hostname: "studio-two", startedAt: "2026-09-01T10:00:00.000Z", sameHost: false };
const HERE: ProjectSessionHolder = { ...ELSEWHERE, hostname: "studio-one", sameHost: true };

function host(holder: ProjectSessionHolder | null) {
    return {
        logger: { warn: vi.fn() },
        getProjectSessionLockManager: () => ({ heldElsewhere: () => holder }),
    };
}

describe("project session gate", () => {
    it.each(HELD_ELSEWHERE_OPERATIONS)("refuses %s on a project another Studio has", operation => {
        const message = projectHeldElsewhereRefusal(host(ELSEWHERE), "D:/games/shared", operation);
        expect(message).toContain("open in another NarraLeaf Studio");
    });

    it.each(HELD_ELSEWHERE_OPERATIONS)("allows %s when nothing turned this Studio away", operation => {
        expect(projectHeldElsewhereRefusal(host(null), "D:/games/mine", operation)).toBeNull();
    });

    it("says where the other Studio is, in the words the error screen uses", () => {
        expect(projectHeldElsewhereMessage("Dev Mode", HERE)).toContain("on this computer");
        expect(projectHeldElsewhereMessage("Dev Mode", ELSEWHERE)).toContain("on studio-two");
    });

    it("says what is true and what to do, and nothing an author cannot act on", () => {
        const message = projectHeldElsewhereMessage("preview", HERE);
        expect(message.startsWith("Preview is unavailable")).toBe(true);
        expect(message).toContain("Close it there");
        // The holder's record also carries a process id and a profile digest; neither is shown.
        expect(message).not.toMatch(/\d{3,}/);
    });

    it("does not send the author to close a Studio that has already let the project go", () => {
        // Taken over while this Studio slept, and closed there again before it woke: the other
        // Studio's claim is gone, and the way back is to open the project here again.
        const message = projectHeldElsewhereMessage("Dev Mode", { ...HERE, released: true });
        expect(message).toBe(
            "Dev Mode is unavailable: this project was opened in another NarraLeaf Studio on this computer. "
            + "Open the project here again.",
        );
        expect(message).not.toContain("Close it there");
    });

    it("puts the refusal in the log as well as the workspace console", () => {
        // The window this usually protects is on its error screen, with no console on show.
        emitWorkspaceConsoleLog.mockClear();
        const app = host(HERE);
        refuseProjectHeldElsewhere(app as never, "D:/games/shared", "Dev Mode");

        expect(emitWorkspaceConsoleLog).toHaveBeenCalledOnce();
        expect(emitWorkspaceConsoleLog.mock.calls[0][2]).toMatchObject({ level: "error", source: "Project" });
        expect(app.logger.warn).toHaveBeenCalledOnce();
    });

    it("says nothing when it is not refusing", () => {
        emitWorkspaceConsoleLog.mockClear();
        const app = host(null);
        expect(refuseProjectHeldElsewhere(app as never, "D:/games/mine", "Dev Mode")).toBeNull();
        expect(emitWorkspaceConsoleLog).not.toHaveBeenCalled();
        expect(app.logger.warn).not.toHaveBeenCalled();
    });
});

describe("every operation is actually refused somewhere", () => {
    /**
     * A name in {@link HELD_ELSEWHERE_OPERATIONS} is a promise that the manager starting it asks
     * first. The failure this guards against is silent: a name on the list that no manager checks
     * reads in review as a gate that exists.
     */
    const MAIN_ROOT = path.resolve(__dirname, "../../..");
    const GATE_CALL = "(?:refuseProjectHeldElsewhere|projectHeldElsewhereRefusal)";

    function mainSources(dir: string, out: string[] = []): string[] {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                mainSources(full, out);
            } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
                out.push(full);
            }
        }
        return out;
    }

    const sources = mainSources(MAIN_ROOT)
        .filter(file => !file.endsWith(`${path.sep}projectSessionGate.ts`))
        .map(file => fs.readFileSync(file, "utf-8"));

    it.each(HELD_ELSEWHERE_OPERATIONS)("%s has a gate that refuses it", operation => {
        const call = new RegExp(`${GATE_CALL}[(][^;]*?"${operation}"`, "s");
        expect(sources.some(source => call.test(source))).toBe(true);
    });
});
