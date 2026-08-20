import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameRuntimeAssetManifestEntry, GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { resolveRuntimeAssetPath } from "./runtimeProtocol";

/**
 * The shipped half of the model-bundle seam.
 *
 * In Studio the entry URL is an `app://fs/{grant}/...` directory grant; in a built game it is
 * `nlgame://asset/{assetId}/{pathInsideBundle}`, resolved by manifest key. Different transports,
 * one requirement: `new URL(relativeReference, entryUrl)` must land on something servable, because
 * that is the arithmetic the engine does to find a model's textures and motions.
 *
 * These assertions are written against the manifest shape `copyAssetBundle` emits, so a change to
 * the key scheme that would silently 404 every texture fails here instead.
 */

const ASSET_ID = "0189f7e4-6c1a-7a2b-9d3e-4f5061728394";
const BUNDLE_FILES = [
    "Hiyori.2048/texture_00.png",
    "Hiyori.moc3",
    "Hiyori.model3.json",
    "motions/Hiyori_m04.motion3.json",
];
const ENTRY = "Hiyori.model3.json";

function manifestEntry(key: string, relativePath: string): GameRuntimeAssetManifestEntry {
    return { id: key, type: "model", name: key, source: "local", relativePath };
}

/** Exactly what `copyAssetBundle` writes for a loose pack. */
function bundleManifest(): Record<string, GameRuntimeAssetManifestEntry> {
    const items: Record<string, GameRuntimeAssetManifestEntry> = {};
    for (const file of BUNDLE_FILES) {
        items[`${ASSET_ID}/${file}`] = manifestEntry(`${ASSET_ID}/${file}`, `assets/${ASSET_ID}/${file}`);
    }
    items[ASSET_ID] = {
        ...manifestEntry(ASSET_ID, `assets/${ASSET_ID}/${ENTRY}`),
        bundleEntry: ENTRY,
    };
    return items;
}

function makePack(): GameRuntimePackV1 {
    return { assets: { items: bundleManifest() } } as unknown as GameRuntimePackV1;
}

/** The URL the runtime hands the engine, built the way `GameRuntimeApp` builds it. */
function entryUrl(): string {
    const entry = makePack().assets.items[ASSET_ID].bundleEntry!;
    const key = `${ASSET_ID}/${entry}`;
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `nlgame://asset/${encoded}?v=bundle-1`;
}

/** What the protocol handler derives from a request URL. */
function assetKeyFromUrl(url: string): string {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
}

describe("model bundle asset URLs in a built game", () => {
    let appDir: string;

    beforeEach(async () => {
        appDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-runtime-bundle-"));
        for (const file of BUNDLE_FILES) {
            const target = path.join(appDir, "assets", ASSET_ID, ...file.split("/"));
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, `bytes:${file}`);
        }
    });

    afterEach(async () => {
        await fs.rm(appDir, { recursive: true, force: true });
    });

    it("serves the entry file for the bare asset id", async () => {
        // A caller holding only the id still reaches the entry file through an unprotected pack's
        // manifest. What it does not get is a URL that siblings resolve against - that is what the
        // trailing-slash mount is for (see `resolveModelBundleKey`), and it is the shape the
        // renderer builds so that no entry file name has to ship.
        const resolved = resolveRuntimeAssetPath(appDir, makePack(), ASSET_ID);
        expect(await fs.readFile(resolved, "utf-8")).toBe(`bytes:${ENTRY}`);
    });

    it("resolves every relative sibling of the entry URL to a manifest key that exists", async () => {
        const pack = makePack();
        const url = entryUrl();
        expect(assetKeyFromUrl(url)).toBe(`${ASSET_ID}/${ENTRY}`);

        for (const reference of ["Hiyori.moc3", "Hiyori.2048/texture_00.png", "motions/Hiyori_m04.motion3.json"]) {
            const siblingKey = assetKeyFromUrl(new URL(reference, url).href);
            expect(siblingKey, reference).toBe(`${ASSET_ID}/${reference}`);
            const resolved = resolveRuntimeAssetPath(appDir, pack, siblingKey);
            expect(await fs.readFile(resolved, "utf-8")).toBe(`bytes:${reference}`);
        }
    });

    it("keeps the bundle's path separators through URL encoding", () => {
        // `encodeURIComponent` over the whole key would escape "/" and collapse the bundle into one
        // opaque segment, which is what the per-segment encoding in the preload exists to avoid.
        expect(entryUrl()).toContain(`${ASSET_ID}/${ENTRY}`);
        expect(entryUrl()).not.toContain("%2F");
    });

    it("still refuses a manifest entry pointing outside the pack root", () => {
        const pack = makePack();
        pack.assets.items[`${ASSET_ID}/evil`] = manifestEntry(`${ASSET_ID}/evil`, "../../outside.txt");
        expect(() => resolveRuntimeAssetPath(appDir, pack, `${ASSET_ID}/evil`)).toThrow(/escapes runtime root/);
    });
});
