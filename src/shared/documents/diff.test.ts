import {describe, expect, it} from "vitest";
import {buildDocumentDiff, countDocumentChanges, DocumentChange} from "./diff";

/**
 * The assembly step every producer of a diff goes through, including the `spec.diff`
 * implementations that do not exist yet.
 *
 * What it has to get right is the arithmetic of a truncated list, because every way of
 * getting it wrong looks the same from the outside: a list that says it is complete when
 * it is not, and an author who concludes the change they are looking for never happened.
 */

const leaf = (name: string): DocumentChange => ({
    path: [name],
    kind: "changed",
    label: {key: "documentDiff.structural.property", params: {name}},
});

describe("assembling a diff", () => {
    it("keeps everything when it fits", () => {
        const diff = buildDocumentDiff([leaf("a"), leaf("b")], {tier: "semantic", limit: 10});

        expect(diff.changes).toHaveLength(2);
        expect(diff.total).toBe(2);
        expect(diff.complete).toBe(true);
        expect(diff.tier).toBe("semantic");
    });

    it("drops from the end, so the caller's order decides what survives", () => {
        const diff = buildDocumentDiff([leaf("a"), leaf("b"), leaf("c")], {tier: "structural", limit: 2});

        expect(diff.changes.map(change => change.path[0])).toEqual(["a", "b"]);
        expect(diff.total).toBe(3);
        expect(diff.complete).toBe(false);
    });

    it("counts a group by its children rather than as one row", () => {
        const group: DocumentChange = {
            path: ["scenes"],
            kind: "changed",
            label: {key: "documentDiff.structural.property", params: {name: "scenes"}},
            children: [leaf("a"), leaf("b"), leaf("c")],
        };

        expect(countDocumentChanges([group])).toBe(3);
        expect(buildDocumentDiff([group], {tier: "semantic", limit: 10}).total).toBe(3);
    });

    it("keeps a group that does not fit, with fewer children and a count of the rest", () => {
        // Dropping the group outright would hide that it changed at all; keeping it whole
        // would break the budget. Neither is an option, so it is kept and marked.
        const group: DocumentChange = {
            path: ["scenes"],
            kind: "changed",
            label: {key: "documentDiff.structural.property", params: {name: "scenes"}},
            children: [leaf("a"), leaf("b"), leaf("c"), leaf("d")],
        };

        const diff = buildDocumentDiff([group], {tier: "semantic", limit: 2});

        expect(diff.changes[0].children).toHaveLength(2);
        expect(diff.changes[0].truncated).toBe(2);
        expect(diff.total).toBe(4);
        expect(diff.complete).toBe(false);
    });

    it("does not call a diff complete because a group's own count adds up to the total", () => {
        // The trap: `changes` stands for four changes and shows two. Comparing what it stands
        // for against the total says "complete", and the surface then draws a truncated list
        // as a whole one with no way for the author to tell.
        const group: DocumentChange = {
            path: ["scenes"],
            kind: "changed",
            label: {key: "documentDiff.structural.property"},
            children: [leaf("a"), leaf("b")],
            truncated: 2,
        };

        expect(buildDocumentDiff([group], {tier: "semantic", limit: 10, total: 4}).complete).toBe(false);
    });

    it("believes a producer that counted more than it built", () => {
        const diff = buildDocumentDiff([leaf("a")], {tier: "structural", limit: 10, total: 900});

        expect(diff.total).toBe(900);
        expect(diff.complete).toBe(false);
    });
});
