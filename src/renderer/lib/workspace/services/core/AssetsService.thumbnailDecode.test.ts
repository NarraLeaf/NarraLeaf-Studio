import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

import { thumbnailDecodeOptions } from "./AssetsService";

/** The first bytes of a PNG: signature plus an IHDR naming the size. Enough for the header reader. */
function pngHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
}

describe("thumbnailDecodeOptions", () => {
    it("asks for the longer side at thumbnail size, leaving the other to the aspect ratio", () => {
        expect(thumbnailDecodeOptions(pngHeader(3840, 2160))).toEqual({ resizeWidth: 160, resizeQuality: "high" });
        expect(thumbnailDecodeOptions(pngHeader(1088, 1984))).toEqual({ resizeHeight: 160, resizeQuality: "high" });
    });

    it("decodes at full size what is already no bigger than a thumbnail", () => {
        expect(thumbnailDecodeOptions(pngHeader(160, 90))).toBeUndefined();
        expect(thumbnailDecodeOptions(pngHeader(64, 64))).toBeUndefined();
    });

    it("decodes at full size a format the header reader does not know", () => {
        const gif = new TextEncoder().encode("GIF89a\u0010\u0000\u0010\u0000");
        expect(thumbnailDecodeOptions(gif)).toBeUndefined();
        expect(thumbnailDecodeOptions(new Uint8Array(0))).toBeUndefined();
    });
});
