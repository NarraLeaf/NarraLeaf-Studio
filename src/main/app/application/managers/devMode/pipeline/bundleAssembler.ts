import path from "path";
import { pathToFileURL } from "url";
import { compileProjectScripts } from "./scriptCompiler";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { listSaveSchemaFields, migrateSaveSchemaToLatest } from "@shared/saves/saveSchemaModel";
import type { SaveSchemaRuntimeTable } from "@shared/types/saveSchema";
import type {
    Blueprint,
    BlueprintDocument,
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
} from "@shared/variables/variableRegistryModel";
import type { DevModeBundle, DevModeCharacterSummary, DevModeStoryLibrary } from "@shared/types/devMode";
import type { GameLocalizationBundle, LanguageChangeConfiguration } from "@shared/types/localization";
import {
    normalizeLanguageChangeConfiguration,
    normalizeLocalizationConfiguration,
    normalizeLocalizationDocument,
    normalizeLocalizationKeysDocument,
} from "@shared/types/localization";
import type { DialogueConfiguration } from "@shared/types/dialogue";
import { normalizeWindowConfiguration, type WindowConfiguration } from "@shared/types/appWindow";
import { normalizeDialogueConfiguration } from "@shared/types/dialogue";
import { normalizePreloadConfiguration } from "@shared/types/preload";
import type { PreloadConfiguration } from "@shared/types/preload";
import type { PlayerPreferences } from "@shared/types/preference";
import { normalizePlayerPreferences } from "@shared/types/preference";
import type { AutoSaveConfiguration } from "@shared/types/saves";
import { normalizeAutoSaveConfiguration } from "@shared/types/saves";
import type { SaveCompatibilityConfiguration } from "@shared/types/saveCompatibility";
import { normalizeSaveCompatibilityConfiguration } from "@shared/types/saveCompatibility";
import type { VfxConfiguration } from "@shared/types/vfx";
import { normalizeVfxConfiguration } from "@shared/types/vfx";
import { computeStoryContentHashes } from "@shared/utils/storyContentHash";
import type { GameVoiceBundle } from "@shared/types/voice";
import { normalizeVoiceConfiguration, normalizeVoiceDocument } from "@shared/types/voice";
import type { AudioClipRegion, GameAudioBundle } from "@shared/types/audio";
import { normalizeAudioClipRegion } from "@shared/types/audio";
import type { BrandColor } from "@shared/types/brand";
import { migrateProjectBrandDocument, normalizeProjectBrandColors } from "@shared/types/brand";
import type { ProjectFontEntry } from "@shared/types/typography";
import { BRAND_DOCUMENT_PATH } from "@shared/documents/specs";
import {
    APP_TAG_ID_RELEASE,
    appTagMechanismKey,
    isBuiltinAppTagId,
    RELEASE_APP_TAG,
    resolveAppTag,
    resolveAppTagEndingSurface,
    type AppTagMechanismRef,
} from "@shared/types/appTag";
import { runtimeCapabilitiesCanStartStory } from "@shared/types/pluginPermissions";
import {
    collectTextIds,
    restrictLocalizationToTextIds,
    restrictVoiceToTextIds,
} from "@shared/build/variantPayload";
import {
    materializeStoryAssetSets,
    type AssetSetMaterializationProblem,
} from "@shared/build/assetSetMaterialization";
import {
    attachCharacterAssetSetVariants,
    type AssetSetRecordProblem,
} from "@shared/build/characterAssetSets";
import { attachUiAssetSetVariants } from "@shared/build/uiAssetSets";
import { attachBlueprintAssetSetVariants, blueprintGraphs } from "@shared/build/blueprintAssetSets";
import { normalizeProjectAssetSets, type AssetSet, type AssetSetCandidate } from "@shared/types/assetSet";
import { applyAppTagToStoryDocument, type SceneReachability } from "@shared/story/appTagFold";
import { blueprintGraphCarriers, scanStoryEntryPoints } from "@shared/story/storyReachability";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";
import {
    applyAppTagToBlueprint,
    applyAppTagToBlueprintDocument,
    collectUnfoldableAppTagGraphs,
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
import { refuseNewerProjectDocument, type ProjectDocumentGate } from "@shared/documents/newerSchema";
import { CHARACTER_STORE_VERSION } from "@shared/characters/characterStoreModel";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { ASSET_SET_SCHEMA_VERSION } from "@shared/types/assetSet";
import { AUDIO_TRACK_SCHEMA_VERSION } from "@shared/types/audioTrack";
import { BRAND_SCHEMA_VERSION } from "@shared/types/brand";
import { LOCALIZATION_DOCUMENT_SCHEMA_VERSION, LOCALIZATION_KEYS_SCHEMA_VERSION } from "@shared/types/localization";
import { SAVE_SCHEMA_VERSION } from "@shared/types/saveSchema";
import {
    STORY_ANIMATION_SCHEMA_VERSION,
    STORY_DOCUMENT_SCHEMA_VERSION,
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
} from "@shared/types/story";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { VOICE_DOCUMENT_SCHEMA_VERSION } from "@shared/types/voice";
import { localizeProjectDocumentRefusal, rethrowIfTooNew } from "../../../utils/projectDocumentGate";
import { readProjectAppTagDocumentFromDir } from "../../../utils/appTagsFile";
import type { DevModeBundleLoadContext, DevModeBundleSource } from "./types";

/**
 * Assemble a DevModeBundle by reading `editor/ui/uidoc.json` and `uigraphs.json` from disk.
 *
 * The wrapper exists for one failure: a project file a newer Studio wrote. Every read below refuses
 * one rather than normalizing it away - see `@shared/documents/newerSchema` for why that is worse
 * than stopping - and the refusal is a value carrying the file, its version and this build's, with
 * no prose. Here is where the language is known, so here is where it becomes a sentence. Every host
 * of this assembly prints the message of what it catches, so translating once at the boundary
 * reaches the Dev Mode console, the Dev Mode failure screen, the build report and the command-line
 * build's exit alike.
 */
export async function assembleDevModeBundleFromProjectPath(context: DevModeBundleLoadContext): Promise<DevModeBundle> {
    try {
        return await assembleBundle(context);
    } catch (error) {
        throw localizeProjectDocumentRefusal(error, context.locale);
    }
}

async function assembleBundle(context: DevModeBundleLoadContext): Promise<DevModeBundle> {
    const uidocPath = path.join(context.projectPath, "editor", "ui", "uidoc.json");
    const uigraphsPath = path.join(context.projectPath, "editor", "ui", "uigraphs.json");
    const uidoc = await readJsonFile<UIDocument>(uidocPath, {
        kind: "uiDocument",
        subject: relativeSubject(context.projectPath, uidocPath),
        supportedVersion: UI_DOCUMENT_SCHEMA_VERSION,
    });
    const uigraphsRaw = await readJsonFile<UIGraphDocument>(uigraphsPath, {
        kind: "uiGraphs",
        subject: relativeSubject(context.projectPath, uigraphsPath),
        supportedVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
    });
    // The blueprint document is a field of the graphs file rather than a file of its own, so it
    // carries its own version and needs its own gate: `migrateBlueprintDocumentToLatest` refuses a
    // version outside its band, but the sentence it throws names the floor, which for a document
    // from the future is the wrong number to put in front of an author.
    refuseNewerProjectDocument(uigraphsRaw?.blueprintDocument, {
        kind: "blueprints",
        subject: relativeSubject(context.projectPath, uigraphsPath),
        supportedVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
    });
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
    const variableTables = await loadVariableRuntimeTables(context.projectPath);
    reportLiveVariantReads(context, fold, localBlueprints);
    const projectIdentifier = await readProjectIdentifier(context.projectPath);
    // Read from the folded document on purpose: a `Start Game` on a branch this edition does not take
    // cannot run, so the scene it names is not an entry into any story this package holds.
    const sceneDrop = planSceneDrop(context, variant.id, Object.values(localBlueprints.blueprints ?? {}));
    // The author's scripts, bundled. A failure here is carried as a diagnostic on the blueprint
    // rather than thrown: a script that will not compile is one dead handler, and the rest of the
    // game still has to run - the type check is a lint and the build never depends on one.
    // Dev Mode's answer when the host gives none: under `.nlstudio/`, which version control and a
    // project export both exclude, beside the rest of what a Dev Mode run produces, named as `file:`
    // URLs because that is what the Dev Mode document's policy admits. A build says where the pack
    // is being assembled and names the pack's own scheme.
    const scripts = await compileProjectScripts(
        context.projectPath,
        localBlueprints,
        context.scriptOutput ?? {
            directory: path.join(context.projectPath, ".nlstudio", "dev-mode", "scripts"),
            toUrl: filePath => pathToFileURL(filePath).toString(),
        },
    );
    // A script that did not compile is a handler that will not run, and a build that says nothing
    // about it ships a control that does nothing. Each distinct file is said once - two blueprints
    // may name one script - and it stays a notice rather than a failure, because the type check is
    // a lint and a build never depends on one.
    for (const message of new Set(
        Object.values(scripts).flatMap(script => (script.diagnostics ?? []).map(d => d.message)),
    )) {
        context.onNotice?.(message);
    }
    // A host that stated a selection gets exactly it; one that said nothing carries every DLC the
    // project has. See `DevModeBundleLoadContext.includedDlc`.
    const carriedDlc = context.includedDlc ? new Set(context.includedDlc) : null;
    const storyLibrary = await loadStoryLibrary(context.projectPath, variant, sceneDrop, carriedDlc);
    // Translations and voice lines are keyed by a row's `textId`, not by a scene, so dropping a scene
    // leaves both behind: the prose is gone from the story document and still legible, in full, in
    // every translation table the package carries. They are narrowed against the documents as this
    // build actually holds them, which is why this happens here rather than in either loader.
    const shippedTextIds = sceneDrop ? collectTextIds(storyLibrary?.documents ?? {}) : null;
    const localization = restrictLocalization(
        // The scene-name table is attached before the narrowing, not after: it is read as the set of
        // scenes this build still has, which is exactly what decides whether a `scene:` unit ships.
        withSceneNames(await loadGameLocalization(context.projectPath), storyLibrary?.documents),
        shippedTextIds,
        context.onNotice,
    );
    // After `localization`, because filling a set is a question about the project's languages and
    // their declared fallbacks; before everything else, because what it rewrites is the story the
    // rest of this bundle describes.
    const resolvedStoryLibrary = await materializeAssetSets(context, storyLibrary, localization, variant.name);
    // The other half: the sets named by content that has no rows to write an answer into. Read after
    // the story pass so both are resolved against the same library and the same edition, and against
    // the story library this build actually ships - a character dropped with its chapter names no set.
    await resolveCharacterAssetSets(context, resolvedStoryLibrary?.characters, localization, variant.name);
    // And the third: the interface names sets from its widgets and its Surfaces, which have no rows
    // and are not characters. Same library, same edition, same refusal.
    await resolveUiAssetSets(context, uidoc, localization, variant.name);
    // And the fourth: a blueprint's asset pins. After the fold above on purpose - a branch this
    // edition cannot take has already been deleted, so a set named only from there is not this
    // package's problem and must not be able to refuse its build.
    await resolveBlueprintAssetSets(
        context,
        Object.values(localBlueprints.blueprints ?? {}),
        localization,
        variant.name,
    );
    const voice = restrictVoice(await loadGameVoice(context.projectPath), shippedTextIds, context.onNotice);
    const audio = await loadGameAudio(context.projectPath);
    const autoSave = await loadAutoSaveConfiguration(context.projectPath);
    const languageChange = await loadLanguageChangeConfiguration(context.projectPath);
    const saveCompatibility = await loadSaveCompatibilityConfiguration(context.projectPath);
    const dialogue = await loadDialogueConfiguration(context.projectPath);
    const preload = await loadPreloadConfiguration(context.projectPath);
    const window = await loadWindowConfiguration(context.projectPath);
    const vfx = await loadVfxConfiguration(context.projectPath);
    const gameVersion = await loadGameVersion(context.projectPath);
    const preferences = await loadPlayerPreferences(context.projectPath);
    const brand = await loadProjectBrand(context.projectPath);
    const fonts = await loadProjectFonts(context.projectPath);
    const saveSchema = await loadSaveSchemaTable(context.projectPath);
    const endingSurfaceId = await loadEndingSurfaceId(context.projectPath, variant.id);
    return {
        bundleId: context.bundleId,
        revision: context.revision,
        timestamp: new Date().toISOString(),
        // Only when a selection was named. Absent has a meaning of its own - every DLC - and an
        // empty list would be a different claim.
        ...(carriedDlc ? { installedDlc: [...carriedDlc] } : {}),
        // Only when the project named one. Blank and absent mean the same thing to a host, and an
        // empty string in the bundle would read as a surface id that could not be resolved.
        ...(endingSurfaceId ? { endingSurfaceId } : {}),
        ui: {
            uidoc,
            uigraphs,
            localBlueprints,
            persistentVariables: variableTables.persistent,
            savedVariables: variableTables.saved,
            saveSchema,
            scripts,
        },
        storyLibrary: resolvedStoryLibrary,
        localization,
        voice,
        audio,
        autoSave,
        languageChange,
        saveCompatibility,
        dialogue,
        preload,
        window,
        vfx,
        gameVersion,
        // Taken off the library this build actually ships, after the variant fold and any scene
        // drop, so two editions that carry different chapters do not claim the same story. One
        // fingerprint per story: a save belongs to one of them, and asking whether the whole
        // library changed retires a player's saves on one route because another was patched.
        storyHashes: computeStoryContentHashes(resolvedStoryLibrary?.documents),
        preferences,
        brand,
        fonts,
        compiled: context.compiled,
        meta: projectIdentifier ? { projectIdentifier } : undefined,
    };
}

/**
 * What a refusal calls a file: its path inside the project.
 *
 * The project's own directory is not part of it. An author is being told which of *their* files
 * this is, and the absolute path is both longer than the answer and specific to the machine.
 */
function relativeSubject(projectPath: string, filePath: string): string {
    return path.relative(projectPath, filePath).split(path.sep).join("/");
}

/**
 * `gate` is what stops a document a newer Studio wrote from reaching the normalizers below.
 *
 * Checked here, between the parse and the first reader, because that is the only point where the
 * document is still exactly what is on disk: one line further on a normalizer has already dropped
 * whatever it did not recognise, and nothing downstream can tell that from a file that never had it.
 */
async function readOptionalJsonFile<T>(filePath: string, gate?: ProjectDocumentGate): Promise<T | undefined> {
    const result = await Fs.read(filePath, "utf-8");
    if (!result.ok) {
        return undefined;
    }
    const parsed = parseJsonFile(filePath, result.data);
    if (gate) {
        refuseNewerProjectDocument(parsed, gate);
    }
    return parsed as T;
}

async function readJsonFile<T>(filePath: string, gate?: ProjectDocumentGate): Promise<T> {
    const result = await Fs.read(filePath, "utf-8");
    if (!result.ok) {
        throw new Error(result.error?.message ?? `Failed to read ${filePath}`);
    }
    const parsed = parseJsonFile(filePath, result.data);
    if (gate) {
        refuseNewerProjectDocument(parsed, gate);
    }
    return parsed as T;
}

function parseJsonFile(filePath: string, text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Invalid JSON in ${filePath}: ${msg}`);
    }
}

/**
 * Load blueprint-type assets from metadata shard + content shards (same layout as renderer Assets pipeline).
 */
/**
 * Load the project-level variable registry once and project it to BOTH runtime tables the bundle
 * carries. An absent `editor/variables.json` is a project that has never declared a project-scoped
 * variable, and reads as two empty tables.
 *
 * One read, two projections - not two loaders: the file is a single registry holding both scopes, and
 * reading it twice would let a write landing between the reads hand the bundle a saved table and a
 * persistent table from different revisions of the same file.
 */
async function loadVariableRuntimeTables(
    projectPath: string,
): Promise<{ persistent: PersistentVariableRuntimeTable; saved: SavedVariableRuntimeTable }> {
    const registryPath = path.join(projectPath, "editor", "variables.json");
    const raw = await readOptionalJsonFile<unknown>(registryPath, {
        kind: "variables",
        subject: relativeSubject(projectPath, registryPath),
        supportedVersion: VARIABLE_REGISTRY_SCHEMA_VERSION,
    });
    if (raw) {
        const registry = migrateVariableRegistryToLatest(raw);
        return { persistent: buildPersistentRuntimeTable(registry), saved: buildSavedRuntimeTable(registry) };
    }
    const registry: VariableRegistry = { schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION, entries: {} };
    return { persistent: buildPersistentRuntimeTable(registry), saved: buildSavedRuntimeTable(registry) };
}

/**
 * Load the project-level save schema: what one save slot carries besides the engine's own record.
 *
 * Absent is a working state, not a failure - it is what every project written before the schema
 * existed looks like, and an empty table simply means the save nodes keep their raw `metadata` pin
 * and grow none of their own. Unreadable takes the same path for the same reason it does in the
 * renderer service: a Dev Mode run that refuses to start over a malformed table teaches nothing that
 * the empty table plus a lint error does not.
 */
async function loadSaveSchemaTable(projectPath: string): Promise<SaveSchemaRuntimeTable> {
    const schemaPath = path.join(projectPath, "editor", "save-schema.json");
    const raw = await readOptionalJsonFile<unknown>(schemaPath, {
        kind: "saveSchema",
        subject: relativeSubject(projectPath, schemaPath),
        supportedVersion: SAVE_SCHEMA_VERSION,
    });
    return raw ? listSaveSchemaFields(migrateSaveSchemaToLatest(raw)) : [];
}


/**
 * Tell a non-packaging host which graphs still ask which edition they are.
 *
 * A graph the fold cannot reduce keeps its `Get App Tag` node, and the node answers the release name
 * wherever it is read (`resolveAppTagNodeOutput` is a constant). Running as the demo, that is a
 * wrong answer rather than a missing one - so an author who sees release content on a demo run has
 * to be able to find out why, from the same console the rest of the run reports to.
 *
 * A build never reaches this: it refuses those graphs outright, at the gate and again at assembly.
 * So this is the *only* place the situation is describable, and saying nothing is what would make it
 * a mystery.
 */
function reportLiveVariantReads(
    context: DevModeBundleLoadContext,
    fold: AppTagGraphFoldOptions,
    document: BlueprintDocument | null,
): void {
    if (!context.appTag || context.packaging || !context.onNotice) {
        return;
    }
    const distinct = [...new Set(
        collectUnfoldableAppTagGraphs(document, fold).map(graph => graph.blueprintName),
    )];
    if (distinct.length === 0) {
        return;
    }
    context.onNotice(
        `${distinct.join(", ")} still asks which edition it is, and this run cannot fold the answer in, `
        + `so it reads "${RELEASE_APP_TAG.name}" there. A build refuses those graphs.`,
    );
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
    if (isBuiltinAppTagId(appTagId) || !context.packaging) {
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
/**
 * @param carriedDlc the DLC ids this package holds, or null to carry every story the project has.
 */
async function loadStoryLibrary(
    projectPath: string,
    variant: { id: string; name: string },
    sceneDrop: SceneDropPlan,
    carriedDlc: ReadonlySet<string> | null,
): Promise<DevModeStoryLibrary | undefined> {
    const indexPath = path.join(projectPath, "editor", "story", "index.json");
    const index = await readOptionalJsonFile<StoryLibraryIndex>(indexPath, {
        kind: "storyIndex",
        subject: relativeSubject(projectPath, indexPath),
        supportedVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
    });
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
        // Before the document is read, not after: a story this package does not carry must not be
        // loaded at all, so that no later pass can find its prose and copy it somewhere - a
        // translation table, a voice index, an asset sweep - that does ship.
        if (entry.dlcId && carriedDlc && !carriedDlc.has(entry.dlcId)) {
            continue;
        }
        const documentPath = resolveStoryDocumentPathForIndexEntry(projectPath, entry);
        if (!documentPath) {
            continue;
        }
        // Migrated here, not trusted from disk. The story compiler runs on whatever this function
        // returns, and it only reads the CURRENT schema: a row written by an older Studio and never
        // re-saved compiles to nothing at all, with no diagnostic - a `/transform camera look=` that
        // plays and grades nothing, a `/transform` preset that never moves its sprite. The editor
        // migrates on load, but a document is only rewritten when the author edits it, so "opened the
        // project once" is not enough and cannot be made enough.
        // Named by the story's own name rather than by its path: the path is made of an id, and an
        // id is not something to put in front of an author.
        const document = migrateStoryDocumentToLatest(await readJsonFile<StoryDocument>(documentPath, {
            kind: "story",
            subject: entry.name || entry.id,
            supportedVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        }));
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

/* -------------------------------------------------------------------------- */
/* Asset sets                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Resolve every asset set a story names, and refuse to package a story that still names one.
 *
 * A set names its members by tag; a shipped game has no tags. This is where the question becomes an
 * answer - see `@shared/build/assetSetMaterialization` for why the answer is written into each row
 * rather than into a table the pack would have to carry.
 *
 * Only a build refuses, the same rule the blueprint fold above follows: Dev Mode packages nothing,
 * so an unfinished set there is a line in the console and a stage the author can still walk through.
 * A build that let it past would produce the one failure this whole path exists to prevent - a
 * package that installs cleanly and shows one language nothing at all.
 */
async function materializeAssetSets(
    context: DevModeBundleLoadContext,
    storyLibrary: DevModeStoryLibrary | undefined,
    localization: GameLocalizationBundle | undefined,
    variantName: string,
): Promise<DevModeStoryLibrary | undefined> {
    if (!storyLibrary || Object.keys(storyLibrary.documents ?? {}).length === 0) {
        return storyLibrary;
    }
    const sets = await loadAssetSets(context.projectPath);
    if (sets.length === 0) {
        return storyLibrary;
    }
    const result = materializeStoryAssetSets({
        documents: storyLibrary.documents,
        sets,
        candidates: await loadAssetSetCandidates(context.projectPath),
        localization,
        assetAxes: context.assetAxes,
    });
    for (const problem of result.problems) {
        const sentence = describeAssetSetProblem(problem, storyLibrary, variantName);
        if (context.packaging) {
            throw new Error(sentence);
        }
        context.onNotice?.(sentence);
    }
    if (result.collapsedBuildAxis) {
        // The caller has to narrow the library now, whichever edition this is. See
        // `AssetSetMaterializationResult.collapsedBuildAxis`.
        context.onAssetSetCollapse?.();
    }
    return { ...storyLibrary, documents: result.documents };
}

/**
 * Resolve the sets a character names, and refuse to package one that cannot be.
 *
 * The same rule as the story pass in every respect that matters - resolved against the same library
 * and the same edition, refused on a build, reported as a notice in Dev Mode - and different in the
 * one the content forces: a character has no row to write the answer into, so the answer goes on the
 * pose, the layer or the avatar entry that named the set. See `@shared/build/characterAssetSets`.
 */
async function resolveCharacterAssetSets(
    context: DevModeBundleLoadContext,
    characters: readonly DevModeCharacterSummary[] | undefined,
    localization: GameLocalizationBundle | undefined,
    variantName: string,
): Promise<void> {
    const sets = await loadAssetSets(context.projectPath);
    if (sets.length === 0) {
        return;
    }
    // In place: these records were built moments ago on their way into a package, and the editor's
    // own copies live in another process.
    const result = attachCharacterAssetSetVariants({
        characters,
        sets,
        candidates: await loadAssetSetCandidates(context.projectPath),
        localization,
        assetAxes: context.assetAxes,
    });
    for (const problem of result.problems) {
        const sentence = describeShippedAssetSetProblem(problem, variantName);
        if (context.packaging) {
            throw new Error(sentence);
        }
        context.onNotice?.(sentence);
    }
    if (result.collapsedBuildAxis) {
        context.onAssetSetCollapse?.();
    }
}

/**
 * Resolve the sets the interface names, and refuse to package one that cannot be.
 *
 * The same rule as the two passes above in every respect that matters, and different in the one the
 * content forces: a widget has no row to write the answer into, so the answer goes on the element -
 * or, for a Surface's own background, on that Surface's settings. See `@shared/build/uiAssetSets`
 * for why the reference point rather than a document-wide table.
 */
async function resolveUiAssetSets(
    context: DevModeBundleLoadContext,
    document: UIDocument | undefined,
    localization: GameLocalizationBundle | undefined,
    variantName: string,
): Promise<void> {
    const sets = await loadAssetSets(context.projectPath);
    if (sets.length === 0) {
        return;
    }
    const result = attachUiAssetSetVariants({
        document,
        sets,
        candidates: await loadAssetSetCandidates(context.projectPath),
        localization,
        assetAxes: context.assetAxes,
    });
    for (const problem of result.problems) {
        const sentence = describeShippedAssetSetProblem(problem, variantName);
        if (context.packaging) {
            throw new Error(sentence);
        }
        context.onNotice?.(sentence);
    }
    if (result.collapsedBuildAxis) {
        context.onAssetSetCollapse?.();
    }
}

/**
 * Resolve the sets a blueprint's asset pins name, and refuse to package one that cannot be.
 *
 * The answer goes on the node that STORES the id, which is not always the node that consumes it:
 * an asset pin can be fed by an edge from a literal. See `@shared/build/blueprintAssetSlots` for
 * why this walk knows fewer pins than the reference index does, and why that asymmetry is what
 * keeps a plugin's own pin refused rather than half-supported.
 */
async function resolveBlueprintAssetSets(
    context: DevModeBundleLoadContext,
    blueprints: readonly Blueprint[],
    localization: GameLocalizationBundle | undefined,
    variantName: string,
): Promise<void> {
    const sets = await loadAssetSets(context.projectPath);
    if (sets.length === 0) {
        return;
    }
    const result = attachBlueprintAssetSetVariants({
        graphs: blueprintGraphs(blueprints),
        sets,
        candidates: await loadAssetSetCandidates(context.projectPath),
        localization,
        assetAxes: context.assetAxes,
    });
    for (const problem of result.problems) {
        const sentence = describeShippedAssetSetProblem(problem, variantName);
        if (context.packaging) {
            throw new Error(sentence);
        }
        context.onNotice?.(sentence);
    }
    if (result.collapsedBuildAxis) {
        context.onAssetSetCollapse?.();
    }
}

/**
 * The same sentence the story faults get, with the part of the project in place of the scene.
 *
 * The set's name is what the author acts on either way; what changes is where to go and look, and
 * "in the interface" is as precise as a scan of the document can honestly be.
 */
function describeShippedAssetSetProblem(problem: AssetSetRecordProblem, variantName: string): string {
    const set = `Asset set "${problem.setName}", used in ${problem.slice}`;
    if (problem.kind === "ambiguous") {
        return `${set}, has more than one asset for ${problem.axisKey} ${problem.value}.`;
    }
    if (problem.kind === "unsupported") {
        const reason = problem.reason === "multipleAxes"
            ? "has more than one axis, which this build cannot resolve yet"
            : "declares no axis to resolve";
        return `${set}, ${reason}.`;
    }
    if (problem.kind === "axisUnset") {
        return `${set}, resolves ${problem.axisKey} when the game is built, and "${variantName}" does not say which ${problem.axisKey} it is.`;
    }
    const coordinate = problem.value ? `${problem.axisKey} ${problem.value}` : "the project's language";
    return `${set}, has no asset for ${coordinate}.`;
}

/**
 * What the author is told, naming the scene rather than the block id.
 *
 * A build failure has to be actionable from the sentence alone: which set, which coordinate, and
 * where it is used. The set's *members* are never named - a set is resolved by tag, so the file to
 * import does not exist yet and there is no name to print. For a build axis there is a second
 * reason: the variants an edition did not take must not be named anywhere a log can reach.
 */
function describeAssetSetProblem(
    problem: AssetSetMaterializationProblem,
    storyLibrary: DevModeStoryLibrary,
    variantName: string,
): string {
    const scene = storyLibrary.documents[problem.storyId]?.scenes?.[problem.sceneId];
    const where = scene?.name ? `"${scene.name}"` : problem.sceneId;
    const set = `Asset set "${problem.setName}", used in ${where}`;
    if (problem.kind === "ambiguous") {
        return `${set}, has more than one asset for ${problem.axisKey} ${problem.value}.`;
    }
    if (problem.kind === "unsupported") {
        const reason = problem.reason === "multipleAxes"
            ? "has more than one axis, which this build cannot resolve yet"
            : "declares no axis to resolve";
        return `${set}, ${reason}.`;
    }
    if (problem.kind === "axisUnset") {
        return `${set}, resolves ${problem.axisKey} when the game is built, and "${variantName}" does not say which ${problem.axisKey} it is.`;
    }
    const coordinate = problem.value ? `${problem.axisKey} ${problem.value}` : "the project's language";
    return `${set}, has no asset for ${coordinate}.`;
}

/** The sets the project declares. Absent or unreadable is "no sets", which changes nothing. */
async function loadAssetSets(projectPath: string): Promise<AssetSet[]> {
    const setsPath = path.join(projectPath, "editor", "asset-sets.json");
    let raw: unknown;
    try {
        raw = await readOptionalJsonFile<unknown>(setsPath, {
            kind: "assetSets",
            subject: relativeSubject(projectPath, setsPath),
            supportedVersion: ASSET_SET_SCHEMA_VERSION,
        });
    } catch (error) {
        rethrowIfTooNew(error);
        return [];
    }
    return raw ? normalizeProjectAssetSets(raw).sets : [];
}

/**
 * The library as tag resolution sees it: id, type and the author's tags.
 *
 * Read from the same shards {@link loadAssetNames} reads, and for the opposite reason - that one
 * wants the name a row prints, this one wants the tags that decide which row means which file.
 */
async function loadAssetSetCandidates(projectPath: string): Promise<AssetSetCandidate[]> {
    const candidates: AssetSetCandidate[] = [];
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
            const entry = raw && typeof raw === "object" ? raw as { tags?: unknown } : undefined;
            const tags = Array.isArray(entry?.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [];
            candidates.push({ id: assetId, type, tags });
        }
    }
    return candidates;
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
        const raw = await readOptionalJsonFile<unknown>(tracksPath, {
            kind: "audioTracks",
            subject: relativeSubject(projectPath, tracksPath),
            supportedVersion: AUDIO_TRACK_SCHEMA_VERSION,
        });
        return migrateProjectAudioTrackDocument(raw ?? {}).tracks;
    } catch (error) {
        rethrowIfTooNew(error);
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
    const animationGate = (filePath: string): ProjectDocumentGate => ({
        kind: "storyAnimation",
        subject: relativeSubject(projectPath, filePath),
        supportedVersion: STORY_ANIMATION_SCHEMA_VERSION,
    });
    const index = await readOptionalJsonFile<StoryAnimationIndex>(indexPath, animationGate(indexPath));
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
        const animation = await readOptionalJsonFile<StoryAnimationAsset>(animationPath, animationGate(animationPath));
        if (!animation || animation.id !== entry.id) {
            continue;
        }
        animations[entry.id] = animation;
    }
    return animations;
}

async function loadCharacterSummaries(projectPath: string): Promise<DevModeCharacterSummary[]> {
    const storePath = path.join(projectPath, "editor", "services", "character.json");
    // The character store versions itself as `version`, not `schemaVersion`: it predates the
    // convention, and reading the usual field here would gate nothing at all.
    const store = await readOptionalJsonFile<{ characters?: unknown[] }>(storePath, {
        kind: "characters",
        subject: relativeSubject(projectPath, storePath),
        supportedVersion: CHARACTER_STORE_VERSION,
        field: "version",
    });
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
            const tablePath = path.join(projectPath, "editor", "localization", `${locale.code}.json`);
            raw = await readOptionalJsonFile<unknown>(tablePath, {
                kind: "localization",
                subject: relativeSubject(projectPath, tablePath),
                supportedVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
            });
        } catch (error) {
            rethrowIfTooNew(error);
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
        const keysPath = path.join(projectPath, "editor", "localization", "keys.json");
        const rawKeys = await readOptionalJsonFile<unknown>(keysPath, {
            kind: "localizationKeys",
            subject: relativeSubject(projectPath, keysPath),
            supportedVersion: LOCALIZATION_KEYS_SCHEMA_VERSION,
        });
        if (rawKeys) {
            const keysDocument = normalizeLocalizationKeysDocument(rawKeys);
            const entries = Object.entries(keysDocument.keys);
            if (entries.length > 0) {
                keys = Object.fromEntries(entries.map(([name, definition]) => [name, definition.sourceText]));
            }
        }
    } catch (error) {
        rethrowIfTooNew(error);
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
            const tablePath = path.join(projectPath, "editor", "voice", `${locale.code}.json`);
            raw = await readOptionalJsonFile<unknown>(tablePath, {
                kind: "voice",
                subject: relativeSubject(projectPath, tablePath),
                supportedVersion: VOICE_DOCUMENT_SCHEMA_VERSION,
            });
        } catch (error) {
            rethrowIfTooNew(error);
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
 * Load what a language change does mid-playthrough from `.nlproj` `app.languageChange`. Dense like
 * the autosave config, and for the same reason: every build has an answer to this whether or not
 * the author ever opened the setting. Exported for tests.
 */
export async function loadLanguageChangeConfiguration(
    projectPath: string,
): Promise<LanguageChangeConfiguration> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    return normalizeLanguageChangeConfiguration(app?.languageChange);
}

/**
 * Load the save-compatibility policy from `.nlproj` `app.saveCompatibility`. Dense like the
 * autosave config: every save this build writes carries a stamp and every load compares one, so
 * "the author never chose" has to arrive as the defaults rather than as a gap. Exported for tests.
 */
export async function loadSaveCompatibilityConfiguration(
    projectPath: string,
): Promise<SaveCompatibilityConfiguration> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    return normalizeSaveCompatibilityConfiguration(app?.saveCompatibility);
}

/**
 * Load the author's dialogue settings from `.nlproj` `app.dialogue`. Dense like the autosave config:
 * the engine reads a pause length for every line whether or not the author ever opened the page.
 * Exported for tests.
 */
export async function loadDialogueConfiguration(projectPath: string): Promise<DialogueConfiguration> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    return normalizeDialogueConfiguration(app?.dialogue);
}

/**
 * Load the preload behavior from `.nlproj` `app.preload`. Dense like the ones above: the engine is
 * configured with a gate at boot whether or not the author ever opened the page. Exported for tests.
 */
export async function loadPreloadConfiguration(projectPath: string): Promise<PreloadConfiguration> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    return normalizePreloadConfiguration(app?.preload);
}

/**
 * Load the window settings from `.nlproj` `app.window`. Dense like the ones above: the shell opens
 * a window on every launch whether or not the author ever opened the page, and the game's own
 * configuration screen reads the offered sizes out of the same field. Exported for tests.
 */
export async function loadWindowConfiguration(projectPath: string): Promise<WindowConfiguration> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    return normalizeWindowConfiguration(app?.window);
}

/**
 * The page this session ends on, resolved for the variant it is assembled as.
 *
 * The same read the pack compiler makes, from the same document, so a story that falls off the end
 * lands on the same page in Dev Mode as in a build - and an author can see the page they authored
 * for it without packaging one. Per variant for the reason the addresses are: the demo's ending is
 * not the full game's, and one story document produces both.
 *
 * A document that will not parse leaves the session with no ending page rather than failing the
 * assembly: this is one field of a bundle, and a session that will not start over it is worse than
 * a story that stops where it always used to. Exported for tests.
 */
export async function loadEndingSurfaceId(projectPath: string, appTagId: string): Promise<string> {
    try {
        const document = await readProjectAppTagDocumentFromDir(projectPath);
        return resolveAppTagEndingSurface(resolveAppTag(document.tags, appTagId), document.endingSurfaceId).value;
    } catch {
        return "";
    }
}

/**
 * Load the frame rate screen effects are baked at from `.nlproj` `app.vfx`. Dense like the ones
 * above, and load-bearing rather than informational: this is what the running game computes a clip
 * id from, and the packer computed the ids it shipped from the same file. Exported for tests.
 */
export async function loadVfxConfiguration(projectPath: string): Promise<VfxConfiguration> {
    const config = await readProjectConfigRecord(projectPath);
    const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
    return normalizeVfxConfiguration(app?.vfx);
}

/**
 * The author's own version for this build, from `.nlproj` `metadata.version`.
 *
 * Read verbatim - never parsed, never defaulted to something like `0.0.0`. A project with no
 * version has no version, and inventing one would make two builds that both left it blank look
 * like two versions of the same game to every save either of them writes. Exported for tests.
 */
export async function loadGameVersion(projectPath: string): Promise<string> {
    const config = await readProjectConfigRecord(projectPath);
    const metadata = config?.metadata && typeof config.metadata === "object"
        ? config.metadata as Record<string, unknown>
        : undefined;
    return typeof metadata?.version === "string" ? metadata.version.trim() : "";
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
        const raw = await readOptionalJsonFile<unknown>(brandPath, BRAND_GATE);
        return migrateProjectBrandDocument(raw ?? {}).colors;
    } catch (error) {
        rethrowIfTooNew(error);
        return normalizeProjectBrandColors([]);
    }
}

/**
 * The project's default font stack, out of the same document and through the same migration.
 *
 * Every failure path lands on the empty stack for the reason {@link loadProjectBrand} lands on the
 * seeds: a hand-corrupted design file must not be why a preview will not start. The difference is
 * that an empty stack is not a fallback here, it is the ordinary state - most projects have never
 * chosen a default font, and text renders in the host's own family exactly as it did before this
 * existed. Exported for tests.
 */
export async function loadProjectFonts(projectPath: string): Promise<ProjectFontEntry[]> {
    const brandPath = path.join(projectPath, BRAND_DOCUMENT_PATH);
    try {
        const raw = await readOptionalJsonFile<unknown>(brandPath, BRAND_GATE);
        return migrateProjectBrandDocument(raw ?? {}).fonts;
    } catch (error) {
        rethrowIfTooNew(error);
        return [];
    }
}

/**
 * The design document is read twice - once for its colours, once for its fonts - and both reads
 * refuse the same file at the same version, so they state it once.
 */
const BRAND_GATE: ProjectDocumentGate = {
    kind: "brand",
    subject: BRAND_DOCUMENT_PATH,
    supportedVersion: BRAND_SCHEMA_VERSION,
};

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

/**
 * Keep the translations for rows this build still has.
 *
 * `textIds` is null for the release edition, where nothing was dropped and there is nothing to
 * narrow against. The count is reported rather than silent: a translation that stops shipping is
 * invisible in the artifact, and the one mistake worth catching early is a narrowing that took away
 * a line the player can still reach.
 */
/**
 * Attach the source-language name of every scene the build carries.
 *
 * The per-locale files hold only the translated side, so this is what a `scene:` reference resolves
 * to when the game is being read in its source language - the same job `keys` does for named keys.
 */
function withSceneNames(
    bundle: GameLocalizationBundle | undefined,
    documents: Record<string, StoryDocument> | undefined,
): GameLocalizationBundle | undefined {
    if (!bundle) {
        return bundle;
    }
    const scenes: Record<string, string> = {};
    for (const document of Object.values(documents ?? {})) {
        for (const scene of Object.values(document.scenes ?? {})) {
            if (scene?.id && typeof scene.name === "string" && scene.name.trim()) {
                scenes[scene.id] = scene.name;
            }
        }
    }
    return { ...bundle, scenes };
}

function restrictLocalization(
    bundle: GameLocalizationBundle | undefined,
    textIds: ReadonlySet<string> | null,
    onNotice: DevModeBundleLoadContext["onNotice"],
): GameLocalizationBundle | undefined {
    if (!bundle || !textIds) {
        return bundle;
    }
    const result = restrictLocalizationToTextIds(bundle, textIds);
    if (result.removedUnitCount > 0) {
        onNotice?.(`${result.removedUnitCount} translations belong to removed rows and do not ship`);
    }
    return result.bundle;
}

/** The same narrowing for voice lines; each one dropped also drops its recording from the package. */
function restrictVoice(
    bundle: GameVoiceBundle | undefined,
    textIds: ReadonlySet<string> | null,
    onNotice: DevModeBundleLoadContext["onNotice"],
): GameVoiceBundle | undefined {
    if (!bundle || !textIds) {
        return bundle;
    }
    const result = restrictVoiceToTextIds(bundle, textIds);
    if (result.removedUnitCount > 0) {
        onNotice?.(`${result.removedUnitCount} voice lines belong to removed rows and do not ship`);
    }
    return result.bundle;
}
