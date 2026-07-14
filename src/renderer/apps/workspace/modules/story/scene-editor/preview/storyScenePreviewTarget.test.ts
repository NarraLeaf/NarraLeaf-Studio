import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { resolvePreviewTargetBlockId } from "./storyScenePreviewTarget";

function makeScene(blocks: Record<string, StoryBlock>, rootBlockIds: string[]): StoryScene {
    return {
        id: "scene-1",
        name: "Scene 1",
        runtimeName: "Scene 1",
        rootBlockIds,
        blocks,
    };
}

function block(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const say = (id: string, parentId: string | null = null, childrenIds: string[] = []) =>
    block(id, "nodeAction", { action: "narration", text: { textId: `${id}-text`, value: "Text", role: "narration" } }, parentId, childrenIds);

describe("resolvePreviewTargetBlockId", () => {
    it("returns null without an active block or for unknown ids", () => {
        const scene = makeScene({ a: say("a") }, ["a"]);
        expect(resolvePreviewTargetBlockId(scene, null)).toBeNull();
        expect(resolvePreviewTargetBlockId(scene, "missing")).toBeNull();
    });

    it("returns regular action blocks unchanged", () => {
        const scene = makeScene({ a: say("a") }, ["a"]);
        expect(resolvePreviewTargetBlockId(scene, "a")).toBe("a");
    });

    it("maps choice options and condition branches to their parent container", () => {
        const scene = makeScene({
            choice: block("choice", "nodeAction", { action: "choice" }, null, ["option"]),
            option: block("option", "nodeAction", { action: "choiceOption", text: { textId: "t", value: "Go", role: "choiceText" } }, "choice"),
            condition: block("condition", "control", { control: "condition" }, null, ["branch"]),
            branch: block("branch", "control", { control: "conditionBranch", branch: "if" }, "condition"),
        }, ["choice", "condition"]);
        expect(resolvePreviewTargetBlockId(scene, "option")).toBe("choice");
        expect(resolvePreviewTargetBlockId(scene, "branch")).toBe("condition");
    });

    it("falls back to the nearest previous previewable block for code and note rows", () => {
        const scene = makeScene({
            a: say("a"),
            note: block("note", "note", { text: "Remember" }),
            code: block("code", "code", { language: "narraleaf", source: "x" }),
            b: say("b"),
        }, ["a", "note", "code", "b"]);
        expect(resolvePreviewTargetBlockId(scene, "code")).toBe("a");
        expect(resolvePreviewTargetBlockId(scene, "note")).toBe("a");
    });

    it("previews the scene start when a code row has no previous previewable block", () => {
        const scene = makeScene({
            code: block("code", "code", { language: "narraleaf", source: "x" }),
            a: say("a"),
        }, ["code", "a"]);
        expect(resolvePreviewTargetBlockId(scene, "code")).toBeNull();
    });

    it("resolves a code row inside a choice option to the option's parent choice", () => {
        const scene = makeScene({
            choice: block("choice", "nodeAction", { action: "choice" }, null, ["option"]),
            option: block("option", "nodeAction", { action: "choiceOption", text: { textId: "t", value: "Go", role: "choiceText" } }, "choice", ["code"]),
            code: block("code", "code", { language: "narraleaf", source: "x" }, "option"),
        }, ["choice"]);
        expect(resolvePreviewTargetBlockId(scene, "code")).toBe("choice");
    });
});
