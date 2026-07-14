/**
 * Debug / devtools: unified log (host + browser when available).
 * Comments in English per project convention.
 */

import { BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY, type BlueprintNodeDef } from "../types";
import { BLUEPRINT_NODE_TYPE_FLOW_COMMENT, BLUEPRINT_NODE_TYPE_LOG } from "@shared/types/blueprint/graph";
import { readDynamicInputPinIds } from "../effectivePins";
import { resolveDataPinValue } from "./graphParamResolvers";

export const devtoolsBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
        displayName: "Comment",
        category: "Debug",
        keywords: ["comment", "note", "label", "region"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        role: "comment",
        pins: [],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_LOG,
        displayName: "Log",
        category: "Debug",
        keywords: ["log", "print", "console", "debug", "concat"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "value",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Value",
                allowInlineLiteral: true,
            },
        ],
        // Concat-style inputs: add more values (inline literals or wired) that are joined
        // into one log line, e.g. "result: " + i, avoiding a separate Concat node.
        dynamicInputPins: {
            storageKey: BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY,
            fixedDataInputIds: ["value"],
            generatedIdPrefix: "in",
            valueType: "string",
            allowInlineLiteral: true,
            addButtonLabel: "Add value",
        },
        execute: ctx => {
            const inputPinIds = ["value", ...readDynamicInputPinIds(ctx.params, BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY)];
            const resolved = inputPinIds.map(pinId =>
                resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
                    hostAdapter: ctx.hostAdapter,
                    eventPayload: ctx.eventPayload,
                    listItemScope: ctx.listItemScope,
                    instanceKey: ctx.instanceKey,
                    executionOwner: ctx.executionOwner,
                }),
            );
            const line = resolved.some(value => value !== undefined)
                ? resolved.map(value => (value === undefined ? "" : stringifyForLog(value))).join("")
                : "Log node reached";
            const api = ctx.hostAdapter.blueprintRuntime?.hostApi;
            if (api) {
                api.devtools.log("info", line);
            }
            // eslint-disable-next-line no-console -- blueprint.log
            console.log("[Blueprint]", line);
            return { nextPort: "next" };
        },
    },
];

function stringifyForLog(v: unknown): string {
    if (typeof v === "string") {
        return v;
    }
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}
