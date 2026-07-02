import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { assembleDevModeBundleFromProjectPath } from "../../devMode/pipeline/bundleAssembler";
import { compileAllBlueprintScriptsForProject } from "../../devMode/compiler/blueprint/compileProjectBlueprintScripts";
import {
    GAME_RUNTIME_PACK_SCHEMA_VERSION,
    type GameRuntimeAssetManifestEntry,
    type GameRuntimeLaunchEntry,
    type GameRuntimePackV1,
    type GameRuntimeProjectIcon,
    type GameRuntimeProjectIconPlatform,
} from "@shared/types/gameRuntime";
import { decodeProjectConfig, findProjectConfigFileName, type ProjectConfigData } from "@shared/utils/nlproj";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { getMimeType } from "@shared/utils/fs";

const ASSET_TYPES = ["image", "audio", "video", "json", "blueprint", "font", "other"] as const;
const REQUIRED_RUNTIME_FILES = ["main.js", "preload.js", "renderer.js", "renderer.css", "index.html"] as const;
const OPTIONAL_RUNTIME_FILES = ["main.js.map", "preload.js.map", "renderer.js.map", "renderer.css.map"] as const;

export type GameRuntimeArtifactCompileInput = {
    projectPath: string;
    entry: GameRuntimeLaunchEntry;
    runtimeDistDir: string;
    runtimeVersion: string;
    controlPort: number;
    controlToken: string;
};

export type GameRuntimeArtifactCompileResult = {
    previewRoot: string;
    appDir: string;
    userDataDir: string;
    packPath: string;
    pack: GameRuntimePackV1;
    copiedAssetCount: number;
};

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

export async function compileGameRuntimePreviewArtifact(
    input: GameRuntimeArtifactCompileInput,
): Promise<GameRuntimeArtifactCompileResult> {
    const previewRoot = path.join(input.projectPath, ".nlstudio", "preview");
    const appDir = path.join(previewRoot, "app");
    const userDataDir = path.join(previewRoot, "userData");
    const assetsDir = path.join(appDir, "assets");

    await assertRuntimeDistReady(input.runtimeDistDir);
    await fs.rm(appDir, { recursive: true, force: true });
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.mkdir(userDataDir, { recursive: true });
    await copyRuntimeFiles(input.runtimeDistDir, appDir);

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
    const assetManifest = await copyProjectAssets({
        projectPath: input.projectPath,
        assetsDir,
    });
    const projectIcon = await copyProjectIcon({
        projectPath: input.projectPath,
        appDir,
        projectConfig,
    });

    const pack: GameRuntimePackV1 = {
        schemaVersion: GAME_RUNTIME_PACK_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        mode: "preview",
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
        preview: {
            controlPort: input.controlPort,
            controlToken: input.controlToken,
        },
    };

    const packPath = path.join(appDir, "pack.json");
    await fs.writeFile(packPath, JSON.stringify(pack), "utf-8");
    await fs.writeFile(
        path.join(appDir, "package.json"),
        JSON.stringify({
            name: "narraleaf-preview-runtime",
            version: input.runtimeVersion,
            private: true,
            main: "main.js",
        }, null, 2),
        "utf-8",
    );

    return {
        previewRoot,
        appDir,
        userDataDir,
        packPath,
        pack,
        copiedAssetCount: Object.keys(assetManifest).length,
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

async function copyProjectAssets(input: {
    projectPath: string;
    assetsDir: string;
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
            const relativePath = path.join("assets", `${normalized.id}.${normalized.ext}`).replace(/\\/g, "/");
            const targetPath = path.join(input.assetsDir, `${normalized.id}.${normalized.ext}`);
            await fs.copyFile(sourcePath, targetPath).catch(error => {
                const sourceLabel = normalized.source === "remote" ? "remote cache" : "local asset";
                throw new Error(
                    `Failed to copy ${sourceLabel} "${normalized.name}" (${normalized.id}) from ${sourcePath}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
            });
            manifest[normalized.id] = {
                id: normalized.id,
                type,
                name: normalized.name,
                source: normalized.source === "remote" ? "remote-cache" : "local",
                relativePath,
                originalRelativePath: path.relative(input.projectPath, sourcePath).replace(/\\/g, "/"),
                hash: normalized.hash,
                ext: normalized.ext,
                mimeType: getMimeType(targetPath),
            };
        }
    }
    return manifest;
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
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const configFileName = findProjectConfigFileName(entries.map(entry => ({
        name: path.parse(entry.name).name,
        ext: path.extname(entry.name) || null,
        type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
    })));
    if (!configFileName) {
        return null;
    }
    const configPath = path.join(projectPath, configFileName);
    if (configFileName.endsWith(".nlproj")) {
        return decodeProjectConfig(await fs.readFile(configPath));
    }
    return readJson<ProjectConfigData>(configPath);
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
