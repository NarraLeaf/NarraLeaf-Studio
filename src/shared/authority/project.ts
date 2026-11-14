import type {
    LiveAppTagOp,
    LiveAssetFolderOp,
    LiveAssetOp,
    LiveAssetSetOp,
    LiveAudioTrackOp,
    LiveBrandOp,
    LiveCharacterOp,
    LiveDerived,
    LiveDictionaryOp,
    LiveDlcOp,
    LiveDocument,
    LiveLocalizationKeyOp,
    LiveLocalizationOp,
    LiveOp,
    LiveStoryOp,
    LiveUIGraphOp,
    LiveUIOp,
    LiveVariableOp,
    LiveVoiceOp,
} from "@shared/live/ops";
import { insertLiveRecordBefore } from "@shared/live/config";
import { opClaimKeys } from "@shared/live/ops";
import { liveDocumentPath } from "@shared/live/sharedDocuments";
import { applyUIParts } from "@shared/live/uiParts";
import { applyUIGraphParts } from "@shared/live/uiGraphParts";
import { rebindRows, sweepSpeakerName, type LiveStoryDocuments } from "@shared/live/characterSweep";
import { compileDocumentPathPattern, matchDocumentPath, type DocumentPathPattern } from "@shared/documents/documentPath";
import {
    appTagsSpec,
    assetGroupsSpec,
    assetSetsSpec,
    assetsMetadataSpec,
    audioTracksSpec,
    brandSpec,
    charactersSpec,
    dictionarySpec,
    dlcSpec,
    localizationDocumentSpec,
    localizationKeysSpec,
    uiDocumentSpec,
    uiGraphsSpec,
    variableRegistrySpec,
    voiceDocumentSpec,
} from "./projectSpecs";
import { DocumentCorruptError, type DocumentKind, type DocumentParseContext } from "@shared/documents/types";
import { storyDocumentSpec } from "@shared/documents/specs/story";
import { STORY_INDEX_DOCUMENT_PATH, storyIndexSpec } from "@shared/documents/specs/storyIndex";
import { normalizeAppTagDocument, type ProjectAppTagDocument } from "@shared/types/appTag";
import { normalizeProjectAudioTracks } from "@shared/types/audioTrack";
import { normalizeProjectAssetSets } from "@shared/types/assetSet";
import { normalizeProjectBrandColors } from "@shared/types/brand";
import type { CharacterStoreDocument } from "@shared/characters/characterStoreModel";
import { normalizeDictionaryEntries, normalizeDictionaryOptions } from "@shared/types/dictionary";
import { normalizeProjectDlcs } from "@shared/types/dlc";
import { normalizeProjectFontStack } from "@shared/types/typography";
import type { StoryDocument, StoryId, StoryLibraryEntry, StoryLibraryIndex } from "@shared/types/story";
import { applyStoryOpToDocument, storyOpSceneReach } from "@shared/story/applyStoryOp";
import { applyStoryOpToLibrary } from "./storyFiles";
import { isVersioned } from "@shared/vcs/workingSet";
import { STORY_COMMENTS_DOCUMENT_PATH } from "@shared/documents/specs/storyComments";

/**
 * A whole team project, as the Team server holds it and applies edits to it.
 *
 * The project is a set of files, each held as the JSON it is stored as on disk, addressed by its
 * project-relative path. {@link applyProjectOp} applies one operation from Studio's live vocabulary
 * to that set - to the document the operation is about, and to any other document the operation
 * reaches (deleting a character rewrites the dialogue rows that spoke it; a paste carries the
 * translations and voice takes it derived). It answers which files changed, so the server knows what
 * to persist and a Studio knows what moved.
 *
 * The server never models these documents itself: it hands paths, JSON and operations through here.
 *
 * **Story documents are held migrated** (parsed through their spec, which runs the schema ladder);
 * every other document is held exactly as stored, so a snapshot writes back what it read.
 */

/** The files of a project, by project-relative path. */
export interface KernelProjectView {
    /** The document at a path as it stands, or undefined when the project has none there. Mutable. */
    get(path: string): unknown;
    set(path: string, value: unknown): void;
    delete(path: string): void;
}

/** What applying one operation did. */
export type ProjectOpApplied = {
    changed: boolean;
    /** Every path written, the operation's own document first. */
    touched: string[];
};

/**
 * Operations on the story library itself - making and removing a whole story - which the live
 * vocabulary never had, because a live session was always about stories that already existed.
 * Addressed to `{ doc: "story", storyId }` like every other story operation.
 */
export type TeamStoryLibraryOp =
    | { op: "create-story"; entry: StoryLibraryEntry; document: StoryDocument }
    | { op: "delete-story" };

/**
 * A file's whole content, for the files that have no finer operations (the project file, story
 * animations, the save schema, presets, anything a later Studio adds) and for a document edited
 * offline, which goes back as the whole document. Small files travel inline; a larger one travels
 * as a transfer through the server's blob store, named here.
 */
export type TeamFileContent =
    | { encoding: "utf8"; data: string }
    | { encoding: "base64"; data: string }
    | { blob: { transferId: string; digest: string; size: number } };

/** A file addressed by its project-relative path. */
export type TeamFileDocument = { doc: "file"; path: string };

/** Put a file's whole content in place, or (null) remove it. Addressed to {@link TeamFileDocument}. */
export type TeamFileOp = { op: "put-file"; content: TeamFileContent | null };

/** Any document a team project's authority applies operations to. */
export type ProjectDocument = LiveDocument | TeamFileDocument;

/** Any operation a team project's authority applies. */
export type ProjectOp = LiveOp | TeamStoryLibraryOp | TeamFileOp;

/**
 * How the authority holds a file that is not one of its documents.
 *
 * `stored` stands for a file too large to hold that is exactly as the last saved version has it;
 * `blob` for one whose bytes are on their way through the blob store.
 */
export type HeldFile =
    | { $file: 1; encoding: "utf8" | "base64"; data: string }
    | { $file: 1; blob: { transferId: string; digest: string; size: number } }
    | { $file: 1; stored: { digest: string; size: number } };

export function isHeldFile(value: unknown): value is HeldFile {
    return typeof value === "object" && value !== null && (value as { $file?: unknown }).$file === 1;
}

export const STORY_LIBRARY_FILE = STORY_INDEX_DOCUMENT_PATH;

/**
 * The documents a team project's authority holds, by spec. Named one by one rather than read from
 * the document registry, which also knows the project file - and that pulls a binary encoder into a
 * kernel that must stay plain JSON. Anything else in a project is not the authority's business.
 */
type ProjectSpec = { kind: string; paths: readonly string[]; parse(raw: unknown, context: DocumentParseContext): unknown };
const PROJECT_SPECS: readonly ProjectSpec[] = [
    storyIndexSpec,
    storyDocumentSpec,
    charactersSpec,
    localizationDocumentSpec,
    voiceDocumentSpec,
    localizationKeysSpec,
    variableRegistrySpec,
    appTagsSpec,
    dlcSpec,
    brandSpec,
    dictionarySpec,
    audioTracksSpec,
    assetSetsSpec,
    uiDocumentSpec,
    uiGraphsSpec,
    assetsMetadataSpec,
    assetGroupsSpec,
] as unknown as ProjectSpec[];
const PATTERNS: ReadonlyArray<{ pattern: DocumentPathPattern; spec: ProjectSpec }> = PROJECT_SPECS.flatMap(spec =>
    spec.paths.map(path => ({ pattern: compileDocumentPathPattern(path), spec })),
);

function specFor(path: string): ProjectSpec | undefined {
    return PATTERNS.find(entry => matchDocumentPath(entry.pattern, path) !== null)?.spec;
}

/** Whether a project-relative path is a document the authority holds. */
export function isProjectDocumentPath(path: string): boolean {
    return specFor(path) !== undefined;
}

/** Where an asset's bytes live, by digest. Its files are put by asset operations, or offline by `put-file`. */
export const ASSET_CONTENT_ROOT = "assets/content";

/**
 * Whether a whole-file put may address a path. Everything the project's repository keeps, except:
 * the story library and story documents, which always travel as row operations (offline too); the
 * comments' offline copy, whose truth is the server's threads; and the repository's own ignore file.
 */
export function isTeamFilePath(path: string): boolean {
    if (!isVersioned(path) || path.includes("\\") || path.startsWith("/") || path === ".loreignore") {
        return false;
    }
    if (path === STORY_COMMENTS_DOCUMENT_PATH || path === STORY_LIBRARY_FILE) {
        return false;
    }
    return specFor(path)?.kind !== "story";
}

/**
 * Whether a path is a file that only ever travels whole: one the editor writes with no finer
 * operations of its own. These are what the authority holds beside its documents, and what a Studio
 * sends whole whenever it writes one, online or off.
 */
export function isWholeFilePath(path: string): boolean {
    return isTeamFilePath(path) && !isProjectDocumentPath(path)
        && path !== ASSET_CONTENT_ROOT && !path.startsWith(`${ASSET_CONTENT_ROOT}/`);
}

/** Where a document lives, project-relative. */
export function projectDocumentPath(document: ProjectDocument): string {
    return document.doc === "file" ? document.path : liveDocumentPath(document);
}

/**
 * Read one of the project's files. Story documents and the library are parsed through their specs
 * (migrated; a newer Studio's document is refused by name); every other document is validated by its
 * spec - which refuses a newer schema - and kept as stored. Throws `DocumentCorruptError`.
 */
export function parseProjectFile(path: string, text: string): unknown {
    const spec = specFor(path);
    if (spec === undefined) {
        throw new Error(`not a project document: ${path}`);
    }
    const kind = spec.kind as DocumentKind;
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new DocumentCorruptError({ kind, path, reason: `not JSON: ${String(error)}`, text, cause: error });
    }
    const context = contextFor(kind, path, text);
    if (kind === "story") {
        return storyDocumentSpec.parse(raw, context);
    }
    if (kind === "story-index") {
        return storyIndexSpec.parse(raw, context);
    }
    spec.parse(raw, context);
    return raw;
}

/** One of the project's files as text, the way the editor writes it. */
export function serializeProjectFile(_path: string, value: unknown): string {
    return JSON.stringify(value, null, 2);
}

/**
 * The records an operation writes, for telling an offline edit it collides with a newer one.
 * The live vocabulary's claim keys, plus the story itself for making or removing one.
 */
export function projectOpClaimKeys(document: ProjectDocument, op: ProjectOp): readonly string[] {
    if (document.doc === "file" || op.op === "put-file") {
        return document.doc === "file" ? [fileClaimKey(document.path)] : [];
    }
    if (op.op === "create-story" || op.op === "delete-story") {
        return document.doc === "story" ? [`story:${document.storyId}`] : [];
    }
    let keys: readonly string[] = [];
    try {
        const found = opClaimKeys(op as LiveOp) as readonly string[] | undefined;
        keys = Array.isArray(found) ? found : [];
    } catch {
        keys = [];
    }
    return [...keys, ...structuralKeys(document, op as LiveOp)];
}

/**
 * The claim a whole file carries. The authority also marks it on every file an operation touches, so
 * a whole file sent from offline collides with any finer edit to the same file made meanwhile.
 */
export function fileClaimKey(path: string): string {
    return `file:${path}`;
}

/**
 * The structure an operation writes, beside the rows it writes. The live vocabulary's claims are
 * about typing - a row, a record - because that is what two people collide on while both are online;
 * offline, two people can also reshape the same scene or chapter, and the later one must not land
 * over the earlier one unseen. A rename, a move, a field edit or a deletion of a scene writes the
 * scene; the same for a chapter; renaming a story writes the story.
 */
function structuralKeys(document: LiveDocument, op: LiveOp): string[] {
    if (document.doc !== "story") {
        return [];
    }
    switch (op.op) {
        case "rename-scene":
        case "update-scene":
        case "delete-scene":
        case "move-scene":
        case "set-scene-snapshots":
        case "set-scene-layers":
            return [`scene:${op.sceneId}`];
        case "create-scene":
            return [`scene:${op.scene.id}`];
        case "rename-chapter":
        case "delete-chapter":
            return [`chapter:${op.chapterId}`];
        case "create-chapter":
            return [`chapter:${op.chapter.id}`];
        case "reorder-chapters":
            return [`chapters:${document.storyId}`];
        case "rename-story":
        case "set-entry-scene":
            return [`story:${document.storyId}`];
        default:
            return [];
    }
}

/**
 * Apply one operation to the project, in place. **Takes ownership of `op` and `derived`.**
 *
 * Throws when the operation does not apply to the project as it stands (a story or scene that is
 * not there, a verb this kernel does not know); a caller that must not be left half-applied works on
 * a copy and keeps it only when this returns.
 */
export function applyProjectOp(
    view: KernelProjectView,
    document: ProjectDocument,
    op: ProjectOp,
    context: { now: string },
    derived?: LiveDerived,
): ProjectOpApplied {
    const applied = applyToDocument(view, document, op, context);
    if (derived !== undefined) {
        applied.touched.push(...applyDerived(view, derived));
        applied.changed = applied.changed || applied.touched.length > 0;
    }
    applied.touched = [...new Set(applied.touched)];
    return applied;
}

function applyToDocument(view: KernelProjectView, document: ProjectDocument, op: ProjectOp, context: { now: string }): ProjectOpApplied {
    if (document.doc === "file") {
        if (op.op !== "put-file") throw unknownVerb(op);
        return applyPutFile(view, document.path, op);
    }
    if (op.op === "put-file") {
        throw new Error("a whole file is addressed by its path");
    }
    const path = liveDocumentPath(document);
    switch (document.doc) {
        case "story":
            return applyStory(view, document.storyId, op as LiveStoryOp | TeamStoryLibraryOp, context);
        case "characters":
            return applyCharacters(view, path, op as LiveCharacterOp);
        case "localization":
            return applyUnits(view, path, op as LiveLocalizationOp);
        case "voice":
            return applyUnits(view, path, op as LiveVoiceOp);
        case "localization-keys":
            return applyKeys(view, path, op as LiveLocalizationKeyOp);
        case "variables":
            return applyVariables(view, path, op as LiveVariableOp);
        case "app-tags":
            return applyAppTags(view, path, op as LiveAppTagOp);
        case "dlc":
            return applyDlc(view, path, op as LiveDlcOp);
        case "brand":
            return applyBrand(view, path, op as LiveBrandOp);
        case "dictionary":
            return applyDictionary(view, path, op as LiveDictionaryOp);
        case "audio-tracks":
            return applyAudioTracks(view, path, op as LiveAudioTrackOp);
        case "asset-sets":
            return applyAssetSets(view, path, op as LiveAssetSetOp);
        case "ui":
            return applyWhole(view, path, document => applyUIParts(document as never, (op as LiveUIOp).parts));
        case "ui-graphs":
            return applyWhole(view, path, document => applyUIGraphParts(document as never, (op as LiveUIGraphOp).parts));
        case "assets":
            return applyAssets(view, path, op as LiveAssetOp);
        case "asset-groups":
            return applyAssetFolders(view, document.category, path, op as LiveAssetFolderOp);
        default: {
            const unknown: never = document;
            throw new Error(`No document of kind ${JSON.stringify(unknown)}`);
        }
    }
}

/* ------------------------------------------------------------------ stories */

function storyView(view: KernelProjectView): LiveStoryDocuments & { touched: Set<string> } {
    const touched = new Set<string>();
    return {
        touched,
        listStories: () => (view.get(STORY_LIBRARY_FILE) as StoryLibraryIndex | undefined)?.stories ?? [],
        getStoryDocument: (storyId: StoryId) => {
            const document = view.get(liveDocumentPath({ doc: "story", storyId })) as StoryDocument | undefined;
            if (document === undefined) {
                throw new Error(`Story not found: ${storyId}`);
            }
            return document;
        },
        applyLiveOp: (storyId: StoryId, op: LiveStoryOp) => {
            const path = liveDocumentPath({ doc: "story", storyId });
            const document = view.get(path) as StoryDocument | undefined;
            if (document === undefined) {
                return;
            }
            applyStoryOpToDocument(document, op, { now: new Date().toISOString() });
            touched.add(path);
        },
    };
}

function applyStory(
    view: KernelProjectView,
    storyId: StoryId,
    op: LiveStoryOp | TeamStoryLibraryOp,
    context: { now: string },
): ProjectOpApplied {
    const path = liveDocumentPath({ doc: "story", storyId });
    const library = view.get(STORY_LIBRARY_FILE) as StoryLibraryIndex | undefined;
    if (op.op === "create-story") {
        if (library === undefined) {
            throw new Error("the project has no story library");
        }
        if (library.stories.some(entry => entry.id === storyId) || view.get(path) !== undefined) {
            return { changed: false, touched: [] };
        }
        library.stories.push({ ...op.entry, id: storyId });
        view.set(path, { ...op.document, id: storyId });
        return { changed: true, touched: [path, STORY_LIBRARY_FILE] };
    }
    if (op.op === "delete-story") {
        if (library === undefined || !library.stories.some(entry => entry.id === storyId)) {
            return { changed: false, touched: [] };
        }
        library.stories = library.stories.filter(entry => entry.id !== storyId);
        if (library.defaultStoryId === storyId) {
            delete library.defaultStoryId;
        }
        view.delete(path);
        return { changed: true, touched: [path, STORY_LIBRARY_FILE] };
    }
    const document = view.get(path) as StoryDocument | undefined;
    if (document === undefined) {
        throw new Error(`Story not found: ${storyId}`);
    }
    const applied = applyStoryOpToDocument(document, op, context);
    const touched = applied.changed ? [path] : [];
    if (library !== undefined && applyStoryOpToLibrary(library, storyId, op, context)) {
        touched.push(STORY_LIBRARY_FILE);
    }
    void storyOpSceneReach;
    return { changed: applied.changed, touched };
}

/* ------------------------------------------------------------------ the cast */

function applyCharacters(view: KernelProjectView, path: string, op: LiveCharacterOp): ProjectOpApplied {
    const store = (view.get(path) as CharacterStoreDocument | undefined) ?? { version: 1, characters: [] } as unknown as CharacterStoreDocument;
    if (view.get(path) === undefined) {
        view.set(path, store);
    }
    const characters = store.characters as Array<{ profile: { id: string; name?: string; groupId?: string } }>;
    const stories = storyView(view);
    const find = (id: string) => characters.findIndex(record => record.profile.id === id);
    let changed = true;
    switch (op.op) {
        case "create-character": {
            const record = op.character as unknown as { profile: { id: string } };
            const at = find(record.profile.id);
            if (at >= 0) {
                characters[at] = record as never;
            } else {
                characters.push(record as never);
            }
            if (op.rebind) {
                rebindRows(stories, op.rebind, record.profile.id);
            }
            break;
        }
        case "update-character": {
            const at = find(op.characterId);
            if (at < 0) {
                changed = false;
                break;
            }
            characters[at] = op.character as never;
            break;
        }
        case "delete-character": {
            const at = find(op.characterId);
            if (at < 0) {
                changed = false;
                break;
            }
            const speakerName = characters[at].profile.name ?? "";
            characters.splice(at, 1);
            sweepSpeakerName(stories, op.characterId, speakerName);
            break;
        }
        case "set-character-group": {
            const groups = { ...((store as { groups?: Record<string, unknown> }).groups ?? {}) };
            groups[op.groupId] = { ...op.group };
            (store as { groups?: Record<string, unknown> }).groups = groups;
            for (const memberId of op.members ?? []) {
                const at = find(memberId);
                if (at >= 0) {
                    characters[at].profile.groupId = op.groupId;
                }
            }
            break;
        }
        case "delete-character-group": {
            for (const record of characters) {
                if (record.profile.groupId === op.groupId) {
                    delete record.profile.groupId;
                }
            }
            const groups = (store as { groups?: Record<string, unknown> }).groups;
            if (groups !== undefined) {
                delete groups[op.groupId];
            }
            break;
        }
        default:
            throw unknownVerb(op);
    }
    return { changed: changed || stories.touched.size > 0, touched: changed ? [path, ...stories.touched] : [...stories.touched] };
}

/* ------------------------------------------------------------------ libraries */

type UnitsOp =
    | { op: string; locale: string; unitId: string; unit: unknown }
    | { op: string; locale: string; units: readonly { unitId: string; unit: unknown }[] };

/** The answer for an operation on one document file: what changed is that file, or nothing. */
function onFile(changed: boolean, path: string): ProjectOpApplied {
    return changed ? { changed: true, touched: [path] } : { changed: false, touched: [] };
}

/**
 * Translations or voice takes, into one language's document. Every applier named
 * `apply...OpToDocument` here is **the** applier for its document kind: the Team server runs it
 * over the file it holds, and the editor service runs it over the document it has in memory when a
 * teammate's edit arrives. Each mutates `document` in place, takes ownership of `op`, and answers
 * whether anything changed.
 */
export function applyUnitsOpToDocument(document: { units?: Record<string, unknown> }, op: LiveLocalizationOp | LiveVoiceOp): boolean {
    const verb = (op as UnitsOp).op;
    const single = verb === "set-translation" || verb === "set-take";
    if (!single && verb !== "set-translations" && verb !== "set-takes") {
        throw unknownVerb(op);
    }
    const units = { ...(document.units ?? {}) };
    const entries = single
        ? [{ unitId: (op as { unitId: string }).unitId, unit: (op as { unit: unknown }).unit }]
        : (op as { units: readonly { unitId: string; unit: unknown }[] }).units;
    for (const entry of entries) {
        if (entry.unit === null) {
            delete units[entry.unitId];
        } else {
            units[entry.unitId] = entry.unit;
        }
    }
    document.units = units;
    return true;
}

function applyUnits(view: KernelProjectView, path: string, op: LiveLocalizationOp | LiveVoiceOp): ProjectOpApplied {
    const document = view.get(path) as { units?: Record<string, unknown> } | undefined;
    // A language the project has not got: the editor's own applier makes it a no-op, and so does this.
    if (document === undefined) return { changed: false, touched: [] };
    return onFile(applyUnitsOpToDocument(document, op), path);
}

function applyDerived(view: KernelProjectView, derived: LiveDerived): string[] {
    const touched: string[] = [];
    const write = (path: string, entries: Readonly<Record<string, unknown>>) => {
        const document = view.get(path) as { units?: Record<string, unknown> } | undefined;
        if (document === undefined) return;
        document.units = { ...(document.units ?? {}), ...structuredClone(entries) };
        touched.push(path);
    };
    for (const [locale, entries] of Object.entries(derived.translations ?? {})) {
        write(liveDocumentPath({ doc: "localization", locale }), entries);
    }
    for (const [locale, entries] of Object.entries(derived.voice ?? {})) {
        write(liveDocumentPath({ doc: "voice", locale }), entries);
    }
    return touched;
}

/** Named localization keys. See {@link applyUnitsOpToDocument}. */
export function applyLocalizationKeyOpToDocument(document: { keys?: Record<string, unknown> }, op: LiveLocalizationKeyOp): boolean {
    const keys = { ...(document.keys ?? {}) };
    switch (op.op) {
        case "set-key":
            keys[op.name] = op.definition;
            break;
        case "remove-key":
            if (!(op.name in keys)) return false;
            delete keys[op.name];
            break;
        default:
            throw unknownVerb(op);
    }
    document.keys = keys;
    return true;
}

function applyKeys(view: KernelProjectView, path: string, op: LiveLocalizationKeyOp): ProjectOpApplied {
    const document = view.get(path) as { keys?: Record<string, unknown> } | undefined;
    if (document === undefined) return { changed: false, touched: [] };
    return onFile(applyLocalizationKeyOpToDocument(document, op), path);
}

/**
 * The variable registry. A deleted variable's references in the interface are swept by whoever
 * deletes it, not here. See {@link applyUnitsOpToDocument}.
 */
export function applyVariableOpToDocument(registry: { entries?: Record<string, unknown> }, op: LiveVariableOp): boolean {
    const entries = registry.entries ?? (registry.entries = {});
    switch (op.op) {
        case "create-variable":
            entries[op.entry.id] = { ...op.entry };
            return true;
        case "update-variable":
            if (!entries[op.variableId]) return false;
            entries[op.variableId] = { ...op.entry };
            return true;
        case "delete-variable":
            if (!entries[op.variableId]) return false;
            delete entries[op.variableId];
            return true;
        default:
            throw unknownVerb(op);
    }
}

function applyVariables(view: KernelProjectView, path: string, op: LiveVariableOp): ProjectOpApplied {
    const registry = view.get(path) as { entries?: Record<string, unknown> } | undefined;
    if (registry === undefined) return { changed: false, touched: [] };
    return onFile(applyVariableOpToDocument(registry, op), path);
}

/* ------------------------------------------------------------------ configuration tables */

function moveBefore<T extends { id: string }>(list: readonly T[], id: string, beforeId: string | null): T[] {
    const moving = list.find(entry => entry.id === id);
    if (!moving || beforeId === id) return [...list];
    const rest = list.filter(entry => entry.id !== id);
    const index = beforeId === null ? -1 : rest.findIndex(entry => entry.id === beforeId);
    if (index < 0) return [...rest, moving];
    rest.splice(index, 0, moving);
    return rest;
}

/** The app tags and their defaults. See {@link applyUnitsOpToDocument}. */
export function applyAppTagOpToDocument(document: ProjectAppTagDocument, op: LiveAppTagOp): boolean {
    switch (op.op) {
        case "create-app-tag":
            // A creation for a record already here is a retry that escaped the receipts: replaced,
            // never a second row under one id.
            document.tags = document.tags.some(entry => entry.id === op.tag.id)
                ? document.tags.map(entry => (entry.id === op.tag.id ? op.tag : entry))
                : insertLiveRecordBefore(document.tags, op.tag, op.beforeId);
            break;
        case "update-app-tag":
            // An update naming a record that is not here is a missed creation; making it here would
            // hide that.
            if (!document.tags.some(entry => entry.id === op.tagId)) return false;
            document.tags = document.tags.map(entry => (entry.id === op.tagId ? op.tag : entry));
            break;
        case "delete-app-tag":
            document.tags = document.tags.filter(entry => entry.id !== op.tagId);
            break;
        case "set-app-tag-defaults": {
            document.pluginConfig = op.defaults.pluginConfig;
            document.assetAxes = op.defaults.assetAxes;
            document.reachableScenes = op.defaults.reachableScenes;
            document.endingSurfaceId = op.defaults.endingSurfaceId;
            if (op.tagPluginConfig) {
                // A tag named here that has gone since is skipped rather than made again.
                const byTag = new Map(op.tagPluginConfig.map(entry => [entry.tagId, entry.pluginConfig]));
                document.tags = document.tags.map(tag => (byTag.has(tag.id) ? { ...tag, pluginConfig: byTag.get(tag.id)! } : tag));
            }
            break;
        }
        default:
            throw unknownVerb(op);
    }
    normalizeAppTagDocument(document);
    return true;
}

function applyAppTags(view: KernelProjectView, path: string, op: LiveAppTagOp): ProjectOpApplied {
    const document = view.get(path) as ProjectAppTagDocument | undefined;
    if (document === undefined) return { changed: false, touched: [] };
    return onFile(applyAppTagOpToDocument(document, op), path);
}

/** The DLC table. See {@link applyUnitsOpToDocument} and {@link applyAppTagOpToDocument}. */
export function applyDlcOpToDocument(document: { dlcs: Array<{ id: string }> }, op: LiveDlcOp): boolean {
    switch (op.op) {
        case "create-dlc":
            document.dlcs = document.dlcs.some(entry => entry.id === op.dlc.id)
                ? document.dlcs.map(entry => (entry.id === op.dlc.id ? op.dlc : entry))
                : insertLiveRecordBefore(document.dlcs as never[], op.dlc as never, op.beforeId);
            break;
        case "update-dlc":
            if (!document.dlcs.some(entry => entry.id === op.dlcId)) return false;
            // In place, so a change of id keeps the row where the author is looking at it.
            document.dlcs = document.dlcs.map(entry => (entry.id === op.dlcId ? op.dlc : entry));
            break;
        case "delete-dlc":
            document.dlcs = document.dlcs.filter(entry => entry.id !== op.dlcId);
            break;
        default:
            throw unknownVerb(op);
    }
    document.dlcs = normalizeProjectDlcs(document.dlcs as never) as never;
    return true;
}

function applyDlc(view: KernelProjectView, path: string, op: LiveDlcOp): ProjectOpApplied {
    const document = view.get(path) as { dlcs: Array<{ id: string }> } | undefined;
    if (document === undefined) return { changed: false, touched: [] };
    return onFile(applyDlcOpToDocument(document, op), path);
}

/** The brand colours and fonts. See {@link applyUnitsOpToDocument} and {@link applyAppTagOpToDocument}. */
export function applyBrandOpToDocument(document: { colors: Array<{ id: string }>; fonts?: unknown }, op: LiveBrandOp): boolean {
    switch (op.op) {
        case "create-brand-color":
            document.colors = document.colors.some(entry => entry.id === op.color.id)
                ? document.colors.map(entry => (entry.id === op.color.id ? op.color : entry))
                : insertLiveRecordBefore(document.colors as never[], op.color as never, op.beforeId);
            break;
        case "update-brand-color":
            if (!document.colors.some(entry => entry.id === op.colorId)) return false;
            document.colors = document.colors.map(entry => (entry.id === op.colorId ? op.color : entry));
            break;
        case "delete-brand-color":
            document.colors = document.colors.filter(entry => entry.id !== op.colorId);
            break;
        case "move-brand-color":
            document.colors = moveBefore(document.colors, op.colorId, op.beforeId);
            break;
        case "set-brand-fonts":
            document.fonts = normalizeProjectFontStack(op.fonts);
            return true;
        default:
            throw unknownVerb(op);
    }
    document.colors = normalizeProjectBrandColors(document.colors as never) as never;
    return true;
}

function applyBrand(view: KernelProjectView, path: string, op: LiveBrandOp): ProjectOpApplied {
    const document = view.get(path) as { colors: Array<{ id: string }>; fonts?: unknown } | undefined;
    if (document === undefined) return { changed: false, touched: [] };
    return onFile(applyBrandOpToDocument(document, op), path);
}

/** The spelling dictionary. See {@link applyUnitsOpToDocument}. */
export function applyDictionaryOpToDocument(document: { entries: Array<{ term: string }>; options?: unknown }, op: LiveDictionaryOp): boolean {
    switch (op.op) {
        case "set-dictionary-entry": {
            const entry = op.entry;
            const rest = document.entries.filter(candidate => candidate.term !== op.term && candidate.term !== entry?.term);
            document.entries = normalizeDictionaryEntries((entry ? [...rest, entry] : rest) as never) as never;
            return true;
        }
        case "set-dictionary-options":
            document.options = normalizeDictionaryOptions(op.options);
            return true;
        default:
            throw unknownVerb(op);
    }
}

function applyDictionary(view: KernelProjectView, path: string, op: LiveDictionaryOp): ProjectOpApplied {
    const document = view.get(path) as { entries: Array<{ term: string }>; options?: unknown } | undefined;
    if (document === undefined) return { changed: false, touched: [] };
    return onFile(applyDictionaryOpToDocument(document, op), path);
}

/** The audio buses. See {@link applyUnitsOpToDocument}. */
export function applyAudioTrackOpToDocument(document: { tracks: Array<{ id: string; parentId?: string | null }> }, op: LiveAudioTrackOp): boolean {
    let tracks = [...document.tracks];
    switch (op.op) {
        case "create-audio-track": {
            // Undoing a deletion: the buses that were promoted out of it come home. An ordinary
            // creation names none.
            const reparent = new Set(op.reparent ?? []);
            const rest = tracks.filter(track => track.id !== op.track.id)
                .map(track => (reparent.has(track.id) ? { ...track, parentId: op.track.id } : track));
            const index = op.beforeId === null ? -1 : rest.findIndex(track => track.id === op.beforeId);
            if (index < 0) rest.push({ ...op.track });
            else rest.splice(index, 0, { ...op.track });
            tracks = rest;
            break;
        }
        case "update-audio-track":
            tracks = tracks.map(track => (track.id === op.trackId ? { ...op.track, id: op.trackId } : track));
            break;
        case "delete-audio-track": {
            const doomed = tracks.find(track => track.id === op.trackId);
            if (!doomed) return false;
            tracks = tracks.filter(track => track.id !== op.trackId)
                .map(track => (track.parentId === op.trackId ? { ...track, parentId: doomed.parentId } : track));
            break;
        }
        case "move-audio-track":
            tracks = moveBefore(tracks, op.trackId, op.beforeId);
            break;
        default:
            throw unknownVerb(op);
    }
    document.tracks = normalizeProjectAudioTracks(tracks as never) as never;
    return true;
}

function applyAudioTracks(view: KernelProjectView, path: string, op: LiveAudioTrackOp): ProjectOpApplied {
    const document = view.get(path) as { tracks: Array<{ id: string; parentId?: string | null }> } | undefined;
    if (document === undefined) return { changed: false, touched: [] };
    return onFile(applyAudioTrackOpToDocument(document, op), path);
}

/** The asset sets. See {@link applyUnitsOpToDocument}. */
export function applyAssetSetOpToDocument(document: { sets: Array<{ id: string; groupId?: string }> }, op: LiveAssetSetOp): boolean {
    if (!assetSetOpToDocument(document, op)) return false;
    Object.assign(document, normalizeProjectAssetSets(document));
    return true;
}

function assetSetOpToDocument(document: { sets: Array<{ id: string; groupId?: string }> }, op: LiveAssetSetOp): boolean {
    switch (op.op) {
        case "create-asset-sets": {
            const next = document.sets.filter(set => !op.creates.some(create => create.set.id === set.id));
            for (const create of op.creates) {
                const index = create.beforeId === null ? -1 : next.findIndex(set => set.id === create.beforeId);
                next.splice(index < 0 ? next.length : index, 0, create.set as never);
            }
            document.sets = next;
            return true;
        }
        case "update-asset-set":
            document.sets = document.sets.map(set => (set.id === op.setId ? { ...(op.set as object), id: op.setId } : set)) as never;
            return true;
        case "delete-asset-sets": {
            // Tolerant of a set already gone: the second of two deletions changes nothing.
            const doomed = new Set(op.setIds);
            document.sets = document.sets.filter(set => !doomed.has(set.id));
            return true;
        }
        case "move-asset-sets": {
            const moves = new Map(op.moves.map(move => [move.setId, move.groupId]));
            document.sets = document.sets.map(set => {
                if (!moves.has(set.id)) return set;
                const groupId = moves.get(set.id) ?? null;
                // Removed rather than set to undefined: the two are not the same document to a digest.
                const { groupId: _current, ...rest } = set;
                return groupId ? { ...rest, groupId } : rest;
            });
            return true;
        }
        default:
            throw unknownVerb(op);
    }
}

function applyAssetSets(view: KernelProjectView, path: string, op: LiveAssetSetOp): ProjectOpApplied {
    const document = view.get(path) as { sets: Array<{ id: string; groupId?: string }> } | undefined;
    if (document === undefined) return { changed: false, touched: [] };
    return onFile(applyAssetSetOpToDocument(document, op), path);
}

function applyWhole(view: KernelProjectView, path: string, apply: (document: unknown) => void): ProjectOpApplied {
    const document = view.get(path);
    if (document === undefined) return { changed: false, touched: [] };
    apply(document);
    return { changed: true, touched: [path] };
}

/* ------------------------------------------------------------------ the asset library */

/**
 * An asset shard is a bare map of records by id. What a record SAYS travels here; the file it
 * describes travels separately (see `assetBytesOf`), and a server applying `create-assets` or
 * `replace-asset-content` records which transfers it is owed.
 */
function applyAssets(view: KernelProjectView, path: string, op: LiveAssetOp): ProjectOpApplied {
    const records = (view.get(path) as Record<string, Record<string, unknown>> | undefined) ?? {};
    if (view.get(path) === undefined) view.set(path, records);
    switch (op.op) {
        case "update-asset":
        case "replace-asset-content":
            if (!records[op.assetId]) return { changed: false, touched: [] };
            records[op.assetId] = { ...(op.record as Record<string, unknown>) };
            break;
        case "move-assets": {
            let moved = false;
            for (const move of op.moves) {
                const record = records[move.assetId];
                if (!record) continue;
                if (move.groupId === null) delete record.groupId;
                else record.groupId = move.groupId;
                moved = true;
            }
            if (!moved) return { changed: false, touched: [] };
            break;
        }
        case "create-assets": {
            let created = false;
            for (const create of op.creates) {
                const record = create.record as Record<string, unknown>;
                if (typeof record.id !== "string" || records[record.id]) continue;
                records[record.id] = { ...record };
                created = true;
            }
            if (!created) return { changed: false, touched: [] };
            break;
        }
        case "delete-assets": {
            let deleted = false;
            for (const assetId of op.assetIds) {
                if (records[assetId]) {
                    delete records[assetId];
                    deleted = true;
                }
            }
            if (!deleted) return { changed: false, touched: [] };
            break;
        }
        default:
            throw unknownVerb(op);
    }
    return { changed: true, touched: [path] };
}

/** Which asset types each section of the browser files. Mirrors `ASSET_CATEGORY_TYPES`. */
export const ASSET_CATEGORY_TYPE_NAMES: Readonly<Record<string, readonly string[]>> = {
    image: ["image"],
    media: ["audio", "video"],
    data: ["json"],
    font: ["font"],
    model: ["model"],
    other: ["other"],
};

function applyAssetFolders(view: KernelProjectView, category: string, path: string, op: LiveAssetFolderOp): ProjectOpApplied {
    const folders = (view.get(path) as Record<string, Record<string, unknown>> | undefined) ?? {};
    if (view.get(path) === undefined) view.set(path, folders);
    switch (op.op) {
        case "set-asset-folder":
            folders[op.folderId] = { ...(op.folder as Record<string, unknown>) };
            return { changed: true, touched: [path] };
        case "delete-asset-folder": {
            const doomed = new Set<string>([op.folderId]);
            if (op.recursive) {
                let grew = true;
                while (grew) {
                    grew = false;
                    for (const folder of Object.values(folders)) {
                        const id = folder.id;
                        const parent = folder.parentGroupId;
                        if (typeof id === "string" && typeof parent === "string" && doomed.has(parent) && !doomed.has(id)) {
                            doomed.add(id);
                            grew = true;
                        }
                    }
                }
            }
            const touched = [path];
            for (const type of ASSET_CATEGORY_TYPE_NAMES[category] ?? []) {
                const shardPath = liveDocumentPath({ doc: "assets", assetType: type });
                const records = view.get(shardPath) as Record<string, Record<string, unknown>> | undefined;
                if (records === undefined) continue;
                let changed = false;
                for (const record of Object.values(records)) {
                    if (typeof record.groupId === "string" && doomed.has(record.groupId)) {
                        delete records[record.id as string];
                        changed = true;
                    }
                }
                if (changed) touched.push(shardPath);
            }
            for (const id of doomed) delete folders[id];
            return { changed: true, touched };
        }
        case "restore-asset-folder": {
            const touched = [path];
            for (const folder of op.folders) {
                if (typeof folder.id === "string") folders[folder.id] = { ...(folder as Record<string, unknown>) };
            }
            for (const { assetType, record } of op.assets) {
                const shardPath = liveDocumentPath({ doc: "assets", assetType });
                const records = (view.get(shardPath) as Record<string, Record<string, unknown>> | undefined) ?? {};
                if (view.get(shardPath) === undefined) view.set(shardPath, records);
                const id = (record as { id?: unknown }).id;
                if (typeof id === "string") {
                    records[id] = { ...(record as Record<string, unknown>) };
                    touched.push(shardPath);
                }
            }
            return { changed: true, touched };
        }
        default:
            throw unknownVerb(op);
    }
}

/**
 * The file transfers an asset operation brings with it: what the server has to collect before a
 * snapshot can hold the bytes, and what every Studio fetches to have the file. Empty for an
 * operation whose bytes are already somewhere in the project (a duplicate, an undo from the trash).
 */
export function assetBytesOf(op: ProjectOp): Array<{ assetType: string; assetId: string; transferId: string; path: string | null; size: number; digest: string }> {
    const found: Array<{ assetType: string; assetId: string; transferId: string; path: string | null; size: number; digest: string }> = [];
    if (op.op === "create-assets") {
        for (const create of op.creates) {
            const id = (create.record as { id?: unknown }).id;
            if (create.bytes.from === "transfer" && typeof id === "string") {
                for (const part of create.bytes.parts) found.push({ assetType: op.assetType, assetId: id, ...part });
            }
        }
    } else if (op.op === "replace-asset-content" && op.bytes.from === "transfer") {
        for (const part of op.bytes.parts) found.push({ assetType: op.assetType, assetId: op.assetId, ...part });
    }
    return found;
}

/**
 * A whole file's transfer, when a `put-file` sends its bytes through the blob store: the server
 * collects them and writes them at the file's path in the next saved version.
 */
export function fileBytesOf(document: ProjectDocument, op: ProjectOp): { path: string; transferId: string; digest: string; size: number } | undefined {
    if (document.doc !== "file" || op.op !== "put-file" || op.content === null || !("blob" in op.content)) {
        return undefined;
    }
    return { path: document.path, ...op.content.blob };
}

/* ------------------------------------------------------------------ whole files */

function applyPutFile(view: KernelProjectView, path: string, op: TeamFileOp): ProjectOpApplied {
    if (!isTeamFilePath(path)) {
        throw new Error(`not a file a team project shares: ${path}`);
    }
    const before = view.get(path);
    if (op.content === null) {
        if (before === undefined) return { changed: false, touched: [] };
        view.delete(path);
        return { changed: true, touched: [path] };
    }
    const content = op.content as TeamFileContent;
    let next: unknown;
    if (isProjectDocumentPath(path)) {
        // A document sent whole - an offline edit to it - is checked exactly as reading it is.
        if (!("encoding" in content) || content.encoding !== "utf8" || typeof content.data !== "string") {
            throw new Error(`a document is put as text: ${path}`);
        }
        next = parseProjectFile(path, content.data);
    } else if ("blob" in content) {
        const blob = content.blob as { transferId?: unknown; digest?: unknown; size?: unknown } | null;
        if (blob === null || typeof blob !== "object" || typeof blob.transferId !== "string" || typeof blob.digest !== "string"
            || !/^[0-9a-f]{64}$/.test(blob.digest) || typeof blob.size !== "number" || !Number.isInteger(blob.size) || blob.size < 0) {
            throw new Error(`a file's transfer is malformed: ${path}`);
        }
        next = { $file: 1, blob: { transferId: blob.transferId, digest: blob.digest, size: blob.size } };
    } else {
        if ((content.encoding !== "utf8" && content.encoding !== "base64") || typeof content.data !== "string") {
            throw new Error(`a file's content is malformed: ${path}`);
        }
        next = { $file: 1, encoding: content.encoding, data: content.data };
    }
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(next)) {
        return { changed: false, touched: [] };
    }
    view.set(path, next);
    return { changed: true, touched: [path] };
}

function contextFor(kind: DocumentKind, path: string, text: string): DocumentParseContext {
    return {
        path,
        corrupt(reason, options) {
            throw new DocumentCorruptError({ kind, path, reason, text, ...options });
        },
    };
}

function unknownVerb(op: { op: string }): Error {
    return new Error(`this kernel does not know the operation ${JSON.stringify(op.op)}`);
}
