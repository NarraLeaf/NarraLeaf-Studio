import { describe, expect, it } from "vitest";
import { DevTools } from "narraleaf-react";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { compileStudioStoryToNlr } from "./storyCompiler";

function narrationBlock(id: string, textId: string, value: string, childrenIds: string[] = []): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds,
        payload: {
            action: "narration",
            text: { textId, value, role: "narration" },
        },
    };
}

function dialogueBlock(id: string, textId: string, characterId: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "dialogue",
            characterId,
            text: { textId, value, role: "dialogue" },
        },
    };
}

describe("compileStudioStoryToNlr", () => {
    it("compiles narration and dialogue in tree preorder with stable static action ids", () => {
        const root = narrationBlock("root", "text-root", "First", ["child"]);
        const child = dialogueBlock("child", "text-child", "char-alice", "Hello");
        child.parentId = "root";
        const unsupported: StoryBlock = {
            id: "unsupported",
            kind: "action",
            parentId: null,
            childrenIds: ["after-unsupported"],
            payload: {
                action: "wait",
                mode: "duration",
                durationMs: 100,
            },
        };
        const afterUnsupported = narrationBlock("after-unsupported", "text-after", "After");
        afterUnsupported.parentId = "unsupported";
        const document: StoryDocument = {
            schemaVersion: 1,
            id: "story-1",
            name: "Story",
            chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
            scenes: {
                "scene-1": {
                    id: "scene-1",
                    name: "Scene",
                    runtimeName: "Scene",
                    rootBlockIds: ["root", "unsupported"],
                    blocks: {
                        root,
                        child,
                        unsupported,
                        "after-unsupported": afterUnsupported,
                    },
                },
            },
        };

        const compiled = compileStudioStoryToNlr({
            document,
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice" }],
        });

        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toEqual([
            "root",
            "child",
            "after-unsupported",
        ]);
        expect(compiled.actionIdBindings.map(binding => binding.staticId)).toEqual([
            "studio:story-1:scene-1:root:text-root:0",
            "studio:story-1:scene-1:child:text-child:1",
            "studio:story-1:scene-1:after-unsupported:text-after:2",
        ]);
        expect(compiled.actionIdBindings.map(binding => DevTools.getStaticId(binding.action))).toEqual(
            compiled.actionIdBindings.map(binding => binding.staticId),
        );
        expect((compiled.actionIdBindings[1]!.action as unknown as { callee: { state: { name: string } } }).callee.state.name).toBe("Alice");
        expect(compiled.diagnostics).toEqual([
            {
                level: "warning",
                blockId: "unsupported",
                message: "Unsupported story block kind: action",
            },
        ]);
    });
});
