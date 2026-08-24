/**
 * `Is DLC Installed` - is this piece of extra content beside the running game.
 *
 * The one thing a graph may ask about a DLC, and the question is deliberately about *presence*, not
 * ownership. A DLC arrives as a file next to the game, put there by whatever the player bought it
 * from; whether it is here is a fact this build can see, and it is the fact that decides whether the
 * content behind an entrance exists at all. Whether the player *owns* it is a storefront's fact, and
 * a storefront plugin's node to answer - see the Steam plugin's `Owns DLC`.
 *
 * Keeping those two apart is not tidiness. Ownership can only be asked of a storefront that is
 * running and reachable, so a graph that gated content on it would take an offline player's bought
 * chapter away from them. Presence never does that: the file is either there or it is not.
 *
 * # Why it is pure
 *
 * The same constraint the endings and visited readers are under: a function graph refuses any node
 * that is latent or impure, and purity is what lets a menu row bind a hidden look straight to the
 * pin instead of running a graph per row. A main menu deciding whether to draw "Extra story" is
 * exactly that shape, and it is drawn before any game exists.
 *
 * An unpicked DLC answers "not installed" rather than throwing, so a half-wired row stays hidden
 * instead of taking the menu down.
 *
 * Comments in English per project convention.
 */

import { BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED } from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

/**
 * The DLC picker's dynamic-select source, built in `BlueprintEntryTab.tsx` beside the scene and
 * ending sources. It reads the project's DLC registry, so the list an author picks from cannot
 * offer a DLC the project does not have.
 */
export const DLC_OPTIONS_SOURCE = "dlc";

export const dlcBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED,
        displayName: "Is DLC Installed",
        category: "Game",
        keywords: [
            "dlc", "installed", "addon", "add-on", "extra", "content", "expansion",
            "chapter", "route", "unlock", "owned", "bought", "purchase",
        ],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isInstalled",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Is Installed",
            },
        ],
        inspectorParams: [
            {
                key: "dlcId",
                label: "DLC",
                kind: "select",
                dynamicOptionsSource: DLC_OPTIONS_SOURCE,
            },
        ],
        execute(ctx) {
            const dlcId = String(ctx.params.dlcId ?? "").trim();
            return {
                outputValues: {
                    isInstalled: dlcId ? requireHostApi(ctx).game.isDlcInstalled(dlcId) : false,
                },
            };
        },
    },
];
