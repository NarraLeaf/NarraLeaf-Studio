/**
 * Story Action Blueprint variable nodes: Scene Var (NLR Scene.local) and Saved Var (NLR Storable).
 * Only available in story-action blueprints; backed by `ctx.hostAdapter.storyRuntime`, which the
 * story compiler binds to the running NLR `Script` context. Comments in English per convention.
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

export const storyVariableBlueprintNodes: BlueprintNodeDef[] = [
    getNode(BLUEPRINT_NODE_TYPE_SCENE_GET, "Get Scene Var", "sceneVariableId", "sceneVariableRef", "Scene variable", sceneAccess),
    setNode(BLUEPRINT_NODE_TYPE_SCENE_SET, "Set Scene Var", "sceneVariableId", "sceneVariableRef", "Scene variable", sceneAccess),
    getNode(BLUEPRINT_NODE_TYPE_SAVED_GET, "Get Saved Var", "savedVariableId", "savedVariableRef", "Saved variable", savedAccess),
    setNode(BLUEPRINT_NODE_TYPE_SAVED_SET, "Set Saved Var", "savedVariableId", "savedVariableRef", "Saved variable", savedAccess),
];
