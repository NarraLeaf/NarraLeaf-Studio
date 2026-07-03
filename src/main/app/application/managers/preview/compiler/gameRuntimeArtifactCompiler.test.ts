import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GAME_RUNTIME_PACK_SCHEMA_VERSION } from "@shared/types/gameRuntime";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY } from "@shared/types/blueprint/graph";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { compileGameRuntimePreviewArtifact } from "./gameRuntimeArtifactCompiler";

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
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("writes a real preview app with pack.json and flat copied assets", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimePreviewArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: {
                kind: "surface",
                surfaceId: "surface-main",
            },
            controlPort: 47321,
            controlToken: "token",
        });

        expect(result.previewRoot).toBe(path.join(projectPath, ".nlstudio", "preview"));
        expect(result.appDir).toBe(path.join(result.previewRoot, "app"));
        expect(result.userDataDir).toBe(path.join(result.previewRoot, "userData"));
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

        await expect(compileGameRuntimePreviewArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: {
                kind: "surface",
                surfaceId: "surface-main",
            },
            controlPort: 47322,
            controlToken: "token",
        })).rejects.toThrow(/remote cache "remote-hero\.jpg"/);
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

        const result = await compileGameRuntimePreviewArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: {
                kind: "surface",
                surfaceId: "surface-main",
            },
            controlPort: 47323,
            controlToken: "token",
        });

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
});

async function createRuntimeDist(runtimeDistDir: string): Promise<void> {
    await fs.mkdir(runtimeDistDir, { recursive: true });
    await fs.writeFile(path.join(runtimeDistDir, "main.js"), "// main", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "preload.js"), "// preload", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "renderer.js"), "// renderer", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "renderer.css"), "/* renderer css */", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "renderer.css.map"), "{}", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "index.html"), "<!doctype html>", "utf-8");
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
