/**
 * Asking the browser to keep the player's saves, and keeping the answer.
 *
 * Everything a web export stores - saves, persistent variables, which lines have been read - is in
 * one IndexedDB, and a browser under storage pressure may evict a site's data whole. Persistent
 * storage is the grant that takes the site off that list, and the page asks for it as it loads.
 *
 * The answer is the point. Asking and discarding the reply leaves nobody able to say whether this
 * player's saves are safe: not the player, and not the author, who is the one who could put a line
 * on a title screen about it. So the request is made once and its outcome is what the shell reports
 * (see the bridge's `storageDurability`).
 *
 * Nothing here decides anything on the game's behalf. `evictable` is not a failure - a player can
 * finish a game in a tab whose storage the browser is free to reclaim, and most do.
 *
 * Comments in English per project convention.
 */

import type { GameStorageDurability } from "@shared/types/gameRuntime";

/** The part of `navigator.storage` this needs; a browser's carries more. */
export interface StorageDurabilityHost {
    /** Whether the grant is already held. Null in a browser without the Storage API. */
    persisted: (() => Promise<boolean>) | null;
    /** Ask for it. Null where the browser reports the state but takes no request. */
    persist: (() => Promise<boolean>) | null;
}

/**
 * Ask once, and answer what the browser said.
 *
 * `persisted()` is consulted first so a returning player is not asked again - in browsers that put
 * this behind a prompt, a grant already given must not raise a second one.
 *
 * A browser that will not answer is `unknown` rather than `evictable`. The two lead an author to
 * different words: one is "your saves may be removed", the other is "this browser does not say".
 */
export async function requestStorageDurability(host: StorageDurabilityHost): Promise<GameStorageDurability> {
    try {
        if (host.persisted && await host.persisted()) {
            return "durable";
        }
        if (!host.persist) {
            return host.persisted ? "evictable" : "unknown";
        }
        return await host.persist() ? "durable" : "evictable";
    } catch {
        // A refused or unavailable API, which is not the same as a refused grant.
        return "unknown";
    }
}
