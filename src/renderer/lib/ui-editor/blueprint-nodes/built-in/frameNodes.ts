/**
 * Page component host nodes for frame params and child-to-parent events.
 */

import {
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

export const frameBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
        displayName: "Get Page Param",
        category: "Page",
        keywords: ["page", "frame", "param", "input"],
        graphKinds: ["event", "macro"],
        isPure: true,
        scope: { ownerKinds: ["surfaceMain", "widgetMain"] },
        pins: [
            {
                id: "key",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Key",
                allowInlineLiteral: true,
            },
            { id: "value", kind: "output", semantic: "data", valueType: "json", label: "Value" },
        ],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_FRAME_EMIT,
        displayName: "Emit Page Event",
        category: "Page",
        keywords: ["page", "frame", "emit", "event", "parent"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        scope: { ownerKinds: ["surfaceMain", "widgetMain"] },
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "event",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Event",
                allowInlineLiteral: true,
            },
            { id: "data", kind: "input", semantic: "data", valueType: "json", label: "Data" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const eventName = String(
                resolveDataPinValue(ctx.graph, ctx.node.id, "event", ctx.params, ctx.blueprintLocals, 0, {
                    hostAdapter: ctx.hostAdapter,
                    eventPayload: ctx.eventPayload,
                    executionOwner: ctx.executionOwner,
                }) ?? "",
            ).trim();
            if (!eventName) {
                throw new BlueprintGraphExecutionError("Missing page event name", ctx.node.id);
            }
            const data = resolveDataPinValue(ctx.graph, ctx.node.id, "data", ctx.params, ctx.blueprintLocals, 0, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                executionOwner: ctx.executionOwner,
            });
            await api.frame.emit(eventName, data);
            return { nextPort: "next" };
        },
    },
];
