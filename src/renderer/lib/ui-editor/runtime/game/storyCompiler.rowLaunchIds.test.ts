import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { compileStudioStoryToNlr } from "./storyCompiler";
import { computeStoryStageSnapshot } from "./storyStageSnapshot";

/**
 * What the opening scene of a row-precise launch is called, and what everything posed on it is
 * called.
 *
 * A save finds its way back by these names. The launch's opening scene used to take positional ids
 * (`e-0`, `e-1`) that a plain compile hands to unrelated elements, and its posed images took the
 * very names the scene's own compile gives its images - so a save written in the launch was checked
 * against the wrong things when loaded anywhere else, and could not be told apart from one written
 * in an ordinary run.
 */

function block(id: string, payload: StoryBlock["payload"], kind: StoryBlock["kind"] = "action"): StoryBlock {
    return { id, kind, parentId: null, childrenIds: [], payload } as StoryBlock;
}

function narration(id: string, text: string): StoryBlock {
    return block(id, { action: "narration", text: { textId: `${id}-text`, value: text, role: "narration" } } as StoryBlock["payload"], "nodeAction");
}

/** Hero is put on stage before the target row and never addressed after it, so only the pose shows her. */
function document(): StoryDocument {
    const rows = [
        block("create", { action: "image", operation: "create", objectName: "hero", assetId: "asset-hero" } as StoryBlock["payload"]),
        block("show", { action: "image", operation: "show", objectName: "hero" } as StoryBlock["payload"]),
        narration("before", "Before"),
        narration("target", "Here"),
        narration("after", "After"),
    ];
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene 1",
                runtimeName: "Scene 1",
                rootBlockIds: rows.map(row => row.id),
                blocks: Object.fromEntries(rows.map(row => [row.id, row])),
            },
        },
    } as StoryDocument;
}

const resolveAssetUrl = (assetId: string) => `asset://${assetId}`;

describe("a row-precise launch names its own scene apart from the document's", () => {
    it("names the opening scene and everything posed on it under the launch's scene and row", async () => {
        const doc = document();
        const compiled = await compileStudioStoryToNlr({
            document: doc,
            sceneId: "scene-1",
            resolveAssetUrl,
            launch: {
                targetBlockId: "target",
                snapshot: computeStoryStageSnapshot({ document: doc, sceneId: "scene-1", targetBlockId: "target" }),
            },
        });

        const prefix = "nl:launch:scene-1:target";
        expect((compiled.scene as unknown as { getStaticId(): string | null }).getStaticId()).toBe(`${prefix}:scene`);
        expect(compiled.elementIdBindings).toEqual(expect.arrayContaining([
            `${prefix}:scene`,
            `${prefix}:scene:layer:background`,
            `${prefix}:scene:layer:displayable`,
            `${prefix}:scene:background`,
            `${prefix}:image:hero`,
        ]));
    });

    it("adds nothing a plain compile of the story could also be holding", async () => {
        // The scene the launch stands for is compiled as well, for anything that jumps back to it.
        // Every name the launch adds must be one only the launch has, or a save restores one
        // element's state onto the other.
        const doc = document();
        const plain = await compileStudioStoryToNlr({ document: doc, sceneId: "scene-1", resolveAssetUrl });
        const launched = await compileStudioStoryToNlr({
            document: doc,
            sceneId: "scene-1",
            resolveAssetUrl,
            launch: {
                targetBlockId: "target",
                snapshot: computeStoryStageSnapshot({ document: doc, sceneId: "scene-1", targetBlockId: "target" }),
            },
        });

        const plainIds = new Set(plain.elementIdBindings);
        const added = launched.elementIdBindings.slice(plain.elementIdBindings.length);
        expect(added.length).toBeGreaterThan(0);
        expect(added.filter(id => !id.startsWith("nl:launch:"))).toEqual([]);
        expect(added.filter(id => plainIds.has(id))).toEqual([]);
        // The scene's own compile is unchanged by a launch.
        expect(launched.elementIdBindings.slice(0, plain.elementIdBindings.length)).toEqual(plain.elementIdBindings);
    });
});
