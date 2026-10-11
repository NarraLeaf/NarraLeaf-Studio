import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { storyReferencesTo, storyUsesNotFitting } from "./agentReferences";

/**
 * What a variable retype leaves behind (acceptance run #2: `好感` retyped boolean -> number kept the
 * skeleton's `/set 好感 true` and `? 好感` rows, with no word from `variable_upsert`).
 */

const VAR = "6987a20b-6086-4aee-b49a-04397af993f6";
const target = { scope: "saved", variableId: VAR };

function row(id: string, payload: Record<string, unknown>, kind = "action"): StoryBlock {
    return { id, parentId: null, childrenIds: [], kind, payload } as unknown as StoryBlock;
}

const rows: StoryBlock[] = [
    row("a", { action: "setVariable", target, value: true }),
    row("b", { action: "setVariable", target, value: 3 }),
    row("c", { action: "setVariable", target, value: 0, expression: { kind: "binary" } }),
    row("d", { control: "conditionBranch", branch: "if", condition: { kind: "variable", target, operator: "isTrue" } }, "control"),
    row("e", { control: "conditionBranch", branch: "if", condition: { kind: "variable", target, operator: "greaterThan", value: 2 } }, "control"),
    row("f", { control: "conditionBranch", branch: "if", condition: { kind: "variable", target, operator: "equals", value: "x" } }, "control"),
    row("g", { action: "setVariable", target: { scope: "saved", variableId: "other" }, value: true }),
];

const document = {
    id: "story",
    name: "Skeleton",
    chapters: [{ id: "ch", name: "1", sceneIds: ["scene"] }],
    scenes: {
        scene: {
            id: "scene",
            name: "车厢",
            runtimeName: "scene",
            rootBlockIds: rows.map(block => block.id),
            blocks: Object.fromEntries(rows.map(block => [block.id, block])),
        },
    },
} as unknown as StoryDocument;
const stories = [{ id: "story", name: "Skeleton", document }];

describe("storyUsesNotFitting", () => {
    it("names each row whose literal or test a number no longer fits, and leaves computed ones alone", () => {
        expect(storyUsesNotFitting(stories, VAR, "number")).toEqual([
            'story "Skeleton", scene "车厢", row 1: sets it to true',
            'story "Skeleton", scene "车厢", row 4: tests it as true',
            'story "Skeleton", scene "车厢", row 6: compares it with "x" (equals)',
        ]);
    });

    it("judges the same rows against a boolean the other way round", () => {
        expect(storyUsesNotFitting(stories, VAR, "boolean")).toEqual([
            'story "Skeleton", scene "车厢", row 2: sets it to 3',
            'story "Skeleton", scene "车厢", row 5: orders it (greaterThan 2)',
            'story "Skeleton", scene "车厢", row 6: compares it with "x" (equals)',
        ]);
    });

    it("finds nothing wrong for a json variable, and still lists every use as a reference", () => {
        expect(storyUsesNotFitting(stories, VAR, "json")).toEqual([]);
        expect(storyReferencesTo(stories, VAR)).toHaveLength(6);
    });
});
