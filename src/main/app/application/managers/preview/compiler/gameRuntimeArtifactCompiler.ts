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
    type GameRuntimePackV1,
    type GameRuntimeProjectIcon,
    type GameRuntimeProjectIconPlatform,
} from "@shared/types/gameRuntime";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import {
    createSealedBundle,
    runtimeSupportPath,
    RUNTIME_BUNDLE_FILENAME,
    RUNTIME_KEY_PLACEHOLDER,
    RUNTIME_SUPPORT_FILENAME,
    type SealedBundleWriter,
} from "@narraleaf/encryption";
import {
    GAME_RUNTIME_BUNDLE_PACK_ENTRY,
    gameRuntimeBundleAssetEntry,
    gameRuntimeBundleRuntimeEntry,
} from "@shared/utils/gameRuntimeBundle";
import { readProjectConfigFromDir } from "../../../utils/projectConfigFile";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { getMimeType } from "@shared/utils/fs";
import { sanitizeProjectFileName } from "@shared/utils/nlproj";

const ASSET_TYPES = ["image", "audio", "video", "json", "blueprint", "font", "other"] as const;
// "native.js" is a support module the packaged main.js requires from its own
// directory at startup; it is produced by the runtime build (build-runtime.js)
// and must ship next to main.js in every pack, so it is validated and copied
// like any other required runtime file.
const REQUIRED_RUNTIME_FILES = ["main.js", "native.js", "preload.js", "renderer.js", "renderer.css", "index.html"] as const;
const OPTIONAL_RUNTIME_FILES = ["main.js.map", "preload.js.map", "renderer.js.map", "renderer.css.map"] as const;

export type GameRuntimePluginSource = {
    manifest: NormalizedPluginManifestV2;
    /** Manifest-declared runtime entry, normalized to forward slashes. */
    entry: string;
    /** Absolute path of the built runtime entry file inside the install dir. */
    entryPath: string;
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
     * Pack build mode. "preview" keeps developer affordances (DevTools);
     * "production" hardens the runtime. Defaults to "preview".
     */
    mode?: "preview" | "production";
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

type ProjectIconConfigRecord = {
    path?: unknown;
    sourceName?: unknown;
    mediaType?: unknown;
    updatedAt?: unknown;
};

export async function compileGameRuntimeArtifact(
    input: GameRuntimeArtifactCompileInput,
): Promise<GameRuntimeArtifactCompileResult> {
    const mode = input.mode ?? "preview";
    if (mode === "preview" && !input.preview) {
        throw new Error("Preview artifact compile requires a preview control channel");
    }
    if (mode === "production" && input.preview) {
        throw new Error("Production artifact compile must not carry a preview control channel");
    }
    const outputRoot = input.outputRoot;
    const appDir = path.join(outputRoot, "app");
    const userDataDir = mode === "preview" ? path.join(outputRoot, "userData") : null;
    const assetsDir = path.join(appDir, "assets");

    await assertRuntimeDistReady(input.runtimeDistDir);
    await fs.rm(appDir, { recursive: true, force: true });
    if (!input.encryptionKey) {
        // Loose items live under assets/; the sealed store needs no such dir.
        await fs.mkdir(assetsDir, { recursive: true });
    }
    if (userDataDir) {
        await fs.mkdir(userDataDir, { recursive: true });
    }
    await copyRuntimeFiles(input.runtimeDistDir, appDir);
    if (input.encryptionKey) {
        // Protection on: prepare the packed runtime and ship its support binary.
        await embedPackKey(appDir, input.encryptionKey);
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
        ? { kind: "sealed", writer: await createSealedBundle(path.join(appDir, RUNTIME_BUNDLE_FILENAME), input.encryptionKey) }
        : { kind: "loose" };

    try {
        const assetManifest = await copyProjectAssets({
            projectPath: input.projectPath,
            assetsDir,
            target,
        });
        const projectIcon = await copyProjectIcon({
            projectPath: input.projectPath,
            appDir,
            projectConfig,
        });
        const packPlugins = await copyRuntimePlugins({
            appDir,
            runtimePlugins: input.runtimePlugins ?? [],
            target,
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
            network: {
                // Secure default: HTTP is only permitted when the project explicitly
                // opts in via app.network.allowHttp. Mirrors normalizeNetworkConfiguration.
                allowHttp: (projectConfig?.app as { network?: { allowHttp?: unknown } } | undefined)?.network?.allowHttp === true,
            },
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
        await fs.writeFile(
            path.join(appDir, "package.json"),
            JSON.stringify(buildAppManifest(mode, input.runtimeVersion, pack, projectConfig), null, 2),
            "utf-8",
        );

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
 * open. Production identity fields drive the shell's app name — and with it
 * the default OS userData location — plus the packager's product metadata.
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

async function assertRuntimeDistReady(runtimeDistDir: string): Promise<void> {
    const missing: string[] = [];
    for (const fileName of REQUIRED_RUNTIME_FILES) {
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
}

async function copyRuntimeFiles(runtimeDistDir: string, appDir: string): Promise<void> {
    await fs.mkdir(appDir, { recursive: true });
    for (const fileName of REQUIRED_RUNTIME_FILES) {
        await fs.copyFile(path.join(runtimeDistDir, fileName), path.join(appDir, fileName));
    }
    for (const fileName of OPTIONAL_RUNTIME_FILES) {
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

/**
 * Apply the pack key to the packed main.js through @narraleaf/encryption's
 * marker. Fails loudly if the marker is absent, meaning the runtime was built
 * without support.
 */
async function embedPackKey(appDir: string, encryptionKey: string): Promise<void> {
    const mainJsPath = path.join(appDir, "main.js");
    const source = await fs.readFile(mainJsPath, "utf-8");
    if (!source.includes(RUNTIME_KEY_PLACEHOLDER)) {
        throw new Error(
            "Runtime main.js is missing a required marker. Rebuild the runtime (\"yarn build:runtime\").",
        );
    }
    const injected = source.split(RUNTIME_KEY_PLACEHOLDER).join(encryptionKey);
    await fs.writeFile(mainJsPath, injected, "utf-8");
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
    runtimePlugins: GameRuntimePluginSource[];
    target: PackTarget;
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
        entries.push({
            manifest: plugin.manifest,
            entryRelativePath: relativePath,
        });
    }
    return entries;
}

async function copyProjectIcon(input: {
    projectPath: string;
    appDir: string;
    projectConfig: ProjectConfigData | null;
}): Promise<GameRuntimeProjectIcon | undefined> {
    const platform = getCurrentProjectIconPlatform();
    const icon = getProjectIconConfig(input.projectConfig, platform);
    if (!icon) {
        return undefined;
    }

    const sourcePath = resolveProjectRelativePath(input.projectPath, icon.path);
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
        originalRelativePath: path.relative(input.projectPath, sourcePath).replace(/\\/g, "/"),
        sourceName: readString(icon.sourceName),
        mediaType: readString(icon.mediaType) ?? getMimeType(targetPath),
    };
}

function getProjectIconConfig(
    projectConfig: ProjectConfigData | null,
    platform: GameRuntimeProjectIconPlatform,
): { path: string; sourceName?: string; mediaType?: string } | null {
    const metadata = projectConfig?.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return null;
    }
    const rawIcons = (metadata as Record<string, unknown>).icons;
    if (!rawIcons || typeof rawIcons !== "object" || Array.isArray(rawIcons)) {
        return null;
    }
    const rawIcon = (rawIcons as Record<string, ProjectIconConfigRecord>)[platform];
    if (!rawIcon || typeof rawIcon !== "object") {
        return null;
    }
    const iconPath = readString(rawIcon.path);
    if (!iconPath) {
        return null;
    }
    return {
        path: iconPath,
        sourceName: readString(rawIcon.sourceName),
        mediaType: readString(rawIcon.mediaType),
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
