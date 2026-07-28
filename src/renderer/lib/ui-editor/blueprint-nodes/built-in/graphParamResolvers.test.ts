/**
 * Guard for a trap that costs an afternoon every time it fires: an exec node
 * declares a data output pin and publishes it from `execute()` via `outputValues`,
 * `GraphExecutor` stores it generically - but the READ side (`resolveSelfOutput`)
 * is a per-node-type whitelist, so a node that nobody registered there resolves to
 * `undefined` downstream. No error, no warning, no diagnostic.
 *
 * This sweeps the whole registry so the next such node fails here instead of in a
 * shipped game.
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveEffectiveBlueprintNodePins } from "../effectivePins";
import { writeBlueprintNodeOutputValues } from "../nodeOutputValues";
import { resolveDataPinValue, type DataPinGraph } from "./graphParamResolvers";

const SENTINEL = "__nl_node_output_sentinel__";

/**
 * Pins this sweep cannot judge, each with the reason. Add an entry only when the pin
 * really is readable in a real graph: the invariant defended here is that the default
 * for a new exec node is "readable", not "silently undefined".
 */
const UNJUDGEABLE_OUTPUT_PINS: Record<string, string> = {
    "blueprint.event.head.elementFlush.element":
        "Resolved from the head node's own element-ref params, which a synthetic params-less node has none of.",
    "blueprint.event.head.elementClick.element":
        "Resolved from the head node's own element-ref params, which a synthetic params-less node has none of.",
};

type UnreadablePin = { pin: string; displayName: string };

/** Every data output pin declared by a registered exec node, as `type.pinId`. */
function listExecNodeDataOutputPins(): string[] {
    registerCoreBlueprintNodes();
    const pins: string[] = [];
    for (const def of blueprintNodeRegistry.list()) {
        if (def.isPure) {
            continue;
        }
        for (const pin of resolveEffectiveBlueprintNodePins(def, {})) {
            if (pin.kind === "output" && pin.semantic === "data") {
                pins.push(`${def.type}.${pin.id}`);
            }
        }
    }
    return pins;
}

function listUnreadableDataOutputPins(): UnreadablePin[] {
    registerCoreBlueprintNodes();
    const unreadable: UnreadablePin[] = [];

    for (const def of blueprintNodeRegistry.list()) {
        // Pure nodes compute from their inputs and never publish `outputValues`.
        if (def.isPure) {
            continue;
        }
        for (const pin of resolveEffectiveBlueprintNodePins(def, {})) {
            if (pin.kind !== "output" || pin.semantic !== "data") {
                continue;
            }
            const key = `${def.type}.${pin.id}`;
            if (key in UNJUDGEABLE_OUTPUT_PINS) {
                continue;
            }
            const graph: DataPinGraph = {
                id: "readable",
                nodes: { node: { type: def.type, params: {} } },
                edges: [],
            };
            // Stand in for what `GraphExecutor` writes after `execute()` returns.
            const blueprintLocals: Record<string, unknown> = {};
            writeBlueprintNodeOutputValues(blueprintLocals, "node", { [pin.id]: SENTINEL });

            let value: unknown;
            try {
                value = resolveDataPinValue(graph, "node", pin.id, {}, blueprintLocals);
            } catch {
                // A resolver that needs runtime context it does not have may throw;
                // that is loud, and loud is not this test's concern.
                continue;
            }
            // Nodes resolved by a dedicated resolver return their own value rather than
            // the sentinel - also fine. Only `undefined` means "nothing can read this".
            if (value === undefined) {
                unreadable.push({ pin: key, displayName: def.displayName });
            }
        }
    }
    return unreadable;
}

describe("blueprint node data output readability", () => {
    // Without this the sweep below would pass by examining nothing at all.
    it("finds exec nodes with data output pins to sweep", () => {
        expect(listExecNodeDataOutputPins().length).toBeGreaterThan(50);
    });

    it("does not carry exemptions for pins that no longer exist", () => {
        const declared = new Set(listExecNodeDataOutputPins());
        expect(Object.keys(UNJUDGEABLE_OUTPUT_PINS).filter(pin => !declared.has(pin))).toEqual([]);
    });

    it("resolves every exec node's declared data output pin", () => {
        const unreadable = listUnreadableDataOutputPins();
        expect(
            unreadable,
            unreadable.length === 0
                ? ""
                : `These exec nodes declare data output pins that resolve to undefined downstream. ` +
                    `Register the node type and its output port ids in resolveSelfOutput() in ` +
                    `graphParamResolvers.ts:\n` +
                    unreadable.map(entry => `  - ${entry.pin} (${entry.displayName})`).join("\n"),
        ).toEqual([]);
    });
});
