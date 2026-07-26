/**
 * Quick Save blueprint node definitions, shared by both plugin entries:
 * - main.ts (studio entry) registers the full defs for the editor palette
 *   and in-editor preview execution.
 * - runtime.ts (runtime entry) registers the execute bindings for game
 *   execution environments (Dev Mode window, Preview, Production).
 *
 * All nodes operate on one reserved save slot id that players never see,
 * so a story graph gets quick save / quick read without managing ids.
 */

import type { BlueprintNodeDef } from "narraleaf-studio/plugin";

export const PLUGIN_ID = "narraleaf.quick-save";
export const QUICK_SAVE_SLOT_ID = `${PLUGIN_ID}.slot`;

export function createQuickSaveBlueprintNodes(): BlueprintNodeDef[] {
    return [
        {
            type: `${PLUGIN_ID}.save`,
            displayName: "Quick Save",
            category: "Game",
            keywords: ["game", "save", "quick", "quicksave", "write", "slot"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            execute: async ctx => {
                await getHostApi(ctx).game.writeSave(QUICK_SAVE_SLOT_ID);
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.load`,
            displayName: "Quick Read",
            category: "Game",
            keywords: ["game", "save", "load", "read", "quick", "quickload", "slot"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
            ],
            execute: async ctx => {
                const game = getHostApi(ctx).game;
                if (!await hasQuickSave(game)) {
                    return { nextPort: undefined };
                }
                await game.loadSave(QUICK_SAVE_SLOT_ID);
                return { nextPort: undefined };
            },
        },
        {
            type: `${PLUGIN_ID}.has`,
            displayName: "Has Quick Save",
            category: "Game",
            keywords: ["game", "save", "quick", "quicksave", "has", "exists", "slot"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
                {
                    id: "hasQuickSave",
                    kind: "output",
                    semantic: "data",
                    valueType: "boolean",
                    label: "Has Save",
                },
            ],
            execute: async ctx => {
                return {
                    nextPort: "next",
                    outputValues: {
                        hasQuickSave: await hasQuickSave(getHostApi(ctx).game),
                    },
                };
            },
        },
    ];
}

async function hasQuickSave(game: ReturnType<typeof getHostApi>["game"]): Promise<boolean> {
    const ids = await game.listSaveIds();
    return ids.includes(QUICK_SAVE_SLOT_ID);
}

function getHostApi(ctx: Parameters<BlueprintNodeDef["execute"]>[0]) {
    const hostApi = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!hostApi) {
        throw new Error("Quick Save nodes require game host APIs");
    }
    return hostApi;
}
