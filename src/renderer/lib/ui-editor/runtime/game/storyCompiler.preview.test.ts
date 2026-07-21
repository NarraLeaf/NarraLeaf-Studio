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
    continuous?: boolean,
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
        continuous,
    });
}

const compilePlayback = (document: StoryDocument, targetBlockId: string | null) =>
    compilePreview(document, targetBlockId, undefined, undefined, true);

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

    describe("continuous playback", () => {
        it("compiles the rest of the scene, not just the start row", async () => {
            const document = baseDocument({
                before: say("before", "Already happened."),
                target: say("target", "Start here."),
                after: say("after", "And keep going."),
            }, ["before", "target", "after"]);

            const held = await compilePreview(document, "target");
            expect(held.actionIdBindings.map(binding => binding.blockId)).not.toContain("after");

            const played = await compilePlayback(document, "target");
            const boundBlockIds = played.actionIdBindings.map(binding => binding.blockId);
            expect(boundBlockIds).toContain("target");
            expect(boundBlockIds).toContain("after");
            // The prefix is still snapshot state, never replayed.
            expect(boundBlockIds).not.toContain("before");
            expect(played.playbackStop).toEqual({ reason: "sceneEnd" });
        });

        it("entering a menu option plays that branch and resumes after the menu", async () => {
            const document = baseDocument({
                choice: block("choice", "nodeAction", { action: "choice", prompt: { textId: "t", value: "Pick", role: "choicePrompt" } }, null, ["optA", "optB"]),
                optA: block("optA", "nodeAction", { action: "choiceOption", text: { textId: "ta", value: "A", role: "choiceText" } }, "choice", ["a-say"]),
                "a-say": say("a-say", "Took A.", "optA"),
                optB: block("optB", "nodeAction", { action: "choiceOption", text: { textId: "tb", value: "B", role: "choiceText" } }, "choice", ["b-say"]),
                "b-say": say("b-say", "Took B.", "optB"),
                after: say("after", "Back on the main road."),
            }, ["choice", "after"]);

            const compiled = await compilePlayback(document, "optA");
            const boundBlockIds = compiled.actionIdBindings.map(binding => binding.blockId);
            expect(boundBlockIds).toEqual(["a-say", "after"]);
            // No menu is rendered: the choice was made by starting here.
            const statements = ((compiled.scene as { actions?: unknown[] }).actions ?? []) as unknown[];
            expect(statements.some(statement => Array.isArray((statement as { choices?: unknown })?.choices))).toBe(false);
        });

        it("holds before a scene jump and reports where playback ended", async () => {
            const document = baseDocument({
                target: say("target", "Last line."),
                jump: block("jump", "jump", { targetSceneId: "scene-2" }),
            }, ["target", "jump"]);

            const compiled = await compilePlayback(document, "target");
            expect(compiled.playbackStop).toEqual({ reason: "jump", blockId: "jump", targetSceneId: "scene-2" });
            expect(compiled.diagnostics).toEqual(expect.arrayContaining([
                expect.objectContaining({ level: "warning", blockId: "jump", message: expect.stringContaining("Scene 2") }),
            ]));
        });

        it("reports a jump nested inside a container instead of erroring on it", async () => {
            // The walk only sees blocks it emits directly, so this jump is reached by the compiler's
            // own recursion. It used to resolve against the single-scene `allScenes` and report the
            // author's own scene as missing.
            const document = baseDocument({
                target: say("target", "Last line."),
                group: block("group", "control", { control: "group" }, null, ["nested"]),
                nested: block("nested", "jump", { targetSceneId: "scene-2" }, "group"),
                after: say("after", "Never reached in the real game."),
            }, ["target", "group", "after"]);

            const compiled = await compilePlayback(document, "target");
            expect(compiled.playbackStop).toEqual({ reason: "jump", blockId: "nested", targetSceneId: "scene-2" });
            expect(compiled.diagnostics.filter(diagnostic => diagnostic.level === "error")).toEqual([]);
        });

        it("does not re-enter the previewed scene when a nested jump points back at it", async () => {
            const document = baseDocument({
                target: say("target", "Last line."),
                group: block("group", "control", { control: "group" }, null, ["nested"]),
                nested: block("nested", "jump", { targetSceneId: "scene-1" }, "group"),
            }, ["target", "group"]);

            const compiled = await compilePlayback(document, "target");
            expect(compiled.playbackStop).toEqual({ reason: "jump", blockId: "nested", targetSceneId: "scene-1" });
            expect(compiled.diagnostics.filter(diagnostic => diagnostic.level === "error")).toEqual([]);
        });
    });

    it("seeds scene variables so the target's interpolations read accumulated values", async () => {
        const document = baseDocument({
            // v6: the variable is a declaration ROW; its block id is the variableId the ref points at.
            flag: block("flag", "declaration", { scope: "scene", name: "flag", valueType: "boolean", defaultValue: false, storageKey: "flag" }),
            set: block("set", "action", { action: "setVariable", target: { scope: "scene", variableId: "flag" }, value: true }),
            target: say("target"),
        }, ["flag", "set", "target"]);
        const compiled = await compilePreview(document, "target");
        const types = sceneStatementTypes(compiled.scene);
        // A seed statement precedes the injection script.
        expect(types.length).toBeGreaterThanOrEqual(4);
        expect(compiled.diagnostics).toEqual([]);
    });
});
