/**
 * Stacking a page over whatever is already on screen: show, hide, wait, close, ask.
 *
 * The vocabulary an author sees never mentions z order or layer names, and that is a constraint
 * rather than a shorthand. Stacking order is mount order; the only thing that names a layer is the
 * handle `Show Layer` hands back, and that handle is meaningless to anyone who was not given it. A
 * screen therefore cannot be built to depend on a particular depth, which is what stops the first
 * project that wants "just one more layer above the pause menu" from turning the composite into a
 * numbering scheme nobody can change afterwards.
 *
 * These live in the App category beside `Go Page` / `Go back`, because from where an author stands
 * they are the same subject - what is on screen - split by whether the page replaces or covers.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF,
    BLUEPRINT_NODE_TYPE_LAYER_HIDE,
    BLUEPRINT_NODE_TYPE_LAYER_IS_MOUNTED,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_LAYER_WAIT,
} from "@shared/types/blueprint/graph";
import {
    BlueprintGraphExecutionError,
    isBlueprintGraphExecutionCancelledError,
} from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

/** The handle input every node but `Show Layer` takes. */
const layerHandleIn: BlueprintNodePinDef = {
    id: "layer",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Layer",
};

function readPin(ctx: Parameters<BlueprintNodeDef["execute"]>[0], pinId: string): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
        valueExecution: ctx.valueExecution,
    });
}

function readHandle(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): string {
    return String(readPin(ctx, "layer") ?? "").trim();
}

export const layerBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_SHOW,
        displayName: "Show Layer",
        category: "App",
        keywords: ["layer", "show", "page", "over", "overlay", "modal", "dialog", "popup", "stack"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "props",
                kind: "input",
                semantic: "data",
                valueType: "json",
                label: "Page props",
                optional: true,
            },
            {
                id: "modal",
                kind: "input",
                semantic: "data",
                valueType: "boolean",
                label: "Modal",
                allowInlineLiteral: true,
            },
            {
                id: "dismissible",
                kind: "input",
                semantic: "data",
                valueType: "boolean",
                label: "Dismissible",
                allowInlineLiteral: true,
            },
            {
                id: "group",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Group",
                optional: true,
                allowInlineLiteral: true,
            },
            { id: "layer", kind: "output", semantic: "data", valueType: "string", label: "Layer" },
        ],
        inspectorParams: [
            {
                key: "surfaceId",
                label: "Page",
                kind: "select",
                // The same source `Go Page` picks from, deliberately: a layer IS a page, and offering
                // an author two different lists of pages would suggest otherwise.
                dynamicOptionsSource: "surfaces",
            },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const surfaceId = String(ctx.params.surfaceId ?? "").trim();
            const group = String(readPin(ctx, "group") ?? "").trim();
            let layer: string;
            try {
                layer = await api.layers.show(surfaceId, readPin(ctx, "props"), {
                    modal: readPin(ctx, "modal") === true,
                    // Unwired reads as dismissible: a layer the player cannot get out of is a
                    // decision, and a decision is not what an untouched pin should mean.
                    dismissible: readPin(ctx, "dismissible") !== false,
                    group: group || null,
                });
            } catch (error) {
                if (isBlueprintGraphExecutionCancelledError(error) || error instanceof BlueprintGraphExecutionError) {
                    throw error;
                }
                // The host names the page it could not find; carrying that sentence onto this node is
                // what puts the failure on the row an author can fix.
                throw new BlueprintGraphExecutionError(
                    error instanceof Error ? error.message : String(error),
                    ctx.node.id,
                );
            }
            return { nextPort: "next", outputValues: { layer } };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_HIDE,
        displayName: "Hide Layer",
        category: "App",
        keywords: ["layer", "hide", "close", "dismiss", "remove", "overlay", "modal"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, layerHandleIn],
        async execute(ctx) {
            // A handle naming nothing is a no-op rather than an error, the same bargain `Go back`
            // makes at the bottom of the page stack: the layer being gone already is the outcome
            // this node was asked for.
            await requireHostApi(ctx).layers.hide(readHandle(ctx));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_WAIT,
        displayName: "Wait For Layer",
        category: "App",
        keywords: ["layer", "wait", "await", "result", "answer", "confirm", "modal", "close"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            layerHandleIn,
            { id: "result", kind: "output", semantic: "data", valueType: "json", label: "Result" },
        ],
        async execute(ctx) {
            const result = await requireHostApi(ctx).layers.wait(readHandle(ctx));
            return { nextPort: "next", outputValues: { result: result ?? null } };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF,
        displayName: "Close This Layer",
        category: "App",
        keywords: ["layer", "close", "self", "dismiss", "return", "result", "answer", "confirm"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "result",
                kind: "input",
                semantic: "data",
                valueType: "json",
                label: "Result",
                optional: true,
            },
        ],
        async execute(ctx) {
            await requireHostApi(ctx).layers.closeSelf(readPin(ctx, "result") ?? null);
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LAYER_IS_MOUNTED,
        displayName: "Is Layer Mounted",
        category: "App",
        keywords: ["layer", "mounted", "open", "shown", "visible", "present", "is"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            layerHandleIn,
            { id: "mounted", kind: "output", semantic: "data", valueType: "boolean", label: "Is Mounted" },
        ],
        // Pure, so the executor never runs this: the value comes from `resolveSelfOutput` in
        // graphParamResolvers.ts. This body is what a macro expansion and the sweep-test read.
        execute(ctx) {
            const handle = readHandle(ctx);
            return {
                outputValues: {
                    mounted: handle ? requireHostApi(ctx).layers.isMounted(handle) : false,
                },
            };
        },
    },
];
