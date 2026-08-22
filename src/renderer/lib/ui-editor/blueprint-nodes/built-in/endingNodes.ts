/**
 * The endings record's read surface: `Is Ending Reached` / `Get Endings`, plus the two wipes.
 *
 * An `/ending` row is the whole declaration - the row IS the ending, and its block id is the
 * identity everything keys on (`@shared/types/story/endings`). These nodes are what an endings
 * screen is built out of: which of them the player has found, and what the full set is to lay out
 * against.
 *
 * # Why this is not the visited family
 *
 * `Is Scene Visited` next door reads a record that lives in the save and rewinds with it, because it
 * answers "have I been down this route in *this* playthrough". An endings screen asks a different
 * question - what has this player ever seen - so the record sits in project persistence and nothing
 * rewinds it. A gallery built on the saved record would re-lock entries in front of a player who
 * loaded an older save, and a "5 of 8" count would go down.
 *
 * That also means none of the four needs a running story. A title screen is exactly where an endings
 * gallery is opened from, and it is opened before any game exists.
 *
 * # Why the readers are pure
 *
 * The same constraint the visited readers are under, and for the same reasons: a function graph
 * refuses any node that is latent or impure (`BlueprintNodeRegistry.ts`), and purity is what lets a
 * gallery row bind a locked look straight to the pin instead of running a graph per row. An empty id
 * answers "not reached" rather than throwing, so a half-wired row stays locked instead of taking the
 * page down.
 *
 * The two wipes are the opposite: both write host persistence, so both are latent and must be
 * awaited. That is the distinction `Clear Visited`'s comment already draws between itself - which
 * empties two keys in the live `Storable` within the tick - and `Clear Text Read`.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDINGS,
    BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDING_STATE,
    BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
    BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

/**
 * The ending picker's dynamic-select source, built in `BlueprintEntryTab.tsx` beside the scene and
 * choice-option sources. It reads the same document scan the compiler emits from, so the list an
 * author picks from cannot offer an ending the build does not produce.
 */
const STORY_ENDING_OPTIONS_SOURCE = "storyEndings";

/** Present on every node with an ending picker, so the dependent picker has a story to filter by. */
const storyParam = {
    key: "storyId",
    label: "Story",
    kind: "select",
    dynamicOptionsSource: "stories",
} as const;

/**
 * The ending picker itself, narrowed by whichever story the param above names.
 *
 * The stored value is the row's block id, never its name: an author renames "Bad End" to "Ashes"
 * whenever they like, and a graph pointing at the row must survive that. The record is keyed the
 * same way, so `storyId` is only ever a filter for this list - it is not part of the question the
 * node asks.
 */
const endingParam = {
    key: "endingId",
    label: "Ending",
    kind: "select",
    dynamicOptionsSource: STORY_ENDING_OPTIONS_SOURCE,
    dynamicOptionsFilter: { paramKey: "storyId", optionMetaKey: "storyId" },
} as const;

export const endingBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
        displayName: "Is Ending Reached",
        category: "Game",
        keywords: [
            "game", "ending", "end", "reached", "unlock", "unlocked", "gallery",
            "recollection", "extra", "completion", "route",
        ],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isReached",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Is Reached",
            },
        ],
        inspectorParams: [storyParam, endingParam],
        execute(ctx) {
            const endingId = String(ctx.params.endingId ?? "").trim();
            return {
                outputValues: {
                    // Nothing picked is "not reached" rather than an error, the same bargain
                    // `Is Scene Visited` makes: a half-wired gallery row stays locked instead of
                    // taking the whole page down.
                    isReached: endingId ? requireHostApi(ctx).game.isEndingReached(endingId) : false,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
        displayName: "Get Endings",
        category: "Game",
        keywords: [
            "game", "ending", "endings", "list", "gallery", "recollection", "extra",
            "completion", "unlock", "route",
        ],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "endings",
                kind: "output",
                semantic: "data",
                valueType: "array",
                label: "Endings",
            },
        ],
        inspectorParams: [storyParam],
        execute(ctx) {
            const storyId = String(ctx.params.storyId ?? "").trim();
            return {
                outputValues: {
                    // One array, not a count and a getter: `Set List Content` takes it whole and
                    // `Get List Item Props` reads a row inside the item template, which is how the
                    // rest of the platform draws a grid without a hand-written loop. Each row
                    // carries `endingId`, `name`, `sceneId`, `sceneName` and `isReached`, so a
                    // template never has to ask a second question per cell.
                    //
                    // Unmasked on purpose. This is the raw data node; whether a locked row shows its
                    // name, a row of dashes or nothing at all is the author's `if`, not ours.
                    endings: storyId ? requireHostApi(ctx).game.listEndings(storyId) : [],
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDING_STATE,
        displayName: "Clear Ending State",
        category: "Game",
        keywords: [
            "game", "ending", "clear", "reset", "forget", "lock", "relock",
            "gallery", "debug",
        ],
        graphKinds: ["event", "macro"],
        isPure: false,
        // Latent, unlike `Clear Visited`: that one empties two keys in the live `Storable` and is
        // done within the tick, this one writes host persistence and has to be awaited before the
        // next node reads the record back.
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [storyParam, endingParam],
        async execute(ctx) {
            const endingId = String(ctx.params.endingId ?? "").trim();
            if (endingId) {
                await requireHostApi(ctx).game.clearEndingState(endingId);
            }
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDINGS,
        displayName: "Clear Endings",
        category: "Game",
        keywords: [
            "game", "ending", "endings", "clear", "reset", "wipe", "progress",
            "gallery", "debug",
        ],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        async execute(ctx) {
            await requireHostApi(ctx).game.clearEndings();
            return { nextPort: "next" };
        },
    },
];
