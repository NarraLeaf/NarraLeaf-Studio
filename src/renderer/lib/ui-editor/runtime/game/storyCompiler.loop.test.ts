import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";

/**
 * `/transform … loop` and `/transform … stopLoop` — the two rows that do not settle.
 *
 * What is pinned here is the shape of the emitted call rather than the picture, because the picture
 * is the engine's: a loop is ONE `Transform` handed to `Displayable.loop`, never the two-statement
 * chain the settled emitter is free to produce, and the row's direction and gap ride the call's own
 * options rather than the transform's config. The channels that cannot interpolate are named in a
 * diagnostic instead of being stored, which is the difference between "this row does nothing" and
 * "this row does nothing and says so".
 */

function loopDocument(blocks: Record<string, StoryBlock>, rootBlockIds: string[]): StoryDocument {
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
                rootBlockIds: ["show", ...rootBlockIds],
                blocks: {
                    show: {
                        id: "show",
                        kind: "action",
                        parentId: null,
                        childrenIds: [],
                        payload: { action: "image", operation: "create", objectName: "hero", assetId: "asset-hero" },
                    },
                    ...blocks,
                },
            },
        },
    };
}

function block(id: string, payload: Extract<StoryBlock["payload"], { action: "displayable" }>): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload };
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

async function compile(blocks: Record<string, StoryBlock>, rootBlockIds: string[], blockId: string) {
    const compiled = await compileStudioStoryToNlr({
        document: loopDocument(blocks, rootBlockIds),
        sceneId: "scene-1",
        resolveAssetUrl: async assetId => `nlr://${assetId}`,
    });
    const actions = compiled.actionIdBindings
        .filter(binding => binding.blockId === blockId)
        .flatMap(binding => collectActionTree(binding.action, compiled.story));
    return { result: compiled, actions };
}

/** The `[transform, options]` a `displayable:applyLoop` action carries. */
function loopCalls(actions: any[]): { sequences: any[]; options: Record<string, unknown> | undefined }[] {
    return actions
        .filter(action => action?.type === "displayable:applyLoop")
        .map(action => {
            const [transform, options] = action.contentNode?.getContent?.() ?? [];
            return { sequences: (transform as any)?.sequences ?? [], options };
        });
}

describe("compiles a looping transform", () => {
    it("hands the engine one Transform and its repeat direction", async () => {
        const { actions } = await compile({
            breathe: block("breathe", {
                action: "displayable",
                operation: "loop",
                target: { name: "hero" },
                transform: { to: { scaleY: 1.02 }, durationMs: 900, repeatType: "mirror" },
            }),
        }, ["breathe"], "breathe");

        const calls = loopCalls(actions);
        expect(calls).toHaveLength(1);
        expect(calls[0].sequences).toHaveLength(1);
        expect(calls[0].sequences[0].props).toMatchObject({ scaleY: 1.02 });
        expect(calls[0].sequences[0].options).toMatchObject({ duration: 900 });
        // The direction rides the CALL, not the transform: the engine forces `repeat: Infinity` on
        // the animation it builds, so a second copy on the transform's own config would only give
        // the two somewhere to disagree.
        expect(calls[0].options).toMatchObject({ repeatType: "mirror" });
    });

    it("turns a stated start into the first step, so the loop has two ends", async () => {
        const { actions } = await compile({
            breathe: block("breathe", {
                action: "displayable",
                operation: "loop",
                target: { name: "hero" },
                transform: { from: { scaleY: 1 }, to: { scaleY: 1.16 }, durationMs: 900 },
            }),
        }, ["breathe"], "breathe");

        const [call] = loopCalls(actions);
        expect(call.sequences).toHaveLength(2);
        expect(call.sequences[0].props).toMatchObject({ scaleY: 1 });
        expect(call.sequences[0].options).toMatchObject({ duration: 0 });
        expect(call.sequences[1].props).toMatchObject({ scaleY: 1.16 });
    });

    it("emits no statement, and says why, when the row states nothing to animate", async () => {
        const { result, actions } = await compile({
            empty: block("empty", { action: "displayable", operation: "loop", target: { name: "hero" }, transform: {} }),
        }, ["empty"], "empty");

        expect(loopCalls(actions)).toHaveLength(0);
        expect(result.diagnostics.some(entry => /nothing to animate/i.test(entry.message))).toBe(true);
    });

    it("names the channels a loop cannot move rather than storing them silently", async () => {
        // A blend mode is discrete: inside a loop it would sit at one value for ever while the author
        // watched for a change that could never come.
        const { result, actions } = await compile({
            pulse: block("pulse", {
                action: "displayable",
                operation: "loop",
                target: { name: "hero" },
                transform: { to: { opacity: 0.4, mixBlendMode: "screen" }, durationMs: 600 },
            }),
        }, ["pulse"], "pulse");

        const [call] = loopCalls(actions);
        expect(call.sequences[0].props).toMatchObject({ opacity: 0.4 });
        expect(call.sequences[0].props).not.toHaveProperty("mixBlendMode");
        expect(result.diagnostics.some(entry => /only animate channels that interpolate/i.test(entry.message))).toBe(true);
    });

    it("ends a loop with its own awaited call", async () => {
        const { actions } = await compile({
            stop: block("stop", {
                action: "displayable",
                operation: "stopLoop",
                target: { name: "hero" },
                transform: { durationMs: 300 },
            }),
        }, ["stop"], "stop");

        const stops = actions.filter(action => action?.type === "displayable:stopLoop");
        expect(stops).toHaveLength(1);
        expect(stops[0].contentNode?.getContent?.()[0]).toMatchObject({ duration: 300 });
    });
});
