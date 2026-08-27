// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import type { StoryId, StorySceneId } from "@shared/types/story";
import type { TeamLiveSession } from "@shared/types/team";
import { resetWindowOverlayHostForTests } from "@/lib/components/layout/windowOverlayHost";
import { LiveSessionDialog } from "./LiveSessionDialog";
import type { TeamProjectSurface } from "../../hooks/useTeamProject";

/**
 * The session dialog: what it says about the session this window is in, and what it does when
 * pressed.
 *
 * **It drives `Services.Live`, and that is the point of this file.** The controls used to call the
 * server directly - `live.open`, `live.join`, `live.leave` - which put a room on the server that
 * this window was not in: no checkpoint, no push, no freeze, and the story editor still writing
 * into a document nobody else could see. So what is pinned here is that each control reaches the
 * session, and that everything the dialog says is read back out of it.
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

afterEach(() => {
    cleanup();
    // The dialog portals into the window's overlay host, which is created once per document and
    // kept. Forgetting it between cases is what stops one dialog's markup being found by the next.
    resetWindowOverlayHostForTests();
});

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
    render(<LiveSessionDialog team={team(overrides)} isOpen onClose={() => undefined} />);
}

/** One of the dialog's lines, by the seam it carries. */
function note(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-live-note='${name}']`);
}

/** One of the dialog's three acts, by what it does. */
function act(name: "open" | "join" | "leave"): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`[data-live-act='${name}']`);
}

function block(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-live-block='${name}']`);
}

describe("what the dialog does when pressed", () => {
    it("starts a session on the story the picker is showing, rather than opening a room on the server", () => {
        world.view = IDLE_LIVE_SESSION;
        draw();

        fireEvent.click(act("open") as HTMLElement);

        // The story travels with it because a room carries none: every window in the project has
        // to work out the same document, and the title is what the room is then called.
        expect(world.open).toHaveBeenCalledWith({ storyId: "story-1", title: "Act one" });
    });

    it("joins the room the server is offering, and names no story of its own", () => {
        world.view = IDLE_LIVE_SESSION;
        draw({ live: [room()] });

        expect(block("join")?.textContent).toContain("Act one");
        fireEvent.click(act("join") as HTMLElement);

        // Which document the room is about is the room's answer. A story named here could only
        // ever be one this project already has - the wrong one whenever the copies differ about
        // which story comes first, and none at all for somebody joining in order to get one.
        expect(world.join).toHaveBeenCalledWith({ session: room() });
    });

    it("offers to join even when this project has no story of its own", () => {
        // ⚠ The regression. A machine that has not got the story yet is the most ordinary new
        // collaborator there is, and it used to be the one machine this control was disabled for -
        // told to add a story before joining the session that would have brought it one.
        world.stories = [];
        world.defaultStory = undefined;
        world.view = IDLE_LIVE_SESSION;
        draw({ live: [room()] });

        expect(act("join")?.matches(":disabled")).toBe(false);
        // And the line telling them to add a story is not said beside an offer to join one.
        expect(note("no-story")).toBeNull();

        fireEvent.click(act("join") as HTMLElement);
        expect(world.join).toHaveBeenCalledWith({ session: room() });
    });

    it("offers one way out, named for what leaving actually does", () => {
        world.view = inRoom({ role: "guest" });
        draw();
        expect(act("leave")?.textContent).toBe("workspace.shell.team.liveLeaveSession");

        cleanup();
        resetWindowOverlayHostForTests();
        // A host with somebody else in the room hands it over: the session carries on in a new room
        // under whoever was nominated, so naming this "End" would ask for courage about nothing.
        world.view = inRoom({ role: "host" });
        draw();
        expect(act("leave")?.textContent).toBe("workspace.shell.team.liveHandOverSession");

        cleanup();
        resetWindowOverlayHostForTests();
        // A host alone in the room ends it. There is nobody to hand it to, and this is the one of
        // the three that is destructive.
        world.view = inRoom({
            role: "host",
            session: room({ members: [{ instance: "mine", account: "ada", label: "Nomen", joinedAt: 1 }] }),
        });
        draw();
        expect(act("leave")?.textContent).toBe("workspace.shell.team.liveEndSession");
        fireEvent.click(act("leave") as HTMLElement);
        expect(world.leave).toHaveBeenCalledTimes(1);
    });
});

describe("what the dialog says about the session", () => {
    const standing = () => document.querySelector<HTMLElement>("[data-live-standing]");

    it("says which half of the room this window is", () => {
        world.view = inRoom({ role: "host" });
        draw();
        expect(standing()?.textContent).toBe("workspace.shell.team.liveHost");

        cleanup();
        resetWindowOverlayHostForTests();
        world.view = inRoom({ role: "guest" });
        draw();
        expect(standing()?.textContent).toBe("workspace.shell.team.liveGuest");
    });

    it("says it is catching up rather than following", () => {
        world.view = inRoom({ phase: "catching-up" });
        draw();

        // The one stretch in which this machine's document is knowingly behind the room's.
        expect(note("catching-up")?.textContent).toBe("workspace.shell.team.liveCatchingUp");
    });

    it("says so while entering and while leaving", () => {
        world.view = { ...IDLE_LIVE_SESSION, phase: "entering" };
        draw();
        expect(standing()?.textContent).toBe("workspace.shell.team.liveEntering");

        cleanup();
        resetWindowOverlayHostForTests();
        world.view = inRoom({ phase: "leaving" });
        draw();
        expect(standing()?.textContent).toBe("workspace.shell.team.liveLeaving");
        // Nothing to press twice: the act is already running.
        expect(act("leave")?.matches(":disabled")).toBe(true);
    });

    it("names everybody in the room, marks the host, and says which row is this machine", () => {
        world.view = inRoom();
        draw();

        // Both members, not only the others: a room of two where one row is an account name and
        // the other is absent is a room a reader has to work out their own place in.
        expect(document.querySelector("[data-live-member='ada']")?.textContent)
            .toContain("workspace.shell.team.liveThisMachine");
        expect(document.querySelector("[data-live-member='bob']")?.textContent)
            .toContain("workspace.shell.team.liveHost");
    });

    it("says where the work that was uncommitted on the way in went", () => {
        world.view = inRoom({ checkpoint: "4a1b2c3d4e5f6789" });
        draw();
        expect(block("checkpoint")?.textContent)
            .toContain("workspace.shell.team.liveCheckpointAt(4a1b2c3)");

        cleanup();
        resetWindowOverlayHostForTests();
        // A session entered from a clean tree records nothing, and saying so is not the same as
        // saying nothing: an author who reads no checkpoint at all cannot tell the two apart.
        world.view = inRoom({ checkpoint: null });
        draw();
        expect(block("checkpoint")?.textContent)
            .toContain("workspace.shell.team.liveCheckpointNone");
    });

    it("counts this window's unanswered intents, and stays quiet at zero", () => {
        // A guest's document does not move under their hands until the host answers, so without
        // this a round trip in flight and an editor that has stopped working read the same.
        world.view = inRoom({ pendingIntents: 2 });
        draw();
        expect(note("pending")?.textContent).toBe("workspace.shell.team.livePendingMany(2)");

        cleanup();
        resetWindowOverlayHostForTests();
        world.view = inRoom({ pendingIntents: 0 });
        draw();
        expect(note("pending")).toBeNull();
    });
});

describe("what the dialog says about not entering", () => {
    it("names the freeze standing in the way, and does not offer the act", () => {
        world.freeze = { kind: "merge" };
        draw();

        expect(note("blocked")?.textContent).toBe("workspace.shell.team.liveBlockedMerge");
        expect(act("open")?.matches(":disabled")).toBe(true);
    });

    it("does not read a session's own freeze as a refusal to enter one", () => {
        // Inside a session the freeze in place is always this session's, and saying "this
        // workspace is already in a live session" beside the room it is in reads as the room
        // refusing to let anybody in.
        world.freeze = { kind: "live-session", session: "room-1", writable: ["story/act-one.json"] };
        world.view = inRoom();
        draw();

        expect(note("blocked")).toBeNull();
    });

    it("says an attempt that failed, rather than leaving the control silent", () => {
        world.view = {
            ...IDLE_LIVE_SESSION,
            entryFailure: { kind: "revision-mismatch", revision: "rev-11" },
        };
        draw();

        expect(note("failure")?.textContent).toBe("workspace.shell.team.liveVersionMismatch");
    });

    it("names the project a session belongs to when it is not this one", () => {
        world.view = {
            ...IDLE_LIVE_SESSION,
            entryFailure: { kind: "clone-required", project: "other-game" },
        };
        draw();

        expect(note("failure")?.textContent)
            .toBe("workspace.shell.team.liveCloneRequired(other-game)");
    });

    it("says a project with no story cannot have a session, on the control and beside it", () => {
        world.stories = [];
        world.defaultStory = undefined;
        draw();

        expect(note("no-story")?.textContent).toBe("workspace.shell.team.liveNoStory");
        expect(act("open")?.matches(":disabled")).toBe(true);
    });
});

describe("how a session that ended reads", () => {
    it("says nothing about the author leaving one themselves", () => {
        world.view = { ...IDLE_LIVE_SESSION, ended: { cause: "left", sessionId: "room-1", closed: false } };
        draw();

        expect(note("ended")).toBeNull();
    });

    it("says the host left, in the ordinary tone", () => {
        world.view = { ...IDLE_LIVE_SESSION, ended: { cause: "host-left", sessionId: "room-1", closed: true } };
        draw();

        expect(note("ended")?.textContent).toBe("workspace.shell.team.liveEndedHostLeft");
        expect(note("ended")?.className).not.toContain("text-danger");
    });

    it("does not let a divergence read as an ordinary goodbye", () => {
        world.view = {
            ...IDLE_LIVE_SESSION,
            ended: {
                cause: "diverged",
                sessionId: "room-1",
                closed: false,
                divergence: {
                    seq: 4,
                    scope: { of: "scene", storyId: "story-1", sceneId: "scene-1" as StorySceneId },
                    expected: "aaa",
                    computed: "bbb",
                },
            },
        };
        draw();

        // A different sentence AND a different tone: this copy is neither in the room nor holding
        // what the room holds, which is not what leaving one means.
        expect(note("ended")?.textContent).toBe("workspace.shell.team.liveEndedDiverged");
        expect(note("ended")?.className).toContain("text-danger");
    });
});

describe("a room this window has just closed", () => {
    /**
     * ⚠ The regression these two pin, and the reason `closed` exists rather than being read off
     * `cause`.
     *
     * The room list comes from the server and the session's own state does not, so between a host
     * pressing End and the server's news of the closure coming back round there is a stretch in
     * which this window is in no session and the room it just closed is still in the list. Matching
     * only against the session this window is in drew that stretch as somebody else's room with two
     * people in it and a control to join - which is what a host saw on a real machine.
     */
    it("is not offered as one to join", () => {
        world.view = { ...IDLE_LIVE_SESSION, ended: { cause: "left", sessionId: "room-1", closed: true } };
        draw({ live: [room()] });

        expect(act("join")).toBeNull();
        // And the only thing on offer is the one that is actually true: open a new one.
        expect(act("open")).not.toBeNull();
    });

    it("is offered again when this window merely left a room that carried on", () => {
        // A guest walking out is the opposite answer to the same `cause`. The room is still there,
        // still has people in it, and going back into it is an ordinary thing to want.
        world.view = { ...IDLE_LIVE_SESSION, ended: { cause: "left", sessionId: "room-1", closed: false } };
        draw({ live: [room()] });

        expect(act("join")).not.toBeNull();
    });

    it("makes the panel read the room list again", () => {
        // The server says so on a topic this project is subscribed to, but a collection only ever
        // corrected by somebody else's news stays wrong whenever that news is missed - and this
        // window knows for certain that the list moved, because it moved it.
        const refresh = vi.fn();
        world.view = { ...IDLE_LIVE_SESSION, ended: { cause: "left", sessionId: "room-1", closed: true } };
        draw({ live: [room()], refresh });

        expect(refresh).toHaveBeenCalled();
    });

    it("asks for nothing when no session has ended here", () => {
        const refresh = vi.fn();
        world.view = IDLE_LIVE_SESSION;
        draw({ live: [], refresh });

        expect(refresh).not.toHaveBeenCalled();
    });
});
