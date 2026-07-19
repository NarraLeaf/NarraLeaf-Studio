import { describe, it, expect } from "vitest";
import { StatusBarAlignment } from "@/lib/workspace/services/ui/types";
import { orderStatusBarEntries } from "./statusBarEntryOrder";

const { Left, Right } = StatusBarAlignment;

/** Registration order: two left entries, then three right ones. */
const ENTRIES = [
    { id: "L1", alignment: Left },
    { id: "L2", alignment: Left },
    { id: "R1", alignment: Right },
    { id: "R2", alignment: Right },
    { id: "R3", alignment: Right },
];

const ids = (entries: { id: string }[]) => entries.map(entry => entry.id);
const none: ReadonlySet<string> = new Set();

describe("orderStatusBarEntries", () => {
    it("lays the left side out in registration order, so later entries sit further toward the middle", () => {
        expect(ids(orderStatusBarEntries(ENTRIES, Left, none))).toEqual(["L1", "L2"]);
    });

    it("reverses the right side, so the first registration pins to the far right corner", () => {
        expect(ids(orderStatusBarEntries(ENTRIES, Right, none))).toEqual(["R3", "R2", "R1"]);
    });

    it("drops hidden entries and closes the gap against the edge", () => {
        expect(ids(orderStatusBarEntries(ENTRIES, Right, new Set(["R2"])))).toEqual(["R3", "R1"]);
        expect(ids(orderStatusBarEntries(ENTRIES, Left, new Set(["L1"])))).toEqual(["L2"]);
    });

    it("keeps the outermost entry outermost when an inner one is hidden", () => {
        // Hiding R3 must not promote a different entry into the corner - R1 stays pinned there.
        expect(ids(orderStatusBarEntries(ENTRIES, Right, new Set(["R3"])))).toEqual(["R2", "R1"]);
    });

    it("returns nothing when every entry on that side is hidden", () => {
        expect(orderStatusBarEntries(ENTRIES, Left, new Set(["L1", "L2"]))).toEqual([]);
    });

    it("does not mutate the input array", () => {
        const entries = [...ENTRIES];
        orderStatusBarEntries(entries, Right, none);
        expect(ids(entries)).toEqual(["L1", "L2", "R1", "R2", "R3"]);
    });
});
