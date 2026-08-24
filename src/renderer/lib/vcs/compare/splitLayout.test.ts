import { describe, expect, it } from "vitest";
import type { DocumentChange, DocumentDiff } from "@shared/documents/diff";
import { buildDocumentChangeRows } from "../documentChangeView";
import {
    buildSplitSlots,
    layoutSplitSlots,
    splitColumnCount,
    SPLIT_TWO_COLUMN_MIN_PX,
} from "./splitLayout";
import { opensAsSplitComparison } from "./splitDocuments";
import { NO_ANCHOR, changePathAttribute, stepAnchor } from "./splitNavigation";

/**
 * The arithmetic behind a split comparison, without mounting one.
 *
 * Two of the three rules here are ones a component test cannot state at all, because jsdom does no
 * layout: whether the halves stay level and whether the navigation reaches every change are facts
 * about numbers, and the numbers are here.
 */

function change(kind: DocumentChange["kind"], path: string): DocumentChange {
    return { path: [path], kind, label: { key: `documentDiff.test.${kind}` } };
}

function diffOf(changes: readonly DocumentChange[]): DocumentDiff {
    return { changes, complete: true, total: changes.length, tier: "semantic" };
}

function slotsOf(changes: readonly DocumentChange[]) {
    return buildSplitSlots(buildDocumentChangeRows(diffOf(changes), 100).rows);
}

describe("splitColumnCount", () => {
    it("splits into two above the threshold and one below it", () => {
        expect(splitColumnCount(SPLIT_TWO_COLUMN_MIN_PX)).toBe(2);
        expect(splitColumnCount(SPLIT_TWO_COLUMN_MIN_PX + 400)).toBe(2);
        expect(splitColumnCount(SPLIT_TWO_COLUMN_MIN_PX - 1)).toBe(1);
        expect(splitColumnCount(320)).toBe(1);
    });

    it("draws two before it has been measured", () => {
        // The measurement happens in the ref callback, before the first paint, so this frame is
        // never on screen - but answering one here would make the fallback the default.
        expect(splitColumnCount(0)).toBe(2);
        expect(splitColumnCount(Number.NaN)).toBe(2);
    });
});

describe("buildSplitSlots", () => {
    it("puts a removal in the older half only and an addition in the newer half only", () => {
        const slots = slotsOf([
            change("removed", "a"),
            change("added", "b"),
            change("changed", "c"),
            change("moved", "d"),
        ]);
        expect(slots.map(slot => [slot.onBase, slot.onHead])).toEqual([
            [true, false],
            [false, true],
            [true, true],
            [true, true],
        ]);
    });
});

describe("layoutSplitSlots", () => {
    it("reserves a run present on one side only as a spacer opposite, and moves nothing up", () => {
        // Three removals in the middle: the older half draws them, the newer half has nothing there.
        const slots = slotsOf([
            change("changed", "before"),
            change("removed", "gone-1"),
            change("removed", "gone-2"),
            change("removed", "gone-3"),
            change("changed", "after"),
        ]);
        const base = new Map(slots.map(slot => [slot.key, 20]));
        const head = new Map([[slots[0].key, 20], [slots[4].key, 20]]);

        const layout = layoutSplitSlots(slots, base, head);

        // The gap is drawn at the height of what is opposite it, on the side that has nothing.
        expect(layout.map(slot => [slot.baseSpacer, slot.headSpacer])).toEqual([
            [false, false],
            [false, true],
            [false, true],
            [false, true],
            [false, false],
        ]);
        expect(layout.map(slot => slot.height)).toEqual([20, 20, 20, 20, 20]);

        // And the row after the run sits where it sat: the newer half did not pull it up into the
        // space the three removals left. 80 rather than the 20 it would be if the gap were closed.
        expect(layout[4].offset).toBe(80);
        // One offset per slot, and it is the offset in BOTH halves - which is the whole claim two
        // scrolled-together columns make.
        expect(layout.map(slot => slot.offset)).toEqual([0, 20, 40, 60, 80]);
    });

    it("reserves the taller of the two rows when both halves have one", () => {
        const slots = slotsOf([change("changed", "wraps")]);
        const layout = layoutSplitSlots(
            slots,
            new Map([[slots[0].key, 18]]),
            new Map([[slots[0].key, 54]]),
        );
        expect(layout[0].height).toBe(54);
    });

    it("is level at zero before anything has been measured", () => {
        const slots = slotsOf([change("changed", "a"), change("removed", "b")]);
        const layout = layoutSplitSlots(slots, new Map(), new Map());
        expect(layout.map(slot => [slot.height, slot.offset])).toEqual([[0, 0], [0, 0]]);
    });
});

describe("stepAnchor", () => {
    it("visits every change once in each direction and wraps", () => {
        const total = 5;
        const forwards: number[] = [];
        let at = NO_ANCHOR;
        for (let press = 0; press < total; press += 1) {
            at = stepAnchor(total, at, 1);
            forwards.push(at);
        }
        expect(forwards).toEqual([0, 1, 2, 3, 4]);
        expect(stepAnchor(total, at, 1)).toBe(0);

        const backwards: number[] = [];
        at = NO_ANCHOR;
        for (let press = 0; press < total; press += 1) {
            at = stepAnchor(total, at, -1);
            backwards.push(at);
        }
        expect(backwards).toEqual([4, 3, 2, 1, 0]);
        expect(stepAnchor(total, at, -1)).toBe(4);
    });

    it("has nowhere to go in a document with no changes", () => {
        expect(stepAnchor(0, NO_ANCHOR, 1)).toBe(NO_ANCHOR);
    });
});

describe("changePathAttribute", () => {
    it("writes the change's own path, which is what a merge decision is taken on", () => {
        expect(changePathAttribute(["scenes", "0", "name"])).toBe("scenes/0/name");
        expect(changePathAttribute([])).toBe("");
    });
});

describe("opensAsSplitComparison", () => {
    it("offers a tab for the three kinds an editor exists for, and for nothing else", () => {
        const entry = (documentKind?: string) => ({
            path: "x",
            kind: "changed" as const,
            documentKind,
            diff: diffOf([]),
        } as never);
        expect(opensAsSplitComparison(entry("story"))).toBe(true);
        expect(opensAsSplitComparison(entry("ui-document"))).toBe(true);
        expect(opensAsSplitComparison(entry("ui-graphs"))).toBe(true);
        expect(opensAsSplitComparison(entry("brand"))).toBe(false);
        expect(opensAsSplitComparison(entry("assets-metadata"))).toBe(false);
        expect(opensAsSplitComparison(entry(undefined))).toBe(false);
    });
});
