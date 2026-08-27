import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryExpr, StoryScene } from "@shared/types/story";
import { computeSceneFlowCoverage } from "./sceneFlowCoverage";

/**
 * The coverage walk.
 *
 * Every case here is chosen for the direction it can be wrong in. The walk makes exactly one kind of
 * claim - that nothing reaches a place - so a bug that widens costs precision and a bug that narrows
 * tells an author their working ending is dead. The tests are therefore weighted towards the second:
 * most of them assert that something IS still reachable in a shape the walk could plausibly prune.
 */

const AFFECTION = "var_affection";
const AFFECTION_KEY = "saved:var_affection";

function declaration(defaultValue: number): StoryBlock {
    return {
        id: AFFECTION,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: { scope: "saved", name: "affection", valueType: "number", storageKey: AFFECTION, defaultValue },
    } as StoryBlock;
}

const readAffection: StoryExpr = { kind: "var", target: { scope: "saved", variableId: AFFECTION }, name: "affection" };

const compare = (op: ">=" | "<=" | "==", value: number): StoryExpr =>
    ({ kind: "binary", op, left: readAffection, right: { kind: "literal", value } });

/** `/inc affection <step>` as stored: `affection + step` on a setVariable row. */
function incBy(id: string, step: number, parentId: string | null = null): StoryBlock {
    return {
        id,
        kind: "action",
        parentId,
        childrenIds: [],
        payload: {
            action: "setVariable",
            target: { scope: "saved", variableId: AFFECTION },
            value: 0,
            expression: {
                source: `affection + (${step})`,
                ast: { kind: "binary", op: "+", left: readAffection, right: { kind: "literal", value: step } },
            },
        },
    } as StoryBlock;
}

function jump(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
}

/** An `/if` group holding one guarded arm; the arm's children are the rows inside it. */
function ifGroup(id: string, armId: string, guard: StoryExpr | null, childrenIds: string[]): StoryBlock[] {
    return [
        { id, kind: "control", parentId: null, childrenIds: [armId], payload: { control: "condition" } } as StoryBlock,
        {
            id: armId,
            kind: "control",
            parentId: id,
            childrenIds,
            payload: {
                control: "conditionBranch",
                branch: "if",
                ...(guard ? { condition: { kind: "expression", expression: { source: "guard", ast: guard } } } : {}),
            },
        } as StoryBlock,
    ];
}

function choice(id: string, optionIds: string[]): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: optionIds,
        payload: { action: "choice", prompt: { textId: `${id}-p`, value: "", role: "choicePrompt" } },
    } as StoryBlock;
}

function option(id: string, childrenIds: string[], text: string, hiddenWhen?: StoryExpr): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds,
        payload: {
            action: "choiceOption",
            text: { textId: `${id}-t`, value: text, role: "choiceText" },
            ...(hiddenWhen ? { hiddenWhen: { kind: "expression", expression: { source: "hidden", ast: hiddenWhen } } } : {}),
        },
    } as StoryBlock;
}

/** `/ending` - a control row, and its block id is the ending's identity. */
function ending(id: string, name: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "control", parentId, childrenIds: [], payload: { control: "ending", name } } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    // Parents are declared on the child; a block whose parent is set is not a root.
    const withParents = blocks.map(block => {
        const parent = blocks.find(candidate => candidate.childrenIds.includes(block.id));
        return parent ? { ...block, parentId: parent.id } : block;
    });
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: withParents.filter(block => !block.parentId).map(block => block.id),
        blocks: Object.fromEntries(withParents.map(block => [block.id, block])),
    } as StoryScene;
}

function document(scenes: StoryScene[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        entrySceneId: scenes[0]?.id,
        chapters: [{ id: "c1", name: "Chapter", sceneIds: scenes.map(item => item.id) }],
        scenes: Object.fromEntries(scenes.map(item => [item.id, item])),
    } as StoryDocument;
}

const coverageOf = (doc: StoryDocument, entry = "a") => computeSceneFlowCoverage(doc, new Set([entry]));

describe("computeSceneFlowCoverage", () => {
    it("finds the ending gated on a number no route can accumulate", () => {
        // +2 on the way through, so the most anything carries into `end` is 2 - and the good ending
        // asks for 50. Structurally the rows lead there; no state does.
        const doc = document([
            scene("a", "Start", [declaration(0), incBy("w1", 2), jump("j1", "end")]),
            scene("end", "End", [
                ...ifGroup("if1", "arm1", compare(">=", 50), ["e1"]),
                ending("e1", "True End"),
            ]),
        ]);

        const coverage = coverageOf(doc);
        expect(coverage.settled).toBe(true);
        // The scene is reached: the rows before the guard still run.
        expect(coverage.reachableSceneIds.has("end")).toBe(true);
        // The ending behind the guard is not.
        expect(coverage.structuralEndingIds.has("e1")).toBe(true);
        expect(coverage.reachedEndingIds.has("e1")).toBe(false);
        expect(coverage.takenBranchIds.has("scene-flow:branch:arm1")).toBe(false);
    });

    it("leaves a threshold a route can reach alone", () => {
        const doc = document([
            scene("a", "Start", [declaration(0), incBy("w1", 50), jump("j1", "end")]),
            scene("end", "End", [
                ...ifGroup("if1", "arm1", compare(">=", 50), ["e1"]),
                ending("e1", "True End"),
            ]),
        ]);

        expect(coverageOf(doc).reachedEndingIds.has("e1")).toBe(true);
    });

    it("takes the branch when one option out of several can satisfy it", () => {
        // Two ways through, one of them worth 50. The join at `end` is 0..50, which satisfies the
        // guard - a walk that judged per-path-prefix rather than on the join would still find it,
        // but one that dropped the generous arm's effects would not.
        const doc = document([
            scene("a", "Crossroads", [
                declaration(0),
                choice("c1", ["o1", "o2"]),
                option("o1", ["w1", "j1"], "be kind"),
                option("o2", ["j2"], "be cold"),
                incBy("w1", 50),
                jump("j1", "end"),
                jump("j2", "end"),
            ]),
            scene("end", "End", [
                ...ifGroup("if1", "arm1", compare(">=", 50), ["e1"]),
                ending("e1", "True End"),
            ]),
        ]);

        const coverage = coverageOf(doc);
        expect(coverage.reachedEndingIds.has("e1")).toBe(true);
    });

    it("reports an option the game would never offer", () => {
        // `hiddenWhen` closes an arm when it HOLDS - the mirror of an `if`, and the one place getting
        // the polarity backwards would silently invert every finding about a choice.
        const doc = document([
            scene("a", "Crossroads", [
                declaration(0),
                choice("c1", ["o1", "o2"]),
                option("o1", ["j1"], "always here"),
                option("o2", ["j2"], "never here", compare("<=", 0)),
                jump("j1", "b"),
                jump("j2", "c"),
            ]),
            scene("b", "B", []),
            scene("c", "C", []),
        ]);

        const coverage = coverageOf(doc);
        expect(coverage.takenBranchIds.has("scene-flow:branch:o1")).toBe(true);
        expect(coverage.takenBranchIds.has("scene-flow:branch:o2")).toBe(false);
        // And the scene only that option led to is unreachable, while the other one is not.
        expect(coverage.reachableSceneIds.has("b")).toBe(true);
        expect(coverage.reachableSceneIds.has("c")).toBe(false);
        expect(coverage.structuralSceneIds.has("c")).toBe(true);
    });

    it("takes an arm whose guard it cannot evaluate", () => {
        // A call is not something this domain reads. Pruning on it would be guessing, and guessing
        // in this direction reports a working route as dead.
        const doc = document([
            scene("a", "Start", [
                declaration(0),
                ...ifGroup("if1", "arm1", { kind: "call", fn: "min", args: [readAffection, { kind: "literal", value: 1 }] }, ["j1"]),
                jump("j1", "b"),
            ]),
            scene("b", "B", []),
        ]);

        expect(coverageOf(doc).reachableSceneIds.has("b")).toBe(true);
    });

    it("takes every arm once a row it cannot read is in the story", () => {
        // A plugin marker's own compile pass decides what it emits, so every counter is unknowable
        // and the feasible answer has to collapse onto the structural one.
        const doc = document([
            scene("a", "Start", [
                declaration(0),
                { id: "pl1", kind: "action", parentId: null, childrenIds: [], payload: { action: "plugin", pluginId: "p", actionId: "p:x", params: {} } } as StoryBlock,
                ...ifGroup("if1", "arm1", compare(">=", 50), ["j1"]),
                jump("j1", "b"),
            ]),
            scene("b", "B", []),
        ]);

        const coverage = coverageOf(doc);
        expect(coverage.reachableSceneIds.has("b")).toBe(true);
        expect(coverage.reachableSceneIds).toEqual(coverage.structuralSceneIds);
    });

    it("judges a guard against its own scene's writes, not only what arrived", () => {
        // The +50 sits above the guard in the SAME scene. Judging on the arrival value alone would
        // report an ending the row two lines up makes reachable.
        const doc = document([
            scene("a", "Start", [declaration(0), jump("j1", "end")]),
            scene("end", "End", [
                incBy("w1", 50),
                ...ifGroup("if1", "arm1", compare(">=", 50), ["e1"]),
                ending("e1", "True End"),
            ]),
        ]);

        expect(coverageOf(doc).reachedEndingIds.has("e1")).toBe(true);
    });

    it("says nothing about a variable with no declared default", () => {
        // A number the author never stated is a number nobody knows - not zero.
        const doc = document([
            scene("a", "Start", [
                {
                    id: AFFECTION,
                    kind: "declaration",
                    parentId: null,
                    childrenIds: [],
                    payload: { scope: "saved", name: "affection", valueType: "number", storageKey: AFFECTION },
                } as StoryBlock,
                jump("j1", "end"),
            ]),
            scene("end", "End", [
                ...ifGroup("if1", "arm1", compare(">=", 50), ["e1"]),
                ending("e1", "True End"),
            ]),
        ]);

        expect(coverageOf(doc).reachedEndingIds.has("e1")).toBe(true);
    });

    it("terminates on a loop that keeps moving the counter", () => {
        // `b` jumps back to itself through `a`, adding each lap. The counter has no bound, so the
        // budget widens it to unknown and the guard downstream stops pruning.
        const doc = document([
            scene("a", "Start", [declaration(0), jump("j1", "b")]),
            scene("b", "Loop", [incBy("w1", 1), jump("j2", "a"), jump("j3", "end")]),
            scene("end", "End", [
                ...ifGroup("if1", "arm1", compare("==", 7), ["e1"]),
                ending("e1", "Lucky"),
            ]),
        ]);

        const coverage = coverageOf(doc);
        expect(coverage.settled).toBe(true);
        expect(coverage.reachedEndingIds.has("e1")).toBe(true);
    });

    it("keeps the structural answer beside the feasible one", () => {
        const doc = document([
            scene("a", "Start", [
                declaration(0),
                ...ifGroup("if1", "arm1", compare(">=", 50), ["j1"]),
                jump("j1", "b"),
            ]),
            scene("b", "B", []),
        ]);

        const coverage = coverageOf(doc);
        // The two readings are what a caller subtracts, so both have to come back from one walk.
        expect(coverage.structuralSceneIds.has("b")).toBe(true);
        expect(coverage.reachableSceneIds.has("b")).toBe(false);
        expect(coverage.structuralBranchIds.has("scene-flow:branch:arm1")).toBe(true);
        expect(coverage.takenBranchIds.has("scene-flow:branch:arm1")).toBe(false);
    });
});

describe("what the walk refuses to over-report", () => {
    it("names the door, not every room behind it", () => {
        // One impossible guard on the only way out of the entry closes four scenes. That is one
        // mistake; a report that named all four would say it four times.
        const doc = document([
            scene("a", "Start", [
                declaration(0),
                ...ifGroup("if1", "arm1", compare(">=", 50), ["j1"]),
                jump("j1", "b"),
            ]),
            scene("b", "B", [jump("j2", "c")]),
            scene("c", "C", [jump("j3", "d")]),
            scene("d", "D", []),
        ]);

        const coverage = coverageOf(doc);
        expect([...coverage.structuralSceneIds].sort()).toEqual(["a", "b", "c", "d"]);
        expect([...coverage.reachableSceneIds]).toEqual(["a"]);
        // Only `b` is next to something a path reaches.
        expect([...coverage.frontierUnreachableSceneIds]).toEqual(["b"]);
    });

    it("keeps two doors when two of them are shut", () => {
        const doc = document([
            scene("a", "Start", [
                declaration(0),
                choice("c1", ["o1", "o2"]),
                option("o1", ["j1"], "left", compare("<=", 0)),
                option("o2", ["j2"], "right", compare("<=", 0)),
                jump("j1", "b"),
                jump("j2", "c"),
            ]),
            scene("b", "B", []),
            scene("c", "C", []),
        ]);

        expect([...coverageOf(doc).frontierUnreachableSceneIds].sort()).toEqual(["b", "c"]);
    });

    it("says nothing about a counter something outside this story writes", () => {
        // The walk covers one story's graph. A `saved` counter chapter two also moves arrives here
        // holding a number this walk never saw, so seeding it from the declared default would be
        // describing a playthrough nobody has.
        const doc = document([
            scene("a", "Start", [
                declaration(0),
                ...ifGroup("if1", "arm1", compare(">=", 50), ["j1"]),
                jump("j1", "b"),
            ]),
            scene("b", "B", []),
        ]);

        expect(coverageOf(doc).reachableSceneIds.has("b")).toBe(false);
        const withExternal = computeSceneFlowCoverage(doc, new Set(["a"]), {
            externallyWrittenKeys: new Set([AFFECTION_KEY]),
        });
        expect(withExternal.reachableSceneIds.has("b")).toBe(true);
        expect([...withExternal.frontierUnreachableSceneIds]).toEqual([]);
    });

    it("judges an arm against the rows above it, not the ones its own body runs", () => {
        // `if affection >= 50 { affection += 100 }` used to be judged against a bound that already
        // held the `+100`, so the check could never find it. Reading the rows in order removes the
        // write the arm itself applies - it cannot have run before the arm was chosen.
        const doc = document([
            scene("a", "Start", [
                declaration(0),
                ...ifGroup("if1", "arm1", compare(">=", 50), ["w1", "j1"]),
                incBy("w1", 100),
                jump("j1", "b"),
            ]),
            scene("b", "B", []),
        ]);

        expect(coverageOf(doc).reachableSceneIds.has("b")).toBe(false);
    });

    it("falls back to the whole scene when a goto can send the run backwards", () => {
        // With a `goto` in the scene, a row written after the guard can still precede it, so reading
        // document order literally would narrow the bound - and narrowing is what reports a working
        // branch as dead.
        const doc = document([
            scene("a", "Start", [
                declaration(0),
                { id: "lbl", kind: "control", parentId: null, childrenIds: [], payload: { control: "label", name: "top" } } as StoryBlock,
                ...ifGroup("if1", "arm1", compare(">=", 50), ["j1"]),
                incBy("w1", 100),
                { id: "gt", kind: "control", parentId: null, childrenIds: [], payload: { control: "goto", targetLabel: "top" } } as StoryBlock,
                jump("j1", "b"),
            ]),
            scene("b", "B", []),
        ]);

        expect(coverageOf(doc).reachableSceneIds.has("b")).toBe(true);
    });
});
