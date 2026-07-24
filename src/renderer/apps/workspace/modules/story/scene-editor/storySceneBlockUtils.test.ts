import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { annotateDialogueGroups, buildDialogueAppearances, buildVisibleRows, getContainerHeaderInfo, isContainerBlock, isNarrativeRow, isReadableAccentColor, nextSelectionAfterDelete } from "./storySceneBlockUtils";

function control(payload: Extract<StoryBlock, { kind: "control" }>["payload"]): StoryBlock {
    return { id: "b", kind: "control", parentId: null, childrenIds: [], payload };
}

function nodeAction(payload: Extract<StoryBlock, { kind: "nodeAction" }>["payload"]): StoryBlock {
    return { id: "b", kind: "nodeAction", parentId: null, childrenIds: [], payload };
}

function dialogue(id: string, speaker: { characterId?: string; speakerName?: string } = {}): StoryBlock {
    return { id, kind: "nodeAction", parentId: null, childrenIds: [], payload: { action: "dialogue", ...speaker, text: { textId: `${id}-t`, role: "dialogue", value: id } } };
}

function characterAction(id: string, payload: Extract<StoryBlock, { kind: "action" }>["payload"]): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload };
}

function narration(id: string, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind: "nodeAction", parentId, childrenIds, payload: { action: "narration", text: { textId: `${id}-t`, role: "narration", value: id } } };
}

function group(id: string, childrenIds: string[]): StoryBlock {
    return { id, kind: "control", parentId: null, childrenIds, payload: { control: "sequence", mode: "do" } };
}

/** A scene with just the fields the row helpers read. */
function scene(blocks: StoryBlock[], rootBlockIds: string[]): StoryScene {
    return { blocks: Object.fromEntries(blocks.map(block => [block.id, block])), rootBlockIds } as unknown as StoryScene;
}

describe("isContainerBlock", () => {
    it("is true for control, choice, choiceOption, and nvl", () => {
        expect(isContainerBlock(control({ control: "condition" }))).toBe(true);
        expect(isContainerBlock(nodeAction({ action: "choice" }))).toBe(true);
        expect(isContainerBlock(nodeAction({ action: "choiceOption", text: { textId: "t", role: "choiceText", value: "" } }))).toBe(true);
        expect(isContainerBlock({ id: "b", kind: "action", parentId: null, childrenIds: [], payload: { action: "nvl" } })).toBe(true);
    });

    it("is false for plain actions and narration", () => {
        expect(isContainerBlock(nodeAction({ action: "narration", text: { textId: "t", role: "narration", value: "hi" } }))).toBe(false);
        expect(isContainerBlock(undefined)).toBe(false);
    });
});

describe("getContainerHeaderInfo", () => {
    it("labels condition branches in plain language and flags which carry a condition", () => {
        expect(getContainerHeaderInfo(control({ control: "conditionBranch", branch: "if" }))).toMatchObject({ pill: "If", role: "branch", hasCondition: true });
        expect(getContainerHeaderInfo(control({ control: "conditionBranch", branch: "elseIf" }))).toMatchObject({ pill: "Else if", hasCondition: true });
        expect(getContainerHeaderInfo(control({ control: "conditionBranch", branch: "else" }))).toMatchObject({ pill: "Otherwise", hasCondition: false });
    });

    it("exposes the repeat count on repeat groups", () => {
        expect(getContainerHeaderInfo(control({ control: "repeat", times: 3 }))).toMatchObject({ pill: "Repeat", role: "group", repeatTimes: 3 });
    });

    it("labels the remaining group kinds and menu containers", () => {
        expect(getContainerHeaderInfo(control({ control: "parallel", mode: "all" }))?.role).toBe("group");
        expect(getContainerHeaderInfo(control({ control: "race", mode: "any" }))?.role).toBe("group");
        expect(getContainerHeaderInfo(control({ control: "sequence", mode: "do" }))?.role).toBe("group");
        expect(getContainerHeaderInfo(nodeAction({ action: "choice" }))).toMatchObject({ pill: "Menu", role: "menu" });
    });

    it("returns null for non-container blocks", () => {
        expect(getContainerHeaderInfo(nodeAction({ action: "narration", text: { textId: "t", role: "narration", value: "hi" } }))).toBeNull();
    });
});

describe("nextSelectionAfterDelete", () => {
    const flat = scene(
        ["r1", "r2", "r3", "r4"].map(id => narration(id)),
        ["r1", "r2", "r3", "r4"],
    );
    const flatRows = buildVisibleRows(flat, new Set());

    it("lands on the previous row when a middle or last row is deleted", () => {
        expect(nextSelectionAfterDelete(flat, flatRows, ["r2"])).toBe("r1");
        expect(nextSelectionAfterDelete(flat, flatRows, ["r4"])).toBe("r3");
    });

    it("lands on the first survivor below when the top row(s) go", () => {
        expect(nextSelectionAfterDelete(flat, flatRows, ["r1"])).toBe("r2");
        expect(nextSelectionAfterDelete(flat, flatRows, ["r1", "r2"])).toBe("r3");
    });

    it("returns null when every row is deleted", () => {
        expect(nextSelectionAfterDelete(flat, flatRows, ["r1", "r2", "r3", "r4"])).toBeNull();
    });

    it("treats a deleted container's descendants as gone, landing above the container", () => {
        const nested = scene(
            [narration("top"), group("grp", ["g1", "g2"]), narration("g1", "grp"), narration("g2", "grp"), narration("after")],
            ["top", "grp", "after"],
        );
        const rows = buildVisibleRows(nested, new Set());
        // Deleting the container removes g1/g2 too, so the landing is the row above it, not a child.
        expect(nextSelectionAfterDelete(nested, rows, ["grp"])).toBe("top");
        // Deleting a child lands on its previous visible row.
        expect(nextSelectionAfterDelete(nested, rows, ["g2"])).toBe("g1");
    });

    it("skips a deleted top container's descendants to the first true survivor below", () => {
        const nested = scene(
            [group("grp", ["g1"]), narration("g1", "grp"), narration("after")],
            ["grp", "after"],
        );
        const rows = buildVisibleRows(nested, new Set());
        // grp is first and g1 is its (also-deleted) descendant, so the survivor is `after`.
        expect(nextSelectionAfterDelete(nested, rows, ["grp"])).toBe("after");
    });
});

describe("annotateDialogueGroups", () => {
    const rolesOf = (blocks: StoryBlock[]) =>
        annotateDialogueGroups(buildVisibleRows(scene(blocks, blocks.map(b => b.id)), new Set())).map(row => row.groupRole);

    it("marks the first same-speaker dialogue a head and the rest members", () => {
        expect(rolesOf([dialogue("a", { characterId: "c1" }), dialogue("b", { characterId: "c1" }), dialogue("c", { characterId: "c1" })]))
            .toEqual(["head", "member", "member"]);
    });

    it("starts a new group when the speaker changes", () => {
        expect(rolesOf([dialogue("a", { characterId: "c1" }), dialogue("b", { characterId: "c2" })])).toEqual(["head", "head"]);
    });

    it("folds a same-character expression into the run without breaking it", () => {
        expect(rolesOf([
            dialogue("a", { characterId: "c1" }),
            characterAction("x", { action: "character", operation: "expression", characterId: "c1" }),
            dialogue("b", { characterId: "c1" }),
        ])).toEqual(["head", "member", "member"]);
    });

    it("breaks the run on any other kind — a different-character expression, an enter, or narration", () => {
        expect(rolesOf([
            dialogue("a", { characterId: "c1" }),
            characterAction("x", { action: "character", operation: "expression", characterId: "c2" }),
            dialogue("b", { characterId: "c1" }),
        ])).toEqual(["head", undefined, "head"]);
        expect(rolesOf([
            dialogue("a", { characterId: "c1" }),
            characterAction("x", { action: "character", operation: "enter", characterId: "c1" }),
            dialogue("b", { characterId: "c1" }),
        ])).toEqual(["head", undefined, "head"]);
        expect(rolesOf([dialogue("a", { characterId: "c1" }), narration("n"), dialogue("b", { characterId: "c1" })]))
            .toEqual(["head", undefined, "head"]);
    });

    it("groups bare speakers by exact name, but never two unnamed rows", () => {
        expect(rolesOf([dialogue("a", { speakerName: "Guard" }), dialogue("b", { speakerName: "Guard" })])).toEqual(["head", "member"]);
        expect(rolesOf([dialogue("a", { speakerName: "Guard" }), dialogue("b", { speakerName: "Maid" })])).toEqual(["head", "head"]);
        expect(rolesOf([dialogue("a"), dialogue("b")])).toEqual(["head", "head"]);
    });

    it("never groups a real character with a bare name, even when the names would print the same", () => {
        // One row keys on `characterId`, the other on `speakerName`; they are different identities.
        expect(rolesOf([dialogue("a", { characterId: "c1" }), dialogue("b", { speakerName: "c1" })])).toEqual(["head", "head"]);
        expect(rolesOf([dialogue("a", { speakerName: "c1" }), dialogue("b", { characterId: "c1" })])).toEqual(["head", "head"]);
    });

    it("does not group across a container boundary — an option body's last line vs a same-speaker line outside", () => {
        // Flattened order is [option, inside, outside]; adjacency in that list is not adjacency in the
        // tree, so `inside` (parent=opt) must not merge with `outside` (parent=root) despite same speaker.
        const opt: StoryBlock = { id: "opt", kind: "nodeAction", parentId: null, childrenIds: ["inside"], payload: { action: "choiceOption", text: { textId: "opt-t", role: "choiceText", value: "pick" } } };
        const inside: StoryBlock = { id: "inside", kind: "nodeAction", parentId: "opt", childrenIds: [], payload: { action: "dialogue", characterId: "c1", text: { textId: "inside-t", role: "dialogue", value: "inside" } } };
        const outside: StoryBlock = { id: "outside", kind: "nodeAction", parentId: null, childrenIds: [], payload: { action: "dialogue", characterId: "c1", text: { textId: "outside-t", role: "dialogue", value: "outside" } } };
        const rows = annotateDialogueGroups(buildVisibleRows(scene([opt, inside, outside], ["opt", "outside"]), new Set()));
        expect(rows.map(row => row.groupRole)).toEqual([undefined, "head", "head"]);
    });
});

describe("filter then group", () => {
    it("keeps original line numbers and groups the survivors that filtering made adjacent", () => {
        // Pipeline mirrors the controller: buildVisibleRows -> narrative filter -> annotateDialogueGroups.
        const blocks = [
            dialogue("d1", { characterId: "c1" }),
            characterAction("x", { action: "character", operation: "enter", characterId: "c1" }),
            dialogue("d2", { characterId: "c1" }),
        ];
        const visible = buildVisibleRows(scene(blocks, blocks.map(b => b.id)), new Set());
        const filtered = annotateDialogueGroups(visible.filter(row => isNarrativeRow(row.block)));
        // The hidden `enter` (line 2) is dropped, but d1/d2 keep their original numbers — not renumbered.
        expect(filtered.map(row => row.lineNumber)).toEqual([1, 3]);
        // With the staging row gone, d1/d2 are adjacent and group.
        expect(filtered.map(row => row.groupRole)).toEqual(["head", "member"]);
    });
});

describe("isNarrativeRow", () => {
    it("keeps narration, dialogue, choice, option and note; hides staging", () => {
        expect(isNarrativeRow(narration("n"))).toBe(true);
        expect(isNarrativeRow(dialogue("d", { characterId: "c1" }))).toBe(true);
        expect(isNarrativeRow(nodeAction({ action: "choice" }))).toBe(true);
        expect(isNarrativeRow(nodeAction({ action: "choiceOption", text: { textId: "t", role: "choiceText", value: "" } }))).toBe(true);
        expect(isNarrativeRow({ id: "b", kind: "note", parentId: null, childrenIds: [], payload: { text: { textId: "t", role: "note", value: "" } } })).toBe(true);
        // Staging kinds hide, including a character expression (an action).
        expect(isNarrativeRow(characterAction("x", { action: "character", operation: "expression", characterId: "c1" }))).toBe(false);
        expect(isNarrativeRow(control({ control: "condition" }))).toBe(false);
        expect(isNarrativeRow({ id: "b", kind: "jump", parentId: null, childrenIds: [], payload: { targetSceneId: "s2" } })).toBe(false);
    });
});

describe("buildVisibleRows disabled propagation", () => {
    it("marks a disabled block and its whole subtree, leaving siblings enabled", () => {
        const grp: StoryBlock = { id: "grp", kind: "control", parentId: null, childrenIds: ["c1"], disabled: true, payload: { control: "sequence", mode: "do" } };
        const c1 = narration("c1", "grp");
        const after = narration("after");
        const rows = buildVisibleRows(scene([grp, c1, after], ["grp", "after"]), new Set());
        expect(rows.map(row => [row.block.id, Boolean(row.disabled)])).toEqual([
            ["grp", true],
            ["c1", true],
            ["after", false],
        ]);
    });
});

describe("isReadableAccentColor", () => {
    it("keeps mid-range accents that clear both themes", () => {
        expect(isReadableAccentColor("#40a8c4")).toBe(true);
        expect(isReadableAccentColor("#3b82f6")).toBe(true);
        expect(isReadableAccentColor("#808080")).toBe(true);
        expect(isReadableAccentColor("#1a3a8f")).toBe(true);
    });

    it("rejects near-background extremes and unparseable values", () => {
        expect(isReadableAccentColor("#000000")).toBe(false); // drowns on dark
        expect(isReadableAccentColor("#ffffff")).toBe(false); // washes on light
        expect(isReadableAccentColor("#ffff00")).toBe(false); // bright yellow, unreadable on light
        expect(isReadableAccentColor("not-a-color")).toBe(false);
    });
});

describe("buildDialogueAppearances", () => {
    it("gives a dialogue its speaker's most recent enter/expression, resetting on exit", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", formName: "casual", variants: ["smile"] }),
            dialogue("d1", { characterId: "c1" }),
            characterAction("f", { action: "character", operation: "expression", characterId: "c1", variants: ["angry"] }),
            dialogue("d2", { characterId: "c1" }),
            characterAction("x", { action: "character", operation: "exit", characterId: "c1" }),
            dialogue("d3", { characterId: "c1" }),
        ];
        const map = buildDialogueAppearances(scene(blocks, blocks.map(b => b.id)));
        expect(map.get("d1")).toMatchObject({ formName: "casual", variants: ["smile"] });
        expect(map.get("d2")).toMatchObject({ variants: ["angry"] });
        expect(map.has("d3")).toBe(false);
    });

    it("leaves a dialogue with no prior show unannotated", () => {
        const blocks = [dialogue("d1", { characterId: "c1" })];
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).has("d1")).toBe(false);
    });

    it("tracks the placement (WI-3): an enter sets it and names its own block as the source", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", transform: { preset: "left" } }),
            dialogue("d1", { characterId: "c1" }),
        ];
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1"))
            .toMatchObject({ position: "left", positionSourceId: "e" });
    });

    it("a move relocates the placement and becomes the new source, keeping the form", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", formName: "casual", transform: { preset: "left" } }),
            dialogue("d1", { characterId: "c1" }),
            characterAction("m", { action: "character", operation: "move", characterId: "c1", transform: { preset: "right" } }),
            dialogue("d2", { characterId: "c1" }),
        ];
        const map = buildDialogueAppearances(scene(blocks, blocks.map(b => b.id)));
        expect(map.get("d1")).toMatchObject({ position: "left", positionSourceId: "e" });
        expect(map.get("d2")).toMatchObject({ position: "right", positionSourceId: "m", formName: "casual" });
    });

    it("an expression keeps the placement and its source untouched", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", transform: { preset: "right" } }),
            characterAction("f", { action: "character", operation: "expression", characterId: "c1", variants: ["angry"] }),
            dialogue("d1", { characterId: "c1" }),
        ];
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1"))
            .toMatchObject({ position: "right", positionSourceId: "e", variants: ["angry"] });
    });

    it("marks an entered speaker shown, so its avatar still resolves", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1" }),
            dialogue("d1", { characterId: "c1" }),
        ];
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1")?.shown).toBe(true);
    });

    it("reads back a placement move on a never-shown speaker without inventing a shown avatar (WI-3 round-trip)", () => {
        // The group-header dropdown authors this /move for a speaker with no /show; the scan must read it
        // back so a second pick rewrites it rather than stacking a duplicate — but must not mark it shown.
        const blocks = [
            characterAction("m", { action: "character", operation: "move", characterId: "c1", transform: { preset: "left" } }),
            dialogue("d1", { characterId: "c1" }),
        ];
        const appearance = buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1");
        expect(appearance).toMatchObject({ position: "left", positionSourceId: "m" });
        expect(appearance?.shown).toBeUndefined();
    });

    it("leaves the accumulated placement untouched for a move that carries no placement preset", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", transform: { preset: "left" } }),
            characterAction("m", { action: "character", operation: "move", characterId: "c1", transform: { durationMs: 300 } }),
            dialogue("d1", { characterId: "c1" }),
        ];
        // The placement stays left (the enter's), and the enter stays its source — a coord-only move is
        // not the row the dropdown edits.
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1"))
            .toMatchObject({ position: "left", positionSourceId: "e" });
    });
});
