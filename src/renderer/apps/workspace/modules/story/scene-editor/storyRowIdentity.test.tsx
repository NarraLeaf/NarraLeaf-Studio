// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import type { VisibleStoryRow } from "./storySceneEditorTypes";
import { isDeepEqualProjection, useContentStable, useDocumentStableForRows, useStableVisibleRows } from "./storyRowIdentity";

function narration(id: string, text: string): StoryBlock {
    return { id, kind: "narration", payload: { text }, childrenIds: [] } as unknown as StoryBlock;
}

function rowFor(block: StoryBlock, lineNumber: number): VisibleStoryRow {
    return { block, depth: 0, lineNumber };
}

function documentWith(scenes: Record<string, unknown>): StoryDocument {
    return { id: "story", name: "Story", schemaVersion: 20, chapters: [], scenes } as unknown as StoryDocument;
}

describe("isDeepEqualProjection", () => {
    it("compares plain data by what it says", () => {
        expect(isDeepEqualProjection({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true);
        expect(isDeepEqualProjection({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] })).toBe(false);
        expect(isDeepEqualProjection([1, 2], [1, 2, 3])).toBe(false);
        expect(isDeepEqualProjection({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        expect(isDeepEqualProjection(null, undefined)).toBe(false);
    });
});

describe("useContentStable", () => {
    it("keeps the identity it had while the value still says the same", () => {
        const first = { images: [{ id: "a", name: "A" }] };
        const { result, rerender } = renderHook(({ value }) => useContentStable(value), {
            initialProps: { value: first },
        });
        expect(result.current).toBe(first);

        // A rebuild that produced the same table: same identity, so a memoised row does not re-render.
        rerender({ value: { images: [{ id: "a", name: "A" }] } });
        expect(result.current).toBe(first);

        // A table that actually changed has to cross the memo boundary.
        const changed = { images: [{ id: "a", name: "A2" }] };
        rerender({ value: changed });
        expect(result.current).toBe(changed);
    });
});

describe("useDocumentStableForRows", () => {
    it("holds the previous wrapper across a re-spread that changed none of the reference data", () => {
        const scenes = { s1: { id: "s1", name: "One" } };
        const first = documentWith(scenes);
        const signature = { scenes: [{ id: "s1", name: "One" }] };
        const { result, rerender } = renderHook(
            ({ document, sig }) => useDocumentStableForRows(document, sig),
            { initialProps: { document: first, sig: signature } },
        );
        expect(result.current).toBe(first);

        // What the controller does on every mutation: a new wrapper over the same live scenes.
        const respread = { ...first };
        rerender({ document: respread, sig: { scenes: [{ id: "s1", name: "One" }] } });
        expect(result.current).toBe(first);
        // And it still reads the live data, because the map underneath is the same object.
        expect(result.current?.scenes).toBe(scenes);
    });

    it("hands over the new wrapper when a name a row prints has changed", () => {
        const first = documentWith({ s1: { id: "s1", name: "One" } });
        const { result, rerender } = renderHook(
            ({ document, sig }) => useDocumentStableForRows(document, sig),
            { initialProps: { document: first, sig: { scenes: [{ id: "s1", name: "One" }] } } },
        );
        const renamed = { ...first };
        rerender({ document: renamed, sig: { scenes: [{ id: "s1", name: "Two" }] } });
        expect(result.current).toBe(renamed);
    });

    it("hands over the new wrapper when the scenes map itself was replaced", () => {
        // A document loaded afresh rather than mutated: the old wrapper would read a map nothing
        // writes to any more, which is the one way holding on to it could go stale.
        const first = documentWith({ s1: { id: "s1", name: "One" } });
        const { result, rerender } = renderHook(
            ({ document, sig }) => useDocumentStableForRows(document, sig),
            { initialProps: { document: first, sig: { scenes: [{ id: "s1", name: "One" }] } } },
        );
        const reloaded = documentWith({ s1: { id: "s1", name: "One" } });
        rerender({ document: reloaded, sig: { scenes: [{ id: "s1", name: "One" }] } });
        expect(result.current).toBe(reloaded);
    });
});

describe("useStableVisibleRows", () => {
    it("keeps a row's projection while it still projects the same line", () => {
        const block = narration("b1", "hello");
        const { result } = renderHook(() => useStableVisibleRows());
        const first = rowFor(block, 1);
        expect(result.current(first)).toBe(first);
        // The next document change rebuilds the projection; nothing about this line moved.
        expect(result.current(rowFor(block, 1))).toBe(first);
    });

    it("gives up the projection when the block was edited IN PLACE", () => {
        // The service rewrites `block.payload` on the object the cache is holding, so the cache can
        // only tell by the signature it took before the edit. Comparing against the held row would
        // find them equal *because both are the new text*, and the line the author is typing into
        // would be the one line that never repaints.
        const block = narration("b1", "hello");
        const { result } = renderHook(() => useStableVisibleRows());
        const first = rowFor(block, 1);
        expect(result.current(first)).toBe(first);

        (block.payload as { text: string }).text = "hello, world";
        const rebuilt = rowFor(block, 1);
        expect(result.current(rebuilt)).toBe(rebuilt);
    });

    it("gives up the projection when the row moved without its block changing", () => {
        const block = narration("b1", "hello");
        const { result } = renderHook(() => useStableVisibleRows());
        const first = rowFor(block, 1);
        expect(result.current(first)).toBe(first);
        const renumbered = rowFor(block, 2);
        expect(result.current(renumbered)).toBe(renumbered);
    });
});
