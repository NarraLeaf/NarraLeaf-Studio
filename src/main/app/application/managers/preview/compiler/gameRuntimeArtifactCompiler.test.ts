import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createProjectToken,
    createAssetOverlay,
    derivePackKey,
    projectStamp,
    archiveReaderPath,
    OVERLAY_FILE_EXTENSION,
} from "@narraleaf/bindings";
import {
    openAssetArchive,
    openAssetOverlay,
    ASSET_ARCHIVE_FILENAME,
    ARCHIVE_READER_FILENAME,
} from "@narraleaf/bindings/read";
import { GAME_RUNTIME_PACK_SCHEMA_VERSION } from "@shared/types/gameRuntime";
import { PACK_DELTA_VERSION } from "@shared/utils/packDelta";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY } from "@shared/types/blueprint/graph";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { WeatherSeedRef } from "@shared/weather/model";
import { weatherClipAssetId, weatherSpecForStage } from "@shared/weather/stage";
import type {
    NormalizedPluginManifestV2,
    PluginBuildConfigFieldContribution,
    PluginBuildDependencyContribution,
} from "@shared/types/plugins";
import { validatePluginManifest } from "@shared/utils/pluginManifest";
import { buildDependencySourcePath } from "../../../../../buildWorker/pluginBuildDependencies";
import {
    compileGameRuntimeArtifact,
    type GameRuntimeArtifactCompileInput,
    type GameRuntimePluginSource,
} from "./gameRuntimeArtifactCompiler";

const ASSET_ID = "00000000-0000-4000-8000-000000000123";
/** A second library asset the fixture project never mentions anywhere. */
const UNUSED_ASSET_ID = "00000000-0000-4000-8000-000000000124";
const REMOTE_ASSET_ID = "00000000-0000-4000-8000-000000000456";
const SIDECAR_PLUGIN_ID = "acme.sidecar-plugin";
const SIDECAR_ID = `${SIDECAR_PLUGIN_ID}.bridge`;
const SIDECAR_DEPENDENCY_ID = `${SIDECAR_PLUGIN_ID}.redist`;
const SIDECAR_PLATFORM_KEY = "windows-x64";
/** The fixture package that declares one public field and one credential. */
const BUILD_CONFIG_FIXTURE_ID = "narraleaf.steam-appid-fixture";
/** A second declarer, so "a plugin reads its own values" is a claim with something to be wrong about. */
const OTHER_CONFIG_PLUGIN_ID = "acme.other-config-plugin";
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
        vi.unstubAllGlobals();
        // The protected-store test process.dlopen()s the packed bindings.node; on
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

    it("puts the project's crash policy on the pack, which is how it reaches the game", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath, { app: { crash: { policy: "log" } } });
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47321));

        const pack = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(pack.crash).toEqual({ policy: "log" });
    });

    it("falls back to showing the error for a project that never chose", async () => {
        // Every build made before this setting existed behaved this way, so a project that has
        // never opened the control must keep shipping what it already shipped.
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47321));

        const pack = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(pack.crash).toEqual({ policy: "details" });
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
            contributes: {
                blueprintNodes: ["acme.sample-plugin.node"],
                widgets: [], tests: [], runtimeData: [], locales: [],
                runtimeCapabilities: [], sidecars: [], buildDependencies: [], buildConfig: [],
                externalLinks: [],
                network: [],
            },
            permissions: [],
        };
        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47324),
            runtimePlugins: [{
                manifest,
                entry: "runtime.js",
                entryPath: path.join(pluginInstallDir, "runtime.js"),
                installPath: pluginInstallDir,
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

    it("copies each installed puppet runtime directory whole and records it in the pack", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        const backendDir = path.join(projectPath, "runtimes", "puppet", "demo-backend");
        await fs.mkdir(path.join(backendDir, "nested"), { recursive: true });
        await fs.writeFile(path.join(backendDir, "index.js"), "export default {};", "utf-8");
        await fs.writeFile(path.join(backendDir, "nested", "extra.txt"), "sibling bytes", "utf-8");
        // No index.js: an install that is not loadable is skipped, not fatal.
        await fs.mkdir(path.join(projectPath, "runtimes", "puppet", "half-installed"), { recursive: true });

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47331));

        expect(result.pack.puppetRuntimes).toEqual([{
            name: "demo-backend",
            entryRelativePath: "puppet/demo-backend/index.js",
            files: ["nested/extra.txt"],
        }]);
        await expect(fs.readFile(
            path.join(result.appDir, "puppet", "demo-backend", "index.js"),
            "utf-8",
        )).resolves.toBe("export default {};");
        // The whole directory travels: a backend that reads its own siblings has to find them.
        await expect(fs.readFile(
            path.join(result.appDir, "puppet", "demo-backend", "nested", "extra.txt"),
            "utf-8",
        )).resolves.toBe("sibling bytes");
    });

    it("omits the puppet runtime list when the project installed none", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47332));

        expect(result.pack.puppetRuntimes).toBeUndefined();
    });

    it("copies a plugin sidecar for the platform being built and records it in the pack", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        const pluginInstallDir = path.join(tempDir, "plugins", SIDECAR_PLUGIN_ID);
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        const manifest = await writeSidecarPlugin({
            installDir: pluginInstallDir,
            files: { "bin/win-x64/tool.exe": "MZ fake executable" },
            entry: "bin/win-x64/tool.exe",
            include: ["bin/win-x64/tool.exe"],
        });

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47340),
            platformKeys: [SIDECAR_PLATFORM_KEY],
            runtimePlugins: [pluginSource(manifest, pluginInstallDir)],
        });

        await expect(fs.readFile(
            path.join(result.appDir, "sidecars", SIDECAR_PLUGIN_ID, SIDECAR_ID, "bin", "win-x64", "tool.exe"),
            "utf-8",
        )).resolves.toBe("MZ fake executable");
        // The pack carries the spawn contract flattened out of the manifest, with
        // an app-dir-relative entry the runtime can hand to spawn().
        expect(result.pack.plugins[0].sidecars).toEqual([{
            id: SIDECAR_ID,
            entry: `sidecars/${SIDECAR_PLUGIN_ID}/${SIDECAR_ID}/bin/win-x64/tool.exe`,
            kind: "executable",
            autostart: "onGameStart",
            startupTimeoutMs: 5000,
            shutdownTimeoutMs: 3000,
            restart: { maxRetries: 3, backoffMs: 1000 },
        }]);
    });

    /*
     * The case this replaced: a build with more than one desktop target shipped
     * NO sidecars at all, with a warning telling the author to build one platform
     * at a time. The obstacle was the pack rather than the copying - it named one
     * file per sidecar, and the name is not the same on both.
     */
    it("ships a sidecar for every target, naming the file each machine spawns", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        const pluginInstallDir = path.join(tempDir, "plugins", SIDECAR_PLUGIN_ID);
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        const manifest = await writeSidecarPlugin({
            installDir: pluginInstallDir,
            files: { "bin/tool.exe": "MZ fake executable", "bin/tool": "#!/bin/sh" },
            entry: "unused",
            include: [],
            targets: {
                "windows-x64": { entry: "bin/tool.exe", include: ["bin/tool.exe"] },
                "linux-x64": { entry: "bin/tool", include: ["bin/tool"] },
            },
        });

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            packaging: true,
            platformKeys: ["windows-x64", "linux-x64"],
            runtimePlugins: [pluginSource(manifest, pluginInstallDir)],
        });

        // Each target's own file, under its own staging directory - the packaging
        // step maps one of these onto the app root per package.
        const staged = (platformKey: string, name: string) => path.join(
            result.appDir, "platform", platformKey, "sidecars", SIDECAR_PLUGIN_ID, SIDECAR_ID, "bin", name);
        await expect(fs.readFile(staged("windows-x64", "tool.exe"), "utf-8")).resolves.toBe("MZ fake executable");
        await expect(fs.readFile(staged("linux-x64", "tool"), "utf-8")).resolves.toBe("#!/bin/sh");
        // And neither is at the app root, where it would ship to both.
        await expect(fs.access(path.join(result.appDir, "sidecars"))).rejects.toThrow();

        // One pack entry, naming a file per machine, keyed the way a running game
        // describes itself rather than the way the build dialog does.
        expect(result.pack.plugins[0].sidecars).toEqual([{
            id: SIDECAR_ID,
            entry: {
                "win32-x64": `sidecars/${SIDECAR_PLUGIN_ID}/${SIDECAR_ID}/bin/tool.exe`,
                "linux-x64": `sidecars/${SIDECAR_PLUGIN_ID}/${SIDECAR_ID}/bin/tool`,
            },
            kind: "executable",
            autostart: "onGameStart",
            startupTimeoutMs: 5000,
            shutdownTimeoutMs: 3000,
            restart: { maxRetries: 3, backoffMs: 1000 },
        }]);
    });

    it("refuses to ship a sidecar file that does not match its declared digest", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        const pluginInstallDir = path.join(tempDir, "plugins", SIDECAR_PLUGIN_ID);
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        // An install directory is an ordinary folder: anything on the host can
        // swap the binary after the install-time check passed.
        const manifest = await writeSidecarPlugin({
            installDir: pluginInstallDir,
            files: { "bin/tool.exe": "a binary somebody swapped in" },
            entry: "bin/tool.exe",
            include: ["bin/tool.exe"],
            sha256: { "bin/tool.exe": sha256OfText("the binary the plugin author published") },
        });

        await expect(compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47341),
            platformKeys: [SIDECAR_PLATFORM_KEY],
            runtimePlugins: [pluginSource(manifest, pluginInstallDir)],
        })).rejects.toThrow(
            new RegExp(`Sidecar "${SIDECAR_ID}" of plugin "${SIDECAR_PLUGIN_ID}".+bin/tool\\.exe.+sha256`, "s"),
        );
    });

    it("resolves a dep: include through the build dependency cache", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        const pluginInstallDir = path.join(tempDir, "plugins", SIDECAR_PLUGIN_ID);
        const hostUserDataDir = path.join(tempDir, "userData");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        // Pre-place the verified bytes in the cache, the way an author on an
        // offline machine would; the compile must not reach the network.
        const dependencyBytes = "redistributable library bytes";
        const dependencySha256 = sha256OfText(dependencyBytes);
        const sourcePath = buildDependencySourcePath(hostUserDataDir, dependencySha256);
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.writeFile(sourcePath, dependencyBytes, "utf-8");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const manifest = await writeSidecarPlugin({
            installDir: pluginInstallDir,
            files: { "bin/tool.exe": "MZ fake executable" },
            entry: "bin/tool.exe",
            include: ["bin/tool.exe", `dep:${SIDECAR_DEPENDENCY_ID}/bin/redist.dll`],
            buildDependencies: [{
                id: SIDECAR_DEPENDENCY_ID,
                targets: {
                    [SIDECAR_PLATFORM_KEY]: {
                        url: "https://example.invalid/redist.dll",
                        sha256: dependencySha256,
                        archive: "none",
                        // Laid out beside the executable: a Windows binary looks
                        // for its libraries in its own directory.
                        fileName: "bin/redist.dll",
                    },
                },
            }],
        });

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47342),
            platformKeys: [SIDECAR_PLATFORM_KEY],
            hostUserDataDir,
            runtimePlugins: [pluginSource(manifest, pluginInstallDir)],
        });

        const sidecarDir = path.join(result.appDir, "sidecars", SIDECAR_PLUGIN_ID, SIDECAR_ID);
        await expect(fs.readFile(path.join(sidecarDir, "bin", "redist.dll"), "utf-8"))
            .resolves.toBe(dependencyBytes);
        await expect(fs.readFile(path.join(sidecarDir, "bin", "tool.exe"), "utf-8"))
            .resolves.toBe("MZ fake executable");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips a sidecar the plugin ships nothing for on this platform, rather than failing", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        const pluginInstallDir = path.join(tempDir, "plugins", SIDECAR_PLUGIN_ID);
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        const manifest = await writeSidecarPlugin({
            installDir: pluginInstallDir,
            files: { "bin/linux-x64/tool": "ELF fake executable" },
            entry: "bin/linux-x64/tool",
            include: ["bin/linux-x64/tool"],
            platformKey: "linux-x64",
        });

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47343),
            platformKeys: [SIDECAR_PLATFORM_KEY],
            runtimePlugins: [pluginSource(manifest, pluginInstallDir)],
        });

        // A platform the plugin does not support is a supported shape: the pack
        // says "no sidecar" and the plugin's runtime degrades. Preflight is what
        // warns the author; the compile does not fail.
        expect(result.pack.plugins[0].sidecars).toBeUndefined();
        await expect(fs.access(path.join(result.appDir, "sidecars"))).rejects.toThrow();
    });

    /**
     * What the author typed into the build dialog used to stop there: the values were checked
     * before a build and then left behind in the project, so a plugin's own runtime could not learn
     * the storefront id its build was configured with.
     */
    it("gives each plugin its own build config, resolved for the variant, with no secret in it", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const steam = await writeRuntimeOnlyPlugin(
            path.join(tempDir, "plugins", BUILD_CONFIG_FIXTURE_ID),
            await readFixtureManifest(),
        );
        const other = await writeRuntimeOnlyPlugin(
            path.join(tempDir, "plugins", OTHER_CONFIG_PLUGIN_ID),
            buildConfigManifest(OTHER_CONFIG_PLUGIN_ID, [
                { key: "appId", label: "App id", type: "text", scope: "global" },
                { key: "channel", label: "Channel", type: "text", scope: "variant" },
            ]),
        );
        await fs.writeFile(
            path.join(projectPath, "editor", "app-tags.json"),
            JSON.stringify({
                schemaVersion: 1,
                pluginConfig: {
                    [BUILD_CONFIG_FIXTURE_ID]: { appId: "480", buildToken: "handle-the-project-holds" },
                    [OTHER_CONFIG_PLUGIN_ID]: { appId: "not-the-steam-one", channel: "stable" },
                },
                tags: [{
                    id: "demo",
                    name: "Demo",
                    overrides: {},
                    pluginConfig: { [OTHER_CONFIG_PLUGIN_ID]: { channel: "beta" } },
                }],
            }),
            "utf-8",
        );

        const compile = async (appTag?: { id: string; name: string }) => (await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            runtimePlugins: [
                pluginSource(steam, path.join(tempDir, "plugins", BUILD_CONFIG_FIXTURE_ID)),
                pluginSource(other, path.join(tempDir, "plugins", OTHER_CONFIG_PLUGIN_ID)),
            ],
            ...(appTag ? { appTag } : {}),
        })).pack;

        const demo = await compile({ id: "demo", name: "Demo" });
        // Two plugins both call a field `appId`, and each entry answers with its own author's value.
        // A plugin reads the entry it was loaded from, so there is no route from one to the other.
        expect(demo.plugins[0].buildConfig).toEqual({ appId: "480" });
        expect(demo.plugins[1].buildConfig).toEqual({ appId: "not-the-steam-one", channel: "beta" });
        // The handle for the secret is in the project record right beside the app id, and it is in
        // neither entry - nor anywhere else in the pack a player can read.
        expect(JSON.stringify(demo)).not.toContain("handle-the-project-holds");

        // The demo's channel is the demo's; the release build reads the project's own.
        const release = await compile();
        expect(release.plugins[1].buildConfig).toEqual({ appId: "not-the-steam-one", channel: "stable" });
    });

    it("carries no build config for a plugin whose fields nobody filled in", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        const steam = await writeRuntimeOnlyPlugin(
            path.join(tempDir, "plugins", BUILD_CONFIG_FIXTURE_ID),
            await readFixtureManifest(),
        );

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47344),
            runtimePlugins: [pluginSource(steam, path.join(tempDir, "plugins", BUILD_CONFIG_FIXTURE_ID))],
        });

        // Absent rather than empty: never declared, never filled in and never built are one fact to
        // the plugin, which is that it was told nothing.
        expect(result.pack.plugins[0].buildConfig).toBeUndefined();
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

    /**
     * The regression this guards is a build that only worked on the machine that imported the asset.
     * Remote assets used to be read out of `editor/assets/remote`, the editor's download cache, which
     * version control deliberately excludes and which only gets filled by previewing that asset - so
     * a fresh clone, or an asset the author had never opened, failed on a file that had never existed
     * there. Their snapshot is an ordinary content shard now, and the fixture writes it as one.
     */
    it("packs a remote asset from its versioned snapshot, like any other asset", async () => {
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
        await writeAsset(projectPath, REMOTE_ASSET_ID, "pinned remote bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47322));

        const entry = result.pack.assets.items[REMOTE_ASSET_ID];
        expect(entry.source).toBe("remote");
        await expect(fs.readFile(path.join(result.appDir, "assets", `${REMOTE_ASSET_ID}.jpg`), "utf-8"))
            .resolves.toBe("pinned remote bytes");
    });

    it("fails with a clear diagnostic when a remote asset has never been fetched", async () => {
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

        await expect(compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47323)))
            .rejects.toThrow(/remote asset "remote-hero\.jpg"/);
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

        const packKey = derivePackKey(crypto.randomBytes(32), crypto.randomBytes(16));
        const manifest = {
            manifestVersion: 2 as const,
            id: "acme.sample-plugin",
            name: "Sample Plugin",
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                blueprintNodes: ["acme.sample-plugin.node"],
                widgets: [], tests: [], runtimeData: [], locales: [],
                runtimeCapabilities: [], sidecars: [], buildDependencies: [], buildConfig: [],
                externalLinks: [],
                network: [],
            },
            permissions: [],
        };

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47330),
            encryptionKey: packKey,
            runtimePlugins: [{
                manifest,
                entry: "runtime.js",
                entryPath: path.join(pluginInstallDir, "runtime.js"),
                installPath: pluginInstallDir,
            }],
        });

        // No loose game payload on disk: no pack.json, no assets/ dir, no plugins/ dir.
        await expect(fs.access(path.join(result.appDir, "pack.json"))).rejects.toThrow();
        await expect(fs.access(path.join(result.appDir, "assets"))).rejects.toThrow();
        await expect(fs.access(path.join(result.appDir, "plugins"))).rejects.toThrow();
        // The consolidated store and the support binary are present.
        await expect(fs.access(path.join(result.appDir, ASSET_ARCHIVE_FILENAME))).resolves.toBeUndefined();
        await expect(fs.access(path.join(result.appDir, ARCHIVE_READER_FILENAME))).resolves.toBeUndefined();
        expect(result.packPath).toBe(path.join(result.appDir, ASSET_ARCHIVE_FILENAME));

        // The asset is addressed by an extension-free store entry; the media type
        // is still known from the manifest.
        expect(result.pack.assets.items[ASSET_ID].relativePath).toBe(`assets/${ASSET_ID}`);
        expect(result.pack.assets.items[ASSET_ID].mimeType).toBe("image/png");

        // main.js carries NO key material: the compiler injects nothing into it,
        // so it is byte-for-byte what the runtime build produced.
        const mainJs = await fs.readFile(path.join(result.appDir, "main.js"), "utf-8");
        expect(mainJs).toBe("// runtime main\n");

        // The reader this build produced opens the store on its own, with
        // nothing passed to it.
        const reader = await openAssetArchive(
            path.join(result.appDir, ARCHIVE_READER_FILENAME),
            path.join(result.appDir, ASSET_ARCHIVE_FILENAME),
        );
        try {
            const pack = JSON.parse((await reader.read("pack")).toString("utf-8"));
            expect(pack.assets.items[ASSET_ID].relativePath).toBe(`assets/${ASSET_ID}`);
            expect((await reader.read(`assets/${ASSET_ID}`)).toString("utf-8")).toBe("local image bytes");
            expect((await reader.read("plugins/acme.sample-plugin/runtime.js")).toString("utf-8")).toBe("export default {};");
        } finally {
            await reader.close();
        }

        // The store is bound to the reader this build produced: the copy the
        // package ships does not open it.
        await expect(openAssetArchive(
            archiveReaderPath(),
            path.join(result.appDir, ASSET_ARCHIVE_FILENAME),
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
            // The shipped game reads userDataDir before it can open the pack, and
            // names the player's directory after it rather than after productName,
            // which a rename would move. See shared/utils/userDataLocation.ts.
            // Where those files go travels beside the name, and is complete even for a project
            // that has never been asked: the runtime settles both before Chromium starts and has
            // nowhere to go back to for the other half.
            narraleaf: {
                mode: "production",
                userDataDir: "fixture.project",
                saveLocation: { windowsLinux: "app-root", macos: "user-data" },
            },
        });
        // Absent, not false: every build an author can make refuses a debugging switch, and the
        // runtime reads the marker's presence.
        expect(packOnDisk.debuggable).toBeUndefined();
        expect(manifest.narraleaf.debuggable).toBeUndefined();
    });

    /*
     * The experimental debuggable-build condition. The marker has to reach both the pack and the
     * loose manifest: the runtime checks the manifest before Chromium starts and the pack once it
     * is open, and a build carrying only one of them is refused by the gate that reads the other.
     */
    it("marks a debuggable build in both the pack and the app manifest", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: {
                kind: "surface",
                surfaceId: "surface-main",
            },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            debuggable: true,
        });

        expect(result.pack.debuggable).toBe(true);
        const packOnDisk = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(packOnDisk.debuggable).toBe(true);
        const manifest = JSON.parse(await fs.readFile(path.join(result.appDir, "package.json"), "utf-8"));
        expect(manifest.narraleaf).toMatchObject({ mode: "production", debuggable: true });
    });

    /*
     * The one combination the marker must not survive.
     *
     * A protected build's runtime refuses a debugging switch whatever its markers say, because the
     * gate that decides in time reads the loose manifest - a text file - and a build whose author
     * paid for asset protection cannot have a one-word edit standing between a stranger and a
     * debugger attached to the process that holds the decrypted content. So the artifact does not
     * carry the claim at all, and says why.
     */
    it("keeps the debuggable marker on a protected build, and says how far it reaches", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await fs.writeFile(path.join(runtimeDistDir, "main.js"), "// runtime main", "utf-8");
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            debuggable: true,
            encryptionKey: derivePackKey(crypto.randomBytes(32), crypto.randomBytes(16)),
        });

        expect(result.pack.debuggable).toBe(true);
        // The artifact is honest about being half a debuggable one, because the difference only
        // shows up when someone runs the packaged game and nothing attaches.
        expect(result.notices.some(notice => notice.includes("run directly"))).toBe(true);

        // Both markers, because the runtime reads them at different moments and puts each through
        // the same rule - an artifact carrying only one of them would be refused by the other gate.
        const manifest = JSON.parse(await fs.readFile(path.join(result.appDir, "package.json"), "utf-8"));
        expect(manifest.narraleaf.debuggable).toBe(true);

        const reader = await openAssetArchive(
            path.join(result.appDir, ARCHIVE_READER_FILENAME),
            path.join(result.appDir, ASSET_ARCHIVE_FILENAME),
        );
        try {
            const pack = JSON.parse((await reader.read("pack")).toString("utf-8"));
            expect(pack.debuggable).toBe(true);
        } finally {
            await reader.close();
        }
    });

    /*
     * The point of the whole opaque-read design, asserted end to end: a shipped protected build must
     * be unable to answer "what is in here", while still being able to answer "give me this id".
     *
     * Asserted against the bytes inside the store rather than against the returned pack, because the
     * returned object is the compiler's own and the artifact is what a player receives.
     */
    it("ships a protected production build with no asset manifest and no asset names", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await fs.writeFile(path.join(runtimeDistDir, "main.js"), "// runtime main\n", "utf-8");
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            encryptionKey: derivePackKey(crypto.randomBytes(32), crypto.randomBytes(16)),
        });

        const reader = await openAssetArchive(
            path.join(result.appDir, ARCHIVE_READER_FILENAME),
            path.join(result.appDir, ASSET_ARCHIVE_FILENAME),
        );
        try {
            const pack = JSON.parse((await reader.read("pack")).toString("utf-8"));

            // Nothing to enumerate: no ids, and so no names, paths, hashes or media types either.
            expect(pack.assets.items).toEqual({});
            expect(pack.bundle.storyLibrary?.assetNames ?? {}).toEqual({});

            // And the bytes are still reachable, by deriving the entry name from the id alone -
            // which is the trade the empty manifest is paying for.
            expect((await reader.read(`assets/${ASSET_ID}`)).toString("utf-8")).toBe("local image bytes");

            // The strongest form of the claim: the id does not occur anywhere in the pack's own
            // descriptor as an asset the game declares. It may still appear as a story reference,
            // which is the residual the design accepts - the story has to name what it shows.
            const declared = JSON.stringify(pack.assets);
            expect(declared).not.toContain(ASSET_ID);
        } finally {
            await reader.close();
        }
    });

    /*
     * A model bundle is the one asset kind a pack still has to say anything about, so it is the one
     * place the strip could quietly leak a name - and the name it would leak is the file a
     * character's model is stored under, which is usually the character's.
     *
     * Both shapes are built in one artifact on purpose: a bundle whose entry is at its root, and one
     * whose entry is in a subdirectory. They take different paths through the runtime and only the
     * second exercises the fallback that lets the mount URL carry no file name.
     */
    it("ships model bundles by id, with their entry paths in the payload rather than the pack", async () => {
        const FLAT_MODEL = "3c1d0a70-0000-4000-8000-00000000000a";
        const NESTED_MODEL = "3c1d0a70-0000-4000-8000-00000000000b";
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await fs.writeFile(path.join(runtimeDistDir, "main.js"), "// runtime main\n", "utf-8");
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await writeModelBundle(projectPath, FLAT_MODEL, "Hiyori.model3.json", {
            "Hiyori.model3.json": '{"FileReferences":{"Textures":["textures/body.png"]}}',
            "textures/body.png": "flat texture bytes",
        });
        await writeModelBundle(projectPath, NESTED_MODEL, "runtime/Aoi.model3.json", {
            "runtime/Aoi.model3.json": '{"FileReferences":{"Textures":["textures/body.png"]}}',
            "runtime/textures/body.png": "nested texture bytes",
        });

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            encryptionKey: derivePackKey(crypto.randomBytes(32), crypto.randomBytes(16)),
        });

        const reader = await openAssetArchive(
            path.join(result.appDir, ARCHIVE_READER_FILENAME),
            path.join(result.appDir, ASSET_ARCHIVE_FILENAME),
        );
        try {
            const pack = JSON.parse((await reader.read("pack")).toString("utf-8"));

            // Ids, and only ids.
            expect(pack.assets.items).toEqual({});
            expect(pack.assets.modelBundles.slice().sort()).toEqual([FLAT_MODEL, NESTED_MODEL].sort());
            const declared = JSON.stringify(pack.assets);
            expect(declared).not.toContain("Hiyori");
            expect(declared).not.toContain("Aoi");
            expect(declared).not.toContain("model3.json");

            // The entry path is in the payload, at the address derived from the id - reachable by a
            // caller that already knows which model it wants, and by no other.
            const flatEntry = JSON.parse((await reader.read(`assets/${FLAT_MODEL}/`)).toString("utf-8"));
            const nestedEntry = JSON.parse((await reader.read(`assets/${NESTED_MODEL}/`)).toString("utf-8"));
            expect(flatEntry.e).toBe("Hiyori.model3.json");
            expect(nestedEntry.e).toBe("runtime/Aoi.model3.json");

            // And the bundle's files are where the request shapes expect to find them.
            expect((await reader.read(`assets/${FLAT_MODEL}/textures/body.png`)).toString())
                .toBe("flat texture bytes");
            expect((await reader.read(`assets/${NESTED_MODEL}/runtime/textures/body.png`)).toString())
                .toBe("nested texture bytes");
        } finally {
            await reader.close();
        }
    });

    it("names the player's directory after the app id the build resolved", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            // What the build packages under; the manifest must agree with it
            // rather than derive a second answer from the project fields.
            appId: "com.studio.other",
        });

        const manifest = JSON.parse(await fs.readFile(path.join(result.appDir, "package.json"), "utf-8"));
        expect(manifest.narraleaf.userDataDir).toBe("com.studio.other");
    });

    it("carries no ending page for a project that picks none", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(previewCompileInput(projectPath, runtimeDistDir, 47331));

        // Absent is the behaviour every build had before the field existed, which is the story
        // stopping with its last frame on screen.
        expect(result.pack.endingSurfaceId).toBeUndefined();
    });

    it("carries the page the compiled variant ends on, and only that one", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await fs.writeFile(
            path.join(projectPath, "editor", "app-tags.json"),
            JSON.stringify({
                schemaVersion: 1,
                endingSurfaceId: "surface-credits",
                tags: [
                    { id: "demo", name: "Demo", overrides: {}, endingSurfaceId: "surface-thanks" },
                    { id: "quiet", name: "Quiet", overrides: {}, endingSurfaceId: "" },
                ],
            }),
            "utf-8",
        );

        const compile = async (appTag?: { id: string; name: string }) => (await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            ...(appTag ? { appTag } : {}),
        })).pack;

        expect((await compile({ id: "demo", name: "Demo" })).endingSurfaceId).toBe("surface-thanks");
        expect((await compile()).endingSurfaceId).toBe("surface-credits");
        // A variant that states it shows nothing carries no page, not the project's.
        expect((await compile({ id: "quiet", name: "Quiet" })).endingSurfaceId).toBeUndefined();
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
        // Preview keeps its userData beside the compiled app, so there is no
        // per-user directory to name; the runtime falls back to that sibling.
        expect(manifest.narraleaf.userDataDir).toBeUndefined();
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

    /**
     * The distribution key is a project file that must never reach a player, and
     * the two mechanisms that decide what ships both default to carrying a new
     * project file: the asset walk is unconditional, and the variant trimmer keeps
     * whatever it finds named in the shipped bytes. So this asserts absence over
     * the produced bytes rather than over the code path that produced them - a
     * check written against the path would keep passing when a third mechanism
     * starts copying project files.
     */
    it("never writes the distribution key into the artifact", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const projectMaterial = createProjectToken();
        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47340),
            mode: "production",
            preview: undefined,
            appId: "com.example.patchable",
            distribution: { key: projectMaterial, titleId: "com.example.patchable" },
        });

        for (const file of await listFilesRecursively(result.appDir)) {
            const bytes = await fs.readFile(file);
            expect(bytes.includes(projectMaterial), `${path.relative(result.appDir, file)} carries the key`).toBe(false);
        }
    });

    /**
     * What a build has to carry to accept a patch: the public half of the key, and
     * a bound binary to read one through. The binary matters most on an
     * unprotected build - nothing else there would ever bind it, and an unbound
     * one reads no patch while looking entirely healthy.
     */
    it("publishes the verification key and binds the binary on an unprotected build", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const projectMaterial = createProjectToken();
        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47341),
            mode: "production",
            preview: undefined,
            appId: "com.example.patchable",
            distribution: { key: projectMaterial, titleId: "com.example.patchable" },
        });

        expect(result.pack.addOns?.verificationKey)
            .toBe(projectStamp(projectMaterial, "com.example.patchable"));
        // What a later patch export reads to decide whether this build can be sent the difference
        // rather than a whole pack. Dropped, every patch made for this build silently goes back to
        // replacing the content of every other patch installed beside it.
        expect(result.pack.addOns?.packDeltaVersion).toBe(PACK_DELTA_VERSION);
        // Loose payload, and still a binary beside it.
        await expect(fs.access(path.join(result.appDir, "pack.json"))).resolves.toBeUndefined();
        const binaryPath = path.join(result.appDir, ARCHIVE_READER_FILENAME);
        await expect(fs.access(binaryPath)).resolves.toBeUndefined();

        // Bound to this title: a patch for it opens, and the same patch does not
        // open against the copy the package ships.
        const patchPath = path.join(tempDir, `patch${OVERLAY_FILE_EXTENSION}`);
        const writer = await createAssetOverlay(patchPath, {
            projectMaterial,
            titleId: "com.example.patchable",
        });
        await writer.add("assets/probe", Buffer.from("patched bytes"));
        await writer.finalize();

        const reader = await openAssetOverlay(binaryPath, patchPath, {
            verificationKey: result.pack.addOns?.verificationKey,
        });
        try {
            expect(reader.proven).toBe(true);
            expect((await reader.read("assets/probe")).toString("utf-8")).toBe("patched bytes");
        } finally {
            await reader.close();
        }
        await expect(openAssetOverlay(archiveReaderPath(), patchPath, {
            verificationKey: result.pack.addOns?.verificationKey,
        })).rejects.toThrow();
    });

    /**
     * Two builds of one project under two editions must not be able to read each
     * other's patches: an edition is a separate title, and a demo accepting the
     * full game's content would undo the whole reason a demo is built.
     */
    it("keeps editions of one project on separate keys", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const projectMaterial = createProjectToken();
        const release = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47342),
            mode: "production",
            preview: undefined,
            outputRoot: path.join(tempDir, "out-release"),
            appId: "com.example.full",
            distribution: { key: projectMaterial, titleId: "com.example.full" },
        });

        const demoPatch = path.join(tempDir, `demo${OVERLAY_FILE_EXTENSION}`);
        const writer = await createAssetOverlay(demoPatch, {
            projectMaterial,
            titleId: "com.example.full-demo",
        });
        await writer.add("assets/probe", Buffer.from("demo bytes"));
        await writer.finalize();

        await expect(openAssetOverlay(
            path.join(release.appDir, ARCHIVE_READER_FILENAME),
            demoPatch,
            { verificationKey: projectStamp(projectMaterial, "com.example.full-demo") },
        )).rejects.toThrow();
    });
});

function sha256OfText(content: string): string {
    return crypto.createHash("sha256").update(Buffer.from(content, "utf-8")).digest("hex");
}

function pluginSource(manifest: NormalizedPluginManifestV2, installDir: string): GameRuntimePluginSource {
    return {
        manifest,
        entry: "runtime.js",
        entryPath: path.join(installDir, "runtime.js"),
        installPath: installDir,
    };
}

/**
 * A plugin package that ships one sidecar: its runtime entry plus every
 * package-relative file the target includes, written to disk, and the manifest
 * the compiler reads. `sha256` defaults to the files' real digests, so a test
 * that passes it deliberately is describing a package that has been tampered
 * with since it was installed.
 */
async function writeSidecarPlugin(input: {
    installDir: string;
    files: Record<string, string>;
    entry: string;
    include: string[];
    sha256?: Record<string, string>;
    platformKey?: string;
    /** Several targets, when the point of the test is that they differ. */
    targets?: Record<string, { entry: string; include: string[] }>;
    buildDependencies?: PluginBuildDependencyContribution[];
}): Promise<NormalizedPluginManifestV2> {
    await fs.mkdir(input.installDir, { recursive: true });
    await fs.writeFile(path.join(input.installDir, "runtime.js"), "export default {};", "utf-8");
    for (const [relativePath, content] of Object.entries(input.files)) {
        const filePath = path.join(input.installDir, ...relativePath.split("/"));
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
    }
    const declared = input.sha256 ?? Object.fromEntries(
        Object.entries(input.files).map(([relativePath, content]) => [relativePath, sha256OfText(content)]),
    );
    return {
        manifestVersion: 2,
        id: SIDECAR_PLUGIN_ID,
        name: "Sidecar Plugin",
        version: "1.0.0",
        entries: { runtime: "runtime.js" },
        contributes: {
            blueprintNodes: [],
            widgets: [],
            tests: [],
            runtimeData: [],
            locales: [],
            runtimeCapabilities: [],
            sidecars: [{
                id: SIDECAR_ID,
                kind: "executable",
                transport: "stdio-jsonl",
                autostart: "onGameStart",
                startupTimeoutMs: 5000,
                shutdownTimeoutMs: 3000,
                restart: { maxRetries: 3, backoffMs: 1000 },
                targets: input.targets
                    ? Object.fromEntries(Object.entries(input.targets).map(([key, target]) => [
                        key,
                        { entry: target.entry, include: target.include, sha256: declared },
                    ]))
                    : {
                        [input.platformKey ?? SIDECAR_PLATFORM_KEY]: {
                            entry: input.entry,
                            include: input.include,
                            sha256: declared,
                        },
                    },
            }],
            buildDependencies: input.buildDependencies ?? [],
            buildConfig: [],
            externalLinks: [],
            network: [],
        },
        permissions: [],
    };
}

/**
 * The fixture package's manifest, read off disk and put through the validator the installer uses.
 * The declarations a build resolves are then the ones a real package would carry, rather than a
 * literal that could drift from what the validator actually accepts.
 */
async function readFixtureManifest(): Promise<NormalizedPluginManifestV2> {
    const manifestPath = path.join(
        // Six levels up is src/; the fixture is shared with the manifest validator's own tests.
        fileURLToPath(new URL("../../../../../../", import.meta.url)),
        "shared", "utils", "__fixtures__", "plugins", BUILD_CONFIG_FIXTURE_ID, "manifest.json",
    );
    const result = validatePluginManifest(JSON.parse(await fs.readFile(manifestPath, "utf-8")));
    if (!result.ok) {
        throw new Error(`fixture manifest is not valid: ${result.error}`);
    }
    return result.manifest;
}

function buildConfigManifest(
    id: string,
    buildConfig: PluginBuildConfigFieldContribution[],
): NormalizedPluginManifestV2 {
    return {
        manifestVersion: 2,
        id,
        name: id,
        version: "1.0.0",
        entries: { runtime: "runtime.js" },
        contributes: {
            blueprintNodes: [],
            widgets: [],
            tests: [],
            runtimeData: [],
            locales: [],
            runtimeCapabilities: [],
            sidecars: [],
            buildDependencies: [],
            buildConfig,
            externalLinks: [],
            network: [],
        },
        permissions: [],
    };
}

/** A plugin package that is nothing but a runtime entry - enough for the compiler to copy. */
async function writeRuntimeOnlyPlugin(
    installDir: string,
    manifest: NormalizedPluginManifestV2,
): Promise<NormalizedPluginManifestV2> {
    await fs.mkdir(installDir, { recursive: true });
    await fs.writeFile(path.join(installDir, "runtime.js"), "export default {};", "utf-8");
    return manifest;
}

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
    await fs.writeFile(path.join(runtimeDistDir, "bindings.js"), "// bindings", "utf-8");
    await fs.writeFile(path.join(runtimeDistDir, "vendor.js"), "// vendor", "utf-8");
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

/**
 * Put an asset id where a page stores one, so the sweep that decides what ships can see it.
 *
 * `assetId` rather than an arbitrary key: the property names a document stores a library id under
 * are one list (`UI_ASSET_ID_PROPERTY_NAMES`), and a fixture that referenced an asset by a name no
 * reader knows would pass for a reason the product does not have.
 */
async function referenceAssetFromRootSurface(projectPath: string, assetId: string): Promise<void> {
    const uidocPath = path.join(projectPath, "editor", "ui", "uidoc.json");
    const uidoc = JSON.parse(await fs.readFile(uidocPath, "utf-8"));
    uidoc.elements.root.props = { ...uidoc.elements.root.props, assetId };
    await fs.writeFile(uidocPath, JSON.stringify(uidoc), "utf-8");
}

async function createMinimalProject(
    projectPath: string,
    options: {
        assets?: Record<string, unknown>;
        blueprintDocument?: Record<string, unknown>;
        app?: Record<string, unknown>;
    } = {},
): Promise<void> {
    await fs.mkdir(path.join(projectPath, "editor", "ui"), { recursive: true });
    await fs.mkdir(path.join(projectPath, "assets"), { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "Fixture Project.nlproj"),
        encodeProjectConfig({
            name: "Fixture Project",
            identifier: "fixture.project",
            ...(options.app ? { app: options.app } : {}),
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
        }) as unknown as Uint8Array,
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

/**
 * A model bundle asset: a directory of files under the storage id, plus the metadata shard that
 * declares it and names its entry file. Appends to the shard so several can live in one project.
 */
async function writeModelBundle(
    projectPath: string,
    assetId: string,
    modelEntry: string,
    files: Record<string, string>,
): Promise<void> {
    const [a, b, rest] = splitAssetStorageId(assetId);
    const bundleDir = path.join(projectPath, "assets", "content", a, b, rest);
    for (const [relative, content] of Object.entries(files)) {
        const target = path.join(bundleDir, ...relative.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, "utf-8");
    }
    const shard = path.join(projectPath, "assets", "assets.metadata.model.json");
    const existing = await fs.readFile(shard, "utf-8").then(JSON.parse).catch(() => ({}));
    await fs.writeFile(shard, JSON.stringify({
        ...existing,
        [assetId]: {
            id: assetId,
            name: modelEntry.split("/").pop(),
            source: "local",
            extras: { modelEntry },
        },
    }), "utf-8");
}

async function writeProjectIcon(projectPath: string, content: string): Promise<void> {
    const dir = path.join(projectPath, "resources", "icons");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `app-icon-${CURRENT_ICON_PLATFORM}.png`), content, "utf-8");
}

/** Every file under `root`, so an assertion can be made about the artifact rather than about one file in it. */
async function listFilesRecursively(root: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            found.push(...await listFilesRecursively(full));
        } else if (entry.isFile()) {
            found.push(full);
        }
    }
    return found;
}

/** A real UUID v4: the story reader refuses any id that is not one, exactly as the packer does. */
const WEATHER_STORY_ID = "6f1b5c2e-4d3a-4a71-9c88-0b2e5a7d1f04";

/** One story whose scene starts each named seed, written where the bundle assembler reads it. */
async function writeWeatherStory(projectPath: string, seeds: readonly WeatherSeedRef[]): Promise<void> {
    const blocks = seeds.map((seed, index) => ({
        id: `vfx-${index}`,
        parentId: null,
        childrenIds: [],
        kind: "nodeAction",
        payload: { action: "vfx", operation: "create", objectName: `weather-${index}`, seed },
    }));
    const document = {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: WEATHER_STORY_ID,
        name: "Weather Story",
        chapters: [{ id: "chapter-1", name: "Chapter 1", sceneIds: ["scene-1"] }],
        entrySceneId: "scene-1",
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene 1",
                runtimeName: "scene_1",
                rootBlockIds: blocks.map(block => block.id),
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
        },
    };
    const storyDir = path.join(projectPath, "editor", "story", "stories", WEATHER_STORY_ID);
    await fs.mkdir(storyDir, { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "editor", "story", "index.json"),
        JSON.stringify({ stories: [{ id: WEATHER_STORY_ID, name: "Weather Story" }] }),
        "utf-8",
    );
    await fs.writeFile(path.join(storyDir, "storydoc.json"), JSON.stringify(document), "utf-8");
}

/**
 * The clips a pack carries, and the ones it does not.
 *
 * A weather clip is the one asset whose id no shipped byte contains: the running game computes it
 * from the seed and the stage size. Nothing downstream could notice it missing, which is why the two
 * halves of that computation are pinned here against each other rather than each against a literal.
 */
describe("weather clips in the pack", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-runtime-weather-"));
    });

    afterEach(async () => {
        /*
         * Tolerated, and only here. A compile that builds a codec for its title
         * loads the result to seal with, and Windows will not unlink a loaded
         * image - so the working copy outlives this suite. A real build has the
         * same lock and does not care: the compile runs in a utility process that
         * exits, and the next build finds nothing held. Failing the run over a
         * temporary directory would report a locked file as a broken compiler.
         */
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    });

    it("carries a produced clip under the id the running game asks for", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await writeWeatherStory(projectPath, [{ seed: "snow" }]);

        const clipPath = path.join(tempDir, "snow.webm");
        await fs.writeFile(clipPath, "webm bytes", "utf-8");
        // The id the host will compute at play time, derived the same way the packer derives it:
        // the fixture's only surface is 1280x720, so that is the stage this clip covers.
        const expectedId = weatherClipAssetId(weatherSpecForStage(
            { seed: "snow" },
            { surfaces: [{ kind: "appSurface", designSize: { width: 1280, height: 720 } }] } as never,
            undefined,
        ));

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47321),
            weatherClips: [{ id: expectedId, path: clipPath }],
        });

        const pack = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        const entry = pack.assets.items[expectedId];
        expect(entry).toMatchObject({ id: expectedId, type: "video", ext: "webm", mimeType: "video/webm" });
        await expect(fs.readFile(path.join(result.appDir, entry.relativePath), "utf-8")).resolves.toBe("webm bytes");
    });

    it("leaves out a clip no story in the pack reaches", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await writeWeatherStory(projectPath, [{ seed: "snow" }]);

        const clipPath = path.join(tempDir, "rain.webm");
        await fs.writeFile(clipPath, "webm bytes", "utf-8");
        const unreachedId = weatherClipAssetId(weatherSpecForStage({ seed: "rain" }, undefined, undefined));

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47321),
            weatherClips: [{ id: unreachedId, path: clipPath }],
        });

        const pack = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(pack.assets.items[unreachedId]).toBeUndefined();
        await expect(fs.readdir(path.join(result.appDir, "assets"))).resolves.not.toContain("rain.webm");
    });
    it("addresses the clip at the rate the project states, not at the default", async () => {
        // The rate is half of a clip's identity. If the packer narrowed by ids computed at 30
        // while the game asked at 60, every build of a project that raised the rate would ship
        // a file nothing opens and play the scene with no weather and no error.
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath, { app: { vfx: { frameRate: 60 } } });
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await writeWeatherStory(projectPath, [{ seed: "snow" }]);

        const clipPath = path.join(tempDir, "snow-60.webm");
        await fs.writeFile(clipPath, "webm bytes", "utf-8");
        const stage = { surfaces: [{ kind: "appSurface", designSize: { width: 1280, height: 720 } }] } as never;
        const atSixty = weatherClipAssetId(weatherSpecForStage({ seed: "snow" }, stage, { frameRate: 60 }));
        const atThirty = weatherClipAssetId(weatherSpecForStage({ seed: "snow" }, stage, undefined));
        expect(atSixty).not.toBe(atThirty);

        const result = await compileGameRuntimeArtifact({
            ...previewCompileInput(projectPath, runtimeDistDir, 47321),
            weatherClips: [{ id: atSixty, path: clipPath }, { id: atThirty, path: clipPath }],
        });

        const pack = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(pack.assets.items[atSixty]).toMatchObject({ id: atSixty, type: "video" });
        expect(pack.assets.items[atThirty]).toBeUndefined();
    });


    it("leaves an asset nothing references out of a package, whatever edition it is", async () => {
        // The release edition included. A build that removes no scene still carries a library sized
        // for everything the author ever imported, and a package is public the moment someone opens
        // it - so what ships is what the bytes name, in every edition.
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath, {
            assets: {
                [ASSET_ID]: { id: ASSET_ID, name: "hero.png", ext: ".png", source: "local" },
                [UNUSED_ASSET_ID]: { id: UNUSED_ASSET_ID, name: "spare.png", ext: ".png", source: "local" },
            },
        });
        await writeAsset(projectPath, ASSET_ID, "referenced bytes");
        await writeAsset(projectPath, UNUSED_ASSET_ID, "unreferenced bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await referenceAssetFromRootSurface(projectPath, ASSET_ID);

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            packaging: true,
        });

        const pack = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(pack.assets.items[ASSET_ID]).toBeDefined();
        expect(pack.assets.items[UNUSED_ASSET_ID]).toBeUndefined();
        // The bytes, not just the manifest: an entry can be dropped from the listing while the file
        // is still sitting in the package, which is the failure this whole pass exists to prevent.
        await expect(
            fs.readFile(path.join(result.appDir, "assets", `${UNUSED_ASSET_ID}.png`), "utf-8"),
        ).rejects.toThrow();

        const report = result.assetReport;
        expect(report?.included.map(entry => entry.id)).toEqual([ASSET_ID]);
        expect(report?.excluded.map(entry => entry.name)).toEqual(["spare.png"]);
        expect(report?.excluded[0].bytes).toBe("unreferenced bytes".length);
        expect(report?.excludedBytes).toBe("unreferenced bytes".length);
    });

    /*
     * A C toolchain, if this machine keeps one. Compiling a codec for a title is
     * the shipping path now, so a test of that path needs a compiler; fetching one
     * would pull 76 MB into a unit test, so it is looked for and the test says so
     * when there is none.
     */
    function localToolchain(): string | null {
        const candidates = [process.env.ZIG, process.platform === "win32" ? "zig.exe" : "zig"]
            .filter((entry): entry is string => Boolean(entry));
        for (const candidate of candidates) {
            try {
                execFileSync(candidate, ["version"], { stdio: "ignore" });
                return candidate;
            } catch {
                continue;
            }
        }
        return null;
    }

    /*
     * The ruling this enforces: a build that cannot compile its codec for the
     * title STOPS. It used to write the material into the prebuilt image and carry
     * on with a warning, which handed the author a package that any copy of the
     * codec package can open, having told them their content was protected.
     */
    it("refuses to build protected content it cannot compile a codec for", async () => {
        const projectPath = path.join(tempDir, "refuses");
        const runtimeDistDir = path.join(tempDir, "runtime-dist-refuses");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeProjectIcon(projectPath, "configured icon bytes");

        await expect(compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            packaging: true,
            platformKeys: ["windows-x64"],
            encryptionKey: derivePackKey(crypto.randomBytes(32), crypto.randomBytes(16)),
            // No toolchain, and nowhere to put one.
        })).rejects.toThrow(/Asset protection needs a C toolchain/);
    });

    /*
     * The defect this replaced: a build packaging for Windows and macOS together
     * wrote one copy of the codec addon, of whichever machine was doing the
     * packaging, and every package but that one shipped an image its loader
     * refuses. It was silent - the build succeeded, the installer was produced,
     * and the game failed on a player's machine at first start.
     */
    it("stages a codec copy for every target a packaged build serves", async () => {
        const toolchain = localToolchain();
        if (!toolchain) {
            // Loud rather than silent: this needs a C toolchain, and a machine
            // without one has not run it. Set ZIG, or put zig on PATH.
            console.warn("[compiler] SKIPPED per-target staging: no C toolchain (set ZIG to run it)");
            return;
        }
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeProjectIcon(projectPath, "configured icon bytes");

        const hostKey = process.platform === "win32" ? "windows-x64" : `${process.platform === "darwin" ? "macos" : "linux"}-${process.arch}`;
        const otherKey = hostKey === "linux-x64" ? "windows-x64" : "linux-x64";
        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            packaging: true,
            platformKeys: [hostKey, otherKey],
            encryptionKey: derivePackKey(crypto.randomBytes(32), crypto.randomBytes(16)),
            titleCompiler: toolchain as string,
        });

        // Nothing at the app root: the packaging step is what puts one there, and
        // a copy sitting at the root would ship to every package unconditionally.
        await expect(fs.access(path.join(result.appDir, ARCHIVE_READER_FILENAME))).rejects.toThrow();

        const staged = await Promise.all([hostKey, otherKey].map(key =>
            fs.readFile(path.join(result.appDir, "platform", key, ARCHIVE_READER_FILENAME))));

        /*
         * And it says which protection it produced. This compile was given no
         * cache directory, so there is nowhere to put a toolchain and the codec
         * ships as built - a working protected build, but one a published copy of
         * the codec package can open. An author who asked for protection is told
         * that rather than left to assume the stronger answer.
         */
        expect(result.codecCompiledForTitle).toBe(true);

        /*
         * And it hands over a copy this machine can open. Something has to read
         * the store back - the shipped-content audit does, on every narrowed
         * build - and once the shipped copies are staged per target, one of them
         * may be for another machine and none of them is at the path that used to
         * be searched. The first real build after that change failed exactly
         * there, so the path is part of the result now rather than assumed.
         */
        expect(result.codecHostImage).toBeTruthy();
        await expect(fs.access(result.codecHostImage as string)).resolves.toBeUndefined();
        // Outside the app dir: it is a working file, not something a player receives.
        expect(path.relative(result.appDir, result.codecHostImage as string).startsWith("..")).toBe(true);
        // Different machines, so different images - the assertion the old code
        // would have failed, since it wrote the same bytes to both.
        expect(staged[0].equals(staged[1])).toBe(false);

        /*
         * And they are bound to ONE store: the copy staged for this machine opens
         * what this compile sealed, which is what lets one compile serve packages
         * for several machines at once.
         *
         * Everywhere but Windows. Loading the copy pins the file, and Windows will
         * not delete a pinned one - the temporary tree then outlives the test and
         * the suite fails on the way out rather than on the assertion. It is the
         * same lock that makes the shipped binary a copy rather than the built
         * file. The property holds on both, and the codec package's own suite
         * checks it for every target on whichever machine runs it.
         */
        if (process.platform !== "win32") {
            const reader = await openAssetArchive(
                path.join(result.appDir, "platform", hostKey, ARCHIVE_READER_FILENAME),
                path.join(result.appDir, ASSET_ARCHIVE_FILENAME),
            );
            try {
                const sealedPack = JSON.parse((await reader.read("pack")).toString("utf-8"));
                expect(sealedPack.entry.surfaceId).toBe("surface-main");
            } finally {
                await reader.close();
            }
        }
    });

    it("carries the library whole for a preview, and reports nothing about it", async () => {
        // The audit that proves a narrowed package still reaches every asset it needs runs exactly
        // where a report is present, so a compile that narrows nothing must produce none.
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath, {
            assets: {
                [ASSET_ID]: { id: ASSET_ID, name: "hero.png", ext: ".png", source: "local" },
                [UNUSED_ASSET_ID]: { id: UNUSED_ASSET_ID, name: "spare.png", ext: ".png", source: "local" },
            },
        });
        await writeAsset(projectPath, ASSET_ID, "referenced bytes");
        await writeAsset(projectPath, UNUSED_ASSET_ID, "unreferenced bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");

        const result = await compileGameRuntimeArtifact(
            previewCompileInput(projectPath, runtimeDistDir, 47331),
        );

        const pack = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        expect(pack.assets.items[UNUSED_ASSET_ID]).toBeDefined();
        expect(result.assetReport).toBeUndefined();
    });

    it("keeps the clip's manifest entry through a production build, where most fields are dropped", async () => {
        // A shipped pack is compiled down to what the runtime needs. `relativePath` is how it finds
        // the file at all, so a stripping pass that took the entry with it would leave a game that
        // starts, plays, and never snows.
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        await createRuntimeDist(runtimeDistDir);
        await createMinimalProject(projectPath);
        await writeAsset(projectPath, ASSET_ID, "local image bytes");
        await writeProjectIcon(projectPath, "configured icon bytes");
        await writeWeatherStory(projectPath, [{ seed: "snow" }]);

        const clipPath = path.join(tempDir, "snow.webm");
        await fs.writeFile(clipPath, "webm bytes", "utf-8");
        const expectedId = weatherClipAssetId(weatherSpecForStage(
            { seed: "snow" },
            { surfaces: [{ kind: "appSurface", designSize: { width: 1280, height: 720 } }] } as never,
            undefined,
        ));

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "build", "staging"),
            mode: "production",
            weatherClips: [{ id: expectedId, path: clipPath }],
        });

        const pack = JSON.parse(await fs.readFile(result.packPath, "utf-8"));
        const entry = pack.assets.items[expectedId];
        expect(entry).toMatchObject({ id: expectedId, ext: "webm", mimeType: "video/webm" });
        await expect(fs.readFile(path.join(result.appDir, entry.relativePath), "utf-8")).resolves.toBe("webm bytes");
    });
});
