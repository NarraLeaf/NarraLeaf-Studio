/**
 * `On Action`, `Is Action Held`, and the picker they share.
 *
 * Four things are defended, and only one of them is "the node returns the right value":
 *
 * 1. **The head's data outputs are readable.** A dispatched head publishes nothing from
 *    `execute()`; its pins are served out of the event payload by `resolveSelfOutput`, and a head
 *    the payload branch does not cover feeds `undefined` downstream with no error anywhere. So the
 *    assertions read the pins from a DOWNSTREAM node rather than inspecting the definition.
 * 2. **The dispatch filter.** One event carries the whole vocabulary, so the head that runs is
 *    chosen by the action id on the card. A head that ran for every action would put the switch the
 *    vocabulary exists to remove back into every graph.
 * 3. **`Is Action Held` stays pure.** A value graph and a bound pin both refuse anything latent or
 *    impure, and "dim the button while the gesture is held" is exactly that kind of binding.
 * 4. **The picker offers the project's own actions**, including the one the author has already
 *    chosen when it is no longer among them.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_INPUT_IS_ACTION_HELD,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    collectGlobalEventHeadNodeIdsForDispatch,
    collectSurfaceEventHeadNodeIdsForDispatch,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { listBlueprintInputActionOptions } from "./inputActionNodes";

const ADVANCE = "advance";

/** A host with the input router's read side, or without one at all. */
function createInputHostAdapter(held?: readonly string[]): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            hostApi: held
                ? { input: { isActionHeld: (actionId: string) => held.includes(actionId) } }
                : {},
        },
    } as unknown as UIHostAdapter;
}

/** One head pin wired into a Set Local named after it - the downstream read path. */
function headPinGraph(pin: string, params: Record<string, unknown>): UIGraph {
    return {
        id: "onAction",
        entries: { main: { start: { nodeId: "head", port: "then" } } },
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "store", port: "in" } },
            { from: { nodeId: "head", port: pin }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
}

async function readHeadPin(pin: string, eventPayload: Record<string, unknown>): Promise<unknown> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph: headPinGraph(pin, { [BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID]: ADVANCE }),
        entry: { start: { nodeId: "head", port: "then" } },
        hostAdapter: createInputHostAdapter(),
        eventName: "inputAction",
        eventPayload,
        blueprintLocals: locals,
    });
    return locals.out;
}

function heldGraph(params: Record<string, unknown>): UIGraph {
    return {
        id: "isActionHeld",
        entries: { main: { start: { nodeId: "store", port: "in" } } },
        nodes: {
            read: { id: "read", type: BLUEPRINT_NODE_TYPE_INPUT_IS_ACTION_HELD, params },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "read", port: "held" }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
}

async function readHeld(params: Record<string, unknown>, held?: readonly string[]): Promise<unknown> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph: heldGraph(params),
        entry: { start: { nodeId: "store", port: "in" } },
        hostAdapter: createInputHostAdapter(held),
        blueprintLocals: locals,
    });
    return locals.out;
}

describe("On Action", () => {
    it("is a dispatched head on the two owners that speak for a whole panel", () => {
        registerCoreBlueprintNodes();

        const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION);
        expect(def?.role).toBe("eventHead");
        expect(def?.graphKinds).toEqual(["event"]);
        expect(def?.scope?.ownerKinds).toEqual(["surfaceMain", "globalMain"]);
        expect(def?.pins.map(pin => pin.id)).toEqual(["then", "source", "x", "y"]);
    });

    it("resolves every data output from the payload the dispatch carried", async () => {
        registerCoreBlueprintNodes();

        const payload = { actionId: ADVANCE, source: "pointer", x: 120.5, y: 64 };
        expect(await readHeadPin("source", payload)).toBe("pointer");
        expect(await readHeadPin("x", payload)).toBe(120.5);
        expect(await readHeadPin("y", payload)).toBe(64);
    });

    it("reads a binding with no place on screen as null rather than undefined", async () => {
        registerCoreBlueprintNodes();

        // A key binding has no coordinates. The pins still resolve, so a graph that reads them
        // downstream gets a value it can test rather than a wire that silently carries nothing.
        expect(await readHeadPin("x", { actionId: ADVANCE, source: "key" })).toBeNull();
        expect(await readHeadPin("source", { actionId: ADVANCE, source: "key" })).toBe("key");
    });

    it("runs only for the action its card names", () => {
        const nodes = {
            advance: {
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
                params: { [BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID]: ADVANCE },
            },
            log: {
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
                params: { [BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID]: "openLog" },
            },
            // An author who has not picked an action yet listens to nothing: there is no wildcard
            // spelling, so an empty card must not answer for the whole vocabulary.
            unset: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params: {} },
        };

        expect(collectSurfaceEventHeadNodeIdsForDispatch(nodes, "inputAction", { actionId: ADVANCE }))
            .toEqual(["advance"]);
        expect(collectGlobalEventHeadNodeIdsForDispatch(nodes, "inputAction", { actionId: ADVANCE }))
            .toEqual(["advance"]);
        expect(collectSurfaceEventHeadNodeIdsForDispatch(nodes, "inputAction", { actionId: "dismiss" }))
            .toEqual([]);
    });
});

describe("Is Action Held", () => {
    it("is registered, pure and available to a function graph", () => {
        registerCoreBlueprintNodes();

        const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_INPUT_IS_ACTION_HELD);
        expect(def?.isPure).toBe(true);
        expect(def?.isLatent).toBeFalsy();
        expect(def?.category).toBe("Input");
        expect(def?.graphKinds).toEqual(["event", "function", "macro"]);
    });

    it("answers from the router, and answers false where there is no router", async () => {
        registerCoreBlueprintNodes();

        expect(await readHeld({ [BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID]: ADVANCE }, [ADVANCE])).toBe(true);
        expect(await readHeld({ [BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID]: ADVANCE }, ["openLog"])).toBe(false);
        // The editor preview has nobody at the keyboard. False is the honest reading, and it keeps
        // the pin a boolean rather than letting `undefined` travel down every wire below it.
        expect(await readHeld({ [BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID]: ADVANCE })).toBe(false);
    });

    it("reads an unpicked action as not held rather than throwing", async () => {
        registerCoreBlueprintNodes();

        expect(await readHeld({}, [ADVANCE])).toBe(false);
        expect(await readHeld({ [BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID]: "   " }, [ADVANCE])).toBe(false);
    });
});

describe("the action picker", () => {
    const document = {
        actions: {
            openLog: { id: "openLog", name: "Open the log", bindings: [] },
            advance: { id: "advance", name: "Advance", bindings: [] },
            nameless: { id: "nameless", name: "", bindings: [] },
        },
    };
    const labels = {
        unnamedLabel: "Unnamed action",
        missingLabel: (id: string) => `Missing action (${id})`,
    };

    it("offers the project's vocabulary by the name an author reads", () => {
        expect(listBlueprintInputActionOptions({ document, ...labels })).toEqual([
            { value: "advance", label: "Advance" },
            { value: "openLog", label: "Open the log" },
            { value: "nameless", label: "Unnamed action" },
        ]);
    });

    it("keeps a chosen action that the project no longer declares", () => {
        const options = listBlueprintInputActionOptions({ document, pickedId: "dismiss", ...labels });
        expect(options.at(-1)).toEqual({ value: "dismiss", label: "Missing action (dismiss)" });
    });

    it("offers nothing for a project that declares no actions", () => {
        expect(listBlueprintInputActionOptions({ document: {}, ...labels })).toEqual([]);
    });
});
