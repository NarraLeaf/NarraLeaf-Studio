// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import type { StoryId, StorySceneId } from "@shared/types/story";
import type { TeamLiveSession } from "@shared/types/team";
import { TeamCollaboration } from "./TeamCollaboration";
import type { TeamProjectSurface } from "../../hooks/useTeamProject";

/**
 * The room row: what it says about the session this window is in, and what it does when pressed.
 *
 * **It drives `Services.Live`, and that is the point of this file.** The row used to call the
 * server directly - `live.open`, `live.join`, `live.leave` - which put a room on the server that
 * this window was not in: no checkpoint, no push, no freeze, and the story editor still writing
 * into a document nobody else could see. So what is pinned here is that each control reaches the
 * session, and that everything the row says is read back out of it.
 *
 * The other half is the sentences. A session refuses things - a workspace frozen for a merge, a
 * room opened on a version this tree has moved past, a copy that stopped matching the room's - and
 * every one of those states has to reach the author as words rather than as a control that does
 * nothing when pressed.
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
    listeners: new Set<(view: LiveSessionView) => void>(),
    open: vi.fn(() => Promise.resolve(null)),
    join: vi.fn(() => Promise.resolve(null)),
    leave: vi.fn(() => Promise.resolve()),
    freeze: null as WorkspaceFreezeReason | null,
    stories: [] as { id: string; name: string }[],
    defaultStory: undefined as string | undefined,
}));

// One workspace object for the whole file, because the real one is a React context value and is
// stable for the life of the window. A mock that built a fresh one per call would hand every hook
// below new dependencies on every render.
vi.mock("@/apps/workspace/context", () => {
    const services = {
        get: (id: unknown) => {
            if (id === Services.Live) {
                return {
                    getView: () => world.view,
                    onChanged: (handler: (view: LiveSessionView) => void) => {
                        world.listeners.add(handler);
                        return () => world.listeners.delete(handler);
                    },
                    open: world.open,
                    join: world.join,
                    leave: world.leave,
                };
            }
            if (id === Services.WorkspaceFreeze) {
                return { getReason: () => world.freeze, onChanged: () => () => undefined };
            }
            if (id === Services.Story) {
                return { listStories: () => world.stories, getDefaultStoryId: () => world.defaultStory };
            }
            return null;
        },
    };
    const workspace = { isInitialized: true, context: { services } };
    return { useWorkspace: () => workspace };
});

// Seeded before rather than after, so the first test in the file starts from the same project as
// every other one: one story, no freeze, and no session.
beforeEach(() => {
    world.view = IDLE_LIVE_SESSION;
    world.listeners.clear();
    world.open.mockClear();
    world.join.mockClear();
    world.leave.mockClear();
    world.freeze = null;
    world.stories = [{ id: "story-1", name: "Act one" }];
    world.defaultStory = "story-1";
});

afterEach(cleanup);

const ONE = "lore://one.example.lan:41337";

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

/** A window inside the room above, at whatever phase the test is about. */
function inRoom(overrides: Partial<LiveSessionView> = {}): LiveSessionView {
    return {
        ...IDLE_LIVE_SESSION,
        phase: "active",
        role: "guest",
        session: room(),
        storyId: "story-1" as StoryId,
        self: "mine",
        ...overrides,
    };
}

function team(overrides: Partial<TeamProjectSurface> = {}): TeamProjectSurface {
    return {
        state: {
            kind: "verified",
            project: { id: "abc", name: "my-game", description: "", createdAt: 0, remote: `${ONE}/my-game` },
        },
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

function draw(overrides: Partial<TeamProjectSurface> = {}) {
    render(<TeamCollaboration team={team(overrides)} />);
}

function seam(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-team-seam='${name}']`);
}

describe("what the room row does when pressed", () => {
    it("starts a session on the project's story, rather than opening a room on the server", () => {
        world.view = IDLE_LIVE_SESSION;
        draw();

        fireEvent.click(seam("live-open") as HTMLElement);

        // The story travels with it because a room carries none: every window in the project has
        // to work out the same document, and the title is what the room is then called.
        expect(world.open).toHaveBeenCalledWith({ storyId: "story-1", title: "Act one" });
    });

    it("joins the room the server is offering, on that same story", () => {
        world.view = IDLE_LIVE_SESSION;
        draw({ live: [room()] });

        expect(seam("live")?.textContent).toContain("Act one");
        fireEvent.click(seam("live-join") as HTMLElement);

        expect(world.join).toHaveBeenCalledWith({ session: room(), storyId: "story-1" });
    });

    it("offers one way out, named for what leaving actually does", () => {
        world.view = inRoom({ role: "guest" });
        draw();
        expect(seam("live-leave")).not.toBeNull();
        expect(seam("live-end")).toBeNull();

        cleanup();
        // A host holds the only copy that counts, so its window walking away ends the room for
        // everybody. Offering it "Leave" would name an act the others would not experience.
        world.view = inRoom({ role: "host" });
        draw();
        expect(seam("live-leave")).toBeNull();
        fireEvent.click(seam("live-end") as HTMLElement);
        expect(world.leave).toHaveBeenCalledTimes(1);
    });
});

describe("what the room row says about the session", () => {
    it("says which half of the room this window is", () => {
        world.view = inRoom({ role: "host" });
        draw();
        expect(seam("live-standing")?.textContent).toBe("workspace.shell.team.liveHost");

        cleanup();
        world.view = inRoom({ role: "guest" });
        draw();
        expect(seam("live-standing")?.textContent).toBe("workspace.shell.team.liveGuest");
    });

    it("says it is catching up rather than following", () => {
        world.view = inRoom({ phase: "catching-up" });
        draw();

        // The one stretch in which this machine's document is knowingly behind the room's.
        expect(seam("live-catching-up")?.textContent).toBe("workspace.shell.team.liveCatchingUp");
    });

    it("says so while entering and while leaving", () => {
        world.view = { ...IDLE_LIVE_SESSION, phase: "entering" };
        draw();
        expect(seam("live-standing")?.textContent).toBe("workspace.shell.team.liveEntering");

        cleanup();
        world.view = inRoom({ phase: "leaving" });
        draw();
        expect(seam("live-standing")?.textContent).toBe("workspace.shell.team.liveLeaving");
        // Nothing to press twice: the act is already running.
        expect(seam("live-leave")?.matches(":disabled")).toBe(true);
    });

    it("names who else is in the room, and says nothing in a room of one", () => {
        world.view = inRoom();
        draw();
        expect(seam("live-members")?.textContent).toBe("bob");

        cleanup();
        world.view = inRoom({
            session: room({ members: [{ instance: "mine", account: "ada", label: "Nomen", joinedAt: 1 }] }),
        });
        draw();
        // A line saying nobody else is here is the same fact as the row above it.
        expect(seam("live-members")).toBeNull();
    });
});

describe("what the room row says about not entering", () => {
    it("names the freeze standing in the way, and does not offer the act", () => {
        world.freeze = { kind: "merge" };
        draw();

        expect(seam("live-blocked")?.textContent).toBe("workspace.shell.team.liveBlockedMerge");
        expect(seam("live-open")?.matches(":disabled")).toBe(true);
    });

    it("does not read a session's own freeze as a refusal to enter one", () => {
        // Inside a session the freeze in place is always this session's, and saying "this
        // workspace is already in a live session" beside the room it is in reads as the room
        // refusing to let anybody in.
        world.freeze = { kind: "live-session", session: "room-1", writable: ["story/act-one.json"] };
        world.view = inRoom();
        draw();

        expect(seam("live-blocked")).toBeNull();
    });

    it("says an attempt that failed, rather than leaving the control silent", () => {
        world.view = {
            ...IDLE_LIVE_SESSION,
            entryFailure: { kind: "revision-mismatch", expected: "rev-9", actual: "rev-11" },
        };
        draw();

        expect(seam("live-failure")?.textContent).toBe("workspace.shell.team.liveVersionMismatch");
    });

    it("names the project a session belongs to when it is not this one", () => {
        world.view = {
            ...IDLE_LIVE_SESSION,
            entryFailure: { kind: "clone-required", project: "other-game" },
        };
        draw();

        expect(seam("live-failure")?.textContent)
            .toBe("workspace.shell.team.liveCloneRequired(other-game)");
    });

    it("says a project with no story cannot have a session, on the control and beside it", () => {
        world.stories = [];
        world.defaultStory = undefined;
        draw();

        expect(seam("live-no-story")?.textContent).toBe("workspace.shell.team.liveNoStory");
        expect(seam("live-open")?.matches(":disabled")).toBe(true);
    });
});

describe("how a session that ended reads", () => {
    it("says nothing about the author leaving one themselves", () => {
        world.view = { ...IDLE_LIVE_SESSION, ended: { cause: "left", sessionId: "room-1" } };
        draw();

        expect(seam("live-ended")).toBeNull();
    });

    it("says the host left, in the ordinary tone", () => {
        world.view = { ...IDLE_LIVE_SESSION, ended: { cause: "host-left", sessionId: "room-1" } };
        draw();

        expect(seam("live-ended")?.textContent).toBe("workspace.shell.team.liveEndedHostLeft");
        expect(seam("live-ended")?.className).not.toContain("text-danger");
    });

    it("does not let a divergence read as an ordinary goodbye", () => {
        world.view = {
            ...IDLE_LIVE_SESSION,
            ended: {
                cause: "diverged",
                sessionId: "room-1",
                divergence: { seq: 4, sceneId: "scene-1" as StorySceneId, expected: "aaa", computed: "bbb" },
            },
        };
        draw();

        // A different sentence AND a different tone: this copy is neither in the room nor holding
        // what the room holds, which is not what leaving one means.
        expect(seam("live-ended")?.textContent).toBe("workspace.shell.team.liveEndedDiverged");
        expect(seam("live-ended")?.className).toContain("text-danger");
    });
});
