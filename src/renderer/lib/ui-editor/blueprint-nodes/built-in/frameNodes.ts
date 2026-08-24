/**
 * App-level host nodes: page navigation, frame params and child-to-parent events,
 * and application window state. The node types here are still prefixed
 * `blueprint.page.*` from when this group was labelled "Page" in the palette.
 */

import {
    BLUEPRINT_EXTERNAL_LINK_PARAM_URL,
    BLUEPRINT_NODE_TYPE_APP_GET_FULLSCREEN,
    BLUEPRINT_NODE_TYPE_APP_OPEN_EXTERNAL,
    BLUEPRINT_NODE_TYPE_APP_GET_WINDOW_SCALE,
    BLUEPRINT_NODE_TYPE_APP_GET_WINDOW_SCALE_OPTIONS,
    BLUEPRINT_NODE_TYPE_APP_SET_FULLSCREEN,
    BLUEPRINT_NODE_TYPE_APP_SET_WINDOW_SCALE,
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_PAGE_BACK,
    BLUEPRINT_NODE_TYPE_PAGE_CLEAR,
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING,
    BLUEPRINT_NODE_TYPE_PAGE_QUIT,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_VALUE_TYPE_ARRAY } from "@shared/types/blueprint/valueTypes";
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
        // The way back out of a page. Pages are a stack, so the alternative an author reaches for -
        // Go Page, back to where they came from - pushes another page instead of removing one: the
        // config screen opened over a running story stays over it forever, and a second Go Page
        // leaves three pages deep. `navigation.pageBack` has always existed on the host; this is
        // the node that lets a blueprint call it.
        //
        // Closing the last remaining page is a no-op rather than an error: a page reached from the
        // title screen is the bottom of the stack, and a Back button that throws there would make
        // the same button unusable on the same screen depending on how the player got to it.
        type: BLUEPRINT_NODE_TYPE_PAGE_BACK,
        displayName: "Go back",
        category: "App",
        keywords: ["page", "back", "close", "return", "dismiss", "pop", "layer", "overlay"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).navigation.pageBack();
            return { nextPort: "next" };
        },
    },
    {
        // Escape, on every page, without the author having to know how deep the player is or whether
        // they came from the title screen. `Go back` pops one, so Escape over a game two pages deep
        // lands on the page underneath; `Go Page (None)` empties the stack, which on the title screen
        // would dismiss the title itself. This clears exactly the pages a running game is wearing.
        //
        // Doing nothing outside a game is the useful half: the same handler can be wired everywhere,
        // and `Clear Page -> Go back` reads as "leave the game if I am in one, otherwise step back" -
        // Go back is a no-op once the stack is down to its root.
        type: BLUEPRINT_NODE_TYPE_PAGE_CLEAR,
        displayName: "Clear Page",
        category: "App",
        keywords: ["page", "clear", "close", "dismiss", "overlay", "game", "escape", "resume"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).navigation.clearGameOverlay();
            return { nextPort: "next" };
        },
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
        // Requested blueprint event - that event is only for the user closing the window.
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
        /**
         * The sizes a configuration screen may offer for the game's window.
         *
         * The list is the author's own, from Project -> App -> Window, and it is what makes a size
         * row possible to build once: the row is drawn from whatever comes back rather than from
         * numbers typed into the graph, so changing the offered sizes changes the screen.
         *
         * **Empty is an answer, not a failure.** A shell with no window of its own to size - the web
         * export, Dev Mode, the story preview - returns nothing here, and a row built from it draws
         * nothing there. That is the point: a size control that cannot move a window is worse than
         * no control at all.
         *
         * Each entry is a multiple of the size the game is drawn at: 1 is the design size, 0.5 is
         * half of it. What that means in pixels depends on the project, which is why the numbers
         * are ratios and not widths.
         */
        type: BLUEPRINT_NODE_TYPE_APP_GET_WINDOW_SCALE_OPTIONS,
        displayName: "Get Window Scale Options",
        category: "App",
        keywords: ["window", "size", "scale", "options", "resolution", "app", "display", "config"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: false,
        pins: [
            execIn,
            execNext,
            {
                id: "scales",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_ARRAY,
                label: "Scales",
            },
        ],
        execute(ctx) {
            const scales = requireHostApi(ctx).navigation.getWindowScaleOptions();
            return { nextPort: "next", outputValues: { scales } };
        },
    },
    {
        /** The size the window is at now, as one of the offered multiples. */
        type: BLUEPRINT_NODE_TYPE_APP_GET_WINDOW_SCALE,
        displayName: "Get Window Scale",
        category: "App",
        keywords: ["window", "size", "scale", "app", "display", "config"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            { id: "scale", kind: "output", semantic: "data", valueType: "float", label: "Scale" },
        ],
        async execute(ctx) {
            const scale = await requireHostApi(ctx).navigation.getWindowScale();
            return { nextPort: "next", outputValues: { scale } };
        },
    },
    {
        /**
         * Resize the game's window to one of the offered multiples of its design size.
         *
         * A size the project does not offer is answered with the nearest one it does, rather than
         * refused: the ladder belongs to the author, and a graph that computed 0.8 should move the
         * window rather than fail. Full screen and maximised are left first - both are answers to
         * the same question, and a window sized underneath either would spring back the moment the
         * player left it.
         */
        type: BLUEPRINT_NODE_TYPE_APP_SET_WINDOW_SCALE,
        displayName: "Set Window Scale",
        category: "App",
        keywords: ["window", "size", "scale", "resize", "app", "display", "config"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            { id: "scale", kind: "input", semantic: "data", valueType: "float", label: "Scale" },
        ],
        async execute(ctx) {
            const raw = Number(readPin(ctx, "scale") ?? 1);
            const scale = Number.isFinite(raw) && raw > 0 ? raw : 1;
            await requireHostApi(ctx).navigation.setWindowScale(scale);
            return { nextPort: "next" };
        },
    },
    {
        /**
         * A link out of the game: a store page, a patch note, a support form.
         *
         * The address is written here or wired in, and there is nothing to declare anywhere else:
         * the author wrote the graph, so an address in it is the author's decision. What the shell
         * checks - in the process that would open the page, never in the renderer - is the scheme,
         * because `shell.openExternal` hands the address to whatever the platform registered for it.
         * See `@shared/types/blueprint/externalLink`.
         *
         * `Failed` covers both a scheme this node does not open and a browser that would not open
         * the page, with `Error` saying which. They share a pin because the author's answer to both
         * is the same - the player did not get the page, so show them something else - and a graph
         * that has to branch on a refusal it cannot fix is a branch that never runs in a build.
         */
        type: BLUEPRINT_NODE_TYPE_APP_OPEN_EXTERNAL,
        displayName: "Open Link",
        category: "App",
        keywords: ["link", "url", "browser", "external", "open", "web", "store", "page", "site"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            {
                id: BLUEPRINT_EXTERNAL_LINK_PARAM_URL,
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "URL",
            },
            execNext,
            { id: "failed", kind: "output", semantic: "exec", label: "Failed" },
            { id: "error", kind: "output", semantic: "data", valueType: "string", label: "Error" },
        ],
        inspectorParams: [
            {
                key: BLUEPRINT_EXTERNAL_LINK_PARAM_URL,
                label: "URL",
                kind: "string",
            },
        ],
        async execute(ctx) {
            const url = String(readPin(ctx, BLUEPRINT_EXTERNAL_LINK_PARAM_URL) ?? "").trim();
            if (!url) {
                throw new BlueprintGraphExecutionError("Open Link: pick or wire an address", ctx.node.id);
            }
            const result = await requireHostApi(ctx).navigation.openExternal({ url });
            return {
                nextPort: result.outcome === "opened" ? "next" : "failed",
                outputValues: { error: result.error },
            };
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
