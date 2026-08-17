import path from "path";
import { describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import {
    resolveInsideRoot,
    resolveModelBundleKey,
    resolveRuntimeAssetPath,
    resolveRuntimeStaticPath,
} from "./runtimeProtocol";

function createPack(): GameRuntimePackV1 {
    return {
        schemaVersion: 2,
        generatedAt: "2026-01-01T00:00:00.000Z",
        mode: "preview",
        runtimeVersion: "0.0.1",
        project: {
            name: "Preview Game",
        },
        entry: {
            kind: "surface",
            surfaceId: "surface-main",
        },
        bundle: {
            bundleId: "bundle",
            revision: 1,
            timestamp: "2026-01-01T00:00:00.000Z",
            ui: {
                uidoc: {
                    schemaVersion: 10,
                    id: "ui",
                    name: "UI",
                    surfaces: [],
                    elements: {},
                },
                uigraphs: {
                    schemaVersion: 2,
                    graphs: {},
                    blueprintDocument: {
                        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                        blueprints: {},
                        ownerRecords: {},
                    },
                },
                localBlueprints: {
                    schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                    blueprints: {},
                    ownerRecords: {},
                },
                sharedBlueprints: [],
                persistentVariables: {},
                savedVariables: {},

                saveSchema: [],
            },
            blueprintCompiledScripts: {},
            blueprintScriptsCompileOk: true,
        },
        assets: {
            items: {
                image: {
                    id: "image",
                    type: "image",
                    name: "Image",
                    source: "local",
                    relativePath: "assets/image.png",
                },
                unsafe: {
                    id: "unsafe",
                    type: "image",
                    name: "Unsafe",
                    source: "local",
                    relativePath: "../outside.png",
                },
            },
        },
        plugins: [],
    };
}

describe("runtime protocol path resolution", () => {
    it("resolves static runtime paths inside the preview app directory", () => {
        const appDir = path.join(path.sep, "tmp", "preview", "app");

        expect(resolveRuntimeStaticPath(appDir, "/")).toBe(path.join(appDir, "index.html"));
        expect(resolveRuntimeStaticPath(appDir, "/renderer.js")).toBe(path.join(appDir, "renderer.js"));
        expect(resolveRuntimeStaticPath(appDir, "\\preload.js")).toBe(path.join(appDir, "preload.js"));
    });

    it("rejects static and generic paths that escape the app directory", () => {
        const appDir = path.join(path.sep, "tmp", "preview", "app");

        expect(() => resolveInsideRoot(appDir, "../pack.json")).toThrow(/escapes runtime root/);
        expect(() => resolveRuntimeStaticPath(appDir, "/../../outside.js")).toThrow(/escapes runtime root/);
    });

    it("resolves manifest assets and rejects missing or escaping entries", () => {
        const appDir = path.join(path.sep, "tmp", "preview", "app");
        const pack = createPack();

        expect(resolveRuntimeAssetPath(appDir, pack, "image")).toBe(path.join(appDir, "assets", "image.png"));
        expect(() => resolveRuntimeAssetPath(appDir, pack, "missing")).toThrow(/Runtime asset not found/);
        expect(() => resolveRuntimeAssetPath(appDir, pack, "unsafe")).toThrow(/escapes runtime root/);
    });
});

/**
 * The three shapes a model bundle is asked for, and the one thing a shipped pack still says about
 * one: that its id names a bundle. Everything else - where the entry file is, what it is called -
 * is fetched by id, so these all go through `readEntry` and none of them read a table.
 */
describe("model bundle request resolution", () => {
    const MODEL = "7e3a0c1d-0000-4000-8000-000000000001";
    const PLAIN = "9f0155aa-0000-4000-8000-000000000002";

    const packWith = (...models: string[]) => ({
        assets: { items: {}, ...(models.length > 0 ? { modelBundles: models } : {}) },
    } as unknown as GameRuntimePackV1);

    /** Records what was asked for, so "never consulted" is assertable rather than assumed. */
    function entryReader(entry: string | null) {
        const asked: string[] = [];
        return {
            asked,
            read: async (assetId: string) => {
                asked.push(assetId);
                return entry;
            },
        };
    }

    it("resolves the mount request to the entry file inside the bundle", async () => {
        const reader = entryReader("Hiyori.model3.json");
        await expect(resolveModelBundleKey(packWith(MODEL), `${MODEL}/`, reader.read))
            .resolves.toBe(`${MODEL}/Hiyori.model3.json`);
        expect(reader.asked).toEqual([MODEL]);
    });

    it("resolves the bare id the same way, for callers that never saw the puppet seam", async () => {
        // The surface preloader builds this shape from a story reference. Before the mount URL
        // dropped its file name, the bare id resolved through the manifest; now it resolves here.
        const reader = entryReader("Hiyori.model3.json");
        await expect(resolveModelBundleKey(packWith(MODEL), MODEL, reader.read))
            .resolves.toBe(`${MODEL}/Hiyori.model3.json`);
    });

    it("leaves a sibling alone when the entry sits at the bundle root", async () => {
        // `{id}/textures/x.png` is already the right key. Answering anything here would rewrite a
        // request that was correct, and turn a genuine missing-file 404 into a wrong-file 200.
        const reader = entryReader("Hiyori.model3.json");
        await expect(resolveModelBundleKey(packWith(MODEL), `${MODEL}/textures/body.png`, reader.read))
            .resolves.toBeNull();
    });

    it("retries a sibling under the entry's own directory when the entry is nested", async () => {
        // A model whose manifest lives in `runtime/` names its textures relative to `runtime/`, and
        // the engine resolved them against the bundle root because that is the URL it was mounted
        // from. This is the fallback that lets the mount URL stay `{id}/` for such a bundle.
        const reader = entryReader("runtime/Hiyori.model3.json");
        await expect(resolveModelBundleKey(packWith(MODEL), `${MODEL}/textures/body.png`, reader.read))
            .resolves.toBe(`${MODEL}/runtime/textures/body.png`);
    });

    it("answers null for an ordinary asset, without asking where its entry is", async () => {
        const reader = entryReader("Hiyori.model3.json");
        await expect(resolveModelBundleKey(packWith(MODEL), PLAIN, reader.read)).resolves.toBeNull();
        await expect(resolveModelBundleKey(packWith(MODEL), `${PLAIN}/nested.png`, reader.read))
            .resolves.toBeNull();
        expect(reader.asked).toEqual([]);
    });

    it("answers null for a pack that ships no bundles at all, and reads nothing", async () => {
        const reader = entryReader("Hiyori.model3.json");
        await expect(resolveModelBundleKey(packWith(), `${MODEL}/`, reader.read)).resolves.toBeNull();
        await expect(resolveModelBundleKey(packWith(MODEL), "", reader.read)).resolves.toBeNull();
        expect(reader.asked).toEqual([]);
    });

    it("answers null when the bundle is listed but its entry cannot be read", async () => {
        // A truncated or patched-away entry record must 404, not resolve to `{id}/undefined`.
        const reader = entryReader(null);
        await expect(resolveModelBundleKey(packWith(MODEL), `${MODEL}/`, reader.read)).resolves.toBeNull();
    });
});
