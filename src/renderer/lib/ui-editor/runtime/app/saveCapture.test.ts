/**
 * A save keeps its picture at thumbnail size, and never loses it to the shrinking.
 *
 * The codec is a stand-in: the browser's canvas does the real decoding and encoding, which a test
 * environment does not have. What is pinned here is the size picked, the encoding picked, and that
 * every way of failing leaves the capture as it came. The byte counts are measured in a running game.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import {
    SAVE_CAPTURE_MAX_EDGE,
    SAVE_CAPTURE_QUALITY,
    saveCaptureSize,
    shrinkSaveCapture,
    type CaptureCodec,
    type CaptureSize,
} from "./saveCapture";

/** A full-size PNG capture, as the engine hands it over: long, because it is large. */
const CAPTURE = `data:image/png;base64,${"A".repeat(100_000)}`;

/** A codec whose canvas answers with what `encoders` say for each type, and records what it was asked. */
function fakeCodec(natural: CaptureSize, encoders: Record<string, string | undefined>) {
    const asked: { size?: CaptureSize; encodings: Array<{ type: string; quality?: number }> } = { encodings: [] };
    const codec: CaptureCodec = {
        async redraw(_capture, sizeFor) {
            asked.size = sizeFor(natural);
            return {
                toDataURL(type: string, quality?: number) {
                    asked.encodings.push({ type, quality });
                    // What a canvas does with a type it cannot write: a PNG.
                    return encoders[type] ?? `data:image/png;base64,${"B".repeat(50_000)}`;
                },
            };
        },
    };
    return { codec, asked };
}

describe("the size a save's picture is kept at", () => {
    it("fits the longer edge inside the cap, keeping the shape", () => {
        expect(saveCaptureSize({ width: 1750, height: 985 })).toEqual({ width: SAVE_CAPTURE_MAX_EDGE, height: 540 });
        expect(saveCaptureSize({ width: 3840, height: 2160 })).toEqual({ width: 960, height: 540 });
        // A portrait game's picture, from a phone.
        expect(saveCaptureSize({ width: 1080, height: 1920 })).toEqual({ width: 540, height: 960 });
    });

    it("never scales a small picture up", () => {
        expect(saveCaptureSize({ width: 800, height: 450 })).toEqual({ width: 800, height: 450 });
    });
});

describe("shrinking a save's picture", () => {
    it("redraws it at the kept size and keeps it as WebP", async () => {
        const webp = `data:image/webp;base64,${"W".repeat(3_000)}`;
        const { codec, asked } = fakeCodec({ width: 1750, height: 985 }, { "image/webp": webp });

        expect(await shrinkSaveCapture(CAPTURE, codec)).toBe(webp);
        expect(asked.size).toEqual({ width: 960, height: 540 });
        expect(asked.encodings).toEqual([{ type: "image/webp", quality: SAVE_CAPTURE_QUALITY }]);
    });

    it("keeps it as JPEG where the canvas cannot write WebP", async () => {
        const jpeg = `data:image/jpeg;base64,${"J".repeat(6_000)}`;
        const { codec, asked } = fakeCodec({ width: 1750, height: 985 }, { "image/jpeg": jpeg });

        expect(await shrinkSaveCapture(CAPTURE, codec)).toBe(jpeg);
        expect(asked.encodings.map(encoding => encoding.type)).toEqual(["image/webp", "image/jpeg"]);
    });

    it("keeps the picture as it came when it cannot be redrawn", async () => {
        const codec: CaptureCodec = { redraw: async () => { throw new Error("cannot decode"); } };

        expect(await shrinkSaveCapture(CAPTURE, codec)).toBe(CAPTURE);
    });

    it("keeps the picture as it came when shrinking would not make it smaller", async () => {
        const huge = `data:image/webp;base64,${"W".repeat(200_000)}`;
        const { codec } = fakeCodec({ width: 1750, height: 985 }, { "image/webp": huge });

        expect(await shrinkSaveCapture(CAPTURE, codec)).toBe(CAPTURE);
    });
});
