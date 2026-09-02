/**
 * Reading a project from disk, and writing the one document this tool owns.
 *
 * `editor/story/stories/<storyId>/storydoc.json` is plain JSON and is written back exactly the way
 * `StoryService` writes it - two-space JSON - so a file this tool wrote and a file Studio wrote are
 * the same shape, and version control sees one change rather than a reformat.
 *
 * Everything else here is read and never written. A story row names things that live in six other
 * files - characters, the asset shards, the variable registry, the audio tracks, the build variants,
 * the interface's pages - and a line can only resolve a name if the list behind it was read. This is
 * the headless twin of what the workspace assembles from eleven services; it is a plain function of
 * the directory, so a command in a test and a command on an agent's terminal see the same project.
 *
 * A list that cannot be read comes back EMPTY rather than absent, and the consequence is stated
 * where it happens: an empty list makes every name in that slot unresolved, which is the honest
 * answer, where a guess would be a line that checks clean and plays wrong.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
    StoryDocument,
    StoryLibraryIndex,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { AssetType } from "@services/assets/assetTypes";
import type { Asset, AssetsMap } from "@services/assets/types";
import { Character } from "@services/character/Character";
import type { CharacterConfig } from "@services/character/Character";
import { buildStoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandContext";
import type { StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";
import { ProjectIoError, resolveBlueprintFile } from "../blueprint-cli/project";

export { ProjectIoError };

export const STORY_INDEX_RELATIVE_PATH = path.join("editor", "story", "index.json");
export const STORY_DIR_RELATIVE_PATH = path.join("editor", "story", "stories");
export const CHARACTERS_RELATIVE_PATH = path.join("editor", "services", "character.json");
export const VARIABLES_RELATIVE_PATH = path.join("editor", "variables.json");
export const AUDIO_TRACKS_RELATIVE_PATH = path.join("editor", "audio-tracks.json");
export const APP_TAGS_RELATIVE_PATH = path.join("editor", "app-tags.json");
export const UI_DOCUMENT_RELATIVE_PATH = path.join("editor", "ui", "uidoc.json");
export const UI_GRAPHS_RELATIVE_PATH = path.join("editor", "ui", "uigraphs.json");
/** The asset metadata shards, one per type, in the project root rather than under `editor/`. */
export const ASSETS_DIR_NAME = "assets";

export function resolveProjectDir(input: string): string {
    const resolved = path.resolve(input);
    if (!fs.existsSync(path.join(resolved, STORY_INDEX_RELATIVE_PATH))) {
        throw new ProjectIoError(
            `"${resolved}" does not look like a NarraLeaf project: no ${STORY_INDEX_RELATIVE_PATH}.`,
        );
    }
    return resolved;
}

/** A `.story` path as given on the command line - the same scratch-directory rule the family uses. */
export function resolveStoryFile(input: string, options: { forWriting: boolean }): string {
    return resolveBlueprintFile(input, options);
}

/** A scene name as a filename: `Classroom, after school` -> `classroom-after-school.story`. */
export function scratchFileNameFor(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9一-鿿]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug || "scene"}.story`;
}

// ---------------------------------------------------------------------------
// Reading JSON
// ---------------------------------------------------------------------------

/**
 * A JSON file, or `null` when it is not there.
 *
 * Absent and unreadable are deliberately different: a project that never configured voice has no
 * voice file and that is normal, while a file that exists and will not parse is a broken project and
 * saying so beats behaving as though the feature were off.
 */
function readJsonFile<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}`);
    }
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export type StorySummary = {
    id: string;
    name: string;
    /** Absent on a story the game itself carries; set on one a DLC ships. */
    dlcId?: string;
};

export function listStories(projectDir: string): StorySummary[] {
    const index = readJsonFile<StoryLibraryIndex>(path.join(projectDir, STORY_INDEX_RELATIVE_PATH));
    return (index?.stories ?? []).map(entry => ({
        id: entry.id,
        name: entry.name,
        ...(entry.dlcId ? { dlcId: entry.dlcId } : {}),
    }));
}

export type StoryDocumentFile = {
    filePath: string;
    storyId: string;
    document: StoryDocument;
};

export function storyDocumentPath(projectDir: string, storyId: string): string {
    return path.join(projectDir, STORY_DIR_RELATIVE_PATH, storyId, "storydoc.json");
}

/**
 * One story, migrated on read the way the editor migrates it on read.
 *
 * So the tool and the editor look at one shape, and an older project is something this can work on
 * rather than something it refuses. A document below the migration floor still throws, from the
 * migration itself, which is the one case nothing here can convert.
 */
export function readStoryDocument(projectDir: string, storyId: string): StoryDocumentFile {
    const filePath = storyDocumentPath(projectDir, storyId);
    const stored = readJsonFile<StoryDocument>(filePath);
    if (!stored) {
        throw new ProjectIoError(`No story document at ${filePath}.`);
    }
    let document: StoryDocument;
    try {
        document = migrateStoryDocumentToLatest(stored);
    } catch (error) {
        throw new ProjectIoError(`${filePath}: ${(error as Error).message}`);
    }
    return { filePath, storyId, document };
}

/**
 * The document is at the version this build writes, or nothing may be written into it.
 *
 * A backstop rather than a gate an author can trip: `readStoryDocument` migrates on the way in, so
 * the only way to reach this is a conversion that did not raise the version, which is a bug here
 * rather than something the caller can act on.
 */
export function assertWritableSchema(file: StoryDocumentFile): void {
    if (file.document.schemaVersion !== STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new ProjectIoError(
            `${file.filePath} is at story schema ${file.document.schemaVersion}, and this build writes `
                + `${STORY_DOCUMENT_SCHEMA_VERSION}. Open the project in Studio once so it migrates.`,
        );
    }
}

export function writeStoryDocument(file: StoryDocumentFile): void {
    assertWritableSchema(file);
    fs.mkdirSync(path.dirname(file.filePath), { recursive: true });
    fs.writeFileSync(file.filePath, JSON.stringify(file.document, null, 2), "utf8");
}

/**
 * A story by id, whole name, or part of one - the same latitude `blueprint show --blueprint` takes.
 *
 * A project with one story resolves with no name at all, because naming the only story is a step
 * that answers nothing.
 */
export function findStory(stories: readonly StorySummary[], query: string | undefined): StorySummary | null {
    if (!query) {
        return stories.length === 1 ? stories[0] : null;
    }
    const folded = query.trim().toLowerCase();
    return (
        stories.find(story => story.id === query)
        ?? stories.find(story => story.name.toLowerCase() === folded)
        ?? stories.find(story => story.name.toLowerCase().includes(folded))
        ?? null
    );
}

/** A scene by id, whole name, or part of one. Ambiguity is the caller's to report, so this takes the first. */
export function findScene(document: StoryDocument, query: string): StoryScene | null {
    const scenes = Object.values(document.scenes ?? {}) as StoryScene[];
    const folded = query.trim().toLowerCase();
    return (
        scenes.find(scene => scene.id === query)
        ?? scenes.find(scene => scene.name.toLowerCase() === folded)
        ?? scenes.find(scene => scene.name.toLowerCase().includes(folded))
        ?? null
    );
}

/** Every scene of a story in the order the chapters list them, with anything unlisted after. */
export function orderedScenes(document: StoryDocument): StoryScene[] {
    const scenes = document.scenes ?? {};
    const seen = new Set<StorySceneId>();
    const ordered: StoryScene[] = [];
    for (const chapter of document.chapters ?? []) {
        for (const sceneId of chapter.sceneIds ?? []) {
            const scene = scenes[sceneId];
            if (scene && !seen.has(sceneId)) {
                seen.add(sceneId);
                ordered.push(scene);
            }
        }
    }
    for (const [sceneId, scene] of Object.entries(scenes)) {
        if (!seen.has(sceneId)) {
            ordered.push(scene);
        }
    }
    return ordered;
}

// ---------------------------------------------------------------------------
// The rest of the project
// ---------------------------------------------------------------------------

export type ProjectData = {
    dir: string;
    assets: AssetsMap;
    characters: Character[];
    persistentVariables: VariableRegistryEntry[];
    savedVariables: VariableRegistryEntry[];
    blueprintDocument: BlueprintDocument | null;
    audioTracks: { id: string; name: string }[];
    appTags: { id: string; name: string }[];
    surfaces: { id: string; name: string }[];
    assetSets: { id: string; name: string; type: string }[];
};

function emptyAssetsMap(): AssetsMap {
    const map = {} as AssetsMap;
    for (const type of Object.values(AssetType)) {
        (map as Record<string, Record<string, Asset>>)[type] = {};
    }
    return map;
}

/**
 * The asset library, from the per-type metadata shards in the project root.
 *
 * One shard per {@link AssetType}, each a `Record<id, Asset>` - which is already the shape
 * `AssetsMap` wants, so this is a read rather than a projection. A shard the project has never
 * written is an empty record: a project with no video has no video shard, and that is not an error.
 */
function readAssets(projectDir: string): AssetsMap {
    const map = emptyAssetsMap();
    for (const type of Object.values(AssetType)) {
        const shard = readJsonFile<Record<string, Asset>>(
            path.join(projectDir, ASSETS_DIR_NAME, `assets.metadata.${type}.json`),
        );
        if (shard) {
            (map as Record<string, Record<string, Asset>>)[type] = shard;
        }
    }
    return map;
}

function readCharacters(projectDir: string): Character[] {
    const file = readJsonFile<{ characters?: CharacterConfig[] }>(
        path.join(projectDir, CHARACTERS_RELATIVE_PATH),
    );
    return (file?.characters ?? []).map(config => Character.fromJSON(config));
}

function readVariables(projectDir: string): { persistent: VariableRegistryEntry[]; saved: VariableRegistryEntry[] } {
    const file = readJsonFile<{ entries?: Record<string, VariableRegistryEntry> }>(
        path.join(projectDir, VARIABLES_RELATIVE_PATH),
    );
    const entries = Object.values(file?.entries ?? {});
    return {
        persistent: entries.filter(entry => entry.scope === "persistent"),
        saved: entries.filter(entry => entry.scope === "saved"),
    };
}

function readBlueprintDocument(projectDir: string): BlueprintDocument | null {
    const raw = readJsonFile<{ blueprintDocument?: BlueprintDocument }>(
        path.join(projectDir, UI_GRAPHS_RELATIVE_PATH),
    );
    if (!raw?.blueprintDocument) {
        return null;
    }
    try {
        return migrateBlueprintDocumentToLatest(raw.blueprintDocument);
    } catch {
        // A blueprint document too old to lift costs this tool the value-blueprint names and
        // nothing else, so it degrades rather than refusing a story command that never touches one.
        return null;
    }
}

export function readUiDocument(projectDir: string): UIDocument | null {
    return readJsonFile<UIDocument>(path.join(projectDir, UI_DOCUMENT_RELATIVE_PATH));
}

export function readProjectData(projectDir: string): ProjectData {
    const variables = readVariables(projectDir);
    const audioFile = readJsonFile<{ tracks?: { id: string; name: string }[] }>(
        path.join(projectDir, AUDIO_TRACKS_RELATIVE_PATH),
    );
    const appTagFile = readJsonFile<{ tags?: { id: string; name: string }[] }>(
        path.join(projectDir, APP_TAGS_RELATIVE_PATH),
    );
    const ui = readUiDocument(projectDir);
    return {
        dir: projectDir,
        assets: readAssets(projectDir),
        characters: readCharacters(projectDir),
        persistentVariables: variables.persistent,
        savedVariables: variables.saved,
        blueprintDocument: readBlueprintDocument(projectDir),
        audioTracks: (audioFile?.tracks ?? []).map(track => ({ id: track.id, name: track.name })),
        appTags: (appTagFile?.tags ?? []).map(tag => ({ id: tag.id, name: tag.name })),
        surfaces: (ui?.surfaces ?? []).map(surface => ({ id: surface.id, name: surface.name })),
        assetSets: [],
    };
}

/**
 * What a line resolves its names against, for one scene.
 *
 * The same builder the story editor calls, given the same shapes read off disk instead of off
 * services - so a name that resolves in Studio resolves here and a name that does not, does not.
 *
 * The one thing deliberately not supplied is `puppetByCharacterId`: what a puppet character can do
 * is decided by a model file Studio does not parse, and the answer comes from mounting the author's
 * own runtime. Without it those slots degrade to free text, which is what they already are on a
 * machine with no runtime installed - a name still resolves and still builds.
 */
export function buildContext(
    data: ProjectData,
    document: StoryDocument | null,
    scene: StoryScene | null,
): StoryCommandContext {
    return buildStoryCommandContext({
        assets: data.assets,
        assetSets: data.assetSets,
        characters: data.characters,
        document,
        sceneId: scene?.id ?? null,
        scene,
        persistentVariables: data.persistentVariables,
        savedVariables: data.savedVariables,
        blueprintDocument: data.blueprintDocument,
        audioTracks: data.audioTracks,
        appTags: data.appTags,
        surfaces: data.surfaces,
    });
}

/** An empty project, for the catalogue commands that must answer with no `--project` at all. */
export function emptyProjectData(): ProjectData {
    return {
        dir: "",
        assets: emptyAssetsMap(),
        characters: [],
        persistentVariables: [],
        savedVariables: [],
        blueprintDocument: null,
        audioTracks: [],
        appTags: [],
        surfaces: [],
        assetSets: [],
    };
}
