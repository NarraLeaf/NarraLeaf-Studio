import { describe, expect, it } from "vitest";

import { normalizeProjectPath } from "@shared/utils/recentProject";
import { switcherUnavailability } from "./projectSwitcherAvailability";

const team = (path: string, connected: boolean) => [normalizeProjectPath(path), {
    remoteOrigin: "lore://team.example.lan:41337",
    server: "team.example.lan",
    connected,
}] as const;

describe("switcherUnavailability", () => {
    it("marks signed-out team projects and missing folders, and nothing else", () => {
        const map = switcherUnavailability(
            [{ name: "Gone", path: "/p/gone", reason: "folder-missing" }],
            new Map([team("/p/out", false), team("/p/in", true)]),
        );
        expect(map.get(normalizeProjectPath("/p/out"))).toEqual({ kind: "signed-out", server: "team.example.lan" });
        expect(map.get(normalizeProjectPath("/p/gone"))).toEqual({ kind: "folder-missing" });
        expect(map.has(normalizeProjectPath("/p/in"))).toBe(false);
    });

    it("lets a missing folder win over a stale team reading", () => {
        const map = switcherUnavailability(
            [{ name: "Gone", path: "/p/out", reason: "not-a-project" }],
            new Map([team("/p/out", false)]),
        );
        expect(map.get(normalizeProjectPath("/p/out"))).toEqual({ kind: "not-a-project" });
    });
});
