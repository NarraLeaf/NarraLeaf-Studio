import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { resolveChosenOptionStop, resolveNextPreviewStop, type StoryPreviewStepOptions } from "./storyPreviewStep";

function makeScene(blocks: StoryBlock[], rootBlockIds: string[]): StoryScene {
    return {
        id: "scene-1",
        name: "Scene 1",
        runtimeName: "Scene 1",
        rootBlockIds,
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function row(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const line = (id: string, parentId: string | null = null, value = "Text") =>
    row(id, "nodeAction", { action: "narration", text: { textId: `${id}-t`, value, role: "narration" } }, parentId);
const command = (id: string, parentId: string | null = null) =>
    row(id, "action", { action: "setVariable", target: { scope: "scene", variableId: "v" }, value: 1 }, parentId);
const menu = (id: string, optionIds: string[], parentId: string | null = null) =>
    row(id, "nodeAction", { action: "choice" }, parentId, optionIds);
const option = (id: string, parentId: string, childrenIds: string[]) =>
    row(id, "nodeAction", { action: "choiceOption", text: { textId: `${id}-t`, value: id, role: "choiceText" } }, parentId, childrenIds);
const jump = (id: string) => row(id, "jump", { targetSceneId: "scene-2" });
const disabled = (block: StoryBlock): StoryBlock => ({ ...block, disabled: true });

const NO_BRANCH: StoryPreviewStepOptions = { chooseBranch: () => null };

/**
 * The shape of the skeleton's clubroom scene: a command, music, narration, a show, four lines, a
 * menu of two options each ending in a command, and a jump.
 */
function clubroom(): StoryScene {
    return makeScene([
        command("set"), command("bgm"), line("n1"), row("show", "action", { action: "character", operation: "enter", characterId: "c" }),
        line("l5"), line("l6"), line("l7"), line("l8"), line("n9"),
        menu("menu", ["optA", "optB"]),
        option("optA", "menu", ["a1", "a2", "a3", "aSet"]), line("a1", "optA"), line("a2", "optA"), line("a3", "optA"), command("aSet", "optA"),
        option("optB", "menu", ["b1", "b2", "b3", "bSet"]), line("b1", "optB"), line("b2", "optB"), line("b3", "optB"), command("bSet", "optB"),
        jump("jump"),
    ], ["set", "bgm", "n1", "show", "l5", "l6", "l7", "l8", "n9", "menu", "jump"]);
}

describe("resolveNextPreviewStop", () => {
    it("steps from line to line, passing over the commands between them", () => {
        const scene = clubroom();
        const walk: (string | null)[] = [];
        let at: string | null = "set";
        for (let i = 0; i < 7; i += 1) {
            at = resolveNextPreviewStop(scene, at, NO_BRANCH);
            walk.push(at);
        }
        expect(walk).toEqual(["n1", "l5", "l6", "l7", "l8", "n9", "menu"]);
    });

    it("starts at the first stop of the scene when no row is selected", () => {
        expect(resolveNextPreviewStop(clubroom(), null, NO_BRANCH)).toBe("n1");
    });

    it("leaves a menu branch for whatever follows the whole menu, not the next option", () => {
        const scene = clubroom();
        expect(resolveNextPreviewStop(scene, "a1", NO_BRANCH)).toBe("a2");
        expect(resolveNextPreviewStop(scene, "a3", NO_BRANCH)).toBe("jump");
        expect(resolveNextPreviewStop(scene, "b3", NO_BRANCH)).toBe("jump");
    });

    it("goes no further from a jump, or from the end of the scene", () => {
        const scene = clubroom();
        expect(resolveNextPreviewStop(scene, "jump", NO_BRANCH)).toBeNull();
        const open = makeScene([line("a"), command("b")], ["a", "b"]);
        expect(resolveNextPreviewStop(open, "a", NO_BRANCH)).toBeNull();
    });

    it("treats an ending as the last stop", () => {
        const scene = makeScene([
            line("a"), row("end", "control", { control: "ending", endingId: "e" }), line("never"),
        ], ["a", "end", "never"]);
        expect(resolveNextPreviewStop(scene, "a", NO_BRANCH)).toBe("end");
        expect(resolveNextPreviewStop(scene, "end", NO_BRANCH)).toBeNull();
    });

    it("passes over disabled rows, a disabled jump and lines with nothing to say", () => {
        const scene = makeScene([
            line("a"), disabled(line("off")), disabled(jump("j")), line("blank", null, "  "),
            disabled(row("group", "control", { control: "sequence" }, null, ["inner"])), line("inner", "group"),
            line("b"),
        ], ["a", "off", "j", "blank", "group", "b"]);
        expect(resolveNextPreviewStop(scene, "a", NO_BRANCH)).toBe("b");
    });

    it("descends into a container, and from a container row to its first line", () => {
        const scene = makeScene([
            line("a"), row("nvl", "action", { action: "nvl" }, null, ["n1", "n2"]), line("n1", "nvl"), line("n2", "nvl"), line("after"),
        ], ["a", "nvl", "after"]);
        expect(resolveNextPreviewStop(scene, "a", NO_BRANCH)).toBe("n1");
        expect(resolveNextPreviewStop(scene, "nvl", NO_BRANCH)).toBe("n1");
        expect(resolveNextPreviewStop(scene, "n2", NO_BRANCH)).toBe("after");
    });

    it("enters the arm of a condition the host says play takes, and skips the condition when it takes none", () => {
        const scene = makeScene([
            line("a"),
            row("cond", "control", { control: "condition" }, null, ["ifB", "elseB"]),
            row("ifB", "control", { control: "conditionBranch", branch: "if" }, "cond", ["i1"]), line("i1", "ifB"),
            row("elseB", "control", { control: "conditionBranch", branch: "else" }, "cond", ["e1"]), line("e1", "elseB"),
            line("after"),
        ], ["a", "cond", "after"]);
        expect(resolveNextPreviewStop(scene, "a", { chooseBranch: () => "elseB" })).toBe("e1");
        expect(resolveNextPreviewStop(scene, "a", { chooseBranch: () => "ifB" })).toBe("i1");
        expect(resolveNextPreviewStop(scene, "a", NO_BRANCH)).toBe("after");
        // Leaving an arm goes past the whole condition, never into the next arm.
        expect(resolveNextPreviewStop(scene, "i1", { chooseBranch: () => "ifB" })).toBe("after");
        // On an arm's own row, play is that arm.
        expect(resolveNextPreviewStop(scene, "elseB", { chooseBranch: () => "ifB" })).toBe("e1");
    });

    it("leaves a loop at a break, and follows a goto to its label", () => {
        const loop = makeScene([
            row("rep", "control", { control: "repeat", times: 3 }, null, ["r1", "brk", "r2"]),
            line("r1", "rep"), row("brk", "control", { control: "break" }, "rep"), line("r2", "rep"),
            line("after"),
        ], ["rep", "after"]);
        expect(resolveNextPreviewStop(loop, "r1", NO_BRANCH)).toBe("after");

        const goto = makeScene([
            line("a"), row("go", "control", { control: "goto", targetLabel: "later" }), line("skipped"),
            row("lbl", "control", { control: "label", name: "later" }), line("landed"),
        ], ["a", "go", "skipped", "lbl", "landed"]);
        expect(resolveNextPreviewStop(goto, "a", NO_BRANCH)).toBe("landed");
    });

    it("passes over a stop the author is not showing", () => {
        const scene = clubroom();
        const isShown = (id: string) => id !== "l6";
        expect(resolveNextPreviewStop(scene, "l5", { ...NO_BRANCH, isShown })).toBe("l7");
        // A hidden jump still ends the scene: there is nothing after it to step to.
        expect(resolveNextPreviewStop(scene, "a3", { ...NO_BRANCH, isShown: id => id !== "jump" })).toBeNull();
    });
});

describe("resolveChosenOptionStop", () => {
    it("lands on the first line of the picked branch", () => {
        const scene = clubroom();
        expect(resolveChosenOptionStop(scene, "optA", NO_BRANCH)).toBe("a1");
        expect(resolveChosenOptionStop(scene, "optB", NO_BRANCH)).toBe("b1");
    });

    it("goes past the menu when the picked branch has nothing to stop on", () => {
        const scene = makeScene([
            menu("menu", ["optA", "optB"]), option("optA", "menu", ["aSet"]), command("aSet", "optA"),
            option("optB", "menu", []), line("after"),
        ], ["menu", "after"]);
        expect(resolveChosenOptionStop(scene, "optA", NO_BRANCH)).toBe("after");
        expect(resolveChosenOptionStop(scene, "optB", NO_BRANCH)).toBe("after");
    });
});
