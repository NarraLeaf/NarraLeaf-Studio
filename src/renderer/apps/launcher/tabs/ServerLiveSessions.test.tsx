// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamLiveSession } from "@shared/types/team";
import type { VcsLocalRepository, VcsServerProject } from "@shared/types/vcs";
import { JoinByPasscode, ProjectLiveSessions } from "./ServerLiveSessions";

/**
 * The launcher's half of joining a live session.
 *
 * ⚠ **The launcher cannot join on the workspace's behalf**, and everything here is about the
 * consequence of that: a room's membership is per instance, and a launcher window is a different
 * instance from the workspace it opens. So what these controls do is decide which room is meant,
 * fetch the project when this machine has never had it, and hand the intent to the window they
 * open - which is what each test asserts, rather than that anything joined.
 *
 * The passcode field is the half that cannot be reached any other way: a room joined by digits is
 * on no list, for anybody who is not already in it, so there is nothing to click instead.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            (params ? `${key}(${Object.values(params).join("|")})` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

const bridge = vi.hoisted(() => ({
    capabilities: ["live"] as string[],
    call: vi.fn(),
    launch: vi.fn(() => Promise.resolve({ success: true, data: undefined })),
    wizard: vi.fn(() => Promise.resolve({
        success: true,
        data: { created: true, projectPath: "D:/cloned/moonlit" },
    })),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        team: {
            open: () => Promise.resolve({
                success: true,
                data: {
                    remoteOrigin: ORIGIN,
                    state: bridge.capabilities.length > 0 ? "ready" : "idle",
                    capabilities: bridge.capabilities,
                    since: 1,
                },
            }),
            connections: () => Promise.resolve({ success: true, data: { connections: [] } }),
            call: bridge.call,
            subscribe: () => Promise.resolve({ success: true, data: { ok: true, seq: 0 } }),
            unsubscribe: () => Promise.resolve({ success: true, data: undefined }),
            onEvent: () => ({ cancel: () => undefined }),
            onConnectionChanged: () => ({ cancel: () => undefined }),
        },
        app: { launchProjectWizard: bridge.wizard },
        workspace: { launch: bridge.launch },
    }),
}));

type CallAnswer = { ok: true; value: unknown } | { ok: false; problem: unknown };
let dispatch: Record<string, CallAnswer> = {};

function applyDispatch(): void {
    bridge.call.mockImplementation((_origin: string, method: string) =>
        Promise.resolve({
            success: true,
            data: dispatch[method] ?? { ok: false, problem: { kind: "unsupported" } },
        }),
    );
}

const ORIGIN = "lore://team.example.lan:41337";
const PROJECT_ID = "019fda5ba4fe799096aaab7585aa4722";

function project(overrides: Partial<VcsServerProject> = {}): VcsServerProject {
    return {
        id: PROJECT_ID,
        name: "Moonlit",
        description: "A night on the water",
        createdAt: 0,
        remote: `${ORIGIN}/moonlit`,
        ...overrides,
    };
}

function room(overrides: Partial<TeamLiveSession> = {}): TeamLiveSession {
    return {
        id: "room-1",
        project: PROJECT_ID,
        revision: "rev-1",
        story: "story-1",
        title: "Act one",
        openedBy: "ada",
        openedByInstance: "instance-ada",
        openedAt: 0,
        members: [{ instance: "instance-ada", account: "ada", label: "Nomen", joinedAt: 0 }],
        ...overrides,
    };
}

/** This machine's copy of the project the rooms are on. */
function here(): VcsLocalRepository {
    return {
        path: "D:/projects/moonlit",
        name: "Moonlit",
        repositoryId: PROJECT_ID,
        remoteOrigin: ORIGIN,
    };
}

beforeEach(() => {
    bridge.capabilities = ["live"];
    bridge.call.mockReset();
    bridge.launch.mockClear();
    bridge.wizard.mockClear();
    dispatch = {};
});

afterEach(cleanup);

function action(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-live-room-action='join']");
}

describe("the rooms open on one project", () => {
    it("draws nothing at all on a server that does not offer rooms", async () => {
        bridge.capabilities = [];
        dispatch["live.list"] = { ok: true, value: { sessions: [room()] } };
        applyDispatch();

        render(<ProjectLiveSessions remoteOrigin={ORIGIN} project={project()} localPath={null} />);

        // Not an empty section and not a disabled one: a capability the server never advertised
        // is a feature this deployment does not have, and saying so once is enough.
        await waitFor(() => expect(bridge.call).not.toHaveBeenCalled());
        expect(document.querySelector("[data-project-live]")).toBeNull();
    });

    it("draws nothing where nobody has a room open", async () => {
        dispatch["live.list"] = { ok: true, value: { sessions: [] } };
        applyDispatch();

        render(<ProjectLiveSessions remoteOrigin={ORIGIN} project={project()} localPath={null} />);

        // A line saying "nobody is collaborating on this" would be under every project in the
        // launcher, for ever, saying nothing.
        await waitFor(() => expect(bridge.call).toHaveBeenCalled());
        expect(document.querySelector("[data-project-live]")).toBeNull();
    });

    it("opens the copy this machine has, and hands the room over to it", async () => {
        dispatch["live.list"] = { ok: true, value: { sessions: [room()] } };
        applyDispatch();

        render(
            <ProjectLiveSessions remoteOrigin={ORIGIN} project={project()} localPath={here().path} />,
        );
        await waitFor(() => expect(action()).not.toBeNull());
        fireEvent.click(action() as HTMLElement);

        // ⚠ The launcher does not join. It opens the project and says which room the workspace
        // is being opened for, because membership is recorded against the window that asks.
        await waitFor(() => expect(bridge.launch).toHaveBeenCalledWith(
            { projectPath: "D:/projects/moonlit", joinLive: { session: "room-1" } },
            true,
        ));
        expect(bridge.wizard).not.toHaveBeenCalled();
    });

    it("fetches the project first for a machine that has never had it", async () => {
        dispatch["live.list"] = { ok: true, value: { sessions: [room()] } };
        applyDispatch();

        render(<ProjectLiveSessions remoteOrigin={ORIGIN} project={project()} localPath={null} />);
        await waitFor(() => expect(action()).not.toBeNull());
        fireEvent.click(action() as HTMLElement);

        // The clone flow needs a window with no project open, which is this one - and it is the
        // whole reason every way into a room is here rather than in the editor.
        await waitFor(() => expect(bridge.wizard)
            .toHaveBeenCalledWith({ remoteUrl: `${ORIGIN}/moonlit` }));
        expect(bridge.launch).toHaveBeenCalledWith(
            { projectPath: "D:/cloned/moonlit", joinLive: { session: "room-1" } },
            true,
        );
    });

    it("says asking where the room is joined by asking", async () => {
        // Pressing it does not let anybody in: it puts a question in front of the host, and a
        // button that said "Join" would be promising something it cannot deliver.
        dispatch["live.list"] = { ok: true, value: { sessions: [room({ rule: "request" })] } };
        applyDispatch();

        render(<ProjectLiveSessions remoteOrigin={ORIGIN} project={project()} localPath={null} />);

        await waitFor(() => expect(action()?.textContent).toBe("launcher.servers.live.ask"));
    });
});

describe("the four digits", () => {
    function field(): HTMLInputElement {
        return document.querySelector("[data-servers-passcode-field]") as HTMLInputElement;
    }
    function press(): void {
        fireEvent.click(document.querySelector("[data-servers-action='join-by-code']") as HTMLElement);
    }

    function draw(projects: VcsServerProject[] = [project()]): void {
        render(
            <JoinByPasscode
                remoteOrigin={ORIGIN}
                projects={projects}
                repositories={[here()]}
            />,
        );
    }

    it("takes digits and nothing else, and no more than a passcode has", async () => {
        applyDispatch();
        draw();
        await waitFor(() => expect(field()).not.toBeNull());

        fireEvent.change(field(), { target: { value: "4a8-2 19" } });

        // A field that accepted anything would send the server strings it can only refuse, and
        // an author would read that refusal as their own code being wrong.
        expect(field().value).toBe("4821");
    });

    it("finds which project the room is on, then opens the copy this machine has", async () => {
        dispatch["live.byCode"] = { ok: true, value: { session: room() } };
        applyDispatch();
        draw();
        await waitFor(() => expect(field()).not.toBeNull());

        fireEvent.change(field(), { target: { value: "4821" } });
        press();

        // ⚠ The digits travel on rather than the room's id: a room reached this way refuses its
        // own id, which is what keeps knowing the id from being enough to walk in.
        await waitFor(() => expect(bridge.launch).toHaveBeenCalledWith(
            { projectPath: "D:/projects/moonlit", joinLive: { code: "4821" } },
            true,
        ));
    });

    it("says one sentence for a wrong passcode and for one nobody is using", async () => {
        dispatch["live.byCode"] = { ok: false, problem: { kind: "refused" } };
        applyDispatch();
        draw();
        await waitFor(() => expect(field()).not.toBeNull());

        fireEvent.change(field(), { target: { value: "0000" } });
        press();

        // Telling the two apart would turn ten thousand guesses into a map of which rooms exist,
        // which is why the server answers both the same and this must not elaborate.
        await waitFor(() => expect(
            document.querySelector("[data-passcode-problem]")?.textContent,
        ).toBe("launcher.servers.live.noSuchCode"));
        expect(bridge.launch).not.toHaveBeenCalled();
    });

    it("refuses to guess an address for a project the server did not list", async () => {
        dispatch["live.byCode"] = { ok: true, value: { session: room({ project: "some-other-id" }) } };
        applyDispatch();
        draw();
        await waitFor(() => expect(field()).not.toBeNull());

        fireEvent.change(field(), { target: { value: "4821" } });
        press();

        // Nothing here can fetch a repository it has no address for, and opening the clone wizard
        // with an empty field would look like a flow that had begun.
        await waitFor(() => expect(
            document.querySelector("[data-passcode-problem]")?.textContent,
        ).toBe("launcher.servers.live.unreachable"));
        expect(bridge.wizard).not.toHaveBeenCalled();
    });
});
