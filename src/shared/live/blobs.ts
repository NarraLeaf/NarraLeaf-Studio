/**
 * Getting a file from one machine in a session to the others.
 *
 * **Why this needs saying at all.** Every other document a session carries is small enough to
 * state: a line of prose, a character record, an entry in a translation library. An asset is a
 * file. It cannot be stated, it cannot be recomputed from anything anybody else has, and the
 * repository - which is how bulk normally travels - is not available, because a session opens ON a
 * committed revision and must not re-base itself under an author who is mid-sentence.
 *
 * ## The shape
 *
 * A file goes over **its own request to the server**, beside the operation stream rather than
 * through it. The sender reserves an object, streams its own file into it and states the operation;
 * every other machine reads the object out to the place the file belongs, going on as it arrives.
 * `LiveAssetBytePart` is the whole of the seam: an address, a length and a fingerprint.
 *
 * Four things follow, and each of them is why it is not a message channel:
 *
 *  1. **A transfer cannot delay a sentence.** Two connections, so somebody's two-hundred-megabyte
 *     video is never in front of somebody else's typing. The channel it replaced needed the sender
 *     paced by hand - a fixed number of pieces and then a turn of the event loop - against a figure
 *     nobody could pick correctly, because it traded the same thing in both directions.
 *  2. **Neither machine holds the file.** The sender streams off its own disk, the receiver streams
 *     onto its own, and the process in between never has more than a socket buffer. So the largest
 *     file a session carries is a question about disks and about what the server will hold, and no
 *     longer a question about heaps - which is what the old 32 MiB really was.
 *  3. **An interruption is resumed.** A reconnect, a session ending, Studio being restarted: the
 *     server keeps what it already holds, and both ends go on from the byte they reached. A message
 *     channel had no way to say "from 41,000,000".
 *  4. **Backpressure is the transport's.** A stream that is ahead of a socket is paused by the
 *     socket, so there is no pacing figure anywhere in this and nothing to tune.
 *
 * ## What it promises and what it does not
 *
 * It promises that a completed transfer is the bytes that were sent, because the digest is computed
 * from what went on the wire and checked against what came off it before the file is put in place.
 * It does not promise that a transfer completes - the machine holding the file may close, and the
 * operation naming it is refused rather than half-applied when that happens, exactly as before.
 *
 * ## What deliberately does not travel
 *
 * Duplicating an asset, deleting one, and undoing a deletion move no bytes anywhere. Those are the
 * reason the whole thing is affordable, and `LiveAssetBytes` is where the three answers live: only
 * a file arriving from outside the project has to go anywhere at all.
 */

/**
 * How far along a transfer is, between nought and one.
 *
 * ⚠ **Never above one and never below nought**, whatever it is given. The two numbers come from
 * different places - the total from the operation that named the file, the count from a transport
 * that is still running - and a band that draws 104% of a row is a band an author reads as a
 * defect in the import.
 *
 * A file of no length is complete, not nought: an empty file is a legitimate thing to import, and
 * dividing by its length would make a band that never fills.
 */
export function transferShare(bytes: number, total: number): number {
    if (!Number.isFinite(bytes) || !Number.isFinite(total) || total <= 0) {
        return total === 0 ? 1 : 0;
    }
    return Math.min(1, Math.max(0, bytes / total));
}

/** How many times a transfer is picked up again after an interruption before it is left alone. */
export const TRANSFER_ATTEMPT_LIMIT = 6;

/**
 * How long to wait before picking an interrupted transfer up again.
 *
 * ⚠ **Backs off, and is bounded twice** - by the delay and by {@link TRANSFER_ATTEMPT_LIMIT}. The
 * thing being retried is a request to a server that may be down, or may be up and holding an object
 * whose sender has closed, and a retry that neither backed off nor gave up would be one machine
 * asking a question nothing can answer for the rest of the session. The first wait is short because
 * much the commonest interruption is a reconnect that has already finished.
 */
export function transferRetryDelayMs(attempt: number): number {
    const at = Math.max(0, Math.floor(attempt));
    return Math.min(30_000, 500 * 2 ** at);
}

/**
 * Whether a bundle-relative path may be written inside the asset it belongs to.
 *
 * ⚠ **The one field in `LiveAssetBytePart` that decides where bytes land**, and it arrives from
 * another Studio. A model bundle is a directory whose manifest names its siblings, so the path has
 * to be honoured; what may not be honoured is one that climbs out of the bundle, names a drive, or
 * is absolute. Checked here rather than at each of the places that writes one, so there is one
 * answer rather than three.
 */
export function bundlePathIsInside(path: string): boolean {
    if (path === "" || path.length > 512) {
        return false;
    }
    if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
        return false;
    }
    const segments = path.split(/[\\/]/);
    return segments.every(segment => segment !== "" && segment !== "." && segment !== "..");
}
