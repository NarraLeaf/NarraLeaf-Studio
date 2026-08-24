/**
 * One game, one tab.
 *
 * Two tabs of the same web export are two games writing to one IndexedDB: the same save slots, the
 * same persistent variables, the same read-text table. Nothing about that is detected or merged -
 * whichever tab writes last wins, and the player finds out when a slot they saved in one tab is
 * something else in the other. The desktop shells settled the same question with a single-instance
 * lock; this is the web's half of it.
 *
 * A Web Lock is what a page has for it. The lock is held for as long as the document lives and
 * released by the browser when it goes away, so nothing has to be cleaned up on a crash, a closed
 * tab or a phone that killed the app - which is exactly why it is used instead of a flag written
 * into storage, where a game that crashed would lock its player out of the next one.
 *
 * ## Why it waits rather than asks
 *
 * A reload is the same document twice: the new page may start before the old one has been torn
 * down, and the lock is still held for those milliseconds. An immediate answer (`ifAvailable`)
 * would tell a player who pressed F5 that their game is open in another tab. So the request waits,
 * and only a lock still held after the grace period is treated as another tab - which costs a
 * genuine second tab a moment before it says so, and costs the ordinary case nothing at all.
 *
 * Comments in English per project convention.
 */

import type { GameSessionClaim } from "@shared/types/gameRuntime";

/** The part of the browser's `LockManager` this needs. */
export interface SessionLockManager {
    request(
        name: string,
        options: { signal?: AbortSignal },
        callback: () => Promise<void>,
    ): Promise<unknown>;
}

export interface SessionLockHost {
    /** `navigator.locks`, or null in a browser that has none. */
    locks: SessionLockManager | null;
    /** The lock's name. Per project, so two games on one host do not lock each other out. */
    name: string;
    /** How long a lock held by something else is given to be released. */
    waitMs: number;
    /** `AbortSignal.timeout`, which is what ends the wait. */
    timeoutSignal: (ms: number) => AbortSignal;
}

/**
 * Take the session for this page, or report that another page holds it.
 *
 * Resolves as soon as the lock is granted and keeps holding it: the callback handed to the lock
 * manager never settles, so the browser releases the lock only when this document is destroyed.
 *
 * A browser with no Web Locks is granted the session. The gate exists to keep a player's saves
 * consistent, and refusing to run where the check cannot be made would cost them the game itself.
 */
export function claimGameSession(host: SessionLockHost): Promise<GameSessionClaim> {
    const locks = host.locks;
    if (!locks) {
        return Promise.resolve("granted");
    }
    return new Promise<GameSessionClaim>(resolve => {
        let granted = false;
        let settled = false;
        const answer = (claim: GameSessionClaim): void => {
            if (!settled) {
                settled = true;
                resolve(claim);
            }
        };
        let request: Promise<unknown>;
        try {
            request = locks.request(host.name, { signal: host.timeoutSignal(host.waitMs) }, () => {
                granted = true;
                answer("granted");
                // Never settles: the lock is this page's for as long as the page exists.
                return new Promise<void>(() => undefined);
            });
        } catch {
            // A browser that has the API but refuses the call (a sandboxed or opaque origin) is in
            // the same position as one without it: unable to answer, and not a reason to refuse.
            answer("granted");
            return;
        }
        void Promise.resolve(request).catch(() => {
            // The wait ran out, which is the answer, unless the lock had already been granted and
            // the timeout only fired afterwards.
            answer(granted ? "granted" : "taken");
        });
    });
}
