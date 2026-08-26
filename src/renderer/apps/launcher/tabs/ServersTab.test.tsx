// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    launchProjectWizard: vi.fn<(props: unknown) => Promise<unknown>>(() => Promise.resolve({ success: true, data: null })),
    publishProject: vi.fn(),
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
            publishProject: bridge.publishProject,
        },
        app: {
            launchSettings: bridge.launchSettings,
            launchProjectWizard: bridge.launchProjectWizard,
        },
        workspace: { launch: bridge.launchWorkspace },
        // The projects list, the roster and one project's detail all go over the session
        // now, so `team.call` is where they are answered. It dispatches to the same per-
        // method fakes the REST wrappers used, and reshapes their answer into what the wire
        // carries - the collection under its own key, or a coded problem - so a test still
        // drives one method and asserts on one fake, and the transport is what changed.
        team: {
            open: () => Promise.resolve({
                success: true,
                data: { remoteOrigin: "", state: "idle", capabilities: [], since: 0 },
            }),
            connections: () => Promise.resolve({ success: true, data: { connections: [] } }),
            call: async (remoteOrigin: string, method: string, params?: { project?: string }) => {
                const problem = (kind: string, detail = ""): { kind: string; code?: string; detail?: string } => {
                    switch (kind) {
                        case "unreachable": return { kind: "offline", detail };
                        case "no-token": return { kind: "no-token" };
                        case "refused": return { kind: "refused", code: "refused", detail };
                        case "rejected": return { kind: "refused", code: "internal", detail };
                        default: return { kind: "unsupported" };
                    }
                };
                const answer = (
                    outcome: { success: boolean; data?: { ok: boolean; problem?: { kind: string; detail?: string } } },
                    value: unknown,
                ) => {
                    if (!outcome?.success) return { success: true, data: { ok: false, problem: { kind: "offline", detail: "" } } };
                    return outcome.data!.ok
                        ? { success: true, data: { ok: true, value } }
                        : { success: true, data: { ok: false, problem: problem(outcome.data!.problem!.kind, outcome.data!.problem!.detail) } };
                };
                if (method === "projects.list") {
                    const out = await bridge.listServerProjects(remoteOrigin);
                    return answer(out, { projects: out?.data?.projects });
                }
                if (method === "members.list") {
                    const out = await bridge.listServerMembers(remoteOrigin);
                    return answer(out, { members: out?.data?.members });
                }
                if (method === "projects.get") {
                    const out = await bridge.getServerProject(remoteOrigin, params?.project);
                    return answer(out, out?.data?.detail);
                }
                if (method === "projects.history") {
                    const out = await bridge.listServerProjectHistory(remoteOrigin, params?.project);
                    return answer(out, out?.data?.page);
                }
                return { success: true, data: { ok: false, problem: { kind: "unsupported" } } };
            },
            subscribe: () => Promise.resolve({
                success: true,
                data: { ok: false, problem: { kind: "unsupported" } },
            }),
            unsubscribe: () => Promise.resolve({ success: true, data: undefined }),
            onEvent: () => ({ cancel: () => undefined }),
            onConnectionChanged: () => ({ cancel: () => undefined }),
        },
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
    bridge.publishProject.mockReset();
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

/**
 * On screen, rather than merely in the document.
 *
 * The tab's three views share one region and the two that are not current are put away
 * rather than taken down - the roster is read once and kept, the list keeps where it was
 * scrolled to. So finding a node says nothing about whether anybody can see it.
 */
function visible(selector: string): boolean {
    const node = document.querySelector<HTMLElement>(selector);
    return node !== null && node.closest(".hidden") === null;
}

/**
 * How many scrolling boxes a reader can see at once.
 *
 * The window is 800x500 and cannot be resized, so this is the number the layout lives or
 * dies by: two of these inside 300 pixels is what made the old tab unreadable, and it is
 * the thing that comes back first the next time something is added to this screen.
 */
function visibleScrollers(): number {
    return [...document.querySelectorAll<HTMLElement>(".overflow-y-auto")]
        .filter(node => node.closest(".hidden") === null)
        .length;
}

/**
 * Every filled control a reader can see, named by what it does.
 *
 * The screen is allowed one, and which one it is depends on which view is on: this is the
 * assertion behind "one primary control at a time". Filled means the brand fill, which is
 * what `Button variant="primary"` writes; the chosen server's chip is `bg-primary/15` and
 * the active tab's underline is a span, so neither is counted as a control.
 */
function filledControls(): string[] {
    return [...document.querySelectorAll<HTMLElement>("button.bg-primary")]
        .filter(node => node.closest(".hidden") === null)
        .map(node => node.getAttribute("data-servers-action")
            ?? node.getAttribute("data-project-action")
            ?? "unnamed");
}

/**
 * Open one project's page, which is where the act on it lives.
 *
 * A row used to end in Open or Get and now it does not: the row is one target and it leads
 * here, so a test about what happens to a project starts by going to the project.
 */
async function openPage(id = REPOSITORY): Promise<void> {
    fireEvent.click(await find(`[data-server-project='${id}']`));
    await find("[data-server-project-detail]");
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

        await openPage();
        fireEvent.click(await find("[data-project-action='open']"));
        // The path the history remembers, spelled as the author has it - never the id.
        expect(bridge.launchWorkspace).toHaveBeenCalledWith({ projectPath: "D:/games/Renamed Folder" }, true);
    });

    it("offers to fetch one whose name matches and whose repository does not", async () => {
        // The case a name match would get wrong: same name, different work.
        open([project()], [{ path: "D:/games/Moonlit", name: "Moonlit", repositoryId: "ffffffffffffffffffffffffffffffff" }]);

        await openPage();
        expect(document.querySelector("[data-project-action='open']")).toBeNull();
        fireEvent.click(await find("[data-project-action='get']"));
        // Into the wizard's clone flow with the address filled in; no clone happens here.
        await waitFor(() => expect(bridge.launchProjectWizard)
            .toHaveBeenCalledWith({ remoteUrl: `${ORIGIN}/moonlit` }));
    });

    it("offers to fetch one whose local copy has no readable id", async () => {
        // A folder with no `.lore/id`, or one that could not be read. There is nothing to
        // match on, and fetching a copy is the answer that cannot open the wrong project.
        open([project()], [{ path: "D:/games/Moonlit", name: "Moonlit" }]);

        await openPage();
        expect(await find("[data-project-action='get']")).not.toBeNull();
        expect(document.querySelector("[data-project-action='open']")).toBeNull();
    });

    /**
     * One act, one appearance.
     *
     * Open and Get are the same act at the same level - do something with this project - and
     * they were drawn at two weights, filled and ghost, so the answer to "is this already
     * here" arrived as a difference in how loud a button was. The only thing that may differ
     * between them now is the word.
     */
    it("draws the two words as one control", async () => {
        open([project()], [{ path: "D:/games/Moonlit", name: "Moonlit", repositoryId: REPOSITORY }]);
        await openPage();
        const opening = (await find("[data-project-action='open']")).className;

        cleanup();
        open([project()]);
        await openPage();
        const getting = (await find("[data-project-action='get']")).className;

        expect(getting).toBe(opening);
    });

    /**
     * A project with nothing in it is not a project to fetch.
     *
     * Cloning a repository with no revisions succeeds and writes a `.lore` directory and
     * nothing else, which the wizard then verifies and reports as "not a NarraLeaf
     * project" - over a folder it has just filled, so the second attempt is refused as
     * well. The answer is not to offer the copy, and to say why on the row.
     */
    it("offers no copy of a project the server has read and found nothing in", async () => {
        open([project({ history: { revisions: 0, branch: "main" } })]);

        await waitFor(() => expect(rowText()).toContain("launcher.servers.nothingSent"));
        await openPage();
        expect(document.querySelector("[data-project-action='get']")).toBeNull();
        expect(document.querySelector("[data-project-action='open']")).toBeNull();
    });

    it("still offers a copy where the server never gave a count", async () => {
        // Absent is not zero: this is a project registered a moment ago and full of work,
        // whose server has not read it yet.
        open([project({ history: {} })]);

        await waitFor(() => expect(rowText()).toContain("Moonlit"));
        expect(rowText()).not.toContain("launcher.servers.nothingSent");
        await openPage();
        expect(await find("[data-project-action='get']")).not.toBeNull();
    });

    it("opens the copy on this machine even where the server has read nothing", async () => {
        // Somebody made it here and has not sent it yet. The folder is a project.
        open(
            [project({ history: { revisions: 0 } })],
            [{ path: "D:/games/Moonlit", name: "Moonlit", repositoryId: REPOSITORY }],
        );

        await openPage();
        expect(await find("[data-project-action='open']")).not.toBeNull();
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

    it("adds a server here rather than sending somebody to Settings for it", async () => {
        render(<ServersTab />);

        fireEvent.click(await find("[data-servers-action='manage']"));

        // The one sequence, mounted where it was asked for. Settings still keeps the list
        // of what this installation is signed in to; it is no longer where adding lives,
        // so nothing here opens another window to get at it.
        await waitFor(() => expect(document.querySelector("[data-servers-seam='wizard-step-1']")).not.toBeNull());
        expect(bridge.launchSettings).not.toHaveBeenCalled();
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

        // A row still leads to the project's page, because that is where the one act on a
        // project lives and a row that goes nowhere on some servers is a row nobody can
        // read. What a capability decides is what is *asked*, and here nothing is: the page
        // is written from what the list already carried.
        await openPage();
        expect(bridge.getServerProject).not.toHaveBeenCalled();
        expect(bridge.listServerProjectHistory).not.toHaveBeenCalled();
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
        open([project()], [], ["session"]);

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
        open([project()], [], ["session", "project-history"]);

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
        open([project()], [], ["session"]);

        await waitFor(() => expect(bridge.listServerMembers).toHaveBeenCalledTimes(1));
        fireEvent.click(await find("[data-project-action='select']"));
        await waitFor(() => expect(document.querySelector("[data-project-unread]")).not.toBeNull());
        fireEvent.click(document.querySelector("[data-project-action='back']")!);

        await waitFor(() => expect(document.querySelector("[data-server-project-detail]")).toBeNull());
        // The list was put away, not taken down: going back is not a second visit.
        expect(bridge.listServerMembers).toHaveBeenCalledTimes(1);
        expect(bridge.listServerProjects).toHaveBeenCalledTimes(1);
    });

    /**
     * A row is one target, and the whole of it is that target.
     *
     * It used to be two: a button around the name that opened the project, and a second one
     * at the end that opened the copy on this disk or fetched one. Nothing said which was
     * which, so a reader aiming for the name landed on the act, and the act moved the
     * window out from under them. The act now lives on the project's own page.
     */
    it("gives a row one target and puts the act on the page it leads to", async () => {
        bridge.getServerProject.mockResolvedValue({
            success: true, data: { ok: true, detail: { project: project(), file: { readable: false } } },
        });
        open([project()], [{ path: "D:/games/Moonlit", name: "Moonlit", repositoryId: REPOSITORY }],
            ["projects", "project-detail"]);

        const row = await find(`[data-server-project='${REPOSITORY}']`);
        expect(row.getAttribute("data-project-action")).toBe("select");
        // Nothing inside it to hit instead of it.
        expect(row.querySelector("button")).toBeNull();
        expect(document.querySelector("[data-project-action='open']")).toBeNull();

        await openPage();
        fireEvent.click(await find("[data-project-action='open']"));
        expect(bridge.launchWorkspace).toHaveBeenCalledWith({ projectPath: "D:/games/Moonlit" }, true);
    });
});

/**
 * What is loud on this screen, and what a reader's eye is meant to land on.
 *
 * The tab used to draw five species of control in one 36px band and two filled-ish buttons
 * competing in it, so nothing on it was the primary thing. There is now one filled control
 * at a time and it belongs to the view on screen.
 */
describe("one primary control", () => {
    it("hands the weight from the server's act to the project's while a project is open", async () => {
        bridge.getServerProject.mockResolvedValue({
            success: true, data: { ok: true, detail: { project: project(), file: { readable: false } } },
        });
        open([project()], [], ["projects", "project-detail"]);

        await find("[data-server-project]");
        expect(filledControls()).toEqual(["new-project"]);

        await openPage();
        expect(filledControls()).toEqual(["get"]);
    });

    it("leaves the reference view with none, because it has nothing to act on", async () => {
        bridge.listServerMembers.mockResolvedValue({ success: true, data: { ok: true, members: [] } });
        open([project()], [], ["session"]);

        await find("[data-server-project]");
        fireEvent.click(await find("[data-servers-action='people']"));

        expect(filledControls()).toEqual([]);
    });
});

/**
 * The two views of one server, said as two views rather than as a command.
 *
 * People was a ghost button that turned secondary when it was on, standing between an icon
 * button and a filled one - a fourth command in a row of commands, with nothing saying it
 * was a place. It is a tab now, and the tab is where a reader looks to find out where they
 * are.
 */
describe("the two views of a server", () => {
    it("names them on one strip and marks the one on screen", async () => {
        bridge.listServerMembers.mockResolvedValue({ success: true, data: { ok: true, members: [] } });
        open([project()], [], ["session"]);

        const strip = await find("[data-servers-views] [role='tablist']");
        const selected = () => [...strip.querySelectorAll("[role='tab']")]
            .map(tab => tab.getAttribute("aria-selected"));

        expect(selected()).toEqual(["true", "false"]);
        fireEvent.click(await find("[data-servers-action='people']"));
        expect(selected()).toEqual(["false", "true"]);
    });

    it("draws no strip where the server has only the one view", async () => {
        open([project()], [], ["projects"]);

        await waitFor(() => expect(bridge.listServerProjects).toHaveBeenCalled());
        // One tab is not a choice, the same reading a strip of one server takes. The rule
        // stays, and so does the one act that is about neither view.
        expect(document.querySelector("[data-servers-views] [role='tablist']")).toBeNull();
        expect(document.querySelector("[data-servers-views]")).not.toBeNull();
        expect(document.querySelector("[data-servers-action='manage']")).not.toBeNull();
    });
});

/**
 * The roster, which is reference material and is treated as such.
 *
 * It used to be a capped box under the project list, which cost every reading of the
 * projects a list of colleagues nobody was reading - on this window, the difference
 * between six project rows and two. It is now somewhere a reader goes, by a tab that stays
 * on screen and lit while they are there.
 */
describe("who else is on the server", () => {
    const ROSTER = {
        success: true,
        data: { ok: true, members: [{
            username: "ada",
            displayName: "Ada Lovelace",
            email: "ada@nomen.example",
            operator: false,
            disabled: false,
            serviceAccount: false,
        }] },
    };

    it("keeps the roster off the screen until it is asked for", async () => {
        bridge.listServerMembers.mockResolvedValue(ROSTER);
        open([project()], [], ["session"]);

        // Read with the projects: a reader who presses the control would otherwise be
        // paying for a second visit to the server to see what was already answered.
        await waitFor(() => expect(bridge.listServerMembers).toHaveBeenCalledTimes(1));
        expect(visible("[data-server-people]")).toBe(false);
        expect(visible("[data-server-project]")).toBe(true);
        expect(visibleScrollers()).toBe(1);

        fireEvent.click(await find("[data-servers-action='people']"));

        expect(visible("[data-server-people]")).toBe(true);
        expect(visible("[data-server-project]")).toBe(false);
        expect(visibleScrollers()).toBe(1);
    });

    it("comes back by the other tab, to the project that was open", async () => {
        bridge.listServerMembers.mockResolvedValue(ROSTER);
        bridge.getServerProject.mockResolvedValue({
            success: true, data: { ok: true, detail: { project: project(), file: { readable: false } } },
        });
        open([project()], [], ["session"]);

        fireEvent.click(await find("[data-project-action='select']"));
        await waitFor(() => expect(document.querySelector("[data-project-unread]")).not.toBeNull());
        expect(visibleScrollers()).toBe(1);

        const tab = (id: string) => document.querySelector(`[data-servers-action='${id}']`)!;
        fireEvent.click(tab("people"));
        expect(visible("[data-server-project-detail]")).toBe(false);

        fireEvent.click(tab("projects"));
        expect(visible("[data-server-project-detail]")).toBe(true);
        // Put away, not taken down: the project was not asked about a second time.
        expect(bridge.getServerProject).toHaveBeenCalledTimes(1);
    });

    it("offers nothing to press where the server holds no roster", async () => {
        open([project()], [], ["projects"]);

        await waitFor(() => expect(bridge.listServerProjects).toHaveBeenCalled());
        expect(document.querySelector("[data-servers-action='people']")).toBeNull();
    });
});

describe("which server is being read", () => {
    it("draws no strip for a list of one, and still says which one it is", async () => {
        open([project()]);

        await waitFor(() => expect(bridge.listServerProjects).toHaveBeenCalledWith(ORIGIN));
        // A column of servers costs 256 of the tab's 560 pixels, and with one server there
        // is nothing in it to choose between.
        expect(document.querySelector("[data-servers-strip]")).toBeNull();
        // Still named, and still the element that stands for that one choice.
        expect(document.body.textContent).toContain("Blackwood Studio");
        expect(document.querySelectorAll("[data-server-choice]")).toHaveLength(1);
    });

    it("names the chosen server once when the strip is carrying them", async () => {
        bridge.servers = [session(ORIGIN, "Blackwood"), session(OTHER, "Other")];
        bridge.listServerProjects.mockResolvedValue({ success: true, data: { ok: true, projects: [] } });
        render(<ServersTab />);

        await waitFor(() => expect(document.querySelector("[data-servers-strip]")).not.toBeNull());
        fireEvent.click(document.querySelector(`[data-server-choice='${ORIGIN}']`)!);

        await waitFor(() => expect(bridge.listServerProjects).toHaveBeenCalledWith(ORIGIN));
        // The strip carries them; the row under it is the server being read, not a third
        // copy of a choice already on screen.
        expect(document.querySelectorAll("[data-server-choice]")).toHaveLength(2);
    });

    it("adds another server from the header, without leaving the tab", async () => {
        open([project()]);

        fireEvent.click(await find("[data-servers-action='manage']"));

        await waitFor(() => expect(document.querySelector("[data-servers-seam='wizard-step-1']")).not.toBeNull());
        expect(bridge.launchSettings).not.toHaveBeenCalled();
    });
});

/**
 * Making a project for a server.
 *
 * **The order is the whole of it.** This used to ask the server for a project first and
 * then run the clone flow over what came back - a repository with no revisions, so what
 * landed was a `.lore` directory reported to the author as "not a NarraLeaf project", and
 * the empty project stayed on the server. So the project is written here first and the
 * server is told about it afterwards, and a wizard nobody finished leaves that server
 * exactly as it was.
 */
describe("making one for the server", () => {
    const CREATED = {
        success: true,
        data: {
            created: true,
            projectPath: "D:/games/moonlit",
            projectName: "Moonlit",
            // The name a machine can say, which is what a repository address carries.
            appId: "moonlit",
        },
    };

    it("writes the project here, then sends it, then opens it", async () => {
        open([]);
        bridge.launchProjectWizard.mockResolvedValue(CREATED);
        bridge.publishProject.mockResolvedValue({ success: true, data: { ok: true } });

        fireEvent.click(await find("[data-servers-action='new-project']"));

        await waitFor(() => expect(bridge.launchProjectWizard).toHaveBeenCalledWith({
            publishTo: { remoteOrigin: ORIGIN, server: "Blackwood Studio" },
        }));
        // The app id, not "Moonlit": `lore://host:port/<name>` cannot carry a space, and a
        // server refuses a name that is not spellable there.
        await waitFor(() => expect(bridge.publishProject)
            .toHaveBeenCalledWith("D:/games/moonlit", ORIGIN, "moonlit"));
        await waitFor(() => expect(bridge.launchWorkspace)
            .toHaveBeenCalledWith({ projectPath: "D:/games/moonlit" }, true));
    });

    it("asks the server for nothing when the wizard was cancelled", async () => {
        open([]);
        bridge.launchProjectWizard.mockResolvedValue({ success: true, data: null });

        fireEvent.click(await find("[data-servers-action='new-project']"));

        await waitFor(() => expect(bridge.launchProjectWizard).toHaveBeenCalled());
        expect(bridge.publishProject).not.toHaveBeenCalled();
        expect(bridge.launchWorkspace).not.toHaveBeenCalled();
    });

    it("keeps a project the server would not take, and offers to open it", async () => {
        open([]);
        bridge.launchProjectWizard.mockResolvedValue(CREATED);
        bridge.publishProject.mockResolvedValue({
            success: true, data: { ok: false, problem: { kind: "unreachable" } },
        });

        fireEvent.click(await find("[data-servers-action='new-project']"));

        // Not opened behind the author's back: the project is there, it is not on the
        // server, and the sentence that says so is what the button belongs to.
        await waitFor(() => expect(document.body.textContent)
            .toContain("launcher.servers.unsent.message(Moonlit|Blackwood Studio)"));
        expect(bridge.launchWorkspace).not.toHaveBeenCalled();

        fireEvent.click(await find("[data-servers-action='open-unsent']"));
        expect(bridge.launchWorkspace).toHaveBeenCalledWith({ projectPath: "D:/games/moonlit" }, true);
    });
});

/**
 * Taking a project off a server's list.
 *
 * A failed publish can leave a project on a server that nobody can do anything with, and
 * until now there was no way to be rid of it. The route is handed in rather than reached
 * for here, so a build without one draws no such action anywhere - not a disabled one, not
 * an explanation. Where there is one it is in the overflow on the project's own page,
 * behind a question that names the project and says what is and is not being removed.
 */
describe("getting rid of a project on the server", () => {
    const DETAIL = {
        success: true,
        data: { ok: true, detail: { project: project(), file: { readable: false } } },
    };

    /** The tab with a route in, on a server that answers for one project. */
    function openWith(onForget: (origin: string, entry: VcsServerProject) => Promise<boolean>) {
        bridge.servers = [session(ORIGIN, "Blackwood Studio", ["projects", "project-detail"])];
        bridge.getServerProject.mockResolvedValue(DETAIL);
        bridge.listServerProjects.mockResolvedValue({
            success: true, data: { ok: true, projects: [project()] },
        });
        render(<ServersTab onForget={onForget} />);
    }

    it("offers nothing of the sort where no route was handed in", async () => {
        bridge.getServerProject.mockResolvedValue(DETAIL);
        open([project()], [], ["projects", "project-detail"]);

        await openPage();
        expect(document.querySelector("[data-project-action='more']")).toBeNull();
    });

    it("asks first, naming the project and the list it comes off", async () => {
        const forget = vi.fn(() => Promise.resolve(true));
        openWith(forget);

        await openPage();
        fireEvent.click(await find("[data-project-action='more']"));
        fireEvent.click(screen.getByText("launcher.servers.forget.action"));

        // The menu row asks; it does not do. Nothing has reached the server yet.
        expect(forget).not.toHaveBeenCalled();
        expect(document.body.textContent)
            .toContain("launcher.servers.forget.message(Moonlit|Blackwood Studio)");

        fireEvent.click(await find("[data-servers-action='forget']"));

        await waitFor(() => expect(forget)
            .toHaveBeenCalledWith(ORIGIN, expect.objectContaining({ id: REPOSITORY })));
        // Off the server's list, so off this one, and the page it was read on is closed
        // because there is no longer a project to read.
        await waitFor(() => expect(document.querySelector("[data-server-project]")).toBeNull());
        expect(document.querySelector("[data-server-project-detail]")).toBeNull();
    });

    it("says so and keeps the project where the server would not", async () => {
        const forget = vi.fn(() => Promise.resolve(false));
        openWith(forget);

        await openPage();
        fireEvent.click(await find("[data-project-action='more']"));
        fireEvent.click(screen.getByText("launcher.servers.forget.action"));
        fireEvent.click(await find("[data-servers-action='forget']"));

        await waitFor(() => expect(document.body.textContent)
            .toContain("launcher.servers.forget.failed"));
        // A refusal that closed the dialog would be a screen saying the project is gone.
        expect(document.querySelector("[data-server-project-detail]")).not.toBeNull();
    });

    it("keeps it out of the row, where nobody is aiming for it", async () => {
        openWith(vi.fn(() => Promise.resolve(true)));

        const row = await find(`[data-server-project='${REPOSITORY}']`);
        expect(row.textContent).not.toContain("launcher.servers.forget");
        expect(row.querySelector("[data-project-action='more']")).toBeNull();
    });
});
