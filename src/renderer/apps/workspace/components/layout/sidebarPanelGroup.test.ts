import { describe, it, expect } from "vitest";
import { isRailLayoutDefault, SIDEBAR_GROUP_ID, weaveGroupSlot } from "./sidebarPanelGroup";

const G = SIDEBAR_GROUP_ID;

describe("weaveGroupSlot", () => {
    it("puts the group last when the stored order says nothing about it", () => {
        expect(weaveGroupSlot(["A", "B"], undefined)).toEqual(["A", "B", G]);
        expect(weaveGroupSlot(["A", "B"], ["A", "B"])).toEqual(["A", "B", G]);
    });

    it("restores the recorded slot", () => {
        expect(weaveGroupSlot(["A", "B", "C"], ["A", G, "B", "C"])).toEqual(["A", G, "B", "C"]);
    });

    it("puts the group first when nothing precedes it", () => {
        expect(weaveGroupSlot(["A", "B"], [G, "A", "B"])).toEqual([G, "A", "B"]);
    });

    it("anchors to the nearest surviving predecessor when panels went missing", () => {
        // "B" is recorded before the group but is not registered in this window (a plugin panel
        // from another install); the group falls back to sitting after "A".
        expect(weaveGroupSlot(["A", "C"], ["A", "B", G, "C"])).toEqual(["A", G, "C"]);
    });

    it("puts the group first when every recorded predecessor is gone", () => {
        expect(weaveGroupSlot(["C"], ["A", "B", G, "C"])).toEqual([G, "C"]);
    });

    it("handles an empty dock", () => {
        expect(weaveGroupSlot([], ["A", G])).toEqual([G]);
    });
});

describe("isRailLayoutDefault", () => {
    const DEFAULTS = {
        railIds: ["A", "B", G],
        defaultRailIds: ["A", "B", G],
        hiddenIds: [] as string[],
        collapsedIds: ["C", "D"],
        defaultCollapsedIds: ["C", "D"],
    };

    it("accepts a rail that matches on all three counts", () => {
        expect(isRailLayoutDefault(DEFAULTS)).toBe(true);
    });

    it("ignores the order the collapse group's members are stored in", () => {
        expect(isRailLayoutDefault({ ...DEFAULTS, collapsedIds: ["D", "C"] })).toBe(true);
    });

    it("rejects a reordered rail", () => {
        expect(isRailLayoutDefault({ ...DEFAULTS, railIds: ["B", "A", G] })).toBe(false);
    });

    it("rejects a rail with the group dragged out of its default slot", () => {
        expect(isRailLayoutDefault({ ...DEFAULTS, railIds: [G, "A", "B"] })).toBe(false);
    });

    it("rejects a rail with a hidden panel, however tidy the rest is", () => {
        expect(isRailLayoutDefault({ ...DEFAULTS, hiddenIds: ["B"] })).toBe(false);
    });

    it("rejects a collapse group the author has added to, emptied, or swapped a member of", () => {
        expect(isRailLayoutDefault({ ...DEFAULTS, collapsedIds: ["C", "D", "A"] })).toBe(false);
        expect(isRailLayoutDefault({ ...DEFAULTS, collapsedIds: [] })).toBe(false);
        expect(isRailLayoutDefault({ ...DEFAULTS, collapsedIds: ["C", "A"] })).toBe(false);
    });

    it("accepts a dock with no group at all", () => {
        expect(isRailLayoutDefault({
            railIds: ["A", "B"],
            defaultRailIds: ["A", "B"],
            hiddenIds: [],
            collapsedIds: [],
            defaultCollapsedIds: [],
        })).toBe(true);
    });
});
