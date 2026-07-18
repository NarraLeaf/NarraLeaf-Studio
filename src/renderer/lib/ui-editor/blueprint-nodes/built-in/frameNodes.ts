/**
 * App-level host nodes: page navigation, frame params and child-to-parent events,
 * and application window state. The node types here are still prefixed
 * `blueprint.page.*` from when this group was labelled "Page" in the palette.
 */

import {
    BLUEPRINT_NODE_TYPE_APP_GET_FULLSCREEN,
    BLUEPRINT_NODE_TYPE_APP_SET_FULLSCREEN,
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING,
    BLUEPRINT_NODE_TYPE_PAGE_QUIT,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

/** Modes offered by the `Set Fullscreen` node card dropdown. */
const FULLSCREEN_MODES = ["enter", "exit", "toggle"] as const;
type FullscreenMode = (typeof FULLSCREEN_MODES)[number];

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

/** An unset dropdown reads as "toggle", the useful default for a fullscreen button. */
function toFullscreenMode(raw: unknown): FullscreenMode {
    const value = String(raw ?? "");
    return FULLSCREEN_MODES.includes(value as FullscreenMode) ? (value as FullscreenMode) : "toggle";
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
        category: "App",
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
        category: "App",
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
        category: "App",
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
        category: "App",
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
        type: BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING,
        displayName: "Is Surface Transitioning",
        category: "App",
        keywords: ["page", "surface", "enter", "exit", "animation", "transition", "transitioning"],
        graphKinds: ["event", "macro"],
        isPure: true,
        scope: { ownerKinds: ["surfaceMain", "widgetMain", "widgetValue"] },
        pins: [
            { id: "isTransitioning", kind: "output", semantic: "data", valueType: "boolean", label: "Is Transitioning" },
        ],
        execute: () => ({}),
    },
    {
        // Graceful application terminate: asks the NarraLeaf runtime to shut the app down cleanly
        // (leaving room for state saving, crash reporting, etc.) rather than hard-killing it. This
        // is a runtime-initiated quit, so it deliberately does NOT fire the On Window Close
        // Requested blueprint event — that event is only for the user closing the window.
        type: BLUEPRINT_NODE_TYPE_PAGE_QUIT,
        displayName: "Quit Application",
        category: "App",
        keywords: ["quit", "exit", "terminate", "application", "app", "shutdown", "close"],
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
        type: BLUEPRINT_NODE_TYPE_APP_GET_FULLSCREEN,
        displayName: "Get Fullscreen",
        category: "App",
        keywords: ["fullscreen", "full", "screen", "window", "app", "display", "state", "read"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            { id: "isFullscreen", kind: "output", semantic: "data", valueType: "boolean", label: "Is Fullscreen" },
        ],
        async execute(ctx) {
            const isFullscreen = await requireHostApi(ctx).navigation.getFullscreen();
            return { nextPort: "next", outputValues: { isFullscreen } };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_APP_SET_FULLSCREEN,
        displayName: "Set Fullscreen",
        category: "App",
        keywords: ["fullscreen", "full", "screen", "window", "app", "display", "enter", "exit", "toggle", "maximize"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        inspectorParams: [
            {
                key: "mode",
                label: "Mode",
                kind: "select",
                options: [
                    { value: "enter", label: "Enter Fullscreen" },
                    { value: "exit", label: "Exit Fullscreen" },
                    { value: "toggle", label: "Toggle Fullscreen" },
                ],
            },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const mode = toFullscreenMode(ctx.params.mode);
            const fullscreen = mode === "toggle" ? !(await api.navigation.getFullscreen()) : mode === "enter";
            await api.navigation.setFullscreen(fullscreen);
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
        displayName: "Get Page Param",
        category: "App",
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
        category: "App",
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
