import { describe, expect, it } from "vitest";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { refuseLiveSessionEntry } from "./liveSessionEntry";
import { workspace as en } from "@shared/i18n/catalog/en/workspace";

const REVISION = "abc123".padEnd(64, "0");

describe("refuseLiveSessionEntry", () => {
    it("allows a workspace that is not frozen at all", () => {
        expect(refuseLiveSessionEntry(null)).toBeNull();
    });

    it.each<[string, WorkspaceFreezeReason, string]>([
        ["a past version on screen", { kind: "revision", revision: REVISION }, "liveBlockedRevision"],
        ["a hand-frozen workspace", { kind: "manual" }, "liveBlockedManual"],
        ["an open merge", { kind: "merge" }, "liveBlockedMerge"],
        ["a recovery shell", { kind: "recovery" }, "liveBlockedRecovery"],
    ])("refuses over %s, naming that state and no other", (_what, reason, key) => {
        const refusal = refuseLiveSessionEntry(reason);

        expect(refusal).not.toBeNull();
        expect(refusal?.frozenBy).toBe(reason.kind);
        expect(refusal?.message).toBe(`workspace.shell.team.${key}`);
    });

    it("refuses a second session while one is already running here", () => {
        // Not symmetry for its own sake: the freeze is a single latch, so a second session would
        // replace the first one's writable path set while the host was still broadcasting for it.
        const refusal = refuseLiveSessionEntry({
            kind: "live-session",
            session: "s-1",
            writable: ["main/story/act-one.json"],
        });

        expect(refusal?.frozenBy).toBe("live-session");
        expect(refusal?.message).toBe("workspace.shell.team.liveBlockedSession");
    });

    it("names a different state for every freeze, so no two read alike", () => {
        const reasons: WorkspaceFreezeReason[] = [
            { kind: "revision", revision: REVISION },
            { kind: "manual" },
            { kind: "merge" },
            { kind: "recovery" },
            { kind: "live-session", session: "s-1", writable: [] },
        ];
        const messages = reasons.map((reason) => refuseLiveSessionEntry(reason)?.message);

        expect(new Set(messages).size).toBe(reasons.length);
    });

    it("reads a sentence the catalog actually holds", () => {
        // The keys are a union of literals, so a typo compiles only if it typos identically in both
        // places. What this catches is the catalog entry being renamed or never added.
        const team = en.shell.team as Record<string, unknown>;
        for (const key of [
            "liveBlockedRevision",
            "liveBlockedManual",
            "liveBlockedMerge",
            "liveBlockedRecovery",
            "liveBlockedSession",
        ]) {
            expect(typeof team[key]).toBe("string");
        }
    });
});
