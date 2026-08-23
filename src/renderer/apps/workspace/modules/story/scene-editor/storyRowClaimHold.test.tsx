// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import type { StoryBlockId, StoryId } from "@shared/types/story";
import { useStoryRowClaimHold, type StoryRowClaimPort } from "./storyRowClaimHold";

/**
 * Holding the row an author is writing, and giving it back however they stop.
 *
 * Two things are pinned, and the second is the one that hurts if it is wrong. A row has to be taken
 * when the box opens on it, or nothing anywhere stops two people writing one line. And it has to be
 * given back on EVERY way the box can close - **a claim that is never given back is a row nobody can
 * edit for the rest of the session**, and the host's timeout is the safety net for a machine that
 * died, not the plan for a machine that is still here.
 *
 * The endings are asserted one by one below even though they share an implementation, because that
 * is precisely the claim being made: an Escape, a click on the next line and a tab closing are three
 * different gestures in the editor and one event here.
 */

const STORY = "story-1" as StoryId;

type Said = { blockId: StoryBlockId; holding: boolean };

function recorder(): { port: StoryRowClaimPort; said: Said[] } {
    const said: Said[] = [];
    return {
        said,
        port: {
            claimRow: (storyId, blockId, holding) => {
                expect(storyId).toBe(STORY);
                said.push({ blockId, holding });
            },
        },
    };
}

/** The hook as the controller drives it: one open row at a time, or none. */
function hold(port: StoryRowClaimPort | null) {
    return renderHook(
        ({ blockId }: { blockId: StoryBlockId | null }) =>
            useStoryRowClaimHold({ service: port, storyId: STORY, blockId }),
        { initialProps: { blockId: null as StoryBlockId | null } },
    );
}

afterEach(cleanup);

describe("taking the row an author is writing", () => {
    it("takes it when the box opens, and nothing before that", () => {
        const { port, said } = recorder();
        const view = hold(port);
        expect(said).toEqual([]);

        view.rerender({ blockId: "b" as StoryBlockId });
        expect(said).toEqual([{ blockId: "b", holding: true }]);
    });

    it("asks for nothing outside a session or before the workspace is up", () => {
        // The service answers with silence in both cases, but a hook that asked anyway would have
        // to be given one, and a tab with no story behind it has nothing to name.
        const view = hold(null);
        view.rerender({ blockId: "b" as StoryBlockId });
        // Nothing to assert but the absence of a throw: there is nobody to have asked.
        expect(view.result.current).toBeUndefined();
    });
});

describe("every way editing a row ends", () => {
    /** Open a row, then let the caller close it however that ending closes it. */
    function opened(): { said: Said[]; view: ReturnType<typeof hold> } {
        const { port, said } = recorder();
        const view = hold(port);
        view.rerender({ blockId: "b" as StoryBlockId });
        said.length = 0;
        return { said, view };
    }

    it("gives it back when the line is committed and the editor goes idle", () => {
        // Enter and blur both land here: the box closes and the controller's mode is `idle`.
        const { said, view } = opened();
        view.rerender({ blockId: null });
        expect(said).toEqual([{ blockId: "b", holding: false }]);
    });

    it("gives it back when the author escapes without committing", () => {
        // Escape discards the draft and closes the box, which is the same ending seen from here -
        // and the row must not stay held because nothing was written to it.
        const { said, view } = opened();
        view.rerender({ blockId: null });
        expect(said).toEqual([{ blockId: "b", holding: false }]);
    });

    it("gives the old row back before taking the next, when the author clicks another line", () => {
        // In this order, and it matters: the two rows are held at once for no instant at all.
        const { said, view } = opened();
        view.rerender({ blockId: "c" as StoryBlockId });
        expect(said).toEqual([
            { blockId: "b", holding: false },
            { blockId: "c", holding: true },
        ]);
    });

    it("gives it back when the tab closes", () => {
        const { said, view } = opened();
        view.unmount();
        expect(said).toEqual([{ blockId: "b", holding: false }]);
    });

    it("gives it back when a freeze takes the editor away under the author", () => {
        // A freeze sets the mode to `idle` directly, discarding the draft, which reaches this as
        // the open row going away like any other ending.
        const { said, view } = opened();
        view.rerender({ blockId: null });
        expect(said).toEqual([{ blockId: "b", holding: false }]);
    });

    it("gives it back once, not once per ending", () => {
        const { said, view } = opened();
        view.rerender({ blockId: null });
        view.rerender({ blockId: null });
        view.unmount();
        expect(said).toEqual([{ blockId: "b", holding: false }]);
    });
});

describe("keeping the row for as long as its box is open", () => {
    /**
     * ⚠ The regression this whole block exists for.
     *
     * The assertion used to ride on keystrokes, which made a claim last as long as somebody was
     * typing rather than as long as their box was open. An author who paused to think about a
     * sentence therefore stopped holding a row they were visibly in the middle of writing, and on a
     * real machine somebody else deleted that row - having been shown "alice is writing this line"
     * over it - and alice's draft went with it.
     */
    it("says so again on the interval, with nobody touching the keyboard", () => {
        vi.useFakeTimers();
        try {
            const { port, said } = recorder();
            const view = hold(port);
            act(() => {
                view.rerender({ blockId: "b" as StoryBlockId });
            });
            said.length = 0;

            // Four minutes of an open box and an author who is thinking.
            act(() => {
                vi.advanceTimersByTime(240_000);
            });

            expect(said.every(one => one.holding && one.blockId === "b")).toBe(true);
            expect(said).toHaveLength(240_000 / CLAIM_REASSERT_MS);
        } finally {
            vi.useRealTimers();
        }
    });

    it("says nothing at all for the first interval, having only just said it", () => {
        // The traffic this costs is the interval and not the writing: what travels here goes to
        // every machine in the room, so a message per keystroke would be a room shouting one bit
        // of news at itself.
        vi.useFakeTimers();
        try {
            const { port, said } = recorder();
            const view = hold(port);
            act(() => {
                view.rerender({ blockId: "b" as StoryBlockId });
            });
            said.length = 0;

            act(() => {
                vi.advanceTimersByTime(CLAIM_REASSERT_MS - 1);
            });
            expect(said).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("stops saying anything once the box closes", () => {
        // The give-back is the last word. A timer left running past it would go on taking a row
        // whose author has moved to another line, which is the "never given back" failure arriving
        // by a different route.
        vi.useFakeTimers();
        try {
            const { port, said } = recorder();
            const view = hold(port);
            act(() => {
                view.rerender({ blockId: "b" as StoryBlockId });
            });
            act(() => {
                view.rerender({ blockId: null });
            });
            said.length = 0;

            act(() => {
                vi.advanceTimersByTime(240_000);
            });
            expect(said).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("carries the interval to the next row when the author moves to one", () => {
        vi.useFakeTimers();
        try {
            const { port, said } = recorder();
            const view = hold(port);
            act(() => {
                view.rerender({ blockId: "b" as StoryBlockId });
            });
            act(() => {
                view.rerender({ blockId: "c" as StoryBlockId });
            });
            said.length = 0;

            act(() => {
                vi.advanceTimersByTime(CLAIM_REASSERT_MS);
            });
            expect(said).toEqual([{ blockId: "c", holding: true }]);
        } finally {
            vi.useRealTimers();
        }
    });
});
