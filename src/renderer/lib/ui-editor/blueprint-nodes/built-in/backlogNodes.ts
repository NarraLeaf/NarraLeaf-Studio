/**
 * Dialogue history (backlog) blueprint nodes, grouped under the "Game" category.
 *
 * These are UI-blueprint nodes (event / macro graphs on a Page or Widget), NOT story-action
 * blueprints: a backlog screen reads the running game's dialogue history and can move the game to
 * any line of it.
 *
 * The backlog is a timeline with a play head on it, and these nodes are that timeline's two sides.
 * `Get History` is everything up to the head - the lines read, in order. Stepping back moves the
 * head, and the lines it moved past become the future, which `Get Future History` returns and
 * `Redo Next History Entry` steps back into. `Can Undo History` / `Can Redo History` are what a
 * pair of backlog buttons disable themselves on. They map onto NarraLeaf-React
 * `LiveGame.getHistory()` / `getFuture()` / `restoreToHistory(token)` / `undo()` / `redo()` /
 * `canUndo()` / `canRedo()`.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_CAN_REDO,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_CAN_UNDO,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET_FUTURE,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_REDO_NEXT,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_UNDO_LAST,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_VALUE_TYPE_ARRAY } from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

/** Backlog nodes only make sense while a game is running, i.e. inside event / macro graphs. */
const BACKLOG_GRAPH_KINDS = ["event", "macro"] as const;

const entriesOut: BlueprintNodePinDef = {
    id: "entries",
    kind: "output",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_ARRAY,
    label: "Entries",
};

const countOut: BlueprintNodePinDef = {
    id: "count",
    kind: "output",
    semantic: "data",
    valueType: "integer",
    label: "Count",
};

const entryIdIn: BlueprintNodePinDef = {
    id: "id",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Entry Id",
    allowInlineLiteral: true,
};

/** Resolve the required backlog entry id (the `id` field of a Get Backlog entry). */
function resolveHistoryEntryId(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): string {
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, "id", ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    const id = String(value ?? "").trim();
    if (!id) {
        throw new BlueprintGraphExecutionError("Restore From History: entry id is required", ctx.node.id);
    }
    return id;
}

export const backlogBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET,
        displayName: "Get History",
        category: "Game",
        keywords: ["history", "backlog", "log", "dialog", "dialogue", "say", "menu", "entries", "game", "nlr"],
        graphKinds: [...BACKLOG_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, entriesOut, countOut],
        async execute(ctx) {
            const entries = await requireHostApi(ctx).game.getHistory();
            return {
                nextPort: "next",
                outputValues: {
                    entries,
                    count: entries.length,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET_FUTURE,
        displayName: "Get Future History",
        category: "Game",
        keywords: ["history", "backlog", "future", "ahead", "forward", "redo", "entries", "game", "nlr"],
        graphKinds: [...BACKLOG_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, entriesOut, countOut],
        async execute(ctx) {
            const entries = await requireHostApi(ctx).game.getFuture();
            return {
                nextPort: "next",
                outputValues: {
                    entries,
                    count: entries.length,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
        displayName: "Restore From History",
        category: "Game",
        keywords: ["history", "backlog", "restore", "jump", "rewind", "undo", "go back", "entry", "id", "game", "nlr"],
        graphKinds: [...BACKLOG_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, entryIdIn],
        async execute(ctx) {
            await requireHostApi(ctx).game.restoreHistory(resolveHistoryEntryId(ctx));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_UNDO_LAST,
        displayName: "Undo Last History Entry",
        category: "Game",
        keywords: ["history", "backlog", "undo", "back", "rewind", "previous", "last", "dialog", "dialogue", "game", "nlr"],
        graphKinds: [...BACKLOG_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.restoreHistory();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_REDO_NEXT,
        displayName: "Redo Next History Entry",
        category: "Game",
        keywords: ["history", "backlog", "redo", "forward", "ahead", "next", "again", "dialog", "dialogue", "game", "nlr"],
        graphKinds: [...BACKLOG_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.redoHistory();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_CAN_UNDO,
        displayName: "Can Undo History",
        category: "Game",
        keywords: ["history", "backlog", "undo", "back", "can", "enabled", "game", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "canUndo",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Can Undo",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    canUndo: requireHostApi(ctx).game.canUndoHistory(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_CAN_REDO,
        displayName: "Can Redo History",
        category: "Game",
        keywords: ["history", "backlog", "redo", "forward", "can", "enabled", "game", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "canRedo",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Can Redo",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    canRedo: requireHostApi(ctx).game.canRedoHistory(),
                },
            };
        },
    },
];
