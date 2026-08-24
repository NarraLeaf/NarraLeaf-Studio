/**
 * `Check Storage Durability` - whether what this build writes stays written.
 *
 * The one thing about a player's saves that the shell knows and the game cannot work out for
 * itself. A packaged desktop game keeps files in a user-data directory that nothing reclaims; a web
 * export is a guest of the browser, where a site that has not been granted persistent storage may
 * be evicted whole under storage pressure - saves, persistent variables and read text together. The
 * page asks for that grant as it loads, and this is the answer it was given.
 *
 * Three branches, because the three lead an author to different words: `Evictable` is "this browser
 * may remove saved games", `Unknown` is a browser that will not say, and telling a player the first
 * when the truth is the second is a promise nobody made. Nothing is decided here on the author's
 * behalf - a page whose storage may be reclaimed is still a page a game can be finished on, and
 * whether the player hears anything about it belongs to the title, not to the runtime.
 *
 * Comments in English per project convention.
 */

import { BLUEPRINT_NODE_TYPE_GAME_STORAGE_DURABILITY } from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

export const storageBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_STORAGE_DURABILITY,
        displayName: "Check Storage Durability",
        category: "Game",
        keywords: [
            "storage", "durable", "durability", "persist", "persistent", "evict", "quota", "browser", "web", "saves",
        ],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "durable", kind: "output", semantic: "exec", label: "Durable" },
            { id: "evictable", kind: "output", semantic: "exec", label: "Evictable" },
            { id: "unknown", kind: "output", semantic: "exec", label: "Unknown" },
        ],
        async execute(ctx) {
            // The branch ids are the answer's own words, so a state added to the shell contract
            // cannot silently land on the wrong branch here - it lands on none, which is loud.
            return { nextPort: await requireHostApi(ctx).storage.durability() };
        },
    },
];
