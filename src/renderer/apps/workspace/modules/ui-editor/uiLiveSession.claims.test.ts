import { describe, expect, it } from "vitest";
import {
    assetClaimKey,
    characterClaimKey,
    storyRowClaimKey,
    uiElementClaimKey,
    uiNodeClaimKey,
} from "@shared/live/ops";
import type { TeamLiveSession } from "@shared/types/team";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { othersUINodeClaims } from "../blueprint-lite/blueprintLiveSession";
import { othersUIElementClaims, uiElementClaimHolder } from "./uiLiveSession";

/**
 * Which claims the interface and the blueprint canvas read back out of the room's set.
 *
 * **The rule these hold to is the one the story editor learnt the expensive way**: one claim set
 * carries every kind of claim a session records, under one prefixed key space, and a reader that
 * took a bare uuid for its own matched nothing on a real machine while every assertion in its tests
 * passed. So nothing here writes a key by hand - the fixtures build them with the product's own
 * functions, and every case includes somebody else's kind of claim in the same set.
 */

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

function session(claims: Record<string, string>): LiveSessionView {
    return {
        ...IDLE_LIVE_SESSION,
        phase: "active",
        role: "guest",
        session: room(),
        self: "mine",
        claims,
    };
}

/** Every other kind of claim a room can be carrying at the same moment. */
function foreignClaims(): Record<string, string> {
    return {
        [storyRowClaimKey("block-2")]: "bob",
        [characterClaimKey("char-1")]: "bob",
        [assetClaimKey("asset-1")]: "bob",
    };
}

describe("the claims the interface reads", () => {
    it("takes its own keys and leaves every other kind alone", () => {
        const view = session({
            ...foreignClaims(),
            [uiElementClaimKey(null, "el-1")]: "bob",
            [uiNodeClaimKey("bp-1", "ev-1", "n-1")]: "bob",
        });
        expect(othersUIElementClaims(view)).toEqual({ [uiElementClaimKey(null, "el-1")]: "bob" });
    });

    it("tells an element of a Surface from an element of a component", () => {
        // Two address spaces keyed the same way: a component definition owns its own element map,
        // and reading one back out as the other would draw a mark on the wrong screen.
        const view = session({
            [uiElementClaimKey(null, "el-1")]: "bob",
            [uiElementClaimKey("comp-1", "el-1")]: "bob",
        });
        expect(uiElementClaimHolder(view, null, "el-1")).toBe("bob");
        expect(uiElementClaimHolder(view, "comp-1", "el-1")).toBe("bob");
        expect(uiElementClaimHolder(view, "comp-2", "el-1")).toBeNull();
    });

    it("leaves this window's own claim unmarked", () => {
        // A mark on the element its author has selected is the one place it could be read as being
        // about them, and it would arrive and go as they moved between elements.
        const view = session({ [uiElementClaimKey(null, "el-1")]: "ada" });
        expect(othersUIElementClaims(view)).toEqual({});
        expect(uiElementClaimHolder(view, null, "el-1")).toBeNull();
    });
});

describe("the claims the blueprint canvas reads", () => {
    it("takes its own keys and leaves every other kind alone", () => {
        const view = session({
            ...foreignClaims(),
            [uiElementClaimKey(null, "el-1")]: "bob",
            [uiNodeClaimKey("bp-1", "ev-1", "n-1")]: "bob",
        });
        expect(othersUINodeClaims(view)).toEqual({ [uiNodeClaimKey("bp-1", "ev-1", "n-1")]: "bob" });
    });

    it("tells one blueprint's node from another's under the same id", () => {
        // ⚠ The seeded entry nodes use fixed ids - `global.appBoot` is in every project - so a key
        // naming the node alone would have one Surface's boot node holding every other Surface's.
        const view = session({
            [uiNodeClaimKey("bp-1", "ev-1", "global.appBoot")]: "bob",
        });
        const held = othersUINodeClaims(view);
        expect(held[uiNodeClaimKey("bp-1", "ev-1", "global.appBoot")]).toBe("bob");
        expect(held[uiNodeClaimKey("bp-2", "ev-1", "global.appBoot")]).toBeUndefined();
        expect(held[uiNodeClaimKey("bp-1", "ev-2", "global.appBoot")]).toBeUndefined();
    });
});
