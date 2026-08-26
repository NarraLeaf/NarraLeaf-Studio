// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcsServerSession } from "@shared/types/vcs";
import { TeamStatusEntry } from "./TeamStatusEntry";
import { isTeamPresenceReachable, openTeamPresence } from "./teamPresenceController";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * The cell in the bottom-left corner, and the one rule about it that is easy to get wrong.
 *
 * Every other cell on this strip goes quiet when it has nothing to report. This one is an entry
 * point, so it is drawn even when the answer is "nowhere" - an entry point that appears only once
 * the thing behind it is set up cannot be used to set it up. What it must NOT do is claim a corner
 * on a project where the feature does not exist at all, which is what the two silent cases below
 * pin, together with the bridge that other surfaces open it through.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: null }) }));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: [] } }),
        },
        // The window opens a session with this project's server the moment the workspace is
        // drawn - that is what makes the check automatic - and the dialog behind this cell reads
        // from it. The cell itself now takes that reading from `TeamProjectProvider`, which is
        // absent here, so every assertion below is written against "no session" throughout.
        team: {
            open: () => Promise.resolve({ success: false }),
            call: () => Promise.resolve({ success: false }),
            subscribe: () => Promise.resolve({ success: false }),
            unsubscribe: () => Promise.resolve({ success: false }),
            onConnectionChanged: () => ({ cancel: vi.fn() }),
            onEvent: () => ({ cancel: vi.fn() }),
        },
        app: { launchSettings: vi.fn() },
    }),
}));

const surface = vi.hoisted(() => ({ current: {} as VersionSurface }));
vi.mock("../../hooks/useVersionSurface", () => ({ useVersionSurface: () => surface.current }));

afterEach(cleanup);

const ONE = "lore://one.example.lan:41337";

function cell(overrides: Partial<VersionSurface> = {}) {
    surface.current = {
        state: { kind: "current", head: "abc1234", number: 3 },
        authorName: "Ada Blackwood",
        busy: null,
        failure: null,
        remote: `${ONE}/my-game`,
        remoteNeedsSignIn: false,
        syncState: null,
        serverSession: null,
        signIn: null,
        checkRemote: vi.fn(),
        setRemote: vi.fn(() => Promise.resolve(true)),
        setAuthorName: vi.fn(() => Promise.resolve(true)),
        signOutOfServer: vi.fn(() => Promise.resolve()),
        ...overrides,
    } as unknown as VersionSurface;
    render(<TeamStatusEntry />);
}

function signedIn(): VcsServerSession {
    return {
        remoteOrigin: ONE,
        authUrl: "https://one.example.lan",
        account: { userId: "ada", username: "ada", displayName: "Ada", identity: "ada@one" },
        name: "Blackwood Studio",
    } as VcsServerSession;
}

function cellNode(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-team-cell]");
}

describe("the Team cell", () => {
    it("names the server this project's versions go to", () => {
        cell({ serverSession: signedIn() });

        expect(cellNode()?.getAttribute("data-team-cell")).toBe("connected");
        expect(cellNode()?.textContent).toBe("Blackwood Studio");
    });

    it("is drawn with no name at all for a project on no server, rather than not drawn", () => {
        cell({ remote: null });

        // The icon alone. This is the case the cell exists to be pressed in, so going quiet here
        // would hide the only way in.
        expect(cellNode()?.getAttribute("data-team-cell")).toBe("none");
        expect(cellNode()?.textContent).toBe("");
    });

    it("says nothing where the feature does not exist for this project", () => {
        cell({ state: { kind: "not-a-repository" } as VersionSurface["state"] });
        expect(cellNode()).toBeNull();
        cleanup();

        cell({ state: { kind: "unavailable", reason: "unsupported-platform" } as VersionSurface["state"] });
        expect(cellNode()).toBeNull();
    });

    it("opens its dialog on a press", () => {
        cell();

        expect(document.querySelector("[data-team-panel]")).toBeNull();
        fireEvent.click(cellNode()!);

        expect(document.querySelector("[data-team-panel]")).not.toBeNull();
    });

    it("raises its voice only for the states somebody acts on", () => {
        const ink = () => cellNode()?.className ?? "";
        const upToDate = {
            remoteAvailable: true,
            remoteAuthorized: true,
            remoteBranchExists: true,
            localAhead: false,
            remoteAhead: false,
        } as VersionSurface["syncState"];

        // Signed in and up to date: the ordinary state, and the ordinary ink. A cell that went
        // coloured here would be coloured all working day, which is a colour that means nothing.
        cell({ serverSession: signedIn(), syncState: upToDate });
        expect(ink()).not.toContain("text-warning");
        cleanup();

        // Nothing answered. The rail still draws Send and Get, so this cell is the only thing
        // that says the press will be refused.
        cell({ serverSession: signedIn(), syncState: { ...upToDate!, remoteAvailable: false } });
        expect(ink()).toContain("text-warning");
        cleanup();

        // No account on that server, which is refused the same way and fixed in the panel.
        cell({ serverSession: null });
        expect(ink()).toContain("text-warning");
    });

    it("registers the bridge the rail opens it through, and only while it is drawn", () => {
        cell({ state: { kind: "not-a-repository" } as VersionSurface["state"] });
        expect(isTeamPresenceReachable()).toBe(false);
        cleanup();

        cell();
        expect(isTeamPresenceReachable()).toBe(true);
        act(() => openTeamPresence());
        expect(document.querySelector("[data-team-panel]")).not.toBeNull();
    });
});
