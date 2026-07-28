import { describe, expect, it } from "vitest";
import { mergeBase } from "./revisionReader";
import type { RevisionNode } from "./lore";

/**
 * Merge-base resolution, which Lore does not provide.
 *
 * There is no `lore_*` entry point returning a common ancestor, and the merge
 * conflict event carries only a path - so Studio computes the base itself from the
 * two parent slots on each revision. That makes it a pure function over a graph,
 * and worth testing without the native library: the topologies that break an LCA
 * are tedious to produce through real commits and trivial to write down.
 */

function graph(...nodes: Array<[string, number, string[]]>): Map<string, RevisionNode> {
    const map = new Map<string, RevisionNode>();
    for (const [revision, number, parents] of nodes) {
        map.set(revision, { revision, number, parents });
    }
    return map;
}

describe("mergeBase", () => {
    it("returns the shared ancestor of a simple fork", () => {
        //   a - b - c        (main)
        //        \- d - e    (branch)
        const dag = graph(
            ["a", 1, []],
            ["b", 2, ["a"]],
            ["c", 3, ["b"]],
            ["d", 3, ["b"]],
            ["e", 4, ["d"]],
        );
        expect(mergeBase(dag, "c", "e")).toBe("b");
        // Order must not matter.
        expect(mergeBase(dag, "e", "c")).toBe("b");
    });

    it("returns the older revision when one side is an ancestor of the other", () => {
        const dag = graph(["a", 1, []], ["b", 2, ["a"]], ["c", 3, ["b"]]);
        expect(mergeBase(dag, "c", "a")).toBe("a");
        expect(mergeBase(dag, "c", "c")).toBe("c");
    });

    it("follows both parents of a merge revision", () => {
        //   a - b ---- m      m has parents b and d
        //    \- c - d -/
        //       b -- x        x is a sibling of m, not an ancestor
        const dag = graph(
            ["a", 1, []],
            ["b", 2, ["a"]],
            ["c", 2, ["a"]],
            ["d", 3, ["c"]],
            ["m", 4, ["b", "d"]],
            ["x", 3, ["b"]],
        );
        // Reachable only through the merge's SECOND parent.
        expect(mergeBase(dag, "m", "d")).toBe("d");
        // x forked from b and was never merged, so the shared ancestor is b - not x,
        // which is what a traversal following only first parents would report.
        expect(mergeBase(dag, "m", "x")).toBe("b");
    });

    it("returns undefined for unrelated histories", () => {
        // Two roots with no shared ancestor. The caller must treat a missing base as
        // an add/add conflict, NOT as an empty file - assuming empty silently accepts
        // one side of the merge.
        const dag = graph(["a", 1, []], ["b", 2, ["a"]], ["x", 1, []], ["y", 2, ["x"]]);
        expect(mergeBase(dag, "b", "y")).toBeUndefined();
    });

    it("resolves a criss-cross to one stable candidate", () => {
        // Two branches that have merged each other leave SEVERAL equally-minimal
        // common ancestors - here b and c, both at revision number 2. Git resolves
        // this by recursively merging them; Studio picks one, which is the documented
        // degradation: a slightly worse base means the user sees a few extra
        // conflicts, never a wrong merge.
        //
        // What this pins is that the choice is STABLE. Without the id tie-break the
        // winner depended on traversal order, so two people merging the same pair of
        // branches could be shown different conflicts.
        const dag = graph(
            ["a", 1, []],
            ["b", 2, ["a"]],
            ["c", 2, ["a"]],
            ["m1", 3, ["b", "c"]],
            ["m2", 4, ["c", "b"]],
            ["left", 5, ["m1"]],
            ["right", 6, ["m2"]],
        );
        expect(mergeBase(dag, "left", "right")).toBe("b");
        expect(mergeBase(dag, "right", "left")).toBe("b");
    });

    it("terminates on a cycle rather than hanging", () => {
        // Lore cannot produce one, but the graph arrives over FFI and a hung main
        // process is a far worse failure than a wrong answer.
        const dag = graph(["a", 1, ["b"]], ["b", 2, ["a"]]);
        expect(() => mergeBase(dag, "a", "b")).not.toThrow();
    });
});
