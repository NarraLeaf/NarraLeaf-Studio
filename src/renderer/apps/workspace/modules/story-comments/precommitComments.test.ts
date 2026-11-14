import { describe, expect, it } from "vitest";
import type { StoryCommentThread } from "@shared/types/storyComments";

import { openThreadsInChanges, storiesTouched } from "./precommitComments";

const thread = (id: string, storyId: string, resolved = false) =>
    ({ id, storyId, sceneId: "c", blockId: "b", resolved, comments: [] }) as unknown as StoryCommentThread;

describe("the open threads a commit is about to record over", () => {
    it("reads the stories out of the changed paths, either separator", () => {
        expect([...storiesTouched([
            "editor/story/stories/s1/storydoc.json",
            "editor\\story\\stories\\s2\\scenes\\c1.json",
            "editor/story/index.json",
            "assets/x.png",
        ])]).toEqual(["s1", "s2"]);
    });

    it("keeps the unresolved threads in touched stories only", () => {
        const threads = [thread("a", "s1"), thread("b", "s1", true), thread("c", "s2")];
        expect(openThreadsInChanges(threads, ["editor/story/stories/s1/storydoc.json"]).map(t => t.id)).toEqual(["a"]);
        expect(openThreadsInChanges(threads, ["assets/x.png"])).toEqual([]);
    });
});
