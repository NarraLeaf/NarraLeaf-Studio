// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { orphanTranslationUnitIds } from "@/lib/lint/rules/text/textSegments";
import { useStoryTextLineIndex } from "./OrphanUnits";

describe("useStoryTextLineIndex", () => {
    it("hides the previous orphan index while a changed story is being read", async () => {
        let entries: Array<{ id: string; name: string }> = [];
        let changed = () => {};
        let rejectRead!: (reason: Error) => void;
        const service = {
            listStories: () => entries,
            loadStory: vi.fn(() => new Promise((_, reject) => { rejectRead = reject; })),
            onLibraryChanged: (listener: () => void) => { changed = listener; return () => {}; },
            onDocumentChanged: () => () => {},
        } as unknown as StoryService;
        const { result } = renderHook(() => useStoryTextLineIndex(service));
        await waitFor(() => expect(result.current.kind).toBe("ready"));

        entries = [{ id: "added", name: "Added" }];
        act(() => changed());
        expect(result.current.kind).toBe("loading");

        await act(async () => { rejectRead(new Error("unreadable")); });
        expect(result.current.kind).toBe("unreadable");
    });

    it("recognizes a line in a newly loaded story before offering its translation for deletion", async () => {
        let entries: Array<{ id: string; name: string }> = [];
        let changed = () => {};
        let finishRead!: (document: unknown) => void;
        const service = {
            listStories: () => entries,
            loadStory: () => new Promise(resolve => { finishRead = resolve; }),
            onLibraryChanged: (listener: () => void) => { changed = listener; return () => {}; },
            onDocumentChanged: () => () => {},
        } as unknown as StoryService;
        const { result } = renderHook(() => useStoryTextLineIndex(service));
        await waitFor(() => expect(result.current.kind).toBe("ready"));
        if (result.current.kind !== "ready") throw new Error("index not ready");
        expect(orphanTranslationUnitIds({ line: {} }, result.current.live)).toEqual(["line"]);

        entries = [{ id: "story", name: "Story" }];
        act(() => changed());
        expect(result.current.kind).toBe("loading");
        await act(async () => finishRead({ scenes: { scene: {
            name: "Scene",
            rootBlockIds: ["block"],
            blocks: { block: {
                id: "block", kind: "nodeAction", childrenIds: [],
                payload: { action: "narration", text: { textId: "line", value: "Hello" } },
            } },
        } } }));
        if (result.current.kind !== "ready") throw new Error("index not ready");
        expect(orphanTranslationUnitIds({ line: {} }, result.current.live)).toEqual([]);
    });
});
