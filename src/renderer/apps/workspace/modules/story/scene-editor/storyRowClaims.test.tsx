// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { storyRowClaimKey } from "@shared/live/ops";
import type { StoryBlockId, StoryId } from "@shared/types/story";
import type { TeamLiveSession } from "@shared/types/team";
import {
    othersClaims,
    rowClaimHolder,
    StoryRowClaimMark,
    StoryRowClaimsProvider,
    useStoryRowClaim,
} from "./storyRowClaims";

/**
 * The mark a row wears while somebody else in a live session is writing it.
 *
 * Two things are pinned here and they pull in opposite directions. The mark has to appear on the
 * rows a claim covers, because without it the first an author knows about a claim is a refusal
 * after they have typed a paragraph - the failure the claim exists to prevent, one gesture late.
 * And it must cost the row no width at all: a story row is fixed columns and a body that wraps, so
 * anything added to that flow re-wraps the words while somebody is reading them.
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
}));

// One workspace object for the whole file: the real one is a React context value and is stable for
// the life of the window.
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

// Seeded before rather than after, so the first test starts from a window in no session.
beforeEach(() => {
    world.view = IDLE_LIVE_SESSION;
    world.listeners.clear();
});

afterEach(cleanup);

const STORY = "story-1" as StoryId;

function room(): TeamLiveSession {
    return {
        id: "room-1",
        project: "abc",
        openedBy: "bob",
        openedByInstance: "bob-1",
        openedAt: 1,
        members: [
            { instance: "mine", account: "ada", label: "Nomen", joinedAt: 1 },
            { instance: "bob-1", account: "bob", label: "iMac", joinedAt: 1 },
        ],
    };
}

/**
 * A room whose claim set is keyed the way the wire keys it.
 *
 * ⚠ **Through `storyRowClaimKey`, not by block id.** The set carries every kind of claim a session
 * records - rows, character records, translations, asset records - under one prefixed key space, and
 * a test that seeded bare block ids agreed with a reader that never matched anything on a real
 * machine: every row went unmarked while every assertion here passed.
 */
function session(claims: Record<string, string>, overrides: Partial<LiveSessionView> = {}): LiveSessionView {
    const keyed: Record<string, string> = {};
    for (const [blockId, account] of Object.entries(claims)) {
        keyed[storyRowClaimKey(blockId as StoryBlockId)] = account;
    }
    return {
        ...IDLE_LIVE_SESSION,
        phase: "active",
        role: "guest",
        session: room(),
        storyId: STORY,
        self: "mine",
        claims: keyed as Record<StoryBlockId, string>,
        ...overrides,
    };
}

/** One row asking who holds it, which is all a row does with this. */
function Row({ blockId }: { blockId: string }) {
    const claim = useStoryRowClaim(blockId as StoryBlockId);
    return <span data-row={blockId} data-claim={claim ?? ""} />;
}

function claimOn(blockId: string): string {
    return document.querySelector<HTMLElement>(`[data-row='${blockId}']`)?.dataset.claim ?? "";
}

describe("which rows are marked", () => {
    it("marks a row somebody else is writing, and leaves the rest alone", () => {
        world.view = session({ "block-2": "bob" });
        render(
            <StoryRowClaimsProvider storyId={STORY}>
                <Row blockId="block-1" />
                <Row blockId="block-2" />
            </StoryRowClaimsProvider>,
        );

        expect(claimOn("block-1")).toBe("");
        expect(claimOn("block-2")).toBe("bob");
    });

    it("leaves this author's own rows unmarked", () => {
        // A mark on the row the author is typing in is the one place it could be read as being
        // about them, and it would arrive and go as they moved between lines.
        world.view = session({ "block-1": "ada", "block-2": "bob" });
        render(
            <StoryRowClaimsProvider storyId={STORY}>
                <Row blockId="block-1" />
                <Row blockId="block-2" />
            </StoryRowClaimsProvider>,
        );

        expect(claimOn("block-1")).toBe("");
        expect(claimOn("block-2")).toBe("bob");
    });

    it("marks nothing in a scene of another story", () => {
        // A session owns one document. A scene of a different story is not part of the room, and
        // its rows are this author's own to write.
        world.view = session({ "block-2": "bob" });
        render(
            <StoryRowClaimsProvider storyId={"story-2" as StoryId}>
                <Row blockId="block-2" />
            </StoryRowClaimsProvider>,
        );

        expect(claimOn("block-2")).toBe("");
    });

    it("ignores the claims of every other kind of document in the same set", () => {
        // The set holds rows, characters, translations and assets at once. A reader that took every
        // key would put a translator's name on a picture - or, as it did, match nothing at all.
        world.view = {
            ...session({ "block-2": "bob" }),
            claims: {
                "row:block-2": "bob",
                "character:block-1": "bob",
                "asset:block-1": "bob",
            } as Record<StoryBlockId, string>,
        };
        render(
            <StoryRowClaimsProvider storyId={STORY}>
                <Row blockId="block-1" />
                <Row blockId="block-2" />
            </StoryRowClaimsProvider>,
        );

        expect(claimOn("block-1")).toBe("");
        expect(claimOn("block-2")).toBe("bob");
    });

    it("marks nothing outside a session", () => {
        world.view = IDLE_LIVE_SESSION;
        render(
            <StoryRowClaimsProvider storyId={STORY}>
                <Row blockId="block-2" />
            </StoryRowClaimsProvider>,
        );

        expect(claimOn("block-2")).toBe("");
    });

    it("answers the same set with the same value, so an unchanged room repaints nothing", () => {
        // The session publishes on every operation anybody in the room applies. A fresh object
        // each time would re-render every row on screen for a set of claims that had not moved.
        const first = othersClaims(session({ "block-2": "bob" }), STORY);
        const second = othersClaims(session({ "block-2": "bob" }), STORY);
        expect(first).toEqual(second);
        expect(othersClaims(IDLE_LIVE_SESSION, STORY)).toEqual({});
    });
});

describe("the same answer for one row, read without React", () => {
    /**
     * What the controller asks before a click becomes a caret. It sits outside the provider the
     * rows read from, so the two readers must agree exactly: a row that wears the mark and still
     * accepts typing would let an author write a paragraph the host is certain to refuse.
     */
    const BLOCK = "block-2" as StoryBlockId;

    it("names the holder of a row somebody else is writing", () => {
        expect(rowClaimHolder(session({ "block-2": "bob" }), STORY, BLOCK)).toBe("bob");
    });

    it("answers null for this author's own row, for a free row, and for another story", () => {
        expect(rowClaimHolder(session({ "block-2": "ada" }), STORY, BLOCK)).toBeNull();
        expect(rowClaimHolder(session({}), STORY, BLOCK)).toBeNull();
        expect(rowClaimHolder(session({ "block-2": "bob" }), "story-2" as StoryId, BLOCK)).toBeNull();
        expect(rowClaimHolder(IDLE_LIVE_SESSION, STORY, BLOCK)).toBeNull();
    });

    it("agrees with the set the rows are marked from, row for row", () => {
        const view = session({ "block-1": "ada", "block-2": "bob" });
        const marked = othersClaims(view, STORY);
        for (const blockId of ["block-1", "block-2", "block-3"] as StoryBlockId[]) {
            expect(rowClaimHolder(view, STORY, blockId)).toBe(marked[blockId] ?? null);
        }
    });
});

describe("what the mark costs the row", () => {
    it("names the holder on hover, because there is no width for a name", () => {
        render(<StoryRowClaimMark account="bob" />);
        const mark = document.querySelector<HTMLElement>("[data-story-row-claim]");

        expect(mark?.dataset.storyRowClaim).toBe("bob");
        // `data-tip`, never `title`: a native tooltip covers the pixels the pointer is aimed at,
        // and this one hangs over an editing surface.
        expect(mark?.getAttribute("data-tip")).toBe("story.live.rowClaimed(bob)");
        expect(mark?.getAttribute("title")).toBeNull();
    });

    it("takes no width from the row", () => {
        render(<StoryRowClaimMark account="bob" />);
        const mark = document.querySelector<HTMLElement>("[data-story-row-claim]");

        // Out of the row's flex entirely, in the trailing padding where nothing else is drawn -
        // so a claim taken and dropped while somebody types never re-wraps the words beside it.
        expect(mark?.className).toContain("absolute");
        expect(mark?.className).toContain("right-0");
    });

    it("lifts itself off a background row's artwork strip", () => {
        render(<StoryRowClaimMark account="bob" onArtwork />);
        // The same class the row's own hover controls take when they land on the strip.
        expect(document.querySelector("[data-story-row-claim]")?.className).toContain("nl-on-media");
    });
});
