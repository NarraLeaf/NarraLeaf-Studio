// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import type { StoryId } from "@shared/types/story";
import type { TeamLiveSession } from "@shared/types/team";
import { LiveSessionPresence } from "./LiveSessionPresence";
import { TeamProjectProvider } from "./TeamProjectContext";
import type { TeamProjectState, TeamProjectSurface } from "../../hooks/useTeamProject";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * The collaboration control in the title bar.
 *
 * **It is drawn for every project pointed at a Team server, including the ones that cannot open a
 * room right now.** That is the whole of its first responsibility: a control that appears only once
 * everything is in place cannot be used to find out what is missing, so a server that is not
 * answering, has no account on this machine, does not hold this project or does not offer rooms
 * leaves it inert with that answer on it. Nothing at all is drawn for a project on no server, where
 * there is no collaboration to describe.
 *
 * Its second is to be the one always-visible statement that a session is running. Before it, the
 * only persistent trace of one was a tinted 48px strip wearing a history clock.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string>) =>
            (params ? `${key}(${Object.values(params).join(",")})` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

const world = vi.hoisted(() => ({
    view: {} as LiveSessionView,
    team: {} as TeamProjectSurface,
}));

vi.mock("@/apps/workspace/context", () => {
    const services = {
        get: (id: unknown) => {
            if (id === Services.Live) {
                return {
                    getView: () => world.view,
                    onChanged: () => () => undefined,
                    open: vi.fn(),
                    join: vi.fn(),
                    leave: vi.fn(),
                };
            }
            if (id === Services.WorkspaceFreeze) {
                return { getReason: () => null, onChanged: () => () => undefined };
            }
            if (id === Services.Story) {
                return { listStories: () => [], getDefaultStoryId: () => undefined };
            }
            return null;
        },
    };
    const workspace = { isInitialized: true, context: { services } };
    return { useWorkspace: () => workspace };
});

// The provider's own reader. Stubbed rather than driven, because what it answers is exactly the
// input under test and opening a real one would put a socket in a jsdom document.
vi.mock("../../hooks/useTeamProject", () => ({ useTeamProject: () => world.team }));

const ONE = "lore://one.example.lan:41337";

function teamSurface(state: TeamProjectState, overrides: Partial<TeamProjectSurface> = {}): TeamProjectSurface {
    return {
        state,
        remoteOrigin: ONE,
        clients: [],
        live: [],
        overlay: null,
        canLive: true,
        canOverlay: false,
        canSeeClients: false,
        refresh: vi.fn(),
        ...overrides,
    } as TeamProjectSurface;
}

const VERIFIED: TeamProjectState = {
    kind: "verified",
    project: { id: "abc", name: "my-game", description: "", createdAt: 0, remote: `${ONE}/my-game` },
} as TeamProjectState;

function room(overrides: Partial<TeamLiveSession> = {}): TeamLiveSession {
    return {
        id: "room-1",
        project: "abc",
        title: "Act one",
        openedBy: "bob",
        openedByInstance: "bob-1",
        openedAt: 1,
        members: [
            { instance: "mine", account: "ada", label: "Nomen", joinedAt: 1 },
            { instance: "bob-1", account: "bob", label: "iMac", joinedAt: 1 },
        ],
        ...overrides,
    };
}

/** The version surface the provider reads the address out of. Only three fields are used. */
const SURFACE = {
    state: { kind: "current", head: "rev-9" },
    remote: `${ONE}/my-game`,
    repositoryId: "abc",
} as unknown as VersionSurface;

beforeEach(() => {
    world.view = IDLE_LIVE_SESSION;
    world.team = teamSurface(VERIFIED);
});

afterEach(cleanup);

function draw() {
    render(
        <TeamProjectProvider surface={SURFACE}>
            <LiveSessionPresence />
        </TeamProjectProvider>,
    );
}

function control(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>("[data-live-presence]");
}

describe("when the control can be used", () => {
    it("says there is no session rather than going silent", () => {
        draw();
        expect(control()?.matches(":disabled")).toBe(false);
        expect(control()?.getAttribute("data-tip")).toBe("workspace.shell.team.liveNobody");
        expect(control()?.getAttribute("data-live-presence")).toBe("idle");
    });

    it("names whoever has a room open on this project", () => {
        world.team = teamSurface(VERIFIED, { live: [room()] });
        draw();

        expect(control()?.getAttribute("data-live-presence")).toBe("offered");
        expect(control()?.getAttribute("data-tip")).toBe("workspace.shell.team.liveRoomOpen(bob)");
        // The room's members, so the faces are on screen before anybody has joined it.
        expect(document.querySelectorAll("[data-live-avatar]")).toHaveLength(2);
    });

    it("says which half of the room this window is once it is in one", () => {
        world.view = {
            ...IDLE_LIVE_SESSION,
            phase: "active",
            role: "host",
            session: room(),
            storyId: "story-1" as StoryId,
            self: "mine",
        };
        draw();

        expect(control()?.getAttribute("data-live-presence")).toBe("host");
        expect(control()?.getAttribute("data-tip")).toContain("workspace.shell.team.liveHost");
    });
});

describe("when it cannot", () => {
    it("is not drawn at all for a project on no server", () => {
        // There is no collaboration to describe, and the way to point it at one is the Team cell.
        world.team = teamSurface({ kind: "none" });
        draw();
        expect(control()).toBeNull();
    });

    it.each([
        ["no-account", "workspace.shell.team.noAccountHere"],
        ["connecting", "workspace.shell.team.liveConnecting"],
        ["unreachable", "workspace.shell.team.unreachable"],
        ["not-there", "workspace.shell.team.notThere"],
    ] as const)("goes inert and names what it is waiting for: %s", (kind, sentence) => {
        world.team = teamSurface({ kind } as TeamProjectState);
        draw();

        expect(control()?.matches(":disabled")).toBe(true);
        expect(control()?.getAttribute("data-tip")).toBe(sentence);
    });

    it("says so where the server holds this project but offers no rooms", () => {
        // A deployment older than the feature. Asked last, because it is the only one of the five
        // that is about the server's build rather than about this machine or this project.
        world.team = teamSurface(VERIFIED, { canLive: false });
        draw();

        expect(control()?.matches(":disabled")).toBe(true);
        expect(control()?.getAttribute("data-tip")).toBe("workspace.shell.team.liveUnsupported");
    });
});
