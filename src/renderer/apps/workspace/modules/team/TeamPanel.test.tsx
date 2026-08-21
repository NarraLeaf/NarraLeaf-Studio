// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVERS_PANEL_SETTING_KEY } from "@shared/constants/servers";
import type { VcsServerSession } from "@shared/types/vcs";
import { TeamPanel } from "./TeamPanel";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * The Team panel is where a project's destination and this machine's account are settled.
 *
 * Both used to be in the version rail, standing above the two controls that rail exists for. The
 * whole point of moving them is that the daily pair got their column back, so what is pinned here
 * is that everything which left actually arrived: connecting, changing, checking, disconnecting,
 * signing in and out, and the name versions are recorded under. A missing one is not a cosmetic
 * loss - it is an act with nowhere left to be performed.
 *
 * The other half of the rule is in `VersionRailServerPicker.test.tsx`, which pins that none of
 * them crept back into the rail.
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

const bridge = vi.hoisted(() => ({
    servers: [] as VcsServerSession[],
    launchSettings: vi.fn(),
    listServerProjects: vi.fn(),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: bridge.servers } }),
            listServerProjects: bridge.listServerProjects,
        },
        app: { launchSettings: bridge.launchSettings },
    }),
}));

afterEach(() => {
    cleanup();
    bridge.servers = [];
    bridge.launchSettings.mockClear();
    bridge.listServerProjects.mockReset().mockResolvedValue({
        success: true,
        data: { ok: true, projects: [] },
    });
});

const ONE = "lore://one.example.lan:41337";

function session(displayName: string, name?: string): VcsServerSession {
    return {
        remoteOrigin: ONE,
        authUrl: `https://${displayName}.example.lan`,
        account: { userId: displayName, username: displayName, displayName, identity: `${displayName}@one` },
        ...(name === undefined ? {} : { name }),
    } as VcsServerSession;
}

function panel(overrides: Partial<VersionSurface> = {}) {
    const onClose = vi.fn();
    const surface = {
        authorName: "Ada Blackwood",
        busy: null,
        failure: null,
        remote: `${ONE}/my-game`,
        remoteNeedsSignIn: false,
        repositoryId: "abc",
        syncState: null,
        serverSession: null,
        signIn: null,
        checkRemote: vi.fn(),
        setRemote: vi.fn(() => Promise.resolve(true)),
        publish: vi.fn(() => Promise.resolve(true)),
        setAuthorName: vi.fn(() => Promise.resolve(true)),
        signInToServer: vi.fn(() => Promise.resolve(true)),
        signOutOfServer: vi.fn(() => Promise.resolve()),
        ...overrides,
    } as unknown as VersionSurface;
    render(<TeamPanel surface={surface} isOpen onClose={onClose} />);
    return { surface, onClose };
}

/** The panel's action rows, in the order they are offered. */
function actions(): string[] {
    return [...document.querySelectorAll("[data-team-action]")].map(row => row.textContent ?? "");
}

function action(label: string): HTMLElement {
    const row = [...document.querySelectorAll<HTMLElement>("[data-team-action]")]
        .find(node => node.textContent === label);
    if (row === undefined) throw new Error(`no action row "${label}" on screen`);
    return row;
}

function seam(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-team-seam='${name}']`);
}

describe("what the Team panel holds", () => {
    it("offers every act the rail gave up, for a project already on a server", () => {
        panel();

        expect(actions()).toEqual([
            "workspace.shell.versionControl.server.change",
            "workspace.shell.versionControl.server.check",
            "workspace.shell.team.manage",
            "workspace.shell.versionControl.server.disconnect",
        ]);
    });

    it("offers connecting, and nothing about a server, for a project on none", () => {
        panel({ remote: null });

        // Checking and disconnecting are acts on a destination that does not exist yet. Drawn
        // disabled they would be two controls for leaving a state nobody has entered.
        expect(actions()).toEqual([
            "workspace.shell.versionControl.server.connect",
            "workspace.shell.team.manage",
        ]);
    });

    it("names the server, with the address under it rather than instead of it", () => {
        panel({ serverSession: session("ada", "Blackwood Studio") });

        expect(seam("server-name")?.textContent).toBe("Blackwood Studio");
        expect(seam("destination")?.textContent).toContain(`${ONE}/my-game`);
    });

    it("falls back to the address for a server that gave no name", () => {
        panel();

        expect(seam("server-name")?.textContent).toBe("one.example.lan:41337");
    });

    it("says where the last check left things, without asking on its own", () => {
        const { surface } = panel({
            syncState: {
                remoteAvailable: true,
                remoteAuthorized: true,
                remoteBranchExists: true,
                localAhead: true,
                remoteAhead: false,
            },
        });

        expect(seam("server-state")?.textContent)
            .toBe("workspace.shell.versionControl.server.state.localAhead");
        // Opening the panel is a local read. Reaching the server costs up to two seconds against a
        // host that does not answer, so it happens when the row is pressed and never before.
        expect(surface.checkRemote).not.toHaveBeenCalled();

        fireEvent.click(action("workspace.shell.versionControl.server.check"));
        expect(surface.checkRemote).toHaveBeenCalledTimes(1);
    });

    it("disconnects, and closes once the address is gone", async () => {
        const { surface, onClose } = panel();

        fireEvent.click(action("workspace.shell.versionControl.server.disconnect"));

        expect(surface.setRemote).toHaveBeenCalledWith(null);
        await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("opens the server dialog from the change row, over the top of itself", () => {
        panel();

        expect(document.querySelector("[data-vcs-seam='server-picker']")).toBeNull();
        fireEvent.click(action("workspace.shell.versionControl.server.change"));

        // Both are still mounted: this one is what the author comes back to when the picker
        // closes, and it is where the server they just chose is read.
        expect(document.querySelector("[data-vcs-seam='server-picker']")).not.toBeNull();
        expect(document.querySelector("[data-team-panel]")).not.toBeNull();
    });

    it("sends the machine's own list to Settings, where a server is added once", () => {
        const { onClose } = panel();

        fireEvent.click(action("workspace.shell.team.manage"));

        expect(bridge.launchSettings)
            .toHaveBeenCalledWith({ highlight: SERVERS_PANEL_SETTING_KEY });
        expect(onClose).toHaveBeenCalled();
    });
});

/**
 * Who the next version is recorded as, which the panel answers in one of two shapes.
 *
 * `VcsManager.resolveIdentity` prefers a session's account over anything in settings, so the two
 * are never both on screen: a name field beside a signed-in account is a field nothing reads.
 */
describe("the account the Team panel names", () => {
    it("states the account a session signs versions with, and offers leaving it", () => {
        const { surface } = panel({ serverSession: session("ada", "Blackwood Studio") });

        expect(seam("account")?.textContent)
            .toContain("workspace.shell.versionControl.server.signIn.signedInAs");
        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();

        fireEvent.click(seam("sign-out")!);
        expect(surface.signOutOfServer).toHaveBeenCalledTimes(1);
    });

    it("states the name in settings where no session governs it, answered or not", () => {
        panel({ serverSession: null });

        // `always`: in the commit form this row is a prompt that goes once somebody answers it.
        // Here it is the panel's subject, so it states the name it holds.
        const field = document.querySelector<HTMLInputElement>("[data-vcs-seam='author-identity'] input");
        expect(field?.value).toBe("Ada Blackwood");
    });

    it("offers the token form for a server nobody is signed in to", () => {
        panel({ serverSession: null });

        // Behind a press rather than in front of one: most servers ask nobody who they are, and
        // a token box drawn for every project is a mandatory-looking field most authors never
        // need to answer.
        expect(document.querySelector("[data-vcs-seam='sign-in-form']")).toBeNull();
        fireEvent.click([...document.querySelectorAll<HTMLElement>("button")]
            .find(node => node.textContent === "workspace.shell.versionControl.server.signIn.open")!);

        expect(document.querySelector("[data-vcs-seam='sign-in-form']")).not.toBeNull();
    });

    it("offers it too where a connect was refused for want of one, which has no other way out", () => {
        // Nothing was written, so there is no server line to hang a sign-in beside - which is the
        // state this case exists for. The refusal is said, and the form is under it.
        panel({ remote: null, remoteNeedsSignIn: true });

        expect(seam("account")?.textContent)
            .toContain("workspace.shell.versionControl.server.signIn.required");
    });
});
