import { describe, expect, it } from "vitest";

import { TeamMethod } from "@shared/types/team";
import { WindowAppType } from "@shared/types/window";

import { isLettingGo, teamAllows, teamReach, type TeamAsk, type TeamReach } from "./teamWindowReach";

/**
 * Which window may speak to a server as the account - the table itself, apart from any handler.
 *
 * The handlers' own suite drives these through IPC against a real manager and a real record of
 * answers. What is pinned here is the table, row by row, so that a change to it is a change somebody
 * made on purpose rather than a side effect of editing a handler.
 */

const SERVER = "lore://team.example.lan:41337";
const MINE = "D:/games/mine";

function reach(windowType: WindowAppType, options: { projectPath?: string | null; uses?: boolean } = {}): TeamReach {
    return teamReach({
        windowType,
        projectPath: options.projectPath === undefined ? MINE : options.projectPath,
        remoteOrigin: SERVER,
        usesSignIn: () => options.uses ?? false,
    });
}

const call = (method: string): TeamAsk => ({ op: "call", method });

describe("where a window stands with a server", () => {
    it("is the account for the launcher, whatever any project said", () => {
        expect(reach(WindowAppType.Launcher, { projectPath: null })).toEqual({ kind: "account" });
    });

    it("is a listing for Settings and the wizard", () => {
        expect(reach(WindowAppType.Settings, { projectPath: null })).toEqual({ kind: "listing" });
        expect(reach(WindowAppType.ProjectWizard, { projectPath: null })).toEqual({ kind: "listing" });
    });

    it("is the project for a workspace whose project uses the sign-in there, and unused otherwise", () => {
        expect(reach(WindowAppType.Workspace, { uses: true })).toEqual({ kind: "project", projectPath: MINE });
        expect(reach(WindowAppType.Workspace, { uses: false })).toEqual({ kind: "unused", projectPath: MINE });
    });

    it("asks the record about the window's own project and the server named, and nothing else", () => {
        const asked: Array<[string, string]> = [];
        teamReach({
            windowType: WindowAppType.Workspace,
            projectPath: MINE,
            remoteOrigin: SERVER,
            usesSignIn: (projectPath, origin) => {
                asked.push([projectPath, origin]);
                return true;
            },
        });
        expect(asked).toEqual([[MINE, SERVER]]);
    });

    it("is unused for a workspace asking about no server at all", () => {
        expect(teamReach({
            windowType: WindowAppType.Workspace,
            projectPath: MINE,
            remoteOrigin: null,
            usesSignIn: () => true,
        })).toEqual({ kind: "unused", projectPath: MINE });
    });

    /**
     * Dev Mode runs the project's own scripts, so it is the window that most needs to be refused -
     * and it is refused even for a project that said yes: nothing in it speaks to a server.
     */
    it("is nothing for Dev Mode, even on a project that uses the sign-in, or for a prompt", () => {
        expect(reach(WindowAppType.DevMode, { uses: true })).toEqual({ kind: "none" });
        for (const prompt of [
            WindowAppType.PluginPermissionPrompt,
            WindowAppType.ServerTrustPrompt,
            WindowAppType.ProjectTrustPrompt,
            WindowAppType.ServerSessionPrompt,
            WindowAppType.Raw,
        ]) {
            expect(reach(prompt, { projectPath: null })).toEqual({ kind: "none" });
        }
    });
});

describe("what each may do", () => {
    const ACCOUNT: TeamReach = { kind: "account" };
    const LISTING: TeamReach = { kind: "listing" };
    const PROJECT: TeamReach = { kind: "project", projectPath: MINE };
    const UNUSED: TeamReach = { kind: "unused", projectPath: MINE };
    const NONE: TeamReach = { kind: "none" };

    it("lets the launcher do everything but move a project's bytes", () => {
        expect(teamAllows(ACCOUNT, { op: "open" })).toBe(true);
        expect(teamAllows(ACCOUNT, { op: "connections" })).toBe(true);
        expect(teamAllows(ACCOUNT, { op: "subscribe" })).toBe(true);
        expect(teamAllows(ACCOUNT, call(TeamMethod.threadsCreate))).toBe(true);
        expect(teamAllows(ACCOUNT, call(TeamMethod.projectsForget))).toBe(true);
        expect(teamAllows(ACCOUNT, { op: "transfer" })).toBe(false);
    });

    it("lets Settings and the wizard list what a server holds, and nothing else", () => {
        expect(teamAllows(LISTING, call(TeamMethod.projectsList))).toBe(true);
        expect(teamAllows(LISTING, call(TeamMethod.projectsGet))).toBe(false);
        expect(teamAllows(LISTING, call(TeamMethod.threadsCreate))).toBe(false);
        expect(teamAllows(LISTING, { op: "open" })).toBe(false);
        expect(teamAllows(LISTING, { op: "subscribe" })).toBe(false);
        expect(teamAllows(LISTING, { op: "connections" })).toBe(false);
        expect(teamAllows(LISTING, { op: "transfer" })).toBe(false);
    });

    it("lets a project that uses the sign-in do what its workspace does, but not list every server", () => {
        expect(teamAllows(PROJECT, { op: "open" })).toBe(true);
        expect(teamAllows(PROJECT, { op: "subscribe" })).toBe(true);
        expect(teamAllows(PROJECT, { op: "transfer" })).toBe(true);
        expect(teamAllows(PROJECT, call(TeamMethod.liveOpen))).toBe(true);
        expect(teamAllows(PROJECT, { op: "connections" })).toBe(false);
    });

    it("lets a project that does not use it do nothing, and a window that never speaks to servers the same", () => {
        for (const ask of [
            { op: "open" },
            { op: "connections" },
            { op: "subscribe" },
            { op: "transfer" },
            call(TeamMethod.projectsList),
            call(TeamMethod.clientsAnnounce),
        ] satisfies TeamAsk[]) {
            expect(teamAllows(UNUSED, ask)).toBe(false);
            expect(teamAllows(NONE, ask)).toBe(false);
        }
    });

    /** Studio calls none of them; on an operator's account they are the account's power over the server. */
    it("refuses the administration methods to every window, the launcher included", () => {
        for (const who of [ACCOUNT, LISTING, PROJECT]) {
            expect(teamAllows(who, call(TeamMethod.adminTokensMint))).toBe(false);
            expect(teamAllows(who, call(TeamMethod.adminUsersCreate))).toBe(false);
        }
    });
});

describe("letting go", () => {
    it("is withdrawing presence or leaving a room, from a workspace whose project stopped using the sign-in", () => {
        const unused: TeamReach = { kind: "unused", projectPath: MINE };
        expect(isLettingGo(unused, call(TeamMethod.clientsWithdraw))).toBe(true);
        expect(isLettingGo(unused, call(TeamMethod.liveLeave))).toBe(true);
        // Closing a room ends it for everybody in it, which is not taking back something one said.
        expect(isLettingGo(unused, call(TeamMethod.liveClose))).toBe(false);
        expect(isLettingGo(unused, call(TeamMethod.clientsAnnounce))).toBe(false);
    });

    it("is not a way in for a window that never spoke to a server", () => {
        expect(isLettingGo({ kind: "none" }, call(TeamMethod.clientsWithdraw))).toBe(false);
        expect(isLettingGo({ kind: "listing" }, call(TeamMethod.clientsWithdraw))).toBe(false);
    });
});
