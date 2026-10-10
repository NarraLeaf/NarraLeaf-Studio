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
import type { StoryDocument, StoryLibraryIndex } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { AssetType } from "@services/assets/assetTypes";
import type { Asset } from "@services/assets/types";
import type { CharacterConfig } from "@services/character/Character";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { ProjectIoError, resolveBlueprintFile } from "../blueprint-cli/project";
import {
    buildStoryProjectContext,
    readableStoryDocument,
    storySummariesOf,
    type ProjectData,
    type StorySummary,
} from "./model";

// Everything that is a function of the documents rather than of the directory lives in `model.ts`,
// where the renderer can reach it; re-exported so the command line and its tests keep one import.
export {
    buildContext,
    buildStoryProjectContext,
    emptyProjectData,
    findScene,
    findStory,
    orderedScenes,
    type ProjectData,
    type StoryProjectDocuments,
    type StorySummary,
} from "./model";

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

export function listStories(projectDir: string): StorySummary[] {
    return storySummariesOf(readJsonFile<StoryLibraryIndex>(path.join(projectDir, STORY_INDEX_RELATIVE_PATH)));
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
        document = readableStoryDocument(stored);
    } catch (error) {
        // The original is carried as `cause` rather than only quoted: a caller that wants to say
        // which end of the ladder the document fell off reads the two version numbers off the
        // error the ladder threw, and a rewrapped message has flattened them into prose.
        throw new ProjectIoError(`${filePath}: ${(error as Error).message}`, { cause: error });
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

// ---------------------------------------------------------------------------
// The rest of the project
// ---------------------------------------------------------------------------

/**
 * The asset library, from the per-type metadata shards in the project root.
 *
 * One shard per {@link AssetType}, each a `Record<id, Asset>` - which is already the shape
 * `AssetsMap` wants, so this is a read rather than a projection. A shard the project has never
 * written is left out, and reads as empty: a project with no video has no video shard, and that is
 * not an error.
 */
function readAssets(projectDir: string): Partial<Record<string, Record<string, Asset>>> {
    const shards: Partial<Record<string, Record<string, Asset>>> = {};
    for (const type of Object.values(AssetType)) {
        const shard = readJsonFile<Record<string, Asset>>(
            path.join(projectDir, ASSETS_DIR_NAME, `assets.metadata.${type}.json`),
        );
        if (shard) {
            shards[type] = shard;
        }
    }
    return shards;
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

/** The lists a line resolves against, read off disk (see `buildStoryProjectContext`). */
export function readProjectData(projectDir: string): ProjectData {
    const variables = readJsonFile<{ entries?: Record<string, VariableRegistryEntry> }>(
        path.join(projectDir, VARIABLES_RELATIVE_PATH),
    );
    const audioFile = readJsonFile<{ tracks?: { id: string; name: string }[] }>(
        path.join(projectDir, AUDIO_TRACKS_RELATIVE_PATH),
    );
    const appTagFile = readJsonFile<{ tags?: { id: string; name: string }[] }>(
        path.join(projectDir, APP_TAGS_RELATIVE_PATH),
    );
    const characterFile = readJsonFile<{ characters?: CharacterConfig[] }>(
        path.join(projectDir, CHARACTERS_RELATIVE_PATH),
    );
    return buildStoryProjectContext({
        dir: projectDir,
        assets: readAssets(projectDir),
        characters: characterFile?.characters ?? [],
        variableRegistry: variables,
        blueprintDocument: readBlueprintDocument(projectDir),
        audioTracks: audioFile?.tracks ?? [],
        appTags: appTagFile?.tags ?? [],
        uiDocument: readUiDocument(projectDir),
    });
}

/** Every story the project lists, read and migrated; one that will not read is reported, not thrown. */
export function readAllStories(projectDir: string): {
    stories: { summary: StorySummary; document: StoryDocument }[];
    unreadable: { summary: StorySummary; error: unknown }[];
} {
    const stories: { summary: StorySummary; document: StoryDocument }[] = [];
    const unreadable: { summary: StorySummary; error: unknown }[] = [];
    for (const summary of listStories(projectDir)) {
        try {
            stories.push({ summary, document: readStoryDocument(projectDir, summary.id).document });
        } catch (error) {
            unreadable.push({ summary, error });
        }
    }
    return { stories, unreadable };
}
