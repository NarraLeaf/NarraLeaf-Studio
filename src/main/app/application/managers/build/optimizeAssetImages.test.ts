import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION,
    type AssetOptimizationConfiguration,
} from "@shared/types/assetOptimization";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { characterAvatarAssetId } from "@shared/utils/characterAvatar";
import { optimizeProjectImages } from "./optimizeAssetImages";
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
    let opened = 0;
    let closed = 0;
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
        async close() {
            closed += 1;
        },
    };
    return {
        requests,
        openCodec: async () => {
            opened += 1;
            return codec;
        },
        get opened() {
            return opened;
        },
        get closed() {
            return closed;
        },
    };
}

/** A codec the test asserts is never needed: opening one is the failure. */
const refuseCodec = async (): Promise<WebImageCodec> => {
    throw new Error("the codec was opened");
};

let projectPath: string;
let cacheDir: string;
const log = vi.fn();

/** Where the compiler reads an asset's bytes from, mirrored so the test writes them there. */
function contentPath(id: string): string {
    const [a, b, rest] = splitAssetStorageId(id);
    return path.join(projectPath, "assets", "content", a, b, rest);
}

async function writeLibrary(assets: Record<string, { name?: string; bytes: Buffer }>): Promise<void> {
    const metadata: Record<string, unknown> = {};
    for (const [id, asset] of Object.entries(assets)) {
        metadata[id] = { id, name: asset.name ?? id, source: "local", ext: "png" };
        const target = contentPath(id);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, asset.bytes);
    }
    await fs.mkdir(path.join(projectPath, "assets"), { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "assets", "assets.metadata.image.json"),
        JSON.stringify(metadata),
        "utf-8",
    );
}

beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-asset-opt-"));
    projectPath = path.join(root, "project");
    cacheDir = path.join(root, "cache");
    await fs.mkdir(projectPath, { recursive: true });
    log.mockClear();
});

afterEach(async () => {
    await fs.rm(path.dirname(projectPath), { recursive: true, force: true });
});

describe("optimizeProjectImages", () => {
    it("answers with a cached file for an image that came out smaller", async () => {
        await writeLibrary({ [ASSET_A]: { name: "Sprite", bytes: pngBytes() } });
        const codec = fakeCodec({ ratio: 0.5 });
        const result = await optimizeProjectImages({
            projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: codec.openCodec, log,
        });

        expect(result.converted).toBe(1);
        expect(result.afterBytes).toBeLessThan(result.beforeBytes);
        const image = result.images[ASSET_A];
        expect(image).toMatchObject({ ext: "webp", mimeType: "image/webp" });
        expect(image.path.startsWith(cacheDir)).toBe(true);
        await expect(fs.stat(image.path)).resolves.toBeTruthy();
        // The author's file is read and never written: the project is not where
        // any of this lands.
        await expect(fs.readFile(contentPath(ASSET_A))).resolves.toEqual(pngBytes());
        expect(codec.closed).toBe(1);
    });

    it("leaves an image out when the conversion is not smaller", async () => {
        await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
        const codec = fakeCodec({ ratio: 1.4 });
        const result = await optimizeProjectImages({
            projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: codec.openCodec, log,
        });

        expect(result).toMatchObject({ converted: 0, keptOriginal: 1 });
        expect(result.images).toEqual({});
    });

    it("discards a lossless conversion that failed its pixel comparison", async () => {
        await writeLibrary({ [ASSET_A]: { name: "Sprite", bytes: pngBytes() } });
        // Half the size, and therefore very tempting - but it does not decode
        // back to the source pixels, so it must not ship.
        const codec = fakeCodec({ ratio: 0.5, verifiedLossless: false });
        const result = await optimizeProjectImages({
            projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: codec.openCodec, log,
        });

        expect(result).toMatchObject({ converted: 0, keptOriginal: 1 });
        expect(result.images).toEqual({});
        expect(log).toHaveBeenCalledWith("warning", expect.stringContaining("Sprite"));
    });

    it("does not ask for a verdict it cannot use in lossy mode", async () => {
        await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
        const lossy: AssetOptimizationConfiguration = { lossyImages: true, lossyQuality: 70 };
        // A lossy encode is not expected to round trip, so an unverified result
        // is the normal case and must still be kept.
        const codec = fakeCodec({ ratio: 0.2, verifiedLossless: false });
        const result = await optimizeProjectImages({
            projectPath, cacheDir, config: lossy, openCodec: codec.openCodec, log,
        });

        expect(result.converted).toBe(1);
        expect(codec.requests[0]).toMatchObject({ lossless: false, quality: 70 });
    });

    it("leaves a JPEG alone by default and takes it once lossy is on", async () => {
        await writeLibrary({ [ASSET_B]: { bytes: jpegBytes() } });

        const lossless = fakeCodec();
        await optimizeProjectImages({
            projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: lossless.openCodec, log,
        });
        expect(lossless.requests).toHaveLength(0);
        // Nothing to encode is nothing to open a browser engine for.
        expect(lossless.opened).toBe(0);

        const lossy = fakeCodec({ ratio: 0.3 });
        const result = await optimizeProjectImages({
            projectPath,
            cacheDir,
            config: { ...DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, lossyImages: true },
            openCodec: lossy.openCodec,
            log,
        });
        expect(lossy.requests[0]).toMatchObject({ sourceType: "image/jpeg" });
        expect(result.images[ASSET_B]).toMatchObject({ ext: "webp" });
    });

    it("survives a record whose file is not on disk", async () => {
        await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
        await fs.rm(contentPath(ASSET_A));
        await expect(optimizeProjectImages({
            projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: refuseCodec, log,
        })).resolves.toMatchObject({ converted: 0, images: {} });
    });

    it("keeps the original when the codec cannot encode the image at all", async () => {
        await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
        const codec = fakeCodec({ fail: true });
        const result = await optimizeProjectImages({
            projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: codec.openCodec, log,
        });

        expect(result).toMatchObject({ converted: 0, keptOriginal: 1, images: {} });
    });

    it("stops when the build is cancelled", async () => {
        await writeLibrary({ [ASSET_A]: { bytes: pngBytes() }, [ASSET_B]: { bytes: pngBytes(41_000) } });
        let seen = 0;
        const codec = fakeCodec({ ratio: 0.4 });
        const result = await optimizeProjectImages({
            projectPath,
            cacheDir,
            config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION,
            openCodec: codec.openCodec,
            log,
            cancelled: () => seen++ > 0,
        });

        expect(result.converted).toBe(1);
        expect(codec.closed).toBe(1);
    });

    it("covers the baked avatars, which the asset library does not list", async () => {
        const avatarDir = path.join(projectPath, "resources", "characters", "avatars", "yuki");
        await fs.mkdir(avatarDir, { recursive: true });
        await fs.writeFile(path.join(avatarDir, "smile.png"), pngBytes());
        const codec = fakeCodec({ ratio: 0.5 });

        const result = await optimizeProjectImages({
            projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: codec.openCodec, log,
        });

        // Keyed by the synthetic id the compiler derives, or the compile looks up
        // an override that is not there and ships the PNG.
        expect(Object.keys(result.images)).toEqual([characterAvatarAssetId("yuki", "smile")]);
    });

    it("does nothing at all for a project with no images", async () => {
        await expect(optimizeProjectImages({
            projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: refuseCodec, log,
        })).resolves.toMatchObject({ converted: 0, images: {} });
    });

    describe("the cache", () => {
        it("reuses a kept result without encoding again", async () => {
            await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
            const first = await optimizeProjectImages({
                projectPath,
                cacheDir,
                config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION,
                openCodec: fakeCodec({ ratio: 0.5 }).openCodec,
                log,
            });

            // A second build with no codec available at all: if this needs one,
            // the cache is not doing its job.
            const second = await optimizeProjectImages({
                projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: refuseCodec, log,
            });

            expect(second).toMatchObject({ converted: 1, reused: 1 });
            expect(second.images[ASSET_A].path).toBe(first.images[ASSET_A].path);
            expect(second.beforeBytes).toBe(first.beforeBytes);
            expect(second.afterBytes).toBe(first.afterBytes);
        });

        it("remembers that an image was not worth converting", async () => {
            await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
            await optimizeProjectImages({
                projectPath,
                cacheDir,
                config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION,
                openCodec: fakeCodec({ ratio: 1.4 }).openCodec,
                log,
            });

            // Real artwork contains images that come out larger. Without a record
            // of that, every build re-encodes and re-compares every one of them
            // forever to reach the same answer.
            const second = await optimizeProjectImages({
                projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: refuseCodec, log,
            });

            expect(second).toMatchObject({ converted: 0, keptOriginal: 1 });
        });

        it("forgets an entry nothing has asked for in a long time", async () => {
            await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
            const first = await optimizeProjectImages({
                projectPath,
                cacheDir,
                config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION,
                openCodec: fakeCodec({ ratio: 0.5 }).openCodec,
                log,
            });
            // The key is the source bytes, so an edited image never replaces its
            // own entry - it adds one. Age is what keeps this directory finite.
            const stale = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
            await fs.utimes(first.images[ASSET_A].path, stale, stale);

            // A later build of a project that no longer has that image: nothing
            // asks for the entry, so nothing keeps it.
            await writeLibrary({});
            await optimizeProjectImages({
                projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: refuseCodec, log,
            });

            await expect(fs.stat(first.images[ASSET_A].path)).rejects.toThrow();
        });

        it("keeps an old entry a build still asks for", async () => {
            await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
            const first = await optimizeProjectImages({
                projectPath,
                cacheDir,
                config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION,
                openCodec: fakeCodec({ ratio: 0.5 }).openCodec,
                log,
            });
            const stale = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
            await fs.utimes(first.images[ASSET_A].path, stale, stale);

            // Artwork that has not changed in a year is still artwork this build
            // ships; age must mean "unused", never "old".
            const second = await optimizeProjectImages({
                projectPath, cacheDir, config: DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION, openCodec: refuseCodec, log,
            });

            expect(second).toMatchObject({ converted: 1, reused: 1 });
            await expect(fs.stat(first.images[ASSET_A].path)).resolves.toBeTruthy();
        });

        it("does not hand a lowered quality the previous quality's result", async () => {
            await writeLibrary({ [ASSET_A]: { bytes: pngBytes() } });
            const at90 = await optimizeProjectImages({
                projectPath,
                cacheDir,
                config: { lossyImages: true, lossyQuality: 90 },
                openCodec: fakeCodec({ ratio: 0.5 }).openCodec,
                log,
            });
            const at40 = await optimizeProjectImages({
                projectPath,
                cacheDir,
                config: { lossyImages: true, lossyQuality: 40 },
                openCodec: fakeCodec({ ratio: 0.2 }).openCodec,
                log,
            });

            expect(at40.images[ASSET_A].path).not.toBe(at90.images[ASSET_A].path);
            expect(at40.afterBytes).toBeLessThan(at90.afterBytes);
        });
    });
});
