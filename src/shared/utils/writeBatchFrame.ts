/**
 * The wire format for a batched write: N payloads carried in one `PUT` body.
 *
 * A single write costs two IPC round trips - `requestWrite` for a grant, then a `PUT` to the URL it
 * mints - and that pair costs the same whether the file is seven bytes or fifty kilobytes. Measured
 * on this machine, ~12 ms either way, which is why writing three hundred small files takes ~3.4 s
 * sequentially. A batched grant pays it once for the whole set.
 *
 * Encoding and decoding live together, in `shared`, because they are one format and the two halves
 * are compiled into different processes. Splitting them is how a length prefix ends up big-endian on
 * one side.
 *
 * ```
 *   "NLWB"  (4 bytes)   magic, so a body that is not one of these fails as 400 rather than as a
 *                       payload of surprising length
 *   version (1 byte)    = 1
 *   headerLength        (4 bytes, little-endian uint32)
 *   header              headerLength bytes of UTF-8 JSON: { "sizes": number[] }
 *   payloads            the entries' bytes, concatenated, in the order the grant named them
 * ```
 *
 * **The body says nothing about *where* anything goes.** Paths, encodings and the raw/text choice
 * all live in the grant, which the main process minted after authorizing every one of them. A
 * renderer that lies here can only mis-size its own payloads; it cannot redirect one at a path the
 * grant does not cover. That is the whole reason `sizes` is the only field.
 */

const MAGIC = "NLWB";
const MAGIC_BYTES = new Uint8Array([0x4e, 0x4c, 0x57, 0x42]);
const VERSION = 1;
const PREFIX_BYTES = MAGIC_BYTES.length + 1 + 4;

/**
 * The most files one grant may name.
 *
 * Not a storage limit - it bounds the per-path authorization loop the grant runs in the main
 * process, which is the one part of this that a caller could turn into a stall by asking for a
 * hundred thousand paths at once.
 */
export const WRITE_BATCH_MAX_ENTRIES = 1024;

export type WriteBatchFrameError = { message: string };

/**
 * Frame `payloads` into one body.
 *
 * The return is pinned to `Uint8Array<ArrayBuffer>` rather than the looser `ArrayBufferLike` so it
 * can go straight into a `fetch` body: a view over a `SharedArrayBuffer` is not a `BodyInit`, and
 * widening it here would cost every caller a copy of the whole frame to get it back.
 */
export function encodeWriteBatchFrame(payloads: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
    const header = new TextEncoder().encode(JSON.stringify({ sizes: payloads.map(payload => payload.byteLength) }));
    const total = PREFIX_BYTES + header.byteLength + payloads.reduce((sum, payload) => sum + payload.byteLength, 0);
    const out = new Uint8Array(total);

    out.set(MAGIC_BYTES, 0);
    out[MAGIC_BYTES.length] = VERSION;
    new DataView(out.buffer, out.byteOffset).setUint32(MAGIC_BYTES.length + 1, header.byteLength, true);
    out.set(header, PREFIX_BYTES);

    let offset = PREFIX_BYTES + header.byteLength;
    for (const payload of payloads) {
        out.set(payload, offset);
        offset += payload.byteLength;
    }
    return out;
}

/**
 * Split a body back into its payloads, or say why it is not one.
 *
 * `expectedCount` is the grant's entry count. A body that carries a different number of payloads is
 * rejected rather than zipped against whatever it does carry: the alignment between payload `i` and
 * grant entry `i` is the only thing that decides which file each blob lands in, and a silently
 * short body would write every entry's bytes into its neighbour's file.
 */
export function decodeWriteBatchFrame(
    body: Uint8Array,
    expectedCount: number,
): { payloads: Uint8Array[] } | WriteBatchFrameError {
    if (body.byteLength < PREFIX_BYTES) {
        return { message: "Batch write body is too short to be a frame" };
    }
    for (let i = 0; i < MAGIC_BYTES.length; i++) {
        if (body[i] !== MAGIC_BYTES[i]) {
            return { message: `Batch write body does not start with ${MAGIC}` };
        }
    }
    const version = body[MAGIC_BYTES.length];
    if (version !== VERSION) {
        return { message: `Unsupported batch write frame version ${version}` };
    }

    const headerLength = new DataView(body.buffer, body.byteOffset).getUint32(MAGIC_BYTES.length + 1, true);
    const headerEnd = PREFIX_BYTES + headerLength;
    if (headerEnd > body.byteLength) {
        return { message: "Batch write header runs past the end of the body" };
    }

    let sizes: unknown;
    try {
        sizes = (JSON.parse(new TextDecoder().decode(body.subarray(PREFIX_BYTES, headerEnd))) as { sizes?: unknown }).sizes;
    } catch {
        return { message: "Batch write header is not valid JSON" };
    }
    if (!Array.isArray(sizes) || sizes.some(size => !Number.isSafeInteger(size) || (size as number) < 0)) {
        return { message: "Batch write header does not carry a list of payload sizes" };
    }
    if (sizes.length !== expectedCount) {
        return { message: `Batch write body carries ${sizes.length} payload(s); the grant names ${expectedCount}` };
    }

    const payloads: Uint8Array[] = [];
    let offset = headerEnd;
    for (const size of sizes as number[]) {
        if (offset + size > body.byteLength) {
            return { message: "Batch write payloads run past the end of the body" };
        }
        payloads.push(body.subarray(offset, offset + size));
        offset += size;
    }
    if (offset !== body.byteLength) {
        return { message: "Batch write body has trailing bytes no payload claims" };
    }
    return { payloads };
}
