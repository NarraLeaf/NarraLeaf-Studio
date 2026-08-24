import { describe, expect, it, vi } from "vitest";
import { claimGameSession, type SessionLockManager } from "./sessionLock";

/** A lock manager holding one named lock, granted to whoever asks while it is free. */
function lockManager(): SessionLockManager & { release: () => void; held: () => boolean } {
    let holder: (() => void) | null = null;
    const waiting: Array<{ run: () => void; signal?: AbortSignal }> = [];
    return {
        held: () => holder !== null,
        release: () => {
            holder = null;
            const next = waiting.shift();
            next?.run();
        },
        request(_name, options, callback) {
            return new Promise((resolve, reject) => {
                const run = (): void => {
                    holder = () => undefined;
                    void callback().then(resolve, reject);
                };
                if (!holder) {
                    run();
                    return;
                }
                const entry = { run, signal: options.signal };
                waiting.push(entry);
                options.signal?.addEventListener("abort", () => {
                    const at = waiting.indexOf(entry);
                    if (at >= 0) {
                        waiting.splice(at, 1);
                        reject(new Error("AbortError"));
                    }
                });
            });
        },
    };
}

function host(locks: SessionLockManager | null, controller = new AbortController()) {
    return {
        locks,
        name: "narraleaf-game:test",
        waitMs: 50,
        timeoutSignal: () => controller.signal,
        abort: () => controller.abort(),
    };
}

describe("claimGameSession", () => {
    it("grants the session to the first page and holds the lock", async () => {
        const locks = lockManager();
        await expect(claimGameSession(host(locks))).resolves.toBe("granted");
        expect(locks.held()).toBe(true);
    });

    it("reports a session another page is holding once the wait runs out", async () => {
        const locks = lockManager();
        await claimGameSession(host(locks));
        const second = host(locks);
        const claim = claimGameSession(second);
        second.abort();
        await expect(claim).resolves.toBe("taken");
    });

    it("waits rather than refusing, so a reload takes the lock the old page is letting go of", async () => {
        // The page that reloads is the same document twice: for a moment the outgoing one still
        // holds the lock. An immediate answer would tell the player their game is open elsewhere.
        const locks = lockManager();
        await claimGameSession(host(locks));
        const claim = claimGameSession(host(locks));
        locks.release();
        await expect(claim).resolves.toBe("granted");
    });

    it("grants the session where the browser has no Web Locks", async () => {
        await expect(claimGameSession(host(null))).resolves.toBe("granted");
    });

    it("grants the session where the call itself is refused", async () => {
        const refusing: SessionLockManager = {
            request: vi.fn(() => {
                throw new Error("SecurityError");
            }),
        };
        await expect(claimGameSession(host(refusing))).resolves.toBe("granted");
    });
});
