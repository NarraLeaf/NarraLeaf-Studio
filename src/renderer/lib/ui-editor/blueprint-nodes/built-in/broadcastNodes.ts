/**
 * Broadcast nodes for surface/widget runtime messages.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
    BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
} from "@shared/types/blueprint/graph";
import { translate } from "@/lib/i18n";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { resolveNodeInput } from "./graphParamResolvers";

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
                throw new BlueprintGraphExecutionError(
                    translate("blueprint.runtimeError.needsGame", { node: translate("blueprint.node.sendBroadcast") }),
                    ctx.node.id,
                );
            }
            const eventName = String(
                resolveNodeInput(ctx, "event") ?? "",
            ).trim();
            if (!eventName) {
                throw new BlueprintGraphExecutionError(
                    translate("blueprint.runtimeError.inputEmpty", {
                        node: translate("blueprint.node.sendBroadcast"),
                        pin: translate("blueprint.port.event"),
                    }),
                    ctx.node.id,
                );
            }
            const data = resolveNodeInput(ctx, "data");
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
