import { describe, expect, it } from "vitest";
import { appTagsSpec, brandSpec, dlcSpec } from "@shared/documents/specs";
import { appTagClaimKey, brandColorClaimKey, dlcClaimKey } from "@shared/live/ops";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import {
    APP_TAG_CLAIMS,
    BRAND_COLOR_CLAIMS,
    DLC_CLAIMS,
    appTagsDocumentFreezeScope,
    brandDocumentFreezeScope,
    configClaimHolder,
    dlcDocumentFreezeScope,
} from "./configLiveSession";

/**
 * What the project panel reads out of a session.
 *
 * The two things worth pinning are the two that have gone wrong before: a freeze scope spelled a
 * second time falls behind the file the service saves to, and a claim set read without its prefix
 * matches nothing at all - which is a mark that never appears while every test stays green.
 */

/**
 * A view with these claims standing.
 *
 * ⚠ Built through the product's own key functions rather than by writing strings here. A fixture
 * that spelled the keys itself would agree with an implementation that spelled them the same wrong
 * way, which is exactly how the story editor's claim marks went missing for weeks.
 */
function session(claims: Record<string, string>): LiveSessionView {
    return {
        ...IDLE_LIVE_SESSION,
        phase: "active",
        self: "instance-1",
        session: {
            id: "room-1",
            project: "p",
            revision: "r",
            story: "s",
            openedBy: "alice",
            openedByInstance: "instance-1",
            openedAt: 0,
            members: [{ instance: "instance-1", account: "alice", label: "alice", joinedAt: 0 }],
        },
        claims,
    };
}

describe("the freeze scope each configuration panel names", () => {
    it("is the file its own service saves to, through the document spec", () => {
        // A path written a second time is a path that falls behind the one the service writes, and
        // this one is compared against the set a session declares writable: if the two disagree, the
        // panel offers an edit the write boundary refuses.
        expect(appTagsDocumentFreezeScope()).toBe(appTagsSpec.pathFor());
        expect(dlcDocumentFreezeScope()).toBe(dlcSpec.pathFor());
        expect(brandDocumentFreezeScope()).toBe(brandSpec.pathFor());
    });
});

describe("who else is inside a row of a configuration table", () => {
    it("names the account holding it", () => {
        const view = session({ [dlcClaimKey("side")]: "ben" });
        expect(configClaimHolder(view, DLC_CLAIMS, "side")).toBe("ben");
    });

    it("answers nothing for a row nobody holds", () => {
        expect(configClaimHolder(session({}), DLC_CLAIMS, "side")).toBeNull();
    });

    it("leaves this window's own account out", () => {
        // A mark on the row its own author is inside is the one place it could be read as being
        // about them, and it would arrive and go as they moved between fields.
        const view = session({ [appTagClaimKey("t1")]: "alice" });
        expect(configClaimHolder(view, APP_TAG_CLAIMS, "t1")).toBeNull();
    });

    it("does not read a sibling table's key as its own, though they share one map", () => {
        // Every kind of claim lives in one set, keyed by a prefix. Three tables' bare ids meeting in
        // one map would be a confusion nothing could detect.
        const view = session({
            [appTagClaimKey("x")]: "ben",
            [dlcClaimKey("y")]: "ben",
            [brandColorClaimKey("z")]: "ben",
        });
        expect(configClaimHolder(view, DLC_CLAIMS, "x")).toBeNull();
        expect(configClaimHolder(view, BRAND_COLOR_CLAIMS, "y")).toBeNull();
        expect(configClaimHolder(view, APP_TAG_CLAIMS, "z")).toBeNull();
        expect(configClaimHolder(view, APP_TAG_CLAIMS, "x")).toBe("ben");
        expect(configClaimHolder(view, DLC_CLAIMS, "y")).toBe("ben");
        expect(configClaimHolder(view, BRAND_COLOR_CLAIMS, "z")).toBe("ben");
    });

    it("does not read a story row's or a character's key as its own either", () => {
        // The prefixes that were already there. A bare uuid is a legal id in all six spaces.
        const view = session({ "row:x": "ben", "character:x": "ben", "asset:x": "ben" });
        expect(configClaimHolder(view, APP_TAG_CLAIMS, "x")).toBeNull();
        expect(configClaimHolder(view, DLC_CLAIMS, "x")).toBeNull();
        expect(configClaimHolder(view, BRAND_COLOR_CLAIMS, "x")).toBeNull();
    });
});
