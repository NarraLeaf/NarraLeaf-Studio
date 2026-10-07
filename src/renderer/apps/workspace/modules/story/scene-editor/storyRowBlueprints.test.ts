import { describe, expect, it } from "vitest";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { StoryBlock } from "@shared/types/story";
import {
    collectCarriedBlueprints,
    giveCopiedRowsTheirBlueprints,
    listOwnedBlueprintIds,
    readCarriedBlueprints,
    type StoryBlueprintPastePort,
} from "./storyRowBlueprints";

function blueprintRow(id: string, blueprintId: string): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload: { action: "blueprint", blueprintId } };
}

function branchRow(id: string, blueprintId: string): StoryBlock {
    return {
        id,
        kind: "control",
        parentId: null,
        childrenIds: [],
        payload: { control: "conditionBranch", branch: "if", condition: { kind: "blueprint", blueprintId } },
    };
}

/** A line whose text shows a blueprint's value inline, and calls a named one in an expression. */
function lineWithValue(id: string, blueprintId: string, invokedId: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "narration",
            text: {
                textId: `${id}-text`,
                role: "narration",
                value: "Gold: ",
                rich: [
                    { text: "Gold: " },
                    { interpolation: { kind: "blueprint", blueprintId } },
                    { interpolation: { kind: "expression", expression: { kind: "invoke", blueprintId: invokedId, name: "bonus" } } },
                ],
            },
        },
    } as unknown as StoryBlock;
}

function storyBlueprint(id: string, name = "Story Action"): Blueprint {
    return {
        id,
        name,
        owner: { kind: "storyAction", blueprintId: id },
        graphs: { events: {}, functions: {} },
    } as unknown as Blueprint;
}

/** A project holding `ids`, of which `named` are named by some row; copies are numbered. */
function project(ids: string[], named: string[] = []) {
    const blueprints = new Map(ids.map(id => [id, storyBlueprint(id)]));
    const copies: { from: string; to: string }[] = [];
    const port: StoryBlueprintPastePort = {
        blueprint: id => blueprints.get(id),
        namedByRows: id => named.includes(id),
        copy: source => {
            const to = `copy-${copies.length + 1}`;
            copies.push({ from: source.id, to });
            blueprints.set(to, { ...source, id: to });
            return to;
        },
    };
    return { port, copies };
}

function blueprintIdOf(block: StoryBlock): string {
    return (block.payload as { blueprintId: string }).blueprintId;
}

describe("the blueprints a row owns", () => {
    it("lists the row's own graph, its branch condition and its inline value, but not a named call", () => {
        const ids = listOwnedBlueprintIds([blueprintRow("a", "bp-a"), branchRow("b", "bp-b"), lineWithValue("c", "bp-c", "fn-shared")]);
        expect(ids).toEqual(["bp-a", "bp-b", "bp-c"]);
    });

    it("skips a blueprint slot nobody has created yet", () => {
        expect(listOwnedBlueprintIds([blueprintRow("a", "")])).toEqual([]);
    });
});

describe("giving copied rows their blueprints", () => {
    it("copies every owned blueprint for a duplicate, leaving named calls alone", () => {
        const { port, copies } = project(["bp-a", "bp-b", "bp-c", "fn-shared"], ["bp-a", "bp-b", "bp-c"]);
        const rows = [blueprintRow("a", "bp-a"), branchRow("b", "bp-b"), lineWithValue("c", "bp-c", "fn-shared")];

        expect(giveCopiedRowsTheirBlueprints(rows, port, "copy")).toBe(3);

        expect(copies.map(copy => copy.from)).toEqual(["bp-a", "bp-b", "bp-c"]);
        expect(blueprintIdOf(rows[0])).toBe("copy-1");
        expect((rows[1].payload as any).condition.blueprintId).toBe("copy-2");
        const runs = (rows[2].payload as any).text.rich;
        expect(runs[1].interpolation.blueprintId).toBe("copy-3");
        expect(runs[2].interpolation.expression.blueprintId).toBe("fn-shared");
    });

    it("keeps a blueprint no row names any more - a cut and a paste is a move", () => {
        const { port, copies } = project(["bp-a"], []);
        const rows = [blueprintRow("a", "bp-a")];

        giveCopiedRowsTheirBlueprints(rows, port, "paste");

        expect(blueprintIdOf(rows[0])).toBe("bp-a");
        expect(copies).toEqual([]);
    });

    it("copies a blueprint the original row still names - a copy and a paste", () => {
        const { port } = project(["bp-a"], ["bp-a"]);
        const rows = [blueprintRow("a", "bp-a")];

        giveCopiedRowsTheirBlueprints(rows, port, "paste");

        expect(blueprintIdOf(rows[0])).toBe("copy-1");
    });

    it("gives two pasted rows that shared one blueprint one each", () => {
        const { port } = project(["bp-a"], []);
        const rows = [blueprintRow("a", "bp-a"), blueprintRow("b", "bp-a")];

        giveCopiedRowsTheirBlueprints(rows, port, "paste");

        expect(rows.map(blueprintIdOf)).toEqual(["bp-a", "copy-1"]);
    });

    it("makes a foreign row's blueprint from the carried copy, never from a local blueprint of the same id", () => {
        const { port, copies } = project(["bp-a"], []);
        const carried = { "bp-a": storyBlueprint("bp-a", "Open the gallery") };
        const rows = [blueprintRow("a", "bp-a")];

        giveCopiedRowsTheirBlueprints(rows, port, "foreign", carried);

        expect(blueprintIdOf(rows[0])).toBe("copy-1");
        expect(copies).toEqual([{ from: "bp-a", to: "copy-1" }]);
    });

    it("leaves a reference nothing can be made for as it is", () => {
        const { port } = project([], []);
        const rows = [blueprintRow("a", "bp-gone")];

        expect(giveCopiedRowsTheirBlueprints(rows, port, "foreign")).toBe(0);

        expect(blueprintIdOf(rows[0])).toBe("bp-gone");
    });
});

describe("the blueprints a copy carries", () => {
    it("carries the story blueprints the rows own, keyed by id", () => {
        const table: Record<string, Blueprint> = { "bp-a": storyBlueprint("bp-a") };
        const carried = collectCarriedBlueprints([blueprintRow("a", "bp-a"), blueprintRow("b", "bp-missing")], id => table[id]);
        expect(Object.keys(carried ?? {})).toEqual(["bp-a"]);
        expect(collectCarriedBlueprints([lineWithValue("c", "", "fn")], id => table[id])).toBeUndefined();
    });

    it("reads back only entries that are plainly a story blueprint under its own id", () => {
        const read = readCarriedBlueprints({
            "bp-a": storyBlueprint("bp-a"),
            "bp-b": storyBlueprint("bp-other"),
            "bp-c": { ...storyBlueprint("bp-c"), owner: { kind: "globalMain" } },
            "bp-d": "not a blueprint",
        });
        expect(Object.keys(read ?? {})).toEqual(["bp-a"]);
        expect(readCarriedBlueprints(undefined)).toBeUndefined();
    });
});
