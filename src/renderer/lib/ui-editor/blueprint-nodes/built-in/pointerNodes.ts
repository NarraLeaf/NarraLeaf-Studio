/**
 * Moving the player's real mouse cursor.
 *
 * For the thing a controller-friendly menu needs and a mouse-only one cannot fake: putting the
 * pointer on the confirm button, so the player's next click lands where the game already is. It is
 * the same act Windows performs for you when "snap to default button" is on, and it is the game
 * author's call to make - Studio's job is to make it possible and to say plainly where it works.
 *
 * ## Where it works
 *
 * Desktop builds and Dev Mode. A web export cannot position the system pointer, so the node reports
 * `unsupported` there and the build console warns when a project holding these nodes is exported
 * for a non-desktop target - an author should learn this from the build, not from a player.
 *
 * ## Coordinates
 *
 * Stage coordinates, the same ones `Get Measured Rect`, `Get Bounds` and every mouse event's X/Y
 * are in. The author never sees the window and should not have to: the surface was designed at
 * 1280×720 and that is the frame the whole graph speaks in. Turning it into a point on the desktop
 * happens across two processes - see `@shared/utils/blueprintPointerMove`.
 *
 * ## Why the duration is a parameter rather than a second node
 *
 * `Animate Property` already established the shape: one action, with how long it takes written on
 * it. A zero duration puts the cursor there at once, and any positive one makes it travel. Two
 * nodes would double the family for a difference the author reads off a field either way, and the
 * "instant" one would still need to explain itself against a smooth one sitting beside it.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_POINTER_MOVE_EASINGS,
    normalizeBlueprintPointerMoveDurationSeconds,
    type BlueprintPointerMoveEasing,
    type BlueprintPointerMoveResult,
} from "@shared/types/blueprint/pointer";
import {
    BLUEPRINT_VALUE_TYPE_ELEMENT,
    BLUEPRINT_VALUE_TYPE_VECTOR2D,
    normalizeBlueprintVector2D,
} from "@shared/types/blueprint/valueTypes";
import { UI_DISPLAYABLE_WIDGET_TYPES } from "@shared/types/ui-editor/displayableWidgets";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

/**
 * `Failed` covers both a host that cannot move the cursor and a move the system refused, with
 * `Error` saying which. They share a pin for the reason Open Link's do: the author's answer to both
 * is the same - the pointer is not where the game wanted it, so carry on without assuming it is -
 * and a branch for a refusal nobody can fix is a branch that never runs in a shipped build.
 */
const execFailed: BlueprintNodePinDef = { id: "failed", kind: "output", semantic: "exec", label: "Failed" };
const errorOut: BlueprintNodePinDef = {
    id: "error",
    kind: "output",
    semantic: "data",
    valueType: "string",
    label: "Error",
};

const pointIn: BlueprintNodePinDef = {
    id: "point",
    kind: "input",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_VECTOR2D,
    label: "Point",
};

const elementIn: BlueprintNodePinDef = {
    id: "element",
    kind: "input",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_ELEMENT,
    label: "Element",
};

const travelInspectorParams: BlueprintNodeDef["inspectorParams"] = [
    { key: "duration", label: "Duration (s)", kind: "number" },
    {
        key: "easing",
        label: "Easing",
        kind: "select",
        options: [
            { value: "linear", label: "Linear" },
            { value: "easeIn", label: "Ease In" },
            { value: "easeOut", label: "Ease Out" },
            { value: "easeInOut", label: "Ease In Out" },
        ],
    },
];

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

function readTravel(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): {
    durationSeconds: number;
    easing: BlueprintPointerMoveEasing;
} {
    const easing = String(ctx.params.easing ?? "");
    return {
        durationSeconds: normalizeBlueprintPointerMoveDurationSeconds(ctx.params.duration),
        easing: (BLUEPRINT_POINTER_MOVE_EASINGS as readonly string[]).includes(easing)
            ? (easing as BlueprintPointerMoveEasing)
            : "easeInOut",
    };
}

function branchOn(result: BlueprintPointerMoveResult) {
    return {
        nextPort: result.outcome === "moved" ? "next" : "failed",
        outputValues: { error: result.error ?? null },
    };
}

export const pointerBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO,
        displayName: "Move Mouse To",
        category: "App",
        keywords: ["mouse", "cursor", "pointer", "move", "position", "point"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [execIn, pointIn, execNext, execFailed, errorOut],
        inspectorParams: travelInspectorParams,
        async execute(ctx) {
            const travel = readTravel(ctx);
            const point = normalizeBlueprintVector2D(readPin(ctx, "point"));
            // The surface the graph is running for. A global graph has none, and the host reads
            // that as the active surface - which is the one the player is looking at, and so the
            // one a bare pair of coordinates can only have meant.
            const surfaceId = ctx.executionOwner?.surfaceId ?? null;
            return branchOn(await requireHostApi(ctx).pointer.moveTo(surfaceId, point, travel));
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT,
        displayName: "Move Mouse To Element",
        category: "App",
        keywords: ["mouse", "cursor", "pointer", "move", "element", "widget", "button", "center", "focus"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        magicElementTarget: { inputPinId: "element", elementTypes: UI_DISPLAYABLE_WIDGET_TYPES },
        pins: [execIn, elementIn, execNext, execFailed, errorOut],
        inspectorParams: travelInspectorParams,
        async execute(ctx) {
            const travel = readTravel(ctx);
            const ref = normalizeBlueprintElementRefValue(readPin(ctx, "element"));
            if (!ref) {
                throw new BlueprintGraphExecutionError("Move Mouse To Element requires an Element input", ctx.node.id);
            }
            // Measured rather than computed: the centre of where the widget is drawn is the point a
            // click would land on, and a widget mid-animation or in a list row is not where the
            // document says it is.
            return branchOn(await requireHostApi(ctx).pointer.moveToElementCenter(ref.elementId, travel));
        },
    },
];
