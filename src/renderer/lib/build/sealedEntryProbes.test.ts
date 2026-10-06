import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import { openSealedProbePool, type ProbeReply, type ProbeRequest, type ProbeThread } from "./sealedEntryProbes";

/**
 * The pool that spreads a sealed package's audit over threads, driven with stand-in threads.
 *
 * What it must never do is change an answer: whichever thread proves an entry, or none, the audit
 * has to hear the same thing it heard when every entry was read here one after another.
 */

/** Entries with content, entries without, and one that cannot be read at all. */
const STORE: Record<string, number> = { a: 3, b: 0, c: 5, d: 1, e: 2, f: 4 };

function answerFor(name: string): ProbeReply {
    if (name === "broken") {
        return { kind: "failed", message: "sealed bundle read hit end of file early" };
    }
    if (!(name in STORE)) {
        return { kind: "failed", message: `sealed bundle entry not found: ${name}` };
    }
    return { kind: "answer", present: STORE[name] > 0 };
}

async function fallback(name: string): Promise<boolean> {
    const reply = answerFor(name);
    if (reply.kind === "failed") {
        throw new Error(reply.message);
    }
    return reply.kind === "answer" && reply.present;
}

type FakeOptions = {
    /** Never says it is ready; reports the store unopenable instead. */
    unavailable?: boolean;
    /** Dies, as a thread whose process ran out of memory would, on being handed this entry. */
    dieOn?: string;
};

class FakeThread extends EventEmitter {
    readonly proved: string[] = [];
    holding = 0;
    mostHeld = 0;
    closed = false;

    constructor(private readonly options: FakeOptions = {}) {
        super();
        setImmediate(() => this.emit("message", this.options.unavailable
            ? { kind: "unavailable", message: "cannot open" }
            : { kind: "ready" }));
    }

    postMessage(request: ProbeRequest): void {
        if (request.kind === "close") {
            this.closed = true;
            setImmediate(() => this.emit("exit", 0));
            return;
        }
        if (request.name === this.options.dieOn) {
            setImmediate(() => this.emit("exit", 1));
            return;
        }
        this.holding += 1;
        this.mostHeld = Math.max(this.mostHeld, this.holding);
        this.proved.push(request.name);
        setImmediate(() => {
            this.holding -= 1;
            this.emit("message", answerFor(request.name));
        });
    }

    terminate(): void {
        this.emit("exit", 1);
    }
}

function settle(promise: Promise<boolean>): Promise<boolean | string> {
    return promise.catch((error: Error) => error.message);
}

describe("openSealedProbePool", () => {
    it("answers every entry exactly as reading it here does, on threads", async () => {
        const threads: FakeThread[] = [];
        const pool = openSealedProbePool({
            threads: 3,
            spawn: () => {
                const thread = new FakeThread();
                threads.push(thread);
                return thread as unknown as ProbeThread;
            },
            fallback: () => Promise.reject(new Error("no entry should be proven here")),
        });
        const names = [...Object.keys(STORE), "missing", "broken"];
        const answers = await Promise.all(names.map(name => settle(pool.exists(name))));
        await pool.close();

        expect(answers).toEqual(await Promise.all(names.map(name => settle(fallback(name)))));
        expect(threads).toHaveLength(3);
        // One entry per thread at a time is what bounds the memory a package's audit holds.
        expect(threads.every(thread => thread.mostHeld === 1)).toBe(true);
        expect(threads.flatMap(thread => thread.proved).sort()).toEqual([...names].sort());
        expect(threads.every(thread => thread.closed)).toBe(true);
    });

    it("starts no more threads than there is work for", async () => {
        let spawned = 0;
        const pool = openSealedProbePool({
            threads: 8,
            spawn: () => {
                spawned += 1;
                return new FakeThread() as unknown as ProbeThread;
            },
            fallback,
        });
        expect(await pool.exists("a")).toBe(true);
        await pool.close();
        expect(spawned).toBe(1);
    });

    it("reads here, one entry at a time, when it has no threads", async () => {
        let holding = 0;
        let mostHeld = 0;
        const pool = openSealedProbePool({
            threads: 0,
            spawn: () => {
                throw new Error("no thread should be started");
            },
            fallback: async name => {
                holding += 1;
                mostHeld = Math.max(mostHeld, holding);
                await new Promise(resolve => setImmediate(resolve));
                holding -= 1;
                return fallback(name);
            },
        });
        const answers = await Promise.all(Object.keys(STORE).map(name => pool.exists(name)));
        await pool.close();
        expect(answers).toEqual(Object.values(STORE).map(size => size > 0));
        expect(mostHeld).toBe(1);
    });

    it("carries on here when no thread can open the store", async () => {
        const pool = openSealedProbePool({
            threads: 2,
            spawn: () => new FakeThread({ unavailable: true }) as unknown as ProbeThread,
            fallback,
        });
        const answers = await Promise.all(["a", "b", "missing"].map(name => settle(pool.exists(name))));
        await pool.close();
        expect(answers).toEqual([true, false, "sealed bundle entry not found: missing"]);
    });

    it("carries on here when a thread cannot even be started", async () => {
        const pool = openSealedProbePool({
            threads: 2,
            spawn: () => {
                throw new Error("worker script not found");
            },
            fallback,
        });
        expect(await pool.exists("c")).toBe(true);
        await pool.close();
    });

    it("gives the entry a dead thread was holding to someone else rather than failing it", async () => {
        const pool = openSealedProbePool({
            threads: 1,
            spawn: () => new FakeThread({ dieOn: "c" }) as unknown as ProbeThread,
            fallback,
        });
        const answers = await Promise.all(["a", "c", "d"].map(name => pool.exists(name)));
        await pool.close();
        expect(answers).toEqual([true, true, true]);
    });
});
