/**
 * The story tool's view of a project, as functions of documents rather than of a directory.
 *
 * A story row names things that live in six other documents - characters, the asset metadata, the
 * variable registry, the audio tracks, the app tags, the interface's pages and input actions - and a
 * line can only resolve a name if the list behind it is at hand. {@link ProjectData} is that set of
 * lists. The command line fills it from disk (`project.ts`); Studio's agent bridge fills it from the
 * live services through {@link buildStoryProjectContext}. Either way the same builder the story
 * editor calls (`buildStoryCommandContext`) turns it into what a line resolves against, so a name
 * that resolves in Studio resolves here and a name that does not, does not.
 *
 * Nothing in this file may import a Node module (`agent-core/bundle.test.ts` enforces it).
 *
 * Comments in English per project convention.
 */

import type { StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { AssetType } from "@services/assets/assetTypes";
import type { Asset, AssetsMap } from "@services/assets/types";
import { Character } from "@services/character/Character";
import type { CharacterConfig } from "@services/character/Character";
import { buildStoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandContext";
import type { StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";

// ---------------------------------------------------------------------------
// Stories and scenes
// ---------------------------------------------------------------------------

export type StorySummary = {
    id: string;
    name: string;
    /** Absent on a story the game itself carries; set on one a DLC ships. */
    dlcId?: string;
};

/** The stories the library index (`editor/story/index.json`) lists, in its order. */
export function storySummariesOf(index: { stories?: readonly StorySummary[] } | null | undefined): StorySummary[] {
    return (index?.stories ?? []).map(entry => ({
        id: entry.id,
        name: entry.name,
        ...(entry.dlcId ? { dlcId: entry.dlcId } : {}),
    }));
}

/**
 * One stored story document, migrated the way the editor migrates it on read - so the tool and the
 * editor look at one shape. A document below the migration floor throws, from the migration itself.
 */
export function readableStoryDocument(stored: StoryDocument): StoryDocument {
    return migrateStoryDocumentToLatest(stored);
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
    /** The project directory, for messages only; "" when there is none (Studio, the catalogue). */
    dir: string;
    assets: AssetsMap;
    characters: Character[];
    persistentVariables: VariableRegistryEntry[];
    savedVariables: VariableRegistryEntry[];
    blueprintDocument: BlueprintDocument | null;
    audioTracks: { id: string; name: string }[];
    appTags: { id: string; name: string }[];
    surfaces: { id: string; name: string }[];
    /** The project's input actions, for `/waitinput`, `/hold` and `/mash`. */
    inputActions: { id: string; name: string }[];
    assetSets: { id: string; name: string; type: string }[];
};

export function emptyAssetsMap(): AssetsMap {
    const map = {} as AssetsMap;
    for (const type of Object.values(AssetType)) {
        (map as Record<string, Record<string, Asset>>)[type] = {};
    }
    return map;
}

/**
 * Everything {@link buildStoryProjectContext} reads. Every field is optional, and a missing one is
 * an EMPTY list rather than a guess: an empty list makes every name in that slot unresolved, which
 * is the honest answer, where a guess would be a line that checks clean and plays wrong.
 */
export type StoryProjectDocuments = {
    /** For messages only. */
    dir?: string;
    /**
     * The asset library by type: `assets.metadata.<type>.json` per {@link AssetType}, each a
     * `Record<id, Asset>` - in Studio, `AssetsService`'s map. A type left out is an empty shard.
     */
    assets?: Partial<Record<string, Record<string, Asset>>> | AssetsMap;
    /** `editor/services/character.json`'s `characters`, or live `Character` instances. */
    characters?: readonly (CharacterConfig | Character)[];
    /** `editor/variables.json` (`{ entries }`), or its entries as a list. */
    variableRegistry?: { entries?: Record<string, VariableRegistryEntry> } | readonly VariableRegistryEntry[] | null;
    /** `uigraphs.json`'s `blueprintDocument`, already migrated; names value blueprints and Story Actions. */
    blueprintDocument?: BlueprintDocument | null;
    /** `editor/audio-tracks.json`'s `tracks`. */
    audioTracks?: readonly { id: string; name: string }[];
    /** `editor/app-tags.json`'s `tags`. */
    appTags?: readonly { id: string; name: string }[];
    /** The interface document: its surfaces are what `/quit` and friends name, its actions what `/waitinput` names. */
    uiDocument?: Pick<UIDocument, "surfaces" | "actions"> | null;
    /** Named asset sets, when the caller has them. The command line has none. */
    assetSets?: readonly { id: string; name: string; type: string }[];
};

/**
 * The lists a story line resolves its names against, from the project's documents.
 *
 * The one thing deliberately not supplied is `puppetByCharacterId`: what a puppet character can do
 * is decided by a model file Studio does not parse, and the answer comes from mounting the author's
 * own runtime. Without it those slots degrade to free text, which is what they already are on a
 * machine with no runtime installed - a name still resolves and still builds.
 */
export function buildStoryProjectContext(docs: StoryProjectDocuments = {}): ProjectData {
    const assets = emptyAssetsMap();
    for (const type of Object.values(AssetType)) {
        const shard = (docs.assets as Record<string, Record<string, Asset> | undefined> | undefined)?.[type];
        if (shard) {
            (assets as Record<string, Record<string, Asset>>)[type] = shard;
        }
    }
    const registry = docs.variableRegistry;
    const entries = Array.isArray(registry)
        ? [...registry]
        : Object.values((registry as { entries?: Record<string, VariableRegistryEntry> } | null | undefined)?.entries ?? {});
    const ui = docs.uiDocument ?? null;
    return {
        dir: docs.dir ?? "",
        assets,
        characters: (docs.characters ?? []).map(entry =>
            entry instanceof Character ? entry : Character.fromJSON(entry as CharacterConfig)),
        persistentVariables: entries.filter(entry => entry.scope === "persistent"),
        savedVariables: entries.filter(entry => entry.scope === "saved"),
        blueprintDocument: docs.blueprintDocument ?? null,
        audioTracks: (docs.audioTracks ?? []).map(track => ({ id: track.id, name: track.name })),
        appTags: (docs.appTags ?? []).map(tag => ({ id: tag.id, name: tag.name })),
        surfaces: (ui?.surfaces ?? []).map(surface => ({ id: surface.id, name: surface.name })),
        inputActions: Object.values(ui?.actions ?? {}).map(action => ({ id: action.id, name: action.name })),
        assetSets: (docs.assetSets ?? []).map(set => ({ ...set })),
    };
}

/** An empty project, for the catalogue commands that must answer with no project at all. */
export function emptyProjectData(): ProjectData {
    return buildStoryProjectContext();
}

/**
 * What a line resolves its names against, for one scene.
 *
 * The same builder the story editor calls, given the same shapes read off disk or off services -
 * so a name that resolves in Studio resolves here and a name that does not, does not.
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
        document: documentHolding(document, scene),
        sceneId: scene?.id ?? null,
        scene,
        persistentVariables: data.persistentVariables,
        savedVariables: data.savedVariables,
        blueprintDocument: data.blueprintDocument,
        audioTracks: data.audioTracks,
        appTags: data.appTags,
        surfaces: data.surfaces,
        inputActions: data.inputActions,
    });
}

/**
 * `document` with `scene` in place of its stored copy.
 *
 * The editor builds a line's context from the story it has open, and that story holds the scene being
 * written as it stands. Most names come off the scene alone, but a few are read off the whole story -
 * an ambience overlay outlives its scene, so `/pause rain` looks for the overlay in every one - and a
 * file's second reading resolves against the scene its first reading built, which the stored document
 * does not hold. Without the swap, `/vfx rain name=rain` followed by `/pause rain` took the name for a
 * sound.
 *
 * The scene keeps its stored name: a file that renames its scene is reported, not applied, so the
 * story still calls it what it did.
 */
function documentHolding(document: StoryDocument | null, scene: StoryScene | null): StoryDocument | null {
    const stored = scene ? document?.scenes?.[scene.id] : undefined;
    if (!document || !scene || !stored || stored === scene) {
        return document;
    }
    return { ...document, scenes: { ...document.scenes, [scene.id]: { ...scene, name: stored.name } } };
}
