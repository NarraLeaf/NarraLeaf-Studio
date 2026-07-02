/**
 * Page component host nodes for frame params and child-to-parent events.
 */

import {
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING,
    BLUEPRINT_NODE_TYPE_PAGE_QUIT,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };

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

async function goToSurface(ctx: Parameters<BlueprintNodeDef["execute"]>[0], surfaceId: string) {
    const targetSurfaceId = surfaceId.trim();
    await requireHostApi(ctx).navigation.openSurface(targetSurfaceId, readPin(ctx, "props"));
    return { nextPort: undefined };
}

export const frameBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_PAGE_GO,
        displayName: "Go Page",
        category: "Page",
        keywords: ["page", "go", "navigate", "open", "surface"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            {
                id: "props",
                kind: "input",
                semantic: "data",
                valueType: "json",
                label: "Page props",
                optional: true,
            },
        ],
        inspectorParams: [
            {
                key: "surfaceId",
                label: "Page",
                kind: "select",
                dynamicOptionsSource: "surfaces",
                emptyOptionLabel: "None",
            },
        ],
        execute: ctx => goToSurface(ctx, String(ctx.params.surfaceId ?? "")),
    },
    {
        type: BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
        displayName: "Get Page Props",
        category: "Page",
        keywords: ["page", "props", "properties", "input"],
        graphKinds: ["event", "macro"],
        isPure: true,
        scope: { ownerKinds: ["surfaceMain", "widgetMain", "widgetValue"] },
        pins: [
            { id: "props", kind: "output", semantic: "data", valueType: "json", label: "Props" },
        ],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING,
        displayName: "Is Surface Exiting",
        category: "Page",
        keywords: ["page", "surface", "exit", "exiting", "animation", "transition"],
        graphKinds: ["event", "macro"],
        isPure: true,
        scope: { ownerKinds: ["surfaceMain", "widgetMain", "widgetValue"] },
        pins: [
            { id: "isExiting", kind: "output", semantic: "data", valueType: "boolean", label: "Is Exiting" },
        ],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING,
        displayName: "Is Surface Entering",
        category: "Page",
        keywords: ["page", "surface", "enter", "entering", "animation", "transition"],
        graphKinds: ["event", "macro"],
        isPure: true,
        scope: { ownerKinds: ["surfaceMain", "widgetMain", "widgetValue"] },
        pins: [
            { id: "isEntering", kind: "output", semantic: "data", valueType: "boolean", label: "Is Entering" },
        ],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_PAGE_QUIT,
        displayName: "Quit",
        category: "Page",
        keywords: ["page", "quit", "exit", "application", "app"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [execIn],
        async execute(ctx) {
            await requireHostApi(ctx).navigation.quitApplication();
            return { nextPort: undefined };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
        displayName: "Get Page Param",
        category: "Page",
        keywords: ["page", "frame", "param", "input"],
        graphKinds: ["event", "macro"],
        hideInPalette: true,
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
            const eventName = String(readPin(ctx, "event") ?? "").trim();
            if (!eventName) {
                throw new BlueprintGraphExecutionError("Missing page event name", ctx.node.id);
            }
            const data = readPin(ctx, "data");
            await api.frame.emit(eventName, data);
            return { nextPort: "next" };
        },
    },
];
