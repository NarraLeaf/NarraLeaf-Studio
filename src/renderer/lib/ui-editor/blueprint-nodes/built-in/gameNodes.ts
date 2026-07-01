import {
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_ARRAY,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
} from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };
const saveIdIn: BlueprintNodePinDef = {
    id: "id",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Id",
    allowInlineLiteral: true,
};
const GRAPH_KINDS = ["event", "macro"] as const;

function resolveSaveId(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): string {
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, "id", ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    const id = String(value ?? "").trim();
    if (!id) {
        throw new BlueprintGraphExecutionError("Save id is required", ctx.node.id);
    }
    return id;
}

export const gameBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_START_STORY,
        displayName: "Start Game",
        category: "Game",
        keywords: ["game", "start", "story", "scene", "nlr", "preview"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn],
        inspectorParams: [
            {
                key: "storyId",
                label: "Story",
                kind: "select",
                dynamicOptionsSource: "stories",
            },
            {
                key: "sceneId",
                label: "Scene",
                kind: "select",
                dynamicOptionsSource: "storyScenes",
                dynamicOptionsFilter: {
                    paramKey: "storyId",
                    optionMetaKey: "storyId",
                },
            },
        ],
        async execute(ctx) {
            const storyId = String(ctx.params.storyId ?? "").trim();
            const sceneId = String(ctx.params.sceneId ?? "").trim();
            if (!storyId) {
                throw new BlueprintGraphExecutionError("Pick a Story", ctx.node.id);
            }
            if (!sceneId) {
                throw new BlueprintGraphExecutionError("Pick a Scene", ctx.node.id);
            }
            await requireHostApi(ctx).game.startStory({ storyId, sceneId });
            return { nextPort: undefined };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
        displayName: "Write Save",
        category: "Game",
        keywords: ["game", "save", "write", "slot", "storage"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, saveIdIn],
        async execute(ctx) {
            await requireHostApi(ctx).game.writeSave(resolveSaveId(ctx));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
        displayName: "Load Save",
        category: "Game",
        keywords: ["game", "save", "load", "read", "slot", "storage"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, saveIdIn],
        async execute(ctx) {
            await requireHostApi(ctx).game.loadSave(resolveSaveId(ctx));
            return { nextPort: undefined };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
        displayName: "List Saves",
        category: "Game",
        keywords: ["game", "save", "list", "ids", "slots", "storage"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "ids",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_ARRAY,
                label: "Ids",
            },
        ],
        async execute(ctx) {
            const ids = await requireHostApi(ctx).game.listSaveIds();
            return {
                nextPort: "next",
                outputValues: { ids },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
        displayName: "Get Save Preview",
        category: "Game",
        keywords: ["game", "save", "preview", "image", "screenshot", "slot"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            saveIdIn,
            {
                id: "preview",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
                label: "Preview",
            },
        ],
        async execute(ctx) {
            const preview = await requireHostApi(ctx).game.getSavePreview(resolveSaveId(ctx));
            return {
                nextPort: "next",
                outputValues: { preview },
            };
        },
    },
];
