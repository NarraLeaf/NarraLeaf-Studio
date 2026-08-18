import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";

/**
 * The two `/fx` operations: `backdrop` (CSS backdrop-filter, the
 * frosted-glass knob) and `blend` (mix-blend-mode, restricted to NLR's six curated modes). Both reuse
 * the existing `displayableEffect` shape, so this only pins their compiled OUTPUT: the property the
 * engine call carries, and the shared duration floor every effect option passes through.
 */

function imageDocument(blocks: Record<string, StoryBlock>, rootBlockIds: string[]): StoryDocument {
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
                    show: { id: "show", kind: "action", parentId: null, childrenIds: [], payload: { action: "image", operation: "show", objectName: "hero" } },
                    ...blocks,
                },
            },
        },
    };
}

function effectBlock(id: string, payload: Extract<StoryBlock["payload"], { action: "displayable" }>): StoryBlock {
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

function transformsOf(actions: any[]): { sequences?: { props?: Record<string, unknown>; options?: Record<string, unknown> }[] }[] {
    return actions
        .filter(action => action?.type === "displayable:applyTransform")
        .flatMap(action => {
            const transform = action.contentNode?.getContent?.()[0] as { sequences?: { props?: Record<string, unknown>; options?: Record<string, unknown> }[] } | undefined;
            return transform ? [transform] : [];
        });
}

describe("compiles /fx backdrop and blend", () => {
    it("carries the backdrop-filter through and floors a negative duration to 0", async () => {
        const document = imageDocument(
            {
                // A negative duration is the clamp probe: `effectVisualOptions` floors it to 0, the same
                // `Math.max(0, ...)` every effect option shares - no effect gets to run time backwards.
                frost: effectBlock("frost", {
                    action: "displayable",
                    operation: "backdrop",
                    target: { name: "hero", kind: "image" },
                    backdropFilter: "blur(8px)",
                    durationMs: -100,
                }),
            },
            ["frost"],
        );

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([]);

        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "frost")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const sequence = transformsOf(actions)[0]?.sequences?.[0];
        expect(sequence?.props).toEqual(expect.objectContaining({ backdropFilter: "blur(8px)" }));
        expect(sequence?.options).toEqual(expect.objectContaining({ duration: 0 }));
    });

    it("carries a curated blend mode through", async () => {
        const document = imageDocument(
            {
                blend: effectBlock("blend", {
                    action: "displayable",
                    operation: "blend",
                    target: { name: "hero", kind: "image" },
                    mixBlendMode: "screen",
                    durationMs: 200,
                }),
            },
            ["blend"],
        );

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([]);

        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "blend")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const sequence = transformsOf(actions)[0]?.sequences?.[0];
        expect(sequence?.props).toEqual(expect.objectContaining({ mixBlendMode: "screen" }));
        expect(sequence?.options).toEqual(expect.objectContaining({ duration: 200 }));
    });

    it("warns and emits nothing when a backdrop op has no filter string", async () => {
        const document = imageDocument(
            { empty: effectBlock("empty", { action: "displayable", operation: "backdrop", target: { name: "hero", kind: "image" } }) },
            ["empty"],
        );

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([
            { level: "warning", blockId: "empty", message: "Backdrop effect has no CSS backdrop-filter." },
        ]);
    });
});

/**
 * A camera grade lands in one frame, and clearing one does too.
 *
 * This is not a style preference: a filter chain carrying `hue-rotate` cannot be eased to or from
 * neutral without walking the picture through colours nobody chose. Measured over the moonlight
 * grade on a real sprite, the browser's own interpolation goes blue → cyan → green → olive, because
 * the angle unwinds 185 degrees while `grayscale` simultaneously lets the source's hues back in.
 * This pins the fix so a later "make the grade fade nicely" change has to face the reason.
 * Ending a grade is the engine's problem and is fixed there (narraleaf-react 0.29.0).
 */
describe("compiles a camera grade as a cut", () => {
    function cameraDocument(blocks: Record<string, StoryBlock>, rootBlockIds: string[]): StoryDocument {
        return {
            schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
            id: "story-1",
            name: "Story",
            chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
            scenes: { "scene-1": { id: "scene-1", name: "Scene 1", runtimeName: "Scene 1", rootBlockIds, blocks } },
        };
    }

    it("ignores the row's duration and applies the grade over 0ms", async () => {
        const document = cameraDocument({
            grade: {
                id: "grade", kind: "action", parentId: null, childrenIds: [],
                // A duration an author might reasonably have typed. It must not reach the filter.
                payload: { action: "camera", operation: "look", lookPreset: "moonlight", lookIntensity: 1, durationMs: 900 },
            },
        }, ["grade"]);

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([]);

        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "grade")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const sequence = transformsOf(actions)[0]?.sequences?.[0];
        expect(String(sequence?.props?.filter)).toContain("hue-rotate");
        expect(sequence?.options).toEqual(expect.objectContaining({ duration: 0 }));
    });

});
