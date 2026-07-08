import { describe, expect, it } from "vitest";
import { DevTools } from "narraleaf-react";
import type { StoryAnimationAsset, StoryBlock, StoryDocument, StoryTransitionRef } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";

function baseDocument(blocks: Record<string, StoryBlock>, rootBlockIds: string[] = Object.keys(blocks)): StoryDocument {
    return {
        schemaVersion: 3,
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
                sceneVariables: {
                    locked: { id: "locked", name: "locked", valueType: "boolean", storageKey: "locked" },
                    started: { id: "started", name: "started", valueType: "boolean", storageKey: "started" },
                },
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
            characters: [{ id: "char-alice", name: "Alice" }],
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
                defaultForm: "base",
                forms: [{
                    name: "base",
                    groups: [{
                        name: "Expression",
                        defaultVariant: "Neutral",
                        variants: [{ name: "Neutral" }],
                    }],
                    variantAssets: {
                        Neutral: { assetId: "asset-alice-neutral" },
                    },
                }],
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
                defaultForm: "base",
                forms: [{
                    name: "base",
                    groups: [],
                    variantAssets: {
                        base: { assetId: "asset-alice" },
                    },
                }],
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
            characters: [{ id: "char-alice", name: "Alice" }],
        });

        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toContain("say");
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
            characters: [{ id: "char-alice", name: "Alice" }],
        });

        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.actionIdBindings.map(binding => binding.blockId)).toContain("say");
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

    it("maps the custom transition kinds onto real NLR transitions without diagnostics", async () => {
        // Each new kind must be handled by createTransition; an unmapped kind
        // falls through to a "not supported" diagnostic, which this guards against.
        const kinds: StoryTransitionRef["kind"][] = ["softWipe", "blinds", "slide", "softIris", "blurDissolve", "throughColor"];
        for (const kind of kinds) {
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
                        props: { pattern: "iris", color: "#000000", blur: 12, direction: "right", orientation: "vertical", slats: 6, feather: 20, hold: 40, center: "50% 50%" },
                    },
                },
            };
            const compiled = await compileStudioStoryToNlr({
                document: baseDocument({ bg }, ["bg"]),
                sceneId: "scene-1",
                resolveAssetUrl: async assetId => `nlr://${assetId}`,
            });
            expect(compiled.diagnostics, `kind=${kind}`).toEqual([]);
        }
    });
});
