import path from "path";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { parseSharedBlueprintAssetJson } from "@shared/blueprint/parseSharedBlueprintAsset";
import type { BlueprintPersistentVariable, SharedBlueprintAsset } from "@shared/types/blueprint/document";
import type { PersistentVariableRuntimeTable, VariableRegistry } from "@shared/types/variables/registry";
import {
    buildPersistentRuntimeTable,
    migrateVariableRegistryToLatest,
    seedRegistryEntriesFromBlueprintPersistent,
} from "@shared/variables/variableRegistryModel";
import type { DevModeBundle, DevModeCharacterSummary, DevModeStoryLibrary } from "@shared/types/devMode";
import type { GameLocalizationBundle } from "@shared/types/localization";
import {
    normalizeLocalizationConfiguration,
    normalizeLocalizationDocument,
    normalizeLocalizationKeysDocument,
} from "@shared/types/localization";
import type { GameVoiceBundle } from "@shared/types/voice";
import { normalizeVoiceConfiguration, normalizeVoiceDocument } from "@shared/types/voice";
import type { StoryAnimationAsset, StoryAnimationIndex, StoryDocument, StoryLibraryEntry, StoryLibraryIndex } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { mapCharacterStoreEntriesToSummaries } from "@shared/utils/characterSummaries";
import { Fs } from "@shared/utils/fs";
import { decodeProjectConfig, findProjectConfigFileName } from "@shared/utils/nlproj";
import { isValidStoryEntityId, isValidStoryId } from "@shared/utils/storyId";
import type { DevModeBundleLoadContext, DevModeBundleSource } from "./types";

/**
 * Assemble a DevModeBundle by reading `editor/ui/uidoc.json` and `uigraphs.json` from disk.
 */
export async function assembleDevModeBundleFromProjectPath(context: DevModeBundleLoadContext): Promise<DevModeBundle> {
    const uidocPath = path.join(context.projectPath, "editor", "ui", "uidoc.json");
    const uigraphsPath = path.join(context.projectPath, "editor", "ui", "uigraphs.json");
    const uidoc = await readJsonFile<UIDocument>(uidocPath);
    const uigraphsRaw = await readJsonFile<UIGraphDocument>(uigraphsPath);
    const uigraphs: UIGraphDocument = {
        ...uigraphsRaw,
        blueprintDocument: migrateBlueprintDocumentToLatest(uigraphsRaw.blueprintDocument),
    };
    const localBlueprints = uigraphs.blueprintDocument;
    const persistentVariables = await loadPersistentVariableTable(context.projectPath, uigraphsRaw.blueprintDocument);
    const sharedBlueprints = await loadSharedBlueprints(context.projectPath);
    const projectIdentifier = await readProjectIdentifier(context.projectPath);
    const storyLibrary = await loadStoryLibrary(context.projectPath);
    const localization = await loadGameLocalization(context.projectPath);
    const voice = await loadGameVoice(context.projectPath);
    return {
        bundleId: context.bundleId,
        revision: context.revision,
        timestamp: new Date().toISOString(),
        ui: {
            uidoc,
            uigraphs,
            localBlueprints,
            sharedBlueprints,
            persistentVariables,
        },
        storyLibrary,
        localization,
        voice,
        compiled: context.compiled,
        blueprintCompiledScripts: context.blueprintCompiledScripts,
        blueprintScriptsCompileOk: context.blueprintScriptsCompileOk ?? true,
        blueprintScriptsCompileErrors: context.blueprintScriptsCompileErrors,
        meta: projectIdentifier ? { projectIdentifier } : undefined,
    };
}

async function readOptionalJsonFile<T>(filePath: string): Promise<T | undefined> {
    const result = await Fs.read(filePath, "utf-8");
    if (!result.ok) {
        return undefined;
    }
    try {
        return JSON.parse(result.data) as T;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Invalid JSON in ${filePath}: ${msg}`);
    }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
    const result = await Fs.read(filePath, "utf-8");
    if (!result.ok) {
        throw new Error(result.error?.message ?? `Failed to read ${filePath}`);
    }
    try {
        return JSON.parse(result.data) as T;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Invalid JSON in ${filePath}: ${msg}`);
    }
}

/**
 * Load blueprint-type assets from metadata shard + content shards (same layout as renderer Assets pipeline).
 */
/**
 * Load the project-level persistent variable registry (M-VAR) and project it to the runtime table the
 * bundle carries. Prefers `editor/variables.json`; if that file is absent (a project opened only in a
 * pre-M-VAR Studio, or a Dev Mode start before the renderer migrated), it seeds from the legacy
 * `persistentVariables` still on the raw blueprint document, so Dev Mode never loses persistent vars.
 */
async function loadPersistentVariableTable(
    projectPath: string,
    rawBlueprintDocument: unknown,
): Promise<PersistentVariableRuntimeTable> {
    const registryPath = path.join(projectPath, "editor", "variables.json");
    const raw = await readOptionalJsonFile<unknown>(registryPath);
    if (raw) {
        return buildPersistentRuntimeTable(migrateVariableRegistryToLatest(raw));
    }
    const legacy = readRawPersistentVariables(rawBlueprintDocument);
    const { entries } = seedRegistryEntriesFromBlueprintPersistent(legacy);
    const registry: VariableRegistry = { schemaVersion: 1, entries };
    return buildPersistentRuntimeTable(registry);
}

function readRawPersistentVariables(blueprintDocument: unknown): Record<string, BlueprintPersistentVariable> | undefined {
    if (typeof blueprintDocument !== "object" || blueprintDocument === null) {
        return undefined;
    }
    const raw = (blueprintDocument as { persistentVariables?: unknown }).persistentVariables;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return undefined;
    }
    return raw as Record<string, BlueprintPersistentVariable>;
}

async function loadSharedBlueprints(projectPath: string): Promise<SharedBlueprintAsset[]> {
    const shardPath = path.join(projectPath, "assets", "assets.metadata.blueprint.json");
    const shardResult = await Fs.read(shardPath, "utf-8");
    if (!shardResult.ok) {
        return [];
    }
    let record: Record<string, unknown>;
    try {
        record = JSON.parse(shardResult.data) as Record<string, unknown>;
    } catch {
        return [];
    }
    const out: SharedBlueprintAsset[] = [];
    for (const assetId of Object.keys(record)) {
        const filePath = resolveAssetContentPath(projectPath, assetId);
        if (!filePath) {
            continue;
        }
        const body = await Fs.read(filePath, "utf-8");
        if (!body.ok) {
            continue;
        }
        try {
            out.push(parseSharedBlueprintAssetJson(body.data));
        } catch {
            // Skip invalid entries so Dev Mode still runs
        }
    }
    return out;
}

async function loadStoryLibrary(projectPath: string): Promise<DevModeStoryLibrary | undefined> {
    const indexPath = path.join(projectPath, "editor", "story", "index.json");
    const index = await readOptionalJsonFile<StoryLibraryIndex>(indexPath);
    if (!index) {
        return undefined;
    }
    const documents: Record<string, StoryDocument> = {};
    const stories: StoryLibraryEntry[] = [];
    const seen = new Set<string>();
    for (const entry of Array.isArray(index.stories) ? index.stories : []) {
        if (!isValidStoryId(entry.id) || seen.has(entry.id)) {
            continue;
        }
        seen.add(entry.id);
        const documentPath = resolveStoryDocumentPathForIndexEntry(projectPath, entry);
        if (!documentPath) {
            continue;
        }
        const document = await readJsonFile<StoryDocument>(documentPath);
        if (document.id !== entry.id) {
            throw new Error(`Story document id mismatch: expected ${entry.id}, received ${document.id}`);
        }
        documents[entry.id] = document;
        stories.push({
            ...entry,
            documentPath: storyDocumentRelativePath(entry.id),
        });
    }
    const normalizedIndex: StoryLibraryIndex = {
        ...index,
        stories,
    };
    if (index.defaultStoryId && stories.some(story => story.id === index.defaultStoryId)) {
        normalizedIndex.defaultStoryId = index.defaultStoryId;
    } else {
        delete normalizedIndex.defaultStoryId;
    }
    return {
        index: normalizedIndex,
        documents,
        characters: await loadCharacterSummaries(projectPath),
        animations: await loadStoryAnimations(projectPath),
    };
}

export function resolveStoryDocumentPathForIndexEntry(projectPath: string, entry: Pick<StoryLibraryEntry, "id">): string | null {
    if (!isValidStoryId(entry.id)) {
        return null;
    }
    return path.join(projectPath, "editor", "story", "stories", entry.id, "storydoc.json");
}

function storyDocumentRelativePath(storyId: string): string {
    return `editor/story/stories/${storyId}/storydoc.json`;
}

async function loadStoryAnimations(projectPath: string): Promise<Record<string, StoryAnimationAsset>> {
    const indexPath = path.join(projectPath, "editor", "story", "animations", "index.json");
    const index = await readOptionalJsonFile<StoryAnimationIndex>(indexPath);
    if (!index) {
        return {};
    }
    const animations: Record<string, StoryAnimationAsset> = {};
    const seen = new Set<string>();
    for (const entry of Array.isArray(index.animations) ? index.animations : []) {
        if (!isValidStoryEntityId(entry.id) || seen.has(entry.id)) {
            continue;
        }
        seen.add(entry.id);
        const animationPath = path.join(projectPath, "editor", "story", "animations", `${entry.id}.json`);
        const animation = await readOptionalJsonFile<StoryAnimationAsset>(animationPath);
        if (!animation || animation.id !== entry.id) {
            continue;
        }
        animations[entry.id] = animation;
    }
    return animations;
}

async function loadCharacterSummaries(projectPath: string): Promise<DevModeCharacterSummary[]> {
    const storePath = path.join(projectPath, "editor", "services", "character.json");
    const store = await readOptionalJsonFile<{ characters?: unknown[] }>(storePath);
    const characters = Array.isArray(store?.characters) ? store.characters : [];
    return mapCharacterStoreEntriesToSummaries(characters);
}

async function readProjectConfigRecord(projectPath: string): Promise<Record<string, unknown> | undefined> {
    try {
        const entriesResult = await Fs.dirEntries(projectPath);
        if (!entriesResult.ok) {
            return undefined;
        }
        const configFileName = findProjectConfigFileName(entriesResult.data.map(entry => ({
            name: path.parse(entry.name).name,
            ext: path.extname(entry.name) || null,
            type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
        })));
        if (!configFileName) {
            return undefined;
        }
        const configPath = path.join(projectPath, configFileName);
        if (configFileName.endsWith(".nlproj")) {
            const result = await Fs.readRaw(configPath);
            if (!result.ok) {
                return undefined;
            }
            return decodeProjectConfig(result.data) as unknown as Record<string, unknown>;
        }
        return await readJsonFile<Record<string, unknown>>(configPath);
    } catch {
        return undefined;
    }
}

async function readProjectIdentifier(projectPath: string): Promise<string | undefined> {
    const config = await readProjectConfigRecord(projectPath);
    const id = config?.identifier;
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

/**
 * Load the game localization payload: config from `.nlproj` `app.localization`
 * plus per-locale translation tables from `editor/localization/<code>.json`.
 * Broken or missing files degrade silently - localization must never block a
 * Dev Mode start or a pack. Returns undefined when the project has no setup.
 * Exported for tests.
 */
export async function loadGameLocalization(projectPath: string): Promise<GameLocalizationBundle | undefined> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    const localization = normalizeLocalizationConfiguration(app?.localization);
    if (!localization.sourceLocale || localization.locales.length === 0) {
        return undefined;
    }
    const tables: Record<string, Record<string, string>> = {};
    for (const locale of localization.locales) {
        if (locale.code === localization.sourceLocale) {
            continue;
        }
        let raw: unknown;
        try {
            raw = await readOptionalJsonFile<unknown>(
                path.join(projectPath, "editor", "localization", `${locale.code}.json`),
            );
        } catch {
            continue;
        }
        if (!raw) {
            continue;
        }
        const document = normalizeLocalizationDocument(raw, locale.code);
        const table: Record<string, string> = {};
        for (const [unitId, unit] of Object.entries(document.units)) {
            if (unit.target) {
                table[unitId] = unit.target;
            }
        }
        if (Object.keys(table).length > 0) {
            tables[locale.code] = table;
        }
    }
    let keys: Record<string, string> | undefined;
    try {
        const rawKeys = await readOptionalJsonFile<unknown>(
            path.join(projectPath, "editor", "localization", "keys.json"),
        );
        if (rawKeys) {
            const keysDocument = normalizeLocalizationKeysDocument(rawKeys);
            const entries = Object.entries(keysDocument.keys);
            if (entries.length > 0) {
                keys = Object.fromEntries(entries.map(([name, definition]) => [name, definition.sourceText]));
            }
        }
    } catch {
        // Broken keys file degrades to no named keys.
    }
    return {
        sourceLocale: localization.sourceLocale,
        locales: localization.locales,
        tables,
        ...(keys ? { keys } : {}),
    };
}

/**
 * Load the game voice payload: config from `.nlproj` `app.voice` plus per-
 * language unit id → asset id tables from `editor/voice/<code>.json`. Only the
 * asset ids travel in the bundle; the compiler resolves them to URLs like every
 * other story asset. Broken or missing files degrade silently - voice must
 * never block a Dev Mode start or a pack. Returns undefined when the project has
 * no voice set up. Exported for tests.
 */
export async function loadGameVoice(projectPath: string): Promise<GameVoiceBundle | undefined> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    const voice = normalizeVoiceConfiguration(app?.voice);
    if (voice.voicedLocales.length === 0) {
        return undefined;
    }
    const tables: Record<string, Record<string, string>> = {};
    for (const locale of voice.voicedLocales) {
        let raw: unknown;
        try {
            raw = await readOptionalJsonFile<unknown>(
                path.join(projectPath, "editor", "voice", `${locale.code}.json`),
            );
        } catch {
            continue;
        }
        if (!raw) {
            continue;
        }
        const document = normalizeVoiceDocument(raw, locale.code);
        const table: Record<string, string> = {};
        for (const [unitId, unit] of Object.entries(document.units)) {
            if (unit.assetId) {
                table[unitId] = unit.assetId;
            }
        }
        if (Object.keys(table).length > 0) {
            tables[locale.code] = table;
        }
    }
    return {
        voicedLocales: voice.voicedLocales,
        tables,
    };
}

function resolveAssetContentPath(projectPath: string, assetId: string): string | null {
    try {
        const [a, b, rest] = splitAssetStorageId(assetId);
        return path.join(projectPath, "assets", "content", a, b, rest);
    } catch {
        return null;
    }
}

/** Default bundle source: project files on disk. */
export const devModeDiskBundleSource: DevModeBundleSource = {
    kind: "disk",
    load(context) {
        return assembleDevModeBundleFromProjectPath(context);
    },
};
