import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { derivePackEncryptionKey, runtimeSupportPath } from "@narraleaf/encryption";
import {
    openSealedBundle,
    RUNTIME_BUNDLE_FILENAME,
    RUNTIME_SUPPORT_FILENAME,
} from "@narraleaf/encryption/runtime";
import { GAME_RUNTIME_PACK_SCHEMA_VERSION } from "@shared/types/gameRuntime";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY } from "@shared/types/blueprint/graph";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { compileGameRuntimeArtifact, type GameRuntimeArtifactCompileInput } from "./gameRuntimeArtifactCompiler";

const ASSET_ID = "00000000-0000-4000-8000-000000000123";
const REMOTE_ASSET_ID = "00000000-0000-4000-8000-000000000456";
const DISPLAYABLE_ANIMATION_FROM_EXPLICIT_PARAM = "__displayableAnimationFromExplicit";
const CURRENT_ICON_PLATFORM = process.platform === "darwin"
    ? "macos"
    : process.platform === "win32"
      ? "windows"
      : "linux";

let tempDir = "";

describe("game runtime artifact compiler", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-runtime-compiler-"));
    });

    afterEach(async () => {
        // The protected-store test process.dlopen()s the packed nlcrypto.node; on
        // Windows a loaded native module cannot be unlinked until the process
        // exits, so a plain rm throws EPERM on that one file. Retry briefly, then
        // leave the locked binary for the OS temp sweep rather than failing the
        // suite on a cleanup artifact.
        for (let attempt = 0; ; attempt++) {
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
                return;
            } catch (error) {
                const code = (error as { code?: string }).code;
                if ((code === "EPERM" || code === "EBUSY") && attempt < 5) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    continue;
                }
                if (code === "EPERM" || code === "EBUSY") {
                    return; // give up on the locked native module only
                }
                throw error;
            }
        }
    });

    it("writes a real preview app with pack.json and flat copied assets", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47321));

        expect(result.outputRoot).toBe(path.join(projectPath, ".nlstudio", "preview"));
        expect(result.appDir).toBe(path.join(result.outputRoot, "app"));
        expect(result.userDataDir).toBe(path.join(result.outputRoot, "userData"));
        expect(result.copiedAssetCount).toBe(1);
        await expect(fs.readFile(path.join(result.appDir, "main.js"), "utf-8")).resolves.toBe("// main");
        await expect(fs.readFile(path.join(result.appDir, "preload.js"), "utf-8")).resolves.toBe("// preload");
        await expect(fs.readFile(path.join(result.appDir, "renderer.js"), "utf-8")).resolves.toBe("// renderer");
        await expect(fs.readFile(path.join(result.appDir, "renderer.css"), "utf-8")).resolves.toBe("/* renderer css */");
        await expect(fs.readFile(path.join(result.appDir, "renderer.css.map"), "utf-8")).resolves.toBe("{}");
        await expect(fs.readFile(path.join(result.appDir, "index.html"), "utf-8")).resolves.toBe("<!doctype html>");
        await expect(fs.readFile(path.join(result.appDir, "assets", `${ASSET_ID}.png`), "utf-8")).resolves.toBe("local image bytes");
        await expect(fs.readFile(
            path.join(result.appDir, "icons", `app-icon-${CURRENT_ICON_PLATFORM}.png`),
            "utf-8",
        )).resolves.toBe("configured icon bytes");

        const packOnDisk = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(packOnDisk).toMatchObject({
            schemaVersion: GAME_RUNTIME_PACK_SCHEMA_VERSION,
            mode: "preview",
            runtimeVersion: "0.0.1-test",
            project: {
                name: "Fixture Project",
                identifier: "fixture.project",
                version: "1.2.3",
                icon: {
                    platform: CURRENT_ICON_PLATFORM,
                    relativePath: `icons/app-icon-${CURRENT_ICON_PLATFORM}.png`,
                    originalRelativePath: `resources/icons/app-icon-${CURRENT_ICON_PLATFORM}.png`,
                    sourceName: "fixture-icon.png",
                    mediaType: "image/png",
                },
            },
            entry: {
                kind: "surface",
                surfaceId: "surface-main",
            },
            preview: {
                controlPort: 47321,
                controlToken: "token",
            },
            assets: {
                items: {
                    [ASSET_ID]: {
                        id: ASSET_ID,
                        type: "image",
                        name: "hero.png",
                        source: "local",
                        relativePath: `assets/${ASSET_ID}.png`,
                    },
                },
            },
            bundle: {
                ui: {
                    uidoc: {
                        surfaces: [{ id: "surface-main" }],
                    },
                    sharedBlueprints: [],
                },
                blueprintCompiledScripts: {},
                blueprintScriptsCompileOk: true,
            },
        });
    });

    it("copies plugin runtime entries into the pack", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        const pluginInstallDir = path.join(tempDir, "plugins", "acme.sample-plugin");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await fs.mkdir(pluginInstallDir, { recursive: true });
        await fs.writeFile(path.join(pluginInstallDir, "runtime.js"), "export default {};", "utf-8");

        const manifest = {
            manifestVersion: 2 as const,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: { blueprintNodes: ["acme.sample-plugin.node"], widgets: [], runtimeData: [] },
            permissions: [],
        };
        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47324),
            runtimePlugins: [{
                manifest,
                entry: "runtime.js",
                entryPath: path.join(pluginInstallDir, "runtime.js"),
            }],
        });

        await expect(fs.readFile(
            path.join(result.appDir, "plugins", "acme.sample-plugin", "runtime.js"),
            "utf-8",
        )).resolves.toBe("export default {};");
        expect(result.pack.plugins).toEqual([{
            manifest,
            entryRelativePath: "plugins/acme.sample-plugin/runtime.js",
        }]);
    });

    it("produces an empty plugin list when no runtime plugins are supplied", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47325));

        expect(result.pack.plugins).toEqual([]);
    });

    it("fails with a clear diagnostic when a remote asset is missing from editor cache", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath, {
            assets: {
                [REMOTE_ASSET_ID]: {
                    id: REMOTE_ASSET_ID,
                    name: "remote-hero.jpg",
                    ext: "jpg",
                    source: "remote",
                },
            },
        });

        await expect(compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47322)))
            .rejects.toThrow(/remote cache "remote-hero\.jpg"/);
    });

    it("preserves authored Animate opacity percent params in the preview pack", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath, {
            assets: {},
            blueprintDocument: {
                schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                blueprints: {
                    "surface-main-blueprint": {
                        id: "surface-main-blueprint",
                        name: "Surface Main",
                        owner: {
                            kind: "surfaceMain",
                            surfaceId: "surface-main",
                        },
                        frontend: "visual",
                        programKind: "graph",
                        program: {
                            kind: "graph",
                            graphs: {
                                events: {
                                    "after-enter": {
                                        id: "after-enter",
                                        graph: {
                                            nodes: {
                                                animate: {
                                                    id: "animate",
                                                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
                                                    params: {
                                                        property: "opacity",
                                                        from: 0,
                                                        [DISPLAYABLE_ANIMATION_FROM_EXPLICIT_PARAM]: true,
                                                        to: 100,
                                                        duration: 0.3,
                                                        delay: 0,
                                                        easing: "linear",
                                                        after: "hold",
                                                    },
                                                },
                                            },
                                            edges: [],
                                        },
                                    },
                                },
                                functions: {},
                            },
                        },
                    },
                },
                ownerRecords: {
                    "surfaceMain:surface-main": {
                        activeBlueprintId: "surface-main-blueprint",
                        privateBlueprintIds: ["surface-main-blueprint"],
                    },
                },
                persistentVariables: {},
            },
        });
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47323));

        const blueprint = result.pack.bundle.ui.localBlueprints.blueprints["surface-main-blueprint"];
        const nodeParams = blueprint?.program.kind === "graph"
            ? blueprint.program.graphs.events["after-enter"]?.graph?.nodes?.animate?.params
            : undefined;

        expect(nodeParams).toMatchObject({
            property: "opacity",
            from: 0,
            [DISPLAYABLE_ANIMATION_FROM_EXPLICIT_PARAM]: true,
            to: 100,
        });
    });

    it("consolidates the pack, assets and plugins into a single protected store", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        const pluginInstallDir = path.join(tempDir, "plugins", "acme.sample-plugin");
        await createRuntimeDist(runtimeDistDir);
        // Protection carries no key material in main.js; the runtime bundle here
        // is just a marker to prove the compiler never injects anything into it.
        await fs.writeFile(path.join(runtimeDistDir, "main.js"), "// runtime main\n", "utf-8");
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await fs.mkdir(pluginInstallDir, { recursive: true });
        await fs.writeFile(path.join(pluginInstallDir, "runtime.js"), "export default {};", "utf-8");

        const packKey = derivePackEncryptionKey(crypto.randomBytes(32), crypto.randomBytes(16));
        const manifest = {
            manifestVersion: 2 as const,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: { blueprintNodes: ["acme.sample-plugin.node"], widgets: [], runtimeData: [] },
            permissions: [],
        };

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47330),
            encryptionKey: packKey,
            runtimePlugins: [{
                manifest,
                entry: "runtime.js",
                entryPath: path.join(pluginInstallDir, "runtime.js"),
            }],
        });

        // No loose game payload on disk: no pack.json, no assets/ dir, no plugins/ dir.
        await expect(fs.access(path.join(result.appDir, "pack.json"))).rejects.toThrow();
        await expect(fs.access(path.join(result.appDir, "assets"))).rejects.toThrow();
        await expect(fs.access(path.join(result.appDir, "plugins"))).rejects.toThrow();
        // The consolidated store and the support binary are present.
        await expect(fs.access(path.join(result.appDir, RUNTIME_BUNDLE_FILENAME))).resolves.toBeUndefined();
        await expect(fs.access(path.join(result.appDir, RUNTIME_SUPPORT_FILENAME))).resolves.toBeUndefined();
        expect(result.packPath).toBe(path.join(result.appDir, RUNTIME_BUNDLE_FILENAME));

        // The asset is addressed by an extension-free store entry; the media type
        // is still known from the manifest.
        expect(result.pack.assets.items[ASSET_ID].relativePath).toBe(`assets/${ASSET_ID}`);
        expect(result.pack.assets.items[ASSET_ID].mimeType).toBe("image/png");

        // main.js carries NO key material: the compiler injects nothing into it,
        // so it is byte-for-byte what the runtime build produced.
        const mainJs = await fs.readFile(path.join(result.appDir, "main.js"), "utf-8");
        expect(mainJs).toBe("// runtime main\n");

        // The shipped binary was patched with this build's per-title secret, so it
        // opens the store with NO key passed at all.
        const reader = await openSealedBundle(
            path.join(result.appDir, RUNTIME_SUPPORT_FILENAME),
            path.join(result.appDir, RUNTIME_BUNDLE_FILENAME),
        );
        try {
            const pack = JSON.parse((await reader.read("pack")).toString("utf-8"));
            expect(pack.assets.items[ASSET_ID].relativePath).toBe(`assets/${ASSET_ID}`);
            expect((await reader.read(`assets/${ASSET_ID}`)).toString("utf-8")).toBe("local image bytes");
            expect((await reader.read("plugins/acme.sample-plugin/runtime.js")).toString("utf-8")).toBe("export default {};");
        } finally {
            await reader.close();
        }

        // The per-title secret is load-bearing and lives ONLY in the shipped
        // binary: the pristine, unpatched codec cannot open the store.
        await expect(openSealedBundle(
            runtimeSupportPath(),
            path.join(result.appDir, RUNTIME_BUNDLE_FILENAME),
        )).rejects.toThrow();
    });

    it("writes a production app without a control channel or sibling userData", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const outputRoot = path.join(projectPath, ".nlstudio", "build", "staging");
        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: {
                kind: "surface",
                surfaceId: "surface-main",
            },
            outputRoot,
            mode: "production",
        });

        expect(result.outputRoot).toBe(outputRoot);
        expect(result.appDir).toBe(path.join(outputRoot, "app"));
        expect(result.userDataDir).toBeNull();
        await expect(fs.access(path.join(outputRoot, "userData"))).rejects.toThrow();
        // Sourcemaps are preview-only; shipped games must not carry them.
        await expect(fs.access(path.join(result.appDir, "renderer.css.map"))).rejects.toThrow();

        const packOnDisk = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(packOnDisk.mode).toBe("production");
        expect(packOnDisk.preview).toBeUndefined();

        const manifest = JSON.parse(await fs.readFile(path.join(result.appDir, "package.json"), "utf-8"));
        expect(manifest).toMatchObject({
            name: "fixture.project",
            productName: "Fixture Project",
            version: "1.2.3",
            author: "NarraLeaf",
            main: "main.js",
            narraleaf: { mode: "production" },
        });
    });

    it("marks preview app manifests with the preview mode", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47326));

        const manifest = JSON.parse(await fs.readFile(path.join(result.appDir, "package.json"), "utf-8"));
        expect(manifest).toMatchObject({
            name: "narraleaf-preview-runtime",
            narraleaf: { mode: "preview" },
        });
    });

    it("rejects a runtime dist without a build manifest", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await fs.rm(path.join(runtimeDistDir, "build-manifest.json"));
        await createMinimalProject(projectPath);

        await expect(compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47328)))
            .rejects.toThrow(/missing build-manifest\.json.*yarn build:runtime/s);
    });

    it("rejects a runtime dist whose build manifest is not production", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await fs.writeFile(
            path.join(runtimeDistDir, "build-manifest.json"),
            JSON.stringify({ mode: "development" }),
            "utf-8",
        );
        await createMinimalProject(projectPath);

        await expect(compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47329)))
            .rejects.toThrow(/not a production build.*"development".*yarn build:runtime/s);
    });

    it("rejects mode/control-channel mismatches", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);

        const base = previewCompileInput(projectPath, runtimeDistDir, 47327);
        await expect(compileGameRuntimeArtifact({ ...base, mode: "production" }))
            .rejects.toThrow(/must not carry a preview control channel/);
        await expect(compileGameRuntimeArtifact({ ...base, preview: undefined }))
            .rejects.toThrow(/requires a preview control channel/);
    });
});

function previewCompileInput(
    projectPath: string,
    runtimeDistDir: string,
    controlPort: number,
): GameRuntimeArtifactCompileInput {
    return {
        projectPath,
        runtimeDistDir,
        runtimeVersion: "0.0.1-test",
        entry: {
            kind: "surface",
            surfaceId: "surface-main",
        },
        outputRoot: path.join(projectPath, ".nlstudio", "preview"),
        preview: {
            controlPort,
            controlToken: "token",
        },
    };
}

async function createRuntimeDist(runtimeDistDir: string): Promise<void> {
    await fs.mkdir(runtimeDistDir, { recursive: true });
    await fs.writeFile(path.join(runtimeDistDir, "main.js"), "// main", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "native.js"), "// native", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "preload.js"), "// preload", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "renderer.js"), "// renderer", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "renderer.css"), "/* renderer css */", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "renderer.css.map"), "{}", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "index.html"), "<!doctype html>", "utf-8");
    // Written by build-runtime.js; the compiler refuses dists that lack it or
    // that report any mode other than "production".
    await fs.writeFile(
        path.join(runtimeDistDir, "build-manifest.json"),
        JSON.stringify({ mode: "production", sourcemap: true, builtAt: "2026-01-01T00:00:00.000Z" }),
        "utf-8",
    );
}

async function createMinimalProject(
    projectPath: string,
    options: {
        assets?: Record<string, unknown>;
        blueprintDocument?: Record<string, unknown>;
    } = {},
): Promise<void> {
    await fs.mkdir(path.join(projectPath, "editor", "ui"), { recursive: true });
    await fs.mkdir(path.join(projectPath, "assets"), { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "project.json"),
        JSON.stringify({
            name: "Fixture Project",
            identifier: "fixture.project",
            metadata: {
                version: "1.2.3",
                custom: true,
                icons: {
                    [CURRENT_ICON_PLATFORM]: {
                        path: `resources/icons/app-icon-${CURRENT_ICON_PLATFORM}.png`,
                        sourceName: "fixture-icon.png",
                        mediaType: "image/png",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                },
            },
        }),
        "utf-8",
    );
    await fs.writeFile(
        path.join(projectPath, "editor", "ui", "uidoc.json"),
        JSON.stringify({
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "ui-doc",
            name: "Fixture UI",
            surfaces: [{
                id: "surface-main",
                name: "Main",
                host: "app",
                kind: "appSurface",
                designSize: {
                    width: 1280,
                    height: 720,
                },
                rootElementId: "root",
            }],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    name: "Root",
                    parentId: null,
                    childrenIds: [],
                    layout: {
                        x: 0,
                        y: 0,
                        width: 1280,
                        height: 720,
                    },
                },
            },
        }),
        "utf-8",
    );
    await fs.writeFile(
        path.join(projectPath, "editor", "ui", "uigraphs.json"),
        JSON.stringify({
            schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
            graphs: {},
            blueprintDocument: options.blueprintDocument ?? {
                schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                blueprints: {},
                ownerRecords: {},
                persistentVariables: {},
            },
        }),
        "utf-8",
    );
    await fs.writeFile(
        path.join(projectPath, "assets", "assets.metadata.image.json"),
        JSON.stringify(options.assets ?? {
            [ASSET_ID]: {
                id: ASSET_ID,
                name: "hero.png",
                ext: ".png",
                source: "local",
            },
        }),
        "utf-8",
    );
}

async function writeAsset(projectPath: string, assetId: string, content: string): Promise<void> {
    const [a, b, rest] = splitAssetStorageId(assetId);
    const dir = path.join(projectPath, "assets", "content", a, b);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, rest), content, "utf-8");
}

async function writeProjectIcon(projectPath: string, content: string): Promise<void> {
    const dir = path.join(projectPath, "resources", "icons");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `app-icon-${CURRENT_ICON_PLATFORM}.png`), content, "utf-8");
}
