import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRuntimeAssetManifestEntry } from "@shared/types/gameRuntime";
import {
    DEFAULT_WEB_OPTIMIZATION_CONFIGURATION,
    type WebOptimizationConfiguration,
} from "@shared/types/webOptimization";
import { optimizeWebExportImages } from "./optimizeWebExport";
import type { WebImageCodec, WebImageEncodeRequest, WebImageEncodeResult } from "./webImageCodec";

const ASSET_A = "3f2a1c04-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const ASSET_B = "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f";

function be32(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunkBytes(type: string, payload: number[] = []): number[] {
    return [...be32(payload.length), ...[...type].map(c => c.charCodeAt(0)), ...payload, 0, 0, 0, 0];
}

/** A PNG large enough that the "worth keeping" floor is a real test rather than noise. */
function pngBytes(padding = 40_000): Buffer {
    return Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunkBytes("IHDR", [...be32(64), ...be32(64), 8, 6, 0, 0, 0]),
        ...chunkBytes("IDAT", new Array(padding).fill(7)),
        ...chunkBytes("IEND"),
    ]);
}

function jpegBytes(): Buffer {
    return Buffer.from([
        0xff, 0xd8,
        0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03,
        ...new Array(40_000).fill(0x5a),
        0xff, 0xd9,
    ]);
}

type FakeCodecOptions = {
    /** Size of the encoded result as a fraction of the input. */
    ratio?: number;
    verifiedLossless?: boolean;
    /** Return null (encode failed) instead of bytes. */
    fail?: boolean;
};

function fakeCodec(options: FakeCodecOptions = {}) {
    const requests: WebImageEncodeRequest[] = [];
    const codec: WebImageCodec = {
        async encode(request): Promise<WebImageEncodeResult | null> {
            requests.push(request);
            if (options.fail) {
                return null;
            }
            const size = Math.max(1, Math.round(request.bytes.length * (options.ratio ?? 0.5)));
            return {
                bytes: Buffer.alloc(size, 0x77),
                verifiedLossless: options.verifiedLossless ?? true,
            };
        },
        async close() {},
    };
    return { codec, requests };
}

let appDir: string;
const log = vi.fn();

type Entry = Partial<GameRuntimeAssetManifestEntry> & { relativePath: string };

async function writeSite(items: Record<string, Entry>, files: Record<string, Buffer>): Promise<void> {
    await fs.mkdir(path.join(appDir, "assets"), { recursive: true });
    for (const [relativePath, bytes] of Object.entries(files)) {
        const target = path.join(appDir, ...relativePath.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes);
    }
    const entries = Object.fromEntries(Object.entries(items).map(([key, entry]) => [key, {
        id: key,
        type: "image",
        name: key,
        source: "local",
        ext: "png",
        mimeType: "image/png",
        ...entry,
    }]));
    await fs.writeFile(
        path.join(appDir, "pack.json"),
        JSON.stringify({ assets: { items: entries }, project: { name: "G" } }),
        "utf-8",
    );
}

async function readPack(): Promise<{ assets: { items: Record<string, GameRuntimeAssetManifestEntry> } }> {
    return JSON.parse(await fs.readFile(path.join(appDir, "pack.json"), "utf-8"));
}

beforeEach(async () => {
    appDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-web-opt-"));
    log.mockClear();
});

afterEach(async () => {
    await fs.rm(appDir, { recursive: true, force: true });
});

describe("optimizeWebExportImages", () => {
    it("rewrites the file and its manifest entry when the conversion is smaller", async () => {
        await writeSite(
            { [ASSET_A]: { relativePath: `assets/${ASSET_A}.png`, name: "Sprite" } },
            { [`assets/${ASSET_A}.png`]: pngBytes() },
        );
        const { codec } = fakeCodec({ ratio: 0.5 });
        const result = await optimizeWebExportImages({
            appDir, config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, codec, log,
        });

        expect(result.converted).toBe(1);
        expect(result.afterBytes).toBeLessThan(result.beforeBytes);
        const entry = (await readPack()).assets.items[ASSET_A];
        expect(entry.relativePath).toBe(`assets/${ASSET_A}.webp`);
        expect(entry.ext).toBe("webp");
        expect(entry.mimeType).toBe("image/webp");
        await expect(fs.stat(path.join(appDir, "assets", `${ASSET_A}.webp`))).resolves.toBeTruthy();
        // The original is gone: shipping both would make the export bigger, not smaller.
        await expect(fs.stat(path.join(appDir, "assets", `${ASSET_A}.png`))).rejects.toThrow();
    });

    it("keeps the provenance fields, which still describe the project file it came from", async () => {
        await writeSite(
            {
                [ASSET_A]: {
                    relativePath: `assets/${ASSET_A}.png`,
                    hash: "abc123",
                    originalRelativePath: "assets/content/3f/2a/sprite.png",
                },
            },
            { [`assets/${ASSET_A}.png`]: pngBytes() },
        );
        const { codec } = fakeCodec();
        await optimizeWebExportImages({ appDir, config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, codec, log });

        const entry = (await readPack()).assets.items[ASSET_A];
        expect(entry.hash).toBe("abc123");
        expect(entry.originalRelativePath).toBe("assets/content/3f/2a/sprite.png");
    });

    it("keeps the original when the conversion is not smaller", async () => {
        await writeSite(
            { [ASSET_A]: { relativePath: `assets/${ASSET_A}.png` } },
            { [`assets/${ASSET_A}.png`]: pngBytes() },
        );
        const { codec } = fakeCodec({ ratio: 1.4 });
        const result = await optimizeWebExportImages({
            appDir, config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, codec, log,
        });

        expect(result).toMatchObject({ converted: 0, keptOriginal: 1 });
        expect((await readPack()).assets.items[ASSET_A].relativePath).toBe(`assets/${ASSET_A}.png`);
        await expect(fs.stat(path.join(appDir, "assets", `${ASSET_A}.png`))).resolves.toBeTruthy();
    });

    it("discards a lossless conversion that failed its pixel comparison", async () => {
        await writeSite(
            { [ASSET_A]: { relativePath: `assets/${ASSET_A}.png`, name: "Sprite" } },
            { [`assets/${ASSET_A}.png`]: pngBytes() },
        );
        // Half the size, and therefore very tempting - but it does not decode
        // back to the source pixels, so it must not ship.
        const { codec } = fakeCodec({ ratio: 0.5, verifiedLossless: false });
        const result = await optimizeWebExportImages({
            appDir, config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, codec, log,
        });

        expect(result).toMatchObject({ converted: 0, keptOriginal: 1 });
        expect((await readPack()).assets.items[ASSET_A].relativePath).toBe(`assets/${ASSET_A}.png`);
        expect(log).toHaveBeenCalledWith("warning", expect.stringContaining("Sprite"));
    });

    it("does not ask for a verdict it cannot use in lossy mode", async () => {
        await writeSite(
            { [ASSET_A]: { relativePath: `assets/${ASSET_A}.png` } },
            { [`assets/${ASSET_A}.png`]: pngBytes() },
        );
        const lossy: WebOptimizationConfiguration = {
            ...DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, lossyImages: true, lossyQuality: 70,
        };
        // A lossy encode is not expected to round trip, so an unverified result
        // is the normal case and must still be kept.
        const { codec, requests } = fakeCodec({ ratio: 0.2, verifiedLossless: false });
        const result = await optimizeWebExportImages({ appDir, config: lossy, codec, log });

        expect(result.converted).toBe(1);
        expect(requests[0]).toMatchObject({ lossless: false, quality: 70 });
    });

    it("leaves a JPEG alone in lossless mode and takes it in lossy mode", async () => {
        const files = { [`assets/${ASSET_B}.jpg`]: jpegBytes() };
        const items = { [ASSET_B]: { relativePath: `assets/${ASSET_B}.jpg`, ext: "jpg", mimeType: "image/jpeg" } };
        await writeSite(items, files);

        const lossless = fakeCodec();
        await optimizeWebExportImages({
            appDir, config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, codec: lossless.codec, log,
        });
        expect(lossless.requests).toHaveLength(0);

        const lossy = fakeCodec({ ratio: 0.3 });
        await optimizeWebExportImages({
            appDir,
            config: { ...DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, lossyImages: true },
            codec: lossy.codec,
            log,
        });
        expect(lossy.requests[0]).toMatchObject({ sourceType: "image/jpeg" });
        expect((await readPack()).assets.items[ASSET_B].relativePath).toBe(`assets/${ASSET_B}.webp`);
    });

    it("never touches a model bundle's files", async () => {
        const key = `${ASSET_B}/textures/texture_00.png`;
        await writeSite(
            {
                [ASSET_B]: { relativePath: `assets/${ASSET_B}/model.json`, type: "model", ext: "json" },
                [key]: { relativePath: `assets/${key}`, type: "model" },
            },
            {
                [`assets/${ASSET_B}/model.json`]: Buffer.from("{}"),
                [`assets/${key}`]: pngBytes(),
            },
        );
        const { codec, requests } = fakeCodec({ ratio: 0.2 });
        await optimizeWebExportImages({ appDir, config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, codec, log });

        expect(requests).toHaveLength(0);
        // The model's own manifest names "texture_00.png"; renaming it would
        // break the character rather than the build.
        await expect(fs.stat(path.join(appDir, "assets", ASSET_B, "textures", "texture_00.png")))
            .resolves.toBeTruthy();
    });

    it("survives a manifest entry whose file the compile never wrote", async () => {
        await writeSite({ [ASSET_A]: { relativePath: `assets/${ASSET_A}.png` } }, {});
        const { codec } = fakeCodec();
        await expect(optimizeWebExportImages({
            appDir, config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, codec, log,
        })).resolves.toMatchObject({ converted: 0 });
    });

    it("keeps the original when the codec cannot encode the image at all", async () => {
        await writeSite(
            { [ASSET_A]: { relativePath: `assets/${ASSET_A}.png` } },
            { [`assets/${ASSET_A}.png`]: pngBytes() },
        );
        const { codec } = fakeCodec({ fail: true });
        const result = await optimizeWebExportImages({
            appDir, config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, codec, log,
        });

        expect(result).toMatchObject({ converted: 0, keptOriginal: 1 });
        await expect(fs.stat(path.join(appDir, "assets", `${ASSET_A}.png`))).resolves.toBeTruthy();
    });

    it("stops when the build is cancelled, leaving the manifest consistent with the files", async () => {
        await writeSite(
            {
                [ASSET_A]: { relativePath: `assets/${ASSET_A}.png` },
                [ASSET_B]: { relativePath: `assets/${ASSET_B}.png` },
            },
            {
                [`assets/${ASSET_A}.png`]: pngBytes(),
                [`assets/${ASSET_B}.png`]: pngBytes(),
            },
        );
        let seen = 0;
        const { codec } = fakeCodec({ ratio: 0.4 });
        const result = await optimizeWebExportImages({
            appDir,
            config: DEFAULT_WEB_OPTIMIZATION_CONFIGURATION,
            codec,
            log,
            cancelled: () => seen++ > 0,
        });

        expect(result.converted).toBe(1);
        const items = (await readPack()).assets.items;
        for (const entry of Object.values(items)) {
            await expect(fs.stat(path.join(appDir, ...entry.relativePath.split("/")))).resolves.toBeTruthy();
        }
    });

    it("does nothing, and rewrites nothing, when both image steps are off", async () => {
        await writeSite(
            { [ASSET_A]: { relativePath: `assets/${ASSET_A}.png` } },
            { [`assets/${ASSET_A}.png`]: pngBytes() },
        );
        const before = await fs.readFile(path.join(appDir, "pack.json"), "utf-8");
        const { codec, requests } = fakeCodec();
        const result = await optimizeWebExportImages({
            appDir,
            config: { ...DEFAULT_WEB_OPTIMIZATION_CONFIGURATION, losslessImages: false, lossyImages: false },
            codec,
            log,
        });

        expect(result.converted).toBe(0);
        expect(requests).toHaveLength(0);
        await expect(fs.readFile(path.join(appDir, "pack.json"), "utf-8")).resolves.toBe(before);
    });
});
