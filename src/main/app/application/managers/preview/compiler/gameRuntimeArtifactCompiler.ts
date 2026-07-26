import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { assembleDevModeBundleFromProjectPath } from "../../devMode/pipeline/bundleAssembler";
import { compileAllBlueprintScriptsForProject } from "../../devMode/compiler/blueprint/compileProjectBlueprintScripts";
import {
    GAME_RUNTIME_PACK_SCHEMA_VERSION,
    type GameRuntimeAssetManifestEntry,
    type GameRuntimeLaunchEntry,
    type GameRuntimePackPluginEntry,
    type GameRuntimePackSidecarEntry,
    type GameRuntimePackV1,
    type GameRuntimeProjectIcon,
    type GameRuntimeProjectIconPlatform,
} from "@shared/types/gameRuntime";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import { readProjectIconSet, resolveIconFile, resolveIconSource } from "@shared/types/projectIcons";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import {
    createSealedBundle,
    runtimeSupportPath,
    RUNTIME_BUNDLE_FILENAME,
    RUNTIME_SUPPORT_FILENAME,
    type SealedBundleWriter,
} from "@narraleaf/encryption";
import {
    GAME_RUNTIME_BUNDLE_PACK_ENTRY,
    gameRuntimeBundleAssetEntry,
    gameRuntimeBundleRuntimeEntry,
} from "@shared/utils/gameRuntimeBundle";
import { readProjectConfigFromDir } from "../../../utils/projectConfigFile";
import { readPublishedPluginData } from "../../pluginRuntimeData";
// Relative rather than "@/": this module is unit-tested, and the test runner
// only aliases "@" to the renderer tree - a value import through it would not
// resolve. (Same reason as preflight.ts.)
import {
    ensurePluginBuildDependency,
    resolveBuildDependencyFile,
} from "../../../../../buildWorker/pluginBuildDependencies";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { getMimeType } from "@shared/utils/fs";
import { sanitizeProjectFileName } from "@shared/utils/nlproj";
import { WEB_APPLE_TOUCH_FILENAME, WEB_FAVICON_FILENAME, writeWebShellFiles } from "./webShell";

const ASSET_TYPES = ["image", "audio", "video", "json", "blueprint", "font", "other"] as const;
// "native.js" and "gate.js" are opaque support modules of @narraleaf/encryption
// that the packaged main.js requires (via computed requires the bundler cannot
// inline) from its own directory at startup; they are produced by the runtime
// build (build-runtime.js) and must ship next to main.js in every pack, so they
// are validated and copied like any other required runtime file. The requires
// run unconditionally at load, so a pack missing either crashes on launch
// regardless of whether asset protection is enabled. Keep this list in sync with
// RUNTIME_SUPPORT_SIDECARS in project/build/build-runtime.js.
const REQUIRED_RUNTIME_FILES = ["main.js", "native.js", "gate.js", "preload.js", "renderer.js", "renderer.css", "index.html"] as const;
// The web shell replaces the Electron trio with the browser bridge bundle; the
// renderer pair is shared verbatim. Its index.html is generated per pack (see
// webShell.ts), not copied from the runtime dist.
const WEB_REQUIRED_RUNTIME_FILES = ["renderer.js", "renderer.css", "web.js"] as const;
const OPTIONAL_RUNTIME_FILES = ["main.js.map", "preload.js.map", "renderer.js.map", "renderer.css.map"] as const;
// Build marker written by project/build/build-runtime.js. It attests that the
// dist was produced by the runtime build script in production mode; it is
// validated before packing and never copied into the app dir.
const RUNTIME_BUILD_MANIFEST_FILENAME = "build-manifest.json";
/** Where sidecar payload lands inside the app dir; mirrored by buildAsarUnpackPatterns. */
const SIDECAR_DIR_NAME = "sidecars";
/**
 * Marks an `include` entry as an artifact of a declared build dependency rather
 * than a file inside the plugin package. Kept in step with the manifest
 * validator's own prefix (pluginManifest.ts), which is where the spelling and
 * the `dep:<id>/<path>` shape are enforced.
 */
const SIDECAR_DEP_INCLUDE_PREFIX = "dep:";

export type GameRuntimePluginSource = {
    manifest: NormalizedPluginManifestV2;
    /** Manifest-declared runtime entry, normalized to forward slashes. */
    entry: string;
    /** Absolute path of the built runtime entry file inside the install dir. */
    entryPath: string;
    /** Absolute path of the plugin package root; sidecar `include` paths resolve against it. */
    installPath: string;
};

export type GameRuntimeArtifactCompileInput = {
    projectPath: string;
    entry: GameRuntimeLaunchEntry;
    runtimeDistDir: string;
    runtimeVersion: string;
    /**
     * Directory the compiled app dir is written under (appDir = outputRoot/app).
     * Preview also keeps its persistent userData dir here; production staging
     * roots hold only the app dir.
     */
    outputRoot: string;
    /**
     * Studio-side control channel embedded in the pack so the workspace can
     * drive the running preview. Required in preview mode; must be absent for
     * production packs (a shipped game exposes no control server).
     */
    preview?: {
        controlPort: number;
        controlToken: string;
    };
    /** Runtime entries of enabled plugins to ship inside the pack. */
    runtimePlugins?: GameRuntimePluginSource[];
    /**
     * `<platform>-<arch>` this app dir's native payload is built for - the key
     * plugin sidecar binaries are declared under. A production build passes the
     * target's key; a preview passes the host's own, so an author can exercise a
     * sidecar without a full build. Absent for web compiles, which ship no
     * sidecars at all (a static site has no process to spawn).
     */
    sidecarPlatformKey?: string;
    /**
     * Studio's own userData directory, used only as the root of the build
     * dependency cache that `dep:` sidecar includes resolve through. Passed in
     * rather than read from Electron because this module also runs off the main
     * process (see compileGameRuntimeArtifactInWorker), where app.getPath is
     * unavailable.
     */
    hostUserDataDir?: string;
    /**
     * Studio's own icon, shipped when the project configures none. Passed in
     * rather than resolved here because this module also runs off the main
     * process, where Electron's resource paths are not available.
     */
    defaultIcon?: {
        path: string;
        /** Pre-flattened variant for the outputs that forbid an alpha channel. */
        opaquePath?: string;
    };
    /**
     * Pack build mode. "preview" keeps developer affordances (DevTools);
     * "production" hardens the runtime. Defaults to "preview".
     */
    mode?: "preview" | "production";
    /**
     * Target shell. "electron" (default) emits the desktop runtime app dir;
     * "web" emits a static site: the shared renderer bundle plus the browser
     * bridge (web.js), a generated relative-URL index.html and the plugin-api
     * modules as real files. Web compiles are production-only and never
     * protected (a static site cannot carry the protection layer).
     */
    shell?: "electron" | "web";
    /**
     * Opaque pack key for asset protection. When set, packaged output is
     * protected via @narraleaf/encryption; when absent, output is written
     * verbatim (protection off).
     */
    encryptionKey?: string;
};

export type GameRuntimeArtifactCompileResult = {
    outputRoot: string;
    appDir: string;
    /** Preview-only saves/persistence dir; production packs use the OS userData path. */
    userDataDir: string | null;
    packPath: string;
    pack: GameRuntimePackV1;
    copiedAssetCount: number;
};

/**
 * Where packaged game payload goes. "loose" writes each item as its own plain
 * file under the app dir (used when protection is off). "sealed" streams every
 * item into a single consolidated store so the packed app dir exposes no
 * per-item files, names, sizes, or types. The compiler builds the same manifest
 * either way; only the destination and the manifest's recorded location differ.
 */
type PackTarget =
    | { kind: "loose" }
    | { kind: "sealed"; writer: SealedBundleWriter };

type AssetMetadataRecord = {
    id?: unknown;
    type?: unknown;
    name?: unknown;
    hash?: unknown;
    ext?: unknown;
    source?: unknown;
};

export async function compileGameRuntimeArtifact(
    input: GameRuntimeArtifactCompileInput,
): Promise<GameRuntimeArtifactCompileResult> {
    const mode = input.mode ?? "preview";
    const shell = input.shell ?? "electron";
    if (mode === "preview" && !input.preview) {
        throw new Error("Preview artifact compile requires a preview control channel");
    }
    if (mode === "production" && input.preview) {
        throw new Error("Production artifact compile must not carry a preview control channel");
    }
    if (shell === "web" && mode !== "production") {
        throw new Error("Web artifact compile is production-only");
    }
    if (shell === "web" && input.encryptionKey) {
        throw new Error("Web artifact compile does not support asset protection");
    }
    const outputRoot = input.outputRoot;
    const appDir = path.join(outputRoot, "app");
    const userDataDir = mode === "preview" ? path.join(outputRoot, "userData") : null;
    const assetsDir = path.join(appDir, "assets");

    await assertRuntimeDistReady(input.runtimeDistDir, shell);
    await fs.rm(appDir, { recursive: true, force: true });
    if (!input.encryptionKey) {
        // Loose items live under assets/; the sealed store needs no such dir.
        await fs.mkdir(assetsDir, { recursive: true });
    }
    if (userDataDir) {
        await fs.mkdir(userDataDir, { recursive: true });
    }
    await copyRuntimeFiles(input.runtimeDistDir, appDir, mode, shell);
    if (input.encryptionKey) {
        // Protection on: ship the support binary. createSealedBundle binds this
        // pack's protection material into it when it opens the store (below), so
        // no key material is handled here or written into any JS.
        await fs.copyFile(runtimeSupportPath(), path.join(appDir, RUNTIME_SUPPORT_FILENAME));
    }

    const projectConfig = await readProjectConfig(input.projectPath);
    const blueprintScripts = await compileAllBlueprintScriptsForProject(input.projectPath);
    if (!blueprintScripts.ok) {
        const detail = blueprintScripts.errors.join("\n") || "TypeScript blueprint compile failed";
        throw new Error(`Blueprint script compile failed:\n${detail}`);
    }
    const bundleId = crypto.randomUUID();
    const bundle = await assembleDevModeBundleFromProjectPath({
        projectPath: input.projectPath,
        bundleId,
        revision: 1,
        blueprintCompiledScripts: blueprintScripts.scripts,
        blueprintScriptsCompileOk: blueprintScripts.ok,
        blueprintScriptsCompileErrors: blueprintScripts.errors,
    });

    // Everything below either writes loose files or streams into the store; on
    // any failure the store handle is released so a failed compile leaks nothing.
    const target: PackTarget = input.encryptionKey
        ? {
            kind: "sealed",
            writer: await createSealedBundle(
                path.join(appDir, RUNTIME_BUNDLE_FILENAME),
                path.join(appDir, RUNTIME_SUPPORT_FILENAME),
            ),
        }
        : { kind: "loose" };

    try {
        const assetManifest = await copyProjectAssets({
            projectPath: input.projectPath,
            assetsDir,
            target,
        });
        // The desktop icon set feeds the window/dock; a web site instead gets
        // a favicon (best-effort - only a configured PNG qualifies).
        const projectIcon = shell === "web"
            ? undefined
            : await copyProjectIcon({
                projectPath: input.projectPath,
                appDir,
                projectConfig,
                defaultIcon: input.defaultIcon,
            });
        const webIcons = shell === "web"
            ? await copyWebIcons({
                projectPath: input.projectPath,
                appDir,
                projectConfig,
                defaultIcon: input.defaultIcon,
            })
            : { hasFavicon: false, hasAppleTouchIcon: false };
        const packPlugins = await copyRuntimePlugins({
            appDir,
            projectPath: input.projectPath,
            runtimePlugins: input.runtimePlugins ?? [],
            target,
            ...(input.sidecarPlatformKey ? { sidecarPlatformKey: input.sidecarPlatformKey } : {}),
            ...(input.hostUserDataDir ? { hostUserDataDir: input.hostUserDataDir } : {}),
        });

        const pack: GameRuntimePackV1 = {
            schemaVersion: GAME_RUNTIME_PACK_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            mode,
            runtimeVersion: input.runtimeVersion,
            project: {
                name: projectConfig?.name?.trim() || path.basename(input.projectPath) || "NarraLeaf Game",
                identifier: projectConfig?.identifier?.trim() || undefined,
                version: readString(projectConfig?.metadata?.version),
                metadata: normalizeRecord(projectConfig?.metadata),
                icon: projectIcon,
            },
            entry: input.entry,
            bundle,
            assets: {
                items: assetManifest,
            },
            plugins: packPlugins,
            // The network policy is a desktop-shell mechanism (CSP + webRequest);
            // a web export is served over HTTP(S) by nature, so its pack carries
            // no policy at all.
            ...(shell === "web" ? {} : {
                network: {
                    // Secure default: HTTP is only permitted when the project explicitly
                    // opts in via app.network.allowHttp. Mirrors normalizeNetworkConfiguration.
                    allowHttp: (projectConfig?.app as { network?: { allowHttp?: unknown } } | undefined)?.network?.allowHttp === true,
                },
            }),
            ...(input.preview ? { preview: input.preview } : {}),
        };

        const packJson = Buffer.from(JSON.stringify(pack), "utf-8");
        let packPath: string;
        if (target.kind === "sealed") {
            await target.writer.add(GAME_RUNTIME_BUNDLE_PACK_ENTRY, packJson);
            await target.writer.finalize();
            packPath = path.join(appDir, RUNTIME_BUNDLE_FILENAME);
        } else {
            packPath = path.join(appDir, "pack.json");
            await fs.writeFile(packPath, packJson);
        }
        if (shell === "web") {
            await writeWebShellFiles({ appDir, pack, ...webIcons });
        } else {
            await fs.writeFile(
                path.join(appDir, "package.json"),
                JSON.stringify(buildAppManifest(mode, input.runtimeVersion, pack, projectConfig), null, 2),
                "utf-8",
            );
        }

        return {
            outputRoot,
            appDir,
            userDataDir,
            packPath,
            pack,
            copiedAssetCount: Object.keys(assetManifest).length,
        };
    } catch (error) {
        if (target.kind === "sealed") {
            // Release the file handle; the partial store is discarded on the next
            // compile (appDir is wiped up front). finalize() is idempotent.
            await target.writer.finalize().catch(() => undefined);
        }
        throw error;
    }
}

/**
 * The loose app manifest Electron reads before any pack (possibly sealed) is
 * open. Production identity fields drive the shell's app name - and with it
 * the default OS userData location - plus the packager's product metadata.
 * `narraleaf.mode` is the early mode marker the runtime consults before
 * app-ready; the pack's own `mode` stays authoritative.
 */
function buildAppManifest(
    mode: "preview" | "production",
    runtimeVersion: string,
    pack: GameRuntimePackV1,
    projectConfig: ProjectConfigData | null,
): Record<string, unknown> {
    const base = {
        private: true,
        main: "main.js",
        narraleaf: { mode },
    };
    if (mode === "preview") {
        return {
            name: "narraleaf-preview-runtime",
            version: runtimeVersion,
            ...base,
        };
    }
    const identifier = readString(projectConfig?.identifier);
    return {
        name: sanitizeProjectFileName(identifier ?? pack.project.name),
        productName: pack.project.name,
        version: pack.project.version ?? "0.0.0",
        description: readString(projectConfig?.metadata?.description),
        author: readString(projectConfig?.metadata?.author) ?? "NarraLeaf",
        ...base,
    };
}

async function assertRuntimeDistReady(runtimeDistDir: string, shell: "electron" | "web"): Promise<void> {
    const missing: string[] = [];
    for (const fileName of shell === "web" ? WEB_REQUIRED_RUNTIME_FILES : REQUIRED_RUNTIME_FILES) {
        try {
            await fs.access(path.join(runtimeDistDir, fileName));
        } catch {
            missing.push(fileName);
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `Runtime build output is missing ${missing.join(", ")}. Run "yarn build:runtime" first.`,
        );
    }
    // Existence is not enough: a dist left behind by an older build script (or a
    // tampered one) could carry development React and ship it inside every pack.
    // build-runtime.js writes this marker on every successful build; anything
    // else is a stale or foreign dist and must be rebuilt, not packed.
    let manifest: { mode?: unknown };
    try {
        manifest = await readJson<{ mode?: unknown }>(path.join(runtimeDistDir, RUNTIME_BUILD_MANIFEST_FILENAME));
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            throw new Error(
                `Runtime build output is missing ${RUNTIME_BUILD_MANIFEST_FILENAME}, so it cannot be ` +
                `verified as a production build. Run "yarn build:runtime" to rebuild it.`,
            );
        }
        throw error;
    }
    if (manifest.mode !== "production") {
        throw new Error(
            `Runtime build output at ${runtimeDistDir} is not a production build ` +
            `(${RUNTIME_BUILD_MANIFEST_FILENAME} reports mode ${JSON.stringify(manifest.mode)}). ` +
            `Run "yarn build:runtime" to rebuild it.`,
        );
    }
}

async function copyRuntimeFiles(
    runtimeDistDir: string,
    appDir: string,
    mode: "preview" | "production",
    shell: "electron" | "web",
): Promise<void> {
    await fs.mkdir(appDir, { recursive: true });
    for (const fileName of shell === "web" ? WEB_REQUIRED_RUNTIME_FILES : REQUIRED_RUNTIME_FILES) {
        await fs.copyFile(path.join(runtimeDistDir, fileName), path.join(appDir, fileName));
    }
    for (const fileName of OPTIONAL_RUNTIME_FILES) {
        // Sourcemaps are a preview-session debugging aid; shipped games leave
        // them out to keep installers smaller and bundle internals unmapped.
        // (Web compiles are production-only, so this loop is a no-op there.)
        if (mode === "production" && fileName.endsWith(".map")) {
            continue;
        }
        await copyOptionalFile(path.join(runtimeDistDir, fileName), path.join(appDir, fileName));
    }
}

async function copyOptionalFile(sourcePath: string, targetPath: string): Promise<void> {
    try {
        await fs.copyFile(sourcePath, targetPath);
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return;
        }
        throw error;
    }
}

async function copyProjectAssets(input: {
    projectPath: string;
    assetsDir: string;
    target: PackTarget;
}): Promise<Record<string, GameRuntimeAssetManifestEntry>> {
    const manifest: Record<string, GameRuntimeAssetManifestEntry> = {};
    for (const type of ASSET_TYPES) {
        const metadataPath = path.join(input.projectPath, "assets", `assets.metadata.${type}.json`);
        const metadata = await readOptionalJson<Record<string, AssetMetadataRecord>>(metadataPath);
        if (!metadata) {
            continue;
        }
        for (const [assetId, rawAsset] of Object.entries(metadata)) {
            const normalized = normalizeAssetRecord(assetId, type, rawAsset);
            const sourcePath = resolveAssetSourcePath(input.projectPath, normalized);
            const sourceLabel = normalized.source === "remote" ? "remote cache" : "local asset";
            // The MIME type is derived from the extension, not from where the
            // bytes land, so it is available even when the store keeps the item
            // under an extension-free name.
            const mimeType = getMimeType(`${normalized.id}.${normalized.ext}`);
            let relativePath: string;
            try {
                if (input.target.kind === "sealed") {
                    // Extension-free entry name: an item's media type is not
                    // recoverable from the store.
                    relativePath = gameRuntimeBundleAssetEntry(normalized.id);
                    await input.target.writer.add(relativePath, await fs.readFile(sourcePath));
                } else {
                    relativePath = path.join("assets", `${normalized.id}.${normalized.ext}`).replace(/\\/g, "/");
                    await fs.copyFile(sourcePath, path.join(input.assetsDir, `${normalized.id}.${normalized.ext}`));
                }
            } catch (error) {
                throw new Error(
                    `Failed to copy ${sourceLabel} "${normalized.name}" (${normalized.id}) from ${sourcePath}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
            }
            manifest[normalized.id] = {
                id: normalized.id,
                type,
                name: normalized.name,
                source: normalized.source === "remote" ? "remote-cache" : "local",
                relativePath,
                originalRelativePath: path.relative(input.projectPath, sourcePath).replace(/\\/g, "/"),
                hash: normalized.hash,
                ext: normalized.ext,
                mimeType,
            };
        }
    }
    return manifest;
}

async function copyRuntimePlugins(input: {
    appDir: string;
    projectPath: string;
    runtimePlugins: GameRuntimePluginSource[];
    target: PackTarget;
    /** Absent on preview and web compiles: those ship no sidecars. */
    sidecarPlatformKey?: string;
    hostUserDataDir?: string;
}): Promise<GameRuntimePackPluginEntry[]> {
    const entries: GameRuntimePackPluginEntry[] = [];
    for (const plugin of input.runtimePlugins) {
        const relativePath = path.posix.join("plugins", plugin.manifest.id, ...plugin.entry.split("/"));
        try {
            if (input.target.kind === "sealed") {
                await input.target.writer.add(gameRuntimeBundleRuntimeEntry(relativePath), await fs.readFile(plugin.entryPath));
            } else {
                const targetPath = path.join(input.appDir, ...relativePath.split("/"));
                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.copyFile(plugin.entryPath, targetPath);
            }
        } catch (error) {
            throw new Error(
                `Failed to copy runtime entry of plugin "${plugin.manifest.id}" from ${plugin.entryPath}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
        }
        const data = await readPublishedPluginData({
            projectPath: input.projectPath,
            manifest: plugin.manifest,
            onWarning: message => console.warn("[gameRuntimeArtifactCompiler]", message),
        });
        const sidecars = input.sidecarPlatformKey
            ? await copyPluginSidecars({
                appDir: input.appDir,
                plugin,
                platformKey: input.sidecarPlatformKey,
                ...(input.hostUserDataDir ? { hostUserDataDir: input.hostUserDataDir } : {}),
            })
            : [];
        entries.push({
            manifest: plugin.manifest,
            entryRelativePath: relativePath,
            ...(data ? { data } : {}),
            ...(sidecars.length > 0 ? { sidecars } : {}),
        });
    }
    return entries;
}

/**
 * Copy one plugin's sidecar payload for the platform this pack is built for.
 *
 * Sidecars are ALWAYS loose files, even when the rest of the pack is sealed.
 * A sidecar is an executable image: the OS loader opens it by path, so it can
 * be neither read out of the protected store nor run from inside the asar, and
 * sealing it would only be a lie about what shipped - the bytes a player can
 * copy out of the app dir are the same either way. (buildAsarUnpackPatterns
 * keeps `sidecars/**` outside the archive for the same reason.)
 *
 * A plugin that declares no target for this platform key is not an error: the
 * contract is that its runtime degrades and `available()` answers false there.
 * Preflight warns the author before they commit to the build; here it is worth
 * only a log line.
 */
async function copyPluginSidecars(input: {
    appDir: string;
    plugin: GameRuntimePluginSource;
    platformKey: string;
    hostUserDataDir?: string;
}): Promise<GameRuntimePackSidecarEntry[]> {
    const { plugin, platformKey } = input;
    const entries: GameRuntimePackSidecarEntry[] = [];
    for (const sidecar of plugin.manifest.contributes.sidecars) {
        const target = sidecar.targets[platformKey];
        if (!target) {
            console.info(
                "[gameRuntimeArtifactCompiler]",
                `plugin "${plugin.manifest.id}" ships no "${sidecar.id}" sidecar for ${platformKey}; ` +
                "it is absent from this build",
            );
            continue;
        }
        const where = `Sidecar "${sidecar.id}" of plugin "${plugin.manifest.id}" (${platformKey})`;
        const sidecarRelativeDir = path.posix.join(SIDECAR_DIR_NAME, plugin.manifest.id, sidecar.id);
        const sidecarDir = path.join(input.appDir, ...sidecarRelativeDir.split("/"));
        for (const include of target.include) {
            const { sourcePath, relativePath } = await resolveSidecarInclude({
                include,
                plugin,
                platformKey,
                target,
                where,
                ...(input.hostUserDataDir ? { hostUserDataDir: input.hostUserDataDir } : {}),
            });
            // The include path is also the path inside the sidecar directory
            // (minus any `dep:<id>/` prefix), so an author who needs a shared
            // library beside the executable says so by declaring it there -
            // through the dependency's own `files` mapping for a `dep:` entry.
            const targetPath = resolveInsideDir(sidecarDir, relativePath, where);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            try {
                await fs.copyFile(sourcePath, targetPath);
            } catch (error) {
                throw new Error(
                    `${where}: could not copy "${include}" from ${sourcePath}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        entries.push({
            id: sidecar.id,
            entry: path.posix.join(sidecarRelativeDir, ...normalizeSidecarPath(target.entry).split("/")),
            kind: sidecar.kind,
            autostart: sidecar.autostart,
            startupTimeoutMs: sidecar.startupTimeoutMs,
            shutdownTimeoutMs: sidecar.shutdownTimeoutMs,
            restart: { ...sidecar.restart },
        });
    }
    return entries;
}

/**
 * Locate the bytes one `include` entry names, and say where they belong inside
 * the sidecar directory.
 *
 * A package-relative file is verified against its declared digest before it is
 * copied. The manifest validator checks the same digests at install time, but a
 * build is the last moment before those bytes reach a player's machine, and an
 * install directory is an ordinary folder anything on the host can rewrite
 * afterwards - so the pack re-verifies rather than trusts the install record.
 * `dep:` artifacts are exempt here because the build dependency cache verified
 * the archive they came out of against its own mandatory digest.
 */
async function resolveSidecarInclude(input: {
    include: string;
    plugin: GameRuntimePluginSource;
    platformKey: string;
    target: { sha256: Record<string, string> };
    where: string;
    hostUserDataDir?: string;
}): Promise<{ sourcePath: string; relativePath: string }> {
    const { include, plugin, platformKey, where } = input;
    if (include.startsWith(SIDECAR_DEP_INCLUDE_PREFIX)) {
        const reference = include.slice(SIDECAR_DEP_INCLUDE_PREFIX.length);
        const separator = reference.indexOf("/");
        const dependencyId = separator === -1 ? reference : reference.slice(0, separator);
        const relativePath = normalizeSidecarPath(separator === -1 ? "" : reference.slice(separator + 1));
        if (!relativePath) {
            throw new Error(`${where}: include "${include}" names no file inside the build dependency`);
        }
        const dependency = plugin.manifest.contributes.buildDependencies.find(item => item.id === dependencyId);
        if (!dependency) {
            throw new Error(`${where}: include "${include}" references undeclared build dependency "${dependencyId}"`);
        }
        const dependencyTarget = dependency.targets[platformKey];
        if (!dependencyTarget) {
            throw new Error(
                `${where}: build dependency "${dependencyId}" declares nothing for ${platformKey}, ` +
                `so "${include}" cannot be shipped`,
            );
        }
        if (!input.hostUserDataDir) {
            // A programming error rather than an author's: whoever asked for a
            // sidecar platform key owes the compile a cache root as well.
            throw new Error(
                `${where}: "${include}" needs the build dependency cache, but no cache root was passed to the compile`,
            );
        }
        const dependencyDir = await ensurePluginBuildDependency({
            userDataDir: input.hostUserDataDir,
            dependencyId,
            platformKey,
            target: dependencyTarget,
            log: (level, message) => console.info(`[gameRuntimeArtifactCompiler] ${level}:`, message),
        });
        return { sourcePath: resolveBuildDependencyFile(dependencyDir, relativePath), relativePath };
    }

    const relativePath = normalizeSidecarPath(include);
    const sourcePath = resolveInsideDir(plugin.installPath, relativePath, where);
    const expected = (input.target.sha256[include] ?? input.target.sha256[relativePath] ?? "").trim().toLowerCase();
    if (!expected) {
        throw new Error(`${where}: no sha256 is declared for "${include}", so it cannot be verified`);
    }
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(sourcePath);
    } catch (error) {
        throw new Error(
            `${where}: could not read "${include}" at ${sourcePath} ` +
            `(${error instanceof Error ? error.message : String(error)})`,
        );
    }
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== expected) {
        throw new Error(
            `${where}: "${include}" has sha256 ${digest}, not the declared ${expected}. ` +
            "The plugin package has been modified since it was installed; reinstall it rather than ship this binary.",
        );
    }
    return { sourcePath, relativePath };
}

/** Zip and manifests speak forward slashes; authors copy paths off a Windows shell. */
function normalizeSidecarPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
}

/**
 * Resolve a forward-slash relative path inside `root`, refusing to escape it.
 * The manifest validator rejects escaping paths already; this is the second
 * lock, because a hand-edited install record must not be able to read or write
 * outside the package and the app dir.
 */
function resolveInsideDir(root: string, relativePath: string, where: string): string {
    const base = path.resolve(root);
    const resolved = path.resolve(base, ...relativePath.split("/").filter(segment => segment.length > 0));
    const relative = path.relative(base, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${where}: "${relativePath}" escapes ${base}`);
    }
    return resolved;
}

async function copyProjectIcon(input: {
    projectPath: string;
    appDir: string;
    projectConfig: ProjectConfigData | null;
    defaultIcon?: { path: string; opaquePath?: string };
}): Promise<GameRuntimeProjectIcon | undefined> {
    const platform = getCurrentProjectIconPlatform();
    const configured = getProjectIconConfig(input.projectConfig, platform);
    // A project with no icon of its own runs under NarraLeaf's mark rather than
    // Electron's default, matching what its packaged build will wear.
    const icon = configured ?? (input.defaultIcon
        ? { path: input.defaultIcon.path, sourceName: path.basename(input.defaultIcon.path), mediaType: "image/png" }
        : null);
    if (!icon) {
        return undefined;
    }

    const sourcePath = configured
        ? resolveProjectRelativePath(input.projectPath, icon.path)
        : icon.path;
    const extension = normalizeExtension(path.extname(icon.path).replace(".", ""), icon.path, "other");
    const relativePath = path.join("icons", `app-icon-${platform}.${extension}`).replace(/\\/g, "/");
    const targetPath = path.join(input.appDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath).catch(error => {
        throw new Error(
            `Failed to copy configured ${platform} project icon from ${sourcePath}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
    });

    return {
        platform,
        relativePath,
        originalRelativePath: configured
            ? path.relative(input.projectPath, sourcePath).replace(/\\/g, "/")
            : relativePath,
        sourceName: readString(icon.sourceName),
        mediaType: readString(icon.mediaType) ?? getMimeType(targetPath),
    };
}

/**
 * The web export's own icons. Web used to have no icon of its own and borrowed
 * whichever desktop slot happened to hold a PNG, so a project that configured
 * only mobile icons shipped no favicon at all.
 *
 * A project that has not baked yet falls back to the master, and is skipped
 * unless that master is already a PNG - the link tags declare image/png and
 * Studio does no conversion on this path.
 */
async function copyWebIcons(input: {
    projectPath: string;
    appDir: string;
    projectConfig: ProjectConfigData | null;
    defaultIcon?: { path: string; opaquePath?: string };
}): Promise<{ hasFavicon: boolean; hasAppleTouchIcon: boolean }> {
    const set = readProjectIconSet(input.projectConfig);
    const copy = async (sourcePath: string, fileName: string): Promise<boolean> => {
        try {
            await fs.copyFile(sourcePath, path.join(input.appDir, fileName));
            return true;
        } catch {
            return false;
        }
    };
    /** The project's own PNG for this output, or null when it has none usable. */
    const projectIcon = (outputId: "web-favicon" | "web-apple-touch"): string | null => {
        const icon = resolveIconFile(set, outputId);
        // Non-PNG is skipped: the link tags declare image/png and this path does
        // no conversion. The un-baked apple-touch case is skipped too - falling
        // back to a master that keeps its transparency would hand Safari the
        // very icon that file exists to avoid, composited onto black.
        if (!icon || !icon.path.toLowerCase().endsWith(".png")) {
            return null;
        }
        if (outputId === "web-apple-touch" && !set.baked["web-apple-touch"]) {
            return null;
        }
        return resolveProjectRelativePath(input.projectPath, icon.path);
    };

    const favicon = projectIcon("web-favicon") ?? input.defaultIcon?.path;
    const appleTouch = projectIcon("web-apple-touch")
        ?? input.defaultIcon?.opaquePath
        ?? input.defaultIcon?.path;
    return {
        hasFavicon: favicon ? await copy(favicon, WEB_FAVICON_FILENAME) : false,
        hasAppleTouchIcon: appleTouch ? await copy(appleTouch, WEB_APPLE_TOUCH_FILENAME) : false,
    };
}

/**
 * The icon file this platform ships, read through the shared model so the
 * legacy five-slot shape and the master model resolve identically here and in
 * the build's preflight.
 */
function getProjectIconConfig(
    projectConfig: ProjectConfigData | null,
    platform: GameRuntimeProjectIconPlatform,
): { path: string; sourceName?: string; mediaType?: string } | null {
    const set = readProjectIconSet(projectConfig);
    const file = resolveIconFile(set, platform);
    if (!file) {
        return null;
    }
    const source = resolveIconSource(set, platform);
    return {
        path: file.path,
        sourceName: source?.sourceName,
        mediaType: file.baked ? "image/png" : source?.mediaType,
    };
}

function getCurrentProjectIconPlatform(): GameRuntimeProjectIconPlatform {
    if (process.platform === "darwin") {
        return "macos";
    }
    if (process.platform === "win32") {
        return "windows";
    }
    return "linux";
}

function resolveProjectRelativePath(projectPath: string, relativePath: string): string {
    const root = path.resolve(projectPath);
    const resolved = path.resolve(root, relativePath.replace(/^[/\\]+/, ""));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Project path escapes project root: ${relativePath}`);
    }
    return resolved;
}

function resolveAssetSourcePath(
    projectPath: string,
    asset: ReturnType<typeof normalizeAssetRecord>,
): string {
    const [a, b, rest] = splitAssetStorageId(asset.id);
    if (asset.source === "remote") {
        return path.join(projectPath, "editor", "assets", "remote", a, b, rest);
    }
    return path.join(projectPath, "assets", "content", a, b, rest);
}

function normalizeAssetRecord(assetId: string, type: string, rawAsset: AssetMetadataRecord) {
    const id = typeof rawAsset?.id === "string" && rawAsset.id.trim() ? rawAsset.id.trim() : assetId;
    splitAssetStorageId(id);
    const name = typeof rawAsset?.name === "string" && rawAsset.name.trim() ? rawAsset.name.trim() : id;
    const source = rawAsset?.source === "remote" ? "remote" : "local";
    const ext = normalizeExtension(
        typeof rawAsset?.ext === "string" ? rawAsset.ext : undefined,
        name,
        type,
    );
    return {
        id,
        type,
        name,
        source,
        ext,
        hash: typeof rawAsset?.hash === "string" && rawAsset.hash ? rawAsset.hash : undefined,
    };
}

function normalizeExtension(rawExt: string | undefined, name: string, type: string): string {
    const candidate = rawExt?.trim() || path.extname(name).replace(".", "");
    const safe = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (safe) {
        return safe.slice(0, 16);
    }
    if (type === "json" || type === "blueprint") {
        return "json";
    }
    return "bin";
}

async function readProjectConfig(projectPath: string): Promise<ProjectConfigData | null> {
    return readProjectConfigFromDir(projectPath);
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
    try {
        return await readJson<T>(filePath);
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function readJson<T>(filePath: string): Promise<T> {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
        return JSON.parse(raw) as T;
    } catch (error) {
        throw new Error(`Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    try {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}
