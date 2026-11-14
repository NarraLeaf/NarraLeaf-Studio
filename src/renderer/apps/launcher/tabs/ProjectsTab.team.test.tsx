// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VcsLocalRepository, VcsServerSession } from "@shared/types/vcs";

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
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: bridge.servers } }),
            listLocalRepositories: () => Promise.resolve({ success: true, data: { repositories: bridge.repositories } }),
            detachRecentProject: bridge.detach,
        },
        app: { trashRecentProject: bridge.trash },
        workspace: { launch: bridge.launch },
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
