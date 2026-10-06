import { describe, expect, it } from "vitest";
import { DevTools } from "narraleaf-react";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { SavedVariableRuntimeTable } from "@shared/types/variables/registry";
import { compileStagePreviewToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { readSavedVariableForScreen } from "@/lib/ui-editor/runtime/app/savedVariableReads";

/**
 * A dialogue box that shows a saved variable shows, in the live preview, the value the game would
 * show on that line: the declared default before the story changes it, and the changed value after.
 *
 * The preview's screens read `Get Saved Var` out of the session's own saved namespace, and the
 * session's story opens that namespace at what the stage snapshot walked to. This pins that chain -
 * snapshot, compile, read - with the same reader a running game's screens use.
 */

const AFFECTION = "affection-id";

const registry: SavedVariableRuntimeTable = {
    [AFFECTION]: {
        id: AFFECTION,
        name: "Affection",
        scope: "saved",
        valueType: "number",
        defaultValue: 30,
        storageKey: "affection-key",
    },
};

function block(id: string, kind: StoryBlock["kind"], payload: unknown): StoryBlock {
    return { id, kind, parentId: null, childrenIds: [], payload } as StoryBlock;
}

const line = (id: string, value: string) =>
    block(id, "nodeAction", { action: "narration", text: { textId: `${id}-text`, value, role: "narration" } });

/** `/inc Affection 10`, as the editor stores it. */
const increment = block("inc", "action", {
    action: "setVariable",
    target: { scope: "saved", variableId: AFFECTION },
    value: true,
    expression: {
        source: "Affection + (10)",
        ast: {
            kind: "binary",
            op: "+",
            left: { kind: "var", target: { scope: "saved", variableId: AFFECTION }, name: "Affection" },
            right: { kind: "literal", value: 10 },
        },
    },
});

function storyDocument(): StoryDocument {
    const blocks = { before: line("before", "Before"), inc: increment, after: line("after", "After") };
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": { id: "scene-1", name: "Scene 1", runtimeName: "Scene 1", rootBlockIds: Object.keys(blocks), blocks },
        },
    } as StoryDocument;
}

/** What a screen reads for Affection on the preview of `targetBlockId`. */
async function affectionOnScreenAt(targetBlockId: string): Promise<{ value: unknown; found: boolean }> {
    const document = storyDocument();
    const snapshot = computeStoryStageSnapshot({ document, sceneId: "scene-1", targetBlockId, savedVariables: registry });
    const compiled = await compileStagePreviewToNlr({
        document,
        sceneId: "scene-1",
        snapshot,
        targetBlockId,
        savedVariables: registry,
        resolveAssetUrl: assetId => `nlr://${assetId}`,
        onBeforeTarget: () => {},
        onAfterTarget: () => {},
    });
    // The seed the engine builds the namespace from when the session's game starts.
    const seed = ((compiled.story as unknown as { persistent: unknown[] }).persistent)
        .find(entry => DevTools.getNamespaceName(entry as never) === compiled.savedNamespaceName) as
        { defaultContent: Record<string, unknown> };
    const storable = {
        hasNamespace: (name: string) => name === compiled.savedNamespaceName,
        getNamespace: () => ({
            has: (key: string) => key in seed.defaultContent,
            get: (key: string) => seed.defaultContent[key],
        }),
    };
    return readSavedVariableForScreen({ variableId: AFFECTION, compiled, storable: () => storable, declaredDefaults: {} });
}

describe("a saved variable on a screen in the live preview", () => {
    it("reads the declared default on a line before the story changes it", async () => {
        expect(await affectionOnScreenAt("before")).toEqual({ value: 30, found: true });
    });

    it("reads the changed value on a line after `/inc`", async () => {
        expect(await affectionOnScreenAt("after")).toEqual({ value: 40, found: true });
    });
});
