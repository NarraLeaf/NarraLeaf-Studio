import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { deleteBlockFromScene, insertBlockInScene, moveBlocksInScene } from "@/lib/workspace/services/story/storyModel";
import { annotateDialogueGroups, annotateNestingBranches, buildDialogueAppearances, buildVisibleRows, getContainerHeaderInfo, isContainerBlock, isReadableAccentColor, nextSelectionAfterDelete, planBlockGroupMove, planRowBackspaceReplacement, planSelectionNudge, readableAccentColor } from "./storySceneBlockUtils";
import { dialogueOnlyStoryRowFilter, storyRowPassesFilter } from "./storyRowFilter";
import type { VisibleStoryRow } from "./storySceneEditorTypes";

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

/**
 * The nesting connector needs the same fact the dialogue rail does — where the line it draws stops —
 * and gets it from one lookahead over the flattened preorder list: a branch at level L ends at a row
 * exactly when the next row sits at depth L or shallower.
 */
describe("annotateNestingBranches", () => {
    const depthsAndNext = (rows: VisibleStoryRow[]) =>
        annotateNestingBranches(rows).map(row => `${row.depth}->${row.nextRowDepth}`);

    it("records the following row's depth, and 0 for the last row", () => {
        const rows = [{ depth: 0 }, { depth: 1 }, { depth: 2 }, { depth: 1 }, { depth: 0 }] as VisibleStoryRow[];
        expect(depthsAndNext(rows)).toEqual(["0->1", "1->2", "2->1", "1->0", "0->0"]);
    });

    it("leaves an empty list alone", () => {
        expect(annotateNestingBranches([])).toEqual([]);
    });
});

describe("annotateDialogueGroups", () => {
    const rolesOf = (blocks: StoryBlock[]) =>
        annotateDialogueGroups(buildVisibleRows(scene(blocks, blocks.map(b => b.id)), new Set())).map(row => row.groupRole);
    const continuesOf = (blocks: StoryBlock[]) =>
        annotateDialogueGroups(buildVisibleRows(scene(blocks, blocks.map(b => b.id)), new Set())).map(row => row.groupContinues ?? false);

    it("marks the first same-speaker dialogue a head and the rest members", () => {
        expect(rolesOf([dialogue("a", { characterId: "c1" }), dialogue("b", { characterId: "c1" }), dialogue("c", { characterId: "c1" })]))
            .toEqual(["head", "member", "member"]);
    });

    it("starts a new group when the speaker changes", () => {
        expect(rolesOf([dialogue("a", { characterId: "c1" }), dialogue("b", { characterId: "c2" })])).toEqual(["head", "head"]);
    });

    /**
     * The continuation rule is drawn per row but must read as one line, so every row of a run needs to
     * know whether another member follows it. Marking heads alone (the original rule) left the last
     * member indistinguishable from the middle ones, so the line ran off the bottom of the run.
     */
    it("marks every row of a run except its last as continuing", () => {
        expect(continuesOf([dialogue("a", { characterId: "c1" }), dialogue("b", { characterId: "c1" }), dialogue("c", { characterId: "c1" })]))
            .toEqual([true, true, false]);
    });

    it("leaves a run of one, and the row after a run, with nothing to continue", () => {
        expect(continuesOf([dialogue("a", { characterId: "c1" }), narration("n")])).toEqual([false, false]);
    });

    it("folds a same-character expression into the run without breaking it", () => {
        expect(rolesOf([
            dialogue("a", { characterId: "c1" }),
            characterAction("x", { action: "character", operation: "expression", characterId: "c1" }),
            dialogue("b", { characterId: "c1" }),
        ])).toEqual(["head", "member", "member"]);
    });

    /**
     * The `/face`-only rule was the accident of which verb happened to be written first: a line the
     * author added from inside one character's run is that character's line whichever verb it uses,
     * and one of them wearing a directive's glyph while the next wore the run's rule read as a
     * subject change that had not happened.
     */
    it("folds every verb done to the run's own speaker, not only the expression", () => {
        for (const operation of ["move", "setMotion", "setSkin", "setParams", "setName"] as const) {
            expect(rolesOf([
                dialogue("a", { characterId: "c1" }),
                characterAction("x", { action: "character", operation, characterId: "c1" }),
                dialogue("b", { characterId: "c1" }),
            ])).toEqual(["head", "member", "member"]);
        }
    });

    it("breaks the run on any other kind — a different-character expression, or an enter", () => {
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
    });

    /**
     * gutter 规范 §2: the paragraph rule is one rule for every voice, 不做特例. Narration used to be
     * the exception — it never grouped, so a page of it re-announced the narrator on every line while
     * a page of dialogue named its speaker once.
     */
    it("groups a run of narration the same way it groups one speaker", () => {
        expect(rolesOf([narration("a"), narration("b"), narration("c")])).toEqual(["head", "member", "member"]);
        expect(continuesOf([narration("a"), narration("b"), narration("c")])).toEqual([true, true, false]);
    });

    it("still breaks a dialogue run at narration, and a narration run at dialogue", () => {
        expect(rolesOf([dialogue("a", { characterId: "c1" }), narration("n"), dialogue("b", { characterId: "c1" })]))
            .toEqual(["head", "head", "head"]);
        expect(rolesOf([narration("a"), dialogue("d", { characterId: "c1" }), narration("b")]))
            .toEqual(["head", "head", "head"]);
    });

    /** A directive between two narration lines ends the paragraph, exactly as it does for dialogue. */
    it("does not fold a directive into a narration run", () => {
        expect(rolesOf([
            narration("a"),
            characterAction("x", { action: "character", operation: "enter", characterId: "c1" }),
            narration("b"),
        ])).toEqual(["head", undefined, "head"]);
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

describe("buildVisibleRows line numbers", () => {
    // The scene: n1, a group holding two rows, n2. Numbers 1..5 in document order.
    const blocks = [narration("n1"), group("g", ["c1", "c2"]), narration("c1", "g"), narration("c2", "g"), narration("n2")];
    const built = () => scene(blocks, ["n1", "g", "n2"]);

    it("numbers every row of the scene in document order", () => {
        const rows = buildVisibleRows(built(), new Set());
        expect(rows.map(row => `${row.block.id}:${row.lineNumber}`)).toEqual(["n1:1", "g:2", "c1:3", "c2:4", "n2:5"]);
    });

    it("leaves a gap where a container is collapsed, rather than renumbering what is left", () => {
        // Folding is a view state; the row after the fold is still row 5 of the scene, and the lint
        // report is entitled to call it that. Numbering it 3 would move rows under the reader.
        const rows = buildVisibleRows(built(), new Set(["g"]));
        expect(rows.map(row => `${row.block.id}:${row.lineNumber}`)).toEqual(["n1:1", "g:2", "n2:5"]);
    });
});

describe("filter then group", () => {
    it("keeps original line numbers and groups the survivors that filtering made adjacent", () => {
        // Pipeline mirrors the controller: buildVisibleRows -> row filter -> annotateDialogueGroups.
        const blocks = [
            dialogue("d1", { characterId: "c1" }),
            characterAction("x", { action: "character", operation: "enter", characterId: "c1" }),
            dialogue("d2", { characterId: "c1" }),
        ];
        const dialogueOnly = dialogueOnlyStoryRowFilter();
        const visible = buildVisibleRows(scene(blocks, blocks.map(b => b.id)), new Set());
        const filtered = annotateDialogueGroups(visible.filter(row => storyRowPassesFilter(row.block, dialogueOnly, () => null)));
        // The hidden `enter` (line 2) is dropped, but d1/d2 keep their original numbers — not renumbered.
        expect(filtered.map(row => row.lineNumber)).toEqual([1, 3]);
        // With the staging row gone, d1/d2 are adjacent and group.
        expect(filtered.map(row => row.groupRole)).toEqual(["head", "member"]);
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

    /**
     * A brand link is not a hex, and the band above is right to refuse it. What must not happen is
     * the refusal reaching a surface: every Studio chrome reader goes through `readableAccentColor`,
     * which unwraps the link first, so that an author who points a character at the project palette
     * does not watch them go grey in the story rows, the character list and the Dev Mode timeline at
     * the same moment.
     */
    describe("readableAccentColor", () => {
        beforeEach(() => {
            setActiveBrandPalette([
                ...BUILTIN_BRAND_COLORS,
                { id: "cast.alice", value: "#40a8c4" },
                { id: "cast.pale", value: "#ffffff" },
            ]);
        });

        afterEach(() => {
            setActiveBrandPalette(BUILTIN_BRAND_COLORS);
        });

        it("resolves a link before banding it", () => {
            expect(readableAccentColor("nlbrand:cast.alice")).toBe("#40a8c4");
            expect(readableAccentColor("nlbrand:primary")).toBe("#40A8C4");
        });

        it("leaves a literal exactly as it was", () => {
            expect(readableAccentColor("#40a8c4")).toBe("#40a8c4");
        });

        it("still bands the colour a link resolves to", () => {
            // Near-white through the palette is as unreadable as near-white written by hand.
            expect(readableAccentColor("nlbrand:cast.pale")).toBeUndefined();
            // A translucent entry is not a hex the band can read, so it is refused like any other.
            expect(readableAccentColor("nlbrand:button.shadow")).toBeUndefined();
        });

        it("says nothing for a link the palette cannot answer for", () => {
            expect(readableAccentColor("nlbrand:gone")).toBeUndefined();
        });

        /** No accent stays no accent — the resolver must not manufacture a default. */
        it("says nothing for a value that was never set", () => {
            expect(readableAccentColor(undefined)).toBeUndefined();
            expect(readableAccentColor(null)).toBeUndefined();
            expect(readableAccentColor("")).toBeUndefined();
        });
    });
});

describe("buildDialogueAppearances", () => {
    it("gives a dialogue its speaker's most recent enter/expression, resetting on exit", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", pose: "casual", tags: { axis: "smile" } }),
            dialogue("d1", { characterId: "c1" }),
            characterAction("f", { action: "character", operation: "expression", characterId: "c1", tags: { axis: "angry" } }),
            dialogue("d2", { characterId: "c1" }),
            characterAction("x", { action: "character", operation: "exit", characterId: "c1" }),
            dialogue("d3", { characterId: "c1" }),
        ];
        const map = buildDialogueAppearances(scene(blocks, blocks.map(b => b.id)));
        expect(map.get("d1")).toMatchObject({ pose: "casual", tags: { axis: "smile" } });
        expect(map.get("d2")).toMatchObject({ tags: { axis: "angry" } });
        expect(map.has("d3")).toBe(false);
    });

    it("leaves a dialogue with no prior show unannotated", () => {
        const blocks = [dialogue("d1", { characterId: "c1" })];
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).has("d1")).toBe(false);
    });

    it("tracks the placement: an enter sets it and names its own block as the source", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", transform: { to: { position: { xalign: 0.25, yalign: 0.5 } } } }),
            dialogue("d1", { characterId: "c1" }),
        ];
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1"))
            .toMatchObject({ position: "left", positionSourceId: "e" });
    });

    it("a move relocates the placement and becomes the new source, keeping the form", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", pose: "casual", transform: { to: { position: { xalign: 0.25, yalign: 0.5 } } } }),
            dialogue("d1", { characterId: "c1" }),
            characterAction("m", { action: "character", operation: "move", characterId: "c1", transform: { to: { position: { xalign: 0.75, yalign: 0.5 } } } }),
            dialogue("d2", { characterId: "c1" }),
        ];
        const map = buildDialogueAppearances(scene(blocks, blocks.map(b => b.id)));
        expect(map.get("d1")).toMatchObject({ position: "left", positionSourceId: "e" });
        expect(map.get("d2")).toMatchObject({ position: "right", positionSourceId: "m", pose: "casual" });
    });

    it("an expression keeps the placement and its source untouched", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", transform: { to: { position: { xalign: 0.75, yalign: 0.5 } } } }),
            characterAction("f", { action: "character", operation: "expression", characterId: "c1", tags: { axis: "angry" } }),
            dialogue("d1", { characterId: "c1" }),
        ];
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1"))
            .toMatchObject({ position: "right", positionSourceId: "e", tags: { axis: "angry" } });
    });

    it("marks an entered speaker shown, so its avatar still resolves", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1" }),
            dialogue("d1", { characterId: "c1" }),
        ];
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1")?.shown).toBe(true);
    });

    it("reads back a placement move on a never-shown speaker without inventing a shown avatar", () => {
        // The group-header dropdown authors this /move for a speaker with no /show; the scan must read it
        // back so a second pick rewrites it rather than stacking a duplicate — but must not mark it shown.
        const blocks = [
            characterAction("m", { action: "character", operation: "move", characterId: "c1", transform: { to: { position: { xalign: 0.25, yalign: 0.5 } } } }),
            dialogue("d1", { characterId: "c1" }),
        ];
        const appearance = buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1");
        expect(appearance).toMatchObject({ position: "left", positionSourceId: "m" });
        expect(appearance?.shown).toBeUndefined();
    });

    it("leaves the accumulated placement untouched for a move that carries no placement preset", () => {
        const blocks = [
            characterAction("e", { action: "character", operation: "enter", characterId: "c1", transform: { to: { position: { xalign: 0.25, yalign: 0.5 } } } }),
            characterAction("m", { action: "character", operation: "move", characterId: "c1", transform: { durationMs: 300 } }),
            dialogue("d1", { characterId: "c1" }),
        ];
        // The placement stays left (the enter's), and the enter stays its source — a coord-only move is
        // not the row the dropdown edits.
        expect(buildDialogueAppearances(scene(blocks, blocks.map(b => b.id))).get("d1"))
            .toMatchObject({ position: "left", positionSourceId: "e" });
    });
});

describe("planRowBackspaceReplacement", () => {
    /** A leaf action row (`/show`-shaped) with a real parent link. */
    function showRow(id: string, parentId: string | null = null): StoryBlock {
        return { id, kind: "action", parentId, childrenIds: [], payload: { action: "character", operation: "enter", characterId: "c1" } };
    }

    it("plans an in-place replacement for a single selected leaf action row", () => {
        const blocks = [narration("n1"), showRow("a1"), narration("n2")];
        expect(planRowBackspaceReplacement(scene(blocks, ["n1", "a1", "n2"]), ["a1"]))
            .toEqual({ replaceBlockId: "a1", target: { parentId: null, beforeBlockId: "a1" } });
    });

    it("keeps the row's parent and position, so the replacement lands where the row was", () => {
        const container = { ...group("g", ["a1"]), childrenIds: ["a1"] };
        const blocks = [container, showRow("a1", "g")];
        expect(planRowBackspaceReplacement(scene(blocks, ["g"]), ["a1"]))
            .toEqual({ replaceBlockId: "a1", target: { parentId: "g", beforeBlockId: "a1" } });
    });

    it("declines a multi-row selection - Backspace there stays a bulk delete", () => {
        const blocks = [showRow("a1"), showRow("a2")];
        expect(planRowBackspaceReplacement(scene(blocks, ["a1", "a2"]), ["a1", "a2"])).toBeNull();
        expect(planRowBackspaceReplacement(scene(blocks, ["a1", "a2"]), [])).toBeNull();
    });

    it("declines a container that holds children - the subtree would go with it", () => {
        const blocks = [group("g", ["a1"]), showRow("a1", "g")];
        expect(planRowBackspaceReplacement(scene(blocks, ["g"]), ["g"])).toBeNull();
    });

    it("treats a childless container as a leaf", () => {
        const blocks = [group("g", [])];
        expect(planRowBackspaceReplacement(scene(blocks, ["g"]), ["g"]))
            .toMatchObject({ replaceBlockId: "g" });
    });

    it("declines text rows - they already own the empty-line ladder", () => {
        const blocks = [narration("n1"), dialogue("d1")];
        expect(planRowBackspaceReplacement(scene(blocks, ["n1", "d1"]), ["n1"])).toBeNull();
        expect(planRowBackspaceReplacement(scene(blocks, ["n1", "d1"]), ["d1"])).toBeNull();
    });

    it("declines structural children - a narration line inside a condition is not a legal tree", () => {
        const condition: StoryBlock = { id: "c", kind: "control", parentId: null, childrenIds: ["b"], payload: { control: "condition" } };
        const branch: StoryBlock = { id: "b", kind: "control", parentId: "c", childrenIds: [], payload: { control: "conditionBranch", branch: "if" } };
        expect(planRowBackspaceReplacement(scene([condition, branch], ["c"]), ["b"])).toBeNull();
    });

    it("declines a row that is gone", () => {
        expect(planRowBackspaceReplacement(scene([], []), ["missing"])).toBeNull();
    });

    it("replaces rather than deletes: applying the plan keeps the row count and the position, and one undo restores the whole pre-edit scene", () => {
        const blocks = [narration("n1"), showRow("a1"), narration("n2")];
        const live = scene(blocks.map(block => structuredClone(block)), ["n1", "a1", "n2"]);
        // Covers the two model mutations and the shape the undo restores. It does NOT run the real
        // history stack (`recordHistory` / `restoreHistoryState` live in the React controller and
        // `replaceScene` needs a live document); the clones below stand in for them, matching the
        // JSON round-trip both `cloneScene` implementations use - so a value that does not survive
        // serialization does not survive here either.
        const snapshot = JSON.parse(JSON.stringify(live)) as StoryScene;

        const plan = planRowBackspaceReplacement(live, ["a1"]);
        expect(plan).not.toBeNull();
        // What the controller does under one history entry: insert first, then drop the original.
        insertBlockInScene(live, narration("blank"), plan!.target);
        deleteBlockFromScene(live, plan!.replaceBlockId);

        expect(live.rootBlockIds).toEqual(["n1", "blank", "n2"]);
        expect(Object.keys(live.blocks)).toHaveLength(3);
        expect(live.blocks.a1).toBeUndefined();
        // A single undo reinstates the scene entire - row order, block set and payloads - and carries
        // no trace of the replacement: the mutations must not have reached into the recorded state.
        const restored = JSON.parse(JSON.stringify(snapshot)) as StoryScene;
        expect(restored.blocks.blank).toBeUndefined();
        expect(restored).toEqual(scene(blocks, ["n1", "a1", "n2"]));
    });
});

describe("planBlockGroupMove", () => {
    /** Four rows at the top level: the shape most drags happen in. */
    const flat = () => scene([narration("a"), narration("b"), narration("c"), narration("d")], ["a", "b", "c", "d"]);

    /** Runs the plan the way the controller does, and reports the row order it leaves behind. */
    function applied(live: StoryScene, movingIds: string[], grabbed: string, target: string): string[] | null {
        const plan = planBlockGroupMove(live, movingIds, grabbed, target);
        if (!plan) {
            return null;
        }
        moveBlocksInScene(live, [plan]);
        return live.rootBlockIds;
    }

    it("drops the whole group after the target when the grabbed row came from above it", () => {
        expect(applied(flat(), ["a", "b"], "a", "d")).toEqual(["c", "d", "a", "b"]);
    });

    it("drops the whole group before the target when the grabbed row came from below it", () => {
        expect(applied(flat(), ["c", "d"], "d", "b")).toEqual(["a", "c", "d", "b"]);
    });

    it("keeps document order however the selection was built", () => {
        // Selected bottom-up (`d` clicked first), grabbed by `c` and dragged above `a`: the rows still
        // land as c, then d.
        expect(applied(flat(), ["d", "c"], "c", "a")).toEqual(["c", "d", "a", "b"]);
    });

    it("anchors on a row that is NOT moving, so a non-contiguous group lands together", () => {
        // `c` sits right after the drop point and is itself moving. Anchoring on it would insert `a`
        // in front of a row about to leave, and `c` would then be appended to the end of the scene.
        expect(applied(flat(), ["a", "c"], "a", "b")).toEqual(["b", "a", "c", "d"]);
    });

    it("carries the group into the container it is dropped on", () => {
        const live = scene([
            narration("a"), narration("b"),
            group("g", ["g1"]), narration("g1", "g"),
        ], ["a", "b", "g"]);
        expect(applied(live, ["a", "b"], "a", "g1")).toEqual(["g"]);
        expect(live.blocks.g.childrenIds).toEqual(["g1", "a", "b"]);
        expect(live.blocks.a.parentId).toBe("g");
    });

    it("declines a drop on one of the moving rows", () => {
        expect(planBlockGroupMove(flat(), ["a", "b"], "a", "b")).toBeNull();
    });

    it("declines a drop inside a moving container - a block cannot be moved into itself", () => {
        const live = scene([
            narration("a"),
            group("g", ["g1"]), narration("g1", "g"),
        ], ["a", "g"]);
        expect(planBlockGroupMove(live, ["g"], "g", "g1")).toBeNull();
        // Grabbing a row inside the container drags the container, so the same drop is still refused.
        expect(planBlockGroupMove(live, ["g", "g1"], "g1", "g1")).toBeNull();
    });

    it("drags the container when the grabbed row is a selected descendant of it", () => {
        const live = scene([
            narration("a"),
            group("g", ["g1"]), narration("g1", "g"),
        ], ["a", "g"]);
        // `g1` is selected too, but it rides along inside `g` rather than moving on its own.
        const plan = planBlockGroupMove(live, ["g", "g1"], "g1", "a");
        expect(plan?.blockIds).toEqual(["g"]);
        moveBlocksInScene(live, [plan!]);
        expect(live.rootBlockIds).toEqual(["g", "a"]);
    });

    it("declines an empty selection and a target that is gone", () => {
        expect(planBlockGroupMove(flat(), [], "a", "b")).toBeNull();
        expect(planBlockGroupMove(flat(), ["a"], "a", "missing")).toBeNull();
    });
});

describe("planSelectionNudge", () => {
    const rows = (...ids: string[]) => scene(ids.map(id => narration(id)), [...ids]);

    /** Runs the plan the way the controller does, and reports the row order it leaves behind. */
    function nudged(live: StoryScene, movingIds: string[], direction: "up" | "down"): string[] | null {
        const plan = planSelectionNudge(live, movingIds, direction);
        if (!plan) {
            return null;
        }
        moveBlocksInScene(live, plan);
        return live.rootBlockIds;
    }

    it("steps one row over its neighbour, either way", () => {
        expect(nudged(rows("a", "b", "c"), ["b"], "up")).toEqual(["b", "a", "c"]);
        expect(nudged(rows("a", "b", "c"), ["b"], "down")).toEqual(["a", "c", "b"]);
    });

    it("hops a run of adjacent rows over the one line beyond it, keeping their order", () => {
        expect(nudged(rows("a", "b", "c", "d"), ["b", "c"], "up")).toEqual(["b", "c", "a", "d"]);
        expect(nudged(rows("a", "b", "c", "d"), ["b", "c"], "down")).toEqual(["a", "d", "b", "c"]);
    });

    it("keeps the gaps in a split selection - each run steps over its own neighbour", () => {
        expect(nudged(rows("a", "b", "c", "d"), ["a", "c"], "down")).toEqual(["b", "a", "d", "c"]);
        expect(nudged(rows("a", "b", "c", "d"), ["b", "d"], "up")).toEqual(["b", "a", "d", "c"]);
    });

    it("is undone by the opposite direction, which a selection that collapsed its gaps would not be", () => {
        const live = rows("a", "b", "c", "d", "e", "f");
        const selection = ["a", "c", "e"];
        expect(nudged(live, selection, "down")).toEqual(["b", "a", "d", "c", "f", "e"]);
        expect(nudged(live, selection, "up")).toEqual(["a", "b", "c", "d", "e", "f"]);
    });

    it("moves whole or not at all: one row against the end stops the others too", () => {
        expect(planSelectionNudge(rows("a", "b", "c"), ["a", "c"], "down")).toBeNull();
        expect(planSelectionNudge(rows("a", "b", "c"), ["a", "c"], "up")).toBeNull();
        expect(planSelectionNudge(rows("a", "b"), ["a", "b"], "up")).toBeNull();
        expect(planSelectionNudge(rows("a", "b"), [], "down")).toBeNull();
    });

    it("steps each run inside its own parent when the selection spans a container", () => {
        const live = scene([
            group("g", ["g1", "g2"]), narration("g1", "g"), narration("g2", "g"),
            narration("a"), narration("b"),
        ], ["g", "a", "b"]);
        // `g1` (inside the container) and `a` (outside it) each move down one, in their own list.
        expect(nudged(live, ["g1", "a"], "down")).toEqual(["g", "b", "a"]);
        expect(live.blocks.g.childrenIds).toEqual(["g2", "g1"]);
    });

    it("carries a selected container's children with it rather than moving them separately", () => {
        const live = scene([
            narration("a"),
            group("g", ["g1"]), narration("g1", "g"),
        ], ["a", "g"]);
        expect(nudged(live, ["g", "g1"], "up")).toEqual(["g", "a"]);
        expect(live.blocks.g.childrenIds).toEqual(["g1"]);
    });
});
