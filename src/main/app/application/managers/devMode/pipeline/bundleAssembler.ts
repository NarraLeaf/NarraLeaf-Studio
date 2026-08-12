import path from "path";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { parseSharedBlueprintAssetJson } from "@shared/blueprint/parseSharedBlueprintAsset";
import type {
    Blueprint,
    BlueprintPersistentVariable,
    SharedBlueprintAsset,
} from "@shared/types/blueprint/document";
import {
    VARIABLE_REGISTRY_SCHEMA_VERSION,
    type PersistentVariableRuntimeTable,
    type SavedVariableRuntimeTable,
    type VariableRegistry,
} from "@shared/types/variables/registry";
import {
    buildPersistentRuntimeTable,
    buildSavedRuntimeTable,
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
import type { PlayerPreferences } from "@shared/types/preference";
import { normalizePlayerPreferences } from "@shared/types/preference";
import type { AutoSaveConfiguration } from "@shared/types/saves";
import { normalizeAutoSaveConfiguration } from "@shared/types/saves";
import type { GameVoiceBundle } from "@shared/types/voice";
import { normalizeVoiceConfiguration, normalizeVoiceDocument } from "@shared/types/voice";
import type { AudioClipRegion, GameAudioBundle } from "@shared/types/audio";
import { normalizeAudioClipRegion } from "@shared/types/audio";
import type { BrandColor } from "@shared/types/brand";
import { migrateProjectBrandDocument, normalizeProjectBrandColors } from "@shared/types/brand";
import { BRAND_DOCUMENT_PATH } from "@shared/documents/specs";
import {
    APP_TAG_ID_RELEASE,
    appTagMechanismKey,
    isBuiltinAppTagId,
    RELEASE_APP_TAG,
    type AppTagMechanismRef,
} from "@shared/types/appTag";
import { runtimeCapabilitiesCanStartStory } from "@shared/types/pluginPermissions";
import { applyAppTagToStoryDocument, type SceneReachability } from "@shared/story/appTagFold";
import { blueprintGraphCarriers, scanStoryEntryPoints } from "@shared/story/storyReachability";
import {
    applyAppTagToBlueprint,
    applyAppTagToBlueprintDocument,
    collectUnfoldableAppTagGraphsInBlueprint,
    type AppTagGraphFoldOptions,
    type UnfoldableAppTagGraph,
} from "@shared/blueprint/appTagGraphFold";
import { createTranslator, FALLBACK_LOCALE, type LocaleCode } from "@shared/i18n";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import { migrateProjectAudioTrackDocument, normalizeProjectAudioTracks } from "@shared/types/audioTrack";
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
    const variant = context.appTag ?? { id: APP_TAG_ID_RELEASE, name: RELEASE_APP_TAG.name };
    const fold = { tagName: variant.name };
    // Where the variant stops being a label and starts deciding bytes, the blueprint half of what
    // `loadStoryLibrary` does below. Graphs ship verbatim - this record is what the pack carries - so
    // a branch this edition cannot take is only absent from the package if it is deleted here. The
    // build gate has already refused anything this cannot fold; a graph it still cannot read comes
    // back whole, which is what lets Dev Mode and the preview keep running.
    const uigraphs: UIGraphDocument = {
        ...uigraphsRaw,
        blueprintDocument: applyAppTagToBlueprintDocument(
            migrateBlueprintDocumentToLatest(uigraphsRaw.blueprintDocument),
            fold,
        ),
    };
    const localBlueprints = uigraphs.blueprintDocument;
    const variableTables = await loadVariableRuntimeTables(context.projectPath, uigraphsRaw.blueprintDocument);
    const sharedBlueprints = foldSharedBlueprints(await loadSharedBlueprints(context.projectPath), context, fold);
    const projectIdentifier = await readProjectIdentifier(context.projectPath);
    // Read from the folded document on purpose: a `Start Game` on a branch this edition does not take
    // cannot run, so the scene it names is not an entry into any story this package holds.
    const sceneDrop = planSceneDrop(context, variant.id, [
        ...Object.values(localBlueprints.blueprints ?? {}),
        ...sharedBlueprints.map(asset => asset.blueprint),
    ]);
    const storyLibrary = await loadStoryLibrary(context.projectPath, variant, sceneDrop);
    const localization = await loadGameLocalization(context.projectPath);
    const voice = await loadGameVoice(context.projectPath);
    const audio = await loadGameAudio(context.projectPath);
    const autoSave = await loadAutoSaveConfiguration(context.projectPath);
    const preferences = await loadPlayerPreferences(context.projectPath);
    const brand = await loadProjectBrand(context.projectPath);
    return {
        bundleId: context.bundleId,
        revision: context.revision,
        timestamp: new Date().toISOString(),
        ui: {
            uidoc,
            uigraphs,
            localBlueprints,
            sharedBlueprints,
            persistentVariables: variableTables.persistent,
            savedVariables: variableTables.saved,
        },
        storyLibrary,
        localization,
        voice,
        audio,
        autoSave,
        preferences,
        brand,
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
 * Load the project-level variable registry (M-VAR) once and project it to BOTH runtime tables the
 * bundle carries. Prefers `editor/variables.json`; if that file is absent (a project opened only in a
 * pre-M-VAR Studio, or a Dev Mode start before the renderer migrated), it seeds from the legacy
 * `persistentVariables` still on the raw blueprint document, so Dev Mode never loses persistent vars.
 *
 * One read, two projections - not two loaders: the file is a single registry holding both scopes, and
 * reading it twice would let a write landing between the reads hand the bundle a saved table and a
 * persistent table from different revisions of the same file.
 *
 * The legacy branch contributes nothing to the saved table on purpose: the old blueprint field held
 * persistent variables and only persistent variables, so a project that never wrote a registry has no
 * registry-backed saved variables at all - its saved ones are the story's `/save` rows.
 */
async function loadVariableRuntimeTables(
    projectPath: string,
    rawBlueprintDocument: unknown,
): Promise<{ persistent: PersistentVariableRuntimeTable; saved: SavedVariableRuntimeTable }> {
    const registryPath = path.join(projectPath, "editor", "variables.json");
    const raw = await readOptionalJsonFile<unknown>(registryPath);
    if (raw) {
        const registry = migrateVariableRegistryToLatest(raw);
        return { persistent: buildPersistentRuntimeTable(registry), saved: buildSavedRuntimeTable(registry) };
    }
    const legacy = readRawPersistentVariables(rawBlueprintDocument);
    const { entries } = seedRegistryEntriesFromBlueprintPersistent(legacy);
    // Stamped at the current version, not at the version the legacy field belonged to: `entries` was
    // just built by the seeder, so it already has the current shape (scope included) and claiming an
    // older version would only mislead anything that reads it.
    const registry: VariableRegistry = { schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION, entries };
    return { persistent: buildPersistentRuntimeTable(registry), saved: buildSavedRuntimeTable(registry) };
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

/**
 * Shared blueprint assets, folded against this variant - and the one place a variant refusal is
 * raised from the main process rather than from the build gate.
 *
 * **The asymmetry is deliberate; do not tidy it away.** `BuildService`'s gate reads the blueprint
 * *document*, which is the only set of graphs the renderer can see: shared blueprints are asset files,
 * and nothing in the renderer enumerates and parses them. Removal therefore covers strictly more than
 * refusal does, which is the safe direction - nothing ever ships unfolded, and the only cost is that a
 * shared-asset problem is reported here, at assembly, instead of before the build starts.
 *
 * Symmetry the other way round is what would be fatal. Leaving these graphs alone would ship a live
 * `Get App Tag`, and the runtime answers the release name to it (`resolveAppTagNodeOutput`) - so in a
 * Demo package `AppTag == "Demo"` would read false and the player would silently get release content.
 * A silent wrong answer is worse than either a refusal or a leak, because nothing anywhere says it
 * happened.
 *
 * Only a build throws. Dev Mode and the preview supply no variant, so they assemble as release, the
 * runtime's answer is right by construction, and a refused graph there is something the author is
 * still editing rather than something about to be packaged. Exported for tests.
 */
export function foldSharedBlueprints(
    assets: readonly SharedBlueprintAsset[],
    context: DevModeBundleLoadContext,
    fold: AppTagGraphFoldOptions,
): SharedBlueprintAsset[] {
    return assets.map(asset => {
        if (context.appTag) {
            const refused = collectUnfoldableAppTagGraphsInBlueprint(asset.blueprint, fold);
            if (refused.length > 0) {
                throw new Error(describeAppTagGraphRefusal(refused[0], asset.name, context.locale));
            }
        }
        const blueprint = applyAppTagToBlueprint(asset.blueprint, fold);
        return blueprint === asset.blueprint ? asset : { ...asset, blueprint };
    });
}

/**
 * One refusal as the author reads it, through the same catalogue keys the build gate logs.
 *
 * The asset's own name rather than the blueprint's, because a shared blueprint is browsed and opened
 * as an asset; the blueprint's name inside the file is not what the author would go looking for.
 */
function describeAppTagGraphRefusal(
    refusal: UnfoldableAppTagGraph,
    assetName: string,
    locale: LocaleCode | undefined,
): string {
    const { t } = createTranslator(locale ?? FALLBACK_LOCALE);
    const keys = {
        unresolved: "build.appTagGraphUnresolved",
        unknownNode: "build.appTagGraphUnknownNode",
        fnHeadRemoved: "build.appTagGraphFnHead",
    } as const;
    return t(keys[refusal.reason], { blueprint: assetName, graph: refusal.graphName });
}

/**
 * The reachability sweep to run over each story, or `null` to keep every scene.
 *
 * Keyed by story id: a `Start Game` node names one story's scene, and handing that scene to another
 * story would mark an unrelated scene reachable. A story no node names is not absent from the sweep,
 * it simply has no entry beyond its own.
 */
type SceneDropPlan = Map<string, SceneReachability> | null;

/**
 * Which scenes may be dropped from each story, and why the answer is sometimes "none of them".
 *
 * Two conditions have to hold. The build is producing a variant other than release - release cuts
 * nothing, and Dev Mode, the preview and "play from this row" all enter a scene the author picked
 * rather than one the story reaches, so a sweep there would delete the scene about to be played.
 * And every way into a scene has to be one this function can read.
 *
 * The second is where it gives up, and it gives up whole rather than in part: a sweep that dropped
 * "the ones it was sure about" while an unreadable entry survived would be indistinguishable from a
 * correct one until a player walked into the gap. Three things make it unreadable, all of them the
 * same fact - a scene named by a value that only exists while the game runs:
 *
 *  - a `Start Game` node whose story or scene is wired rather than picked - and a wired pin counts
 *    even when the inspector still holds a picked value, because the pin is what the running game
 *    reads;
 *  - a blueprint written in TypeScript, which can call `game.startStory` with anything it computes;
 *  - a runtime plugin whose declared capabilities let it start a story.
 *
 * **Each of the three can be answered instead of merely suffered.** An author who states which
 * scenes a mechanism starts (`context.declaredScenes`) turns it from a reason to ship everything
 * into an ordinary set of entries. That is the only reason this function ever drops anything in a
 * real project: a chapter select is a wired node, and before declarations existed one of them was
 * enough to make every demo the whole book. The renderer refuses the build before it reaches here
 * when a mechanism is undeclared, so these notices are the second line of defence rather than the
 * first - and they still have to be right, because Dev Mode and the preview do not run that gate.
 *
 * Saved games are deliberately not in that list. A save carries compiled action ids, not a scene, and
 * the story it resolves them against is the one compiled from this very package - so it cannot name
 * a scene the package does not have. Exported for tests.
 */
export function planSceneDrop(
    context: DevModeBundleLoadContext,
    appTagId: string,
    blueprints: readonly Blueprint[],
): SceneDropPlan {
    if (isBuiltinAppTagId(appTagId)) {
        return null;
    }
    const declared = context.declaredScenes ?? {};
    const entries: { storyId: string; sceneId: string }[] = [];
    /** Whether this mechanism is answered; collects its scenes when it is. */
    const answered = (mechanism: AppTagMechanismRef): boolean => {
        const scenes = declared[appTagMechanismKey(mechanism)];
        if (!scenes) {
            return false;
        }
        entries.push(...scenes);
        return true;
    };

    for (const plugin of context.runtimePlugins ?? []) {
        if (runtimeCapabilitiesCanStartStory(plugin.runtimeCapabilities)
            && !answered({ kind: "plugin", pluginId: plugin.id })) {
            context.onNotice?.(`the ${plugin.name} plugin can start any scene, so every story ships whole`);
            return null;
        }
    }
    for (const blueprint of blueprints) {
        if (blueprint.program.kind !== "graph"
            && !answered({ kind: "scriptBlueprint", blueprintId: blueprint.id })) {
            context.onNotice?.(`the TypeScript blueprint ${blueprint.name} can start any scene, so every story ships whole`);
            return null;
        }
    }
    const scan = scanStoryEntryPoints(
        blueprintGraphCarriers(blueprints),
        // Every named target is kept: the story documents have not been read at plan time, and a
        // scene id no story has is dropped by the sweep's own seed filter rather than here.
        () => true,
    );
    for (const undecided of scan.undecidable) {
        if (!answered({
            kind: "startStoryNode",
            blueprintId: undecided.blueprintId,
            graphKind: undecided.graphKind,
            graphId: undecided.graphId,
            nodeId: undecided.nodeId,
        })) {
            context.onNotice?.("a Start Game node picks its scene while the game runs, so every story ships whole");
            return null;
        }
    }

    const byStory = new Map<string, SceneReachability>();
    const add = (storyId: string, sceneId: string): void => {
        const existing = byStory.get(storyId);
        byStory.set(storyId, { entrySceneIds: [...(existing?.entrySceneIds ?? []), sceneId] });
    };
    for (const [storyId, sceneIds] of scan.byStory) {
        for (const sceneId of sceneIds) {
            add(storyId, sceneId);
        }
    }
    // A declared scene is an entry exactly like a picked one. One that no longer exists is dropped by
    // the sweep's own seed filter, which is also what reports it to the author through the solver.
    for (const entry of entries) {
        add(entry.storyId, entry.sceneId);
    }
    return byStory;
}

/**
 * Every story the project has, as the bundle will carry it.
 *
 * `variant` is where the build variant stops being a label and starts deciding bytes. The story
 * compiler runs inside the shipped game, not here, so these documents ARE the story a player gets:
 * whatever survives this function ships verbatim. Folding them here - the last point where a
 * document is still a value rather than a serialized pack - is what makes a variant-only branch
 * absent from the package rather than merely unreachable in it, and what makes the story after a cut
 * point absent rather than merely unplayed.
 */
async function loadStoryLibrary(
    projectPath: string,
    variant: { id: string; name: string },
    sceneDrop: SceneDropPlan,
): Promise<DevModeStoryLibrary | undefined> {
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
        documents[entry.id] = applyAppTagToStoryDocument(document, {
            tagName: variant.name,
            tagId: variant.id,
            // A story no `Start Game` node names still gets swept, from its own entry scene: a jump
            // never crosses stories, so nothing outside it can reach one of its scenes.
            ...(sceneDrop ? { sceneReachability: sceneDrop.get(entry.id) ?? { entrySceneIds: [] } } : {}),
        });
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
        assetNames: await loadAssetNames(projectPath),
    };
}

/** The media types a story row can name; a font or a blueprint never appears in a row's sentence. */
const NAMED_ASSET_TYPES = ["image", "audio", "video", "model"] as const;

/**
 * `assetId → name` for the media a story row names.
 *
 * Read from the same flat `assets/assets.metadata.<type>.json` shards the renderer's asset service
 * owns — `{ id: { id, name, ... } }` — and reduced to names alone: this table exists so a Dev Mode
 * row reads `Set background outside_s.jpg`, not so anything downstream can resolve an asset. A
 * missing or broken shard degrades to "no name for that id", which prints the id exactly as before.
 */
async function loadAssetNames(projectPath: string): Promise<Record<string, string>> {
    const names: Record<string, string> = {};
    for (const type of NAMED_ASSET_TYPES) {
        const shardPath = path.join(projectPath, "assets", `assets.metadata.${type}.json`);
        let record: Record<string, unknown> | undefined;
        try {
            record = await readOptionalJsonFile<Record<string, unknown>>(shardPath);
        } catch {
            continue;
        }
        if (!record || typeof record !== "object") {
            continue;
        }
        for (const [assetId, raw] of Object.entries(record)) {
            const name = raw && typeof raw === "object" ? (raw as { name?: unknown }).name : undefined;
            if (typeof name === "string" && name) {
                names[assetId] = name;
            }
        }
    }
    return names;
}

/**
 * The audio payload: the in/out points marked on audio assets, plus the project's audio tracks.
 *
 * Regions come from the same audio shard `loadAssetNames` walks; only marked clips are carried, so
 * a project whose author never opened the audio preview contributes an empty table rather than a
 * row per sound effect. A missing or broken shard degrades to "no regions", which plays every clip
 * whole - exactly the behaviour before regions existed.
 *
 * Tracks come from `editor/audio-tracks.json`, and since v2 they are a **tree**: each one carries a
 * `parentId` and its own live gain, and the game app hands the whole shape to the engine as
 * `GameConfig.audioBuses` at boot. So this is not a lookup table the runtime consults per play - it
 * is the mixer, and losing it means losing every bus the author invented.
 *
 * Absent or unreadable seeds the three built-ins, which is what the renderer's `AudioTrackService`
 * does with the same file: a project that has never opened the Audio surface must play exactly as it
 * did before tracks existed, not silently lose every play. Never returns `undefined` any more -
 * there is always a track list to carry, and the audio bundle is the channel it travels on.
 * Exported for tests.
 */
export async function loadGameAudio(projectPath: string): Promise<GameAudioBundle> {
    const shardPath = path.join(projectPath, "assets", "assets.metadata.audio.json");
    let record: Record<string, unknown> | undefined;
    try {
        record = await readOptionalJsonFile<Record<string, unknown>>(shardPath);
    } catch {
        record = undefined;
    }
    const clips: Record<string, AudioClipRegion> = {};
    if (record && typeof record === "object") {
        for (const [assetId, raw] of Object.entries(record)) {
            const extras = raw && typeof raw === "object" ? (raw as { extras?: unknown }).extras : undefined;
            const region = normalizeAudioClipRegion(extras);
            if (region) {
                clips[assetId] = region;
            }
        }
    }
    return { clips, tracks: await loadProjectAudioTracks(projectPath) };
}

/**
 * `editor/audio-tracks.json`, migrated to v2 and normalized through the same reducer the renderer
 * service uses.
 *
 * The normalizer is load-bearing here rather than cosmetic: the engine's `AudioBusTree.resolve`
 * **throws** on an unknown parent, a duplicate id or a cycle, and it throws lazily - the first time
 * something plays. Repairing the tree on the way in is what keeps a hand-edited file from becoming
 * a game that boots and then goes silent.
 *
 * Every failure path lands on the seeded built-ins rather than propagating: a hand-corrupted track
 * file must not be the reason a build cannot be produced or a Dev Mode session cannot start, and
 * the built-ins are precisely the fallback every unresolved reference already takes.
 */
async function loadProjectAudioTracks(projectPath: string): Promise<ProjectAudioTrack[]> {
    const tracksPath = path.join(projectPath, "editor", "audio-tracks.json");
    try {
        const raw = await readOptionalJsonFile<unknown>(tracksPath);
        return migrateProjectAudioTrackDocument(raw ?? {}).tracks;
    } catch {
        return normalizeProjectAudioTracks([]);
    }
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

/**
 * Load the automatic-saving configuration from `.nlproj` `app.autoSave`. Unlike
 * localization and voice this never returns undefined: autosaving is on by
 * default, so a project that never configured it must still get the defaults
 * rather than nothing. Exported for tests.
 */
export async function loadAutoSaveConfiguration(projectPath: string): Promise<AutoSaveConfiguration> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    return normalizeAutoSaveConfiguration(app?.autoSave);
}

/**
 * Load the player-preference defaults from `.nlproj` `app.preferences`. Dense
 * like the autosave config and for the same reason: the running game holds a
 * value for every preference from the moment it is constructed, so "the author
 * did not choose" has to arrive as the engine's default rather than as a gap.
 * Exported for tests.
 */
export async function loadPlayerPreferences(projectPath: string): Promise<PlayerPreferences> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    return normalizePlayerPreferences(app?.preferences);
}

/**
 * The project's palette from `editor/brand.json`, through the same migration + normalizer the
 * renderer's `BrandService` writes with, so the bundle and the panel can never disagree about what
 * the document said.
 *
 * Dense like the autosave config rather than optional like localization, and for a sharper reason:
 * a `nlbrand:` link is not a colour until a palette is beside it, so "this project has never opened
 * the Brand surface" has to arrive as the seeds rather than as a gap - a gap would make every
 * seeded slot unresolvable in a project that had done nothing wrong. The seeds are exactly what the
 * service would have written on first open, so the two states are indistinguishable downstream.
 *
 * Every failure path lands on that same seed instead of propagating. A hand-corrupted colour file
 * must not be the reason a preview will not start or a build cannot be produced: booting in the
 * default palette is a state the author can see and fix, where a refused start is one they can only
 * guess at. The path comes from the document spec rather than being spelled again here - the spec
 * is what version control keys on, and two spellings would drift in exactly the way nothing
 * reports. Exported for tests.
 */
export async function loadProjectBrand(projectPath: string): Promise<BrandColor[]> {
    const brandPath = path.join(projectPath, BRAND_DOCUMENT_PATH);
    try {
        const raw = await readOptionalJsonFile<unknown>(brandPath);
        return migrateProjectBrandDocument(raw ?? {}).colors;
    } catch {
        return normalizeProjectBrandColors([]);
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
