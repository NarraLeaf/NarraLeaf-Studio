/**
 * Backlog (dialogue history) blueprint nodes for interface blueprints.
 *
 * These are UI-blueprint nodes (event / macro graphs on a Page or Widget), NOT story-action
 * blueprints: a backlog screen reads the running game's dialogue history and can rewind the game
 * to any past line. They map onto NarraLeaf-React `LiveGame.getHistory()` / `LiveGame.undo(id)`.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET,
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
        displayName: "Get Backlog",
        category: "Backlog",
        keywords: ["backlog", "history", "log", "dialog", "dialogue", "say", "menu", "entries", "game", "nlr"],
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
        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
        displayName: "Restore From History",
        category: "Backlog",
        keywords: ["backlog", "history", "restore", "jump", "rewind", "undo", "go back", "entry", "id", "game", "nlr"],
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
        displayName: "Undo Last Dialogue",
        category: "Backlog",
        keywords: ["backlog", "history", "undo", "back", "rewind", "previous", "last", "dialog", "dialogue", "game", "nlr"],
        graphKinds: [...BACKLOG_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.restoreHistory();
            return { nextPort: "next" };
        },
    },
];
