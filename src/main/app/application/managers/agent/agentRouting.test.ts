import { describe, expect, it } from "vitest";
import { projectPathIdentity } from "@shared/utils/recentProject";
import { chooseAgentWorkspace, writeNeedsNamedProject, type AgentRoutingCandidate } from "./agentRouting";

const posix = (value: string) => projectPathIdentity(value, false);
const windows = (value: string) => projectPathIdentity(value, true);

function candidate(name: string, projectPath: string, lastFocusedAt = 0): AgentRoutingCandidate<string> {
    return { window: name, projectPath, lastFocusedAt };
}

describe("chooseAgentWorkspace", () => {
    it("routes a named project to its window, by project identity", () => {
        const open = [candidate("a", "/games/a"), candidate("b", "/games/b", 10)];
        expect(chooseAgentWorkspace("/games/a/", open, posix)).toEqual({ ok: true, window: "a", projectPath: "/games/a" });
    });

    it("folds separators and case the way Windows does", () => {
        const open = [candidate("a", "D:\\Games\\One")];
        expect(chooseAgentWorkspace("d:/games/one", open, windows)).toMatchObject({ ok: true, window: "a" });
    });

    it("never falls back to another project when the named one is not open", () => {
        const open = [candidate("a", "/games/a", 5)];
        expect(chooseAgentWorkspace("/games/b", open, posix)).toEqual({ ok: false, reason: "not-open", openProjects: ["/games/a"] });
        expect(chooseAgentWorkspace("/games/b", [], posix)).toEqual({ ok: false, reason: "none-open", openProjects: [] });
    });

    it("sends an unnamed call to the workspace focused last", () => {
        const open = [candidate("a", "/a", 100), candidate("b", "/b", 300), candidate("c", "/c", 200)];
        expect(chooseAgentWorkspace(null, open, posix)).toMatchObject({ ok: true, window: "b" });
    });

    it("prefers a focused window over one that never was", () => {
        const open = [candidate("a", "/a"), candidate("b", "/b", 1)];
        expect(chooseAgentWorkspace(null, open, posix)).toMatchObject({ ok: true, window: "b" });
    });

    it("uses the only open workspace when nothing was ever focused", () => {
        expect(chooseAgentWorkspace(null, [candidate("a", "/a")], posix)).toMatchObject({ ok: true, window: "a" });
    });

    it("refuses an unnamed call when several are open and none was focused", () => {
        const open = [candidate("a", "/a"), candidate("b", "/b")];
        expect(chooseAgentWorkspace(null, open, posix)).toEqual({ ok: false, reason: "ambiguous", openProjects: ["/a", "/b"] });
    });

    it("refuses when nothing is open", () => {
        expect(chooseAgentWorkspace(null, [], posix)).toEqual({ ok: false, reason: "none-open", openProjects: [] });
    });
});

describe("writeNeedsNamedProject", () => {
    it("asks a write to name its project once more than one is open", () => {
        expect(writeNeedsNamedProject(true, null, 2)).toBe(true);
        expect(writeNeedsNamedProject(true, "/games/a", 2)).toBe(false);
    });

    it("leaves reads, and a write with one project open, to the ordinary routing", () => {
        expect(writeNeedsNamedProject(false, null, 3)).toBe(false);
        expect(writeNeedsNamedProject(true, null, 1)).toBe(false);
        expect(writeNeedsNamedProject(true, null, 0)).toBe(false);
    });
});
