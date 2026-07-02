import {
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG,
    BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_GAME_QUIT,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG,
    BLUEPRINT_NODE_TYPE_GAME_SKIP,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY,
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
const saveMetadataIn: BlueprintNodePinDef = {
    id: "metadata",
    kind: "input",
    semantic: "data",
    valueType: "json",
    label: "Metadata",
};
const sentenceSpeedIn: BlueprintNodePinDef = {
    id: "speed",
    kind: "input",
    semantic: "data",
    valueType: "float",
    label: "Speed",
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

function cloneJsonValue(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? null : JSON.parse(serialized);
    } catch {
        return null;
    }
}

function resolveSaveMetadata(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): unknown {
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, "metadata", ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    return cloneJsonValue(value);
}

function resolveSentenceSpeed(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): number {
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, "speed", ctx.params, ctx.blueprintLocals, 10, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    const speed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(speed) || speed <= 0) {
        throw new BlueprintGraphExecutionError("Sentence speed must be a positive number", ctx.node.id);
    }
    return speed;
}

export const gameBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
        displayName: "Get Nametag",
        category: "Game",
        keywords: ["game", "dialog", "nametag", "speaker", "character", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "nametag",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Nametag",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    nametag: requireHostApi(ctx).game.getNametag(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME,
        displayName: "Is In Game",
        category: "Game",
        keywords: ["game", "state", "active", "running", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isInGame",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "In Game",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    isInGame: requireHostApi(ctx).game.isInGame(),
                },
            };
        },
    },
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
        type: BLUEPRINT_NODE_TYPE_GAME_QUIT,
        displayName: "Quit Game",
        category: "Game",
        keywords: ["game", "quit", "exit", "return", "page", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn],
        inspectorParams: [
            {
                key: "surfaceId",
                label: "Page",
                kind: "select",
                dynamicOptionsSource: "surfaces",
            },
        ],
        async execute(ctx) {
            const surfaceId = String(ctx.params.surfaceId ?? "").trim();
            if (!surfaceId) {
                throw new BlueprintGraphExecutionError("Pick a Page", ctx.node.id);
            }
            await requireHostApi(ctx).game.quit(surfaceId);
            return { nextPort: undefined };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_NEXT,
        displayName: "Next",
        category: "Game",
        keywords: ["game", "dialog", "next", "advance", "continue", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.next();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SKIP,
        displayName: "Skip",
        category: "Game",
        keywords: ["game", "dialog", "skip", "fast", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.skip();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG,
        displayName: "Show Dialog",
        category: "Game",
        keywords: ["game", "dialog", "show", "display", "visible", "preference", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.showDialog();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG,
        displayName: "Hide Dialog",
        category: "Game",
        keywords: ["game", "dialog", "hide", "display", "invisible", "preference", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.hideDialog();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY,
        displayName: "Toggle Dialog Display",
        category: "Game",
        keywords: ["game", "dialog", "toggle", "display", "visible", "preference", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.toggleDialogDisplay();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
        displayName: "Set Sentence Speed",
        category: "Game",
        keywords: ["game", "dialog", "sentence", "speed", "cps", "preference", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, sentenceSpeedIn],
        async execute(ctx) {
            await requireHostApi(ctx).game.setSentenceSpeed(resolveSentenceSpeed(ctx));
            return { nextPort: "next" };
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
        pins: [execIn, execNext, saveIdIn, saveMetadataIn],
        async execute(ctx) {
            await requireHostApi(ctx).game.writeSave(resolveSaveId(ctx), resolveSaveMetadata(ctx));
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
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
        displayName: "Delete Save",
        category: "Game",
        keywords: ["game", "save", "delete", "remove", "slot", "storage"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, saveIdIn],
        async execute(ctx) {
            await requireHostApi(ctx).game.deleteSave(resolveSaveId(ctx));
            return { nextPort: "next" };
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
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
        displayName: "Get Save Metadata",
        category: "Game",
        keywords: ["game", "save", "metadata", "json", "slot"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            saveIdIn,
            {
                id: "metadata",
                kind: "output",
                semantic: "data",
                valueType: "json",
                label: "Metadata",
            },
        ],
        async execute(ctx) {
            const metadata = await requireHostApi(ctx).game.getSaveMetadata(resolveSaveId(ctx));
            return {
                nextPort: "next",
                outputValues: { metadata },
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
