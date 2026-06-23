/**
 * Broadcast nodes for surface/widget runtime messages.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
    BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";

export const broadcastBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
        displayName: "Send Broadcast",
        category: "Events",
        keywords: ["broadcast", "send", "event", "message"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        scope: { ownerKinds: ["widgetMain", "surfaceMain"] },
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
            const runtime = ctx.hostAdapter.blueprintRuntime;
            if (!runtime?.dispatchBroadcastEvent) {
                throw new BlueprintGraphExecutionError("Broadcast runtime is unavailable", ctx.node.id);
            }
            const eventName = String(
                resolveDataPinValue(ctx.graph, ctx.node.id, "event", ctx.params, ctx.blueprintLocals, 0, {
                    hostAdapter: ctx.hostAdapter,
                    eventPayload: ctx.eventPayload,
                    listItemScope: ctx.listItemScope,
                    instanceKey: ctx.instanceKey,
                    executionOwner: ctx.executionOwner,
                }) ?? "",
            ).trim();
            if (!eventName) {
                throw new BlueprintGraphExecutionError("Missing broadcast event name", ctx.node.id);
            }
            const data = resolveDataPinValue(ctx.graph, ctx.node.id, "data", ctx.params, ctx.blueprintLocals, 0, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                listItemScope: ctx.listItemScope,
                instanceKey: ctx.instanceKey,
                executionOwner: ctx.executionOwner,
            });
            await runtime.dispatchBroadcastEvent(eventName, data, ctx.executionOwner?.elementId);
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
        displayName: "Get Listener Count",
        category: "Events",
        keywords: ["broadcast", "listener", "count", "event"],
        graphKinds: ["event", "macro"],
        isPure: true,
        scope: { ownerKinds: ["widgetMain", "surfaceMain"] },
        pins: [
            {
                id: "event",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Event",
                allowInlineLiteral: true,
            },
            { id: "count", kind: "output", semantic: "data", valueType: "integer", label: "Count" },
        ],
        execute: () => ({}),
    },
];
