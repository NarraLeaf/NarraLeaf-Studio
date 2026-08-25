import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import { LIVE_BLOB_CHUNK_BYTES, LIVE_BLOB_MAX_BYTES, type LiveBlobChunk } from "./ops";

/**
 * Getting a file from one machine in a session to the others.
 *
 * **Why this exists at all.** Every other document a session carries is small enough to state: a
 * line of prose, a character record, an entry in a translation library. An asset is a file, and one
 * `live.say` is 16 KiB. There is no second channel - the room stores nothing, the server is a relay,
 * and the repository is the way bulk normally travels but a session is opened ON a committed
 * revision and must not re-base itself under an author who is typing. So a file that exists on one
 * machine and nowhere else is sliced, and the slices travel beside the operation stream.
 *
 * **Beside it, not through it.** A slice is not an operation: it changes no document, takes no
 * sequence number and is applied by nobody. That is what keeps a thirty-megabyte import from
 * stopping everybody else's typing until it finishes - the host goes on applying operations while
 * the bytes are still arriving, and the operation that names the transfer is simply refused if they
 * never do.
 *
 * **What is deliberately NOT here**, because the three of them are the reason this is affordable at
 * all: duplicating an asset, deleting one and undoing a deletion move no bytes anywhere. The bytes
 * for those are already on every machine, and `LiveAssetBytes` says which of the three a record's
 * bytes come from. Only a file arriving from outside the project travels.
 *
 * ## What this promises and what it does not
 *
 * It promises that a completed transfer is the bytes that were sent, because the digest is computed
 * from what went on the wire and checked against what came off it. It does not promise delivery -
 * nothing on this channel does - which is why {@link LiveBlobInbox.missing} exists and why the
 * operation naming a transfer is refused rather than half-applied when the bytes are short.
 */

/** The fingerprint of a file's bytes, as {@link LiveAssetBytePart.digest} carries it. */
export function blobDigest(bytes: Uint8Array): string {
    return fnv1a64BytesHex(bytes);
}

/** How many slices a file of this size takes. Zero bytes is one empty slice, never none. */
export function blobChunkCount(size: number): number {
    return Math.max(1, Math.ceil(size / LIVE_BLOB_CHUNK_BYTES));
}

/**
 * Cut a file into the messages that carry it.
 *
 * ⚠ **An empty file is one empty slice, not zero slices.** A new text file is legitimately zero
 * bytes, and a transfer with nothing in it would be one a receiver could never tell from a transfer
 * that has not started.
 */
export function sliceBlob(transferId: string, bytes: Uint8Array): LiveBlobChunk[] {
    const total = blobChunkCount(bytes.length);
    const chunks: LiveBlobChunk[] = [];
    for (let index = 0; index < total; index += 1) {
        const start = index * LIVE_BLOB_CHUNK_BYTES;
        chunks.push({
            kind: "blob",
            transferId,
            index,
            total,
            data: encodeBase64(bytes.subarray(start, start + LIVE_BLOB_CHUNK_BYTES)),
        });
    }
    return chunks;
}

/** What one transfer is waiting for, or the bytes if it is done. */
export type LiveBlobState =
    | { status: "collecting"; have: number; total: number }
    | { status: "complete"; bytes: Uint8Array }
    /** The slices arrived but do not hash to what the sender said. See {@link LiveBlobInbox.take}. */
    | { status: "corrupt" }
    | { status: "unknown" };

/**
 * The slices this machine has been sent, until the operation that names them arrives.
 *
 * **Held in memory and never on disk**, which is the whole reason the size cap in `ops` is a cap on
 * the file rather than a promise about the disk: a transfer that is never claimed is a transfer that
 * cost some memory for a while, not a stray file in the author's project.
 *
 * ⚠ **Bounded twice, and both bounds are load-bearing.** A slice arrives from another Studio, which
 * may be a different version or may be sending nonsense; without a per-transfer cap one message
 * claiming three million slices reserves the memory to match, and without a cap on how many
 * transfers may be open at once a peer can open one per message. Both are refused silently - a
 * machine that is being flooded has nothing useful to say to the flooder.
 */
export class LiveBlobInbox {
    private readonly transfers = new Map<string, { total: number; parts: Map<number, Uint8Array> }>();

    public constructor(private readonly maxOpen: number = 64) {}

    /**
     * Take one slice in. False when it was refused, which is a defence rather than a failure.
     *
     * Refused for a slice that is malformed, one whose transfer would be larger than a session
     * carries, and one that would open a transfer beyond {@link maxOpen}.
     */
    public accept(chunk: LiveBlobChunk): boolean {
        if (!Number.isInteger(chunk.total) || chunk.total <= 0
            || !Number.isInteger(chunk.index) || chunk.index < 0 || chunk.index >= chunk.total) {
            return false;
        }
        if (chunk.total > blobChunkCount(LIVE_BLOB_MAX_BYTES)) {
            return false;
        }
        let transfer = this.transfers.get(chunk.transferId);
        if (!transfer) {
            if (this.transfers.size >= this.maxOpen) {
                return false;
            }
            transfer = { total: chunk.total, parts: new Map() };
            this.transfers.set(chunk.transferId, transfer);
        }
        if (transfer.total !== chunk.total) {
            // Two messages disagreeing about the length of one transfer. Neither can be trusted, and
            // the sender is told what is missing when the operation asks for it.
            return false;
        }
        let slice: Uint8Array;
        try {
            slice = decodeBase64(chunk.data);
        } catch {
            return false;
        }
        transfer.parts.set(chunk.index, slice);
        return true;
    }

    /** Which slices of a transfer are still missing. Every one of them for a transfer never seen. */
    public missing(transferId: string, total: number): number[] {
        const transfer = this.transfers.get(transferId);
        const out: number[] = [];
        for (let index = 0; index < total; index += 1) {
            if (!transfer?.parts.has(index)) {
                out.push(index);
            }
        }
        return out;
    }

    /** Whether a transfer has every slice. */
    public isComplete(transferId: string): boolean {
        const transfer = this.transfers.get(transferId);
        return transfer !== undefined && transfer.parts.size === transfer.total;
    }

    /**
     * Take a completed transfer's bytes out, verifying them against what the sender said.
     *
     * **Removes it either way.** A transfer that has been claimed is over: if the bytes are right the
     * caller has them, and if they are not, keeping the slices around would only hold the memory of a
     * file nobody is going to write.
     */
    public take(transferId: string, digest: string): LiveBlobState {
        const transfer = this.transfers.get(transferId);
        if (!transfer) {
            return { status: "unknown" };
        }
        if (transfer.parts.size !== transfer.total) {
            return { status: "collecting", have: transfer.parts.size, total: transfer.total };
        }
        this.transfers.delete(transferId);

        let length = 0;
        for (let index = 0; index < transfer.total; index += 1) {
            length += transfer.parts.get(index)!.length;
        }
        const bytes = new Uint8Array(length);
        let at = 0;
        for (let index = 0; index < transfer.total; index += 1) {
            const slice = transfer.parts.get(index)!;
            bytes.set(slice, at);
            at += slice.length;
        }
        // ⚠ Checked rather than assumed. The channel can drop a message, and a file reassembled with
        // one slice missing is a file that looks fine until somebody opens it.
        return blobDigest(bytes) === digest ? { status: "complete", bytes } : { status: "corrupt" };
    }

    /** Forget one transfer. What the operation naming it does once it has been refused. */
    public drop(transferId: string): void {
        this.transfers.delete(transferId);
    }

    /** Forget everything. What leaving a session does. */
    public clear(): void {
        this.transfers.clear();
    }

    /** How many transfers are open. For diagnostics and for a test that pins the bound. */
    public get openCount(): number {
        return this.transfers.size;
    }
}

/* --------------------------------------------------------------------------- base64 */

/**
 * Base64 without assuming a runtime.
 *
 * `Buffer` where there is one and the browser's own pair where there is not: this module is shared,
 * and the same slice is cut in a renderer and could be read in a test that runs under Node with no
 * DOM. Neither implementation is fast; neither has to be, because the cost of a transfer is the
 * messages rather than the encoding.
 */
function encodeBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    // A chunk at a time: `String.fromCharCode(...bytes)` overflows the call stack somewhere around
    // a hundred thousand arguments, which a slice of this size is comfortably under but a caller
    // handing over a whole file would not be.
    for (let at = 0; at < bytes.length; at += 8192) {
        binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
    }
    return btoa(binary);
}

/**
 * ⚠ **Checked before it is decoded, because `Buffer.from(x, "base64")` does not fail.** It drops
 * whatever it does not recognise and answers with fewer bytes, so a corrupted slice would decode to
 * something shorter and be reassembled into a file that is simply wrong. The digest would catch that
 * afterwards; refusing here catches it while the sender can still be asked for the slice again.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64(text: string): Uint8Array {
    if (!BASE64.test(text) || text.length % 4 !== 0) {
        throw new Error("not base64");
    }
    if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(text, "base64"));
    }
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) {
        bytes[at] = binary.charCodeAt(at);
    }
    return bytes;
}
