/**
 * Story variable nodes: Scene Var (NLR `Scene.local`) and Saved Var (NLR `Storable`).
 *
 * Three of the four are story-action only, backed by `ctx.hostAdapter.storyRuntime` - the access
 * pair the story compiler binds to the running NLR `Script` context.
 *
 * `Get Saved Var` is the exception: a Game UI screen may read one too, through the host API's
 * `game.getSavedVariable`. Saved variables are the only per-playthrough state a screen has any
 * business showing - a persistent variable is shared by every save file, so a status screen, a HUD
 * or a map built on one would report the wrong run's progress. The write half stays in the story,
 * where writes are sequenced and undoable; see the capability's note.
 *
 * Comments in English per convention.
 */

import {
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_SAVED_SET,
    BLUEPRINT_NODE_TYPE_SCENE_GET,
    BLUEPRINT_NODE_TYPE_SCENE_SET,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { StoryVariableRuntimeAccess } from "../../runtime/types";
import type { BlueprintNodeDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

type ExecuteCtx = Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0];

function requireStoryRuntime(ctx: ExecuteCtx) {
    const runtime = ctx.hostAdapter.storyRuntime;
    if (!runtime) {
        throw new BlueprintGraphExecutionError(
            "Story variables are only available inside a Story",
            ctx.node.id,
        );
    }
    return runtime;
}

function requireVariableId(ctx: ExecuteCtx, paramKey: string, label: string): string {
    const id = String(ctx.params[paramKey] ?? "").trim();
    if (!id) {
        throw new BlueprintGraphExecutionError(`Pick a ${label}`, ctx.node.id);
    }
    return id;
}

function readValuePin(ctx: ExecuteCtx): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, "value", ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
}

function getNode(
    type: string,
    displayName: string,
    paramKey: string,
    paramKind: "sceneVariableRef" | "savedVariableRef",
    paramLabel: string,
    access: (ctx: ExecuteCtx) => StoryVariableRuntimeAccess,
): BlueprintNodeDef {
    return {
        type,
        displayName,
        category: "Variables",
        keywords: ["get", "read", "story", "variable", paramLabel],
        graphKinds: ["event", "macro"],
        isPure: false,
        scope: { ownerKinds: ["storyAction"] },
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            { id: "value", kind: "output", semantic: "data", valueType: "any", label: "Value" },
        ],
        inspectorParams: [{ key: paramKey, label: paramLabel, kind: paramKind }],
        execute: ctx => {
            const id = requireVariableId(ctx, paramKey, paramLabel);
            return { nextPort: "next", outputValues: { value: access(ctx).get(id) } };
        },
    };
}

function setNode(
    type: string,
    displayName: string,
    paramKey: string,
    paramKind: "sceneVariableRef" | "savedVariableRef",
    paramLabel: string,
    access: (ctx: ExecuteCtx) => StoryVariableRuntimeAccess,
): BlueprintNodeDef {
    return {
        type,
        displayName,
        category: "Variables",
        keywords: ["set", "write", "assign", "story", "variable", paramLabel],
        graphKinds: ["event", "macro"],
        isPure: false,
        scope: { ownerKinds: ["storyAction"] },
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            { id: "value", kind: "input", semantic: "data", valueType: "any", label: "Value" },
        ],
        inspectorParams: [{ key: paramKey, label: paramLabel, kind: paramKind }],
        execute: ctx => {
            const id = requireVariableId(ctx, paramKey, paramLabel);
            access(ctx).set(id, readValuePin(ctx));
            return { nextPort: "next" };
        },
    };
}

const sceneAccess = (ctx: ExecuteCtx) => requireStoryRuntime(ctx).sceneVar;
const savedAccess = (ctx: ExecuteCtx) => requireStoryRuntime(ctx).savedVar;

/**
 * `Get Saved Var`, in a story action and on a Game UI screen alike.
 *
 * Built apart from {@link getNode} because it is the one variable node with two backings and an
 * extra output. Inside a story the runtime access is there and the answer is always found; on a
 * screen the value comes from the host, which reports `found: false` where there is no playthrough
 * to read - a title screen, an editor preview, a screen opened after the player quit.
 *
 * Reporting rather than throwing, because a screen has to lay out before any game exists and a
 * throw in a value binding shows the player an empty widget with nothing anywhere saying why.
 * `Found` is a pin instead of a magic value for the same reason `Get Character` has one: `null` and
 * the declared default are both values a variable can legitimately hold.
 */
const savedGetNode: BlueprintNodeDef = {
    type: BLUEPRINT_NODE_TYPE_SAVED_GET,
    displayName: "Get Saved Var",
    category: "Variables",
    keywords: ["get", "read", "story", "variable", "saved", "save", "flag", "progress", "affection"],
    graphKinds: ["event", "macro"],
    isPure: false,
    pins: [
        { id: "in", kind: "input", semantic: "exec", label: "In" },
        { id: "next", kind: "output", semantic: "exec", label: "Next" },
        { id: "value", kind: "output", semantic: "data", valueType: "any", label: "Value" },
        { id: "found", kind: "output", semantic: "data", valueType: "boolean", label: "Found" },
    ],
    inspectorParams: [{ key: "savedVariableId", label: "Saved variable", kind: "savedVariableRef" }],
    execute: ctx => {
        const id = requireVariableId(ctx, "savedVariableId", "Saved variable");
        const storyRuntime = ctx.hostAdapter.storyRuntime;
        if (storyRuntime) {
            return { nextPort: "next", outputValues: { value: storyRuntime.savedVar.get(id), found: true } };
        }
        const read = requireHostApi(ctx).game.getSavedVariable(id);
        return { nextPort: "next", outputValues: { value: read.value, found: read.found } };
    },
};

export const storyVariableBlueprintNodes: BlueprintNodeDef[] = [
    getNode(BLUEPRINT_NODE_TYPE_SCENE_GET, "Get Scene Var", "sceneVariableId", "sceneVariableRef", "Scene variable", sceneAccess),
    setNode(BLUEPRINT_NODE_TYPE_SCENE_SET, "Set Scene Var", "sceneVariableId", "sceneVariableRef", "Scene variable", sceneAccess),
    savedGetNode,
    setNode(BLUEPRINT_NODE_TYPE_SAVED_SET, "Set Saved Var", "savedVariableId", "savedVariableRef", "Saved variable", savedAccess),
];
