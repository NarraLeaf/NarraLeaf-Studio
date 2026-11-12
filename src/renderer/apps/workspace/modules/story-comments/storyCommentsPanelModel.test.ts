import { describe, expect, it } from "vitest";
import type { StoryCommentThread } from "@shared/types/storyComments";
import { filterStoryCommentThreads, groupStoryCommentThreads, type StoryCommentLocator } from "./storyCommentsPanelModel";

function thread(id: string, patch: Partial<StoryCommentThread> = {}, author = "Ada"): StoryCommentThread {
    return {
        id,
        storyId: "s",
        sceneId: "a",
        blockId: `b-${id}`,
        todo: false,
        resolved: false,
        createdAt: 1,
        comments: [{ id: `c-${id}`, author: { name: author }, body: `body ${id}`, createdAt: 1 }],
        ...patch,
    };
}

/** Rows in scene "a" except those whose block id is listed as gone; "moved" rows are in scene "b". */
const locator = (gone: string[] = [], moved: string[] = []): StoryCommentLocator => t => ({
    found: !gone.includes(t.blockId),
    storyId: "s",
    sceneId: moved.includes(t.blockId) ? "b" : t.sceneId,
    storyName: "Story",
    sceneName: moved.includes(t.blockId) ? "Second" : "First",
    text: `line ${t.id}`,
});

describe("comments panel model", () => {
    const threads = [
        thread("1"),
        thread("2", { resolved: true }),
        thread("3", { todo: true }, "Bo"),
        thread("4", { todo: true, resolved: true }),
    ];

    it("filters by state", () => {
        const ids = (status: "open" | "resolved" | "todo" | "all") =>
            filterStoryCommentThreads(threads, { status, authorKey: null, query: "" }, locator()).map(t => t.id);
        expect(ids("open")).toEqual(["1", "3"]);
        expect(ids("resolved")).toEqual(["2", "4"]);
        expect(ids("todo")).toEqual(["3"]);
        expect(ids("all")).toEqual(["1", "2", "3", "4"]);
    });

    it("filters by author and by text", () => {
        expect(filterStoryCommentThreads(threads, { status: "all", authorKey: "name:Bo", query: "" }, locator()).map(t => t.id)).toEqual(["3"]);
        expect(filterStoryCommentThreads(threads, { status: "all", authorKey: null, query: "BODY 2" }, locator()).map(t => t.id)).toEqual(["2"]);
    });

    it("groups by the scene the row is in now, with orphans last", () => {
        const groups = groupStoryCommentThreads(threads, locator(["b-2"], ["b-3"]));
        expect(groups.map(group => [group.key, group.threads.map(t => t.id)])).toEqual([
            ["s:a", ["1", "4"]],
            ["s:b", ["3"]],
            ["orphans", ["2"]],
        ]);
        expect(groups[2].orphan).toBe(true);
    });
});
