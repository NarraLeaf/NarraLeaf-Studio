// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import type { StorySceneId } from "@shared/types/story";
import { LiveSessionNotices } from "./LiveSessionNotices";

/**
 * What a session says while nobody is looking at the Team panel.
 *
 * All three of these happen with the author's eyes on a scene: an edit the host would not take, an
 * undo that could not be sent, and a session that ended without being asked to. The panel that
 * knows about rooms is a dialog two clicks away and is shut for the whole of a working day, so a
 * refusal reported only there is a refusal nobody reads.
 *
 * ⚠ **Nothing here may be heavier than a notification.** A refused row is precisely the case where
 * the words on screen are the only copy of a paragraph somebody just finished typing - the host
 * says no *because* they are about to lose it - and a dialog over the editor would make the
 * interruption cost what the refusal was preventing.
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
    show: vi.fn(),
}));

// One workspace object for the whole file: the real one is a React context value and is stable for
// the life of the window.
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
                };
            }
            if (id === Services.UI) {
                return { notifications: { show: world.show } };
            }
            return null;
        },
    };
    const workspace = { isInitialized: true, context: { services } };
    return { useWorkspace: () => workspace };
});

// Seeded before rather than after, so the first test in the file starts from the same window as
// every other one: in no session, and never in one.
beforeEach(() => {
    world.view = IDLE_LIVE_SESSION;
    world.listeners.clear();
    world.show.mockClear();
});

afterEach(cleanup);

/** What the session publishes next, as the service would. */
function publish(view: LiveSessionView) {
    world.view = view;
    act(() => {
        for (const listener of [...world.listeners]) {
            listener(view);
        }
    });
}

function shown(): { type: NotificationType; message: string; detail?: string }[] {
    return world.show.mock.calls.map(call => call[0]);
}

describe("what a live session tells the author", () => {
    it("says nothing at all outside a session", () => {
        render(<LiveSessionNotices />);
        expect(world.show).not.toHaveBeenCalled();
    });

    it("names the person holding a row the host would not let this window write", () => {
        render(<LiveSessionNotices />);

        publish({
            ...IDLE_LIVE_SESSION,
            phase: "active",
            lastRefusal: { reason: "row-claimed", op: "update-block", heldBy: "bob" },
        });

        expect(shown()).toEqual([{
            type: NotificationType.Warning,
            // The name is the whole point: a refusal without one is a mystery, and the author
            // cannot ask anybody about a line if nobody is named.
            message: "story.live.refusedRowClaimed(bob)",
        }]);
    });

    it("says a refusal once, not once per message the session publishes afterwards", () => {
        render(<LiveSessionNotices />);
        const refusal = { ...IDLE_LIVE_SESSION, phase: "active" as const, lastRefusal: { reason: "row-gone" as const, op: "delete-block" as const } };

        publish(refusal);
        // The session publishes on every operation anybody in the room applies; the refusal it is
        // carrying has not changed.
        publish({ ...refusal, appliedSeq: 4 });
        publish({ ...refusal, appliedSeq: 5 });

        expect(shown()).toHaveLength(1);
    });

    it("says why an undo sent nothing, and stays quiet at the end of the stack", () => {
        render(<LiveSessionNotices />);

        publish({ ...IDLE_LIVE_SESSION, phase: "active", undoRefusal: "not-mine" });
        expect(shown()).toEqual([{ type: NotificationType.Warning, message: "story.live.undoNotMine" }]);

        // Pressing Ctrl+Z once more than there are steps is an ordinary thing to do.
        publish({ ...IDLE_LIVE_SESSION, phase: "active", undoRefusal: "nothing-to-undo" });
        expect(shown()).toHaveLength(1);
    });

    it("says nothing when the author leaves a session themselves", () => {
        render(<LiveSessionNotices />);

        publish({ ...IDLE_LIVE_SESSION, ended: { cause: "left", sessionId: "room-1", closed: false } });

        expect(world.show).not.toHaveBeenCalled();
    });

    it("does not let a divergence read as an ordinary leave", () => {
        render(<LiveSessionNotices />);

        publish({ ...IDLE_LIVE_SESSION, ended: { cause: "host-left", sessionId: "room-1", closed: true } });
        publish({
            ...IDLE_LIVE_SESSION,
            ended: {
                cause: "diverged",
                sessionId: "room-2",
                closed: false,
                divergence: {
                    seq: 4,
                    scope: { of: "scene", sceneId: "scene-1" as StorySceneId },
                    expected: "aaa",
                    computed: "bbb",
                },
            },
        });

        expect(shown()).toEqual([
            { type: NotificationType.Info, message: "workspace.shell.team.liveEndedHostLeft" },
            {
                // Louder, differently worded, and the only one of the three that carries a next
                // step: this copy is neither in the room nor holding what the room holds.
                type: NotificationType.Error,
                message: "workspace.shell.team.liveEndedDiverged",
                detail: "workspace.shell.team.liveEndedDivergedNext",
            },
        ]);
    });
});
