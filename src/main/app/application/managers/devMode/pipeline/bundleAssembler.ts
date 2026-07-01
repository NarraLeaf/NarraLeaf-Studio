import path from "path";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { parseSharedBlueprintAssetJson } from "@shared/blueprint/parseSharedBlueprintAsset";
import type { SharedBlueprintAsset } from "@shared/types/blueprint/document";
import type { DevModeBundle, DevModeCharacterSummary, DevModeStoryLibrary } from "@shared/types/devMode";
import type { StoryAnimationAsset, StoryAnimationIndex, StoryDocument, StoryLibraryEntry, StoryLibraryIndex } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
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
    const sharedBlueprints = await loadSharedBlueprints(context.projectPath);
    const projectIdentifier = await readProjectIdentifier(context.projectPath);
    const storyLibrary = await loadStoryLibrary(context.projectPath);
    return {
        bundleId: context.bundleId,
        revision: context.revision,
        timestamp: new Date().toISOString(),
        ui: {
            uidoc,
            uigraphs,
            localBlueprints,
            sharedBlueprints,
        },
        storyLibrary,
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
    return characters.flatMap((entry): DevModeCharacterSummary[] => {
        if (!entry || typeof entry !== "object") {
            return [];
        }
        const profile = (entry as { profile?: unknown }).profile;
        if (!profile || typeof profile !== "object") {
            return [];
        }
        const raw = profile as {
            id?: unknown;
            name?: unknown;
            defaultForm?: unknown;
            appearance?: {
                forms?: unknown[];
            };
        };
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        if (!id) {
            return [];
        }
        const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
        const forms = Array.isArray(raw.appearance?.forms)
            ? raw.appearance.forms.flatMap(formEntry => {
                if (!formEntry || typeof formEntry !== "object") {
                    return [];
                }
                const form = formEntry as {
                    name?: unknown;
                    groups?: unknown[];
                    variantAssets?: Record<string, { data?: { id?: unknown; name?: unknown } }>;
                };
                const formName = typeof form.name === "string" && form.name.trim() ? form.name.trim() : "";
                if (!formName) {
                    return [];
                }
                const groups = Array.isArray(form.groups)
                    ? form.groups.flatMap(groupEntry => {
                        if (!groupEntry || typeof groupEntry !== "object") {
                            return [];
                        }
                        const group = groupEntry as { name?: unknown; defaultVariant?: unknown; variants?: unknown[] };
                        const groupName = typeof group.name === "string" && group.name.trim() ? group.name.trim() : "";
                        if (!groupName) {
                            return [];
                        }
                        const variants = Array.isArray(group.variants)
                            ? group.variants.flatMap(variantEntry => {
                                if (!variantEntry || typeof variantEntry !== "object") {
                                    return [];
                                }
                                const variant = variantEntry as { name?: unknown };
                                const variantName = typeof variant.name === "string" && variant.name.trim() ? variant.name.trim() : "";
                                return variantName ? [{ name: variantName }] : [];
                            })
                            : [];
                        return [{
                            name: groupName,
                            defaultVariant: typeof group.defaultVariant === "string" && group.defaultVariant.trim() ? group.defaultVariant.trim() : null,
                            variants,
                        }];
                    })
                    : [];
                const variantAssets = Object.fromEntries(
                    Object.entries(form.variantAssets ?? {}).flatMap(([variantName, variantData]) => {
                        const asset = variantData?.data;
                        const assetId = typeof asset?.id === "string" && asset.id.trim() ? asset.id.trim() : "";
                        if (!assetId) {
                            return [];
                        }
                        return [[variantName, {
                            assetId,
                            name: typeof asset?.name === "string" ? asset.name : undefined,
                        }]];
                    }),
                );
                return [{ name: formName, groups, variantAssets }];
            })
            : [];
        return [{
            id,
            name,
            defaultForm: typeof raw.defaultForm === "string" && raw.defaultForm.trim() ? raw.defaultForm.trim() : null,
            forms,
        }];
    });
}

async function readProjectIdentifier(projectPath: string): Promise<string | undefined> {
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
            const id = decodeProjectConfig(result.data).identifier;
            return typeof id === "string" && id.trim() ? id.trim() : undefined;
        }
        const config = await readJsonFile<Record<string, unknown>>(configPath);
        const id = config.identifier;
        return typeof id === "string" && id.trim() ? id.trim() : undefined;
    } catch {
        return undefined;
    }
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
