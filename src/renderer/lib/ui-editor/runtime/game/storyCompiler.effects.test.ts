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
    it("carries the backdrop-filter through, in one frame", async () => {
        const document = imageDocument(
            {
                // A negative duration used to be the clamp probe here. Since v18 it cannot be: a
                // backdrop-filter is a DISCRETE channel, so the emitter gives it its own zero-duration
                // statement whatever the row asked for. The clamp still exists and is exercised by the
                // rows that do tween (see `floors a negative duration` below).
                frost: effectBlock("frost", {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                    transform: { mode: "props", to: { backdropFilter: "blur(8px)" }, durationMs: -100 },
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

    it("carries a curated blend mode through, in one frame", async () => {
        const document = imageDocument(
            {
                // The row may still say `d=0.2`; a blend mode has no midpoint between `screen` and
                // `multiply`, so the emitter cuts it and the duration is deliberately unused. The
                // previous model passed the 200 straight to `blend()`, which animated nothing and said
                // it was animating for a fifth of a second.
                blend: effectBlock("blend", {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                    transform: { mode: "props", to: { mixBlendMode: "screen" }, durationMs: 200 },
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
        expect(sequence?.options).toEqual(expect.objectContaining({ duration: 0 }));
    });

    it("floors a negative duration to 0 on the half that does tween", async () => {
        const document = imageDocument(
            {
                dim: effectBlock("dim", {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                    transform: { mode: "props", to: { opacity: 0.4 }, durationMs: -100 },
                }),
            },
            ["dim"],
        );

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([]);
        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "dim")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const sequence = transformsOf(actions)[0]?.sequences?.[0];
        expect(sequence?.props).toEqual(expect.objectContaining({ opacity: 0.4 }));
        expect(sequence?.options).toEqual(expect.objectContaining({ duration: 0 }));
    });

    it("emits nothing when the row states no prop at all", async () => {
        // The v17 shape of this test asserted a "Backdrop effect has no CSS backdrop-filter" warning,
        // because the operation promised a channel the payload had not filled in. A bag cannot make that
        // promise: an absent prop means "leave this as it stands", which is a complete instruction, so
        // the row compiles to nothing rather than to a complaint.
        const document = imageDocument(
            { empty: effectBlock("empty", { action: "displayable", operation: "transform", target: { name: "hero", kind: "image" } }) },
            ["empty"],
        );

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([]);
        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "empty")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        expect(transformsOf(actions)).toEqual([]);
    });
});

describe("one row, two statements: the cut lands before the tween", () => {
    it("drops the discrete half in its own zero-duration statement and eases the rest", async () => {
        // The shape `1e626400` arrived at for the camera, now the general rule. A row that both grades
        // and pushes in cannot be one transform: the grade has no midpoint worth rendering and the
        // zoom has nothing but midpoints, so they are separated rather than averaged into a duration
        // that is wrong for one of them.
        const document = imageDocument(
            {
                shot: effectBlock("shot", {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                    transform: { mode: "props", to: { zoom: 1.4, filterRaw: "sepia(1) hue-rotate(120deg)" }, durationMs: 800 },
                }),
            },
            ["shot"],
        );

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([]);

        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "shot")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const transforms = transformsOf(actions);
        expect(transforms).toHaveLength(2);
        expect(transforms[0]?.sequences?.[0]?.props).toEqual(expect.objectContaining({ filter: "sepia(1) hue-rotate(120deg)" }));
        expect(transforms[0]?.sequences?.[0]?.options).toEqual(expect.objectContaining({ duration: 0 }));
        expect(transforms[1]?.sequences?.[0]?.props).toEqual(expect.objectContaining({ zoom: 1.4 }));
        expect(transforms[1]?.sequences?.[0]?.options).toEqual(expect.objectContaining({ duration: 800 }));
    });

    it("eases a filter the row can name every function of, when no hue angle moves", async () => {
        // Deliberately finer than "a filter always cuts": dimming the character who is not speaking is
        // `brightness` 1 -> 0.6, nothing walks the colour wheel, and fading it is what was asked for.
        const document = imageDocument(
            {
                dim: effectBlock("dim", {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                    transform: { mode: "props", to: { filter: { brightness: 0.6 } }, durationMs: 200 },
                }),
            },
            ["dim"],
        );

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "dim")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const transforms = transformsOf(actions);
        expect(transforms).toHaveLength(1);
        expect(transforms[0]?.sequences?.[0]?.props).toEqual(expect.objectContaining({ filter: "brightness(0.6)" }));
        expect(transforms[0]?.sequences?.[0]?.options).toEqual(expect.objectContaining({ duration: 200 }));
    });

    it("passes the delay and the repeat the engine has always taken and Studio never sent", async () => {
        const document = imageDocument(
            {
                pulse: effectBlock("pulse", {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                    transform: { mode: "props", to: { opacity: 0.2 }, durationMs: 300, delayMs: 150, repeat: 3, repeatDelayMs: 50 },
                }),
            },
            ["pulse"],
        );

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "pulse")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const transform = transformsOf(actions)[0];
        expect(transform?.sequences?.[0]?.options).toEqual(expect.objectContaining({ duration: 300, delay: 150 }));
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
                payload: {
                    action: "camera",
                    operation: "transform",
                    transform: { mode: "props", to: { look: { preset: "moonlight", intensity: 1 } }, durationMs: 900 },
                },
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
