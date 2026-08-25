// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { useCollaborationPanelRegistered } from "./index";

/**
 * When the collaboration panel exists at all.
 *
 * **Two rules, and the second is the one worth a test.** It is absent until this window has been in
 * a live session, because a rail icon for a feature nobody in this project uses is one more thing to
 * work out on a rail that already carries seven. And once it is there it stays - unregistering it
 * when the room closes would take the record of what happened in the room away with the room, at
 * the moment the author most wants to read it back.
 */

const world = vi.hoisted(() => ({
    view: {} as LiveSessionView,
    listeners: new Set<(view: LiveSessionView) => void>(),
}));

vi.mock("@/apps/workspace/context", () => {
    const services = {
        get: (id: unknown) => (id === Services.Live
            ? {
                getView: () => world.view,
                onChanged: (handler: (view: LiveSessionView) => void) => {
                    world.listeners.add(handler);
                    return () => world.listeners.delete(handler);
                },
            }
            : null),
    };
    const workspace = { isInitialized: true, context: { services } };
    return { useWorkspace: () => workspace };
});

/** Move the session on, the way the service does: publish a whole new view. */
function publish(view: LiveSessionView) {
    act(() => {
        world.view = view;
        for (const listener of [...world.listeners]) listener(view);
    });
}

beforeEach(() => {
    world.view = IDLE_LIVE_SESSION;
    world.listeners.clear();
});

afterEach(cleanup);

let answer = false;

function Probe() {
    answer = useCollaborationPanelRegistered();
    return null;
}

describe("whether the collaboration panel is registered", () => {
    it("is not, in a window that has never been in a session", () => {
        render(<Probe />);
        expect(answer).toBe(false);
    });

    it("is, from the moment one is entered", () => {
        render(<Probe />);
        publish({ ...IDLE_LIVE_SESSION, phase: "entering" });
        expect(answer).toBe(true);
    });

    it("stays after the session ends", () => {
        render(<Probe />);
        publish({ ...IDLE_LIVE_SESSION, phase: "active", role: "host" });
        publish({ ...IDLE_LIVE_SESSION, ended: { cause: "left", sessionId: "room-1", closed: true } });
        expect(answer).toBe(true);

        // And past the point where even the ending has been cleared, which is what "latched" means:
        // the panel is the only place the room's record can still be read.
        publish(IDLE_LIVE_SESSION);
        expect(answer).toBe(true);
    });

    it("is, in a window that mounted after its session had already finished", () => {
        // The session is read on the way in as well as on every change, so a panel registry that
        // only watched for a transition would miss a room that closed a moment before it ran.
        world.view = { ...IDLE_LIVE_SESSION, ended: { cause: "host-left", sessionId: "room-1", closed: true } };
        render(<Probe />);
        expect(answer).toBe(true);
    });
});
