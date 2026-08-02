/**
 * Guard for a trap that costs an afternoon every time it fires: a node declares a
 * data output pin - `GraphExecutor` stores it generically for exec nodes, or the node
 * is pure and computes it - but the READ side (`resolveSelfOutput`) is a per-node-type
 * whitelist, so a node that nobody registered there resolves to `undefined`
 * downstream. No error, no warning, no diagnostic.
 *
 * This sweeps the whole registry so the next such node fails here instead of in a
 * shipped game. Two sweeps, because the two node kinds fail differently:
 *
 * - EXEC nodes publish `outputValues` from `execute()`, so the sweep can plant a
 *   sentinel and check it comes back out.
 * - PURE nodes publish nothing - `execute()` is never run for them at all, the value
 *   exists only as a `resolveSelfOutput` branch - so the sweep resolves them for real
 *   against a stub host. This half was missing, and `Has Read Text`
 *   (`blueprint.game.isTextReadById`) shipped dead through the gap: pure, unregistered,
 *   `undefined` for every consumer, for the whole life of the feature.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveEffectiveBlueprintNodePins } from "../effectivePins";
import { writeBlueprintNodeOutputValues } from "../nodeOutputValues";
import type { BlueprintNodeDef } from "../types";
import { resolveDataPinValue, type DataPinGraph, type DataPinResolveRuntime } from "./graphParamResolvers";

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

/**
 * Pure-node pins this sweep cannot judge, each with the reason.
 *
 * Same bar as the exec table above: an entry is allowed only when the pin really is readable in a
 * real graph and the *synthetic* graph is what makes it unreadable - a node with no params, no
 * element and no list scope. "It returns undefined today" is never a reason.
 */
const UNJUDGEABLE_PURE_OUTPUT_PINS: Record<string, string> = {
    "blueprint.data.literal.value": "Reads its own `value` param, which a params-less node has none of.",
    "blueprint.element.ref.element": "Reads its own element-ref params, which a params-less node has none of.",
    "blueprint.local.get.value": "Reads the local named by its `variableId` param; no param, no local.",
};

/**
 * Pure nodes that address an element, and so cannot resolve in a synthetic graph.
 *
 * Derived from the node definition rather than listed by name, because these come out of the widget
 * property factories by the hundred and a hand-written list would rot instantly:
 *
 * - `magicElementTarget` - the node points at another element through its `element` input pin.
 * - `scope.widgetElementTypes` - the node reads the widget element it lives on ("self").
 *
 * Either way the value comes from a live element tree, not from the graph, so `undefined` here says
 * nothing about whether the node is registered.
 */
function needsElementContext(def: BlueprintNodeDef): boolean {
    return Boolean(def.magicElementTarget) || Boolean(def.scope?.widgetElementTypes?.length);
}

/**
 * Enough host API for the pure readers that DO resolve without an element.
 *
 * Deliberately not a partial stub: a missing method makes the resolver throw, and a throw is
 * skipped below, which would hide exactly the hole this sweep exists to find.
 */
function stubRuntime(): DataPinResolveRuntime {
    return {
        hostAdapter: {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    game: {
                        getPreference: () => 0,
                        getNametag: () => null,
                        getSpeakerAvatar: () => null,
                        getSpeakerColor: () => ({ r: 255, g: 255, b: 255, a: 1 }),
                        getCharacter: () => null,
                        getNotifications: () => [],
                        getChoiceCount: () => 0,
                        isInGame: () => false,
                        isGameOverlay: () => false,
                        isNvlMode: () => false,
                        isCurrentTextRead: () => false,
                        isTextRead: () => false,
                        isSceneVisited: () => false,
                        isOptionPicked: () => false,
                    },
                    sound: {
                        getTrackVolume: () => 1,
                    },
                },
            },
        },
    } as unknown as DataPinResolveRuntime;
}

/** Every data output pin declared by a registered pure node this sweep is willing to judge. */
function listJudgeablePureNodeDataOutputPins(): string[] {
    registerCoreBlueprintNodes();
    const pins: string[] = [];
    for (const def of blueprintNodeRegistry.list()) {
        if (!def.isPure || needsElementContext(def)) {
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

/**
 * `exemptions` is a parameter so a meta-test can run the sweep with none and prove the detector
 * actually fires - a sweep that silently stopped finding anything would pass forever.
 */
function listUnreadablePureDataOutputPins(
    exemptions: Record<string, string> = UNJUDGEABLE_PURE_OUTPUT_PINS,
): UnreadablePin[] {
    registerCoreBlueprintNodes();
    const unreadable: UnreadablePin[] = [];

    for (const def of blueprintNodeRegistry.list()) {
        if (!def.isPure || needsElementContext(def)) {
            continue;
        }
        for (const pin of resolveEffectiveBlueprintNodePins(def, {})) {
            if (pin.kind !== "output" || pin.semantic !== "data") {
                continue;
            }
            const key = `${def.type}.${pin.id}`;
            if (key in exemptions) {
                continue;
            }
            const graph: DataPinGraph = {
                id: "readablePure",
                nodes: { node: { type: def.type, params: {} } },
                edges: [],
            };
            let value: unknown;
            try {
                // No `blueprintLocals` planted: a pure node's value can only come from
                // `resolveSelfOutput`, so there is nothing to plant.
                value = resolveDataPinValue(graph, "node", pin.id, {}, {}, 0, stubRuntime());
            } catch {
                continue;
            }
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

    // The element-context rule exempts most of the pure registry (every widget property reader), so
    // assert the remainder is still a real population - otherwise a change to that rule could empty
    // the sweep out and it would keep passing while checking nothing.
    it("finds pure nodes with data output pins to sweep", () => {
        expect(listJudgeablePureNodeDataOutputPins().length).toBeGreaterThan(30);
    });

    it("does not carry pure exemptions for pins that no longer exist", () => {
        const declared = new Set(listJudgeablePureNodeDataOutputPins());
        expect(Object.keys(UNJUDGEABLE_PURE_OUTPUT_PINS).filter(pin => !declared.has(pin))).toEqual([]);
    });

    // Proves the pure sweep can still fail. Run with no exemptions it must name the pins the
    // exemption table exists for - which is the same signal an unregistered new pure node produces,
    // and is how `blueprint.game.isTextReadById` surfaced.
    it("detects a pure output pin that resolves to undefined", () => {
        const flagged = new Set(listUnreadablePureDataOutputPins({}).map(entry => entry.pin));
        for (const pin of Object.keys(UNJUDGEABLE_PURE_OUTPUT_PINS)) {
            expect(flagged.has(pin), pin).toBe(true);
        }
    });

    it("resolves every pure node's declared data output pin", () => {
        const unreadable = listUnreadablePureDataOutputPins();
        expect(
            unreadable,
            unreadable.length === 0
                ? ""
                : `These pure nodes declare data output pins that resolve to undefined downstream. ` +
                    `A pure node's execute() is never run by the executor - the value exists only if ` +
                    `resolveSelfOutput() in graphParamResolvers.ts has a branch for it:\n` +
                    unreadable.map(entry => `  - ${entry.pin} (${entry.displayName})`).join("\n"),
        ).toEqual([]);
    });
});
