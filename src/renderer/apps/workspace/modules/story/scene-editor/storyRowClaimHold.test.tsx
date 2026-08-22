// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
function hold(port: StoryRowClaimPort | null, now?: () => number) {
    return renderHook(
        ({ blockId }: { blockId: StoryBlockId | null }) =>
            useStoryRowClaimHold({ service: port, storyId: STORY, blockId, ...(now ? { now } : {}) }),
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
        expect(view.result.current).toBeInstanceOf(Function);
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

describe("keeping the row while its author types", () => {
    it("says nothing for the first keystrokes, because it has only just said it", () => {
        let clock = 0;
        const { port, said } = recorder();
        const view = hold(port, () => clock);
        view.rerender({ blockId: "b" as StoryBlockId });
        said.length = 0;

        for (let keystroke = 0; keystroke < 500; keystroke += 1) {
            clock += 10;
            view.result.current("b" as StoryBlockId);
        }
        // Five seconds of fast typing, which is not yet the interval.
        expect(said).toEqual([]);
    });

    it("re-asserts on the interval, so the traffic is the interval and not the typing", () => {
        // The point of the whole arrangement: this travels to every machine in the room, so a
        // message per keystroke would be a room shouting one bit of news at itself.
        let clock = 0;
        const { port, said } = recorder();
        const view = hold(port, () => clock);
        view.rerender({ blockId: "b" as StoryBlockId });
        said.length = 0;

        // Four minutes of writing at ten characters a second.
        for (let keystroke = 0; keystroke < 2400; keystroke += 1) {
            clock += 100;
            view.result.current("b" as StoryBlockId);
        }

        expect(said.every(one => one.holding && one.blockId === "b")).toBe(true);
        expect(said).toHaveLength(240_000 / CLAIM_REASSERT_MS);
    });

    it("says nothing for a character in a row this window is not holding", () => {
        // A claim the host refused, or a row that was never taken. Saying so again would not make
        // it this author's.
        let clock = 0;
        const { port, said } = recorder();
        const view = hold(port, () => clock);
        view.rerender({ blockId: "b" as StoryBlockId });
        said.length = 0;

        clock += CLAIM_REASSERT_MS * 4;
        view.result.current("c" as StoryBlockId);
        expect(said).toEqual([]);
    });

    it("stops saying anything once the row is given back", () => {
        let clock = 0;
        const { port, said } = recorder();
        const view = hold(port, () => clock);
        view.rerender({ blockId: "b" as StoryBlockId });
        view.rerender({ blockId: null });
        said.length = 0;

        clock += CLAIM_REASSERT_MS * 4;
        view.result.current("b" as StoryBlockId);
        expect(said).toEqual([]);
    });
});
