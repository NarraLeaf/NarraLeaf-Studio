import { describe, expect, it } from "vitest";
import type { StoryAnimationAsset, StoryBlock, StoryDocument } from "@shared/types/story";
import { computeStoryStageSnapshot } from "./storyStageSnapshot";

function baseDocument(blocks: Record<string, StoryBlock>, rootBlockIds: string[] = Object.keys(blocks)): StoryDocument {
    return {
        schemaVersion: 3,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene 1",
                runtimeName: "Scene 1",
                rootBlockIds,
                blocks,
                sceneVariables: {
                    flag: { id: "flag", name: "flag", valueType: "boolean", storageKey: "flag", defaultValue: false },
                },
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
                transform: { preset: "center", durationMs: 300, props: { zoom: 0.5, xoffset: 24 } },
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
        expect(alice.autoFit).toBe(true);
        expect(alice.source).toEqual({ type: "character", characterId: "char-alice", formName: undefined, variants: undefined });
        expect(alice.props).toEqual(expect.objectContaining({
            opacity: 1,
            zoom: 0.5,
            position: expect.objectContaining({ xalign: 0.5, yalign: 0.5, xoffset: 24 }),
        }));

        const atTarget2 = snapshot(document, "target-2");
        expect(atTarget2.displayables[0].visible).toBe(false);
        expect(atTarget2.displayables[0].props.opacity).toBe(0);
    });

    it("merges successive transforms with position-aware semantics", () => {
        const document = baseDocument({
            show: block("show", "action", { action: "image", operation: "show", objectName: "hero", transform: { preset: "left", durationMs: 200 } }),
            move: block("move", "action", {
                action: "displayable",
                operation: "transform",
                target: { name: "hero", kind: "image" },
                transform: { preset: "custom", durationMs: 200, props: { yalign: 0.8 } },
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

    it("tracks residual effects and their clears", () => {
        const document = baseDocument({
            show: block("show", "action", { action: "image", operation: "show", objectName: "hero" }),
            darken: block("darken", "action", { action: "displayable", operation: "darken", target: { name: "hero", kind: "image" }, darkness: 0.6 }),
            clip: block("clip", "action", { action: "displayable", operation: "clip", target: { name: "hero", kind: "image" }, clipPath: "inset(10% 0)" }),
            reveal: block("reveal", "action", { action: "displayable", operation: "circleReveal", target: { name: "hero", kind: "image" } }),
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
                transform: { preset: "zoom", durationMs: 300, props: { zoom: 1.25 } },
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
                transform: { preset: "custom", durationMs: 100, props: { yoffset: -20 } },
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
                transform: { preset: "center" },
            }),
            darken: block("darken", "action", {
                action: "displayable",
                operation: "darken",
                target: { name: "Character", kind: "character", sourceBlockId: "enter" },
                darkness: 0.6,
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
            create: block("create", "action", { action: "image", operation: "create", objectName: "", assetId: "asset-x", transform: { preset: "center" } }),
            filter: block("filter", "action", {
                action: "displayable",
                operation: "filter",
                target: { name: "Image", kind: "image", sourceBlockId: "create" },
                filter: "blur(4px)",
            }),
            target: say("target"),
        }, ["create", "filter", "target"]);

        const result = snapshot(document, "target");

        expect(result.diagnostics).toEqual([]);
        expect(result.displayables[0].effects.filter).toEqual({ filter: "blur(4px)" });
    });
});
