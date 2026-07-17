import { describe, expect, it } from "vitest";
import { DevTools } from "narraleaf-react";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStagePreviewToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";

function baseDocument(blocks: Record<string, StoryBlock>, rootBlockIds: string[] = Object.keys(blocks)): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1", "scene-2"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene 1",
                runtimeName: "Scene 1",
                rootBlockIds,
                blocks,
            },
            "scene-2": {
                id: "scene-2",
                name: "Scene 2",
                runtimeName: "Scene 2",
                rootBlockIds: [],
                blocks: {},
            },
        },
    };
}

function block(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const say = (id: string, value = "Text", parentId: string | null = null) =>
    block(id, "nodeAction", { action: "narration", text: { textId: `${id}-text`, value, role: "narration" } }, parentId);

async function compilePreview(
    document: StoryDocument,
    targetBlockId: string | null,
    resolveAssetUrl?: (assetId: string) => string,
    gate?: { onStagePosed: () => void; revealGate: Promise<void> },
) {
    const snapshot = computeStoryStageSnapshot({ document, sceneId: "scene-1", targetBlockId });
    return compileStagePreviewToNlr({
        document,
        sceneId: "scene-1",
        snapshot,
        targetBlockId,
        resolveAssetUrl: resolveAssetUrl ?? (assetId => `nlr://${assetId}`),
        onStagePosed: gate?.onStagePosed,
        revealGate: gate?.revealGate,
        onBeforeTarget: () => {},
        onAfterTarget: () => {},
    });
}

/** Per-statement action-type arrays of the compiled preview scene. */
function sceneStatementTypes(scene: unknown): string[][] {
    const statements = ((scene as { actions?: unknown[] }).actions ?? []) as unknown[];
    return statements.map(statement => DevTools.chainToActions(statement as any)
        .flat(Number.POSITIVE_INFINITY)
        .map((action: any) => action?.type as string));
}

describe("compileStagePreviewToNlr", () => {
    it("pre-poses snapshot displayables via constructor config and plays only the target", async () => {
        const blocks: Record<string, StoryBlock> = {
            bg: block("bg", "action", { action: "setBackground", assetId: "asset-bg" }),
            enter: block("enter", "action", {
                action: "character",
                operation: "enter",
                characterId: "char-alice",
                assetId: "asset-alice",
                transform: { preset: "left", durationMs: 300, props: { zoom: 0.8 } },
            }),
            target: say("target", "Hello."),
            after: say("after", "Beyond."),
        };
        const document = baseDocument(blocks, ["bg", "enter", "target", "after"]);
        const compiled = await compilePreview(document, "target");

        // The stage background comes from the snapshot (bg ran before the target).
        expect((compiled.scene.background as any).state.currentSrc).toBe("nlr://asset-bg");

        // The character image exists pre-posed at its settled show state.
        const alice = compiled.sceneElements?.["scene-1"]?.images.get("char-alice");
        expect(alice).toBeDefined();
        const pose = DevTools.getDisplayableTransformProps(alice as any);
        expect(pose).toEqual(expect.objectContaining({
            opacity: 1,
            zoom: 0.8,
            position: expect.objectContaining({ xalign: 0.25 }),
        }));

        // Only the target block produced bound statements; prefix blocks are state, not actions.
        const boundBlockIds = compiled.actionIdBindings.map(binding => binding.blockId);
        expect(boundBlockIds).toContain("target");
        expect(boundBlockIds).not.toContain("bg");
        expect(boundBlockIds).not.toContain("enter");
        expect(boundBlockIds).not.toContain("after");
    });

    it("orders statements as seeds, injection script, markers, and target", async () => {
        const blocks: Record<string, StoryBlock> = {
            enter: block("enter", "action", { action: "character", operation: "enter", characterId: "char-alice", assetId: "asset-alice" }),
            target: say("target"),
        };
        const document = baseDocument(blocks, ["enter", "target"]);
        const compiled = await compilePreview(document, "target");

        const types = sceneStatementTypes(compiled.scene);
        // [injection script, before-marker, target say, after-marker]
        expect(types).toHaveLength(4);
        expect(types[0]).toEqual(["script:action"]);
        expect(types[1]).toEqual(["script:action"]);
        expect(types[2].some(type => type?.includes("say") || type?.includes("character"))).toBe(true);
        expect(types[3]).toEqual(["script:action"]);
    });

    it("inserts the posed marker and reveal gate between the pose and the before-marker", async () => {
        const blocks: Record<string, StoryBlock> = {
            enter: block("enter", "action", { action: "character", operation: "enter", characterId: "char-alice", assetId: "asset-alice" }),
            target: say("target"),
        };
        const document = baseDocument(blocks, ["enter", "target"]);
        const compiled = await compilePreview(document, "target", undefined, {
            onStagePosed: () => {},
            revealGate: new Promise<void>(() => {}),
        });

        const types = sceneStatementTypes(compiled.scene);
        // [injection script, posed-marker, reveal gate (control:sleep), before-marker, target say, after-marker]
        expect(types).toHaveLength(6);
        expect(types[0]).toEqual(["script:action"]);
        expect(types[1]).toEqual(["script:action"]);
        expect(types[2]).toEqual(["control:sleep"]);
        expect(types[3]).toEqual(["script:action"]);
        expect(types[4].some(type => type?.includes("say") || type?.includes("character"))).toBe(true);
        expect(types[5]).toEqual(["script:action"]);
    });

    it("compiles a state-only preview (null target) with markers around nothing", async () => {
        const blocks: Record<string, StoryBlock> = {
            bg: block("bg", "action", { action: "setBackground", assetId: "asset-bg" }),
        };
        const document = baseDocument(blocks, ["bg"]);
        const compiled = await compilePreview(document, null);

        expect(compiled.actionIdBindings).toEqual([]);
        const types = sceneStatementTypes(compiled.scene);
        // [injection script, before-marker, after-marker]
        expect(types).toHaveLength(3);
        expect(types.every(entry => entry.length === 1 && entry[0] === "script:action")).toBe(true);
        // Null target = scene start: the setBackground has not run, so the scene has no background.
        expect((compiled.scene.background as any).state.currentSrc).not.toBe("nlr://asset-bg");
    });

    it("holds before a jump target instead of leaving the scene", async () => {
        const blocks: Record<string, StoryBlock> = {
            jump: block("jump", "jump", { targetSceneId: "scene-2" }),
        };
        const document = baseDocument(blocks, ["jump"]);
        const compiled = await compilePreview(document, "jump");
        expect(compiled.actionIdBindings).toEqual([]);
        expect(compiled.diagnostics).toEqual([
            { level: "warning", blockId: "jump", message: "Preview holds before the jump instead of leaving the scene." },
        ]);
    });

    it("keeps the full menu when the target is a choice block", async () => {
        const blocks: Record<string, StoryBlock> = {
            choice: block("choice", "nodeAction", { action: "choice", prompt: { textId: "t", value: "Pick", role: "choicePrompt" } }, null, ["option"]),
            option: block("option", "nodeAction", { action: "choiceOption", text: { textId: "t2", value: "Go", role: "choiceText" } }, "choice", ["option-say"]),
            "option-say": say("option-say", "Chosen.", "option"),
        };
        const document = baseDocument(blocks, ["choice"]);
        const compiled = await compilePreview(document, "choice");
        const statements = ((compiled.scene as { actions?: unknown[] }).actions ?? []) as unknown[];
        expect(statements.some(statement => Array.isArray((statement as { choices?: unknown })?.choices))).toBe(true);
    });

    it("carries snapshot diagnostics into the compiled diagnostics", async () => {
        const blocks: Record<string, StoryBlock> = {
            jump: block("jump", "jump", { targetSceneId: "scene-2" }),
            target: say("target"),
        };
        const document = baseDocument(blocks, ["jump", "target"]);
        const compiled = await compilePreview(document, "target");
        expect(compiled.diagnostics).toEqual(expect.arrayContaining([
            { level: "warning", blockId: "jump", message: "Preview ignores scene jumps." },
        ]));
    });

    it("seeds scene variables so the target's interpolations read accumulated values", async () => {
        const document = baseDocument({
            set: block("set", "action", { action: "setVariable", target: { scope: "scene", variableId: "flag" }, value: true }),
            target: say("target"),
        }, ["set", "target"]);
        document.scenes["scene-1"].sceneVariables = {
            flag: { id: "flag", name: "flag", valueType: "boolean", storageKey: "flag", defaultValue: false },
        };
        const compiled = await compilePreview(document, "target");
        const types = sceneStatementTypes(compiled.scene);
        // A seed statement precedes the injection script.
        expect(types.length).toBeGreaterThanOrEqual(4);
        expect(compiled.diagnostics).toEqual([]);
    });
});
