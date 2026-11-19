import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

import {
    PROJECT_FOLDER_MISSING,
    PROJECT_NOT_A_PROJECT,
    TEAM_PROJECT_SIGNED_OUT,
} from "@shared/utils/projectOpenRefusal";
import { findProjectOpenRefusal, type ProjectOpenFacts } from "./recentProjectGuard";

const ORIGIN = "lore://team.example.lan:41337";

function facts(overrides: Partial<ProjectOpenFacts>): ProjectOpenFacts {
    return {
        missingReason: async () => null,
        remoteOrigin: () => undefined,
        signedIn: () => true,
        ...overrides,
    };
}

describe("findProjectOpenRefusal", () => {
    it("opens a personal project that is on disk", async () => {
        expect(await findProjectOpenRefusal(facts({}), "/p/a")).toBeNull();
    });

    it("opens a team project this machine is signed in to", async () => {
        expect(await findProjectOpenRefusal(facts({ remoteOrigin: () => ORIGIN }), "/p/a")).toBeNull();
    });

    it("refuses a team project whose server this machine has signed out of", async () => {
        const refusal = await findProjectOpenRefusal(facts({ remoteOrigin: () => ORIGIN, signedIn: () => false }), "/p/a");
        expect(refusal).toBe(TEAM_PROJECT_SIGNED_OUT);
    });

    it("refuses a folder that is gone, or no longer a project", async () => {
        expect(await findProjectOpenRefusal(facts({ missingReason: async () => "folder-missing" }), "/p/a"))
            .toBe(PROJECT_FOLDER_MISSING);
        expect(await findProjectOpenRefusal(facts({ missingReason: async () => "not-a-project" }), "/p/a"))
            .toBe(PROJECT_NOT_A_PROJECT);
    });
});
