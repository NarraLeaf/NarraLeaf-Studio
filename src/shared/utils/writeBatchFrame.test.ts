import { describe, expect, it } from "vitest";
import { decodeWriteBatchFrame, encodeWriteBatchFrame } from "./writeBatchFrame";

const bytes = (...values: number[]) => new Uint8Array(values);

function decodedOrThrow(frame: Uint8Array, expectedCount: number): Uint8Array[] {
    const result = decodeWriteBatchFrame(frame, expectedCount);
    if (!("payloads" in result)) {
        throw new Error(`expected a decoded frame, got: ${result.message}`);
    }
    return result.payloads;
}

/**
 * The framing is the only thing binding a blob in the body to a file on disk: the grant lists the
 * paths, the body lists sizes, and payload `i` lands in entry `i`. Everything below is about that
 * alignment surviving, or the decode refusing rather than guessing.
 */
describe("write batch framing", () => {
    it("round-trips payloads, including empty and non-ASCII ones", () => {
        const payloads = [
            new TextEncoder().encode("{\"a\":1}"),
            new Uint8Array(0),
            new TextEncoder().encode("scène 「ゆき」"),
            bytes(0, 255, 127, 128),
        ];

        const decoded = decodedOrThrow(encodeWriteBatchFrame(payloads), payloads.length);

        expect(decoded).toHaveLength(payloads.length);
        for (const [index, payload] of payloads.entries()) {
            expect([...decoded[index]]).toEqual([...payload]);
        }
    });

    it("round-trips a single payload and a large one", () => {
        const big = new Uint8Array(1024 * 512).fill(7);
        const decoded = decodedOrThrow(encodeWriteBatchFrame([big]), 1);
        expect(decoded[0].byteLength).toBe(big.byteLength);
        expect(decoded[0][0]).toBe(7);
        expect(decoded[0][big.byteLength - 1]).toBe(7);
    });

    it("refuses a body whose payload count disagrees with the grant", () => {
        // The dangerous case. Zipping three payloads against four granted paths would write each
        // file's bytes into its neighbour's - a silent corruption of files nobody edited.
        const frame = encodeWriteBatchFrame([bytes(1), bytes(2), bytes(3)]);
        const result = decodeWriteBatchFrame(frame, 4);
        expect("payloads" in result).toBe(false);
        expect((result as { message: string }).message).toContain("the grant names 4");
    });

    it("refuses a body that is not a frame at all", () => {
        const result = decodeWriteBatchFrame(new TextEncoder().encode("just some JSON, honestly"), 1);
        expect("payloads" in result).toBe(false);
        expect((result as { message: string }).message).toContain("NLWB");
    });

    it("refuses a truncated body", () => {
        const frame = encodeWriteBatchFrame([bytes(1, 2, 3, 4, 5, 6, 7, 8)]);
        const result = decodeWriteBatchFrame(frame.subarray(0, frame.byteLength - 3), 1);
        expect("payloads" in result).toBe(false);
    });

    it("refuses a body with bytes no payload claims", () => {
        const frame = encodeWriteBatchFrame([bytes(1, 2, 3)]);
        const padded = new Uint8Array(frame.byteLength + 2);
        padded.set(frame, 0);
        const result = decodeWriteBatchFrame(padded, 1);
        expect("payloads" in result).toBe(false);
        expect((result as { message: string }).message).toContain("trailing bytes");
    });

    it("refuses a frame version it does not know", () => {
        const frame = encodeWriteBatchFrame([bytes(1)]);
        frame[4] = 99;
        const result = decodeWriteBatchFrame(frame, 1);
        expect("payloads" in result).toBe(false);
        expect((result as { message: string }).message).toContain("version 99");
    });

    it("refuses a header that claims more bytes than the body holds", () => {
        const frame = encodeWriteBatchFrame([bytes(1)]);
        new DataView(frame.buffer, frame.byteOffset).setUint32(5, 0xffff, true);
        const result = decodeWriteBatchFrame(frame, 1);
        expect("payloads" in result).toBe(false);
    });
});
