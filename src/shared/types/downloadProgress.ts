import type { StudioTaskKind } from "./studioTask";

/**
 * How a process that is downloading something says so, to a process that can put it on screen.
 *
 * Studio fetches things during a build - an Electron distribution, the installer tooling, a Zig
 * toolchain, a redistributable a plugin declares - and almost none of it happens where the status
 * bar lives. The bytes move in a build worker, which has no window, no translations and no
 * scheduler; the main process has all three and no idea a socket is open. This is the channel
 * between those two facts, and it carries numbers rather than sentences for the same reason
 * everything else on this boundary does: the words an author reads are chosen where the catalogues
 * are, in a window that knows which language it is showing.
 *
 * Three events rather than a single "percent" push, because the two ends are separate processes and
 * a transfer has to be closable by the receiving one. `start` opens a task, `advance` moves it, and
 * `end` closes it whether the transfer succeeded or failed - a download that ended badly is still a
 * download that is no longer happening, and the failure itself travels as a build log line where an
 * author can read what went wrong.
 */
export type DownloadProgressEvent =
    | {
        phase: "start";
        /**
         * Distinguishes concurrent transfers within the sending process, and pairs the three
         * phases up. Never shown; the receiving side turns it into a task key of its own.
         */
        id: string;
        /** What is being fetched, in the vocabulary the status bar has words for. */
        kind: StudioTaskKind;
    }
    | {
        phase: "advance";
        id: string;
        /** Bytes received so far. */
        done: number;
        /**
         * Bytes expected, or null when the server did not say.
         *
         * Null is a real answer and must survive the trip: a chunked response has no length, and a
         * bar filled against a guessed total is worse than a bar that admits it cannot count.
         */
        total: number | null;
    }
    | { phase: "end"; id: string };

/**
 * What a downloader calls. Optional at every call site: a transfer nobody is watching still has to
 * work, which is what a build run from a test or a script is.
 */
export type DownloadProgressReporter = (event: DownloadProgressEvent) => void;

/**
 * Read a response body to the end, reporting bytes as they arrive.
 *
 * Every download in Studio that wants a readout goes through this rather than `response
 * .arrayBuffer()`, which yields the whole body in one step and can therefore report nothing between
 * 0% and done. The result is identical bytes; what changes is that the wait has a number on it.
 *
 * `Content-Length` is trusted for the total but never for the buffer: the bytes are collected as
 * they come and joined at the end, so a server that lies about the length produces a wrong readout
 * and correct content, rather than the other way round. Callers verify a digest afterwards, which is
 * what actually decides whether the bytes are usable.
 */
export async function readBodyWithProgress(
    response: Response,
    report?: (done: number, total: number | null) => void,
): Promise<Buffer> {
    // Optional chaining on `headers` rather than trust: a progress readout must not be the thing
    // that turns a working download into a failed build, and this runs against whatever `fetch` the
    // host runtime provides.
    const declared = Number.parseInt(response.headers?.get("content-length") ?? "", 10);
    const total = Number.isFinite(declared) && declared > 0 ? declared : null;
    const body = response.body;
    if (!body) {
        // A response with no readable stream (an empty body, or a fetch implementation that does not
        // expose one) still has to yield its bytes; it simply has nothing to report along the way.
        const whole = Buffer.from(await response.arrayBuffer());
        report?.(whole.byteLength, total ?? whole.byteLength);
        return whole;
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let done = 0;
    report?.(0, total);
    for (;;) {
        const next = await reader.read();
        if (next.done) {
            break;
        }
        chunks.push(next.value);
        done += next.value.byteLength;
        report?.(done, total);
    }
    return Buffer.concat(chunks);
}
