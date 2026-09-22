import type { FileHandle } from "fs/promises";

/**
 * Files up to this size are read into one buffer; anything larger streams from disk.
 *
 * The line the packaged runtime's `serveAsset` draws for loose assets, and for the same reason: the
 * pictures and sounds a scene is made of are small enough that one read is the cheapest answer, and
 * a clip is not - buffered whole, a 200 MB video was a 200 MB allocation in the main process for as
 * long as the renderer took to drain it, once per request.
 */
export const FILE_STREAM_THRESHOLD_BYTES = 8 * 1024 * 1024;

/**
 * How much one pull of a streamed body reads.
 *
 * The stream only reads when the consumer asks for more, so this is also roughly what one response
 * holds in the main process at a time. Large enough that a clip is not read in thousands of tiny
 * hops, small enough that several clips buffering at once stay a rounding error.
 */
const STREAM_CHUNK_BYTES = 256 * 1024;

/**
 * Bytes `start..start+length-1` of an open file, read into one buffer.
 *
 * Shorter than `length` only when the file shrank after it was measured; the caller reports what it
 * actually has rather than the length it expected.
 */
export async function readFileSpan(handle: FileHandle, start: number, length: number): Promise<Buffer> {
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
        const { bytesRead } = await handle.read(buffer, filled, length - filled, start + filled);
        if (bytesRead === 0) {
            break;
        }
        filled += bytesRead;
    }
    return filled === length ? buffer : buffer.subarray(0, filled);
}

/**
 * Bytes `start..end` (inclusive) of an open file as a response body that reads on demand.
 *
 * Pull-driven rather than an adapted Node stream on purpose: a read happens only when the consumer
 * has taken the previous chunk, so a paused or slow media element holds one chunk in this process
 * instead of the file. The stream owns the handle from here on and closes it on every way out - read
 * to the end, failed, or cancelled because the renderer gave up on the request (a `<video>` seeking
 * away abandons the response it was reading).
 */
export function streamFileSpan(handle: FileHandle, start: number, end: number): ReadableStream<Uint8Array> {
    let position = start;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => (closing ??= handle.close().catch(() => undefined));

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const wanted = Math.min(STREAM_CHUNK_BYTES, end + 1 - position);
                const chunk = Buffer.allocUnsafe(wanted);
                const { bytesRead } = await handle.read(chunk, 0, wanted, position);
                if (bytesRead === 0) {
                    // The file got shorter than the length this response already declared. Ending
                    // quietly would hand the renderer a truncated body it has no way to tell from
                    // a whole one; an error at least fails the request.
                    await close();
                    controller.error(new Error("File ended before the declared length"));
                    return;
                }
                position += bytesRead;
                controller.enqueue(bytesRead === wanted ? chunk : chunk.subarray(0, bytesRead));
                if (position > end) {
                    controller.close();
                    await close();
                }
            } catch (error) {
                // Also where a read that was in flight when the consumer cancelled lands: the
                // controller is closed by then and erroring it again is a no-op.
                await close();
                controller.error(error);
            }
        },
        cancel() {
            return close();
        },
    });
}
