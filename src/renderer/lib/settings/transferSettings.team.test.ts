import { beforeEach, describe, expect, it, vi } from "vitest";

import { translate } from "@/lib/i18n";
import { exportablePreferenceKeys } from "@/lib/settings/settingsScope";
import type { TeamStudioConfigOutcome, TeamStudioConfigRequest } from "@shared/types/team";

import { backupToTeam, planTeamRestore } from "./transferSettings";

/**
 * Settings kept on a Team server travel as the same document an export writes, and come back
 * through the same reading as a file: a restore is planned, never applied on arrival.
 */

let stored: Record<string, unknown> = {};
let answer: TeamStudioConfigOutcome = { ok: true };
const sent: TeamStudioConfigRequest[] = [];

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: { state: { getAllGlobalState: async () => ({ success: true, data: { settings: stored } }) } },
        getAppInfo: async () => ({ success: true, data: { version: "9.9.9" } }),
        getPlatform: async () => ({ success: true, data: { system: "darwin" } }),
        team: {
            studioConfig: async (request: TeamStudioConfigRequest) => {
                sent.push(request);
                return { success: true, data: answer };
            },
        },
    }),
}));

beforeEach(() => {
    sent.length = 0;
    answer = { ok: true };
    stored = {};
});

describe("settings kept on a Team server", () => {
    it("backs up the document an export would write, and reads it back as nothing to change", async () => {
        const key = exportablePreferenceKeys()[0]!;
        stored = { [key]: "whatever is stored", "not.a.preference": 1 };
        await backupToTeam("lore://team.test:41337");
        const upload = sent[0]!;
        expect(upload.action).toBe("upload");
        const content = upload.action === "upload" ? upload.content : "";
        const document = JSON.parse(content) as { studioVersion: string; settings: Record<string, unknown> };
        expect(document.studioVersion).toBe("9.9.9");
        expect(Object.keys(document.settings)).toEqual([key]);

        answer = { ok: true, content };
        const plan = await planTeamRestore("lore://team.test:41337");
        expect(plan?.applicable.filter(entry => entry.key === key)).toEqual([]);
    });

    it("says when the server keeps nothing yet, and words a refusal", async () => {
        await expect(planTeamRestore("lore://team.test:41337")).resolves.toBeNull();
        answer = { ok: false, reason: "unsupported" };
        await expect(planTeamRestore("lore://team.test:41337")).rejects.toThrow(translate("settings.transfer.team.unsupported"));
        answer = { ok: false, reason: "forbidden", message: "read-only" };
        await expect(backupToTeam("lore://team.test:41337")).rejects.toThrow(translate("settings.transfer.team.forbiddenUpload"));
    });

    it("refuses a document that is not a settings document", async () => {
        answer = { ok: true, content: "{\"something\":\"else\"}" };
        await expect(planTeamRestore("lore://team.test:41337")).rejects.toThrow();
    });
});
