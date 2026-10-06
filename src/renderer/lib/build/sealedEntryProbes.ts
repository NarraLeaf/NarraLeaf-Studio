import { openAssetArchive } from "@narraleaf/bindings/read";

/**
 * Proving a sealed package's entries on several threads at once.
 *
 * The audit proves an entry of a protected package by reading it back, and reading one back means
 * turning every byte of it into plaintext - synchronous work on whichever thread asks. A package
 * with a gigabyte and a half of art spent twelve seconds of a build on one core doing exactly that,
 * while the rest of the machine waited. The store answers any entry on its own (an entry is read
 * from its own byte range, never by way of the ones before it), so several threads can each open
 * the package and prove a share of the entries.
 *
 * Each thread opens the store the way the shipped game does, with the same component, so the claim
 * under test is unchanged: the entry is where the id says, and it has content.
 */

/** What a thread opens: the component that can read the store, and the store. */
export type SealedProbeSpec = {
    binaryPath: string;
    storePath: string;
};

/** The key a thread finds its {@link SealedProbeSpec} under in `workerData`. */
export const SEALED_PROBE_THREAD_DATA = "sealedProbe" as const;

/** What the pool sends a thread. */
export type ProbeRequest = { kind: "probe"; name: string } | { kind: "close" };

/** What a thread sends back. */
export type ProbeReply =
    | { kind: "ready" }
    /** The thread could not open the store; the pool carries on without it. */
    | { kind: "unavailable"; message: string }
    | { kind: "answer"; present: boolean }
    /** Reading the entry failed - an answer about the entry, not about the thread. */
    | { kind: "failed"; message: string };

/** The part of a worker thread the pool uses, so a test can hand in its own. */
export type ProbeThread = {
    on(event: "message", listener: (reply: ProbeReply) => void): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    on(event: "exit", listener: (code: number) => void): unknown;
    postMessage(request: ProbeRequest): void;
    terminate(): unknown;
};

export type SealedProbePool = {
    /** Whether the entry is in the store with content. Rejects when reading it fails. */
    exists(name: string): Promise<boolean>;
    /** Stop every thread, after the work already asked for has been answered. */
    close(): Promise<void>;
};

type Job = {
    name: string;
    resolve: (present: boolean) => void;
    reject: (error: Error) => void;
};

type ThreadState = {
    thread: ProbeThread;
    ready: boolean;
    alive: boolean;
    job: Job | null;
    exited: Promise<void>;
};

/**
 * A queue of entries to prove, served by up to `threads` threads.
 *
 * Threads are started as work arrives rather than all at once, so a package with three entries to
 * prove pays for one thread and not eight. Each thread holds one entry at a time, which is what
 * bounds the memory: an entry is read whole, and a queue that handed out everything at once would
 * hold the whole package in memory.
 *
 * A thread that cannot run - one that fails to start, or cannot open the store - costs speed and
 * nothing else: what it was holding goes back on the queue, and once no thread is left the entries
 * are proven here, one after another, through `fallback`. That is also all that happens when
 * `threads` is 0.
 */
export function openSealedProbePool(input: {
    threads: number;
    spawn: () => ProbeThread;
    fallback: (name: string) => Promise<boolean>;
}): SealedProbePool {
    const queue: Job[] = [];
    const states: ThreadState[] = [];
    let started = 0;
    let closing = false;
    // The in-process reads, one at a time for the same reason a thread holds one entry.
    let fallbackChain: Promise<void> = Promise.resolve();
    let fallbackBusy = false;

    const anyThreadLeft = (): boolean => states.some(state => state.alive);

    const startThread = (): void => {
        started += 1;
        let thread: ProbeThread;
        try {
            thread = input.spawn();
        } catch {
            return;
        }
        let markExited: () => void = () => undefined;
        const state: ThreadState = {
            thread,
            ready: false,
            alive: true,
            job: null,
            exited: new Promise<void>(resolve => { markExited = resolve; }),
        };
        states.push(state);
        const lose = (): void => {
            if (!state.alive) {
                return;
            }
            state.alive = false;
            // Not the entry's fault, so it is not answered as one: it goes back to the front, to
            // be proven by another thread or, if none is left, here.
            if (state.job) {
                queue.unshift(state.job);
                state.job = null;
            }
            pump();
        };
        thread.on("message", reply => {
            if (reply.kind === "ready") {
                state.ready = true;
            } else if (reply.kind === "unavailable") {
                lose();
                return;
            } else {
                const job = state.job;
                state.job = null;
                if (job) {
                    if (reply.kind === "answer") {
                        job.resolve(reply.present);
                    } else {
                        job.reject(new Error(reply.message));
                    }
                }
            }
            pump();
        });
        thread.on("error", () => lose());
        thread.on("exit", () => {
            lose();
            markExited();
        });
    };

    const pump = (): void => {
        for (const state of states) {
            if (queue.length === 0) {
                break;
            }
            if (state.alive && state.ready && !state.job) {
                const job = queue.shift() as Job;
                state.job = job;
                state.thread.postMessage({ kind: "probe", name: job.name });
            }
        }
        // One more thread while there is work no thread is free to take.
        const free = states.filter(state => state.alive && !state.job).length;
        if (!closing && queue.length > free && started < input.threads) {
            startThread();
            pump();
            return;
        }
        if (queue.length > 0 && !anyThreadLeft() && (started >= input.threads || closing)) {
            drainHere();
        }
    };

    const drainHere = (): void => {
        if (fallbackBusy) {
            return;
        }
        fallbackBusy = true;
        fallbackChain = (async () => {
            while (queue.length > 0) {
                const job = queue.shift() as Job;
                try {
                    job.resolve(await input.fallback(job.name));
                } catch (error) {
                    job.reject(error instanceof Error ? error : new Error(String(error)));
                }
            }
            // In the same turn as finding the queue empty, so an entry asked for a moment later
            // starts a drain of its own rather than waiting on this one.
            fallbackBusy = false;
        })();
    };

    return {
        exists(name) {
            return new Promise<boolean>((resolve, reject) => {
                queue.push({ name, resolve, reject });
                pump();
            });
        },
        async close() {
            closing = true;
            await fallbackChain;
            await Promise.all(states.map(async state => {
                if (state.alive) {
                    state.thread.postMessage({ kind: "close" });
                    // Told to close, a thread releases the store and ends on its own; one that has
                    // not within a few seconds is stopped instead.
                    const stopped = await Promise.race([
                        state.exited.then(() => true),
                        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000).unref?.()),
                    ]);
                    if (!stopped) {
                        state.thread.terminate();
                    }
                }
            }));
        },
    };
}

/** The other end of a {@link ProbeThread}: what the thread's own message port looks like. */
export type ProbePort = {
    on(event: "message", listener: (request: ProbeRequest) => void): unknown;
    postMessage(reply: ProbeReply): void;
    close(): void;
};

/** Run as a probe thread: open the store, then prove whatever entry is asked for until told to close. */
export async function serveSealedProbes(spec: SealedProbeSpec, port: ProbePort): Promise<void> {
    let store: Awaited<ReturnType<typeof openAssetArchive>>;
    try {
        store = await openAssetArchive(spec.binaryPath, spec.storePath);
    } catch (error) {
        port.postMessage({ kind: "unavailable", message: error instanceof Error ? error.message : String(error) });
        port.close();
        return;
    }
    port.on("message", request => {
        if (request.kind === "close") {
            void store.close().finally(() => port.close());
            return;
        }
        store.read(request.name)
            .then(bytes => port.postMessage({ kind: "answer", present: bytes.byteLength > 0 }))
            .catch((error: unknown) => port.postMessage({
                kind: "failed",
                message: error instanceof Error ? error.message : String(error),
            }));
    });
    port.postMessage({ kind: "ready" });
}
