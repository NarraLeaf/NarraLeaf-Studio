import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageService } from "./ImageService";
import { AssetType } from "./assetTypes";
import { AssetSource, type Asset } from "./types";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("ImageService image metadata", () => {
    it("uses the stored extension when the image decoder accepts a format without a local signature", async () => {
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picture");
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
        vi.stubGlobal("Image", class {
            naturalWidth = 64;
            naturalHeight = 32;
            onload: (() => void) | null = null;
            set src(_value: string) { queueMicrotask(() => this.onload?.()); }
        });
        const asset: Asset<AssetType.Image> = {
            id: "image", type: AssetType.Image, source: AssetSource.Local, name: "portrait", ext: "avif",
            hash: "hash", meta: {}, tags: [], description: "",
        };

        const avifHeader = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
        const result = await new ImageService({} as never).readImageFromBuffer(asset, avifHeader);

        expect(result.success && result.data?.metadata.format).toBe("avif");
        const fromName = await new ImageService({} as never).readImageFromBuffer(
            { ...asset, name: "portrait.svg", ext: undefined }, avifHeader,
        );
        expect(fromName.success && fromName.data?.metadata.format).toBe("svg");
        const fromBytes = await new ImageService({} as never).readImageFromBuffer(
            asset, new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        );
        expect(fromBytes.success && fromBytes.data?.metadata.format).toBe("png");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picture");
    });
});
