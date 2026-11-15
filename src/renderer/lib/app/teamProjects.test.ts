import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({}) }));

import type { VcsLocalRepository, VcsServerSession } from "@shared/types/vcs";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { teamProjectsFrom } from "./teamProjects";

const ORIGIN = "lore://team.example.lan:41337";

function repository(path: string, remoteOrigin?: string): VcsLocalRepository {
    return { path, name: path.split("/").pop() ?? path, ...(remoteOrigin ? { remoteOrigin } : {}) };
}

const signedIn = { remoteOrigin: ORIGIN, name: "Blackwood Studio" } as VcsServerSession;

describe("which remembered projects are team projects", () => {
    it("leaves out a project that names no server", () => {
        expect(teamProjectsFrom([repository("/p/solo")], [signedIn]).size).toBe(0);
    });

    it("marks a project on a server this machine is signed in to as connected, by the server's name", () => {
        const map = teamProjectsFrom([repository("/p/shared", ORIGIN)], [signedIn]);
        expect(map.get(normalizeProjectPath("/p/shared"))).toEqual({
            remoteOrigin: ORIGIN,
            server: "Blackwood Studio",
            connected: true,
        });
    });

    it("marks one whose server was signed out of as disconnected, named by its host", () => {
        const map = teamProjectsFrom([repository("/p/shared", ORIGIN)], []);
        expect(map.get(normalizeProjectPath("/p/shared"))).toEqual({
            remoteOrigin: ORIGIN,
            server: "team.example.lan:41337",
            connected: false,
        });
    });
});
