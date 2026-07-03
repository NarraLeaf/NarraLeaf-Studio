import path from "path";
import { describe, expect, it } from "vitest";
import { resolveStoryDocumentPathForIndexEntry } from "./bundleAssembler";

const STORY_ID = "00000000-0000-4000-8000-000000000001";

describe("bundleAssembler story documents", () => {
    it("derives story document paths from UUID story ids", () => {
        expect(resolveStoryDocumentPathForIndexEntry("/project", {
            id: STORY_ID,
        })).toBe(path.join("/project", "editor", "story", "stories", STORY_ID, "storydoc.json"));
    });

    it("rejects non-UUID story ids before resolving paths", () => {
        expect(resolveStoryDocumentPathForIndexEntry("/project", {
            id: "../outside",
        })).toBeNull();
    });
});
