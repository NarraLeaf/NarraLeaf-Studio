import path from "path";
import { describe, expect, it } from "vitest";
import type { VcsServerSession, VcsSessionUse } from "@shared/types/vcs";
import {
    readSessionUses,
    sessionStanding,
    sessionUseProjectKey,
    sessionUsers,
    shouldAskForSessionUse,
    withoutSessionUse,
    withoutSessionUsesAt,
    withSessionUse,
} from "./serverSessionScope";

/**
 * Which project may act as which server account - the rule on its own, with no backend and no
 * window.
 *
 * What these pin is the half of the sign-in scoping that nothing else can see: a wrong answer here
 * does not fail anywhere. It sends a request under an account the author never agreed to, and the
 * server - which sees a valid session - accepts it.
 */

const ORIGIN = "lore://team.example.lan:41337";
const OTHER_ORIGIN = "lore://elsewhere.example.lan:41337";
const WIN = process.platform === "win32";
const PROJECT_A = WIN ? "D:\\games\\harbour" : "/games/harbour";
const PROJECT_B = WIN ? "D:\\games\\lantern" : "/games/lantern";

function account(userId: string, displayName = "Ada"): VcsServerSession {
    return {
        authUrl: "https://team.example.lan:41402",
        remoteOrigin: ORIGIN,
        account: { userId, displayName, username: displayName.toLowerCase(), email: "", identity: displayName, expiresAt: 0 },
        signedInAt: 0,
    };
}

const ADA = account("u-ada", "Ada");
const BEN = account("u-ben", "Ben");

function use(projectPath: string, userId: string | null, remoteOrigin = ORIGIN): VcsSessionUse {
    return withSessionUse([], { remoteOrigin, projectPath, userId, at: 1 })[0]!;
}

describe("the project half of the pair", () => {
    it("is the directory, through the identity rule every other project comparison uses", () => {
        if (WIN) {
            // One directory, four spellings: a native picker, a typed path, a trailing separator
            // and another case. They must be one pair, or answering once would not stick.
            const spellings = ["D:\\games\\Harbour", "d:/games/harbour", "D:\\games\\harbour\\", "D:\\GAMES\\HARBOUR"];
            const keys = new Set(spellings.map(sessionUseProjectKey));
            expect(keys.size).toBe(1);
        } else {
            expect(sessionUseProjectKey("/games/harbour/")).toBe(sessionUseProjectKey("/games/harbour"));
        }
    });

    it("keeps two directories apart, including one nested in the other", () => {
        expect(sessionUseProjectKey(PROJECT_A)).not.toBe(sessionUseProjectKey(PROJECT_B));
        expect(sessionUseProjectKey(PROJECT_A)).not.toBe(sessionUseProjectKey(path.join(PROJECT_A, "copy")));
    });
});

describe("where a project stands with the sign-in held for its server", () => {
    it("has nothing to stand on where the server has no sign-in, or the project no server", () => {
        expect(sessionStanding({ sessions: [], uses: [], remoteOrigin: ORIGIN, projectPath: PROJECT_A }).kind)
            .toBe("none");
        expect(sessionStanding({ sessions: [ADA], uses: [], remoteOrigin: null, projectPath: PROJECT_A }).kind)
            .toBe("none");
        expect(sessionStanding({ sessions: [ADA], uses: [], remoteOrigin: OTHER_ORIGIN, projectPath: PROJECT_A }).kind)
            .toBe("none");
    });

    it("is undecided where nobody has answered - which is every project, the day this ships", () => {
        // The upgrade path: a sign-in stored before answers were kept has no rows at all. Each
        // project that used to borrow it is therefore asked, and the sign-in itself is untouched.
        const sessions = [ADA];
        const standing = sessionStanding({ sessions, uses: [], remoteOrigin: ORIGIN, projectPath: PROJECT_A });
        expect(standing).toEqual({ kind: "undecided", session: ADA });
        expect(sessions).toEqual([ADA]);
    });

    it("is granted only for the project that was answered for", () => {
        const uses = [use(PROJECT_A, ADA.account.userId)];
        expect(sessionStanding({ sessions: [ADA], uses, remoteOrigin: ORIGIN, projectPath: PROJECT_A }).kind)
            .toBe("granted");
        // Same server, same machine, different project: not granted by A's answer.
        expect(sessionStanding({ sessions: [ADA], uses, remoteOrigin: ORIGIN, projectPath: PROJECT_B }).kind)
            .toBe("undecided");
    });

    it("is granted only at the server that was answered for", () => {
        const elsewhere = { ...ADA, remoteOrigin: OTHER_ORIGIN };
        const uses = [use(PROJECT_A, ADA.account.userId)];
        expect(sessionStanding({ sessions: [ADA, elsewhere], uses, remoteOrigin: OTHER_ORIGIN, projectPath: PROJECT_A }).kind)
            .toBe("undecided");
    });

    it("finds the answer under any spelling of the project's directory", () => {
        const uses = [use(PROJECT_A, ADA.account.userId)];
        const respelt = WIN ? "d:/GAMES/harbour/" : "/games/harbour/";
        expect(sessionStanding({ sessions: [ADA], uses, remoteOrigin: ORIGIN, projectPath: respelt }).kind)
            .toBe("granted");
    });

    it("is declined where the author said no", () => {
        expect(sessionStanding({ sessions: [ADA], uses: [use(PROJECT_A, null)], remoteOrigin: ORIGIN, projectPath: PROJECT_A }))
            .toEqual({ kind: "declined", session: ADA });
    });

    it("goes back to undecided when the sign-in at that server is now another account", () => {
        // The author agreed to Ada acting for this project. Ben signing in to the same server
        // does not inherit that yes.
        expect(sessionStanding({ sessions: [BEN], uses: [use(PROJECT_A, ADA.account.userId)], remoteOrigin: ORIGIN, projectPath: PROJECT_A }))
            .toEqual({ kind: "undecided", session: BEN });
    });
});

describe("whether a request puts the question", () => {
    const undecided = { kind: "undecided", session: ADA } as const;
    const declined = { kind: "declined", session: ADA } as const;
    const granted = { kind: "granted", session: ADA } as const;

    it("never asks for a read", () => {
        expect(shouldAskForSessionUse(undecided, "read")).toBe(false);
        expect(shouldAskForSessionUse(declined, "read")).toBe(false);
    });

    it("asks a daily request once, and leaves a no alone", () => {
        expect(shouldAskForSessionUse(undecided, "first-use")).toBe(true);
        // Send and Get are pressed every day; a no that came back on every press would be nagging.
        expect(shouldAskForSessionUse(declined, "first-use")).toBe(false);
        expect(shouldAskForSessionUse(granted, "first-use")).toBe(false);
    });

    it("asks again where the author is choosing the server now", () => {
        expect(shouldAskForSessionUse(undecided, "explicit")).toBe(true);
        expect(shouldAskForSessionUse(declined, "explicit")).toBe(true);
        expect(shouldAskForSessionUse(granted, "explicit")).toBe(false);
        expect(shouldAskForSessionUse({ kind: "none" }, "explicit")).toBe(false);
    });
});

describe("keeping the answers", () => {
    it("holds one answer per pair, the latest", () => {
        let uses = withSessionUse([], { remoteOrigin: ORIGIN, projectPath: PROJECT_A, userId: null, at: 1 });
        uses = withSessionUse(uses, { remoteOrigin: ORIGIN, projectPath: PROJECT_A.toUpperCase(), userId: "u-ada", at: 2 });
        uses = withSessionUse(uses, { remoteOrigin: ORIGIN, projectPath: PROJECT_B, userId: null, at: 3 });
        if (WIN) {
            expect(uses).toHaveLength(2);
            expect(uses.find(row => row.userId === "u-ada")?.decidedAt).toBe(2);
        } else {
            // Case is significant on POSIX, so the upper-cased path is a third project there.
            expect(uses).toHaveLength(3);
        }
    });

    it("forgets one pair, or every answer about one server", () => {
        const uses = [use(PROJECT_A, "u-ada"), use(PROJECT_B, null), use(PROJECT_A, "u-ada", OTHER_ORIGIN)];
        expect(withoutSessionUse(uses, ORIGIN, PROJECT_A)).toHaveLength(2);
        expect(withoutSessionUsesAt(uses, ORIGIN)).toEqual([uses[2]]);
    });

    it("drops rows that are not answers rather than trusting them", () => {
        const good = use(PROJECT_A, "u-ada");
        expect(readSessionUses([good, null, 3, { remoteOrigin: ORIGIN }, { ...good, userId: 7 }])).toEqual([good]);
        expect(readSessionUses("nonsense")).toEqual([]);
        expect(readSessionUses(undefined)).toEqual([]);
    });
});

describe("naming the projects a sign-in serves", () => {
    it("lists the projects that said yes to the account signed in now, by the name the launcher uses", () => {
        const uses = [
            use(PROJECT_A, "u-ada"),
            use(PROJECT_B, null),
            use(path.join(PROJECT_B, "..", "old"), "u-ben"),
        ];
        const users = sessionUsers(uses, ADA, projectPath =>
            sessionUseProjectKey(projectPath) === sessionUseProjectKey(PROJECT_A) ? "Harbour Lights" : null);
        expect(users).toEqual([{ path: path.resolve(PROJECT_A), name: "Harbour Lights" }]);
    });

    it("falls back to the folder name for a project the launcher does not list", () => {
        expect(sessionUsers([use(PROJECT_B, "u-ada")], ADA, () => null))
            .toEqual([{ path: path.resolve(PROJECT_B), name: "lantern" }]);
    });
});
