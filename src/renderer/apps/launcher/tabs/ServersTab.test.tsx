// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVERS_PANEL_SETTING_KEY } from "@shared/constants/servers";
import type { VcsLocalRepository, VcsServerProject, VcsServerSession } from "@shared/types/vcs";
import { ServersTab, localCopyOf } from "./ServersTab";

/**
 * The tab answers one question per row: is this project already here, or is it not.
 *
 * Three things regress, and each of them reads as reasonable while it is being written.
 * A row that fills in a version count for a server that never gave one, because absent
 * looks like zero. A match on the project's name, because the name is the thing on the
 * row. And a second empty pane beside an empty list, because both panes are empty and
 * each of them has something to say about it.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.values(params).join("|")})` : key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        formatDate: (value: Date | number) => new Date(value).toISOString().slice(0, 10),
        locale: "en",
    }),
}));

const bridge = vi.hoisted(() => ({
    servers: [] as VcsServerSession[],
    projects: [] as VcsServerProject[],
    repositories: [] as VcsLocalRepository[],
    refreshServer: vi.fn(() => Promise.resolve({ success: true, data: { servers: [] } })),
    listServerProjects: vi.fn(),
    listServerMembers: vi.fn(),
    getServerProject: vi.fn(),
    listServerProjectHistory: vi.fn(),
    launchSettings: vi.fn(),
    launchWorkspace: vi.fn(() => Promise.resolve()),
    launchProjectWizard: vi.fn(() => Promise.resolve({ success: true, data: null })),
    createServerProject: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: bridge.servers } }),
            refreshServer: bridge.refreshServer,
            listServerProjects: bridge.listServerProjects,
            listServerMembers: bridge.listServerMembers,
            getServerProject: bridge.getServerProject,
            listServerProjectHistory: bridge.listServerProjectHistory,
            listLocalRepositories: () =>
                Promise.resolve({ success: true, data: { repositories: bridge.repositories } }),
            createServerProject: bridge.createServerProject,
        },
        app: {
            launchSettings: bridge.launchSettings,
            launchProjectWizard: bridge.launchProjectWizard,
        },
        workspace: { launch: bridge.launchWorkspace },
    }),
}));

const ORIGIN = "lore://team.example.lan:41337";
const OTHER = "lore://other.example.lan:41337";
/** Sixteen bytes as hex, which is what `.lore/id` holds and what a server lists. */
const REPOSITORY = "019fda5ba4fe799096aaab7585aa4722";

function session(origin = ORIGIN, name?: string, capabilities?: string[]): VcsServerSession {
    return {
        authUrl: "https://team.example.lan:41402",
        remoteOrigin: origin,
        account: {
            userId: "u-1",
            displayName: "Ada Blackwood",
            username: "ada",
            email: "ada@example.com",
            identity: "Ada Blackwood <ada@example.com>",
            expiresAt: 0,
        },
        signedInAt: 0,
        ...(name === undefined ? {} : { name }),
        ...(capabilities === undefined ? {} : { capabilities }),
    };
}

function project(overrides: Partial<VcsServerProject> = {}): VcsServerProject {
    return {
        id: REPOSITORY,
        name: "Moonlit",
        description: "",
        createdAt: 0,
        remote: `${ORIGIN}/moonlit`,
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    bridge.servers = [];
    bridge.projects = [];
    bridge.repositories = [];
    bridge.refreshServer.mockClear();
    bridge.listServerProjects.mockReset();
    bridge.listServerMembers.mockReset();
    bridge.getServerProject.mockReset();
    bridge.listServerProjectHistory.mockReset();
    bridge.launchSettings.mockClear();
    bridge.launchWorkspace.mockClear();
    bridge.launchProjectWizard.mockClear();
    bridge.createServerProject.mockReset();
});

/** One server, already chosen because a list of one is not a choice. */
function open(
    projects: VcsServerProject[],
    repositories: VcsLocalRepository[] = [],
    capabilities?: string[],
) {
    bridge.servers = [session(ORIGIN, "Blackwood Studio", capabilities)];
    bridge.repositories = repositories;
    bridge.listServerProjects.mockResolvedValue({ success: true, data: { ok: true, projects } });
    render(<ServersTab />);
}

/** Wait for one node and hand it back. `querySelector` alone answers null without throwing. */
function find(selector: string): Promise<HTMLElement> {
    return waitFor(() => {
        const node = document.querySelector<HTMLElement>(selector);
        if (node === null) throw new Error(`nothing matched ${selector}`);
        return node;
    });
}

function rowText(id = REPOSITORY): string {
    return document.querySelector(`[data-server-project='${id}']`)?.textContent ?? "";
}

describe("a project row", () => {
    it("says nothing about versions for a server that has not read the repository", async () => {
        // The shape a real server sends most often: recorded a moment ago, not yet read.
        open([project({ history: {} })]);

        await waitFor(() => expect(rowText()).toContain("Moonlit"));
        expect(rowText()).not.toContain("lastVersion");
        // The three ways an absent fact turns into an invented one.
        expect(rowText()).not.toContain("0");
        expect(rowText()).not.toContain("1970");
        expect(rowText()).not.toContain("never");
    });

    it("says nothing about versions for a server too old to carry the field at all", async () => {
        open([project()]);

        await waitFor(() => expect(rowText()).toContain("Moonlit"));
        expect(rowText()).not.toContain("lastVersion");
    });

    it("says when the last version was recorded, once a server has said so", async () => {
        open([project({ history: { lastAt: Date.UTC(2026, 7, 20), lastBy: "Ada Blackwood" } })]);

        await waitFor(() => expect(rowText()).toContain("launcher.servers.lastVersionBy"));
        expect(rowText()).toContain("2026-08-20");
        expect(rowText()).toContain("Ada Blackwood");
    });

    it("leaves the author out of the line when only the time was given", async () => {
        open([project({ history: { lastAt: Date.UTC(2026, 7, 20), revisions: 12 } })]);

        await waitFor(() => expect(rowText()).toContain("launcher.servers.lastVersion("));
        expect(rowText()).not.toContain("lastVersionBy");
    });
});

describe("open, or get", () => {
    it("offers to open a project this machine already holds, by repository id", async () => {
        open([project()], [{ path: "D:/games/Renamed Folder", name: "Renamed Folder", repositoryId: REPOSITORY }]);

        await waitFor(() => expect(document.querySelector("[data-project-action='open']")).not.toBeNull());
        fireEvent.click(document.querySelector("[data-project-action='open']")!);
        // The path the history remembers, spelled as the author has it - never the id.
        expect(bridge.launchWorkspace).toHaveBeenCalledWith({ projectPath: "D:/games/Renamed Folder" }, true);
    });

    it("offers to fetch one whose name matches and whose repository does not", async () => {
        // The case a name match would get wrong: same name, different work.
        open([project()], [{ path: "D:/games/Moonlit", name: "Moonlit", repositoryId: "ffffffffffffffffffffffffffffffff" }]);

        await waitFor(() => expect(document.querySelector("[data-project-action='get']")).not.toBeNull());
        expect(document.querySelector("[data-project-action='open']")).toBeNull();
        fireEvent.click(document.querySelector("[data-project-action='get']")!);
        // Into the wizard's clone flow with the address filled in; no clone happens here.
        await waitFor(() => expect(bridge.launchProjectWizard)
            .toHaveBeenCalledWith({ remoteUrl: `${ORIGIN}/moonlit` }));
    });

    it("offers to fetch one whose local copy has no readable id", async () => {
        // A folder with no `.lore/id`, or one that could not be read. There is nothing to
        // match on, and fetching a copy is the answer that cannot open the wrong project.
        open([project()], [{ path: "D:/games/Moonlit", name: "Moonlit" }]);

        await waitFor(() => expect(document.querySelector("[data-project-action='get']")).not.toBeNull());
        expect(document.querySelector("[data-project-action='open']")).toBeNull();
    });

    it("prefers the local copy pointed at the server being read", () => {
        const here: VcsLocalRepository = {
            path: "D:/games/here", name: "here", repositoryId: REPOSITORY, remoteOrigin: ORIGIN,
        };
        const elsewhere: VcsLocalRepository = {
            path: "D:/games/elsewhere", name: "elsewhere", repositoryId: REPOSITORY, remoteOrigin: OTHER,
        };

        expect(localCopyOf(project(), [elsewhere, here])).toBe(here);
    });

    it("matches an id however either side spelled its hex", () => {
        const local: VcsLocalRepository = {
            path: "D:/games/here", name: "here", repositoryId: REPOSITORY.toUpperCase(),
        };

        expect(localCopyOf(project(), [local])).toBe(local);
    });
});

describe("with no servers", () => {
    it("is one empty state rather than two empty panes", async () => {
        render(<ServersTab />);

        await waitFor(() => expect(document.querySelector("[data-servers-tab='empty']")).not.toBeNull());
        expect(document.querySelector("[data-servers-tab='list']")).toBeNull();
        expect(document.querySelectorAll("[data-servers-action='manage']")).toHaveLength(1);
    });

    it("opens Settings at the servers panel, which is where a server is added", async () => {
        render(<ServersTab />);

        fireEvent.click(await find("[data-servers-action='manage']"));

        expect(bridge.launchSettings).toHaveBeenCalledWith({ highlight: SERVERS_PANEL_SETTING_KEY });
    });

    it("asks no server anything, because there is none to ask", async () => {
        render(<ServersTab />);

        await waitFor(() => expect(document.querySelector("[data-servers-tab='empty']")).not.toBeNull());
        expect(bridge.refreshServer).not.toHaveBeenCalled();
        expect(bridge.listServerProjects).not.toHaveBeenCalled();
    });
});

describe("reaching a server", () => {
    it("asks it what it is once, and what it holds after", async () => {
        open([project()]);

        await waitFor(() => expect(bridge.listServerProjects).toHaveBeenCalledWith(ORIGIN));
        expect(bridge.refreshServer).toHaveBeenCalledTimes(1);
        expect(bridge.refreshServer).toHaveBeenCalledWith(ORIGIN);
    });

    it("does not reach a second server until one is chosen", async () => {
        bridge.servers = [session(ORIGIN, "Blackwood"), session(OTHER, "Other")];
        bridge.listServerProjects.mockResolvedValue({ success: true, data: { ok: true, projects: [] } });
        render(<ServersTab />);

        await waitFor(() => expect(document.querySelectorAll("[data-server-choice]")).toHaveLength(2));
        expect(bridge.refreshServer).not.toHaveBeenCalled();

        fireEvent.click(document.querySelector(`[data-server-choice='${OTHER}']`)!);
        await waitFor(() => expect(bridge.refreshServer).toHaveBeenCalledWith(OTHER));
        expect(bridge.refreshServer).toHaveBeenCalledTimes(1);
    });

    it("puts a server's refusal in words rather than showing an empty list", async () => {
        bridge.servers = [session()];
        bridge.listServerProjects.mockResolvedValue({
            success: true, data: { ok: false, problem: { kind: "unreachable" } },
        });
        render(<ServersTab />);

        await waitFor(() => expect(document.body.textContent)
            .toContain("launcher.servers.problem.unreachable"));
    });
});

describe("what a server offers", () => {
    it("asks for nothing a server did not say it serves", async () => {
        open([project()]);

        await waitFor(() => expect(bridge.listServerProjects).toHaveBeenCalled());
        expect(bridge.listServerMembers).not.toHaveBeenCalled();
        // Not an error and not an empty section: there is simply no roster on this screen.
        expect(document.querySelector("[data-server-people]")).toBeNull();
        expect(document.body.textContent).not.toContain("launcher.servers.people");
        // And with nothing to say about a project, its row does not open into anything.
        expect(document.querySelector("[data-project-action='select']")).toBeNull();
    });

    it("reads the roster of a server that offers one", async () => {
        bridge.listServerMembers.mockResolvedValue({
            success: true,
            data: { ok: true, members: [{
                username: "ada",
                displayName: "Ada Lovelace",
                email: "ada@nomen.example",
                operator: true,
                disabled: false,
                serviceAccount: false,
            }] },
        });
        open([project()], [], ["projects", "members"]);

        await waitFor(() => expect(bridge.listServerMembers).toHaveBeenCalledWith(ORIGIN));
        await waitFor(() => expect(document.querySelector("[data-server-member='ada']")).not.toBeNull());
        // Read with the list, drawn for nobody until somebody is opened.
        expect(document.body.textContent).not.toContain("ada@nomen.example");
    });

    it("opens a project into what the server knows, and back again", async () => {
        bridge.getServerProject.mockResolvedValue({
            success: true, data: { ok: true, detail: { project: project(), file: { readable: false } } },
        });
        bridge.listServerProjectHistory.mockResolvedValue({
            success: true, data: { ok: true, page: { more: false } },
        });
        open([project()], [], ["projects", "project-detail", "project-history"]);

        fireEvent.click(await find("[data-project-action='select']"));

        await waitFor(() => expect(bridge.getServerProject).toHaveBeenCalledWith(ORIGIN, REPOSITORY));
        // The state the deployment is in today: recorded, not read.
        await waitFor(() => expect(document.querySelector("[data-project-unread]")).not.toBeNull());

        fireEvent.click(document.querySelector("[data-project-action='back']")!);
        await waitFor(() => expect(document.querySelector("[data-server-project-detail]")).toBeNull());
        expect(document.querySelector("[data-server-project]")).not.toBeNull();
    });

    it("reads the roster once, however many projects are looked at", async () => {
        bridge.listServerMembers.mockResolvedValue({ success: true, data: { ok: true, members: [] } });
        bridge.getServerProject.mockResolvedValue({
            success: true, data: { ok: true, detail: { project: project(), file: { readable: false } } },
        });
        open([project()], [], ["projects", "members", "project-detail"]);

        await waitFor(() => expect(bridge.listServerMembers).toHaveBeenCalledTimes(1));
        fireEvent.click(await find("[data-project-action='select']"));
        await waitFor(() => expect(document.querySelector("[data-project-unread]")).not.toBeNull());
        fireEvent.click(document.querySelector("[data-project-action='back']")!);

        await waitFor(() => expect(document.querySelector("[data-server-project-detail]")).toBeNull());
        // The list was put away, not taken down: going back is not a second visit.
        expect(bridge.listServerMembers).toHaveBeenCalledTimes(1);
        expect(bridge.listServerProjects).toHaveBeenCalledTimes(1);
    });

    it("keeps the row's own action working where the row can also be opened", async () => {
        open([project()], [{ path: "D:/games/Moonlit", name: "Moonlit", repositoryId: REPOSITORY }],
            ["projects", "project-detail"]);

        fireEvent.click(await find("[data-project-action='open']"));

        expect(bridge.launchWorkspace).toHaveBeenCalledWith({ projectPath: "D:/games/Moonlit" }, true);
        // Opening the project on this disk is not opening the panel about it.
        expect(bridge.getServerProject).not.toHaveBeenCalled();
    });
});

describe("making one on the server", () => {
    it("creates it there, then opens the clone flow on what came back", async () => {
        open([]);
        bridge.createServerProject.mockResolvedValue({
            success: true,
            data: { ok: true, project: project({ id: "abc", name: "New", remote: `${ORIGIN}/new` }) },
        });

        fireEvent.click(await find("[data-servers-action='new-project']"));

        fireEvent.change(await find("input"), { target: { value: "New" } });
        fireEvent.click(document.querySelector("[data-servers-action='create']")!);

        await waitFor(() => expect(bridge.createServerProject).toHaveBeenCalledWith(ORIGIN, "New", undefined));
        await waitFor(() => expect(bridge.launchProjectWizard)
            .toHaveBeenCalledWith({ remoteUrl: `${ORIGIN}/new` }));
    });

    it("will not ask for a project with no name", async () => {
        open([]);

        fireEvent.click(await find("[data-servers-action='new-project']"));

        const submit = await find("[data-servers-action='create']") as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        fireEvent.click(submit);
        expect(bridge.createServerProject).not.toHaveBeenCalled();
    });
});
