/**
 * Files on their way between this machine's projects and a NarraLeaf Team server.
 *
 * **Where a live session's bytes actually move.** The renderer decides that a file has to travel
 * and says which one; everything after that is here, and nothing that crosses between the two
 * processes is larger than a path and a count. That is not tidiness - the renderer may not reach
 * the network at all, and a file that went through an inter-process message would be a copy of
 * itself in a second heap on the way to a third.
 *
 * ## Three things this owns, and each of them is a promise the old channel could not make
 *
 * **Nothing is held.** An upload is a read stream from the project's own file into a socket; a
 * download is a socket into a file beside where it belongs. Both are paced by the socket, so the
 * cost of a transfer is a buffer regardless of what it weighs.
 *
 * **An interruption is resumed.** The server keeps what it already holds, so every attempt begins
 * by asking how much of the file is there and going on from that byte. Which interruption it was -
 * a reconnect, the session ending, Studio being closed - makes no difference, because the answer
 * to all three is the same question.
 *
 * **A transfer outlives this process.** {@link JOURNAL} is what makes the last sentence true across
 * a restart: a line per transfer in flight, written when one begins and removed when it lands. It
 * holds an address, a length, a fingerprint and a path, and no content - so it is small, and losing
 * it costs a transfer that starts again rather than a file that is wrong.
 *
 * ## What is deliberately not here
 *
 * No pacing figure, no chunk size, no fairness rule. Those existed when bytes and sentences shared
 * one channel and one of them had to be made to wait; they are two connections now, and the
 * operating system is better at deciding whose packet goes first than a constant is.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";

import { transferRetryDelayMs, TRANSFER_ATTEMPT_LIMIT } from "@shared/live/blobs";
import { teamInstanceId } from "@shared/types/team";
import type {
    TeamTransferDirection,
    TeamTransferOutcome,
    TeamTransferProblem,
    TeamTransferRequest,
    TeamTransferState,
    TeamTransferView,
} from "@shared/types/teamTransfer";

import {
    describeBlob,
    dropBlob,
    figureIn,
    receiveBlob,
    reserveBlob,
    sendBlob,
    sentenceIn,
    type BlobTarget,
} from "./blobRequest";

/** Where the transfers in flight are written down, under the user data directory. */
export const JOURNAL = "live-transfers.json";

/**
 * How long a finished transfer stays in the list.
 *
 * ⚠ **Kept rather than dropped, and that is load-bearing.** What tells the asset library that a
 * file has landed is asking about the transfer, and an entry that vanished the instant it finished
 * would be indistinguishable from one that was never asked for - which is a record whose file never
 * arrives and nothing that ever says so.
 */
export const DONE_KEEP_MS = 5 * 60_000;

/**
 * How fast a file goes out while `slow-live-transfer` is on.
 *
 * The condition exists so the state between a transfer starting and finishing can be looked at
 * rather than inferred; on a loopback connection an ordinary one is over before a screenshot. Only
 * the sending side is slowed, because the server hands a file on as it arrives - so slowing what
 * goes in slows what comes out of both ends of the room.
 */
export const SLOW_BYTES_PER_SECOND = 1024 * 1024;

/** What this needs from the rest of Studio, so a test can hand it four functions instead. */
export interface TeamTransferDeps {
    /** Where a server is, or null for one Studio has no record of. */
    readonly authUrlFor: (remoteOrigin: string) => string | null;
    /** The token for a server, or null when there is none or it cannot be read. */
    readonly tokenFor: (remoteOrigin: string) => string | null;
    /** This installation's own id. The instance a request names is built from it, never from a window. */
    readonly installation: () => string;
    readonly userDataDir: () => string;
    readonly log: (line: string) => void;
    /** Whether to send slowly enough to watch. */
    readonly slow: () => boolean;
}

interface Entry {
    readonly remoteOrigin: string;
    readonly project: string;
    readonly transferId: string;
    readonly label: string;
    readonly direction: TeamTransferDirection;
    /** The file on this disk: what is being sent, or where what is arriving belongs. */
    readonly localPath: string;
    readonly size: number;
    readonly digest: string;
    bytes: number;
    state: TeamTransferState;
    problem?: TeamTransferProblem;
    attempt: number;
    running: boolean;
    abort: AbortController;
    settledAt?: number;
    timer?: NodeJS.Timeout;
}

/** One line of the journal. Everything needed to pick a transfer up in a later run. */
interface JournalLine {
    remoteOrigin: string;
    project: string;
    transferId: string;
    label: string;
    direction: TeamTransferDirection;
    localPath: string;
    size: number;
    digest: string;
}

function keyOf(remoteOrigin: string, project: string, transferId: string): string {
    // None of the three can hold a newline: two are ids and one is a URL.
    return `${remoteOrigin}\n${project}\n${transferId}`;
}

export class TeamTransfers {
    private readonly entries = new Map<string, Entry>();
    private loaded = false;
    private writing: Promise<void> = Promise.resolve();

    public constructor(private readonly deps: TeamTransferDeps) {}

    /* --------------------------------------------------------------------- what a window asks */

    public async handle(request: TeamTransferRequest): Promise<TeamTransferOutcome> {
        await this.load();
        switch (request.action) {
            case "offer":
                return this.offer(request);
            case "collect":
                return this.collect(request);
            case "abandon":
                return this.abandon(request);
            case "resume":
                return this.resume(request);
            case "status":
                return { ok: true, kind: "transfers", transfers: this.views() };
        }
    }

    /** Everything in flight, as a window reads it. */
    public views(): TeamTransferView[] {
        this.prune();
        return [...this.entries.values()].map((entry) => ({
            transferId: entry.transferId,
            label: entry.label,
            direction: entry.direction,
            bytes: entry.bytes,
            total: entry.size,
            state: entry.state,
            ...(entry.problem === undefined ? {} : { problem: entry.problem }),
        }));
    }

    /** Stop everything and forget it. What closing Studio does. */
    public dispose(): void {
        for (const entry of this.entries.values()) {
            entry.abort.abort();
            if (entry.timer !== undefined) {
                clearTimeout(entry.timer);
            }
        }
        this.entries.clear();
    }

    /* ------------------------------------------------------------------------------- offering */

    /**
     * Measure a file, get the server to agree to hold it, and start sending.
     *
     * ⚠ **Answers before the bytes have gone anywhere**, and that ordering is the whole reason
     * reserving is a step of its own. The operation that names this file is stated on this answer,
     * so this is the last moment at which "there is no room for it" can be a refusal an author
     * reads rather than an import that stops halfway on everybody else's screen.
     */
    private async offer(
        request: Extract<TeamTransferRequest, { action: "offer" }>,
    ): Promise<TeamTransferOutcome> {
        const target = this.targetFor(request.remoteOrigin, request.project, request.transferId);
        if ("problem" in target) {
            return { ok: false, problem: target.problem };
        }

        let measured: { size: number; digest: string };
        try {
            measured = await measure(request.source);
        } catch (cause) {
            return {
                ok: false,
                problem: { kind: "refused", detail: describe(cause) },
            };
        }

        let answer;
        try {
            answer = await reserveBlob(target.target, { length: measured.size, digest: measured.digest });
        } catch (cause) {
            return { ok: false, problem: { kind: "offline", detail: describe(cause) } };
        }
        if (answer.status === 507) {
            return {
                ok: false,
                problem: { kind: "quota", limit: figureIn(answer, "limit") ?? 0 },
            };
        }
        if (answer.status !== 201) {
            return { ok: false, problem: { kind: "refused", detail: sentenceIn(answer) } };
        }

        this.begin({
            remoteOrigin: request.remoteOrigin,
            project: request.project,
            transferId: request.transferId,
            label: request.label,
            direction: "out",
            localPath: request.source,
            size: measured.size,
            digest: measured.digest,
        });
        return { ok: true, kind: "offered", size: measured.size, digest: measured.digest };
    }

    /** Start collecting a file the room has and this machine does not. */
    private collect(
        request: Extract<TeamTransferRequest, { action: "collect" }>,
    ): TeamTransferOutcome {
        this.begin({
            remoteOrigin: request.remoteOrigin,
            project: request.project,
            transferId: request.transferId,
            label: request.label,
            direction: "in",
            localPath: request.destination,
            size: request.size,
            digest: request.digest,
        });
        return { ok: true, kind: "accepted" };
    }

    /**
     * Stop these and take them off the server.
     *
     * Asked about transfers this machine has never heard of as a matter of course: cancelling an
     * import is an ordinary deletion, every machine in the room applies it, and most of them were
     * not the one carrying the file. The delete is sent anyway - whoever gets there first frees the
     * bytes, and the rest are answered the same way.
     */
    private async abandon(
        request: Extract<TeamTransferRequest, { action: "abandon" }>,
    ): Promise<TeamTransferOutcome> {
        let count = 0;
        for (const transferId of request.transferIds) {
            const key = keyOf(request.remoteOrigin, request.project, transferId);
            const entry = this.entries.get(key);
            if (entry !== undefined) {
                entry.abort.abort();
                if (entry.timer !== undefined) {
                    clearTimeout(entry.timer);
                }
                this.entries.delete(key);
                count += 1;
                // Half a file, beside where the whole one belongs. Taken out here rather than left
                // for a later run to wonder about.
                if (entry.direction === "in") {
                    await fs.rm(partial(entry.localPath), { force: true });
                }
            }
            const target = this.targetFor(request.remoteOrigin, request.project, transferId);
            if (!("problem" in target)) {
                try {
                    await dropBlob(target.target);
                } catch (cause) {
                    // The bytes go on the sweep's schedule instead. Nothing an author can act on.
                    this.deps.log(`[Team] could not drop ${transferId}: ${describe(cause)}`);
                }
            }
        }
        this.save();
        return { ok: true, kind: "accepted", count };
    }

    /** Pick up whatever this project left unfinished, in this run or in an earlier one. */
    private resume(
        request: Extract<TeamTransferRequest, { action: "resume" }>,
    ): TeamTransferOutcome {
        let count = 0;
        for (const entry of this.entries.values()) {
            if (entry.remoteOrigin !== request.remoteOrigin || entry.project !== request.project) {
                continue;
            }
            if (entry.state === "done" || entry.running) {
                continue;
            }
            entry.attempt = 0;
            delete entry.problem;
            this.run(entry);
            count += 1;
        }
        return { ok: true, kind: "accepted", count };
    }

    /* ---------------------------------------------------------------------------- the two loops */

    private begin(line: JournalLine): void {
        const key = keyOf(line.remoteOrigin, line.project, line.transferId);
        const already = this.entries.get(key);
        if (already !== undefined && already.state !== "failed") {
            return;
        }
        const entry: Entry = {
            ...line,
            bytes: 0,
            state: "waiting",
            attempt: 0,
            running: false,
            abort: new AbortController(),
        };
        this.entries.set(key, entry);
        this.save();
        this.run(entry);
    }

    private run(entry: Entry): void {
        if (entry.running || entry.abort.signal.aborted) {
            return;
        }
        entry.running = true;
        entry.state = "moving";
        const work = entry.direction === "out" ? this.push(entry) : this.pull(entry);
        void work
            .catch((cause: unknown) => {
                this.again(entry, { kind: "offline", detail: describe(cause) });
            })
            .finally(() => {
                entry.running = false;
            });
    }

    /**
     * Try again later, or stop.
     *
     * ⚠ **Bounded twice** - by the delay, which backs off, and by the count. What is being retried
     * is a request to a server that may be down or may be holding an object whose sender has closed,
     * and a retry that did neither would be one machine asking, for the rest of the session, a
     * question nothing can answer.
     */
    private again(entry: Entry, problem: TeamTransferProblem): void {
        if (entry.abort.signal.aborted) {
            return;
        }
        entry.problem = problem;
        entry.attempt += 1;
        if (entry.attempt >= TRANSFER_ATTEMPT_LIMIT) {
            entry.state = "failed";
            entry.settledAt = Date.now();
            this.deps.log(
                `[Team] gave up carrying ${entry.transferId}: ${problem.kind} (${entry.bytes}/${entry.size} bytes)`,
            );
            return;
        }
        entry.state = "waiting";
        entry.timer = setTimeout(() => {
            this.run(entry);
        }, transferRetryDelayMs(entry.attempt));
        entry.timer.unref?.();
    }

    /** Stop for good, without waiting to be asked again. */
    private stop(entry: Entry, problem: TeamTransferProblem): void {
        entry.problem = problem;
        entry.state = "failed";
        entry.settledAt = Date.now();
        entry.attempt = TRANSFER_ATTEMPT_LIMIT;
    }

    private settle(entry: Entry): void {
        entry.state = "done";
        entry.bytes = entry.size;
        delete entry.problem;
        entry.settledAt = Date.now();
        this.save();
    }

    /** Send this machine's file, from wherever the server says the object ends. */
    private async push(entry: Entry): Promise<void> {
        const target = this.targetFor(entry.remoteOrigin, entry.project, entry.transferId);
        if ("problem" in target) {
            this.stop(entry, target.problem);
            return;
        }

        const known = await describeBlob(target.target);
        if (known === undefined) {
            // Somebody cancelled this import, and the object went with it. **This is what stops a
            // sender partway through rather than at the end**, and it needs no message: the machine
            // that cancelled deleted the object, and the next byte this tries to write has nowhere
            // to go.
            this.stop(entry, { kind: "gone" });
            return;
        }
        entry.bytes = known.received;
        if (known.received >= entry.size) {
            this.settle(entry);
            return;
        }

        const source = createReadStream(entry.localPath, { start: known.received });
        const answer = await sendBlob(target.target, {
            source: this.deps.slow() ? source.pipe(slowly(SLOW_BYTES_PER_SECOND)) : source,
            offset: known.received,
            onProgress: (bytes) => {
                entry.bytes = bytes;
            },
            signal: entry.abort.signal,
        });
        if (answer.status === 404) {
            this.stop(entry, { kind: "gone" });
            return;
        }
        if (answer.status === 409) {
            // The server is not where this thought it was. Asking again reads the true offset.
            this.again(entry, { kind: "refused", detail: sentenceIn(answer) });
            return;
        }
        if (answer.status !== 200) {
            this.again(entry, { kind: "refused", detail: sentenceIn(answer) });
            return;
        }
        const after = await describeBlob(target.target);
        if (after?.complete === true) {
            this.settle(entry);
            return;
        }
        this.again(entry, { kind: "offline", detail: "that transfer stopped short" });
    }

    /**
     * Collect a file into the place it belongs, a piece at a time.
     *
     * Written beside its destination and moved into place only once every byte is there and hashes
     * to what the sender said. ⚠ **Never written straight to the destination**: a half-written asset
     * under its real name is one the project would show, open and ship.
     */
    private async pull(entry: Entry): Promise<void> {
        const target = this.targetFor(entry.remoteOrigin, entry.project, entry.transferId);
        if ("problem" in target) {
            this.stop(entry, target.problem);
            return;
        }

        const staging = partial(entry.localPath);
        await fs.mkdir(path.dirname(staging), { recursive: true });
        const already = await sizeOf(staging);
        entry.bytes = already;

        if (already < entry.size) {
            const sink = createWriteStream(staging, { flags: "a" });
            let outcome: { status: number; wrote: number };
            try {
                outcome = await receiveBlob(target.target, {
                    sink,
                    from: already,
                    onProgress: (bytes) => {
                        entry.bytes = bytes;
                    },
                    signal: entry.abort.signal,
                });
            } finally {
                await new Promise<void>((settle) => sink.end(() => settle()));
            }
            if (outcome.status === 404) {
                await fs.rm(staging, { force: true });
                this.stop(entry, { kind: "gone" });
                return;
            }
            if (outcome.status !== 200 && outcome.status !== 206) {
                this.again(entry, { kind: "offline", detail: `that server answered ${outcome.status}` });
                return;
            }
            entry.bytes = await sizeOf(staging);
        }

        if (entry.bytes < entry.size) {
            // The response ended while the sender was still writing, which is ordinary: the server
            // holds a reader only so long. Picked up again from where this got to.
            this.again(entry, { kind: "offline", detail: "that file has not all been sent yet" });
            return;
        }

        const measured = await measure(staging);
        if (measured.digest !== entry.digest || measured.size !== entry.size) {
            // Checked rather than assumed. A file put together from an interrupted transfer with a
            // gap in it is a file that looks fine until somebody opens it.
            await fs.rm(staging, { force: true });
            this.stop(entry, { kind: "corrupt" });
            return;
        }

        await fs.mkdir(path.dirname(entry.localPath), { recursive: true });
        // Removed first: on Windows a rename will not replace a file that is already there, and a
        // replacement is exactly what this is when an asset's content is being changed.
        await fs.rm(entry.localPath, { force: true });
        await fs.rename(staging, entry.localPath);
        this.settle(entry);
    }

    /* ------------------------------------------------------------------------------- the edges */

    private targetFor(
        remoteOrigin: string,
        project: string,
        transferId: string,
    ): { target: BlobTarget } | { problem: TeamTransferProblem } {
        const authUrl = this.deps.authUrlFor(remoteOrigin);
        if (authUrl === null) {
            return { problem: { kind: "unavailable", detail: "this Studio has no record of that server" } };
        }
        const token = this.deps.tokenFor(remoteOrigin);
        if (token === null) {
            return { problem: { kind: "unavailable", detail: "this Studio is not signed in to that server" } };
        }
        return {
            target: {
                authUrl,
                token,
                userDataDir: this.deps.userDataDir(),
                // ⚠ Built here from this installation's own id, never taken from a window: the
                // instance a request names is what the server checks the project against, and a
                // renderer that named its own could name somebody else's.
                instance: teamInstanceId(this.deps.installation(), project),
                project,
                transferId,
            },
        };
    }

    /** Drop what has been settled long enough that nothing is going to ask about it again. */
    private prune(): void {
        const now = Date.now();
        for (const [key, entry] of [...this.entries.entries()]) {
            if (entry.settledAt !== undefined && now - entry.settledAt > DONE_KEEP_MS) {
                this.entries.delete(key);
            }
        }
    }

    /* ------------------------------------------------------------------------------ the journal */

    private journalPath(): string {
        return path.join(this.deps.userDataDir(), JOURNAL);
    }

    private async load(): Promise<void> {
        if (this.loaded) {
            return;
        }
        this.loaded = true;
        let text: string;
        try {
            text = await fs.readFile(this.journalPath(), "utf-8");
        } catch {
            // No journal is the ordinary case: nothing was interrupted.
            return;
        }
        let lines: unknown;
        try {
            lines = JSON.parse(text);
        } catch {
            this.deps.log("[Team] the transfer journal could not be read; starting with none");
            return;
        }
        if (!Array.isArray(lines)) {
            return;
        }
        for (const line of lines) {
            const read = readLine(line);
            if (read === null) {
                continue;
            }
            const key = keyOf(read.remoteOrigin, read.project, read.transferId);
            if (this.entries.has(key)) {
                continue;
            }
            // Left waiting rather than started. Nothing is picked up until a window says which
            // project it is in: starting here would mean reaching a server before anybody has
            // opened anything, on behalf of a session that may never be rejoined.
            this.entries.set(key, {
                ...read,
                bytes: 0,
                state: "waiting",
                attempt: 0,
                running: false,
                abort: new AbortController(),
            });
        }
    }

    /**
     * Write down what is in flight.
     *
     * Serialised through one promise rather than written whenever something changes: several
     * transfers begin at once for one import, and two writers on one small file is the one way a
     * journal ends up shorter than what it describes.
     */
    private save(): void {
        this.writing = this.writing.then(async () => {
            const lines: JournalLine[] = [...this.entries.values()]
                .filter((entry) => entry.state !== "done")
                .map((entry) => ({
                    remoteOrigin: entry.remoteOrigin,
                    project: entry.project,
                    transferId: entry.transferId,
                    label: entry.label,
                    direction: entry.direction,
                    localPath: entry.localPath,
                    size: entry.size,
                    digest: entry.digest,
                }));
            try {
                if (lines.length === 0) {
                    await fs.rm(this.journalPath(), { force: true });
                    return;
                }
                await fs.writeFile(this.journalPath(), JSON.stringify(lines, null, 2), "utf-8");
            } catch (cause) {
                // A journal that cannot be written costs a transfer that starts again after a
                // restart. Worth a line in the log and nothing else.
                this.deps.log(`[Team] the transfer journal could not be written: ${describe(cause)}`);
            }
        });
    }
}

/* ----------------------------------------------------------------------------------- helpers */

/** Where a file being collected is written until every byte of it is there. */
export function partial(destination: string): string {
    return `${destination}.nlpart`;
}

/**
 * How long a file is and what it hashes to, without reading it into anything.
 *
 * SHA-256 because this runs over hundreds of megabytes and the platform's is native. The digest is
 * carried in the operation that names the file and checked against what came off the wire, so it is
 * the one thing standing between an interrupted transfer and an asset that opens as nonsense.
 */
export async function measure(file: string): Promise<{ size: number; digest: string }> {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(file)) {
        const bytes = chunk as Buffer;
        size += bytes.length;
        hash.update(bytes);
    }
    return { size, digest: hash.digest("hex") };
}

async function sizeOf(file: string): Promise<number> {
    try {
        return (await fs.stat(file)).size;
    } catch {
        return 0;
    }
}

/**
 * A stream that lets no more than so many bytes through a second.
 *
 * Only ever reached under an experimental condition. It sleeps between pieces rather than measuring
 * a rate, which is imprecise and exactly good enough for its one purpose: making a transfer last
 * long enough to look at.
 */
export function slowly(bytesPerSecond: number): Transform {
    const piece = Math.max(1, Math.floor(bytesPerSecond / 10));
    return new Transform({
        transform(chunk: Buffer, _encoding, done): void {
            const push = (at: number): void => {
                if (at >= chunk.length) {
                    done();
                    return;
                }
                this.push(chunk.subarray(at, at + piece));
                setTimeout(() => push(at + piece), 100);
            };
            push(0);
        },
    });
}

function readLine(value: unknown): JournalLine | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const read = value as Record<string, unknown>;
    const text = (name: string): string | null =>
        typeof read[name] === "string" && read[name] !== "" ? (read[name] as string) : null;
    const remoteOrigin = text("remoteOrigin");
    const project = text("project");
    const transferId = text("transferId");
    const localPath = text("localPath");
    const digest = text("digest");
    const direction = read["direction"];
    const size = read["size"];
    if (
        remoteOrigin === null || project === null || transferId === null || localPath === null
        || digest === null || (direction !== "in" && direction !== "out")
        || typeof size !== "number" || !Number.isFinite(size) || size < 0
    ) {
        return null;
    }
    return {
        remoteOrigin,
        project,
        transferId,
        label: text("label") ?? transferId,
        direction,
        localPath,
        size,
        digest,
    };
}

function describe(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}
