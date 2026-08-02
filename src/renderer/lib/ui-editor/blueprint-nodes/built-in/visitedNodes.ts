/**
 * The visited record's read surface: `Is Scene Visited` / `Is Option Picked`, plus the wipe.
 *
 * These answer the two questions every VN asks and Studio could not: has the player been down this
 * route (a gallery / recollection lock), and have they already picked this line (a one-shot option).
 * The record itself is written by the story compiler - see `runtime/game/storyVisited.ts` for where
 * it lives and why the saved domain is the right one.
 *
 * Why not `Has Read Text`: that record is written when a line is DISPLAYED, so every option of a
 * menu the player merely opened counts as read. `Is Option Picked` is written on the pick, which is
 * the distinction the whole feature turns on.
 *
 * The two readers are `isPure` / non-latent on purpose, and that is a constraint rather than a
 * preference. A function graph refuses any node that is latent or impure
 * (`BlueprintNodeRegistry.ts`), and the story expression language is meant to reach this same
 * capability later - an effectful or async reader would be unreachable from both. Purity is also
 * what lets a recollection list bind a locked look straight to the pin instead of running a graph
 * per row.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_GAME_CLEAR_VISITED,
    BLUEPRINT_NODE_TYPE_GAME_IS_OPTION_PICKED,
    BLUEPRINT_NODE_TYPE_GAME_IS_SCENE_VISITED,
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

/**
 * The dynamic-select source ids these nodes pick from.
 *
 * `storyScenes` is the same source `Start Game` already uses, so the scene picker came for free and
 * an author sees one list of scenes across the whole palette. `storyChoiceOptions` is new (built in
 * `BlueprintEntryTab.tsx` beside it) and filtered by the same `storyId` param, so picking a story
 * narrows the options the way it narrows the scenes.
 */
const STORY_SCENE_OPTIONS_SOURCE = "storyScenes";
const STORY_CHOICE_OPTIONS_SOURCE = "storyChoiceOptions";

/** Present on both readers so the dependent picker below has a story to filter against. */
const storyParam = {
    key: "storyId",
    label: "Story",
    kind: "select",
    dynamicOptionsSource: "stories",
} as const;

export const visitedBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_SCENE_VISITED,
        displayName: "Is Scene Visited",
        category: "Game",
        keywords: ["game", "scene", "visited", "seen", "been", "route", "unlock", "gallery", "recollection", "extra"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isVisited",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Is Visited",
            },
        ],
        inspectorParams: [
            storyParam,
            {
                key: "sceneId",
                label: "Scene",
                kind: "select",
                dynamicOptionsSource: STORY_SCENE_OPTIONS_SOURCE,
                dynamicOptionsFilter: { paramKey: "storyId", optionMetaKey: "storyId" },
            },
        ],
        execute(ctx) {
            const sceneId = String(ctx.params.sceneId ?? "").trim();
            return {
                outputValues: {
                    // Nothing picked is "not visited" rather than an error, the same bargain
                    // `Has Read Text` makes: a half-wired row on a gallery screen stays locked
                    // instead of taking the whole page down.
                    isVisited: sceneId ? requireHostApi(ctx).game.isSceneVisited(sceneId) : false,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_OPTION_PICKED,
        displayName: "Is Option Picked",
        category: "Game",
        keywords: ["game", "choice", "option", "picked", "chosen", "selected", "once", "one-shot", "menu"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isPicked",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Is Picked",
            },
        ],
        inspectorParams: [
            storyParam,
            {
                key: "optionId",
                label: "Option",
                kind: "select",
                dynamicOptionsSource: STORY_CHOICE_OPTIONS_SOURCE,
                dynamicOptionsFilter: { paramKey: "storyId", optionMetaKey: "storyId" },
            },
        ],
        execute(ctx) {
            const optionId = String(ctx.params.optionId ?? "").trim();
            return {
                outputValues: {
                    isPicked: optionId ? requireHostApi(ctx).game.isOptionPicked(optionId) : false,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_CLEAR_VISITED,
        displayName: "Clear Visited",
        category: "Game",
        keywords: ["game", "visited", "picked", "clear", "reset", "wipe", "route", "gallery"],
        graphKinds: ["event", "macro"],
        isPure: false,
        // Not latent, unlike `Clear Text Read`: that one writes host persistence and has to be
        // awaited, this one empties two keys in the live `Storable` and is done within the tick.
        isLatent: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        execute(ctx) {
            requireHostApi(ctx).game.clearVisited();
            return { nextPort: "next" };
        },
    },
];
