// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VcsLocalRepository, VcsServerProject, VcsServerSession } from "@shared/types/vcs";

/**
 * A team project in the launcher's list: marked as one, and refused at the door once this machine
 * is disconnected from its server - with converting and deleting offered in place of opening.
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

const ORIGIN = "lore://team.example.lan:41337";
const PROJECT = { name: "Shared Game", path: "/projects/shared" };

const bridge = vi.hoisted(() => ({
    servers: [] as VcsServerSession[],
    repositories: [] as VcsLocalRepository[],
    launch: vi.fn(() => Promise.resolve()),
    detach: vi.fn(() => Promise.resolve({ success: true, data: undefined })),
    trash: vi.fn(() => Promise.resolve({ success: true, data: undefined })),
    serverProjects: [] as VcsServerProject[],
    listServerProjects: vi.fn((_remoteOrigin: string) => Promise.resolve()),
    launchProjectWizard: vi.fn<(props: unknown) => Promise<unknown>>(() => Promise.resolve({ success: true, data: null })),
    settings: {} as Record<string, unknown>,
}));

vi.mock("@/lib/settings/useGlobalSetting", () => ({
    useGlobalSetting: (key: string, resolve: (stored: unknown) => unknown) => resolve(bridge.settings[key]),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: bridge.servers } }),
            listLocalRepositories: () => Promise.resolve({ success: true, data: { repositories: bridge.repositories } }),
            detachRecentProject: bridge.detach,
        },
        app: { trashRecentProject: bridge.trash, launchProjectWizard: bridge.launchProjectWizard },
        workspace: { launch: bridge.launch },
        team: {
            open: (remoteOrigin: string) => Promise.resolve({
                success: true,
                data: { remoteOrigin, state: "idle", capabilities: [], since: 0 },
            }),
            connections: () => Promise.resolve({ success: true, data: { connections: [] } }),
            subscribe: () => Promise.resolve({ success: true, data: { ok: false, problem: { kind: "unsupported" } } }),
            unsubscribe: () => Promise.resolve({ success: true, data: undefined }),
            onEvent: () => ({ cancel: () => undefined }),
            onConnectionChanged: () => ({ cancel: () => undefined }),
            call: async (remoteOrigin: string, method: string) => {
                if (method !== "projects.list") return { success: true, data: { ok: false, problem: { kind: "unsupported" } } };
                await bridge.listServerProjects(remoteOrigin);
                return { success: true, data: { ok: true, value: { projects: bridge.serverProjects } } };
            },
        },
    }),
}));

vi.mock("@/lib/app/hooks/useRecentProjects", () => ({
    useRecentProjects: () => [PROJECT],
    useRemoveRecentProject: () => vi.fn(),
    useRevealRecentProject: () => vi.fn(),
    useRecentProjectIcons: () => new Map(),
    useMissingRecentProjects: () => new Map(),
}));

vi.mock("@/lib/app/hooks/useHomeDir", () => ({ useHomeDir: () => undefined }));

import { ProjectsTab } from "./ProjectsTab";

beforeEach(() => {
    bridge.repositories = [{ ...PROJECT, remoteOrigin: ORIGIN }];
    bridge.servers = [];
    bridge.launch.mockClear();
    bridge.detach.mockClear();
    bridge.trash.mockClear();
    bridge.serverProjects = [];
    bridge.listServerProjects.mockClear();
    bridge.launchProjectWizard.mockClear();
    bridge.settings = {};
});

afterEach(cleanup);

function row(): HTMLElement {
    return screen.getByText(PROJECT.name).closest("button") as HTMLElement;
}

describe("a team project in the launcher", () => {
    it("is marked as one", async () => {
        bridge.servers = [{ remoteOrigin: ORIGIN, name: "Blackwood Studio" } as VcsServerSession];
        render(<ProjectsTab />);

        await waitFor(() => expect(document.querySelector("[data-recent-team='connected']")).not.toBeNull());
        expect(document.querySelector("[data-recent-team]")?.getAttribute("data-tip"))
            .toBe("launcher.projects.team.on(Blackwood Studio)");
    });

    it("opens while this machine is connected to its server", async () => {
        bridge.servers = [{ remoteOrigin: ORIGIN, name: "Blackwood Studio" } as VcsServerSession];
        render(<ProjectsTab />);

        fireEvent.click(row());
        await waitFor(() => expect(bridge.launch).toHaveBeenCalledWith({ projectPath: PROJECT.path }, true));
    });

    it("does not open once disconnected, and offers converting or deleting instead", async () => {
        render(<ProjectsTab />);
        await waitFor(() => expect(document.querySelector("[data-recent-team='disconnected']")).not.toBeNull());
        expect(screen.getByText("launcher.projects.team.signedOut(team.example.lan:41337)")).toBeTruthy();

        fireEvent.click(row());
        await screen.findByText("launcher.projects.team.gate.title");
        expect(bridge.launch).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("launcher.projects.team.gate.detach"));
        await waitFor(() => expect(bridge.detach).toHaveBeenCalledWith(PROJECT.path));
    });

    it("asks again before moving the folder to the trash", async () => {
        render(<ProjectsTab />);
        await waitFor(() => expect(document.querySelector("[data-recent-team='disconnected']")).not.toBeNull());

        fireEvent.click(row());
        fireEvent.click(await screen.findByText("launcher.projects.team.gate.delete"));
        expect(bridge.trash).not.toHaveBeenCalled();

        fireEvent.click(await screen.findByText("launcher.projects.team.deleteConfirm.confirm"));
        await waitFor(() => expect(bridge.trash).toHaveBeenCalledWith(PROJECT.path));
    });
});

/** Sixteen bytes as hex, which is what `.lore/id` holds and what a server lists. */
const SHARED_ID = "019fda5ba4fe799096aaab7585aa4722";
const OTHER_ID = "029fda5ba4fe799096aaab7585aa4733";
const NEWER_ID = "039fda5ba4fe799096aaab7585aa4744";

function signedIn(): VcsServerSession {
    return {
        authUrl: "https://team.example.lan:54080",
        remoteOrigin: ORIGIN,
        name: "Blackwood Studio",
        account: {
            userId: "u-1",
            displayName: "Ada Blackwood",
            username: "ada",
            email: "ada@example.com",
            identity: "Ada Blackwood <ada@example.com>",
            expiresAt: 0,
        },
        signedInAt: 1,
    };
}

function serverProject(id: string, name: string, lastAt: number): VcsServerProject {
    return {
        id,
        name,
        description: "",
        createdAt: 0,
        remote: `${ORIGIN}/${name.toLowerCase().replace(/ /g, "-")}`,
        history: { revisions: 2, lastAt },
    };
}

function unclonedIds(): string[] {
    return [...document.querySelectorAll("[data-uncloned-project]")]
        .map(row => row.getAttribute("data-uncloned-project") ?? "");
}

/**
 * Under `team.projectsPlacement = "projects"`, the default, the home list also carries the team
 * projects on the account's server that this machine has no copy of yet - after its own, newest
 * first, and asking before cloning one.
 */
describe("team projects not yet cloned", () => {
    beforeEach(() => {
        bridge.servers = [signedIn()];
        bridge.repositories = [{ ...PROJECT, repositoryId: SHARED_ID, remoteOrigin: ORIGIN }];
        bridge.serverProjects = [
            serverProject(SHARED_ID, "Shared Game", 5),
            serverProject(OTHER_ID, "Older Tale", 10),
            serverProject(NEWER_ID, "Newer Tale", 20),
        ];
    });

    it("are listed after this machine's projects, the most recently changed first", async () => {
        render(<ProjectsTab />);

        await waitFor(() => expect(unclonedIds()).toEqual([NEWER_ID, OTHER_ID]));
        const group = document.querySelector("[data-projects-uncloned]")!;
        expect(group.textContent).toContain("launcher.projects.team.uncloned(Blackwood Studio)");
        // After the row for the copy that is here, not before it.
        expect(row().compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("count a personal copy with the same id as not cloned", async () => {
        // Converted to a personal project: same `.lore/id`, no longer pointed at the server.
        bridge.repositories = [{ ...PROJECT, repositoryId: SHARED_ID }];
        render(<ProjectsTab />);

        await waitFor(() => expect(unclonedIds()).toEqual([NEWER_ID, OTHER_ID, SHARED_ID]));
    });

    it("ask before cloning, and hand the wizard the project's address", async () => {
        render(<ProjectsTab />);

        fireEvent.click(await waitFor(() => {
            const node = document.querySelector<HTMLElement>(`[data-uncloned-project='${NEWER_ID}']`);
            if (node === null) throw new Error("no row");
            return node;
        }));
        await screen.findByText("launcher.projects.team.clone.title");
        expect(bridge.launchProjectWizard).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("launcher.projects.team.clone.confirm"));
        await waitFor(() => expect(bridge.launchProjectWizard)
            .toHaveBeenCalledWith({ remoteUrl: `${ORIGIN}/newer-tale` }));
    });

    it("open their details from the row's menu", async () => {
        render(<ProjectsTab />);

        const target = await waitFor(() => {
            const node = document.querySelector<HTMLElement>(`[data-uncloned-project='${OTHER_ID}']`);
            if (node === null) throw new Error("no row");
            return node;
        });
        fireEvent.contextMenu(target);
        fireEvent.click(await screen.findByText("launcher.projects.team.details"));
        await waitFor(() => expect(document.querySelector(`[data-projects-detail='${OTHER_ID}']`)).not.toBeNull());
    });

    it("stay on the Team tab when the setting puts them there", async () => {
        bridge.settings = { "team.projectsPlacement": "team" };
        render(<ProjectsTab />);

        await screen.findByText(PROJECT.name);
        await waitFor(() => expect(document.querySelector("[data-recent-team='connected']")).not.toBeNull());
        expect(bridge.listServerProjects).not.toHaveBeenCalled();
        expect(document.querySelector("[data-projects-uncloned]")).toBeNull();
    });
});

describe("the add button", () => {
    it("offers a team project on the account's server beside a project here", async () => {
        bridge.servers = [signedIn()];
        render(<ProjectsTab />);
        await waitFor(() => expect(bridge.listServerProjects).toHaveBeenCalled());

        fireEvent.click(document.querySelector("[data-projects-action='add']")!);
        expect(await screen.findByText("launcher.projects.team.newOn(Blackwood Studio)")).toBeTruthy();
        expect(screen.getAllByText("launcher.projects.addProject").length).toBeGreaterThan(0);
        expect(bridge.launchProjectWizard).not.toHaveBeenCalled();
    });

    it("goes straight to the wizard with no Team server signed in", async () => {
        render(<ProjectsTab />);
        await screen.findByText(PROJECT.name);

        fireEvent.click(document.querySelector("[data-projects-action='add']")!);
        await waitFor(() => expect(bridge.launchProjectWizard).toHaveBeenCalled());
    });
});
