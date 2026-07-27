import { describe, expect, it } from "vitest";
import { BlurDissolve, Darkness, DevTools, Push, Reveal, ThroughColor, Transition } from "narraleaf-react";
import type { CharacterAppearanceSummary, DevModeCharacterSummary } from "@shared/types/devMode";
import type { StoryAnimationAsset, StoryBlock, StoryDocument, StoryTransitionRef } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";

/** A character with no sprites: enough to be a speaker, which is all these cases need. */
const EMPTY_APPEARANCE: CharacterAppearanceSummary = { kind: "preset", poses: [], defaultPoseId: null };
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";

function declarationBlock(id: string, valueType: "boolean" | "number", defaultValue?: number | boolean): StoryBlock {
    return {
        id,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: {
            scope: "scene",
            name: id,
            valueType,
            ...(defaultValue !== undefined ? { defaultValue } : {}),
            storageKey: id,
        },
    };
}

function baseDocument(blocks: Record<string, StoryBlock>, rootBlockIds: string[] = Object.keys(blocks)): StoryDocument {
    // v6: scene variables are declaration ROWS in the block tree; the block id is the variableId.
    const declarations: Record<string, StoryBlock> = {
        locked: declarationBlock("locked", "boolean"),
        started: declarationBlock("started", "boolean"),
        gold: declarationBlock("gold", "number", 100),
    };
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
                rootBlockIds: [...Object.keys(declarations), ...rootBlockIds],
                blocks: { ...declarations, ...blocks },
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

function collectActionTree(action: any, story: unknown, seen = new Set<any>()): any[] {
    if (!action || seen.has(action)) {
        return [];
    }
    seen.add(action);
    const children = typeof action.getFutureActions === "function"
        ? action.getFutureActions(story, { allowFutureScene: true })
        : [];
    return [action, ...children.flatMap((child: any) => collectActionTree(child, story, seen))];
}

function getDisplayableTransformProps(actions: any[]): Record<string, unknown>[] {
    return getDisplayableTransforms(actions)
        .flatMap(transform => transform?.sequences?.map(sequence => sequence.props ?? {}) ?? []);
}

function getDisplayableTransforms(actions: any[]): { sequences?: { props?: Record<string, unknown>; options?: Record<string, unknown> }[]; config?: Record<string, unknown> }[] {
    return actions
        .filter(action => action?.type === "displayable:applyTransform")
        .flatMap(action => {
            const transform = action.contentNode?.getContent?.()[0] as { sequences?: { props?: Record<string, unknown>; options?: Record<string, unknown> }[]; config?: Record<string, unknown> } | undefined;
            return transform ? [transform] : [];
        });
}

describe("compileStudioStoryToNlr", () => {
    it("compiles core scene actions, resolves assets, and assigns stable ids", async () => {
        const blocks: Record<string, StoryBlock> = {
            bg: {
                id: "bg",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "setBackground",
                    assetId: "asset-bg",
                    transition: { kind: "dissolve", durationMs: 250 },
                },
            },
            say: {
                id: "say",
                kind: "nodeAction",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "dialogue",
                    characterId: "char-alice",
                    voiceAssetId: "asset-voice",
                    text: { textId: "text-say", value: "Hello", role: "dialogue" },
                },
            },
            wait: {
                id: "wait",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "wait", mode: "duration", durationMs: 100 },
            },
            jump: {
                id: "jump",
                kind: "jump",
                parentId: null,
                childrenIds: [],
                payload: { targetSceneId: "scene-2", transition: { kind: "fadeIn", durationMs: 120 } },
            },
        };
        const calls: string[] = [];

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["bg", "say", "wait", "jump"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
            resolveAssetUrl: async (assetId, assetType) => {
                calls.push(`${assetType}:${assetId}`);
                return `nlr://${assetId}`;
            },
        });

        expect(compiled.scene).toBe(compiled.scenes["scene-1"]);
        expect(compiled.diagnostics).toEqual([]);
        expect(calls).toEqual(["image:asset-bg", "audio:asset-voice"]);
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toEqual(expect.arrayContaining(["bg", "say", "wait", "jump"]));
        expect(compiled.actionIdBindings.every(binding => DevTools.getStaticId(binding.action) === binding.staticId)).toBe(true);
        expect(compiled.actionIdBindings.find(binding => binding.blockId === "say")?.staticId).toContain("text-say");
    });

    it("compiles a disabled row out — no output, no diagnostic (schema v7)", async () => {
        const blocks: Record<string, StoryBlock> = {
            a: narrationBlock("a", "text-a", "Kept."),
            skip: { ...narrationBlock("skip", "text-skip", "Skipped."), disabled: true },
            b: narrationBlock("b", "text-b", "Also kept."),
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["a", "skip", "b"]),
            sceneId: "scene-1",
            characters: [],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });
        expect(compiled.diagnostics).toEqual([]);
        const compiledIds = compiled.actionIdBindings.map(binding => binding.blockId);
        expect(compiledIds).toEqual(expect.arrayContaining(["a", "b"]));
        expect(compiledIds).not.toContain("skip");
    });

    it("skips a disabled container's whole subtree", async () => {
        const blocks: Record<string, StoryBlock> = {
            grp: { id: "grp", kind: "control", parentId: null, childrenIds: ["inner"], disabled: true, payload: { control: "sequence", mode: "do" } },
            inner: { ...narrationBlock("inner", "text-inner", "Inside."), parentId: "grp" },
            after: narrationBlock("after", "text-after", "After."),
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["grp", "after"]),
            sceneId: "scene-1",
            characters: [],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });
        expect(compiled.diagnostics).toEqual([]);
        const compiledIds = compiled.actionIdBindings.map(binding => binding.blockId);
        expect(compiledIds).not.toContain("grp");
        expect(compiledIds).not.toContain("inner");
        expect(compiledIds).toContain("after");
    });

    it("uses the NarraLeaf scene initial background for scene defaults", async () => {
        const document = baseDocument({
            say: narrationBlock("say", "text-say", "The room is quiet."),
        }, ["say"]);
        document.scenes["scene-1"].defaultBackgroundAssetId = "asset-default-bg";
        const calls: string[] = [];

        const compiled = await compileStudioStoryToNlr({
            document,
            sceneId: "scene-1",
            resolveAssetUrl: async (assetId, assetType) => {
                calls.push(`${assetType}:${assetId}`);
                return `nlr://${assetId}`;
            },
        });

        expect(compiled.diagnostics).toEqual([]);
        expect(calls).toEqual(["image:asset-default-bg"]);
        expect((compiled.scene.background as any).state.currentSrc).toBe("nlr://asset-default-bg");
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toEqual(["say"]);
    });

    it("compiles character enter as a visible stage image", async () => {
        const blocks: Record<string, StoryBlock> = {
            enter: {
                id: "enter",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "character",
                    operation: "enter",
                    characterId: "char-alice",
                    transform: { preset: "center", durationMs: 300, props: { zoom: 0.5, xoffset: 24, yoffset: -12 } },
                },
            },
        };
        const calls: string[] = [];

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["enter"]),
            sceneId: "scene-1",
            characters: [{
                id: "char-alice",
                name: "Alice",
                appearance: { kind: "preset", poses: [{ id: "pose-Neutral", name: "Neutral", assetId: "asset-alice-neutral" }], defaultPoseId: "pose-Neutral" },
            }],
            resolveAssetUrl: async (assetId, assetType) => {
                calls.push(`${assetType}:${assetId}`);
                return `nlr://${assetId}`;
            },
        });

        const enterActions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "enter")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const actionTypes = enterActions.map(action => action.type);
        const transformProps = getDisplayableTransformProps(enterActions);
        const setSrcAction = enterActions.find(action => action?.type === "image:setSrc");

        expect(compiled.diagnostics).toEqual([]);
        expect(calls).toEqual(["image:asset-alice-neutral"]);
        expect(actionTypes).toContain("image:setSrc");
        expect(setSrcAction?.callee?.state?.currentSrc).toBe("nlr://asset-alice-neutral");
        expect(transformProps).toEqual([
            expect.objectContaining({
                opacity: 1,
                position: expect.objectContaining({ xalign: 0.5, yalign: 0.5, xoffset: 24, yoffset: -12 }),
                zoom: 0.5,
            }),
        ]);
    });

    it("compiles hidden story animation assets into NarraLeaf transform sequences", async () => {
        const animation: StoryAnimationAsset = {
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000101",
            name: "Slide in",
            targetKind: "image",
            sequences: [
                {
                    id: "step-1",
                    props: {
                        position: { xalign: 0.35, yalign: 0.5, xoffset: -12 },
                        zoom: 0.9,
                    },
                    options: { durationMs: 420, easing: "easeOut", delayMs: 40, at: "+20" },
                },
            ],
            config: { repeat: 2, repeatDelayMs: 60 },
        };
        const blocks: Record<string, StoryBlock> = {
            show: {
                id: "show",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "image",
                    operation: "show",
                    objectName: "hero",
                    transform: { mode: "animation", animationId: animation.id },
                },
            },
            transform: {
                id: "transform",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                    transform: { mode: "animation", animationId: animation.id },
                },
            },
            hide: {
                id: "hide",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "image",
                    operation: "hide",
                    objectName: "hero",
                    transform: { mode: "animation", animationId: animation.id },
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["show", "transform", "hide"]),
            sceneId: "scene-1",
            animations: { [animation.id]: animation },
        });

        const byBlock = (blockId: string) => compiled.actionIdBindings
            .filter(binding => binding.blockId === blockId)
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const showTransform = getDisplayableTransforms(byBlock("show"))[0];
        const moveTransform = getDisplayableTransforms(byBlock("transform"))[0];
        const hideTransform = getDisplayableTransforms(byBlock("hide"))[0];

        expect(compiled.diagnostics).toEqual([]);
        expect(showTransform?.sequences?.[0]?.props).toEqual(expect.objectContaining({
            opacity: 1,
            position: expect.objectContaining({ xalign: 0.35, yalign: 0.5, xoffset: -12 }),
            zoom: 0.9,
        }));
        expect(showTransform?.sequences?.[0]?.options).toEqual(expect.objectContaining({
            duration: 420,
            ease: "easeOut",
            delay: 40,
            at: "+20",
        }));
        expect(showTransform?.config).toEqual(expect.objectContaining({ repeat: 2, repeatDelay: 60 }));
        expect(moveTransform?.sequences?.[0]?.props).not.toHaveProperty("opacity");
        expect(hideTransform?.sequences?.[0]?.props).toEqual(expect.objectContaining({ opacity: 0 }));
    });

    it("compiles keyframe timeline tracks into grouped NarraLeaf transform sequences", async () => {
        const animation: StoryAnimationAsset = {
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000104",
            name: "Keyframed slide",
            targetKind: "image",
            sequences: [],
            timeline: {
                fps: 30,
                durationMs: 420,
                tracks: [
                    {
                        id: "track-position",
                        property: "position",
                        keyframes: [
                            { id: "position-start", timeMs: 0, value: { xalign: 0.5, yalign: 0.55, xoffset: -120 }, easing: "linear" },
                            { id: "position-end", timeMs: 420, value: { xalign: 0.5, yalign: 0.55, xoffset: 0 }, easing: "easeOut" },
                        ],
                    },
                    {
                        id: "track-zoom",
                        property: "zoom",
                        keyframes: [
                            { id: "zoom-end", timeMs: 420, value: 1.1, easing: "easeOut" },
                        ],
                    },
                ],
            },
        };
        const blocks: Record<string, StoryBlock> = {
            show: {
                id: "show",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "image",
                    operation: "show",
                    objectName: "hero",
                    transform: { mode: "animation", animationId: animation.id },
                },
            },
            transform: {
                id: "transform",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                    transform: { mode: "animation", animationId: animation.id },
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["show", "transform"]),
            sceneId: "scene-1",
            animations: { [animation.id]: animation },
        });

        const byBlock = (blockId: string) => compiled.actionIdBindings
            .filter(binding => binding.blockId === blockId)
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const showFinal = getDisplayableTransforms(byBlock("show"))[0]?.sequences?.find(sequence => sequence.options?.duration === 420);
        const moveFinal = getDisplayableTransforms(byBlock("transform"))[0]?.sequences?.find(sequence => sequence.options?.duration === 420);

        expect(compiled.diagnostics).toEqual([]);
        expect(showFinal?.options).toEqual(expect.objectContaining({ duration: 420, ease: "easeOut", at: 0 }));
        expect(showFinal?.props).toEqual(expect.objectContaining({
            opacity: 1,
            position: expect.objectContaining({ xalign: 0.5, yalign: 0.55, xoffset: 0 }),
            zoom: 1.1,
        }));
        expect(moveFinal?.props).toEqual(expect.objectContaining({
            position: expect.objectContaining({ xalign: 0.5, yalign: 0.55, xoffset: 0 }),
            zoom: 1.1,
        }));
        expect(moveFinal?.props).not.toHaveProperty("opacity");
    });

    it("keeps character enter asset resolution when using animation transforms", async () => {
        const animation: StoryAnimationAsset = {
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000102",
            name: "Alice enter",
            targetKind: "character",
            sequences: [
                { id: "step-1", props: { position: { xalign: 0.5, yalign: 0.5 } }, options: { durationMs: 300 } },
            ],
        };
        const blocks: Record<string, StoryBlock> = {
            enter: {
                id: "enter",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "character",
                    operation: "enter",
                    characterId: "char-alice",
                    transition: { kind: "dissolve", durationMs: 120 },
                    transform: { mode: "animation", animationId: animation.id },
                },
            },
        };
        const calls: string[] = [];

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["enter"]),
            sceneId: "scene-1",
            characters: [{
                id: "char-alice",
                name: "Alice",
                appearance: { kind: "preset", poses: [{ id: "pose-base", name: "base", assetId: "asset-alice" }], defaultPoseId: "pose-base" },
            }],
            animations: { [animation.id]: animation },
            resolveAssetUrl: async (assetId, assetType) => {
                calls.push(`${assetType}:${assetId}`);
                return `nlr://${assetId}`;
            },
        });

        const enterActions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "enter")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const transformProps = getDisplayableTransformProps(enterActions);

        expect(compiled.diagnostics).toEqual([]);
        expect(calls).toEqual(["image:asset-alice"]);
        expect(enterActions.map(action => action.type)).toContain("image:setSrc");
        expect(transformProps).toEqual([
            expect.objectContaining({
                opacity: 1,
                position: expect.objectContaining({ xalign: 0.5, yalign: 0.5 }),
            }),
        ]);
    });

    it("reuses story animation assets across displayable target kinds", async () => {
        const animation: StoryAnimationAsset = {
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000105",
            name: "Universal pulse",
            targetKind: "image",
            sequences: [],
            timeline: {
                fps: 30,
                durationMs: 240,
                tracks: [
                    {
                        id: "track-zoom",
                        property: "zoom",
                        keyframes: [
                            { id: "zoom-end", timeMs: 240, value: 1.1, easing: "easeOut" },
                        ],
                    },
                ],
            },
        };
        const blocks: Record<string, StoryBlock> = {
            text: {
                id: "text",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "text",
                    operation: "create",
                    objectName: "caption",
                    text: "Hello",
                    transform: { mode: "animation", animationId: animation.id },
                },
            },
            layer: {
                id: "layer",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "layer",
                    operation: "transform",
                    objectName: "foreground",
                    transform: { mode: "animation", animationId: animation.id },
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["text", "layer"]),
            sceneId: "scene-1",
            animations: { [animation.id]: animation },
        });

        const byBlock = (blockId: string) => compiled.actionIdBindings
            .filter(binding => binding.blockId === blockId)
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const textTransform = getDisplayableTransforms(byBlock("text"))[0];
        const layerTransform = getDisplayableTransforms(byBlock("layer"))[0];

        expect(compiled.diagnostics).toEqual([]);
        expect(textTransform?.sequences?.at(-1)?.props).toEqual(expect.objectContaining({ opacity: 1, zoom: 1.1 }));
        expect(layerTransform?.sequences?.at(-1)?.props).toEqual(expect.objectContaining({ zoom: 1.1 }));
        expect(layerTransform?.sequences?.at(-1)?.props).not.toHaveProperty("opacity");
    });

    it("resolves image/text layer refs to custom and built-in NLR layers", async () => {
        const blocks: Record<string, StoryBlock> = {
            layer: {
                id: "layer",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "layer", operation: "create", objectName: "Foreground", zIndex: 3 },
            },
            img: {
                id: "img",
                kind: "action",
                parentId: null,
                childrenIds: [],
                // Custom layer bound by the create block's stable id.
                payload: { action: "image", operation: "create", objectName: "hero", assetId: "asset-hero", layer: { kind: "custom", sourceBlockId: "layer" } },
            },
            caption: {
                id: "caption",
                kind: "action",
                parentId: null,
                childrenIds: [],
                // Built-in NLR background layer.
                payload: { action: "text", operation: "create", objectName: "cap", text: "Hi", layer: { kind: "default", layer: "background" } },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["layer", "img", "caption"]),
            sceneId: "scene-1",
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        // Compiling touches Scene.backgroundLayer (built-in getter) + getLayer (custom) with no throw.
        expect(compiled.diagnostics).toEqual([]);
    });

    it("still compiles a layer-action transform (back-compat: no longer offered in the UI)", async () => {
        const blocks: Record<string, StoryBlock> = {
            bgZoom: {
                id: "bgZoom",
                kind: "action",
                parentId: null,
                childrenIds: [],
                // The `layer` action no longer offers `transform` in the operation menu (transforms go
                // through the unified displayable target list), but existing blocks must still compile.
                payload: {
                    action: "layer",
                    operation: "transform",
                    objectName: "",
                    target: { kind: "default", layer: "background" },
                    transform: { mode: "preset", preset: "zoom", durationMs: 300, props: { zoom: 1.4 } },
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["bgZoom"]),
            sceneId: "scene-1",
        });

        const byBlock = (blockId: string) => compiled.actionIdBindings
            .filter(binding => binding.blockId === blockId)
            .flatMap(binding => collectActionTree(binding.action, compiled.story));

        // Background layer resolved as a transform target (no "not found") and a real zoom was applied.
        expect(compiled.diagnostics).toEqual([]);
        expect(getDisplayableTransformProps(byBlock("bgZoom"))).toContainEqual(expect.objectContaining({ zoom: 1.4 }));
    });

    it("transforms built-in singletons (scene background + built-in layer) via displayable targets", async () => {
        const blocks: Record<string, StoryBlock> = {
            bg: {
                id: "bg",
                kind: "action",
                parentId: null,
                childrenIds: [],
                // The unified transform list: pick the scene background image (no create block needed).
                payload: {
                    action: "displayable",
                    operation: "transform",
                    target: { builtin: "background", kind: "image", name: "Scene background" },
                    transform: { mode: "preset", preset: "zoom", durationMs: 300, props: { zoom: 1.25 } },
                },
            },
            fgLayer: {
                id: "fgLayer",
                kind: "action",
                parentId: null,
                childrenIds: [],
                // ...and the built-in displayable layer.
                payload: {
                    action: "displayable",
                    operation: "transform",
                    target: { builtin: "displayableLayer", kind: "layer", name: "Displayable layer" },
                    transform: { mode: "preset", preset: "opacity", durationMs: 200, props: { opacity: 0.5 } },
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["bg", "fgLayer"]),
            sceneId: "scene-1",
        });

        const byBlock = (blockId: string) => compiled.actionIdBindings
            .filter(binding => binding.blockId === blockId)
            .flatMap(binding => collectActionTree(binding.action, compiled.story));

        // Both built-ins resolved as transform targets with no "not found" diagnostic.
        expect(compiled.diagnostics).toEqual([]);
        expect(getDisplayableTransformProps(byBlock("bg"))).toContainEqual(expect.objectContaining({ zoom: 1.25 }));
        expect(getDisplayableTransformProps(byBlock("fgLayer"))).toContainEqual(expect.objectContaining({ opacity: 0.5 }));
    });

    it("compiles displayable visual effects on an existing stage image", async () => {
        const blocks: Record<string, StoryBlock> = {
            show: {
                id: "show",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "image", operation: "show", objectName: "hero" },
            },
            reveal: {
                id: "reveal",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "circleReveal",
                    target: { name: "hero", kind: "image" },
                    durationMs: 600,
                    effectProps: { from: 0, to: 150 },
                },
            },
            darken: {
                id: "darken",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "darken",
                    target: { name: "hero", kind: "image" },
                    darkness: 0.6,
                    durationMs: 200,
                },
            },
            wipe: {
                id: "wipe",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "wipe",
                    target: { name: "hero", kind: "image" },
                    effectProps: { direction: "right", reverse: true },
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["show", "reveal", "darken", "wipe"]),
            sceneId: "scene-1",
        });

        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toEqual(expect.arrayContaining([
            "reveal",
            "darken",
            "wipe",
        ]));
    });

    it("warns when a mask effect has no image asset", async () => {
        const blocks: Record<string, StoryBlock> = {
            show: {
                id: "show",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "image", operation: "show", objectName: "hero" },
            },
            mask: {
                id: "mask",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "displayable", operation: "mask", target: { name: "hero", kind: "image" } },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["show", "mask"]),
            sceneId: "scene-1",
        });

        expect(compiled.diagnostics).toEqual([
            { level: "warning", blockId: "mask", message: "Mask effect has no image asset." },
        ]);
    });

    it("compiles rich dialogue runs into a sentence prompt", async () => {
        const blocks: Record<string, StoryBlock> = {
            say: {
                id: "say",
                kind: "nodeAction",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "dialogue",
                    characterId: "char-alice",
                    text: {
                        textId: "text-say",
                        value: "Hello brave world",
                        role: "dialogue",
                        rich: [
                            { text: "Hello " },
                            { text: "brave", marks: { bold: true, color: "#ff0000" } },
                            { pause: 200 },
                            { text: " world", marks: { italic: true } },
                        ],
                    },
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["say"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
        });

        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toContain("say");
    });

    describe("inline expression events", () => {
        /** A character summary whose "angry" form resolves to one differential asset. */
        const alice: DevModeCharacterSummary = {
            id: "char-alice",
            name: "Alice",
            appearance: {
                kind: "preset",
                poses: [
                    { id: "pose-default", name: "default", assetId: "asset-default" },
                    { id: "pose-angry", name: "angry", assetId: "asset-angry" },
                ],
                defaultPoseId: "pose-default",
            },
        };

        function eventDialogue(event: unknown): Record<string, StoryBlock> {
            return {
                say: {
                    id: "say",
                    kind: "nodeAction",
                    parentId: null,
                    childrenIds: [],
                    payload: {
                        action: "dialogue",
                        characterId: "char-alice",
                        text: {
                            textId: "text-say",
                            value: "AB",
                            role: "dialogue",
                            rich: [{ text: "A" }, event as never, { text: "B" }],
                        },
                    },
                },
            };
        }

        /** The compiled say sentence's NLR word array. */
        function sayWords(compiled: Awaited<ReturnType<typeof compileStudioStoryToNlr>>): any[] {
            const binding = compiled.actionIdBindings.find(entry => entry.blockId === "say");
            const content = (binding!.action as any).contentNode?.getContent?.();
            const sentence = Array.isArray(content) ? content.find((item: any) => item?.text) : content;
            return sentence.text as any[];
        }

        /** Plain projection: a token word (Pause/TextEvent) contributes no glyphs. */
        function plainText(words: any[]): string {
            return words.map(word => (typeof word.text === "string" ? word.text : "")).join("");
        }

        it("compiles an expression event into a zero-width TextEvent token", async () => {
            // The expression swaps the character's *on-stage* portrait, so the character must be shown
            // first - otherwise the swap has no target and the compiler warns (see `compileEventRun`).
            const enter: StoryBlock = {
                id: "enter",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "character", operation: "enter", characterId: "char-alice" },
            };
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument(
                    { enter, ...eventDialogue({ event: { expression: { characterId: "char-alice", pose: "pose-angry" } } }) },
                    ["enter", "say"],
                ),
                sceneId: "scene-1",
                characters: [alice],
                resolveAssetUrl: async assetId => `nlr://${assetId}`,
            });

            expect(compiled.diagnostics).toEqual([]);
            const words = sayWords(compiled);
            const tokens = words.filter(word => word.isTextEvent?.());
            expect(tokens).toHaveLength(1);
            const event = tokens[0].text as any;
            expect(event.config.expression?.appearance).toBe("nlr://asset-angry");
            expect(event.config.expression?.image).toBeTruthy();
            // The token contributes no glyphs: the plain projection is just the surrounding text.
            expect(plainText(words)).toBe("AB");
        });

        it("compiles a sound-only event into a TextEvent carrying the SE", async () => {
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument(eventDialogue({ event: { sound: { assetId: "asset-sting" } } }), ["say"]),
                sceneId: "scene-1",
                characters: [alice],
                resolveAssetUrl: async assetId => `nlr://${assetId}`,
            });

            expect(compiled.diagnostics).toEqual([]);
            const tokens = sayWords(compiled).filter(word => word.isTextEvent?.());
            expect(tokens).toHaveLength(1);
            const event = tokens[0].text as any;
            expect(event.config.sound).toBeTruthy();
            expect(event.config.expression).toBeUndefined();
        });

        it("warns and omits an event whose character image cannot be resolved", async () => {
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument(eventDialogue({ event: { expression: { characterId: "char-ghost", formName: "angry" } } }), ["say"]),
                sceneId: "scene-1",
                characters: [alice],
                resolveAssetUrl: async assetId => `nlr://${assetId}`,
            });

            expect(compiled.diagnostics).toEqual([
                { level: "warning", blockId: "say", message: "Inline event: character image source not found for char-ghost." },
            ]);
            // The event is dropped, but the surrounding line still compiles.
            const words = sayWords(compiled);
            expect(words.some(word => word.isTextEvent?.())).toBe(false);
            expect(plainText(words)).toBe("AB");
        });

        it("warns and omits an expression whose character is not on stage", async () => {
            // The image resolves, but char-alice was never shown, so there is no on-stage portrait to
            // swap - the token would be a silent no-op. WI-0.1: surface it instead of dropping it quietly.
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument(eventDialogue({ event: { expression: { characterId: "char-alice", pose: "pose-angry" } } }), ["say"]),
                sceneId: "scene-1",
                characters: [alice],
                resolveAssetUrl: async assetId => `nlr://${assetId}`,
            });

            expect(compiled.diagnostics).toHaveLength(1);
            expect(compiled.diagnostics[0]).toMatchObject({ level: "warning", blockId: "say" });
            expect(compiled.diagnostics[0].message).toContain("not on stage");
            const words = sayWords(compiled);
            expect(words.some(word => word.isTextEvent?.())).toBe(false);
            expect(plainText(words)).toBe("AB");
        });
    });

    it("compiles dialogue pauseAfter without diagnostics", async () => {
        const blocks: Record<string, StoryBlock> = {
            say: {
                id: "say",
                kind: "nodeAction",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "dialogue",
                    characterId: "char-alice",
                    pauseAfter: 500,
                    text: { textId: "text-say", value: "Hello", role: "dialogue" },
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["say"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
        });

        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toContain("say");
    });

    describe("character nametag fallbacks", () => {
        function dialogueBlocks(characterId: string): Record<string, StoryBlock> {
            return {
                say: {
                    id: "say",
                    kind: "nodeAction",
                    parentId: null,
                    childrenIds: [],
                    payload: {
                        action: "dialogue",
                        characterId,
                        text: { textId: "text-say", value: "Hello", role: "dialogue" },
                    },
                },
            };
        }

        /** The Character the compiler bound to the `say` block, via `sentence.config.character`. */
        async function compileSpeaker(characters: DevModeCharacterSummary[], characterId = "char-alice") {
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument(dialogueBlocks(characterId), ["say"]),
                sceneId: "scene-1",
                characters,
            });
            expect(compiled.diagnostics).toEqual([]);
            const sayAction = compiled.actionIdBindings.find(binding => binding.blockId === "say")?.action as any;
            const speaker = sayAction?.contentNode?.getContent?.()?.config?.character;
            expect(speaker).toBeTruthy();
            return speaker;
        }

        it("keeps an authored name as the nametag", async () => {
            const speaker = await compileSpeaker([{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }]);
            expect(speaker.state.name).toBe("Alice");
        });

        // A blank name must not produce `new Character("")`: NLR's Narrator collapses to
        // `state.name === ""`, so useDialog would report this real character as `isNarrator` and
        // Avatar would bail on `!character.state.name` - both silent.
        it.each([
            ["empty", ""],
            ["whitespace-only", "   "],
        ])("does not collapse a %s character name into the Narrator", async (_label, name) => {
            const speaker = await compileSpeaker([{ id: "char-alice", name, appearance: EMPTY_APPEARANCE }]);

            expect(speaker.state.name).not.toBe("");
            expect(speaker.state.name).toBeTruthy();
        });

        it("falls back to a neutral label rather than leaking the characterId UUID", async () => {
            const uuid = "0f1c6b3e-8a2d-4c77-9f5a-1b2c3d4e5f60";

            // Unnamed character, and a character the host never sent a summary for.
            const unnamed = await compileSpeaker([{ id: uuid, name: "", appearance: EMPTY_APPEARANCE }], uuid);
            const missing = await compileSpeaker([], uuid);

            for (const speaker of [unnamed, missing]) {
                expect(speaker.state.name).not.toBe(uuid);
                expect(speaker.state.name).toBe("Unknown");
            }
        });

        it("still binds one Character instance per characterId when names collide", async () => {
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument({
                    say: dialogueBlocks("char-alice").say,
                    say2: {
                        id: "say2",
                        kind: "nodeAction",
                        parentId: null,
                        childrenIds: [],
                        payload: {
                            action: "dialogue",
                            characterId: "char-bob",
                            text: { textId: "text-say2", value: "Hi", role: "dialogue" },
                        },
                    },
                }, ["say", "say2"]),
                sceneId: "scene-1",
                characters: [{ id: "char-alice", name: "", appearance: { kind: "preset", poses: [], defaultPoseId: null } }, { id: "char-bob", name: "", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
            });

            const speakers = ["say", "say2"].map(blockId => {
                const action = compiled.actionIdBindings.find(binding => binding.blockId === blockId)?.action as any;
                return action?.contentNode?.getContent?.()?.config?.character;
            });

            // Both render "Unknown", but identity is keyed on characterId, not the nametag.
            expect(speakers[0].state.name).toBe("Unknown");
            expect(speakers[1].state.name).toBe("Unknown");
            expect(speakers[0]).not.toBe(speakers[1]);
        });
    });

    // A speaker the author typed that has no Studio character behind it. NLR's dialogue box only
    // displays the name its Character carries, so these are valid lines rather than errors.
    describe("temp speakers", () => {
        function speakerLine(id: string, payload: { characterId?: string; speakerName?: string }): StoryBlock {
            return {
                id,
                kind: "nodeAction",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "dialogue",
                    ...payload,
                    text: { textId: `text-${id}`, value: "Hello", role: "dialogue" },
                },
            };
        }

        async function compileSpeakers(blocks: Record<string, StoryBlock>, characters: DevModeCharacterSummary[] = []) {
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument(blocks, Object.keys(blocks)),
                sceneId: "scene-1",
                characters,
            });
            expect(compiled.diagnostics).toEqual([]);
            return Object.keys(blocks).map(blockId => {
                const action = compiled.actionIdBindings.find(binding => binding.blockId === blockId)?.action as any;
                return action?.contentNode?.getContent?.()?.config?.character;
            });
        }

        it("renders a bare speakerName as the nametag", async () => {
            const [speaker] = await compileSpeakers({ say: speakerLine("say", { speakerName: "Alice" }) });
            expect(speaker.state.name).toBe("Alice");
        });

        it("binds one Character instance per temp speaker name", async () => {
            const [first, second, other] = await compileSpeakers({
                say: speakerLine("say", { speakerName: "Alice" }),
                say2: speakerLine("say2", { speakerName: "Alice" }),
                say3: speakerLine("say3", { speakerName: "Bob" }),
            });

            expect(first).toBe(second);
            expect(first).not.toBe(other);
        });

        it("prefers a resolving characterId over speakerName", async () => {
            const [speaker] = await compileSpeakers(
                { say: speakerLine("say", { characterId: "char-alice", speakerName: "Stale" }) },
                [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
            );
            expect(speaker.state.name).toBe("Alice");
        });

        // Deleting a character should degrade the line to the name the author wrote, not to "Unknown".
        it("falls back to speakerName when the characterId no longer resolves", async () => {
            const [speaker] = await compileSpeakers({ say: speakerLine("say", { characterId: "char-gone", speakerName: "Alice" }) });
            expect(speaker.state.name).toBe("Alice");
        });

        // Same trap as the authored-name case: `new Character("")` collapses into NLR's Narrator.
        it.each([
            ["empty", ""],
            ["whitespace-only", "   "],
        ])("does not collapse a %s speakerName into the Narrator", async (_label, speakerName) => {
            const [speaker] = await compileSpeakers({ say: speakerLine("say", { speakerName }) });

            expect(speaker.state.name).not.toBe("");
            expect(speaker.state.name).toBe("Unknown");
        });
    });

    it("compiles choice, condition, variables, and skips script-only blocks with diagnostics", async () => {
        const optionChild = narrationBlock("option-child", "text-option-child", "Selected");
        optionChild.parentId = "option";
        const option: StoryBlock = {
            id: "option",
            kind: "nodeAction",
            parentId: "choice",
            childrenIds: ["option-child"],
            payload: {
                action: "choiceOption",
                text: { textId: "text-option", value: "Go", role: "choiceText" },
                disabledWhen: {
                    kind: "variable",
                    target: { scope: "scene", variableId: "locked" },
                    operator: "isTrue",
                },
            },
        };
        const choice: StoryBlock = {
            id: "choice",
            kind: "nodeAction",
            parentId: null,
            childrenIds: ["option"],
            payload: {
                action: "choice",
                prompt: { textId: "text-choice", value: "Pick one", role: "choicePrompt" },
            },
        };
        const setVariable: StoryBlock = {
            id: "set-var",
            kind: "action",
            parentId: "if-branch",
            childrenIds: [],
            payload: {
                action: "setVariable",
                target: { scope: "scene", variableId: "locked" },
                value: true,
            },
        };
        const branch: StoryBlock = {
            id: "if-branch",
            kind: "control",
            parentId: "condition",
            childrenIds: ["set-var"],
            payload: {
                control: "conditionBranch",
                branch: "if",
                condition: {
                    kind: "variable",
                    target: { scope: "scene", variableId: "started" },
                    operator: "isFalse",
                },
            },
        };
        const condition: StoryBlock = {
            id: "condition",
            kind: "control",
            parentId: null,
            childrenIds: ["if-branch"],
            payload: { control: "condition" },
        };
        const code: StoryBlock = {
            id: "code",
            kind: "code",
            parentId: null,
            childrenIds: [],
            payload: { language: "narraleaf", source: "Script.action()", advanced: true },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({
                choice,
                option,
                "option-child": optionChild,
                condition,
                "if-branch": branch,
                "set-var": setVariable,
                code,
            }, ["choice", "condition", "code"]),
            sceneId: "scene-1",
        });

        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toEqual(expect.arrayContaining([
            "option-child",
            "condition",
            "set-var",
        ]));
        expect(compiled.diagnostics).toEqual([
            {
                level: "warning",
                blockId: "code",
                message: "Code/Script blocks are not part of the NLR Story action surface and were skipped.",
            },
        ]);
    });

    it("validates persistent references against the declared set (bible §3.3)", async () => {
        const persistentDecl: StoryBlock = {
            id: "flag-decl",
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: { scope: "persistent", name: "flag", valueType: "boolean", storageKey: "flag" },
        };
        const setDeclared: StoryBlock = {
            id: "set-declared",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "setVariable", target: { scope: "persistent", variableId: "flag" }, value: true },
        };
        const setGhost: StoryBlock = {
            id: "set-ghost",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "setVariable", target: { scope: "persistent", variableId: "ghost" }, value: true },
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ "flag-decl": persistentDecl, "set-declared": setDeclared, "set-ghost": setGhost }, ["flag-decl", "set-declared", "set-ghost"]),
            sceneId: "scene-1",
        });
        // The undeclared reference is caught; the declared one passes validation and only trips the
        // separate "needs host persistence" gate (no persistence bridge in this compile).
        expect(compiled.diagnostics).toContainEqual({ level: "warning", blockId: "set-ghost", message: "Persistent variable not found; the assignment was skipped." });
        expect(compiled.diagnostics.find(d => d.blockId === "set-declared")?.message).toContain("require Dev Mode host persistence");
        expect(compiled.diagnostics.some(d => d.blockId === "set-declared" && d.message.includes("not found"))).toBe(false);
    });

    it("flags two scenes sharing a runtime name (colliding scene-local namespaces)", async () => {
        const document = baseDocument({ say: narrationBlock("say", "text-say", "Hi.") }, ["say"]);
        // Force the collision: both scenes now resolve to the same NLR Scene name.
        document.scenes["scene-2"].runtimeName = document.scenes["scene-1"].runtimeName;
        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toContainEqual({
            level: "error",
            message: `Two scenes share the name "${document.scenes["scene-1"].runtimeName}"; their scene-local variables would collide. Rename one.`,
        });
    });

    it("seeds declared scene-local defaults at the scene head and compiles declaration rows to nothing", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ say: narrationBlock("say", "text-say", "Hello.") }, ["say"]),
            sceneId: "scene-1",
        });

        expect(compiled.diagnostics).toEqual([]);
        // The declaration rows themselves emit no statements and bind no actions...
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toEqual(["say"]);
        // ...but `gold`'s declared default (100) becomes a head-of-scene `local.set` statement, so a
        // fresh scene entry reads 100 rather than null (`Scene.local.init` resets on every entry).
        // `locked`/`started` declare no default and must not be seeded.
        const statements = ((compiled.scene as any).actions ?? []) as unknown[];
        const statementTypes = statements.map(statement => DevTools.chainToActions(statement as any)
            .flat(Number.POSITIVE_INFINITY)
            .map((action: any) => action?.type as string));
        const seedStatements = statementTypes.filter(types => types.includes("persistent:set"));
        expect(seedStatements).toHaveLength(1);
        expect(statementTypes[0]).toContain("persistent:set");
    });

    describe("expression assignments and conditions", () => {
        /** A `setVariable` whose right-hand side is computed - `/set gold gold + 1`. */
        function incrementGold(): StoryBlock {
            return {
                id: "set-var",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "setVariable",
                    target: { scope: "scene", variableId: "gold" },
                    value: null,
                    expression: {
                        source: "gold + 1",
                        ast: {
                            kind: "binary",
                            op: "+",
                            left: { kind: "var", target: { scope: "scene", variableId: "gold" }, name: "gold" },
                            right: { kind: "literal", value: 1 },
                        },
                    },
                },
            };
        }

        it("compiles a computed assignment with no diagnostics", async () => {
            // The headline of the change: adding one to a number no longer needs a blueprint. If this
            // regresses, `/set gold gold + 1` silently stops assigning.
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument({ "set-var": incrementGold() }, ["set-var"]),
                sceneId: "scene-1",
            });
            expect(compiled.diagnostics).toEqual([]);
            expect(compiled.actionIdBindings.map(binding => binding.blockId)).toContain("set-var");
        });

        it("skips the assignment and says so when the expression never resolved", async () => {
            // A tree carrying an `invalid` node must not be evaluated around - writing whatever the
            // rest of it computes would produce a plausible wrong number.
            const broken: StoryBlock = {
                id: "set-var",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "setVariable",
                    target: { scope: "scene", variableId: "gold" },
                    value: null,
                    expression: { source: "gone + 1", ast: { kind: "invalid", source: "gone + 1" } },
                },
            };
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument({ "set-var": broken }, ["set-var"]),
                sceneId: "scene-1",
            });
            expect(compiled.diagnostics).toEqual([
                { level: "warning", blockId: "set-var", message: "Expression `gone + 1` did not resolve; the assignment was skipped." },
            ]);
        });

        it("compiles an expression condition instead of refusing it", async () => {
            // v4 returned a constant false here and emitted a "raw script is outside the NLR action
            // surface" warning. A clean compile is the whole point of the v5 migration.
            const branch: StoryBlock = {
                id: "if-branch",
                kind: "control",
                parentId: "condition",
                childrenIds: [],
                payload: {
                    control: "conditionBranch",
                    branch: "if",
                    condition: {
                        kind: "expression",
                        expression: {
                            source: "gold >= 100",
                            ast: {
                                kind: "binary",
                                op: ">=",
                                left: { kind: "var", target: { scope: "scene", variableId: "gold" }, name: "gold" },
                                right: { kind: "literal", value: 100 },
                            },
                        },
                    },
                },
            };
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument({
                    condition: { id: "condition", kind: "control", parentId: null, childrenIds: ["if-branch"], payload: { control: "condition" } },
                    "if-branch": branch,
                }, ["condition"]),
                sceneId: "scene-1",
            });
            expect(compiled.diagnostics).toEqual([]);
        });
    });

    it("maps the custom transition kinds onto real NLR transitions without diagnostics", async () => {
        // Each new kind must be handled by createTransition; an unmapped kind
        // falls through to a "not supported" diagnostic, which this guards against.
        const kinds: StoryTransitionRef["kind"][] = ["softWipe", "blinds", "slide", "softIris", "blurDissolve", "throughColor", "darkness"];
        for (const kind of kinds) {
            const compiled = await compileBackgroundTransition(kind);
            expect(compiled.diagnostics, `kind=${kind}`).toEqual([]);
        }
    });

    it("builds each whole-screen kind out of the engine's own transitions", async () => {
        // 0.16.1 adoption: `slide` is native `Push` (no Studio-side Slide any more) and `darkness` is
        // the now-exported `Darkness`. Both are engine classes, so a future engine rename breaks here
        // rather than silently downgrading a transition to a no-op.
        const expected: Partial<Record<NonNullable<StoryTransitionRef["kind"]>, unknown>> = {
            slide: Push,
            darkness: Darkness,
            softWipe: Reveal,
            softIris: Reveal,
            blinds: Reveal,
            blurDissolve: BlurDissolve,
            throughColor: ThroughColor,
        };
        for (const [kind, ctor] of Object.entries(expected)) {
            const compiled = await compileBackgroundTransition(kind as StoryTransitionRef["kind"]);
            expect(findTransition(compiled), `kind=${kind}`).toBeInstanceOf(ctor as never);
        }
    });

    it("keeps the stored shape of `slide` untouched by the native-Push switch", async () => {
        // Hard requirement of the 0.16.1 adoption: existing projects migrate by doing nothing. The
        // stored ref keeps `kind: "slide"` with a `direction` prop, and the compiler still honours it.
        const stored: StoryTransitionRef = { kind: "slide", durationMs: 400, props: { direction: "right" } };
        const bg: StoryBlock = {
            id: "bg",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "setBackground", assetId: "asset-bg", transition: stored },
        };
        const document = baseDocument({ bg }, ["bg"]);
        const compiled = await compileStudioStoryToNlr({
            document,
            sceneId: "scene-1",
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        expect(compiled.diagnostics).toEqual([]);
        expect((document.scenes["scene-1"].blocks.bg.payload as any).transition).toEqual(stored);
        const transition = findTransition(compiled) as any;
        expect(transition).toBeInstanceOf(Push);
        expect(transition.direction).toBe("right");
        expect(transition.duration).toBe(400);
    });

    it("slides in stage-relative %, never viewport units", async () => {
        // The whole reason Studio shipped its own `Slide` until 0.16.1: a `100vw`/`100vh` travel is
        // measured against the *window*, so on any non-design aspect ratio the slide overshoots the
        // letterboxed stage and exposes the backdrop mid-transition. This is the seam test that used
        // to live beside the custom class - it now guards the engine's `Push` in its place.
        const compiled = await compileBackgroundTransition("slide");
        const push = findTransition(compiled) as any;
        // The asPrev/asTarget resolvers merge the transition's srcs in and throw when unset.
        push._setPrevSrc("#000000");
        push._setTargetSrc("#000000");
        const task = push.createTask();
        const translateAt = (index: number, t: number) => {
            const entry = task.resolve[index];
            return (typeof entry === "function" ? entry(t) : entry.resolver(t)).style.translate as string;
        };

        expect(task.resolve).toHaveLength(2);
        // Outgoing rests at offset 0 (no jump) and travels one full stage width toward `direction`.
        expect(translateAt(0, 0)).toBe("0% 0px");
        expect(translateAt(0, 1)).toBe("100% 0px");
        // Incoming starts one stage width away on the opposite edge and lands at rest.
        expect(translateAt(1, 0)).toBe("-100% 0px");
        expect(translateAt(1, 1)).toBe("0% 0px");
        expect([translateAt(0, 0.5), translateAt(1, 0.5)].join(" ")).not.toMatch(/vw|vh/);
    });

    it("clamps the darkness pair into the 0-1 the engine's filter can express", async () => {
        // `Darkness` renders darkness `d` as `brightness(1 - d)` and, unlike `Image.darken`, does not
        // clamp its own inputs. An inspector value outside 0-1 would emit `brightness(-1)` - invalid
        // CSS the browser drops entirely, turning the transition into a silent no-op instead of
        // saturating at black. So the compiler clamps before the value ever reaches the engine.
        const compiled = await compileBackgroundTransition("darkness", { from: 2, to: -0.5 });
        const darkness = findTransition(compiled) as any;

        expect(compiled.diagnostics).toEqual([]);
        expect(darkness).toBeInstanceOf(Darkness);
        expect(darkness.from).toBe(1);
        expect(darkness.to).toBe(0);
    });

    /** Compile a one-row scene whose `/bg` carries `kind`, with every custom transition's props set. */
    async function compileBackgroundTransition(kind: StoryTransitionRef["kind"], overrides: StoryTransitionRef["props"] = {}) {
        const bg: StoryBlock = {
            id: "bg",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "setBackground",
                assetId: "asset-bg",
                transition: {
                    kind,
                    durationMs: 400,
                    // Superset of every custom transition's params; each kind reads only its own.
                    props: { pattern: "iris", color: "#000000", blur: 12, direction: "right", orientation: "vertical", slats: 6, feather: 20, hold: 40, center: "50% 50%", ...overrides },
                },
            },
        };
        return compileStudioStoryToNlr({
            document: baseDocument({ bg }, ["bg"]),
            sceneId: "scene-1",
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });
    }

    /**
     * The engine transition a compiled scene carries, found by walking the recorded actions.
     *
     * Where exactly NLR parks the instance inside an action is an engine implementation detail, so the
     * walk looks for the base class rather than for a path that an engine bump could move.
     */
    function findTransition(compiled: Awaited<ReturnType<typeof compileStudioStoryToNlr>>): Transition | undefined {
        const seen = new Set<unknown>();
        const visit = (node: unknown, depth: number): Transition | undefined => {
            if (!node || typeof node !== "object" || depth > 24 || seen.has(node)) {
                return undefined;
            }
            seen.add(node);
            if (node instanceof Transition) {
                return node;
            }
            for (const value of Object.values(node as Record<string, unknown>)) {
                const found = visit(value, depth + 1);
                if (found) {
                    return found;
                }
            }
            return undefined;
        };
        return visit(compiled.actionIdBindings.map(binding => binding.action), 0);
    }
});

describe("compileStudioStoryToNlr localization", () => {
    /** Sentence of a compiled say action; its `.text` is the NLR word array. */
    function getSaySentence(compiled: Awaited<ReturnType<typeof compileStudioStoryToNlr>>, blockId: string): any {
        const binding = compiled.actionIdBindings.find(entry => entry.blockId === blockId);
        expect(binding, `say binding for ${blockId}`).toBeTruthy();
        const content = (binding!.action as any).contentNode?.getContent?.();
        const sentence = Array.isArray(content) ? content.find((item: any) => item?.text) : content;
        expect(sentence?.text, `sentence of ${blockId}`).toBeTruthy();
        return sentence;
    }

    /** Flatten a DynamicWordResult into plain text, resolving nested dynamic words. */
    function renderDynamicResult(result: unknown, scriptCtx: unknown = {}): string {
        const parts = Array.isArray(result) ? result : [result];
        return parts.map(part => {
            if (typeof part === "string") {
                return part;
            }
            const inner = (part as any)?.text;
            if (typeof inner === "function") {
                return renderDynamicResult(inner(scriptCtx), scriptCtx);
            }
            return typeof inner === "string" ? inner : "";
        }).join("");
    }

    const localizationSetup = (getLocale: () => string) => ({
        sourceLocale: "zh-CN",
        locales: [
            { code: "zh-CN", displayName: "简体中文" },
            { code: "en", displayName: "English" },
            { code: "yue", displayName: "粵語", fallback: "en" },
        ],
        tables: {
            en: { "text-say": "Hello there." },
        },
        getLocale,
    });

    it("renders the translation for the current locale and re-resolves after a switch", async () => {
        let locale = "zh-CN";
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ say: narrationBlock("say", "text-say", "你好。") }, ["say"]),
            sceneId: "scene-1",
            localization: localizationSetup(() => locale),
        });
        expect(compiled.diagnostics).toEqual([]);

        const words = getSaySentence(compiled, "say").text as any[];
        expect(words).toHaveLength(1);
        const dynamic = words[0].text;
        expect(typeof dynamic).toBe("function");

        expect(renderDynamicResult(dynamic({}))).toBe("你好。");
        locale = "en";
        expect(renderDynamicResult(dynamic({}))).toBe("Hello there.");
        // Unknown stored locale falls back to the source language.
        locale = "fr";
        expect(renderDynamicResult(dynamic({}))).toBe("你好。");
        // Fallback chain: yue has no table, falls through to en.
        locale = "yue";
        expect(renderDynamicResult(dynamic({}))).toBe("Hello there.");
    });

    it("keeps untranslated segments as plain compiled prompts (no dynamic wrapper)", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ say: narrationBlock("say", "text-other", "没有翻译的行。") }, ["say"]),
            sceneId: "scene-1",
            localization: localizationSetup(() => "en"),
        });
        const words = getSaySentence(compiled, "say").text as any[];
        expect(words.every(word => typeof word.text !== "function")).toBe(true);
        expect(renderDynamicResult(words.map(word => word.text))).toBe("没有翻译的行。");
    });

    it("maps {n} placeholders in translations back to the source interpolation words", async () => {
        let locale = "en";
        // The persistent variable the interpolation reads must be declared (bible §3.3), so a
        // persistent `//persis playerName` row seeds it; the host still supplies the live value.
        const playerNameDecl: StoryBlock = {
            id: "playerName",
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: { scope: "persistent", name: "playerName", valueType: "string", storageKey: "playerName" },
        };
        const say: StoryBlock = {
            id: "say",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "narration",
                text: {
                    textId: "text-interp",
                    value: "你好，！",
                    role: "narration",
                    rich: [
                        { text: "你好，" },
                        { interpolation: { kind: "variable", target: { scope: "persistent", variableId: "playerName" } } },
                        { text: "！" },
                    ],
                },
            },
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ playerName: playerNameDecl, say }, ["playerName", "say"]),
            sceneId: "scene-1",
            persistence: {
                get: key => (key === "playerName" ? "Alice" : undefined),
                set: () => undefined,
            },
            localization: {
                sourceLocale: "zh-CN",
                locales: [
                    { code: "zh-CN", displayName: "简体中文" },
                    { code: "en", displayName: "English" },
                ],
                tables: {
                    en: { "text-interp": "Hi, {0}! Welcome." },
                },
                getLocale: () => locale,
            },
        });
        expect(compiled.diagnostics).toEqual([]);

        const words = getSaySentence(compiled, "say").text as any[];
        const dynamic = words[0].text;
        expect(renderDynamicResult(dynamic({}))).toBe("Hi, Alice! Welcome.");
        locale = "zh-CN";
        expect(renderDynamicResult(dynamic({}))).toBe("你好，Alice！");
    });

    it("localizes choice prompts and option texts", async () => {
        const optionChild = narrationBlock("option-child", "text-option-child", "留下了。");
        optionChild.parentId = "option";
        const option: StoryBlock = {
            id: "option",
            kind: "nodeAction",
            parentId: "choice",
            childrenIds: ["option-child"],
            payload: {
                action: "choiceOption",
                text: { textId: "text-option", value: "留下", role: "choiceText" },
            },
        };
        const choice: StoryBlock = {
            id: "choice",
            kind: "nodeAction",
            parentId: null,
            childrenIds: ["option"],
            payload: {
                action: "choice",
                prompt: { textId: "text-prompt", value: "怎么办？", role: "choicePrompt" },
            },
        };
        let locale = "en";
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ choice, option, "option-child": optionChild }, ["choice"]),
            sceneId: "scene-1",
            localization: {
                sourceLocale: "zh-CN",
                locales: [
                    { code: "zh-CN", displayName: "简体中文" },
                    { code: "en", displayName: "English" },
                ],
                tables: {
                    en: { "text-prompt": "What now?", "text-option": "Stay" },
                },
                getLocale: () => locale,
            },
        });
        expect(compiled.diagnostics).toEqual([]);

        // The Menu chain is stored as a raw element on the scene until NLR
        // constructs the scene root, so introspect it directly.
        const menuElement = ((compiled.scene as any).actions as any[])
            .flat(9)
            .find(item => item?.choices);
        expect(menuElement, "menu element on scene actions").toBeTruthy();
        const promptWords = menuElement.prompt?.text as any[];
        expect(renderDynamicResult(promptWords[0].text({}))).toBe("What now?");
        const choiceEntries = menuElement.choices as any[];
        expect(choiceEntries).toHaveLength(1);
        const optionWords = choiceEntries[0].prompt?.text as any[];
        expect(renderDynamicResult(optionWords[0].text({}))).toBe("Stay");
        locale = "zh-CN";
        expect(renderDynamicResult(promptWords[0].text({}))).toBe("怎么办？");
        expect(renderDynamicResult(optionWords[0].text({}))).toBe("留下");
    });

    /**
     * A character enter block has no `objectName` until the author types one, so its portrait is
     * registered under `characterId`. A displayable op that resolved the same creator block to the
     * word "Character" looked up a name nothing was registered under, and compiled to nothing.
     */
    it("compiles a displayable effect against a character portrait with no explicit stage name", async () => {
        const blocks: Record<string, StoryBlock> = {
            enter: {
                id: "enter",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "character",
                    operation: "enter",
                    characterId: "char-alice",
                    assetId: "asset-alice",
                    transform: { preset: "center", durationMs: 300 },
                },
            },
            darken: {
                id: "darken",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "darken",
                    target: { name: "Character", kind: "character", sourceBlockId: "enter" },
                    darkness: 0.6,
                    durationMs: 400,
                },
            },
        };

        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["enter", "darken"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        expect(compiled.diagnostics).toEqual([]);
        // The op resolved to a real object, so it emitted a statement bound to the block.
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toContain("darken");
    });
});

describe("compileStudioStoryToNlr voice", () => {
    /** Compiled say action's Sentence (its `.config` carries voiceId/voice). */
    function getSaySentence(compiled: Awaited<ReturnType<typeof compileStudioStoryToNlr>>, blockId: string): any {
        const binding = compiled.actionIdBindings.find(entry => entry.blockId === blockId);
        expect(binding, `say binding for ${blockId}`).toBeTruthy();
        const content = (binding!.action as any).contentNode?.getContent?.();
        const sentence = Array.isArray(content) ? content.find((item: any) => item?.text) : content;
        expect(sentence?.text, `sentence of ${blockId}`).toBeTruthy();
        return sentence;
    }

    function dialogueBlock(id: string, textId: string, value: string, extra: { voiceAssetId?: string } = {}): StoryBlock {
        return {
            id,
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "dialogue",
                characterId: "char-alice",
                text: { textId, value, role: "dialogue" },
                ...(extra.voiceAssetId ? { voiceAssetId: extra.voiceAssetId } : {}),
            },
        };
    }

    const voiceSetup = (getVoiceLocale: () => string) => ({
        voicedLocales: [{ code: "ja", displayName: "日本語" }],
        tables: { ja: { "text-say": "asset-ja-say" } },
        getVoiceLocale,
    });

    it("attaches the voiceId and resolves the take onto the scene voice map", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ say: dialogueBlock("say", "text-say", "こんにちは。") }, ["say"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
            voice: voiceSetup(() => "ja"),
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });
        expect(compiled.diagnostics).toEqual([]);
        expect(getSaySentence(compiled, "say").config?.voiceId).toBe("text-say");
        const scene = compiled.scenes["scene-1"] as any;
        expect(scene.config?.voices?.["text-say"]).toBe("nlr://asset-ja-say");
    });

    it("voices narration lines as well", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ say: narrationBlock("say", "text-say", "……。") }, ["say"]),
            sceneId: "scene-1",
            voice: voiceSetup(() => "ja"),
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });
        expect(getSaySentence(compiled, "say").config?.voiceId).toBe("text-say");
    });

    it("leaves unvoiced lines and voiceless projects untouched", async () => {
        // A line with no take for the active language gets no voiceId.
        const partial = await compileStudioStoryToNlr({
            document: baseDocument({ say: dialogueBlock("say", "text-other", "no take") }, ["say"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
            voice: voiceSetup(() => "ja"),
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });
        expect(getSaySentence(partial, "say").config?.voiceId ?? null).toBeNull();

        // A project with no voice bundle compiles exactly as before.
        const none = await compileStudioStoryToNlr({
            document: baseDocument({ say: dialogueBlock("say", "text-say", "hi") }, ["say"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
        });
        expect(getSaySentence(none, "say").config?.voiceId ?? null).toBeNull();
        expect((none.scenes["scene-1"] as any).config?.voices ?? null).toBeNull();
    });

    it("keeps the legacy per-line voiceAssetId as an inline fallback", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument({ say: dialogueBlock("say", "text-legacy", "hi", { voiceAssetId: "asset-voice" }) }, ["say"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });
        const sentence = getSaySentence(compiled, "say");
        // Inline voice remains for back-compat; no id-keyed take overrides it.
        expect(sentence.config?.voice).toBeTruthy();
        expect(sentence.config?.voiceId ?? null).toBeNull();
    });

    it("compiles /camera onto story.camera and clamps every numeric input", async () => {
        // The clamp is the point: the engine's Darkness does not clamp, so an out-of-range darkness
        // compiles to an invalid filter and fails SILENTLY. Same reasoning for a zero/negative zoom.
        const cameraBlock = (id: string, payload: Extract<StoryBlock["payload"], { action: "camera" }>): StoryBlock => ({
            id,
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload,
        });
        const blocks: Record<string, StoryBlock> = {
            zoom: cameraBlock("zoom", { action: "camera", operation: "zoom", zoom: 0, durationMs: 800 }),
            pan: cameraBlock("pan", { action: "camera", operation: "pan", position: { xalign: 0.25, yalign: 0.5 }, durationMs: 600 }),
            rotate: cameraBlock("rotate", { action: "camera", operation: "rotate", rotation: 15, durationMs: 400 }),
            dark: cameraBlock("dark", { action: "camera", operation: "darken", darkness: 2, durationMs: 500 }),
            reset: cameraBlock("reset", { action: "camera", operation: "reset", durationMs: 600 }),
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["zoom", "pan", "rotate", "dark", "reset"]),
            sceneId: "scene-1",
        });

        const propsOf = (blockId: string) => getDisplayableTransformProps(
            compiled.actionIdBindings
                .filter(binding => binding.blockId === blockId)
                .flatMap(binding => collectActionTree(binding.action, compiled.story)),
        );

        expect(compiled.diagnostics).toEqual([]);
        // Every camera row produced a statement bound back to its block.
        for (const blockId of Object.keys(blocks)) {
            expect(compiled.actionIdBindings.some(binding => binding.blockId === blockId)).toBe(true);
        }
        // zoom 0 would be a degenerate transform; it lands on the floor instead.
        expect(propsOf("zoom")).toEqual([expect.objectContaining({ zoom: 0.05 })]);
        expect(propsOf("pan")).toEqual([expect.objectContaining({ position: expect.objectContaining({ xalign: 0.25, yalign: 0.5 }) })]);
        expect(propsOf("rotate")).toEqual([expect.objectContaining({ rotation: 15 })]);
        // darkness 2 → brightness(-1), which renders as nothing at all. Clamped to 1 → brightness(0).
        expect(propsOf("dark")).toEqual([expect.objectContaining({ filter: "brightness(0)" })]);
    });

    it("pre-poses the stage camera when a row-precise launch starts after a /camera op", async () => {
        // A launch that starts after `/camera zoom 2` must open on the zoomed shot. The pose is
        // pre-posed onto story.camera through the same DevTools path the built-in layers use, and its
        // darkness compiles to a `camera.darken(d, 0)` statement here - this guards that the camera
        // element is actually reachable at compile time (an undefined `story.camera` would throw).
        const cameraBlock = (id: string, payload: Extract<StoryBlock["payload"], { action: "camera" }>): StoryBlock => ({
            id, kind: "action", parentId: null, childrenIds: [], payload,
        });
        const document = baseDocument({
            zoom: cameraBlock("zoom", { action: "camera", operation: "zoom", zoom: 2 }),
            dark: cameraBlock("dark", { action: "camera", operation: "darken", darkness: 0.6 }),
            target: narrationBlock("target", "target-text", "Here"),
        }, ["zoom", "dark", "target"]);
        const snapshot = computeStoryStageSnapshot({ document, sceneId: "scene-1", targetBlockId: "target" });
        expect(snapshot.camera).toEqual({ props: { zoom: 2 }, effects: { darkness: 0.6 } });

        const compiled = await compileStudioStoryToNlr({
            document,
            sceneId: "scene-1",
            launch: { targetBlockId: "target", snapshot },
        });
        expect(compiled.diagnostics.filter(diagnostic => diagnostic.level === "error")).toEqual([]);
        expect(compiled.story).toBeDefined();
    });

    it("compiles /label and /goto, and refuses the two shapes the engine would refuse", async () => {
        const control = (id: string, payload: Extract<StoryBlock["payload"], { control: string }>): StoryBlock => ({
            id, kind: "control", parentId: null, childrenIds: [], payload,
        });
        const blocks: Record<string, StoryBlock> = {
            start: control("start", { control: "label", name: "start" }),
            back: control("back", { control: "goto", targetLabel: "start" }),
            // Both faults make the engine's own Story.build throw, with no row to blame - which is
            // why the compiler diagnoses them first, and at `error` so a production build refuses.
            dupe: control("dupe", { control: "label", name: "start" }),
            nowhere: control("nowhere", { control: "goto", targetLabel: "elsewhere" }),
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["start", "back", "dupe", "nowhere"]),
            sceneId: "scene-1",
        });

        const typeOf = (blockId: string) => compiled.actionIdBindings.find(binding => binding.blockId === blockId)?.action as { type?: string } | undefined;
        expect(typeOf("start")?.type).toBe("control:label");
        expect(typeOf("back")?.type).toBe("control:jump");
        // The faulted rows emit nothing at all - a half-built jump is worse than an absent one.
        expect(typeOf("dupe")).toBeUndefined();
        expect(typeOf("nowhere")).toBeUndefined();
        expect(compiled.diagnostics).toEqual([
            { level: "error", blockId: "dupe", message: 'Label "start" is declared more than once in this scene.' },
            { level: "error", blockId: "nowhere", message: "Go to target label not found in this scene: elsewhere" },
        ]);
    });

    it("matches label names exactly, as the engine's own label Map does", async () => {
        // `Scene.constructLabels` keys a plain `Map` on the declared string. Studio compared folded, so
        // it was wrong in both directions: a `/goto start` left behind by a label renamed `Start` passed
        // here and then threw in `Story.build`, and a legal `start`/`Start` pair was faulted as a
        // duplicate. Both directions are pinned here, because both defeat the check's whole purpose.
        const control = (id: string, payload: Extract<StoryBlock["payload"], { control: string }>): StoryBlock => ({
            id, kind: "control", parentId: null, childrenIds: [], payload,
        });
        const blocks: Record<string, StoryBlock> = {
            lower: control("lower", { control: "label", name: "start" }),
            upper: control("upper", { control: "label", name: "Start" }),
            exact: control("exact", { control: "goto", targetLabel: "Start" }),
            miscased: control("miscased", { control: "goto", targetLabel: "START" }),
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["lower", "upper", "exact", "miscased"]),
            sceneId: "scene-1",
        });

        const typeOf = (blockId: string) => compiled.actionIdBindings.find(binding => binding.blockId === blockId)?.action as { type?: string } | undefined;
        // Two labels the engine accepts, so both compile - neither is a duplicate of the other.
        expect(typeOf("lower")?.type).toBe("control:label");
        expect(typeOf("upper")?.type).toBe("control:label");
        // A goto spelled exactly as declared resolves; one that only case-folds to it does not.
        expect(typeOf("exact")?.type).toBe("control:jump");
        expect(typeOf("miscased")).toBeUndefined();
        expect(compiled.diagnostics).toEqual([
            { level: "error", blockId: "miscased", message: "Go to target label not found in this scene: START" },
        ]);
    });

    it("compiles /vfx onto one Vfx, showing on create and clamping its knobs", async () => {
        const vfxBlock = (id: string, payload: Extract<StoryBlock["payload"], { action: "vfx" }>): StoryBlock => ({
            id, kind: "action", parentId: null, childrenIds: [], payload,
        });
        const blocks: Record<string, StoryBlock> = {
            create: vfxBlock("create", {
                action: "vfx", operation: "create", objectName: "rain", assetId: "asset-rain",
                blendMode: "screen", opacity: 2, loop: true, fit: "cover", zIndex: 3, durationMs: 600,
            }),
            rate: vfxBlock("rate", { action: "vfx", operation: "setRate", objectName: "rain", rate: -1 }),
            freeze: vfxBlock("freeze", { action: "vfx", operation: "pause", objectName: "rain" }),
            hide: vfxBlock("hide", { action: "vfx", operation: "hide", objectName: "rain", durationMs: 400 }),
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["create", "rate", "freeze", "hide"]),
            sceneId: "scene-1",
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        const actionOf = (blockId: string) => compiled.actionIdBindings.find(binding => binding.blockId === blockId)?.action as any;

        expect(compiled.diagnostics).toEqual([]);
        // A create puts the overlay on screen - the row an author writes to "start the rain" must.
        expect(actionOf("create")?.type).toBe("vfx:show");
        expect(actionOf("freeze")?.type).toBe("vfx:pause");
        expect(actionOf("hide")?.type).toBe("vfx:hide");
        expect(actionOf("hide")?.contentNode?.getContent?.()[0]).toMatchObject({ duration: 400 });
        // Out-of-range knobs are clamped here, not trusted: a negative rate is not a speed.
        expect(actionOf("rate")?.contentNode?.getContent?.()).toEqual([0]);
        // Every row addresses the SAME overlay - `create` is what registers the name.
        expect(actionOf("hide")?.callee).toBe(actionOf("create")?.callee);
        expect(actionOf("create")?.callee?.config).toMatchObject({ blendMode: "screen", opacity: 1, zIndex: 3, fit: "cover" });
    });

    it("compiles the video transport operations, converting seek to seconds", async () => {
        const videoBlock = (id: string, payload: Extract<StoryBlock["payload"], { action: "video" }>): StoryBlock => ({
            id, kind: "action", parentId: null, childrenIds: [], payload,
        });
        const blocks: Record<string, StoryBlock> = {
            create: videoBlock("create", { action: "video", operation: "create", objectName: "clip", assetId: "asset-clip" }),
            pause: videoBlock("pause", { action: "video", operation: "pause", objectName: "clip" }),
            resume: videoBlock("resume", { action: "video", operation: "resume", objectName: "clip" }),
            stop: videoBlock("stop", { action: "video", operation: "stop", objectName: "clip" }),
            // Negative is not a frame; it floors at the start of the clip.
            seek: videoBlock("seek", { action: "video", operation: "seek", objectName: "clip", timeMs: 3500 }),
            rewind: videoBlock("rewind", { action: "video", operation: "seek", objectName: "clip", timeMs: -1000 }),
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["create", "pause", "resume", "stop", "seek", "rewind"]),
            sceneId: "scene-1",
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        const typeOf = (blockId: string) => compiled.actionIdBindings
            .filter(binding => binding.blockId === blockId)
            .map(binding => (binding.action as { type?: string }).type);
        const contentOf = (blockId: string) => compiled.actionIdBindings
            .filter(binding => binding.blockId === blockId)
            .flatMap(binding => (binding.action as any).contentNode?.getContent?.() ?? []);

        expect(compiled.diagnostics).toEqual([]);
        expect(typeOf("pause")).toEqual(["video:pause"]);
        expect(typeOf("resume")).toEqual(["video:resume"]);
        expect(typeOf("stop")).toEqual(["video:stop"]);
        // Milliseconds in the payload, seconds at the engine boundary.
        expect(contentOf("seek")).toEqual([3.5]);
        expect(contentOf("rewind")).toEqual([0]);
    });

    it("compiles /rename onto the same Character the dialogue rows speak through", async () => {
        // The point of setName is that the NEXT line by that character reads differently, so the
        // rename and the dialogue must resolve to one Character instance, not two.
        const blocks: Record<string, StoryBlock> = {
            rename: {
                id: "rename",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "character", operation: "setName", characterId: "char-alice", displayName: "Alice" },
            },
            line: {
                id: "line",
                kind: "nodeAction",
                parentId: null,
                childrenIds: [],
                payload: { action: "dialogue", characterId: "char-alice", text: { textId: "t1", role: "dialogue", value: "Hello." } },
            },
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(blocks, ["rename", "line"]),
            sceneId: "scene-1",
            characters: [{ id: "char-alice", name: "？？？", appearance: { kind: "preset", poses: [], defaultPoseId: null } }],
        });

        const actionsOf = (blockId: string) => compiled.actionIdBindings
            .filter(binding => binding.blockId === blockId)
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const setName = actionsOf("rename").find(action => action?.type === "character:setName");
        const say = actionsOf("line").find(action => action?.type === "character:say");

        expect(compiled.diagnostics).toEqual([]);
        expect(setName?.contentNode?.getContent?.()).toEqual(["Alice"]);
        expect(setName?.callee).toBe(say?.callee);
    });

    it("warns when a persistent name is declared in both the registry and a story row (M-VAR merged view)", async () => {
        // Story `/persis Score` row and a blueprint-registry entry also named "Score" - ambiguous.
        const scoreRow: StoryBlock = {
            id: "score-decl",
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: { scope: "persistent", name: "Score", valueType: "number", storageKey: "story_score" },
        };
        const document = baseDocument({ "score-decl": scoreRow }, ["score-decl"]);
        const compiled = await compileStudioStoryToNlr({
            document,
            sceneId: "scene-1",
            characters: [],
            persistentVariables: {
                bp_score: { id: "bp_score", name: "Score", valueType: "number", storageKey: "bp_score" },
            },
        });
        expect(compiled.diagnostics).toContainEqual({
            level: "warning",
            blockId: undefined,
            message: 'Persistent variable "Score" is declared in both the variable registry and a story row; references are ambiguous.',
        });
    });
});

describe("dialog avatars", () => {
    /** Read the avatar strategy the compiler installed, the way the engine's `useAvatar` does. */
    function resolveAvatar(
        compiled: Awaited<ReturnType<typeof compileStudioStoryToNlr>>,
        characterId: string,
        context: { currentSrc?: string | null; tags?: string[] | null },
    ): string | null | undefined {
        // `Character.config` is `@internal` and stripped from the published types, so the probe
        // duck-types it the way `nlrDialogReaders` does. Production code never reads it - it only
        // calls the public `setAvatar`.
        const character = compiled.characters.get(characterId) as unknown as { config?: { avatar?: unknown } } | undefined;
        const avatar = character?.config?.avatar;
        if (typeof avatar !== "function") {
            return avatar as null | undefined;
        }
        return (avatar as (ctx: unknown) => string | null | undefined)({
            currentSrc: context.currentSrc ?? null,
            tags: context.tags ?? null,
        });
    }

    function enterBlock(characterId: string, tags?: Record<string, string>): Record<string, StoryBlock> {
        return {
            enter: {
                id: "enter",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "character", operation: "enter", characterId, ...(tags ? { tags } : {}) },
            },
        };
    }

    it("resolves a preset character's avatar from the pose src the engine reports", async () => {
        const alice: DevModeCharacterSummary = {
            id: "char-alice",
            name: "Alice",
            appearance: {
                kind: "preset",
                poses: [
                    { id: "pose-neutral", name: "Neutral", assetId: "asset-neutral" },
                    { id: "pose-angry", name: "Angry", assetId: "asset-angry" },
                ],
                defaultPoseId: "pose-neutral",
                avatars: {
                    "pose-neutral": { overrideAssetId: "asset-avatar-neutral" },
                    "pose-angry": { overrideAssetId: "asset-avatar-angry" },
                },
            },
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(enterBlock("char-alice"), ["enter"]),
            sceneId: "scene-1",
            characters: [alice],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        // The engine hands back the sprite currently on screen; the avatar has to follow it, not the
        // pose the row happened to name.
        expect(resolveAvatar(compiled, "char-alice", { currentSrc: "nlr://asset-angry" }))
            .toBe("nlr://asset-avatar-angry");
        expect(resolveAvatar(compiled, "char-alice", { currentSrc: "nlr://asset-neutral" }))
            .toBe("nlr://asset-avatar-neutral");
    });

    it("resolves a layered character's avatar from the active tags", async () => {
        const bob: DevModeCharacterSummary = {
            id: "char-bob",
            name: "Bob",
            appearance: {
                kind: "layered",
                canvas: { width: 100, height: 200 },
                axes: [{
                    id: "mood",
                    name: "Mood",
                    tags: [{ id: "happy", name: "Happy" }, { id: "sad", name: "Sad" }],
                    defaultTagId: "happy",
                }],
                layers: [{ id: "face", name: "Face", axisId: "mood", options: { happy: "asset-happy", sad: "asset-sad" } }],
                avatars: {
                    happy: { overrideAssetId: "asset-avatar-happy" },
                    sad: { overrideAssetId: "asset-avatar-sad" },
                },
            },
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(enterBlock("char-bob"), ["enter"]),
            sceneId: "scene-1",
            characters: [bob],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        // A layered image has no single src, so the engine reports tags instead of a URL.
        expect(resolveAvatar(compiled, "char-bob", { tags: ["sad"] })).toBe("nlr://asset-avatar-sad");
        expect(resolveAvatar(compiled, "char-bob", { tags: ["happy"] })).toBe("nlr://asset-avatar-happy");
    });

    it("falls back to the character default when the speaker has no differential on stage", async () => {
        const alice: DevModeCharacterSummary = {
            id: "char-alice",
            name: "Alice",
            defaultAvatarAssetId: "asset-avatar-default",
            appearance: {
                kind: "preset",
                poses: [{ id: "pose-neutral", name: "Neutral", assetId: "asset-neutral" }],
                defaultPoseId: "pose-neutral",
                avatars: { "pose-neutral": { overrideAssetId: "asset-avatar-neutral" } },
            },
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(enterBlock("char-alice"), ["enter"]),
            sceneId: "scene-1",
            characters: [alice],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        // No portrait on stage: the engine reports neither a src nor tags.
        expect(resolveAvatar(compiled, "char-alice", {})).toBe("nlr://asset-avatar-default");
        // A src the appearance does not know (a sprite swapped by an `/image` row) is not guessed at.
        expect(resolveAvatar(compiled, "char-alice", { currentSrc: "nlr://asset-stranger" }))
            .toBe("nlr://asset-avatar-default");
    });

    it("answers null rather than substituting the sprite when nothing resolves", async () => {
        const alice: DevModeCharacterSummary = {
            id: "char-alice",
            name: "Alice",
            appearance: {
                kind: "preset",
                poses: [{ id: "pose-neutral", name: "Neutral", assetId: "asset-neutral" }],
                defaultPoseId: "pose-neutral",
            },
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(enterBlock("char-alice"), ["enter"]),
            sceneId: "scene-1",
            characters: [alice],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        expect(resolveAvatar(compiled, "char-alice", { currentSrc: "nlr://asset-neutral" })).toBeNull();
    });

    it("preloads every avatar it can answer with", async () => {
        const alice: DevModeCharacterSummary = {
            id: "char-alice",
            name: "Alice",
            defaultAvatarAssetId: "asset-avatar-default",
            appearance: {
                kind: "preset",
                poses: [{ id: "pose-neutral", name: "Neutral", assetId: "asset-neutral" }],
                defaultPoseId: "pose-neutral",
                avatars: { "pose-neutral": { overrideAssetId: "asset-avatar-neutral" } },
            },
        };
        const compiled = await compileStudioStoryToNlr({
            document: baseDocument(enterBlock("char-alice"), ["enter"]),
            sceneId: "scene-1",
            characters: [alice],
            resolveAssetUrl: async assetId => `nlr://${assetId}`,
        });

        // The engine's preloader cannot see inside a resolver closure, so an avatar that is not
        // registered here is fetched mid-dialog - the flash this whole path exists to avoid.
        const srcManager = (compiled.scene as unknown as { srcManager: { src: { type: string; src: unknown }[] } }).srcManager;
        const preloaded = srcManager.src.filter(entry => entry.type === "image").map(entry => entry.src);
        expect(preloaded).toEqual(expect.arrayContaining(["nlr://asset-avatar-neutral", "nlr://asset-avatar-default"]));
    });
});
