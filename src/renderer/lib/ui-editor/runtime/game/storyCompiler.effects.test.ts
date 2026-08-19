import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";

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

    it("eases a grade that turns no hue, over the row's own duration", async () => {
        // The finer half of the same rule: `memory` moves saturate, sepia, brightness, contrast and
        // blur monotonically toward their targets and never touches the wheel, so the slide IS the
        // effect rather than decoration.
        const document = cameraDocument({
            grade: {
                id: "grade", kind: "action", parentId: null, childrenIds: [],
                payload: {
                    action: "camera",
                    operation: "transform",
                    transform: { mode: "props", to: { look: { preset: "memory", intensity: 1 } }, durationMs: 900 },
                },
            },
        }, ["grade"]);

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([]);
        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "grade")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const sequence = transformsOf(actions)[0]?.sequences?.[0];
        expect(String(sequence?.props?.filter)).not.toContain("hue-rotate");
        expect(sequence?.options).toEqual(expect.objectContaining({ duration: 900 }));
    });

    it("plays a lens gesture as its three legs, ending with the channel back at rest", async () => {
        const document = cameraDocument({
            wink: {
                id: "wink", kind: "action", parentId: null, childrenIds: [],
                payload: {
                    action: "camera",
                    operation: "transform",
                    transform: { mode: "props", to: { lens: { preset: "blink" } } },
                },
            },
        }, ["wink"]);

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics).toEqual([]);
        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "wink")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const sequences = transformsOf(actions)[0]?.sequences ?? [];
        // In, hold, out - the library's own timings, and the last leg opens the eyes again: a gesture
        // leaves no residue, which is what tells it apart from `shutter=1`.
        expect(sequences.map(sequence => sequence.options?.duration)).toEqual([180, 100, 220]);
        expect(sequences.map(sequence => sequence.props?.shutter)).toEqual([1, 1, 0]);
        // Every leg names the same props: a browser interpolates two keyframes only when they match,
        // and a leg that dropped the colour because it had not changed would make the next one snap.
        for (const sequence of sequences) {
            expect(sequence.props?.shutterColor).toBe("#000");
        }
    });

    it("still grades the stage from a row an older Studio wrote", async () => {
        // The other half of the chain the bundle assembler starts: bytes as v17 left them, through
        // the ladder, to the statement that puts the grade on the camera. The two halves together
        // are the path a story actually takes - disk, bundle, compile, stage - and this end is the
        // one that says the answer is a FILTER rather than merely a payload of the right shape.
        const legacy = {
            schemaVersion: 17,
            id: "story-1",
            name: "Story",
            chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
            scenes: {
                "scene-1": {
                    id: "scene-1",
                    name: "Scene 1",
                    runtimeName: "Scene 1",
                    rootBlockIds: ["grade"],
                    blocks: {
                        grade: {
                            id: "grade", kind: "action", parentId: null, childrenIds: [],
                            payload: {
                                action: "camera",
                                operation: "look",
                                lookPreset: "moonlight",
                                lookIntensity: 1,
                                durationMs: 1200,
                                easing: "easeInOut",
                            },
                        },
                    },
                },
            },
        } as unknown as StoryDocument;

        const compiled = await compileStudioStoryToNlr({
            document: migrateStoryDocumentToLatest(legacy),
            sceneId: "scene-1",
        });
        expect(compiled.diagnostics).toEqual([]);
        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "grade")
            .flatMap(binding => collectActionTree(binding.action, compiled.story));
        const sequence = transformsOf(actions)[0]?.sequences?.[0];
        // The recipe itself, and in one frame: moonlight turns a hue, so it cuts. A row that reaches
        // the compiler unmigrated produces no statement here at all, which is the whole defect.
        expect(String(sequence?.props?.filter)).toContain("hue-rotate(185deg)");
        expect(sequence?.options).toEqual(expect.objectContaining({ duration: 0 }));
    });

    it("reports a camera row carrying no transform, rather than compiling to nothing", async () => {
        // How the grade went missing: a document that reached the compiler at a pre-v19 schema spells
        // its camera rows as an operation plus that operation's own fields, so `payload.transform` is
        // absent - and the row used to fall through to an empty statement list. Nothing plays, nothing
        // is said, and the scene steps past it exactly as if the row had graded the stage. Every
        // authoring path writes a ref, so this shape only arrives from a document that skipped its
        // migration, and the compiler is the last place that can still say so.
        const document = cameraDocument({
            grade: {
                id: "grade", kind: "action", parentId: null, childrenIds: [],
                payload: { action: "camera", operation: "transform" },
            },
        }, ["grade"]);

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics.map(diagnostic => diagnostic.level)).toEqual(["warning"]);
        expect(compiled.actionIdBindings.filter(binding => binding.blockId === "grade")).toHaveLength(0);
    });

    it("reports a lens gesture the library does not know, rather than playing a different one", async () => {
        const document = cameraDocument({
            wink: {
                id: "wink", kind: "action", parentId: null, childrenIds: [],
                payload: {
                    action: "camera",
                    operation: "transform",
                    transform: { mode: "props", to: { lens: { preset: "wobble" } } },
                },
            },
        }, ["wink"]);

        const compiled = await compileStudioStoryToNlr({ document, sceneId: "scene-1" });
        expect(compiled.diagnostics.map(diagnostic => diagnostic.level)).toEqual(["warning"]);
    });

});
