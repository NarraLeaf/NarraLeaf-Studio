/**
 * Which data inputs count as missing, as the definition declares it.
 *
 * Most of this judgement is covered where it is used - the graph validator, the lint rule and the
 * executor each have their own cases. What lives here is the part only a definition can say: pins
 * that stand in for each other. The save nodes name their save by `Id` or by a wired `Slot`, run on
 * either and refuse with neither, and every one of them has to be judged that way or the canvas, the
 * lint report, Dev Mode and the shipped log all warn about a node that works.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_LINE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PLAYTIME,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_STORY,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_TIME,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_VALUE_TYPE_SAVE_SLOT, toBlueprintSaveSlot } from "@shared/types/blueprint/valueTypes";
import { blueprintNodeRegistry, registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import type { BlueprintNodeDef } from "./types";
import { listUnwiredRequiredInputPins } from "./requiredInputPins";

registerCoreBlueprintNodes();

/** Every node that acts on one stored save and takes it by `Id` or by `Slot`. */
const SAVE_NODE_TYPES = [
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_TIME,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_LINE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PLAYTIME,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_STORY,
];

const nothingWired = () => false;
const wiredOnly = (wanted: string) => (pinId: string) => pinId === wanted;

describe("a save node named by Id or by Slot", () => {
    it.each(SAVE_NODE_TYPES)("%s says nothing when Slot is wired and Id is empty", type => {
        expect(listUnwiredRequiredInputPins(type, {}, wiredOnly("slot"))).toEqual([]);
        expect(listUnwiredRequiredInputPins(type, undefined, wiredOnly("slot"))).toEqual([]);
    });

    it.each(SAVE_NODE_TYPES)("%s says nothing when only Id is given", type => {
        expect(listUnwiredRequiredInputPins(type, { id: "slot-01" }, nothingWired)).toEqual([]);
        expect(listUnwiredRequiredInputPins(type, {}, wiredOnly("id"))).toEqual([]);
    });

    it.each(SAVE_NODE_TYPES)("%s names Id exactly once when neither is given", type => {
        // Under Id because that is the pin the card lets an author type into; Slot is the pin a
        // graph wires when it already holds one.
        expect(listUnwiredRequiredInputPins(type, {}, nothingWired)).toEqual([{ pinId: "id", label: "Id" }]);
        expect(listUnwiredRequiredInputPins(type, undefined, nothingWired)).toEqual([{ pinId: "id", label: "Id" }]);
    });

    it("counts a value carried on Slot the way it counts one carried on Id", () => {
        const params = { slot: toBlueprintSaveSlot("stored", "slot-01") };
        expect(listUnwiredRequiredInputPins(BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD, params, nothingWired)).toEqual([]);
    });

    it("is declared on every node that takes a save both ways", () => {
        // The guard for the next save node: one that grows a Slot pin beside its Id and forgets to
        // say they are alternatives warns on every graph that wires the slot.
        const takesBoth = blueprintNodeRegistry.list().filter(def =>
            def.pins.some(pin => pin.kind === "input" && pin.id === "id")
            && def.pins.some(pin => pin.kind === "input" && pin.valueType === BLUEPRINT_VALUE_TYPE_SAVE_SLOT),
        );
        expect(takesBoth.map(def => def.type).sort()).toEqual([...SAVE_NODE_TYPES].sort());
        for (const def of takesBoth) {
            expect(def.alternativeInputs, def.type).toContainEqual(["id", "slot"]);
        }
    });
});

describe("alternative inputs on a definition", () => {
    const shape = {
        displayName: "Alternatives",
        category: "Test",
        graphKinds: ["event"],
        isPure: false,
        execute: () => ({ nextPort: "next" }),
    } satisfies Partial<BlueprintNodeDef>;

    const pins: BlueprintNodeDef["pins"] = [
        { id: "in", kind: "input", semantic: "exec", label: "In" },
        { id: "first", kind: "input", semantic: "data", valueType: "string", label: "First", allowInlineLiteral: true },
        { id: "second", kind: "input", semantic: "data", valueType: "string", label: "Second", optional: true },
        { id: "other", kind: "input", semantic: "data", valueType: "string", label: "Other" },
        { id: "next", kind: "output", semantic: "exec", label: "Next" },
    ];

    blueprintNodeRegistry.register({
        ...shape,
        type: "test.required.alternatives",
        pins,
        // Listed second-first on purpose: the group is named by the pin it lists first, not by the
        // pin that happens to come first on the card.
        alternativeInputs: [["second", "first"]],
    });

    it("judges the group as one and leaves the node's other pins to the ordinary rule", () => {
        expect(listUnwiredRequiredInputPins("test.required.alternatives", {}, nothingWired)).toEqual([
            { pinId: "second", label: "Second" },
            { pinId: "other", label: "Other" },
        ]);
        expect(listUnwiredRequiredInputPins("test.required.alternatives", { first: "x" }, nothingWired)).toEqual([
            { pinId: "other", label: "Other" },
        ]);
        expect(listUnwiredRequiredInputPins("test.required.alternatives", { other: "y" }, wiredOnly("second"))).toEqual([]);
    });

    it("is refused at registration when it names something other than two or more data inputs", () => {
        const register = (alternativeInputs: readonly (readonly string[])[], type: string) =>
            () => blueprintNodeRegistry.register({ ...shape, type, pins, alternativeInputs });

        expect(register([["first", "missing"]], "test.required.unknownPin")).toThrow(/not a data input/);
        expect(register([["first", "in"]], "test.required.execPin")).toThrow(/not a data input/);
        expect(register([["first"]], "test.required.alone")).toThrow(/two or more distinct pins/);
        expect(register([["first", "first"]], "test.required.repeated")).toThrow(/two or more distinct pins/);
        expect(register([["first", "second"], ["second", "other"]], "test.required.twoGroups")).toThrow(/in two groups/);
        expect(blueprintNodeRegistry.get("test.required.unknownPin")).toBeUndefined();
    });
});
