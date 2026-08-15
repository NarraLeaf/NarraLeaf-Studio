/**
 * Drift guard for `@shared/blueprint/blueprintPinSemantics`.
 *
 * That table restates, in a place the main process can import, which pins of a node carry execution.
 * The registry below is the authority for the same fact, and the two are wired to nothing: a node
 * added to the registry does not appear in the table, and a node deleted from the registry does not
 * leave it. Neither divergence has a symptom until a build folds a graph - at which point the wrong
 * answer is a branch left in a shipped package, or a build refused for a node that is fine.
 *
 * So this asserts equality in both directions, node by node, and it is the reason adding a blueprint
 * node without listing it there fails here rather than in a package nobody opens.
 *
 * The params handed to `resolveEffectiveBlueprintNodePins` are a representative set rather than an
 * empty object on purpose: `If Else` and `Switch String` publish an execution output per added
 * branch, and an empty params object would agree with a table that had forgotten them entirely.
 */
import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_IF_ELSE_BRANCH_PINS,
    BLUEPRINT_LAYER_CONFIRM_BUTTON_PINS,
    BLUEPRINT_SWITCH_STRING_CASE_PINS,
    blueprintNodeExecOutputPinIds,
    blueprintNodeExecPins,
    listKnownBlueprintNodeTypes,
} from "@shared/blueprint/blueprintPinSemantics";
import {
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "./registerCoreBlueprintNodes";
import { resolveEffectiveBlueprintNodePins } from "./effectivePins";
import type { BlueprintNodeDef } from "./types";

/** Two added branches on each variadic node, spelled the way the editor's add button spells them. */
function representativeParams(def: BlueprintNodeDef): Record<string, unknown> {
    if (def.type === BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE) {
        return {
            [BLUEPRINT_IF_ELSE_BRANCH_PINS.storageKey]: [
                "if_1_condition", "if_1_then", "if_2_condition", "if_2_then",
            ],
        };
    }
    if (def.type === BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING) {
        return {
            [BLUEPRINT_SWITCH_STRING_CASE_PINS.storageKey]: [
                "case_1_value", "case_1_output", "case_2_value", "case_2_output",
            ],
        };
    }
    if (def.type === BLUEPRINT_NODE_TYPE_LAYER_CONFIRM) {
        return {
            [BLUEPRINT_LAYER_CONFIRM_BUTTON_PINS.storageKey]: [
                "button_1_label", "button_1_pressed", "button_2_label", "button_2_pressed",
            ],
        };
    }
    return {};
}

function registeredDefs(): BlueprintNodeDef[] {
    registerCoreBlueprintNodes();
    return blueprintNodeRegistry.list();
}

describe("blueprint pin semantics table", () => {
    it("covers every registered node type", () => {
        const known = new Set(listKnownBlueprintNodeTypes());
        // A node was added to the registry and never listed in the shared table. Add it to the
        // group whose shape it shares, or to the irregular record if it has one of its own.
        expect(registeredDefs().map(def => def.type).filter(type => !known.has(type))).toEqual([]);
    });

    it("lists no node type the registry does not have", () => {
        const registered = new Set(registeredDefs().map(def => def.type));
        // A node was deleted or renamed and its entry stayed behind. A stale entry is not harmless:
        // it is an answer the fold will act on for a type nothing produces.
        expect(listKnownBlueprintNodeTypes().filter(type => !registered.has(type))).toEqual([]);
    });

    it("agrees with the registry about which pins carry execution", () => {
        const disagreements: string[] = [];
        for (const def of registeredDefs()) {
            const params = representativeParams(def);
            const effective = resolveEffectiveBlueprintNodePins(def, params);
            const actualIn = effective
                .filter(pin => pin.kind === "input" && pin.semantic === "exec")
                .map(pin => pin.id);
            const actualOut = effective
                .filter(pin => pin.kind === "output" && pin.semantic === "exec")
                .map(pin => pin.id);
            const table = blueprintNodeExecPins(def.type);
            if (!table) {
                continue;
            }
            const tableOut = blueprintNodeExecOutputPinIds({ id: "n", type: def.type, params }) ?? [];
            if ([...table.in].sort().join(",") !== [...actualIn].sort().join(",")) {
                disagreements.push(`${def.type} exec inputs: table [${table.in}] registry [${actualIn}]`);
            }
            if ([...tableOut].sort().join(",") !== [...actualOut].sort().join(",")) {
                disagreements.push(`${def.type} exec outputs: table [${tableOut}] registry [${actualOut}]`);
            }
        }
        expect(disagreements).toEqual([]);
    });
});
