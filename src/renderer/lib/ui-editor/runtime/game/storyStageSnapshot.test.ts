import { describe, expect, it } from "vitest";
import type { StoryAnimationAsset, StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { declaredPersistentDefaults } from "@shared/variables/mergedPersistentView";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { computeStoryStageSnapshot, resolveTakenConditionBranch } from "./storyStageSnapshot";

function baseDocument(blocks: Record<string, StoryBlock>, rootBlockIds: string[] = Object.keys(blocks)): StoryDocument {
    // v6: the scene variable is a declaration ROW in the block tree, not a registry entry.
    const flagDeclaration: StoryBlock = {
        id: "flag",
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: { scope: "scene", name: "flag", valueType: "boolean", defaultValue: false, storageKey: "flag" },
    };
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
                rootBlockIds: ["flag", ...rootBlockIds],
                blocks: { flag: flagDeclaration, ...blocks },
            },
        },
    };
}

function block(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const say = (id: string, parentId: string | null = null, childrenIds: string[] = []) =>
    block(id, "nodeAction", { action: "narration", text: { textId: `${id}-text`, value: "Text", role: "narration" } }, parentId, childrenIds);

function snapshot(document: StoryDocument, targetBlockId: string | null, animations?: Record<string, StoryAnimationAsset>) {
    return computeStoryStageSnapshot({ document, sceneId: "scene-1", targetBlockId, animations });
}

describe("computeStoryStageSnapshot", () => {
    it("returns an empty snapshot for the scene start", () => {
        const document = baseDocument({
            bg: block("bg", "action", { action: "setBackground", assetId: "asset-bg" }),
        }, ["bg"]);
        const result = snapshot(document, null);
        expect(result.background).toBeNull();
        expect(result.displayables).toEqual([]);
        expect(result.diagnostics).toEqual([]);
    });

    it("accumulates the last background before the target", () => {
        const document = baseDocument({
            "bg-1": block("bg-1", "action", { action: "setBackground", assetId: "asset-1" }),
            "bg-2": block("bg-2", "action", { action: "setBackground", assetId: "asset-2", transition: { kind: "dissolve", durationMs: 300 } }),
            target: say("target"),
        }, ["bg-1", "bg-2", "target"]);
        const result = snapshot(document, "target");
        expect(result.background).toEqual({ assetId: "asset-2" });
    });

    it("computes character enter/exit visibility and settled show props", () => {
        const document = baseDocument({
            enter: block("enter", "action", {
                action: "character",
                operation: "enter",
                characterId: "char-alice",
                transform: { mode: "props", to: { position: { xalign: 0.5, yalign: 0.5, xoffset: 24 }, zoom: 0.5 }, durationMs: 300 },
            }),
            "target-1": say("target-1"),
            exit: block("exit", "action", { action: "character", operation: "exit", characterId: "char-alice" }),
            "target-2": say("target-2"),
        }, ["enter", "target-1", "exit", "target-2"]);

        const atTarget1 = snapshot(document, "target-1");
        expect(atTarget1.displayables).toHaveLength(1);
        const alice = atTarget1.displayables[0];
        expect(alice.kind).toBe("image");
        expect(alice.objectName).toBe("char-alice");
        expect(alice.visible).toBe(true);
        // A sprite is drawn at its artwork's pixels: `autoFit` is what a picture covering the stage
        // asks for, and a character never does.
        expect(alice.autoFit).toBeFalsy();
        expect(alice.source).toEqual({ type: "character", characterId: "char-alice", pose: undefined, tags: undefined });
        expect(alice.props).toEqual(expect.objectContaining({
            opacity: 1,
            zoom: 0.5,
            position: expect.objectContaining({ xalign: 0.5, yalign: 0.5, xoffset: 24 }),
        }));

        const atTarget2 = snapshot(document, "target-2");
        expect(atTarget2.displayables[0].visible).toBe(false);
        expect(atTarget2.displayables[0].props.opacity).toBe(0);
    });

    it("leaves the portrait alone across a /rename", () => {
        // `setName` retitles the speaker label and nothing else. It used to fall into the
        // enter/expression arm, which rebuilds `source` from a payload it never carries - so a
        // `/rename` after a `/face` silently reverted the character to their default look in a
        // row-precise launch, which is the one place this snapshot is the whole truth.
        const document = baseDocument({
            enter: block("enter", "action", { action: "character", operation: "enter", characterId: "char-alice" }),
            face: block("face", "action", { action: "character", operation: "expression", characterId: "char-alice", pose: "pose-angry" }),
            rename: block("rename", "action", { action: "character", operation: "setName", characterId: "char-alice", displayName: "Alice" }),
            target: say("target"),
        }, ["enter", "face", "rename", "target"]);

        const result = snapshot(document, "target");
        expect(result.displayables).toHaveLength(1);
        const alice = result.displayables[0];
        expect(alice.visible).toBe(true);
        expect(alice.source).toEqual({ type: "character", characterId: "char-alice", pose: "pose-angry", tags: undefined });
    });

    it("does not conjure a stage record for a character only ever renamed", () => {
        // `setName` settles no stage state, so it must not even reserve a displayable - otherwise
        // "？？？" becoming a name would put a blank portrait in the preview.
        const document = baseDocument({
            rename: block("rename", "action", { action: "character", operation: "setName", characterId: "char-bob", displayName: "Bob" }),
            target: say("target"),
        }, ["rename", "target"]);
        expect(snapshot(document, "target").displayables).toEqual([]);
    });

    it("warns that a /vfx overlay is not previewed, as it does for a video", () => {
        // An ambience overlay is a real visual the snapshot cannot settle. Silence would leave the
        // author reading a row-precise launch as complete when a layer of it is simply missing.
        const document = baseDocument({
            rain: block("rain", "action", { action: "vfx", operation: "create", objectName: "rain", assetId: "asset-rain" }),
            clip: block("clip", "action", { action: "video", operation: "create", objectName: "intro", assetId: "asset-intro" }),
            target: say("target"),
        }, ["rain", "clip", "target"]);
        const result = snapshot(document, "target");
        expect(result.diagnostics).toEqual([
            { level: "warning", blockId: "rain", message: "Ambience effects are not previewed." },
            { level: "warning", blockId: "clip", message: "Videos are not previewed." },
        ]);
    });

    it("records the settled camera pose before the target and clamps degenerate values", () => {
        // The stage camera is a story-level singleton whose pose the runtime carries into a
        // row-precise launch. A launch that pre-poses everything else but leaves the camera neutral
        // shows the author a shot the real playthrough never had. Clamping mirrors the compiler,
        // because the pose is pre-posed straight onto the camera, bypassing compileCameraAction.
        const document = baseDocument({
            zoom: block("zoom", "action", { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 0 } } }),
            pan: block("pan", "action", { action: "camera", operation: "transform", transform: { mode: "props", to: { position: { xalign: 0.25, yalign: 0.5 } } } }),
            rotate: block("rotate", "action", { action: "camera", operation: "transform", transform: { mode: "props", to: { rotation: 15 } } }),
            dark: block("dark", "action", { action: "camera", operation: "transform", transform: { mode: "props", to: { filter: { brightness: -1 } } } }),
            target: say("target"),
        }, ["zoom", "pan", "rotate", "dark", "target"]);
        const result = snapshot(document, "target");
        expect(result.diagnostics).toEqual([]);
        // zoom 0 → the 0.05 floor; a brightness below 0 → the darkness channel's 0-1 ceiling.
        //
        // The grade lands in BOTH halves, exactly as a displayable's does: `props` is what the
        // pre-pose writes and `effects` is the residual pass that re-applies it through the engine's
        // own `darken`, which runs second and wins. Two spellings of one value, not two values.
        expect(result.camera).toEqual({
            props: {
                zoom: 0.05,
                position: expect.objectContaining({ xalign: 0.25, yalign: 0.5 }),
                rotation: 15,
                filter: "brightness(0)",
            },
            effects: { darkness: 1, filter: undefined },
        });
    });

    it("lets the latest camera op on a channel win and drops the pose on reset", () => {
        const later = baseDocument({
            first: block("first", "action", { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 2 } } }),
            second: block("second", "action", { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 3 } } }),
            target: say("target"),
        }, ["first", "second", "target"]);
        expect(snapshot(later, "target").camera?.props.zoom).toBe(3);

        const reset = baseDocument({
            zoom: block("zoom", "action", { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 2 } } }),
            reset: block("reset", "action", { action: "camera", operation: "reset" }),
            target: say("target"),
        }, ["zoom", "reset", "target"]);
        expect(snapshot(reset, "target").camera).toBeNull();
    });

    it("leaves the camera pose null when no /camera runs before the target", () => {
        const document = baseDocument({ target: say("target") }, ["target"]);
        expect(snapshot(document, "target").camera).toBeNull();
    });

    it("merges successive transforms with position-aware semantics", () => {
        const document = baseDocument({
            show: block("show", "action", { action: "image", operation: "show", objectName: "hero", transform: { mode: "props", to: { position: { xalign: 0.25, yalign: 0.5 } }, durationMs: 200 } }),
            move: block("move", "action", {
                action: "displayable",
                operation: "transform",
                target: { name: "hero", kind: "image" },
                transform: { mode: "props", to: { position: { xalign: 0.5, yalign: 0.8 } }, durationMs: 200 },
            }),
            target: say("target"),
        }, ["show", "move", "target"]);
        const result = snapshot(document, "target");
        const hero = result.displayables[0];
        // The later "custom" preset resolves xalign to its 0.5 default (matching the live
        // compile path, where target.pos() always receives a full alignment) and overrides
        // the earlier "left" preset; yalign comes from the move's explicit prop.
        expect(hero.props.position).toEqual(expect.objectContaining({ xalign: 0.5, yalign: 0.8 }));
        expect(hero.props.opacity).toBe(1);
    });

    it("computes animation-mode final props from merged sequences", () => {
        const animation: StoryAnimationAsset = {
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000201",
            name: "Slide",
            targetKind: "image",
            sequences: [
                { id: "s1", props: { position: { xalign: 0.2, yalign: 0.5 }, opacity: 0.4 }, options: { durationMs: 200 } },
                { id: "s2", props: { position: { xalign: 0.6 }, zoom: 1.2 }, options: { durationMs: 200 } },
            ],
        };
        const document = baseDocument({
            show: block("show", "action", { action: "image", operation: "show", objectName: "hero", transform: { mode: "animation", animationId: animation.id } }),
            target: say("target"),
        }, ["show", "target"]);
        const result = snapshot(document, "target", { [animation.id]: animation });
        const hero = result.displayables[0];
        expect(hero.props).toEqual(expect.objectContaining({
            zoom: 1.2,
            // Show visibility default folds into the last sequence.
            opacity: 1,
            position: expect.objectContaining({ xalign: 0.6, yalign: 0.5 }),
        }));
    });

    it("evaluates prefix conditions statically against tracked variables", () => {
        const document = baseDocument({
            set: block("set", "action", { action: "setVariable", target: { scope: "scene", variableId: "flag" }, value: true }),
            condition: block("condition", "control", { control: "condition" }, null, ["if-branch", "else-branch"]),
            "if-branch": block("if-branch", "control", {
                control: "conditionBranch",
                branch: "if",
                condition: { kind: "variable", target: { scope: "scene", variableId: "flag" }, operator: "isTrue" },
            }, "condition", ["show-if"]),
            "else-branch": block("else-branch", "control", { control: "conditionBranch", branch: "else" }, "condition", ["show-else"]),
            "show-if": block("show-if", "action", { action: "image", operation: "show", objectName: "if-img" }, "if-branch"),
            "show-else": block("show-else", "action", { action: "image", operation: "show", objectName: "else-img" }, "else-branch"),
            target: say("target"),
        }, ["set", "condition", "target"]);

        const withSet = snapshot(document, "target");
        expect(withSet.displayables.map(d => d.objectName)).toEqual(["if-img"]);
        expect(withSet.sceneVariables).toEqual({ flag: true });

        // Without the assignment, the else branch runs (default false).
        const withoutSet = { ...document, scenes: { "scene-1": { ...document.scenes["scene-1"], rootBlockIds: ["condition", "target"] } } };
        const elseResult = snapshot(withoutSet as StoryDocument, "target");
        expect(elseResult.displayables.map(d => d.objectName)).toEqual(["else-img"]);
    });

    it("degrades visited / picked / invoke to their zero AND says so", () => {
        // The preview has no playthrough behind it and no ScriptCtx to run a graph with, so all three
        // read as their zero. Asserting the DIAGNOSTIC is the whole point of the test: a silent zero
        // is indistinguishable from the expression having genuinely evaluated to it, which is how
        // "the preview is lying" becomes "the feature is broken".
        const document = baseDocument({
            set: block("set", "action", {
                action: "setVariable",
                target: { scope: "scene", variableId: "flag" },
                expression: { source: "bonus()", ast: { kind: "invoke", blueprintId: "bp1", name: "bonus" } },
            }),
            condition: block("condition", "control", { control: "condition" }, null, ["if-branch", "else-branch"]),
            "if-branch": block("if-branch", "control", {
                control: "conditionBranch",
                branch: "if",
                condition: {
                    kind: "expression",
                    expression: {
                        source: "visited(序章)",
                        ast: { kind: "visited", target: { kind: "scene", sceneId: "sc_prologue" }, name: "序章" },
                    },
                },
            }, "condition", ["show-if"]),
            "else-branch": block("else-branch", "control", { control: "conditionBranch", branch: "else" }, "condition", ["show-else"]),
            "show-if": block("show-if", "action", { action: "image", operation: "show", objectName: "if-img" }, "if-branch"),
            "show-else": block("show-else", "action", { action: "image", operation: "show", objectName: "else-img" }, "else-branch"),
            target: say("target"),
        }, ["set", "condition", "target"]);

        const result = snapshot(document, "target");
        // `visited(…)` read false, so the else branch ran; `bonus()` read empty, so the assignment
        // wrote null rather than a number the author would then chase.
        expect(result.displayables.map(d => d.objectName)).toEqual(["else-img"]);
        expect(result.sceneVariables).toEqual({ flag: null });
        expect(result.diagnostics).toEqual([
            {
                level: "warning",
                blockId: "set",
                message: "Blueprint `bonus()` does not run in the preview; it reads as empty.",
            },
            {
                level: "warning",
                blockId: "if-branch",
                message: "Scene visits are not tracked in the preview; `visited(序章)` reads as false.",
            },
        ]);
    });

    it("takes the branch containing the target and skips earlier un-taken choices", () => {
        const document = baseDocument({
            "early-choice": block("early-choice", "nodeAction", { action: "choice" }, null, ["early-option"]),
            "early-option": block("early-option", "nodeAction", { action: "choiceOption", text: { textId: "t1", value: "A", role: "choiceText" } }, "early-choice", ["early-show"]),
            "early-show": block("early-show", "action", { action: "image", operation: "show", objectName: "early" }, "early-option"),
            choice: block("choice", "nodeAction", { action: "choice" }, null, ["option-1", "option-2"]),
            "option-1": block("option-1", "nodeAction", { action: "choiceOption", text: { textId: "t2", value: "L", role: "choiceText" } }, "choice", ["show-1"]),
            "option-2": block("option-2", "nodeAction", { action: "choiceOption", text: { textId: "t3", value: "R", role: "choiceText" } }, "choice", ["show-2", "target"]),
            "show-1": block("show-1", "action", { action: "image", operation: "show", objectName: "left-img" }, "option-1"),
            "show-2": block("show-2", "action", { action: "image", operation: "show", objectName: "right-img" }, "option-2"),
            target: say("target", "option-2"),
        }, ["early-choice", "choice"]);

        const result = snapshot(document, "target");
        expect(result.displayables.map(d => d.objectName)).toEqual(["right-img"]);
        expect(result.diagnostics).toEqual([
            { level: "warning", blockId: "early-choice", message: "Preview assumes no branch of this earlier choice was taken." },
        ]);
    });

    it("leaves the pose alone for a loop and for the row that ends it", () => {
        // The engine's own rule, and the reason this snapshot can honour it: a looping transform
        // never writes the element's transform state, so the settled pose - what a save records and
        // what "play from this row" starts from - stays the one the element had before it started.
        const document = baseDocument({
            show: block("show", "action", { action: "image", operation: "show", objectName: "hero", transform: { mode: "props", to: { zoom: 1.5 } } }),
            breathe: block("breathe", "action", {
                action: "displayable",
                operation: "loop",
                target: { name: "hero", kind: "image" },
                transform: { mode: "props", to: { zoom: 3, scaleY: 1.2 }, durationMs: 900 },
            }),
            stop: block("stop", "action", {
                action: "displayable",
                operation: "stopLoop",
                target: { name: "hero", kind: "image" },
                transform: { durationMs: 300 },
            }),
            target: say("target"),
        }, ["show", "breathe", "stop", "target"]);

        const hero = snapshot(document, "target").displayables[0];
        expect(hero.props.zoom).toBe(1.5);
        expect(hero.props.scaleY).toBeUndefined();
        // The binding is not the pose, and it IS state at this row - so it is remembered, which is
        // what makes "play from this row" and "save at this row" describe the same stage. Here the
        // row after the loop ended it, so there is nothing to carry.
        expect(hero.loop).toBeUndefined();
    });

    it("carries a running loop so a launch reopens on it", () => {
        const document = baseDocument({
            show: block("show", "action", { action: "image", operation: "show", objectName: "hero" }),
            breathe: block("breathe", "action", {
                action: "displayable",
                operation: "loop",
                target: { name: "hero", kind: "image" },
                transform: { mode: "props", to: { scaleY: 1.02 }, durationMs: 900, repeatType: "mirror" },
            }),
            target: say("target"),
        }, ["show", "breathe", "target"]);

        const hero = snapshot(document, "target").displayables[0];
        expect(hero.loop).toMatchObject({ to: { scaleY: 1.02 }, durationMs: 900, repeatType: "mirror" });
        // Still no pose: the loop's peak must not become the settled state.
        expect(hero.props.scaleY).toBeUndefined();
    });

    it("drops the loop when a later transform takes the element back", () => {
        // One transform at a time - the engine clears the binding on any authored transform, so a
        // snapshot that kept it would restart a motion the row had just taken over from.
        const document = baseDocument({
            show: block("show", "action", { action: "image", operation: "show", objectName: "hero" }),
            breathe: block("breathe", "action", {
                action: "displayable",
                operation: "loop",
                target: { name: "hero", kind: "image" },
                transform: { mode: "props", to: { scaleY: 1.02 }, durationMs: 900 },
            }),
            move: block("move", "action", {
                action: "displayable",
                operation: "transform",
                target: { name: "hero", kind: "image" },
                transform: { mode: "props", to: { zoom: 2 }, durationMs: 200 },
            }),
            target: say("target"),
        }, ["show", "breathe", "move", "target"]);

        const hero = snapshot(document, "target").displayables[0];
        expect(hero.loop).toBeUndefined();
        expect(hero.props.zoom).toBe(2);
    });

    it("tracks residual effects and their clears", () => {
        const document = baseDocument({
            show: block("show", "action", { action: "image", operation: "show", objectName: "hero" }),
            darken: block("darken", "action", { action: "displayable", operation: "transform", target: { name: "hero", kind: "image" }, transform: { mode: "props", to: { filter: { brightness: 0.4 } } } }),
            clip: block("clip", "action", { action: "displayable", operation: "transform", target: { name: "hero", kind: "image" }, transform: { mode: "props", to: { clipPath: "inset(10% 0)" } } }),
            reveal: block("reveal", "action", { action: "displayable", operation: "transform", target: { name: "hero", kind: "image" }, transform: { mode: "props", clipReveal: { kind: "circleReveal" } } }),
            target: say("target"),
        }, ["show", "darken", "clip", "reveal", "target"]);
        const result = snapshot(document, "target");
        const hero = result.displayables[0];
        expect(hero.effects.darkness).toBe(0.6);
        // circleReveal ends fully revealed, superseding the clip.
        expect(hero.effects.clip).toBe("clear");
    });

    it("accumulates built-in background transforms separately", () => {
        const document = baseDocument({
            zoom: block("zoom", "action", {
                action: "displayable",
                operation: "transform",
                target: { builtin: "background", kind: "image", name: "Scene background" },
                transform: { mode: "props", to: { zoom: 1.25 }, durationMs: 300 },
            }),
            target: say("target"),
        }, ["zoom", "target"]);
        const result = snapshot(document, "target");
        expect(result.backgroundProps).toEqual(expect.objectContaining({ zoom: 1.25 }));
        expect(result.displayables).toEqual([]);
    });

    it("flags nvl containers and layer records", () => {
        const document = baseDocument({
            layer: block("layer", "action", { action: "layer", operation: "create", objectName: "fg", zIndex: 5 }),
            "layer-move": block("layer-move", "action", {
                action: "layer",
                operation: "transform",
                objectName: "fg",
                target: { kind: "custom", sourceBlockId: "layer" },
                transform: { mode: "props", to: { position: { xalign: 0.5, yalign: 0.5, yoffset: -20 } }, durationMs: 100 },
            }),
            nvl: block("nvl", "action", { action: "nvl" }, null, ["target"]),
            target: say("target", "nvl"),
        }, ["layer", "layer-move", "nvl"]);
        const result = snapshot(document, "target");
        expect(result.nvl).toBe(true);
        const layer = result.displayables[0];
        expect(layer.kind).toBe("layer");
        expect(layer.zIndex).toBe(5);
        expect(layer.visible).toBe(true);
        expect(layer.props.position).toEqual(expect.objectContaining({ yoffset: -20 }));
    });

    it("previews the scene start with a diagnostic for unknown targets", () => {
        const document = baseDocument({
            bg: block("bg", "action", { action: "setBackground", assetId: "asset-1" }),
        }, ["bg"]);
        const result = snapshot(document, "missing");
        expect(result.background).toBeNull();
        expect(result.diagnostics).toEqual([
            { level: "warning", blockId: "missing", message: "Preview target block not found; previewing the scene start instead." },
        ]);
    });

    /**
     * A character enter block carries no `objectName` until the author types one, so the portrait is
     * keyed on `characterId`. A displayable op that resolved the same block to the word "Character"
     * looked up an object that was never registered and silently did nothing.
     */
    it("applies a displayable effect to a character portrait that has no explicit stage name", () => {
        const document = baseDocument({
            enter: block("enter", "action", {
                action: "character",
                operation: "enter",
                characterId: "char-alice",
                assetId: "asset-alice",
                transform: { mode: "props", to: { position: { xalign: 0.5, yalign: 0.5 } } },
            }),
            darken: block("darken", "action", {
                action: "displayable",
                operation: "transform",
                target: { name: "Character", kind: "character", sourceBlockId: "enter" },
                transform: { mode: "props", to: { filter: { brightness: 0.4 } } },
            }),
            target: say("target"),
        }, ["enter", "darken", "target"]);

        const result = snapshot(document, "target");

        expect(result.diagnostics).toEqual([]);
        expect(result.displayables).toHaveLength(1);
        expect(result.displayables[0].objectName).toBe("char-alice");
        expect(result.displayables[0].effects.darkness).toBe(0.6);
    });

    it("applies a displayable effect to an image whose stage name was cleared", () => {
        // Same divergence, non-character: an empty `objectName` keys on the compiler's "object"
        // fallback, not the display word "Image".
        const document = baseDocument({
            create: block("create", "action", { action: "image", operation: "create", objectName: "", assetId: "asset-x", transform: { mode: "props", to: { position: { xalign: 0.5, yalign: 0.5 } } } }),
            filter: block("filter", "action", {
                action: "displayable",
                operation: "transform",
                target: { name: "Image", kind: "image", sourceBlockId: "create" },
                transform: { mode: "props", to: { filter: { blur: 4 } } },
            }),
            target: say("target"),
        }, ["create", "filter", "target"]);

        const result = snapshot(document, "target");

        expect(result.diagnostics).toEqual([]);
        expect(result.displayables[0].effects.filter).toEqual({ filter: "blur(4px)" });
    });

    it("moves a raised element to the end of the creation order, and leaves everything else alone", () => {
        // `displayables` IS the stacking order: both the editor's scene preview and "play from this
        // row" build elements straight down this array, so a `/front` that did not move the entry
        // would produce a row that plays one way and previews another.
        const document = baseDocument({
            a: block("a", "action", { action: "image", operation: "show", objectName: "a" }),
            b: block("b", "action", { action: "image", operation: "show", objectName: "b" }),
            c: block("c", "action", { action: "image", operation: "show", objectName: "c" }),
            raise: block("raise", "action", {
                action: "displayable",
                operation: "bringToFront",
                target: { name: "b", kind: "image" },
            }),
            target: say("target"),
        }, ["a", "b", "c", "raise", "target"]);

        const result = snapshot(document, "target");

        expect(result.diagnostics).toEqual([]);
        expect(result.displayables.map(entry => entry.objectName)).toEqual(["a", "c", "b"]);
        // A raise states no pose and no visibility, so nothing else about the element may move.
        const raised = result.displayables[2];
        expect(raised.visible).toBe(true);
        expect(raised.props.opacity).toBe(1);
    });

    it("raising the element that is already on top changes nothing", () => {
        const document = baseDocument({
            a: block("a", "action", { action: "image", operation: "show", objectName: "a" }),
            b: block("b", "action", { action: "image", operation: "show", objectName: "b" }),
            raise: block("raise", "action", {
                action: "displayable",
                operation: "bringToFront",
                target: { name: "b", kind: "image" },
            }),
            target: say("target"),
        }, ["a", "b", "raise", "target"]);

        const result = snapshot(document, "target");

        expect(result.diagnostics).toEqual([]);
        expect(result.displayables.map(entry => entry.objectName)).toEqual(["a", "b"]);
    });
});

/**
 * A persistent variable is the one scope this walk cannot reconstruct: it outlives the run, so
 * "what does it hold at the target row" is a question only the host that owns the profile can
 * answer. It used to answer `undefined` regardless, which quietly sent every persistent condition
 * down its `else` - so a launch after a wardrobe choice pre-posed the outfit nobody picked, while
 * the tail, compiled against the real store a moment later, played the one they did.
 */
describe("computeStoryStageSnapshot and the host's persistent store", () => {
    const SOCKS = "socks";

    const persistentVariables = {
        [SOCKS]: { id: SOCKS, name: "Socks", scope: "persistent" as const, valueType: "number" as const, defaultValue: 0, storageKey: SOCKS },
    };

    /** Three arms, one per outfit, each showing its own image; the third is the `else`. */
    const document = baseDocument({
        condition: block("condition", "control", { control: "condition" }, null, ["arm-0", "arm-1", "arm-else"]),
        "arm-0": block("arm-0", "control", {
            control: "conditionBranch",
            branch: "if",
            condition: { kind: "variable", target: { scope: "persistent", variableId: SOCKS }, operator: "equals", value: 0 },
        }, "condition", ["cg-0"]),
        "arm-1": block("arm-1", "control", {
            control: "conditionBranch",
            branch: "if",
            condition: { kind: "variable", target: { scope: "persistent", variableId: SOCKS }, operator: "equals", value: 1 },
        }, "condition", ["cg-1"]),
        "arm-else": block("arm-else", "control", { control: "conditionBranch", branch: "else" }, "condition", ["cg-else"]),
        "cg-0": block("cg-0", "action", { action: "image", operation: "create", objectName: "cg0", assetId: "asset-0" }, "arm-0"),
        "cg-1": block("cg-1", "action", { action: "image", operation: "create", objectName: "cg1", assetId: "asset-1" }, "arm-1"),
        "cg-else": block("cg-else", "action", { action: "image", operation: "create", objectName: "cgElse", assetId: "asset-else" }, "arm-else"),
        target: say("target"),
    }, ["condition", "target"]);

    function onStage(readPersistent?: (key: string) => number | undefined): string[] {
        return computeStoryStageSnapshot({
            document,
            sceneId: "scene-1",
            targetBlockId: "target",
            persistentVariables,
            ...(readPersistent ? { readPersistent } : {}),
        }).displayables.map(record => record.objectName);
    }

    it("takes the arm the stored value selects", () => {
        expect(onStage(() => 1)).toEqual(["cg1"]);
    });

    it("reads the declared default for a key the store has never held", () => {
        // What the runtime reads there too - an unwritten persistent variable is its default, not
        // nothing, so the walk must not treat "unset" as "no arm matches". The default is the
        // store's answer, so the reader here is the scope a game builds, over a store holding nothing.
        const scope = new ScopeStoreBridge({ persistentDefaults: declaredPersistentDefaults({ ui: { persistentVariables } }) });
        expect(onStage(key => scope.persistenceGet(key) as number | undefined)).toEqual(["cg0"]);
    });

    it("takes the else arm when the stored value matches none of them", () => {
        expect(onStage(() => 7)).toEqual(["cgElse"]);
    });

    it("says so, and guesses nothing, when there is no store to ask", () => {
        const result = computeStoryStageSnapshot({ document, sceneId: "scene-1", targetBlockId: "target", persistentVariables });

        expect(result.displayables.map(record => record.objectName)).toEqual(["cgElse"]);
        expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    /** Whichever arm ran, the other two are declarations - see `StoryStageSnapshot.declarations`. */
    it("declares the arms it did not take, hidden", () => {
        const result = computeStoryStageSnapshot({
            document,
            sceneId: "scene-1",
            targetBlockId: "target",
            persistentVariables,
            readPersistent: () => 1,
        });

        expect(result.declarations.map(record => ({ name: record.objectName, visible: record.visible })))
            .toEqual([{ name: "cg0", visible: false }, { name: "cgElse", visible: false }]);
    });
});

/**
 * The sound at the target row: the track on the music channel and every handle the scene's rows
 * start, as the walk to the row left them. A row-precise launch opens on this, and so does a save
 * put back at its row after the story changed - both used to open in silence.
 */
describe("computeStoryStageSnapshot and the sound at the target row", () => {
    const audio = (id: string, payload: Record<string, unknown>, parentId: string | null = null) =>
        block(id, "action", { action: "audio", ...payload }, parentId);
    const rain = audio("rain", { operation: "playSound", objectName: "rain", assetId: "asset-rain", loop: true });
    const theme = audio("theme", { operation: "setBgm", assetId: "asset-theme", fadeMs: 1200 });

    function withSceneMusic(document: StoryDocument): StoryDocument {
        document.scenes["scene-1"].bgm = { assetId: "asset-scene-music", fadeMs: 800 };
        return document;
    }

    it("has the scene's own music playing at any row, and nothing when the scene has none", () => {
        const rows = { before: say("before"), target: say("target") };
        expect(snapshot(withSceneMusic(baseDocument(rows)), "target").music).toEqual({ playing: true, paused: false });
        expect(snapshot(baseDocument(rows), "target").music).toBeNull();
    });

    it("puts the track of the last /bgm row before the target on the channel, and a /bgm with no file clears it", () => {
        const document = withSceneMusic(baseDocument({
            theme,
            "after-theme": say("after-theme"),
            clear: audio("clear", { operation: "setBgm" }),
            "after-clear": say("after-clear"),
        }));

        expect(snapshot(document, "after-theme").music).toEqual({ setBy: "theme", playing: true, paused: false });
        expect(snapshot(document, "after-clear").music).toBeNull();
        // A /bgm at or after the target has not happened yet.
        expect(snapshot(document, "theme").music).toEqual({ playing: true, paused: false });
    });

    it("follows the music channel through the controls that address it", () => {
        const document = baseDocument({
            theme,
            quieter: audio("quieter", { operation: "setVolume", target: { builtin: "bgm" }, volume: 0.3 }),
            pause: audio("pause", { operation: "pauseSound", objectName: "bgm" }),
            target: say("target"),
            stop: audio("stop", { operation: "stopSound", target: { builtin: "bgm" } }),
            "after-stop": say("after-stop"),
        });

        expect(snapshot(document, "target").music).toEqual({ setBy: "theme", playing: true, paused: true, volumeBy: "quieter" });
        expect(snapshot(document, "after-stop").music).toEqual({ setBy: "theme", playing: false, paused: false });
    });

    it("records a sound started before the target as playing, and one stopped since as not", () => {
        const document = baseDocument({
            rain,
            "after-rain": say("after-rain"),
            stop: audio("stop", { operation: "stopSound", target: { sourceBlockId: "rain", name: "rain" } }),
            "after-stop": say("after-stop"),
        });

        expect(snapshot(document, "after-rain").sounds).toEqual([{ objectName: "rain", sourceBlockId: "rain", playing: true, paused: false }]);
        expect(snapshot(document, "after-stop").sounds).toEqual([{ objectName: "rain", sourceBlockId: "rain", playing: false, paused: false }]);
    });

    it("lists a sound only a later row starts, so a launch can build it for that row", () => {
        const document = baseDocument({ target: say("target"), rain });
        expect(snapshot(document, "target").sounds).toEqual([{ objectName: "rain", sourceBlockId: "rain", playing: false, paused: false }]);
    });

    it("keeps what the engine keeps across a restart and forgets what it does not", () => {
        const document = baseDocument({
            rain,
            mute: audio("mute", { operation: "muteSound", objectName: "rain", muted: true }),
            quieter: audio("quieter", { operation: "setVolume", objectName: "rain", volume: 0.2 }),
            faster: audio("faster", { operation: "setRate", objectName: "rain", rate: 1.5 }),
            seek: audio("seek", { operation: "seekSound", objectName: "rain", timeMs: 4000 }),
            "before-restart": say("before-restart"),
            again: audio("again", { operation: "playSound", objectName: "rain" }),
            "after-restart": say("after-restart"),
        });

        expect(snapshot(document, "before-restart").sounds[0]).toEqual({
            objectName: "rain", sourceBlockId: "rain", playing: true, paused: false,
            muted: true, volumeBy: "quieter", rate: 1.5, seekMs: 4000,
        });
        // A start is at the level the clip was built with and from its in point; the mute flag and
        // the rate stay with the clip.
        expect(snapshot(document, "after-restart").sounds[0]).toEqual({
            objectName: "rain", sourceBlockId: "rain", playing: true, paused: false, muted: true, rate: 1.5,
        });
    });

    it("lets a level, a rate, a seek or a pause on a clip that is not playing do nothing", () => {
        const document = baseDocument({
            rain,
            stop: audio("stop", { operation: "stopSound", objectName: "rain" }),
            quieter: audio("quieter", { operation: "setVolume", objectName: "rain", volume: 0.2 }),
            faster: audio("faster", { operation: "setRate", objectName: "rain", rate: 2 }),
            pause: audio("pause", { operation: "pauseSound", objectName: "rain" }),
            target: say("target"),
        });
        expect(snapshot(document, "target").sounds[0]).toEqual({ objectName: "rain", sourceBlockId: "rain", playing: false, paused: false });
    });

    it("builds a handle from the first row that names a file in compile order, even on an arm the path did not take", () => {
        // The compiler reads every arm, so the `/sound rain` in the option the reader did not pick is
        // the row that builds the handle - and the row on the path plays that handle.
        const document = baseDocument({
            menu: block("menu", "nodeAction", { action: "choice" }, null, ["left", "right"]),
            left: block("left", "nodeAction", { action: "choiceOption", text: { textId: "l", value: "Left" } }, "menu", ["rain-left"]),
            "rain-left": audio("rain-left", { operation: "playSound", objectName: "rain", assetId: "asset-rain-left", loop: true }, "left"),
            right: block("right", "nodeAction", { action: "choiceOption", text: { textId: "r", value: "Right" } }, "menu", ["rain-right", "target"]),
            "rain-right": audio("rain-right", { operation: "playSound", objectName: "rain", assetId: "asset-rain-right" }, "right"),
            target: say("target", "right"),
        }, ["menu"]);

        expect(snapshot(document, "target").sounds).toEqual([{ objectName: "rain", sourceBlockId: "rain-left", playing: true, paused: false }]);
    });

    it("gives a control row ahead of any row that builds the handle nothing to act on", () => {
        const document = baseDocument({
            early: audio("early", { operation: "muteSound", objectName: "rain", muted: true }),
            rain,
            target: say("target"),
        });
        expect(snapshot(document, "target").sounds[0]).toEqual({ objectName: "rain", sourceBlockId: "rain", playing: true, paused: false });
    });

    it("leaves a one-shot sound marked as started, for the launch to judge from the clip", () => {
        const document = baseDocument({
            hit: audio("hit", { operation: "playSound", objectName: "hit", assetId: "asset-hit" }),
            target: say("target"),
        });
        expect(snapshot(document, "target").sounds).toEqual([{ objectName: "hit", sourceBlockId: "hit", playing: true, paused: false }]);
    });

    it("builds no handle from a disabled row, as the compiler drops it", () => {
        const document = baseDocument({
            rain: { ...rain, disabled: true } as StoryBlock,
            later: audio("later", { operation: "playSound", objectName: "rain", assetId: "asset-rain-later" }),
            target: say("target"),
        });
        expect(snapshot(document, "target").sounds).toEqual([{ objectName: "rain", sourceBlockId: "later", playing: true, paused: false }]);
    });

    it("ignores a disabled row on the way, as the compiler drops it", () => {
        const document = withSceneMusic(baseDocument({
            theme: { ...theme, disabled: true } as StoryBlock,
            rain: { ...rain, disabled: true } as StoryBlock,
            target: say("target"),
        }));
        const result = snapshot(document, "target");
        expect(result.music).toEqual({ playing: true, paused: false });
        expect(result.sounds).toEqual([]);
    });
});

/**
 * The speaker names the walked path's `/rename` rows left: a launch replaces those rows, so it has to
 * replay the names they gave or open on the cast's names.
 */
describe("computeStoryStageSnapshot and /rename", () => {
    const rename = (id: string, characterId: string, displayName: string, parentId: string | null = null) =>
        block(id, "action", { action: "character", operation: "setName", characterId, displayName }, parentId);

    it("records, for each character, the last /rename on the path before the target", () => {
        const document = baseDocument({
            hide: rename("hide", "char-alice", "？？？"),
            bob: rename("bob", "char-bob", "Mr. B"),
            reveal: rename("reveal", "char-alice", "Alice"),
            target: say("target"),
            later: rename("later", "char-alice", "Al"),
        }, ["hide", "bob", "reveal", "target", "later"]);

        expect(snapshot(document, "target").renames).toEqual([
            { characterId: "char-alice", setBy: "reveal" },
            { characterId: "char-bob", setBy: "bob" },
        ]);
        // A rename at the target row is the tail's to play, not the opening's.
        expect(snapshot(document, "reveal").renames).toEqual([
            { characterId: "char-alice", setBy: "hide" },
            { characterId: "char-bob", setBy: "bob" },
        ]);
        expect(snapshot(document, null).renames).toEqual([]);
    });

    it("leaves out a /rename on an arm the path did not take, and a disabled one", () => {
        const document = baseDocument({
            cond: block("cond", "control", { control: "condition" }, null, ["yes", "otherwise"]),
            yes: block("yes", "control", { control: "conditionBranch", branch: "if", condition: { kind: "variable", target: { scope: "scene", variableId: "flag" }, operator: "isTrue" } }, "cond", ["named"]),
            named: rename("named", "char-alice", "Alice", "yes"),
            otherwise: block("otherwise", "control", { control: "conditionBranch", branch: "else" }, "cond", ["hidden"]),
            hidden: rename("hidden", "char-alice", "？？？", "otherwise"),
            off: { ...rename("off", "char-bob", "Bob"), disabled: true } as StoryBlock,
            target: say("target"),
        }, ["cond", "off", "target"]);

        expect(snapshot(document, "target").renames).toEqual([{ characterId: "char-alice", setBy: "hidden" }]);
    });
});

/**
 * A disabled row is compiled out with everything under it, so the stage a playthrough reaches never
 * saw it - and neither may the walk that reconstructs that stage.
 */
describe("computeStoryStageSnapshot and disabled rows", () => {
    it("skips a disabled row and its subtree on the way to the target", () => {
        const document = baseDocument({
            bg: { ...block("bg", "action", { action: "setBackground", assetId: "asset-off" }), disabled: true } as StoryBlock,
            group: { ...block("group", "control", { control: "repeat" }, null, ["show"]), disabled: true } as StoryBlock,
            show: block("show", "action", { action: "image", operation: "show", objectName: "cg", assetId: "asset-cg" }, "group"),
            target: say("target"),
        }, ["bg", "group", "target"]);

        const result = snapshot(document, "target");
        expect(result.background).toBeNull();
        expect(result.displayables).toEqual([]);
        expect(result.declarations).toEqual([]);
    });

    it("never takes a disabled branch of a condition", () => {
        const document = baseDocument({
            cond: block("cond", "control", { control: "condition" }, null, ["yes", "otherwise"]),
            yes: { ...block("yes", "control", { control: "conditionBranch", branch: "if", condition: { kind: "variable", target: { scope: "scene", variableId: "flag" }, operator: "isFalse" } }, "cond", ["bg-yes"]), disabled: true } as StoryBlock,
            "bg-yes": block("bg-yes", "action", { action: "setBackground", assetId: "asset-yes" }, "yes"),
            otherwise: block("otherwise", "control", { control: "conditionBranch", branch: "else" }, "cond", ["bg-else"]),
            "bg-else": block("bg-else", "action", { action: "setBackground", assetId: "asset-else" }, "otherwise"),
            target: say("target"),
        }, ["cond", "target"]);

        expect(snapshot(document, "target").background).toEqual({ assetId: "asset-else" });
    });

    it("still reaches a target under a disabled row, acting on nothing passed on the way", () => {
        const document = baseDocument({
            group: { ...block("group", "control", { control: "repeat" }, null, ["bg", "target"]), disabled: true } as StoryBlock,
            bg: block("bg", "action", { action: "setBackground", assetId: "asset-off" }, "group"),
            target: say("target", "group"),
        }, ["group"]);

        const result = snapshot(document, "target");
        expect(result.background).toBeNull();
        expect(result.diagnostics.map(entry => entry.message)).toEqual([]);
    });
});

describe("resolveTakenConditionBranch", () => {
    const flagIsTrue = { kind: "variable", target: { scope: "scene", variableId: "flag" }, operator: "isTrue" };
    const setFlag = (id: string, parentId: string | null = null) =>
        block(id, "action", { action: "setVariable", target: { scope: "scene", variableId: "flag" }, value: true }, parentId);
    const condition = {
        condition: block("condition", "control", { control: "condition" }, null, ["if-branch", "else-branch"]),
        "if-branch": block("if-branch", "control", { control: "conditionBranch", branch: "if", condition: flagIsTrue }, "condition", ["in-if"]),
        "in-if": say("in-if", "if-branch"),
        "else-branch": block("else-branch", "control", { control: "conditionBranch", branch: "else" }, "condition", ["in-else"]),
        "in-else": say("in-else", "else-branch"),
    };
    const taken = (document: StoryDocument, via: string | null = null) =>
        resolveTakenConditionBranch({ document, sceneId: "scene-1", conditionBlockId: "condition", via });

    it("decides the arm from the state play reaches the condition with", () => {
        expect(taken(baseDocument({ set: setFlag("set"), ...condition }, ["set", "condition"]))).toBe("if-branch");
        expect(taken(baseDocument({ ...condition }, ["condition"]))).toBe("else-branch");
    });

    it("passes over a disabled arm, and answers null when no arm is taken", () => {
        const disabledIf = baseDocument({
            set: setFlag("set"),
            ...condition,
            "if-branch": { ...condition["if-branch"], disabled: true },
        }, ["set", "condition"]);
        expect(taken(disabledIf)).toBe("else-branch");

        const noElse = baseDocument({
            ...condition,
            condition: block("condition", "control", { control: "condition" }, null, ["if-branch"]),
        }, ["condition"]);
        expect(taken(noElse)).toBeNull();
    });

    it("carries the assignments of the option the walk comes from", () => {
        const document = baseDocument({
            menu: block("menu", "nodeAction", { action: "choice" }, null, ["opt-a", "opt-b"]),
            "opt-a": block("opt-a", "nodeAction", { action: "choiceOption", text: { textId: "ta", value: "A", role: "choiceText" } }, "menu", ["line-a", "set-a"]),
            "line-a": say("line-a", "opt-a"),
            "set-a": setFlag("set-a", "opt-a"),
            "opt-b": block("opt-b", "nodeAction", { action: "choiceOption", text: { textId: "tb", value: "B", role: "choiceText" } }, "menu", ["line-b"]),
            "line-b": say("line-b", "opt-b"),
            ...condition,
        }, ["menu", "condition"]);
        // From the top no option is taken, so the flag keeps its default.
        expect(taken(document)).toBe("else-branch");
        // Stepping on from inside option A, play has been through A's assignment.
        expect(taken(document, "line-a")).toBe("if-branch");
        expect(taken(document, "line-b")).toBe("else-branch");
    });
});
