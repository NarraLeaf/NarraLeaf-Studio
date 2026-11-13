import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryDocument } from "@shared/types/story/document";
import { StoryDocumentJsonCache, composeStoryDocumentJson, sceneEntryJson } from "./storyDocumentJson";

const SKELETON_DOCS = ["content", "content.zh", "content.ja"].map(dir => resolve(
    __dirname,
    "../../../../../../resources/templates/skeleton",
    dir,
    "editor/story/stories/71bb159f-1322-4539-b09f-9593a426a67d/storydoc.json",
));

function plain(document: unknown): string {
    return JSON.stringify(document, null, 2);
}

describe("composeStoryDocumentJson", () => {
    it.each(SKELETON_DOCS)("matches JSON.stringify byte for byte on %s", path => {
        const document = JSON.parse(readFileSync(path, "utf-8")) as StoryDocument;
        expect(composeStoryDocumentJson(document, (id, scene) => sceneEntryJson(id, scene))).toBe(plain(document));
    });

    it("matches on the shapes JSON.stringify treats specially", () => {
        const document = {
            schemaVersion: 12,
            id: "s",
            name: "引号 \" 反斜杠 \\ 换行 \n 制表 \t",
            dropped: undefined,
            fn: () => 1,
            chapters: [],
            scenes: {
                empty: { id: "empty", blocks: {}, rootBlockIds: [] },
                gone: undefined,
                "key with \"quotes\"": { id: "q", nested: [[], {}, [1, null, "x"]], missing: undefined },
            },
            meta: { updatedAt: "now" },
        } as unknown as StoryDocument;
        expect(composeStoryDocumentJson(document, (id, scene) => sceneEntryJson(id, scene))).toBe(plain(document));
    });

    it("matches a document with no scenes, and one whose scenes come before other fields", () => {
        const none = { id: "a", scenes: {}, chapters: [] } as unknown as StoryDocument;
        expect(composeStoryDocumentJson(none, sceneEntryJson)).toBe(plain(none));
        const first = { scenes: { x: { id: "x" } }, id: "b" } as unknown as StoryDocument;
        expect(composeStoryDocumentJson(first, sceneEntryJson)).toBe(plain(first));
    });
});

describe("StoryDocumentJsonCache", () => {
    function documentWith(sceneCount: number): StoryDocument {
        const scenes: Record<string, unknown> = {};
        for (let i = 0; i < sceneCount; i += 1) {
            scenes[`scene-${i}`] = { id: `scene-${i}`, name: `场景 ${i}`, blocks: { [`b${i}`]: { text: `line ${i}` } } };
        }
        return { schemaVersion: 12, id: "story", name: "Story", chapters: [], scenes, meta: { updatedAt: "t" } } as unknown as StoryDocument;
    }

    it("re-serialises an invalidated scene and reuses the rest", () => {
        const cache = new StoryDocumentJsonCache();
        const document = documentWith(4);
        expect(cache.warm("story", document, () => true)).toBe(true);

        const scene = document.scenes["scene-2"] as unknown as { name: string };
        scene.name = "changed";
        cache.invalidate("story", ["scene-2"]);
        expect(cache.serialize("story", document)).toBe(plain(document));
    });

    it("writes a stale scene if a mutation names the wrong scene - which is why naming is opt-in", () => {
        const cache = new StoryDocumentJsonCache();
        const document = documentWith(2);
        cache.warm("story", document, () => true);
        (document.scenes["scene-1"] as unknown as { name: string }).name = "changed";
        cache.invalidate("story", ["scene-0"]);
        expect(cache.serialize("story", document)).not.toBe(plain(document));
        cache.invalidate("story");
        expect(cache.serialize("story", document)).toBe(plain(document));
    });

    it("stops warming when out of time and picks up where it left off", () => {
        const cache = new StoryDocumentJsonCache();
        const document = documentWith(5);
        let budget = 2;
        expect(cache.warm("story", document, () => budget-- > 0)).toBe(false);
        expect(cache.warm("story", document, () => true)).toBe(true);
        expect(cache.serialize("story", document)).toBe(plain(document));
    });

    it("takes the plain path while less than half the scenes are cached", () => {
        const cache = new StoryDocumentJsonCache();
        const document = documentWith(4);
        let budget = 1;
        cache.warm("story", document, () => budget-- > 0);
        expect(cache.serialize("story", document)).toBe(plain(document));
    });
});
