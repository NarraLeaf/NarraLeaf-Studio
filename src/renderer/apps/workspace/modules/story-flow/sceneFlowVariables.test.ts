import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryActionPayload, StoryBlock, StoryDocument, StoryExpr, StoryScene, StoryVariableScope } from "@shared/types/story";
import { buildSceneFlowGraph } from "./sceneFlowModel";
import {
    branchDeltaFor,
    collectBranchEffects,
    collectSceneEffects,
    computeVariableRanges,
    listNumericStoryVariables,
    readSetVariableDelta,
} from "./sceneFlowVariables";

/** The row an assertion is about, without re-narrowing the block union in every test. */
const payloadOf = (block: StoryBlock): Extract<StoryActionPayload, { action: "setVariable" }> =>
    (block as Extract<StoryBlock, { kind: "action" }>).payload as Extract<StoryActionPayload, { action: "setVariable" }>;

/** The declaration row IS the variable (schema v6), so its block id is what refs address. */
const AFFECTION = "var_affection";
const AFFECTION_KEY = "saved:var_affection";
const GOLD = "var_gold";

function declarationBlock(
    id: string,
    scope: StoryVariableScope,
    name: string,
    valueType: "number" | "string" | "boolean",
    defaultValue?: number | string | boolean,
): StoryBlock {
    return {
        id,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: {
            scope,
            name,
            valueType,
            storageKey: id,
            ...(defaultValue !== undefined ? { defaultValue } : {}),
        },
    } as StoryBlock;
}

/** `/set <variable> <literal>` - the shape a committed literal assignment takes (no `expression`). */
function setLiteralBlock(
    id: string,
    value: number | string | boolean,
    parentId: string | null = null,
    variableId: string = AFFECTION,
): StoryBlock {
    return {
        id,
        kind: "action",
        parentId,
        childrenIds: [],
        payload: { action: "setVariable", target: { scope: "saved", variableId }, value },
    } as StoryBlock;
}

/** `/set <variable> <expression>` - `expression` wins, `value` is only the last literal the row held. */
function setExpressionBlock(
    id: string,
    ast: StoryExpr,
    source: string,
    parentId: string | null = null,
    variableId: string = AFFECTION,
): StoryBlock {
    return {
        id,
        kind: "action",
        parentId,
        childrenIds: [],
        payload: {
            action: "setVariable",
            target: { scope: "saved", variableId },
            value: 0,
            expression: { source, ast },
        },
    } as StoryBlock;
}

const readVariable = (variableId: string, name: string): StoryExpr =>
    ({ kind: "var", target: { scope: "saved", variableId }, name });

/** The tree `/inc` builds, and the identical tree `/set 好感 好感 + 2` typed longhand parses to. */
const stepAst = (op: "+" | "-", step: number, variableId: string = AFFECTION): StoryExpr =>
    ({ kind: "binary", op, left: readVariable(variableId, "好感"), right: { kind: "literal", value: step } });

function jumpBlock(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
}

function choiceBlock(id: string, childrenIds: string[], parentId: string | null = null): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds,
        payload: { action: "choice", prompt: { textId: `${id}-prompt`, value: "", role: "choicePrompt" } },
    } as StoryBlock;
}

function choiceOptionBlock(id: string, childrenIds: string[], text: string, parentId: string | null = null): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds,
        payload: { action: "choiceOption", text: { textId: `${id}-text`, value: text, role: "choiceText" } },
    } as StoryBlock;
}

function conditionBranchBlock(
    id: string,
    childrenIds: string[],
    branch: "if" | "elseIf" | "else",
    source?: string,
    parentId: string | null = null,
): StoryBlock {
    return {
        id,
        kind: "control",
        parentId,
        childrenIds,
        payload: {
            control: "conditionBranch",
            branch,
            ...(source
                ? { condition: { kind: "expression" as const, expression: { source, expr: { kind: "literal" as const, value: true } } } }
                : {}),
        },
    } as StoryBlock;
}

function repeatBlock(id: string, childrenIds: string[], parentId: string | null = null): StoryBlock {
    return { id, kind: "control", parentId, childrenIds, payload: { control: "repeat", times: 2 } };
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: blocks.filter(block => !block.parentId).map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function document(scenes: StoryScene[], entrySceneId?: string): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        entrySceneId,
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: scenes.map(item => item.id) }],
        scenes: Object.fromEntries(scenes.map(item => [item.id, item])),
    } as StoryDocument;
}

/** The declaration row every range fixture below counts from: 好感, saved, starting at 0. */
const affectionDecl = declarationBlock(AFFECTION, "saved", "好感", "number", 0);

/** Ranges keyed by scene, flattened to something a failure message can be read out of. */
function rangeTuples(ranges: Map<string, { kind: string; min?: number; max?: number }>): Record<string, string> {
    return Object.fromEntries(Array.from(ranges, ([sceneId, range]) =>
        [sceneId, range.kind === "known" ? `${range.min}..${range.max}` : "?"]));
}

describe("readSetVariableDelta", () => {
    it("reads /inc and the longhand assignment that means the same thing identically", () => {
        // The whole reason the recognition is structural: `/set 好感 好感 + 2` typed by hand IS an
        // increment, and a stored "this row was made by /inc" flag would score the two differently.
        const sugar = setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)");
        const longhand = setExpressionBlock("w2", stepAst("+", 2), "好感 + 2");

        expect(readSetVariableDelta(payloadOf(sugar))).toEqual({ op: "add", amount: 2 });
        expect(readSetVariableDelta(payloadOf(longhand)))
            .toEqual(readSetVariableDelta(payloadOf(sugar)));
    });

    it("reads /dec as a negative amount and a literal /set as a set", () => {
        expect(readSetVariableDelta(payloadOf(setExpressionBlock("w1", stepAst("-", 3), "好感 - (3)"))))
            .toEqual({ op: "add", amount: -3 });
        expect(readSetVariableDelta(payloadOf(setLiteralBlock("w2", 5))))
            .toEqual({ op: "set", value: 5 });
        // A literal that arrived as an expression tree rather than folded into `value` is the same row.
        expect(readSetVariableDelta(payloadOf(setExpressionBlock("w3", { kind: "literal", value: 5 }, "5"))))
            .toEqual({ op: "set", value: 5 });
    });

    it("refuses to derive a number from anything it cannot read", () => {
        // Each of these is a value the map has no way to pin down, and pinning one down anyway is how
        // a route planner starts telling the author a number that is not true.
        const otherVariable = setExpressionBlock("w1", {
            kind: "binary", op: "+", left: readVariable(GOLD, "gold"), right: { kind: "literal", value: 1 },
        }, "gold + 1");
        const call = setExpressionBlock("w2", {
            kind: "call", fn: "min", args: [readVariable(AFFECTION, "好感"), { kind: "literal", value: 10 }],
        }, "min(好感, 10)");
        const invalid = setExpressionBlock("w3", { kind: "invalid", source: "好感 +" }, "好感 +");
        const nonNumeric = setLiteralBlock("w4", "high");

        for (const block of [otherVariable, call, invalid, nonNumeric]) {
            expect(readSetVariableDelta(payloadOf(block))).toEqual({ op: "unknown" });
        }
    });

    it("does not read the target off the right-hand side", () => {
        // `好感 = 2 + 好感` is arithmetically the same increment, but the recognition is left-operand
        // only, exactly as `describeAssignment` words it - two readings of one sugar is the drift.
        const flipped = setExpressionBlock("w1", {
            kind: "binary", op: "+", left: { kind: "literal", value: 2 }, right: readVariable(AFFECTION, "好感"),
        }, "2 + 好感");

        expect(readSetVariableDelta(payloadOf(flipped))).toEqual({ op: "unknown" });
    });
});

describe("collectSceneEffects", () => {
    it("collects writes on the scene spine, in document order, as certain", () => {
        const story = document([
            scene("a", "Opening", [
                affectionDecl,
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)"),
                setLiteralBlock("w2", 5),
            ]),
        ], "a");

        expect(collectSceneEffects(story).get("a")).toEqual([
            { variableKey: AFFECTION_KEY, delta: { op: "add", amount: 2 }, certain: true },
            { variableKey: AFFECTION_KEY, delta: { op: "set", value: 5 }, certain: true },
        ]);
    });

    it("leaves a write under a fork off the scene's own spine", () => {
        const story = document([
            scene("a", "Opening", [
                affectionDecl,
                choiceBlock("c1", ["o1"]),
                choiceOptionBlock("o1", ["w1"], "跟她走", "c1"),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)", "o1"),
            ]),
        ], "a");

        expect(collectSceneEffects(story).has("a")).toBe(false);
    });

    it("cannot count an accumulate inside a repeat", () => {
        // The body runs a number of times nothing here knows (`times` is optional, and the loop may be
        // left early), so `+2` compounds by an unknown factor. A `set` survives: assigning the same
        // literal N times leaves the same value.
        const story = document([
            scene("a", "Grind", [
                affectionDecl,
                repeatBlock("r1", ["w1", "w2"]),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)", "r1"),
                setLiteralBlock("w2", 5, "r1"),
            ]),
        ], "a");

        expect(collectSceneEffects(story).get("a")?.map(effect => effect.delta))
            .toEqual([{ op: "unknown" }, { op: "set", value: 5 }]);
    });

    it("does not count a write the author disabled", () => {
        // A disabled row is compiled out with its whole subtree, so counting it would move a counter
        // the shipped game never moves.
        const disabled = { ...setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)"), disabled: true } as StoryBlock;
        const story = document([scene("a", "Opening", [affectionDecl, disabled, setLiteralBlock("w2", 5)])], "a");

        expect(collectSceneEffects(story).get("a")).toEqual([
            { variableKey: AFFECTION_KEY, delta: { op: "set", value: 5 }, certain: true },
        ]);
    });
});

describe("collectBranchEffects", () => {
    /** An option that writes, containing an `if` that writes again - the nesting case M1 calls out. */
    function nestedForkDocument(): StoryDocument {
        return document([
            scene("a", "Crossroads", [
                affectionDecl,
                choiceBlock("c1", ["o1"]),
                choiceOptionBlock("o1", ["w1", "if1"], "跟她走", "c1"),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)", "o1"),
                conditionBranchBlock("if1", ["w2"], "if", "好感 >= 5", "o1"),
                setExpressionBlock("w2", stepAst("+", 3), "好感 + (3)", "if1"),
            ]),
        ], "a");
    }

    it("attributes a write on an option's own spine to that option, certainly", () => {
        const story = document([
            scene("a", "Crossroads", [
                affectionDecl,
                choiceBlock("c1", ["o1"]),
                choiceOptionBlock("o1", ["w1"], "跟她走", "c1"),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)", "o1"),
            ]),
        ], "a");
        const graph = buildSceneFlowGraph(story);

        expect(collectBranchEffects(graph, story).get("scene-flow:branch:o1")).toEqual([
            { variableKey: AFFECTION_KEY, delta: { op: "add", amount: 2 }, certain: true },
        ]);
    });

    it("gives a write under a nested if to the inner arm, and shows it to the outer one as uncertain", () => {
        const story = nestedForkDocument();
        const effects = collectBranchEffects(buildSceneFlowGraph(story), story);

        // The option is how the player got here, so the write is on its list - but whether it happens
        // is the `if`'s answer, not the option's.
        expect(effects.get("scene-flow:branch:o1")).toEqual([
            { variableKey: AFFECTION_KEY, delta: { op: "add", amount: 2 }, certain: true },
            { variableKey: AFFECTION_KEY, delta: { op: "add", amount: 3 }, certain: false },
        ]);
        expect(effects.get("scene-flow:branch:if1")).toEqual([
            { variableKey: AFFECTION_KEY, delta: { op: "add", amount: 3 }, certain: true },
        ]);
    });

    it("omits an arm that touches nothing rather than listing it empty", () => {
        const story = document([
            scene("a", "Crossroads", [
                affectionDecl,
                choiceBlock("c1", ["o1", "o2"]),
                choiceOptionBlock("o1", ["w1"], "跟她走", "c1"),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)", "o1"),
                choiceOptionBlock("o2", [], "留下", "c1"),
            ]),
        ], "a");

        expect(Array.from(collectBranchEffects(buildSceneFlowGraph(story), story).keys()))
            .toEqual(["scene-flow:branch:o1"]);
    });

    it("nets an arm's movement for the chip, and admits when it cannot", () => {
        const story = nestedForkDocument();
        const effects = collectBranchEffects(buildSceneFlowGraph(story), story);

        // 0 or 2 or 5 - a chip cannot say "one of these", and the inner arm carries its own +3 anyway.
        expect(branchDeltaFor(effects.get("scene-flow:branch:o1") ?? [], AFFECTION_KEY)).toEqual({ op: "unknown" });
        expect(branchDeltaFor(effects.get("scene-flow:branch:if1") ?? [], AFFECTION_KEY)).toEqual({ op: "add", amount: 3 });
        // Never touching the variable and touching it unreadably are different answers: the first is
        // what dims a path out of the divergence line, the second is what draws `?` on it.
        expect(branchDeltaFor(effects.get("scene-flow:branch:if1") ?? [], "saved:var_gold")).toBeNull();
    });

    it("folds a later set over the adds before it", () => {
        const story = document([
            scene("a", "Crossroads", [
                affectionDecl,
                choiceBlock("c1", ["o1"]),
                choiceOptionBlock("o1", ["w1", "w2", "w3"], "跟她走", "c1"),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)", "o1"),
                setLiteralBlock("w2", 5, "o1"),
                setExpressionBlock("w3", stepAst("+", 1), "好感 + (1)", "o1"),
            ]),
        ], "a");
        const effects = collectBranchEffects(buildSceneFlowGraph(story), story);

        expect(branchDeltaFor(effects.get("scene-flow:branch:o1") ?? [], AFFECTION_KEY)).toEqual({ op: "set", value: 6 });
    });
});

describe("computeVariableRanges", () => {
    function rangesOf(story: StoryDocument, variableKey: string = AFFECTION_KEY): Record<string, string> {
        return rangeTuples(computeVariableRanges(buildSceneFlowGraph(story), story, variableKey));
    }

    it("splits the range down two options and widens it where they meet again", () => {
        // The 好感度分歧线 in one fixture: +2 one way, -1 the other, and a scene reachable by both.
        const story = document([
            scene("a", "Crossroads", [
                affectionDecl,
                choiceBlock("c1", ["o1", "o2"]),
                choiceOptionBlock("o1", ["w1", "j1"], "跟她走", "c1"),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)", "o1"),
                jumpBlock("j1", "b", "o1"),
                choiceOptionBlock("o2", ["w2", "j2"], "留下", "c1"),
                setExpressionBlock("w2", stepAst("-", 1), "好感 - (1)", "o2"),
                jumpBlock("j2", "c", "o2"),
            ]),
            scene("b", "River", [jumpBlock("j3", "d")]),
            scene("c", "Street", [jumpBlock("j4", "d")]),
            scene("d", "Evening", []),
        ], "a");

        expect(rangesOf(story)).toEqual({ a: "0..0", b: "2..2", c: "-1..-1", d: "-1..2" });
    });

    it("counts the arms an arm is nested inside, on the way out through the inner one", () => {
        // The jump belongs to its nearest fork, so the edge hangs off `if1`. Taking only `if1`'s
        // subtree would drop the option's own +2 from every scene downstream, silently.
        const story = document([
            scene("a", "Crossroads", [
                affectionDecl,
                choiceBlock("c1", ["o1", "o2"]),
                choiceOptionBlock("o1", ["w1", "if1"], "跟她走", "c1"),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)", "o1"),
                conditionBranchBlock("if1", ["j1"], "if", "好感 >= 1", "o1"),
                jumpBlock("j1", "b", "if1"),
                // A sibling option's write is on nobody's path here, and must not leak into `b`.
                choiceOptionBlock("o2", ["w2"], "留下", "c1"),
                setExpressionBlock("w2", stepAst("+", 5), "好感 + (5)", "o2"),
            ]),
            scene("b", "River", []),
        ], "a");

        expect(rangesOf(story)).toEqual({ a: "0..0", b: "2..2" });
    });

    it("widens rather than commits where a deeper fork decides", () => {
        // The write under the `if` happens on some runs and not others, so `b` is reachable at either
        // value. Applying it would claim the condition held; dropping it would hide the 5.
        const story = document([
            scene("a", "Crossroads", [
                affectionDecl,
                choiceBlock("c1", ["o1"]),
                choiceOptionBlock("o1", ["if1", "j1"], "跟她走", "c1"),
                conditionBranchBlock("if1", ["w1"], "if", "好感 >= 1", "o1"),
                setExpressionBlock("w1", stepAst("+", 5), "好感 + (5)", "if1"),
                jumpBlock("j1", "b", "o1"),
            ]),
            scene("b", "River", []),
        ], "a");

        expect(rangesOf(story)).toEqual({ a: "0..0", b: "0..5" });
    });

    it("poisons every scene downstream of a write it cannot read", () => {
        const story = document([
            scene("a", "Opening", [
                affectionDecl,
                setExpressionBlock("w1", {
                    kind: "binary", op: "+", left: readVariable(GOLD, "gold"), right: { kind: "literal", value: 1 },
                }, "gold + 1"),
                jumpBlock("j1", "b"),
            ]),
            scene("b", "Hallway", [setExpressionBlock("w2", stepAst("+", 2), "好感 + (2)"), jumpBlock("j2", "c")]),
            scene("c", "Street", []),
        ], "a");

        // `a` still reports its arrival value - the unreadable write is one of ITS effects, and the
        // range is the value on arrival. Everything after it is `?`, and stays `?`: resuming the count
        // at `b`'s readable +2 would report a precise interval built on a number nobody knows.
        expect(rangesOf(story)).toEqual({ a: "0..0", b: "?", c: "?" });
    });

    it("reports a loop that moves the counter as unbounded instead of iterating it", () => {
        const story = document([
            scene("a", "Hub", [affectionDecl, jumpBlock("j1", "b")]),
            scene("b", "Grind", [setExpressionBlock("w1", stepAst("+", 1), "好感 + (1)"), jumpBlock("j2", "a")]),
        ], "a");

        expect(rangesOf(story)).toEqual({ a: "?", b: "?" });
    });

    it("keeps a loop that moves nothing exact", () => {
        // The widening must trip on growth, not on the mere presence of a cycle - otherwise every hub
        // scene in the story reports `?` and the focus mode is worthless on the shapes that use it.
        const story = document([
            scene("a", "Hub", [affectionDecl, jumpBlock("j1", "b")]),
            scene("b", "Menu", [jumpBlock("j2", "a")]),
        ], "a");

        expect(rangesOf(story)).toEqual({ a: "0..0", b: "0..0" });
    });

    it("makes no claim about a scene the entry cannot reach", () => {
        const story = document([
            scene("a", "Opening", [affectionDecl, jumpBlock("j1", "b")]),
            scene("b", "Hallway", []),
            scene("c", "Orphan", []),
        ], "a");

        expect(rangesOf(story)).toEqual({ a: "0..0", b: "0..0", c: "?" });
    });

    it("makes no claim at all when the story declares no entry scene", () => {
        const story = document([
            scene("a", "Opening", [affectionDecl, jumpBlock("j1", "b")]),
            scene("b", "Hallway", []),
        ]);

        expect(rangesOf(story)).toEqual({ a: "?", b: "?" });
    });

    it("treats a declaration with no default as unknown rather than as zero", () => {
        // The compiler seeds a saved variable with no default to `null` and skips a scene-local
        // entirely, so "the author never said" is not "the author said 0".
        const story = document([
            scene("a", "Opening", [
                declarationBlock(AFFECTION, "saved", "好感", "number"),
                setExpressionBlock("w1", stepAst("+", 2), "好感 + (2)"),
                jumpBlock("j1", "b"),
            ]),
            scene("b", "Hallway", []),
        ], "a");

        expect(rangesOf(story)).toEqual({ a: "?", b: "?" });
    });

    it("answers only for its own scene when the variable is a scene-local", () => {
        // A scene-local is re-seeded on every entry to its scene and does not exist outside it, so a
        // cumulative range across the map would be a number for a variable that is not there.
        const local = declarationBlock("var_hp", "scene", "hp", "number", 3);
        const story = document([
            scene("a", "Opening", [jumpBlock("j1", "b")]),
            scene("b", "Hallway", [local]),
        ], "a");

        expect(rangesOf(story, "scene:var_hp")).toEqual({ a: "?", b: "3..3" });
    });
});

describe("listNumericStoryVariables", () => {
    it("lists numeric declarations only, saved and persistent before scene", () => {
        const story = document([
            scene("a", "Opening", [
                declarationBlock("var_hp", "scene", "hp", "number", 3),
                declarationBlock(AFFECTION, "saved", "好感", "number", 0),
                declarationBlock("var_name", "saved", "名前", "string", "..."),
                declarationBlock("var_flag", "scene", "met", "boolean", false),
                declarationBlock("var_total", "persistent", "累计好感", "number"),
            ]),
        ], "a");

        expect(listNumericStoryVariables(story)).toEqual([
            { key: AFFECTION_KEY, scope: "saved", variableId: AFFECTION, name: "好感", defaultValue: 0 },
            // A row with no default is listed - the author can still focus it - but it seeds nothing.
            { key: "persistent:var_total", scope: "persistent", variableId: "var_total", name: "累计好感", defaultValue: null },
            { key: "scene:var_hp", scope: "scene", variableId: "var_hp", name: "hp", defaultValue: 3 },
        ]);
    });

    it("reads every scene, in document order", () => {
        const story = document([
            scene("a", "Opening", [declarationBlock("var_a", "saved", "A", "number", 1)]),
            scene("b", "Hallway", [declarationBlock("var_b", "saved", "B", "number", 2)]),
        ], "a");

        expect(listNumericStoryVariables(story).map(variable => variable.name)).toEqual(["A", "B"]);
    });
});
