import path from "path";
import { describe, expect, it } from "vitest";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { resolveInsideRoot, resolveRuntimeAssetPath, resolveRuntimeStaticPath } from "./runtimeProtocol";

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
                        schemaVersion: 9,
                        blueprints: {},
                        ownerRecords: {},
                    },
                },
                localBlueprints: {
                    schemaVersion: 9,
                    blueprints: {},
                    ownerRecords: {},
                },
                sharedBlueprints: [],
                persistentVariables: {},
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
