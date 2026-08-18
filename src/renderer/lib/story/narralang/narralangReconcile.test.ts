/**
 * The reconcile property: an edit reaches the row it was made on and no other.
 *
 * The fixture is built to be hostile. Every row in it that has a known normalisation is here on
 * purpose - a `displayable` aimed at a named object, a `kind: "variable"` condition, a `parallel`
 * carrying the mode its own word implies, a `setVariable` with a dead `value` beside its expression,
 * two rich runs the printer joins, a `transition` of `kind: "none"`, a `json` default. Re-parsing the
 * scene rewrites all seven while meaning exactly the same thing, which is the failure this module
 * exists to prevent: the author fixes a typo and the version history shows the whole scene.
 *
 * So the assertion is not "the edit worked". It is that every OTHER row comes back `toEqual` what it
 * was, id and all.
 */

import { describe, expect, it } from "vitest";

import type {
    StoryBlock,
    StoryBlockId,
    StoryExpression,
    StoryScene,
    StoryTextSegment,
    StoryVariableRef,
} from "@shared/types/story";
import { isValidStoryEntityId } from "@shared/utils/storyId";
import { createStoryExpressionScope, parseStoryExpression } from "@shared/utils/storyExpressionParser";

import { NARRALANG_DEFAULT_DIALECT, type NarralangDialect } from "./narralangDialect";
import { printNarralangSceneLines, type NarralangLookups } from "./narralangPrinter";
import { parseNarralangScene, readNarralangScriptLines, type NarralangParseLookups } from "./narralangParse";
import { reconcileNarralangScene, type NarralangReconcileResult } from "./narralangReconcile";

// --- The project the fixture is written against ---------------------------------------------------

const CHARACTERS: Record<string, string> = { "char-alice": "爱丽丝" };
const ASSETS: Record<string, string> = { "asset-bg": "corridor_dusk", "asset-bird": "bird", "asset-op": "opening" };
const SCENES: Record<string, string> = { "scene-2": "天台 · 夜" };

const lookups: NarralangLookups = {
    character: (id) => (CHARACTERS[id] ? { name: CHARACTERS[id] } : null),
    assetName: (id) => ASSETS[id] ?? null,
    appearanceName: () => null,
    motionName: () => null,
    appTagName: () => null,
};

const byName = <T,>(table: Record<string, T>) => (name: string): string | null =>
    Object.entries(table).find(([, entry]) => entry === name)?.[0] ?? null;

const parseLookups: NarralangParseLookups = {
    characterId: byName(CHARACTERS),
    assetId: byName(ASSETS),
    sceneId: byName(SCENES),
    appearanceRef: () => ({ kind: "puppet" }),
};

// --- Fixture ---------------------------------------------------------------------------------------

function text(value: string, role: StoryTextSegment["role"], rich?: StoryTextSegment["rich"]): StoryTextSegment {
    return rich === undefined ? { textId: `t-${value}`, value, role } : { textId: `t-${value}`, value, role, rich };
}

function scene(blocks: (Omit<StoryBlock, "parentId" | "childrenIds"> & { children?: string[] })[]): StoryScene {
    const byId: Record<string, StoryBlock> = {};
    const claimed = new Set<string>();
    for (const block of blocks) {
        for (const childId of block.children ?? []) {
            claimed.add(childId);
        }
    }
    for (const block of blocks) {
        const { children, ...rest } = block;
        byId[block.id] = { ...rest, parentId: null, childrenIds: children ?? [] } as StoryBlock;
    }
    for (const block of blocks) {
        for (const childId of block.children ?? []) {
            const child = byId[childId];
            if (child) {
                (child as { parentId: string | null }).parentId = block.id;
            }
        }
    }
    return {
        id: "scene-1",
        name: "走廊 · 傍晚",
        runtimeName: "corridor_dusk",
        rootBlockIds: blocks.map((block) => block.id).filter((id) => !claimed.has(id)),
        blocks: byId,
    };
}

const TRUST: StoryVariableRef = { scope: "scene", variableId: "n-var" };

function expr(source: string): StoryExpression {
    return parseStoryExpression(source, createStoryExpressionScope([{ name: "trust", ref: TRUST }])).expression;
}

/** Every row here that a re-parse would rewrite is commented with what it would rewrite it into. */
const hostile: StoryScene = scene([
    // `none` is a transition that prints nothing, so nothing brings it back.
    { id: "n1", kind: "action", payload: { action: "setBackground", assetId: "asset-bg", transition: { kind: "none" } } },
    // Two runs, one line: nothing in the text says where the join was.
    {
        id: "n2",
        kind: "nodeAction",
        payload: {
            action: "narration",
            text: text("重要的事", "narration", [{ text: "重要" }, { text: "的事" }]),
        },
    },
    { id: "n3", kind: "nodeAction", payload: { action: "dialogue", characterId: "char-alice", text: text("你也留到这么晚啊。", "dialogue") } },
    { id: "n4", kind: "action", payload: { action: "image", operation: "create", objectName: "bird", assetId: "asset-bird" } },
    // The raw channel aimed at a named object. `show bird` reads back as the image's own verb.
    {
        id: "n5",
        kind: "action",
        payload: {
            action: "displayable",
            operation: "show",
            target: { kind: "image", name: "bird", sourceBlockId: "n4" },
            transform: { to: { opacity: 1 }, durationMs: 300 },
        },
    },
    { id: "n-var", kind: "declaration", payload: { scope: "scene", name: "trust", valueType: "number", defaultValue: 0, storageKey: "n-var" } },
    // `String(value)` on an array is not a value; the printer writes the JSON and the reader takes it back.
    { id: "n6", kind: "declaration", payload: { scope: "scene", name: "inv", valueType: "json", defaultValue: [1, 2], storageKey: "n6" } },
    { id: "n7", kind: "control", payload: { control: "condition" }, children: ["n8"] },
    // A variable-shaped condition prints as the expression it means, and comes back as one.
    {
        id: "n8",
        kind: "control",
        payload: { control: "conditionBranch", branch: "if", condition: { kind: "variable", target: TRUST, operator: "isTrue" } },
        children: ["n9", "n17"],
    },
    { id: "n9", kind: "nodeAction", payload: { action: "narration", text: text("那……一起走？", "narration") } },
    // A chain inside a chain: the container each row belongs to is a matter of how many stand above it.
    { id: "n17", kind: "control", payload: { control: "condition" }, children: ["n18"] },
    {
        id: "n18",
        kind: "control",
        payload: { control: "conditionBranch", branch: "if", condition: { kind: "expression", expression: expr("trust > 1") } },
        children: ["n19"],
    },
    { id: "n19", kind: "nodeAction", payload: { action: "narration", text: text("她笑了。", "narration") } },
    // `all` is what a bare `parallel:` means, so the mode is not printed and does not return.
    { id: "n10", kind: "control", payload: { control: "parallel", mode: "all" }, children: ["n11"] },
    { id: "n11", kind: "action", payload: { action: "wait", mode: "click" } },
    // A `value` beside an expression is dead, and the script carries only the live one.
    { id: "n12", kind: "action", payload: { action: "setVariable", target: TRUST, value: 5, expression: expr("trust + 1") } },
    { id: "n13", kind: "nodeAction", payload: { action: "choice", prompt: text("要说点什么吗？", "choicePrompt") }, children: ["n14"] },
    { id: "n14", kind: "nodeAction", payload: { action: "choiceOption", text: text("「其实我在等你。」", "choiceText") } },
    { id: "n15", kind: "note", payload: { text: text("这里以后要补一段回忆闪回", "note") } },
    { id: "n16", kind: "nodeAction", payload: { action: "narration", text: text("我什么也没说。", "narration") }, disabled: true },
] as never);

const SCENE_TABLE: Record<string, StoryScene> = {
    "scene-2": { id: "scene-2", name: "天台 · 夜", runtimeName: "rooftop", rootBlockIds: [], blocks: {} },
};

function printerLookups(fixture: StoryScene): NarralangLookups {
    return { ...lookups, scenes: { ...SCENE_TABLE, "scene-1": fixture } };
}

function script(fixture: StoryScene, dialect: NarralangDialect = NARRALANG_DEFAULT_DIALECT): string {
    const printed = printNarralangSceneLines(fixture, printerLookups(fixture), dialect);
    expect(printed.issues).toEqual([]);
    return printed.text;
}

function reconcile(fixture: StoryScene, nextText: string, dialect?: NarralangDialect): NarralangReconcileResult {
    return reconcileNarralangScene({ scene: fixture, nextText, lookups: printerLookups(fixture), parseLookups, dialect });
}

/** The reconcile, with the refusal turned into a readable failure rather than a type narrowing. */
function reconciled(fixture: StoryScene, nextText: string, dialect?: NarralangDialect) {
    const result = reconcile(fixture, nextText, dialect);
    if (!result.ok) {
        throw new Error(`refused: ${JSON.stringify(result.diagnostics)}\n${nextText}`);
    }
    return result;
}

// --- Editing the text -------------------------------------------------------------------------------

function editLine(source: string, needle: string, replacement: string): string {
    expect(source.split(needle)).toHaveLength(2);
    return source.replace(needle, replacement);
}

/** Every id a row still points at that is no longer in the scene - the thing a repair must leave none of. */
function danglingReferences(blocks: Record<StoryBlockId, StoryBlock>): string[] {
    const present = new Set(Object.keys(blocks));
    const dead = new Set(Object.keys(hostile.blocks).filter((id) => !present.has(id)));
    const found: string[] = [];
    const visit = (value: unknown): void => {
        if (typeof value === "string") {
            if (dead.has(value)) {
                found.push(value);
            }
        } else if (Array.isArray(value)) {
            value.forEach(visit);
        } else if (value !== null && typeof value === "object") {
            Object.values(value).forEach(visit);
        }
    };
    Object.values(blocks).forEach((block) => visit(block.payload));
    return found;
}

function lineIndex(lines: readonly string[], needle: string): number {
    const index = lines.findIndex((line) => line.trim() === needle.trim());
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

// --- The property -------------------------------------------------------------------------------------

/** Lines of the printed fixture, by the row they belong to. */
const DIALOGUE = "  爱丽丝: 你也留到这么晚啊。";
const RICH = "重要的事";
const CREATE = "image create bird bird";
const DISABLED = "~ 我什么也没说。";
const MENU = "menu 要说点什么吗？:";
const PARALLEL = "parallel:";

describe("reconcileNarralangScene", () => {
    it("hands the reconciler the same lines the parser will read", () => {
        // The line table and the line tree are two readings of one text, and an id landing on the line
        // below the one it was meant for is silent. Asserted here so it cannot become silent.
        const printed = printNarralangSceneLines(hostile, printerLookups(hostile), NARRALANG_DEFAULT_DIALECT);
        const read = readNarralangScriptLines(printed.text, NARRALANG_DEFAULT_DIALECT);
        expect(read.map((entry) => entry.source)).toEqual(printed.lines.map((entry) => entry.text));
        expect(read.map((entry) => entry.line)).toEqual(printed.lines.map((entry) => entry.line));
    });

    it("returns the scene it was given when nothing was edited", () => {
        const result = reconciled(hostile, script(hostile));
        expect(result.touchedBlockIds).toEqual([]);
        expect(result.rootBlockIds).toEqual(hostile.rootBlockIds);
        expect(result.blocks).toEqual(hostile.blocks);
    });

    it("returns the scene it was given when nothing was edited, in another dialect", () => {
        const shouted: NarralangDialect = { ...NARRALANG_DEFAULT_DIALECT, id: "wide", indent: "    " };
        const result = reconciled(hostile, script(hostile, shouted), shouted);
        expect(result.touchedBlockIds).toEqual([]);
        expect(result.blocks).toEqual(hostile.blocks);
    });

    // --- The one that matters -------------------------------------------------------------------------

    it("a single edited line leaves every other row byte-identical, id included", () => {
        const next = editLine(script(hostile), DIALOGUE, "  爱丽丝: 你今天也留到这么晚啊。");
        const result = reconciled(hostile, next);

        // The edit landed.
        expect(result.touchedBlockIds).toEqual(["n3"]);
        expect((result.blocks.n3.payload as { text: StoryTextSegment }).text.value).toBe("你今天也留到这么晚啊。");

        // And nowhere else. Not "equivalent to": the same object, id and all.
        for (const [id, block] of Object.entries(hostile.blocks)) {
            if (id === "n3") {
                continue;
            }
            expect(result.blocks[id]).toEqual(block);
        }
        expect(Object.keys(result.blocks)).toHaveLength(Object.keys(hostile.blocks).length);
    });

    it("an edited line keeps its row and its translation unit", () => {
        // The other half of the property above. A `textId` is what every translation of the line is
        // filed under, so a row that comes back with a fresh one has quietly lost all of them - over a
        // typo. Only the payload may move.
        const previous = hostile.blocks.n3;
        const result = reconciled(hostile, editLine(script(hostile), DIALOGUE, "  爱丽丝: 你今天也留到这么晚啊。"));

        const edited = result.blocks.n3;
        expect(edited.id).toBe("n3");
        expect(edited.kind).toBe(previous.kind);
        expect(edited.parentId).toBe(previous.parentId);
        expect((edited.payload as { text: StoryTextSegment }).text.textId)
            .toBe((previous.payload as { text: StoryTextSegment }).text.textId);
        expect((edited.payload as { text: StoryTextSegment }).text.value).not
            .toBe((previous.payload as { text: StoryTextSegment }).text.value);
        expect(result.touchedBlockIds).toEqual(["n3"]);
    });

    it("reports the name off the header without acting on it", () => {
        const next = script(hostile).replace("scene '走廊 · 傍晚':", "scene '走廊 · 深夜':");
        const result = reconciled(hostile, next);

        expect(result.sceneName).toBe("走廊 · 深夜");
        expect(result.touchedBlockIds).toEqual([]);
        expect(result.blocks).toEqual(hostile.blocks);
    });

    it("re-parsing the same text instead would have rewritten the rows nobody touched", () => {
        // The control for the test above: every one of these is what a whole-scene re-parse produces,
        // and none of them is what the author's document said.
        const next = editLine(script(hostile), DIALOGUE, "  爱丽丝: 你今天也留到这么晚啊。");
        const reparsed = parseNarralangScene(next, parseLookups);
        expect(reparsed.diagnostics).toEqual([]);
        const payloads = Object.values(reparsed.blocks).map((block) => block.payload as Record<string, unknown>);

        expect(payloads.some((payload) => payload.action === "displayable")).toBe(false);
        expect(payloads.some((payload) => payload.control === "parallel" && payload.mode !== undefined)).toBe(false);
        expect(payloads.find((payload) => payload.action === "setVariable")?.value).toBeNull();
        expect(payloads.some((payload) => payload.action === "setBackground" && payload.transition !== undefined)).toBe(false);
        const branch = payloads.find((payload) => payload.control === "conditionBranch");
        expect((branch?.condition as { kind: string }).kind).toBe("expression");
        const rich = payloads
            .map((payload) => payload.text as StoryTextSegment | undefined)
            .find((segment) => segment?.value === "重要的事")?.rich;
        expect(rich?.length ?? 0).not.toBe(2);

        // The same rows, through the reconciler.
        const result = reconciled(hostile, next);
        expect(result.blocks.n5.payload).toMatchObject({ action: "displayable", operation: "show" });
        expect(result.blocks.n10.payload).toMatchObject({ control: "parallel", mode: "all" });
        expect(result.blocks.n12.payload).toMatchObject({ action: "setVariable", value: 5 });
        expect(result.blocks.n8.payload).toMatchObject({ condition: { kind: "variable", operator: "isTrue" } });
        expect(result.blocks.n1.payload).toMatchObject({ transition: { kind: "none" } });
        expect((result.blocks.n2.payload as { text: StoryTextSegment }).text.rich).toHaveLength(2);
    });

    // --- The other four edits ---------------------------------------------------------------------------

    it("an inserted line is the only new row", () => {
        const lines = script(hostile).split("\n");
        lines.splice(lineIndex(lines, DIALOGUE) + 1, 0, "  她没有回头。");
        const result = reconciled(hostile, lines.join("\n"));

        expect(result.touchedBlockIds).toHaveLength(1);
        const inserted = result.blocks[result.touchedBlockIds[0]];
        expect((inserted.payload as { text: StoryTextSegment }).text.value).toBe("她没有回头。");
        expect(isValidStoryEntityId(inserted.id)).toBe(true);
        for (const [id, block] of Object.entries(hostile.blocks)) {
            expect(result.blocks[id]).toEqual(block);
        }
        expect(result.rootBlockIds).toContain(inserted.id);
    });

    it("a deleted line takes only its own row", () => {
        const lines = script(hostile).split("\n");
        lines.splice(lineIndex(lines, DIALOGUE), 1);
        const result = reconciled(hostile, lines.join("\n"));

        expect(result.touchedBlockIds).toEqual([]);
        expect(result.blocks.n3).toBeUndefined();
        expect(result.rootBlockIds).not.toContain("n3");
        for (const [id, block] of Object.entries(hostile.blocks)) {
            if (id === "n3") {
                continue;
            }
            expect(result.blocks[id]).toEqual(block);
        }
    });

    it("a passage moved elsewhere keeps its rows", () => {
        const lines = script(hostile).split("\n").filter((line) => line !== "");
        const moved = lines.splice(lineIndex(lines, RICH), 2);
        lines.push(...moved);
        const result = reconciled(hostile, lines.join("\n"));

        expect(result.touchedBlockIds).toEqual([]);
        for (const [id, block] of Object.entries(hostile.blocks)) {
            expect(result.blocks[id]).toEqual(block);
        }
        // Same rows, in the order the text now puts them.
        expect([...result.rootBlockIds].sort()).toEqual([...hostile.rootBlockIds].sort());
        expect(result.rootBlockIds.slice(-2)).toEqual(["n2", "n3"]);
        expect(result.rootBlockIds).not.toEqual(hostile.rootBlockIds);
    });

    it("a re-indented line hangs off its new parent and stays the same row", () => {
        const lines = script(hostile).split("\n");
        const index = lineIndex(lines, DIALOGUE);
        const [line] = lines.splice(index, 1);
        lines.splice(lineIndex(lines, PARALLEL) + 1, 0, `  ${line}`);
        const result = reconciled(hostile, lines.join("\n"));

        expect(result.touchedBlockIds).toEqual([]);
        expect(result.blocks.n3.payload).toEqual(hostile.blocks.n3.payload);
        expect(result.blocks.n3.parentId).toBe("n10");
        expect(result.blocks.n10.childrenIds).toEqual(["n3", "n11"]);
        expect(result.rootBlockIds).not.toContain("n3");
    });

    it("keeps the branch, and the container it hangs off, when the branch line is edited", () => {
        const result = reconciled(hostile, editLine(script(hostile), "if trust:", "if trust > 0:"));

        expect(result.touchedBlockIds).toEqual(["n8"]);
        expect(result.blocks.n7).toEqual(hostile.blocks.n7);
        expect(result.blocks.n8.payload).toMatchObject({ control: "conditionBranch", branch: "if" });
        expect(result.blocks.n17).toEqual(hostile.blocks.n17);
        expect(result.blocks.n19).toEqual(hostile.blocks.n19);
        expect(danglingReferences(result.blocks)).toEqual([]);
    });

    it("leaves an inner chain's container where it was when the chain around it is unwrapped", () => {
        // The container writes no line, so it is recovered by counting how many stand above a row that
        // survived. Deleting the outer `if` and pulling its body out a level is what tells the two
        // containers apart: the nearest container above these rows is the INNER one, not the one that
        // is gone.
        const lines = script(hostile).split("\n");
        lines.splice(lineIndex(lines, "if trust:"), 1);
        for (const needle of ["那……一起走？", "if trust > 1:", "她笑了。"]) {
            const at = lineIndex(lines, needle);
            lines[at] = lines[at].slice(2);
        }
        const result = reconciled(hostile, lines.join("\n"));

        expect(result.blocks.n7).toBeUndefined();
        expect(result.blocks.n8).toBeUndefined();
        expect(result.blocks.n17).toEqual({ ...hostile.blocks.n17, parentId: null });
        expect(result.blocks.n18).toEqual(hostile.blocks.n18);
        expect(result.blocks.n19).toEqual(hostile.blocks.n19);
        expect(result.blocks.n9).toEqual({ ...hostile.blocks.n9, parentId: null });
        expect(result.touchedBlockIds).toEqual([]);
        expect(danglingReferences(result.blocks)).toEqual([]);
    });

    it("edits the twin the author edited", () => {
        // Two rows that read the same are the classic way a line-based match binds the wrong one. The
        // edit is on the FIRST of them, which is the half a naive scan gets backwards.
        const twins = scene([
            { id: "w1", kind: "nodeAction", payload: { action: "narration", text: { textId: "t-1", value: "同一句话。", role: "narration" } } },
            { id: "w2", kind: "nodeAction", payload: { action: "narration", text: { textId: "t-2", value: "同一句话。", role: "narration" } } },
            { id: "w3", kind: "nodeAction", payload: { action: "narration", text: { textId: "t-3", value: "然后她走了。", role: "narration" } } },
        ] as never);
        const printed = printNarralangSceneLines(twins, printerLookups(twins), NARRALANG_DEFAULT_DIALECT);
        const next = printed.text.replace("  同一句话。", "  换了一句话。");
        const result = reconcileNarralangScene({
            scene: twins,
            nextText: next,
            lookups: printerLookups(twins),
            parseLookups,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.touchedBlockIds).toEqual(["w1"]);
        expect((result.blocks.w1.payload as { text: StoryTextSegment }).text)
            .toMatchObject({ textId: "t-1", value: "换了一句话。" });
        expect(result.blocks.w2).toEqual(twins.blocks.w2);
        expect(result.blocks.w3).toEqual(twins.blocks.w3);
    });

    // --- The refusals -------------------------------------------------------------------------------------

    it("refuses the whole scene when one line does not read", () => {
        const lines = script(hostile).split("\n");
        lines.splice(lineIndex(lines, DIALOGUE) + 1, 0, "  wait 一会儿");
        const result = reconcile(hostile, lines.join("\n"));

        expect(result.ok).toBe(false);
        expect(result).not.toHaveProperty("blocks");
        expect(result).not.toHaveProperty("rootBlockIds");
        if (!result.ok) {
            expect(result.diagnostics.length).toBeGreaterThan(0);
        }
    });

    // --- Where identity moves anyway ------------------------------------------------------------------------

    it("leaves the rows pointing at an edited row alone while it still answers to the same name", () => {
        // `show bird` holds the id of the row that created `bird`. That row changed, but not in the
        // half a reference asks about, so re-reading the rows that point at it would only re-normalise
        // work nobody touched.
        const result = reconciled(hostile, editLine(script(hostile), CREATE, "image create bird opening"));

        expect(result.touchedBlockIds).toEqual(["n4"]);
        expect(result.blocks.n4.payload).toMatchObject({ objectName: "bird", assetId: "asset-op" });
        expect(result.blocks.n5).toEqual(hostile.blocks.n5);
    });

    it("leaves a variable's readers alone when only its default moved", () => {
        const result = reconciled(hostile, editLine(script(hostile), "var trust: number = 0", "var trust: number = 1"));

        expect(result.touchedBlockIds).toEqual(["n-var"]);
        expect(result.blocks["n-var"].payload).toMatchObject({ name: "trust", defaultValue: 1 });
        // The two rows that read it keep the shapes a re-parse would have flattened.
        expect(result.blocks.n8).toEqual(hostile.blocks.n8);
        expect(result.blocks.n12).toEqual(hostile.blocks.n12);
    });

    it("re-reads a row whose reference now names something else", () => {
        // The row `show bird` points at is still there and still has its id - but it creates `cat` now,
        // and a second row took the name. The stored reference is a lie, so the row is read again.
        const lines = script(hostile).split("\n");
        lines.splice(lineIndex(lines, CREATE), 1, "  image create cat bird", "  image create bird opening");
        const result = reconciled(hostile, lines.join("\n"));

        expect(result.blocks.n4.payload).toMatchObject({ objectName: "cat" });
        expect(result.blocks.n5).toBeDefined();
        expect(result.blocks.n5.payload).toMatchObject({ operation: "show", objectName: "bird" });
        expect(JSON.stringify(result.blocks.n5.payload)).not.toContain("\"n4\"");
        expect(result.touchedBlockIds).toContain("n5");
        expect(danglingReferences(result.blocks)).toEqual([]);

        // And the re-reading stops there: two edited rows, one new one, nothing else.
        expect(result.touchedBlockIds).toHaveLength(3);
    });

    it("re-reads a line whose meaning changed with its parent, keeping the row", () => {
        // Under a `menu` every child is one of its options, so this line says something else than it
        // did - the same words, a different row. The payload has to be the new reading.
        const lines = script(hostile).split("\n");
        const [line] = lines.splice(lineIndex(lines, DISABLED), 1);
        lines.splice(lineIndex(lines, MENU) + 1, 0, `  ${line}`);
        const result = reconciled(hostile, lines.join("\n"));

        expect(result.blocks.n16.payload).toMatchObject({ action: "choiceOption" });
        expect(result.blocks.n16.disabled).toBe(true);
        expect(result.blocks.n16.parentId).toBe("n13");
        expect(result.touchedBlockIds).toEqual(["n16"]);
    });
});
