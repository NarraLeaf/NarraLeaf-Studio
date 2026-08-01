import {
    BlurDissolve,
    Character,
    Condition,
    Control,
    Darkness,
    DevTools,
    Dissolve,
    FadeIn,
    Image,
    Lambda,
    Layer,
    Mask,
    Menu,
    Narrator,
    Pause,
    Persistent,
    Puppet,
    Push,
    Reveal,
    Scene,
    Script,
    Sound,
    Story,
    Text,
    TextEvent,
    ThroughColor,
    Transform,
    Vfx,
    Video,
    Word,
} from "narraleaf-react";
import type { MaskPattern } from "narraleaf-react";
import { blink, vignette } from "narraleaf-react/built-in";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type { DialogAvatarResolverContext } from "narraleaf-react";
import { resolvePoseAssetId, resolveTagSelection } from "@shared/utils/characterVariant";
import {
    characterAvatarKeyFromTags,
    resolveCharacterAvatarAssetId,
} from "@shared/utils/characterAvatar";
import type {
    StoryActionPayload,
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationSequence,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
    StoryBlock,
    StoryBlockId,
    StoryCharacterTagSelection,
    StoryConditionRef,
    StoryControlPayload,
    StoryDisplayableTargetRef,
    StoryDocument,
    StoryExpr,
    StoryExpression,
    StoryInlineEvent,
    StoryInterpolationRef,
    StoryLayerRef,
    StoryRichRun,
    StoryLiteralValue,
    StoryScene,
    StorySceneId,
    StorySavedVariableDefinition,
    StorySceneVariableDefinition,
    StoryTextMarks,
    StoryTextSegment,
    StoryTransitionRef,
    StoryTransformSequenceProps,
    StoryTransformRef,
    StoryVariableRef,
} from "@shared/types/story";
import {
    collectStoryExpressionVariables,
    duplicateSceneLabels,
    isStoryExpressionEvaluable,
    layerActionTargetRef,
    listScenesInDocumentOrder,
    sceneLabelNames,
    resolveDisplayableTargetRef,
    resolveStoryLayerRef,
    savedVariableDefs,
    sceneVariableDefs,
    storyPersistentDefs,
    storyVariableRefKey,
} from "@shared/types/story";
import type { StoryExpressionReader } from "@shared/utils/storyExpressionEval";
import { evaluateStoryExpression, isTruthy, strictEquals, toDisplayString } from "@shared/utils/storyExpressionEval";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import {
    buildMergedPersistentView,
    mergedPersistentStorageKeys,
    type MergedPersistentView,
} from "@shared/variables/mergedPersistentView";
import type { GameLocalizationBundle } from "@shared/types/localization";
import { resolveLocaleChain } from "@shared/types/localization";
import type { GameVoiceBundle } from "@shared/types/voice";
import type { AudioClipRegion } from "@shared/types/audio";
import { audioClipRegionToSoundConfig } from "@shared/types/audio";
import type { AudioTrackChannel, AudioTrackPlayback, ProjectAudioTrack } from "@shared/types/audioTrack";
import {
    AUDIO_TRACK_CHANNELS,
    AUDIO_TRACK_ID_VOICE,
    BUILTIN_AUDIO_TRACKS,
    resolveAudioTrack,
    resolveAudioTrackChain,
    resolveAudioTrackPlayback,
} from "@shared/types/audioTrack";
import { parseTranslatedText } from "@shared/utils/localizationText";
import {
    boolProp,
    characterStageName,
    getCharacterStageObjectName,
    getInlineTransformProps as getInlineTransformPropsShared,
    getPresetPosition,
    injectVisibilityDefault,
    normalizeObjectName,
    numberProp,
    stringProp,
    timelineToNlrTransformSequences,
    toNlrTransformSequence,
} from "./storyTransformProps";
import type { StageSnapshotDisplayable, StageSnapshotEffects, StoryStageSnapshot } from "./storyStageSnapshot";
import {
    collectStoryPlaybackPlan,
    groupPlaybackStepsByNvl,
    type StoryPlaybackPlan,
    type StoryPlaybackStop,
} from "./storyPlaybackWalk";
import type { ScriptCtx } from "narraleaf-react";
import {
    compileStoryActionBlueprintToScript,
    collectSceneStoryActionFns,
    evaluateStoryActionBlueprintValueSync,
    type CompileStoryActionScriptInput,
    type StoryActionFnCatalog,
} from "./storyActionBlueprint";

/**
 * App-level persistent variable bridge (shared with UI blueprints). `get` reads a cached snapshot
 * synchronously (for conditions); `set` may be async. Absent outside Dev Mode host persistence.
 */
export type StoryPersistenceBridge = {
    get: (storageKey: string) => unknown;
    set: (storageKey: string, value: unknown) => void | Promise<void>;
};

/** Single NLR Storable namespace holding all Story "saved" variables. */
const SAVED_PERSISTENT_NAMESPACE = "__nlr_story_saved__";

/**
 * Story-declared persistent defaults, keyed by storage key. The host bridge only carries values that
 * were ever written; a declared `//persis` row's default lives in the story document, so reads fall
 * back here when the snapshot has no entry.
 */
function collectPersistentDefaults(document: StoryDocument): Record<string, StoryLiteralValue> {
    const defaults: Record<string, StoryLiteralValue> = {};
    for (const def of Object.values(storyPersistentDefs(document))) {
        if (def.defaultValue !== undefined) {
            defaults[def.storageKey] = def.defaultValue;
        }
    }
    return defaults;
}

/**
 * Every declared persistent variable's storage key - the set a persistent reference is validated
 * against (bible §3.3). Persistent variables come from two authoring surfaces until the project-level
 * registry lands: story `//persis` declaration rows and the blueprint document's own persistent
 * variables. Both key host persistence by `storageKey`, so the reference (also keyed by storageKey)
 * checks membership here; a miss is an undeclared variable and gets the same diagnostic as a missing
 * scene/saved one.
 */
/**
 * The merged persistent view for a compile: the registry (blueprint-declared, baked into the bundle)
 * unioned with the story `/persis` declaration rows (WI-3). Reference validation reads its storage
 * keys; a display name declared in both surfaces is reported as a collision diagnostic.
 */
function collectPersistentView(document: StoryDocument, persistentVariables?: PersistentVariableRuntimeTable): MergedPersistentView {
    return buildMergedPersistentView(
        Object.values(persistentVariables ?? {}),
        Object.values(storyPersistentDefs(document)),
    );
}

function pushPersistentNameCollisionDiagnostics(diagnostics: NlrStoryCompileDiagnostic[], view: MergedPersistentView): void {
    for (const collision of view.nameCollisions) {
        pushDiagnostic(
            diagnostics,
            "warning",
            undefined,
            `Persistent variable "${collision.name}" is declared in both the variable registry and a story row; references are ambiguous.`,
        );
    }
}

/**
 * Game localization input: the bundle payload (locales + translation tables)
 * plus a synchronous current-locale getter (host persistence snapshot). Text
 * segments with translations compile to dynamic NLR Words that re-resolve on
 * every render, so switching the language applies immediately - no recompile.
 */
export type StoryLocalizationRuntime = GameLocalizationBundle & {
    getLocale: () => string;
};

/** Compile-scoped resolver over {@link StoryLocalizationRuntime} with precomputed fallback chains. */
type SceneLocalizationResolver = {
    hasTranslation: (textId: string) => boolean;
    /** Translated text for the current locale, or null to render the source-language prompt. */
    resolve: (textId: string) => string | null;
};

function createSceneLocalizationResolver(input: StoryLocalizationRuntime): SceneLocalizationResolver {
    const chains = new Map<string, string[]>();
    for (const locale of input.locales) {
        chains.set(locale.code, resolveLocaleChain(input, locale.code));
    }
    return {
        hasTranslation: textId => Object.values(input.tables).some(table => Boolean(table[textId])),
        resolve: textId => {
            const locale = input.getLocale();
            const chain = chains.get(locale) ?? resolveLocaleChain(input, locale);
            for (const code of chain) {
                const target = input.tables[code]?.[textId];
                if (target) {
                    return target;
                }
            }
            return null;
        },
    };
}

/**
 * Game voice input: the bundle payload (voice languages + per-language unit-id →
 * asset-id tables) plus a current voice-language getter. Distinct from
 * localization on purpose - dub language and subtitle language are separate.
 */
export type StoryVoiceRuntime = GameVoiceBundle & {
    getVoiceLocale: () => string;
};

/**
 * Resolve the active voice language's clips (unit id → asset id) into a flat
 * unit id → URL map for the engine's `Scene.voices` resolver.
 *
 * The map (object) form is used deliberately over the function-generator form:
 * the engine's generator path throws on an unresolved id, whereas a plain map
 * returns null for a line with no take - exactly what partial voicing needs. The
 * active locale is read once, at compile time; switching voice language is a
 * recompile (mirrors how a background swap recompiles, not how text re-resolves).
 */
async function buildSceneVoiceMap(input: {
    voice: StoryVoiceRuntime;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
}): Promise<Record<string, string>> {
    const locale = input.voice.getVoiceLocale();
    const table = input.voice.tables[locale];
    const map: Record<string, string> = {};
    if (!table) {
        return map;
    }
    for (const [unitId, assetId] of Object.entries(table)) {
        const url = await resolveAssetUrlCached({
            assetId,
            assetType: "audio",
            blockId: `voice:${locale}:${unitId}`,
            resolveAssetUrl: input.resolveAssetUrl,
            assetUrlCache: input.assetUrlCache,
            diagnostics: input.diagnostics,
        });
        if (url) {
            map[unitId] = url;
        }
    }
    return map;
}

/** Sentence voice config for a line: attach the engine `voiceId` only when a take exists for the active voice language. */
function voiceConfigForLine(ctx: SceneCompileContext, textId: string): { voiceId: string } | undefined {
    return ctx.voiceIdMap && ctx.voiceIdMap[textId] ? { voiceId: textId } : undefined;
}

/** Which character speaks each voice unit, so a take can be routed to that character's bus. */
function speakerByTextId(document: StoryDocument): Map<string, string> {
    const speakers = new Map<string, string>();
    for (const scene of Object.values(document.scenes ?? {})) {
        for (const block of Object.values(scene.blocks ?? {})) {
            if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
                continue;
            }
            const characterId = block.payload.characterId?.trim();
            const textId = block.payload.text?.textId;
            if (characterId && textId) {
                speakers.set(textId, characterId);
            }
        }
    }
    return speakers;
}

/**
 * The engine's `Scene.voices` table, with each take routed to its speaker's bus.
 *
 * The voice *module* is the pipeline a voiced game actually uses - takes keyed by unit id, one set
 * per language - so per-character voice volume that only reached the per-line `voiceAssetId`
 * fallback would be a feature that works in the demo and not in the game.
 *
 * A take whose speaker sits on the plain `voice` bus stays a bare URL, which is exactly what the
 * table held before this existed: the engine wraps a string in `Sound.voice()` itself, so a project
 * with no per-character track produces the same table it always did, entry for entry.
 */
function buildSceneVoices(input: {
    document: StoryDocument;
    voiceIdMap: Record<string, string>;
    characters: ReadonlyMap<string, DevModeCharacterSummary>;
    audioTracks: readonly ProjectAudioTrack[];
}): Record<string, string | Sound> {
    const speakers = speakerByTextId(input.document);
    const voices: Record<string, string | Sound> = {};
    for (const [unitId, url] of Object.entries(input.voiceIdMap)) {
        const characterId = speakers.get(unitId);
        const requested = characterId ? input.characters.get(characterId)?.voiceTrackId : undefined;
        const busId = resolveVoiceBusId(input.audioTracks, requested);
        voices[unitId] = busId === AUDIO_TRACK_ID_VOICE
            ? url
            : createBusSound(input.audioTracks, busId, AUDIO_TRACK_ID_VOICE, { src: url });
    }
    return voices;
}

export type NlrStoryCompileDiagnostic = {
    level: "warning" | "error";
    blockId?: string;
    message: string;
};

export type NlrActionIdBinding = {
    action: Parameters<typeof DevTools.setActionId>[0];
    staticId: string;
    blockId: string;
    textId?: string;
};

type NlrAction = Parameters<typeof DevTools.setActionId>[0];
type DevToolsWithStaticId = typeof DevTools & {
    setStaticId?: (action: NlrAction, id: string | null) => NlrAction;
};
type NlrStatement = unknown;
type NlrChainLike = {
    getActions: () => NlrAction[];
};
/**
 * `model` is the multi-file bundle a puppet draws — a manifest plus whatever it names. It resolves
 * to the bundle's *entry file* URL, and the engine resolves the siblings off it (`resolveSibling`),
 * so nothing here ever enumerates a bundle's members.
 */
export type StoryAssetKind = "image" | "audio" | "video" | "font" | "model" | "other";
type NlrCondition = Lambda<boolean> | ((ctx: ScriptCtx) => boolean);

/** Name-keyed NLR elements a compiled scene created; lets hosts look up live objects (e.g. a preview's transform target). */
export type CompiledSceneElements = {
    images: Map<string, Image>;
    texts: Map<string, Text>;
    layers: Map<string, Layer>;
    /** Puppet-kind characters, keyed by the same stage name their image-backed siblings use. */
    puppets: Map<string, Puppet>;
    /**
     * Named sounds this scene's compile built, keyed by the name the sound-control family addresses
     * them by - `bgm` for the music channel, the derived object name for a `/sound`.
     */
    sounds: Map<string, Sound>;
};

export type CompiledNlrStory = {
    story: Story;
    scene: Scene;
    scenes: Record<string, Scene>;
    storyId: string;
    sceneId: string;
    actionIdBindings: NlrActionIdBinding[];
    /**
     * Storable namespace holding every "saved" (editor: Var) variable, resolved via
     * {@link DevTools.getNamespaceName} so hosts read live values without depending on the engine's
     * namespace-prefix convention. Empty when the compiled story has no saved namespace.
     */
    savedNamespaceName: string;
    /**
     * Per-scene Storable namespace holding that scene's "scene" (editor: Local) variables, keyed by
     * Studio scene id. A scene-local namespace only exists while its scene is the active one at
     * runtime (it is re-seeded on entry and removed on exit).
     */
    sceneLocalNamespaceNames: Record<string, string>;
    diagnostics: NlrStoryCompileDiagnostic[];
    /**
     * The live NLR `Character` per Studio characterId, as this compile built them. Instances are
     * valid only within this compile — a recompile mints new ones — so a host must resolve through
     * the current session's `compiled` and never capture them.
     */
    characters: Map<string, Character>;
    /**
     * Dialog-avatar URL → the asset id it came from.
     *
     * The engine resolves an avatar to a *URL* (that is what an `<img>` takes), but a blueprint pin
     * carries an `ImageAsset`, which is an asset id. This is the inverse of the resolution the
     * compiler just performed, and it is kept deliberately narrow: only avatar URLs are in it, so
     * it can never turn an arbitrary stage image back into an id.
     */
    avatarAssetIdByUrl: Map<string, string>;
    /** Per-scene element registries, keyed by scene id (normalized object name → element). */
    sceneElements?: Record<string, CompiledSceneElements>;
    /** Continuous stage previews only: why the compiled playback tail ends. */
    playbackStop?: StoryPlaybackStop;
};

/**
 * Input for {@link compileStagePreviewToNlr}: a Studio-computed stage snapshot (the settled state
 * at the target row) plus the target block whose own action plays live on the pre-posed stage.
 */
export type StagePreviewCompileInput = {
    document: StoryDocument;
    sceneId: string;
    /** The settled stage state immediately before the target block (see computeStoryStageSnapshot). */
    snapshot: StoryStageSnapshot;
    /** Block whose own action plays on the pre-posed stage; null previews the snapshot state only. */
    targetBlockId: string | null;
    characters?: readonly DevModeCharacterSummary[];
    animations?: Record<string, StoryAnimationAsset>;
    resolveAssetUrl?: CompileInput["resolveAssetUrl"];
    blueprintDocument?: BlueprintDocument;
    /** M-VAR: persistent variable registry table, baked into the bundle; replaces the old blueprint-doc field. */
    persistentVariables?: PersistentVariableRuntimeTable;
    persistence?: StoryPersistenceBridge;
    /** In/out points marked on audio assets; see {@link CompileInput.audioClips}. */
    audioClips?: Record<string, AudioClipRegion>;
    /** The project's audio tracks; see {@link CompileInput.audioTracks}. */
    audioTracks?: readonly ProjectAudioTrack[];
    /**
     * Fires synchronously once the pre-posed stage state has been fully applied (elements
     * registered, residual effects settled) - the first frame at which the stage is a faithful
     * still of the snapshot. Precedes the reveal gate.
     */
    onStagePosed?: () => void;
    /**
     * Reveal gate for double-buffered hosts: after `onStagePosed`, execution pauses until this
     * promise resolves, so the host can swap the posed (but hidden) stage in before the target's
     * own action plays. Superseded runs never need it resolved - disposing the game aborts the wait.
     */
    revealGate?: Promise<void>;
    /** Fires synchronously immediately before the target's own statements. */
    onBeforeTarget: () => void;
    /** Fires synchronously immediately after the target's own statements complete. */
    onAfterTarget: () => void;
    /**
     * Continuous playback ("play from here"). Instead of playing the target's own action and
     * holding on the resulting frame, compile the whole execution tail from the target onwards —
     * the rest of its branch, then everything after it in the scene (see collectStoryPlaybackPlan).
     * The stage still *arrives* via the snapshot; only what happens next changes. Where the tail
     * ends (scene end, or a jump the single-scene preview cannot follow) comes back on the
     * compiled story's `playbackStop`.
     */
    continuous?: boolean;
};

type SceneCompileContext = {
    document: StoryDocument;
    nlrStory: Story;
    scene: StoryScene;
    nlrScene: Scene;
    allScenes: Record<string, Scene>;
    /** Compiling the single-scene preview, where a jump ends playback instead of being followed. */
    previewSingleScene?: boolean;
    /** First jump met while compiling a preview tail, so the pane can name where playback stopped. */
    previewEncounteredJump?: { blockId: StoryBlockId; targetSceneId: StorySceneId };
    characters: Map<string, Character>;
    characterSummaries: Map<string, DevModeCharacterSummary>;
    /** Dialog-avatar lookups resolved to URLs, per character. Built on first portrait binding. */
    characterAvatars?: Map<string, CompiledCharacterAvatars>;
    /** Inverse of every avatar resolution this compile performed (url → asset id). */
    avatarAssetIdByUrl: Map<string, string>;
    /** Stage sprites already registered as portraits, so a second row does not register them twice. */
    boundPortraits?: WeakSet<Image>;
    /**
     * Characters whose dialog avatar this compile has already decided — a stage sprite's resolver, or
     * a puppet's flat url.
     *
     * Compile-wide, not per scene, and that is the whole point: `Character` instances are shared
     * across the scenes of one compile, so a character staged in scene 1 must not have its live
     * resolver overwritten by scene 2's "never appeared here, use the default" pass. Whoever gets
     * here first wins, and the fallback pass ({@link bindOffstageDefaultAvatars}) runs last.
     */
    avatarBoundCharacterIds: Set<string>;
    /** Single NLR Persistent (Storable-backed, per-save) holding all "saved" variables. */
    savedPersistent: Persistent<Record<string, StoryLiteralValue>>;
    /** Scene-scope declaration table of this scene (variableId → def), scanned once per compile. */
    sceneVariables: Record<string, StorySceneVariableDefinition>;
    /** Document-wide "saved" declaration table (variableId → def), scanned once per compile. */
    savedVariables: Record<string, StorySavedVariableDefinition>;
    /** Story-declared persistent defaults (storageKey → default), the fallback for host reads. */
    persistentDefaults: Record<string, StoryLiteralValue>;
    /** Every declared persistent storage key (story rows + registry), for reference validation. */
    persistentKeys: Set<string>;
    /** M-VAR registry table (id → def), baked into the bundle; used to compile blueprint persistent GET/SET. */
    persistentVariables: PersistentVariableRuntimeTable;
    /** App-level persistent bridge (shared with UI blueprints); absent outside Dev Mode host. */
    persistence?: StoryPersistenceBridge;
    /** Blueprint document for compiling story-action blueprints referenced by this scene. */
    blueprintDocument?: BlueprintDocument;
    /** Game localization resolver; absent when the project has no localization or the host passes none. */
    localization?: SceneLocalizationResolver;
    /** Active voice language's unit id → clip URL map; absent when the project has no voice or the host passes none. */
    voiceIdMap?: Record<string, string>;
    /** Asset id → marked in/out points, folded into every `Sound` this compile builds. */
    audioClips?: Record<string, AudioClipRegion>;
    /** The project's audio tracks; already defaulted to the built-ins by the caller. */
    audioTracks: readonly ProjectAudioTrack[];
    /**
     * The track each named sound handle was created on, keyed the same way `sounds` is.
     *
     * Two rows may address one handle - `/sound piano` then `/vol piano 0.4` - and only the first
     * creates it. Recording the track it was created on is what lets a later row resolve the SAME
     * bus instead of the built-in fallback, and what lets a second creating row that names a
     * *different* track be reported rather than silently ignored (see {@link getSound}).
     */
    soundTrackIds: Map<string, string>;
    /** Fn declarations shared across all story-action blueprints in this scene. */
    sceneFnCatalog: StoryActionFnCatalog;
    images: Map<string, Image>;
    texts: Map<string, Text>;
    /** Puppet-kind characters. A separate map because a `Puppet` is not an `Image` and shares no API with one. */
    puppets: Map<string, Puppet>;
    layers: Map<string, Layer>;
    videos: Map<string, Video>;
    vfx: Map<string, Vfx>;
    sounds: Map<string, Sound>;
    animations: Map<string, StoryAnimationAsset>;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
    actionIdBindings: NlrActionIdBinding[];
    nextActionIndex: () => number;
};

type CompileInput = {
    document: StoryDocument;
    sceneId: string;
    characters?: readonly DevModeCharacterSummary[];
    animations?: Record<string, StoryAnimationAsset>;
    resolveAssetUrl?: (assetId: string, assetType?: StoryAssetKind) => Promise<string | null | undefined> | string | null | undefined;
    /** Blueprint document; enables Story Action Blueprints and shared Persistent resolution. */
    blueprintDocument?: BlueprintDocument;
    /** M-VAR: persistent variable registry table, baked into the bundle; replaces the old blueprint-doc field. */
    persistentVariables?: PersistentVariableRuntimeTable;
    /** App-level persistent bridge (shared with UI blueprints); from the Dev Mode scope-store bridge. */
    persistence?: StoryPersistenceBridge;
    /** Game localization (bundle payload + current-locale getter); see {@link StoryLocalizationRuntime}. */
    localization?: StoryLocalizationRuntime;
    /** Game voice (bundle payload + current voice-language getter); see {@link StoryVoiceRuntime}. */
    voice?: StoryVoiceRuntime;
    /**
     * In/out points marked on audio assets, keyed by asset id (the bundle's `audio.clips`).
     *
     * Every `Sound` this compile builds folds the region of its own asset in, so a clip loops where
     * the author marked it rather than over the whole file. Absent means "no clip is marked", which
     * plays everything whole.
     */
    audioClips?: Record<string, AudioClipRegion>;
    /**
     * The project's audio tracks (`editor/audio-tracks.json`), which every audio row resolves against
     * for its bus, its gain multiplier and its fade/loop defaults.
     *
     * Optional so a host that has not been wired yet still compiles: absent means
     * {@link BUILTIN_AUDIO_TRACKS}, i.e. the three seeded tracks, which reproduce exactly what this
     * compiler hard-coded before tracks existed. A project that never opened the Audio surface has
     * those three and nothing else, so for it the two are the same list.
     */
    audioTracks?: readonly ProjectAudioTrack[];
    /**
     * Row-precise launch ("play from here" in Dev Mode). When set, the entry scene is replaced by a
     * one-shot pre-posed scene: the stage arrives at `targetBlockId`'s settled state (from the
     * snapshot) and then plays the real story forward from that row — following jumps into the other
     * (normally-compiled) scenes. The normal entry scene stays in the story so a later jump back to
     * it re-enters the full scene.
     */
    launch?: { targetBlockId: string | null; snapshot: StoryStageSnapshot };
};

const EMPTY_IMAGE_SRC = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'></svg>";
const SCENE_INITIAL_BACKGROUND_BLOCK_ID = "__scene_initial_background";
const SCENE_BACKGROUND_MUSIC_BLOCK_ID = "__scene_background_music";
/**
 * The reserved registry name the sound-control family addresses when no target is given
 * (`/vol 0.5` is the music channel). Mirrors `BGM_OBJECT_NAME` in the editor.
 */
const BGM_SOUND_NAME = "bgm";
const EMPTY_STORY_ID = "__nlr_empty_story__";
const EMPTY_SCENE_ID = "__nlr_empty_scene__";
const UNKNOWN_CHARACTER_ID = "__unknown_character__";
/** Nametag for a character that has no authored name. Must be non-empty, and must not be a UUID. */
const UNKNOWN_CHARACTER_NAME = "Unknown";

/**
 * Build a minimal, playable NLR story that mounts an empty scene. Used to boot the
 * NarraLeaf React environment (creating a live `Game`/`LiveGame` and firing the
 * `gameReady` blueprint event) when the project has no configured default scene to
 * preload.
 */
export function createEmptyCompiledNlrStory(): CompiledNlrStory {
    const nlrStory = new Story(EMPTY_STORY_ID);
    const nlrScene = new Scene(EMPTY_SCENE_ID);
    nlrScene.action([] as unknown as Parameters<Scene["action"]>[0]);
    nlrStory.entry(nlrScene);
    return {
        story: nlrStory,
        scene: nlrScene,
        scenes: { [EMPTY_SCENE_ID]: nlrScene },
        storyId: EMPTY_STORY_ID,
        sceneId: EMPTY_SCENE_ID,
        characters: new Map(),
        avatarAssetIdByUrl: new Map(),
        actionIdBindings: [],
        savedNamespaceName: "",
        sceneLocalNamespaceNames: {},
        diagnostics: [],
    };
}

export async function compileStudioStoryToNlr(input: CompileInput): Promise<CompiledNlrStory> {
    const entryScene = input.document.scenes[input.sceneId];
    if (!entryScene) {
        throw new Error(`Scene not found: ${input.sceneId}`);
    }

    const nlrStory = new Story(input.document.name || input.document.id);
    const diagnostics: NlrStoryCompileDiagnostic[] = [];
    const actionIdBindings: NlrActionIdBinding[] = [];
    const sceneElements: Record<string, CompiledSceneElements> = {};
    const characters = new Map<string, Character>();
    const avatarAssetIdByUrl = new Map<string, string>();
    // Compile-wide, because `characters` is: see `SceneCompileContext.avatarBoundCharacterIds`.
    const avatarBoundCharacterIds = new Set<string>();
    const characterSummaries = new Map((input.characters ?? []).map(character => [character.id, character]));
    const animations = new Map(Object.entries(input.animations ?? {}));
    const assetUrlCache = new Map<string, string | null>();
    let actionIndex = 0;
    const resolveAssetUrl = input.resolveAssetUrl ?? ((assetId: string) => assetId);
    const voiceIdMap = input.voice
        ? await buildSceneVoiceMap({ voice: input.voice, resolveAssetUrl, assetUrlCache, diagnostics })
        : undefined;
    const audioTracks = input.audioTracks ?? BUILTIN_AUDIO_TRACKS;
    const sceneBackgroundMusic = new Map<string, { sound: Sound; trackId: string }>();
    const allScenes = await createNlrScenes({
        document: input.document,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
        voiceIdMap,
        audioClips: input.audioClips,
        audioTracks,
        characters: characterSummaries,
        backgroundMusic: sceneBackgroundMusic,
    });

    // Single Storable-backed namespace seeded with every saved variable's default.
    const savedVariables = savedVariableDefs(input.document);
    const savedDefaults: Record<string, StoryLiteralValue> = {};
    for (const saved of Object.values(savedVariables)) {
        savedDefaults[saved.storageKey] = saved.defaultValue ?? null;
    }
    // A launch starts the story mid-way, so the saved namespace opens at the snapshot's accumulated
    // values (defaults overlaid with everything set on the path to the target row).
    if (input.launch) {
        Object.assign(savedDefaults, input.launch.snapshot.savedVariables);
    }
    const savedPersistent = nlrStory.createPersistent(SAVED_PERSISTENT_NAMESPACE, savedDefaults);
    const persistentDefaults = collectPersistentDefaults(input.document);
    const persistentVariables = input.persistentVariables ?? {};
    const persistentView = collectPersistentView(input.document, persistentVariables);
    const persistentKeys = mergedPersistentStorageKeys(persistentView);
    pushPersistentNameCollisionDiagnostics(diagnostics, persistentView);
    const localization = input.localization ? createSceneLocalizationResolver(input.localization) : undefined;

    // Document order, so the Problems panel reads down the story instead of down a UUID sort.
    for (const scene of listScenesInDocumentOrder(input.document)) {
        const nlrScene = allScenes[scene.id];
        const sceneMusic = sceneBackgroundMusic.get(scene.id);
        const sceneFnCatalog = collectSceneStoryActionFns({
            document: input.document,
            blueprintDocument: input.blueprintDocument,
            scene,
        });
        const ctx: SceneCompileContext = {
            document: input.document,
            nlrStory,
            scene,
            nlrScene,
            allScenes,
            characters,
            characterSummaries,
            avatarAssetIdByUrl,
            avatarBoundCharacterIds,
            savedPersistent,
            sceneVariables: sceneVariableDefs(scene),
            savedVariables,
            persistentDefaults,
            persistentKeys,
            persistentVariables,
            persistence: input.persistence,
            blueprintDocument: input.blueprintDocument,
            localization,
            voiceIdMap,
            sceneFnCatalog,
            images: new Map(),
            texts: new Map(),
            puppets: new Map(),
            layers: new Map(),
            videos: new Map(),
            vfx: new Map(),
            // Seeded with the scene's configured track under the name the sound-control family
            // defaults to, so `/vol 0.5` on a scene with music means what it looks like.
            sounds: sceneMusic ? new Map([[BGM_SOUND_NAME, sceneMusic.sound]]) : new Map(),
            soundTrackIds: sceneMusic ? new Map([[BGM_SOUND_NAME, sceneMusic.trackId]]) : new Map(),
            audioClips: input.audioClips,
            audioTracks,
            animations,
            resolveAssetUrl,
            assetUrlCache,
            diagnostics,
            actionIdBindings,
            nextActionIndex: () => actionIndex++,
        };
        // Seed declared scene-local defaults at the head of the scene's statement list. They must be
        // statements (not build-time sets): `Scene.local.init` resets the namespace on every scene
        // entry, so the seeds have to re-run each time the scene starts.
        const seeds: NlrStatement[] = [];
        for (const def of Object.values(ctx.sceneVariables)) {
            if (def.defaultValue !== undefined) {
                seeds.push(nlrScene.local.set(def.storageKey, def.defaultValue as any));
            }
        }
        const statements = await compileBlockList(ctx, scene.rootBlockIds);
        nlrScene.action([...seeds, ...statements] as unknown as Parameters<Scene["action"]>[0]);
        sceneElements[scene.id] = { images: ctx.images, texts: ctx.texts, layers: ctx.layers, puppets: ctx.puppets, sounds: ctx.sounds };
    }

    // Row-precise launch: the story enters through a one-shot pre-posed scene that arrives at the
    // target row's settled state and then plays the real story forward from there. The normal scene
    // stays in `allScenes`, so a later jump back to it re-enters the full scene from the top.
    const nlrEntryScene = input.launch
        ? await buildLaunchEntryScene({
            input,
            launch: input.launch,
            nlrStory,
            allScenes,
            actionIdBindings,
            diagnostics,
            characters,
            characterSummaries,
            avatarAssetIdByUrl,
            avatarBoundCharacterIds,
            savedPersistent,
            savedVariables,
            persistentDefaults,
            persistentKeys,
            persistentVariables,
            animations,
            resolveAssetUrl,
            assetUrlCache,
            localization,
            voiceIdMap,
            nextActionIndex: () => actionIndex++,
        })
        : allScenes[input.sceneId];
    nlrStory.entry(nlrEntryScene);

    // Last, once every scene (and the launch tail) has had its say about who stood on stage.
    await bindOffstageDefaultAvatars({
        characters,
        characterSummaries,
        avatarBoundCharacterIds,
        avatarAssetIdByUrl,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
    });

    const sceneLocalNamespaceNames: Record<string, string> = {};
    for (const [sceneId, nlrScene] of Object.entries(allScenes)) {
        sceneLocalNamespaceNames[sceneId] = DevTools.getNamespaceName(nlrScene.local);
    }

    return {
        story: nlrStory,
        scene: nlrEntryScene,
        scenes: allScenes,
        storyId: input.document.id,
        sceneId: entryScene.id,
        actionIdBindings,
        savedNamespaceName: DevTools.getNamespaceName(savedPersistent),
        sceneLocalNamespaceNames,
        diagnostics,
        characters,
        avatarAssetIdByUrl,
        sceneElements,
    };
}

/**
 * Build the row-precise launch entry scene (see {@link CompileInput.launch}). Mirrors the stage
 * preview's pre-pose - construct the snapshot's displayables pre-posed via constructor config and
 * register them in one synchronous step - then, instead of holding, compiles the real playback tail
 * from the target row onward with jumps followed (`previewSingleScene: false`), so control flows into
 * the other, normally-compiled scenes and the run continues as a real playthrough.
 */
async function buildLaunchEntryScene(params: {
    input: CompileInput;
    launch: NonNullable<CompileInput["launch"]>;
    nlrStory: Story;
    allScenes: Record<string, Scene>;
    actionIdBindings: NlrActionIdBinding[];
    diagnostics: NlrStoryCompileDiagnostic[];
    characters: Map<string, Character>;
    characterSummaries: Map<string, DevModeCharacterSummary>;
    avatarAssetIdByUrl: Map<string, string>;
    avatarBoundCharacterIds: Set<string>;
    savedPersistent: Persistent<Record<string, StoryLiteralValue>>;
    savedVariables: Record<string, StorySavedVariableDefinition>;
    persistentDefaults: Record<string, StoryLiteralValue>;
    persistentKeys: Set<string>;
    persistentVariables: PersistentVariableRuntimeTable;
    animations: Map<string, StoryAnimationAsset>;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    localization?: SceneLocalizationResolver;
    voiceIdMap?: Record<string, string>;
    nextActionIndex: () => number;
}): Promise<Scene> {
    const { input, launch, nlrStory, allScenes, diagnostics, resolveAssetUrl, assetUrlCache } = params;
    const snapshot = launch.snapshot;
    const scene = input.document.scenes[input.sceneId];
    if (!scene) {
        throw new Error(`Scene not found: ${input.sceneId}`);
    }

    // Snapshot background wins; otherwise the scene's default initial background.
    const backgroundSrc = snapshot.background?.assetId
        ? await resolveAssetUrlCached({
            assetId: snapshot.background.assetId,
            assetType: "image",
            blockId: SCENE_INITIAL_BACKGROUND_BLOCK_ID,
            resolveAssetUrl,
            assetUrlCache,
            diagnostics,
        })
        : snapshot.background?.color
            ?? await resolveSceneInitialBackground({ scene, resolveAssetUrl, assetUrlCache, diagnostics });
    // A row-precise launch replaces the scene, so it has to carry the scene's own music too -
    // otherwise "play from here" is the one way to enter a scene silently.
    const audioTracks = input.audioTracks ?? BUILTIN_AUDIO_TRACKS;
    const launchMusic = await resolveSceneBackgroundMusic({
        scene,
        audioClips: input.audioClips,
        audioTracks,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
    });
    const launchScene = new Scene(
        scene.runtimeName || scene.name || scene.id,
        {
            ...(backgroundSrc ? { background: backgroundSrc } : {}),
            ...(launchMusic ? { backgroundMusic: launchMusic.sound, backgroundMusicFade: launchMusic.fadeMs } : {}),
        },
    );

    const ctx: SceneCompileContext = {
        document: input.document,
        nlrStory,
        scene,
        nlrScene: launchScene,
        allScenes,
        previewSingleScene: false,
        characters: params.characters,
        characterSummaries: params.characterSummaries,
        avatarAssetIdByUrl: params.avatarAssetIdByUrl,
        avatarBoundCharacterIds: params.avatarBoundCharacterIds,
        savedPersistent: params.savedPersistent,
        sceneVariables: sceneVariableDefs(scene),
        savedVariables: params.savedVariables,
        persistentDefaults: params.persistentDefaults,
        persistentKeys: params.persistentKeys,
        persistentVariables: params.persistentVariables,
        persistence: input.persistence,
        blueprintDocument: input.blueprintDocument,
        localization: params.localization,
        voiceIdMap: params.voiceIdMap,
        sceneFnCatalog: collectSceneStoryActionFns({
            document: input.document,
            blueprintDocument: input.blueprintDocument,
            scene,
        }),
        images: new Map(),
        texts: new Map(),
        puppets: new Map(),
        layers: new Map(),
        videos: new Map(),
        vfx: new Map(),
        sounds: launchMusic ? new Map([[BGM_SOUND_NAME, launchMusic.sound]]) : new Map(),
        soundTrackIds: launchMusic ? new Map([[BGM_SOUND_NAME, launchMusic.trackId]]) : new Map(),
        audioClips: input.audioClips,
        audioTracks,
        animations: params.animations,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
        actionIdBindings: params.actionIdBindings,
        nextActionIndex: params.nextActionIndex,
    };

    // Custom layers first so images/texts can bind to them, all pre-posed via constructor config.
    for (const record of snapshot.displayables) {
        if (record.kind === "layer") {
            getLayer(ctx, record.objectName, record.zIndex ?? 0, snapshotPoseProps(record));
        }
    }
    const registrations: { element: Image | Text; layer: Layer | undefined }[] = [];
    for (const record of snapshot.displayables) {
        if (record.kind === "layer") {
            continue;
        }
        const layer = resolveLayerForRef(ctx, record.layer);
        if (record.kind === "image") {
            const src = await resolveSnapshotImageSource(ctx, record);
            const image = getImage(ctx, record.objectName, {
                autoFit: record.autoFit ?? false,
                layer,
                src: src ?? undefined,
                initialProps: snapshotPoseProps(record),
            });
            // A pre-posed character is on stage before any row of its own runs, so its portrait has
            // to be registered here too - otherwise a row-precise launch shows the speaker with no
            // avatar until they next enter or change expression.
            if (record.source?.type === "character") {
                await bindCharacterPortrait(ctx, record.source.characterId, image);
            }
            registrations.push({ element: image, layer });
        } else {
            const text = getText(ctx, record.objectName, {
                text: record.text ?? "",
                fontSize: record.fontSize,
                fontColor: record.fontColor,
                layer,
                initialProps: snapshotPoseProps(record),
            });
            registrations.push({ element: text, layer });
        }
    }
    registrations.forEach((registration, index) => {
        DevTools.setElementId(registration.element as any, `launch-e-${index}`);
    });

    const statements: NlrStatement[] = [];
    // Seed scene variables to the snapshot's accumulated values, so conditions and interpolations in
    // the tail read the state as it was on the path to the target row.
    for (const def of Object.values(ctx.sceneVariables)) {
        const value = snapshot.sceneVariables[def.storageKey] ?? def.defaultValue ?? null;
        statements.push(launchScene.local.set(def.storageKey, value as any));
    }

    // One synchronous injection step: register the pre-posed elements and apply built-in-singleton props.
    const backgroundProps = snapshot.backgroundProps;
    const builtinLayerProps = snapshot.builtinLayerProps;
    // The stage camera is a story-level singleton pre-posed exactly like the built-in layers: its pan/
    // zoom/rotate settle instantly here so a launch that starts after a `/camera zoom` opens on the
    // real shot, not a neutral one. Its darkness rides the residual-effects pass below.
    const cameraProps = snapshot.camera?.props ?? {};
    statements.push(Script.execute(((scriptCtx: ScriptCtx) => {
        for (const registration of registrations) {
            DevTools.registerDisplayable(scriptCtx.gameState, registration.element as any, launchScene, registration.layer ?? null);
        }
        if (Object.keys(backgroundProps).length > 0) {
            DevTools.setDisplayableTransformProps(scriptCtx.gameState, launchScene.background as any, backgroundProps);
        }
        if (Object.keys(builtinLayerProps.backgroundLayer).length > 0) {
            DevTools.setDisplayableTransformProps(scriptCtx.gameState, launchScene.backgroundLayer as any, builtinLayerProps.backgroundLayer);
        }
        if (Object.keys(builtinLayerProps.displayableLayer).length > 0) {
            DevTools.setDisplayableTransformProps(scriptCtx.gameState, launchScene.displayableLayer as any, builtinLayerProps.displayableLayer);
        }
        if (Object.keys(cameraProps).length > 0) {
            DevTools.setDisplayableTransformProps(scriptCtx.gameState, nlrStory.camera as any, cameraProps);
        }
    }) as any));

    // Residual instant effects (mask/clip/filter/darken end states) re-applied at duration 0.
    for (const record of snapshot.displayables) {
        const element = record.kind === "image"
            ? ctx.images.get(normalizeObjectName(record.objectName))
            : record.kind === "text"
                ? ctx.texts.get(normalizeObjectName(record.objectName))
                : ctx.layers.get(normalizeObjectName(record.objectName));
        if (element) {
            statements.push(...await compileSnapshotEffects(ctx, element, record.effects));
        }
    }
    statements.push(...await compileSnapshotEffects(ctx, launchScene.background, snapshot.backgroundEffects));
    // Camera darkness settles through the same `darken(d, 0)` channel `/camera darken` uses.
    if (snapshot.camera) {
        statements.push(...await compileSnapshotEffects(ctx, nlrStory.camera, snapshot.camera.effects));
    }

    // Play the real story forward from the target row, following jumps into the other scenes.
    const plan = collectStoryPlaybackPlan(scene, launch.targetBlockId, { followJumps: true });
    statements.push(...await compilePlaybackTail(ctx, plan));

    // Injected elements bypass NLR's preload prediction, so register every resolved image URL.
    for (const [cacheKey, url] of assetUrlCache) {
        if (cacheKey.startsWith("image:") && url) {
            launchScene.preloadImage(url);
        }
    }

    launchScene.action(statements as unknown as Parameters<Scene["action"]>[0]);
    return launchScene;
}

/** A compiled statement that synchronously invokes a host callback when execution reaches it. */
function previewMarker(callback: () => void): NlrStatement {
    return Script.execute(() => {
        callback();
    });
}

/**
 * Compile a Studio-computed stage snapshot into a minimal "state player" story: one scene whose
 * elements are constructed pre-posed at their settled transform state (constructor config, so the
 * pose survives `newGame()`), registered in a single synchronous `Script` via
 * `DevTools.registerDisplayable`, followed by the target block's own action between the two
 * markers. No runtime fast-forwarding is involved - the compiled story IS the state, and looping
 * a replay is a plain `newGame()`.
 */
export async function compileStagePreviewToNlr(input: StagePreviewCompileInput): Promise<CompiledNlrStory> {
    const scene = input.document.scenes[input.sceneId];
    if (!scene) {
        throw new Error(`Scene not found: ${input.sceneId}`);
    }
    const snapshot = input.snapshot;
    const diagnostics: NlrStoryCompileDiagnostic[] = snapshot.diagnostics.map(entry => ({ ...entry }));
    const actionIdBindings: NlrActionIdBinding[] = [];
    const characterSummaries = new Map((input.characters ?? []).map(character => [character.id, character]));
    const animations = new Map(Object.entries(input.animations ?? {}));
    const assetUrlCache = new Map<string, string | null>();
    const resolveAssetUrl = input.resolveAssetUrl ?? ((assetId: string) => assetId);
    let actionIndex = 0;

    const nlrStory = new Story(`${input.document.name || input.document.id} (preview)`);
    const savedVariables = savedVariableDefs(input.document);
    const savedDefaults: Record<string, StoryLiteralValue> = {};
    for (const saved of Object.values(savedVariables)) {
        savedDefaults[saved.storageKey] = saved.defaultValue ?? null;
    }
    Object.assign(savedDefaults, snapshot.savedVariables);
    const savedPersistent = nlrStory.createPersistent(SAVED_PERSISTENT_NAMESPACE, savedDefaults);

    // Snapshot background wins; otherwise the scene's default initial background.
    const backgroundSrc = snapshot.background?.assetId
        ? await resolveAssetUrlCached({
            assetId: snapshot.background.assetId,
            assetType: "image",
            blockId: SCENE_INITIAL_BACKGROUND_BLOCK_ID,
            resolveAssetUrl,
            assetUrlCache,
            diagnostics,
        })
        : snapshot.background?.color
            ?? await resolveSceneInitialBackground({ scene, resolveAssetUrl, assetUrlCache, diagnostics });
    const previewScene = new Scene(
        scene.runtimeName || scene.name || scene.id,
        backgroundSrc ? { background: backgroundSrc } : undefined,
    );

    const previewPersistentView = collectPersistentView(input.document, input.persistentVariables);
    pushPersistentNameCollisionDiagnostics(diagnostics, previewPersistentView);
    const ctx: SceneCompileContext = {
        document: input.document,
        nlrStory,
        scene,
        nlrScene: previewScene,
        allScenes: { [scene.id]: previewScene },
        previewSingleScene: true,
        characters: new Map(),
        characterSummaries,
        avatarAssetIdByUrl: new Map(),
        avatarBoundCharacterIds: new Set(),
        savedPersistent,
        sceneVariables: sceneVariableDefs(scene),
        savedVariables,
        persistentDefaults: collectPersistentDefaults(input.document),
        persistentKeys: mergedPersistentStorageKeys(previewPersistentView),
        persistentVariables: input.persistentVariables ?? {},
        persistence: input.persistence,
        blueprintDocument: input.blueprintDocument,
        sceneFnCatalog: collectSceneStoryActionFns({
            document: input.document,
            blueprintDocument: input.blueprintDocument,
            scene,
        }),
        images: new Map(),
        texts: new Map(),
        puppets: new Map(),
        layers: new Map(),
        videos: new Map(),
        vfx: new Map(),
        sounds: new Map(),
        soundTrackIds: new Map(),
        audioClips: input.audioClips,
        audioTracks: input.audioTracks ?? BUILTIN_AUDIO_TRACKS,
        animations,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
        actionIdBindings,
        nextActionIndex: () => actionIndex++,
    };

    // Custom layers first so images/texts can bind to them, all pre-posed via constructor config.
    for (const record of snapshot.displayables) {
        if (record.kind === "layer") {
            getLayer(ctx, record.objectName, record.zIndex ?? 0, snapshotPoseProps(record));
        }
    }
    const registrations: { element: Image | Text; layer: Layer | undefined }[] = [];
    for (const record of snapshot.displayables) {
        if (record.kind === "layer") {
            continue;
        }
        const layer = resolveLayerForRef(ctx, record.layer);
        if (record.kind === "image") {
            const src = await resolveSnapshotImageSource(ctx, record);
            const image = getImage(ctx, record.objectName, {
                autoFit: record.autoFit ?? false,
                layer,
                src: src ?? undefined,
                initialProps: snapshotPoseProps(record),
            });
            // A pre-posed character is on stage before any row of its own runs, so its portrait has
            // to be registered here too - otherwise a row-precise launch shows the speaker with no
            // avatar until they next enter or change expression.
            if (record.source?.type === "character") {
                await bindCharacterPortrait(ctx, record.source.characterId, image);
            }
            registrations.push({ element: image, layer });
        } else {
            const text = getText(ctx, record.objectName, {
                text: record.text ?? "",
                fontSize: record.fontSize,
                fontColor: record.fontColor,
                layer,
                initialProps: snapshotPoseProps(record),
            });
            registrations.push({ element: text, layer });
        }
    }
    // Injected elements sit outside the action tree, so story construction never assigns them
    // ids - give each a unique one or they collide as React keys on the stage.
    registrations.forEach((registration, index) => {
        DevTools.setElementId(registration.element as any, `preview-e-${index}`);
    });

    const statements: NlrStatement[] = [];
    // Seed scene variables (defaults overlaid with the snapshot's assignments) so conditions and
    // inline interpolations in the target line read the accumulated values.
    for (const def of Object.values(ctx.sceneVariables)) {
        const value = snapshot.sceneVariables[def.storageKey] ?? def.defaultValue ?? null;
        statements.push(previewScene.local.set(def.storageKey, value as any));
    }

    // One synchronous injection step: register pre-posed elements into the render tree and apply
    // props accumulated against the built-in singletons (scene background / built-in layers).
    const backgroundProps = snapshot.backgroundProps;
    const builtinLayerProps = snapshot.builtinLayerProps;
    statements.push(Script.execute(((scriptCtx: ScriptCtx) => {
        for (const registration of registrations) {
            DevTools.registerDisplayable(scriptCtx.gameState, registration.element as any, previewScene, registration.layer ?? null);
        }
        if (Object.keys(backgroundProps).length > 0) {
            DevTools.setDisplayableTransformProps(scriptCtx.gameState, previewScene.background as any, backgroundProps);
        }
        if (Object.keys(builtinLayerProps.backgroundLayer).length > 0) {
            DevTools.setDisplayableTransformProps(scriptCtx.gameState, previewScene.backgroundLayer as any, builtinLayerProps.backgroundLayer);
        }
        if (Object.keys(builtinLayerProps.displayableLayer).length > 0) {
            DevTools.setDisplayableTransformProps(scriptCtx.gameState, previewScene.displayableLayer as any, builtinLayerProps.displayableLayer);
        }
    }) as any));

    // Residual instant effects (mask/clip/filter/darken end states) re-applied at duration 0.
    for (const record of snapshot.displayables) {
        const element = record.kind === "image"
            ? ctx.images.get(normalizeObjectName(record.objectName))
            : record.kind === "text"
                ? ctx.texts.get(normalizeObjectName(record.objectName))
                : ctx.layers.get(normalizeObjectName(record.objectName));
        if (element) {
            statements.push(...await compileSnapshotEffects(ctx, element, record.effects));
        }
    }
    statements.push(...await compileSnapshotEffects(ctx, previewScene.background, snapshot.backgroundEffects));

    // The stage is now a faithful still of the snapshot; hold here until the host reveals the
    // buffer so the target's own action plays entirely on a visible stage.
    if (input.onStagePosed) {
        statements.push(previewMarker(input.onStagePosed));
    }
    if (input.revealGate) {
        statements.push(Control.sleep(input.revealGate));
    }

    statements.push(previewMarker(input.onBeforeTarget));
    let playbackStop: StoryPlaybackStop | undefined;
    if (input.continuous) {
        const plan = collectStoryPlaybackPlan(scene, input.targetBlockId);
        playbackStop = plan.stop;
        statements.push(...await compilePlaybackTail(ctx, plan));
        // A jump nested inside a container is invisible to the walk, so the plan reports the scene as
        // running to its end. If compiling the tail met one, that is the real stop.
        if (playbackStop.reason === "sceneEnd" && ctx.previewEncounteredJump) {
            playbackStop = { reason: "jump", ...ctx.previewEncounteredJump };
        }
    } else {
        const targetBlock = input.targetBlockId ? scene.blocks[input.targetBlockId] : undefined;
        if (targetBlock) {
            let own = await compilePreviewTargetOwnStatements(ctx, targetBlock);
            if (snapshot.nvl && own.length > 0) {
                own = [previewScene.nvl({ duration: 0 } as any, own as any)];
            }
            statements.push(...own);
        }
    }
    statements.push(previewMarker(input.onAfterTarget));

    // Before the preload sweep below, so a fallback avatar this resolves is warmed with the rest.
    await bindOffstageDefaultAvatars({
        characters: ctx.characters,
        characterSummaries,
        avatarBoundCharacterIds: ctx.avatarBoundCharacterIds,
        avatarAssetIdByUrl: ctx.avatarAssetIdByUrl,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
    });

    // Register every image URL this compile resolved (snapshot poses AND the target's own
    // sources) with the scene's preloader - injected elements bypass NLR's usual preload
    // prediction, which would otherwise warn per image.
    for (const [cacheKey, url] of assetUrlCache) {
        if (cacheKey.startsWith("image:") && url) {
            previewScene.preloadImage(url);
        }
    }

    previewScene.action(statements as unknown as Parameters<Scene["action"]>[0]);
    nlrStory.entry(previewScene);

    return {
        story: nlrStory,
        scene: previewScene,
        scenes: { [scene.id]: previewScene },
        storyId: input.document.id,
        sceneId: scene.id,
        actionIdBindings,
        savedNamespaceName: DevTools.getNamespaceName(savedPersistent),
        sceneLocalNamespaceNames: { [scene.id]: DevTools.getNamespaceName(previewScene.local) },
        diagnostics,
        characters: ctx.characters,
        avatarAssetIdByUrl: ctx.avatarAssetIdByUrl,
        sceneElements: { [scene.id]: { images: ctx.images, texts: ctx.texts, layers: ctx.layers, puppets: ctx.puppets, sounds: ctx.sounds } },
        playbackStop,
    };
}

/**
 * Compile a continuous-playback tail: every block that runs from the start row onwards, in
 * execution order. Consecutive in-NVL steps share one `nvl` wrapper, so a run of NVL lines
 * accumulates in a single NVL screen instead of restarting the mode on every line.
 */
async function compilePlaybackTail(ctx: SceneCompileContext, plan: StoryPlaybackPlan): Promise<NlrStatement[]> {
    const statements: NlrStatement[] = [];
    for (const group of groupPlaybackStepsByNvl(plan.steps)) {
        const body: NlrStatement[] = [];
        for (const step of group.steps) {
            const block = ctx.scene.blocks[step.blockId];
            if (!block) {
                continue;
            }
            // A branch entry (menu option / condition branch) is a label, not an action: playback
            // was *entered* inside it, so its body is what plays — the container is already behind us.
            body.push(...step.bodyOnly
                ? await compileBlockList(ctx, block.childrenIds)
                : await compileBlock(ctx, block.id));
        }
        if (group.insideNvl && body.length > 0) {
            statements.push(ctx.nlrScene.nvl({ duration: 0 } as any, body as any));
        } else {
            statements.push(...body);
        }
    }
    if (plan.stop.reason === "jump") {
        const targetScene = ctx.document.scenes[plan.stop.targetSceneId];
        diagnostic(
            ctx,
            "warning",
            plan.stop.blockId,
            `Playback ends here: the preview runs one scene, so it holds before the jump to ${targetScene?.name || plan.stop.targetSceneId || "(empty)"}.`,
        );
    }
    return statements;
}

/** Constructor-config pose: settled props with visibility folded into opacity. */
function snapshotPoseProps(record: StageSnapshotDisplayable): Record<string, unknown> {
    const props = { ...record.props };
    if (props.opacity === undefined) {
        props.opacity = record.visible ? 1 : 0;
    }
    return props;
}

async function resolveSnapshotImageSource(ctx: SceneCompileContext, record: StageSnapshotDisplayable): Promise<string | null> {
    const source = record.source;
    const blockId = record.sourceBlockId ?? record.objectName;
    if (!source) {
        return null;
    }
    if (source.type === "asset") {
        return resolveAsset(ctx, source.assetId, "image", blockId);
    }
    if (source.type === "color") {
        return source.color;
    }
    return resolveCharacterImageUrl(ctx, source.characterId, source.pose, blockId);
}

/** Re-apply a snapshot record's residual effects as instant (duration 0) statements. */
async function compileSnapshotEffects(ctx: SceneCompileContext, element: any, effects: StageSnapshotEffects): Promise<NlrStatement[]> {
    const statements: NlrStatement[] = [];
    const instant = { duration: 0 };
    if (effects.mask === "clear" && typeof element.clearMask === "function") {
        statements.push(element.clearMask(instant));
    } else if (effects.mask && effects.mask !== "clear" && typeof element.mask === "function") {
        const src = await resolveAsset(ctx, effects.mask.assetId, "image", "__preview_effect");
        if (src) {
            statements.push(element.mask(src, instant));
        }
    }
    if (effects.clip === "clear" && typeof element.clearClip === "function") {
        statements.push(element.clearClip(instant));
    } else if (effects.clip && effects.clip !== "clear" && typeof element.clip === "function") {
        statements.push(element.clip(effects.clip.clipPath, instant));
    }
    if (effects.filter === "clear" && typeof element.clearFilter === "function") {
        statements.push(element.clearFilter(instant));
    } else if (effects.filter && effects.filter !== "clear" && typeof element.filter === "function") {
        statements.push(element.filter(effects.filter.filter, instant));
    }
    if (effects.darkness !== undefined && typeof element.darken === "function") {
        statements.push(element.darken(effects.darkness, 0));
    }
    return statements;
}

async function createNlrScenes(input: {
    document: StoryDocument;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
    /** Active voice language's unit id → clip URL map, shared by every scene (voice ids are global). */
    voiceIdMap?: Record<string, string>;
    /** Asset id → marked in/out points, so a scene's own track loops where the author marked it. */
    audioClips?: Record<string, AudioClipRegion>;
    /** The project's audio tracks, so a scene's music resolves its bus like every other row. */
    audioTracks: readonly ProjectAudioTrack[];
    /** Character summaries by id, so each voice take lands on its speaker's bus. */
    characters: ReadonlyMap<string, DevModeCharacterSummary>;
    /**
     * Filled with each scene's configured track, keyed by Studio scene id.
     *
     * The caller seeds it into that scene's sound registry under the reserved name `bgm`, which is
     * what makes `/vol 0.5` and `/seek bgm 30` address the scene's own music. Without it the control
     * family would answer "no background music is set" on precisely the scene that has some. The
     * audio track rides along for the same reason: a later `/vol` on that handle has to reach the
     * gain the scene's music was built with, not the built-in fallback's.
     */
    backgroundMusic?: Map<string, { sound: Sound; trackId: string }>;
}): Promise<Record<string, Scene>> {
    const scenes: Record<string, Scene> = {};
    const voices = input.voiceIdMap && Object.keys(input.voiceIdMap).length > 0
        ? buildSceneVoices({
            document: input.document,
            voiceIdMap: input.voiceIdMap,
            characters: input.characters,
            audioTracks: input.audioTracks,
        })
        : undefined;
    // Two scenes with the same runtime name share one `Scene.local` namespace, so their scene-local
    // variables would silently read and write each other's values. The name keys the namespace
    // (`DevTools.getNamespaceName`), so a collision is a real data hazard, not cosmetic (bible §3.3).
    // Document order decides WHICH of the two colliding scenes gets blamed - the later one, as with
    // duplicate labels. Reading the record would hand that verdict to whichever id sorts lower.
    const namesSeen = new Set<string>();
    for (const scene of listScenesInDocumentOrder(input.document)) {
        const runtimeName = scene.runtimeName || scene.name || scene.id;
        if (namesSeen.has(runtimeName)) {
            pushDiagnostic(
                input.diagnostics,
                "error",
                undefined,
                `Two scenes share the name "${runtimeName}"; their scene-local variables would collide. Rename one.`,
            );
        }
        namesSeen.add(runtimeName);
        const background = await resolveSceneInitialBackground({
            scene,
            resolveAssetUrl: input.resolveAssetUrl,
            assetUrlCache: input.assetUrlCache,
            diagnostics: input.diagnostics,
        });
        const config: {
            background?: string;
            // `string | Sound` because a take on a per-character bus has to arrive as a built
            // `Sound` - the engine wraps a bare string with `Sound.voice()`, which would put every
            // take back on the plain `voice` bus.
            voices?: Record<string, string | Sound>;
            backgroundMusic?: Sound;
            backgroundMusicFade?: number;
        } = {};
        if (background) {
            config.background = background;
        }
        if (voices) {
            config.voices = voices;
        }
        const music = await resolveSceneBackgroundMusic({
            scene,
            audioClips: input.audioClips,
            audioTracks: input.audioTracks,
            resolveAssetUrl: input.resolveAssetUrl,
            assetUrlCache: input.assetUrlCache,
            diagnostics: input.diagnostics,
        });
        if (music) {
            config.backgroundMusic = music.sound;
            config.backgroundMusicFade = music.fadeMs;
            input.backgroundMusic?.set(scene.id, { sound: music.sound, trackId: music.trackId });
        }
        scenes[scene.id] = new Scene(
            runtimeName,
            Object.keys(config).length > 0 ? config : undefined,
        );
    }
    return scenes;
}

async function resolveSceneInitialBackground(input: {
    scene: StoryScene;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
}): Promise<string | null> {
    const assetId = input.scene.defaultBackgroundAssetId?.trim();
    if (!assetId) {
        return null;
    }
    return resolveAssetUrlCached({
        assetId,
        assetType: "image",
        blockId: SCENE_INITIAL_BACKGROUND_BLOCK_ID,
        resolveAssetUrl: input.resolveAssetUrl,
        assetUrlCache: input.assetUrlCache,
        diagnostics: input.diagnostics,
    });
}

/**
 * The scene's own opening track, as engine scene config.
 *
 * Constructor config rather than a leading `setBackgroundMusic` statement, because the engine plays
 * `backgroundMusic` during the scene's *init* - so it is already going when the first row runs, and
 * it survives a load into the middle of the scene. A statement could do neither.
 *
 * The audio track supplies the bus and the loop default, resolved the same way an audio row resolves
 * them - the `bgm` built-in when the scene names no track. The fade is the scene's own field and
 * nothing else: a fade belongs to the moment, so an unstated one is a hard cut, which is what a
 * scene's music did before tracks existed.
 */
async function resolveSceneBackgroundMusic(input: {
    scene: StoryScene;
    audioClips?: Record<string, AudioClipRegion>;
    audioTracks: readonly ProjectAudioTrack[];
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
}): Promise<{ sound: Sound; fadeMs: number; trackId: string } | null> {
    const bgm = input.scene.bgm;
    const assetId = bgm?.assetId?.trim();
    if (!bgm || !assetId) {
        return null;
    }
    const url = await resolveAssetUrlCached({
        assetId,
        assetType: "audio",
        blockId: SCENE_BACKGROUND_MUSIC_BLOCK_ID,
        resolveAssetUrl: input.resolveAssetUrl,
        assetUrlCache: input.assetUrlCache,
        diagnostics: input.diagnostics,
    });
    if (!url) {
        return null;
    }
    const track = resolveAudioTrack(input.audioTracks, bgm.audioTrackId, "bgm");
    const playback = resolveAudioTrackPlayback(track, {
        volume: bgm.volume,
        loop: bgm.loop,
    });
    return {
        sound: createBusSound(input.audioTracks, playback.busId, "bgm", {
            src: url,
            loop: playback.loop,
            volume: playback.volume,
            ...audioClipRegionToSoundConfig(input.audioClips?.[assetId]),
        }),
        fadeMs: bgm.fadeMs ?? 0,
        trackId: track.id,
    };
}

/**
 * Which of the three seeded buses a bus hangs beneath - the *root* of its chain, not its parent.
 *
 * The engine's two slot checks (a scene's `backgroundMusic`, a line's `voice`) are descendant tests
 * against `bgm` / `voice`, so `voice/party/alice` has to answer `voice` however deep it sits. The
 * chain is walked master-most-first here for exactly that reason: the seeded bus nearest the master
 * output is the one the engine's own walk arrives at last and the one that decides the slot.
 *
 * A bus whose chain reaches master without passing through any of the three - an author's own root,
 * `ambience` parented to null - answers the caller's own fallback instead. It is not an error: the
 * clip plays on its declared bus either way, and the fallback only picks the factory, i.e. which
 * slot the resulting `Sound` is allowed to occupy.
 */
function audioTrackSeededRoot(
    tracks: readonly ProjectAudioTrack[],
    busId: string,
    fallbackChannel: AudioTrackChannel,
): AudioTrackChannel {
    const chain = resolveAudioTrackChain(tracks, busId, fallbackChannel);
    for (let index = chain.length - 1; index >= 0; index -= 1) {
        const id = chain[index].id;
        if ((AUDIO_TRACK_CHANNELS as readonly string[]).includes(id)) {
            return id as AudioTrackChannel;
        }
    }
    return fallbackChannel;
}

/**
 * A `Sound` on a given bus.
 *
 * `type` **is** the track's id now. The three factories no longer name three fixed channels - they
 * default `type` and nothing else - so the bus travels in the config and the factory is chosen only
 * to satisfy the engine's slot checks (see {@link audioTrackSeededRoot}).
 *
 * The clip's `volume` is the author's own number, never pre-multiplied by the bus gains above it:
 * those live in the gain graph, where a player moving a slider reaches a clip that is already
 * playing. Folding them in here would apply them twice and freeze them where no slider can reach.
 *
 * One function rather than a ternary at each site, because "which bus, therefore which player
 * slider" is the entire mechanical content of the feature and three copies of it is three chances
 * for one of them to keep hard-coding `Sound.sound`.
 */
function createBusSound(
    tracks: readonly ProjectAudioTrack[],
    busId: string,
    fallbackChannel: AudioTrackChannel,
    config: Exclude<Parameters<typeof Sound.sound>[0], string>,
): Sound {
    const withBus = { ...config, type: busId };
    switch (audioTrackSeededRoot(tracks, busId, fallbackChannel)) {
        case "bgm":
            return Sound.bgm(withBus);
        case "voice":
            return Sound.voice(withBus);
        case "sound":
            return Sound.sound(withBus);
    }
}

async function compileBlockList(ctx: SceneCompileContext, blockIds: readonly string[]): Promise<NlrStatement[]> {
    const statements: NlrStatement[] = [];
    for (const blockId of blockIds) {
        statements.push(...await compileBlock(ctx, blockId));
    }
    return statements;
}

async function compileBlock(ctx: SceneCompileContext, blockId: string): Promise<NlrStatement[]> {
    const block = ctx.scene.blocks[blockId];
    if (!block) {
        diagnostic(ctx, "warning", undefined, `Missing block: ${blockId}`);
        return [];
    }

    // A disabled row (schema v7) is compiled out — with its whole subtree, since returning here never
    // recurses into its children — and it is not an error (unlike `invalid`): the author chose to skip
    // it, so at runtime it simply does not exist.
    if (block.disabled) {
        return [];
    }

    if (block.kind === "nodeAction") {
        if (block.payload.action === "choice") {
            return compileChoice(ctx, block);
        }
        if (block.payload.action === "choiceOption") {
            diagnostic(ctx, "warning", block.id, "Choice option is outside of a choice container.");
            return compileBlockList(ctx, block.childrenIds);
        }
        const own = await compileNodeAction(ctx, block);
        return [...own, ...await compileBlockList(ctx, block.childrenIds)];
    }

    if (block.kind === "action") {
        if (block.payload.action === "nvl") {
            return compileNvl(ctx, block);
        }
        const own = await compileStoryAction(ctx, block);
        return [...own, ...await compileBlockList(ctx, block.childrenIds)];
    }

    if (block.kind === "control") {
        if (block.payload.control === "condition") {
            return compileCondition(ctx, block);
        }
        if (block.payload.control === "conditionBranch") {
            diagnostic(ctx, "warning", block.id, "Condition branch is outside of a condition container.");
            return compileBlockList(ctx, block.childrenIds);
        }
        if (block.payload.control === "label" || block.payload.control === "goto") {
            return compileLabelControl(ctx, block, block.payload);
        }
        return compileControlGroup(ctx, block);
    }

    if (block.kind === "jump") {
        if (ctx.previewSingleScene) {
            // The preview holds one scene, so a jump is where playback ends rather than something to
            // follow. The walk already truncates a jump it can see, but one nested inside a container
            // is only reached here - and taking it would either report the author's own scene as
            // "not found" or, when it points back at this scene, re-enter the preview with the reveal
            // gate already spent. Record the first one and stop emitting for it.
            ctx.previewEncounteredJump ??= { blockId: block.id, targetSceneId: block.payload.targetSceneId };
            return [];
        }
        const target = ctx.allScenes[block.payload.targetSceneId];
        if (!target) {
            diagnostic(ctx, "error", block.id, `Jump target scene not found: ${block.payload.targetSceneId || "(empty)"}`);
            return [];
        }
        const chain = ctx.nlrScene.jumpTo(target, createTransition(block.payload.transition, ctx, block.id) as any);
        return [recordStatement(ctx, chain, block)];
    }

    if (block.kind === "declaration") {
        // Authoring metadata, not a runtime action: the scanned variable tables carry its meaning,
        // and the scene-head seeds carry its default. Nothing to emit, nothing to warn about.
        return [];
    }

    if (block.kind === "code") {
        diagnostic(ctx, "warning", block.id, "Code/Script blocks are not part of the NLR Story action surface and were skipped.");
        return [];
    }

    if (block.kind === "invalid") {
        // Skipped rather than fatal so preview still runs: a half-typed command is a normal thing to
        // have on screen while writing. `error` (not `warning`) is what stops it there - a production
        // build refuses on error diagnostics, so an unfinished line cannot ship quietly.
        diagnostic(ctx, "error", block.id, `Invalid command, skipped: ${block.payload.source}`);
        return [];
    }

    return [];
}

/**
 * Compile a preview target block's OWN statements (no trailing children): the action that plays
 * live on the pre-posed snapshot stage. Container targets (choice, condition, control, nvl) keep
 * their full body so the row previews as the real construct - e.g. a choice target renders its
 * menu and holds.
 */
async function compilePreviewTargetOwnStatements(ctx: SceneCompileContext, block: StoryBlock): Promise<NlrStatement[]> {
    if (block.kind === "jump") {
        // Jumping would leave the previewed scene; hold at the pre-jump state instead.
        diagnostic(ctx, "warning", block.id, "Preview holds before the jump instead of leaving the scene.");
        return [];
    }
    if (block.kind === "nodeAction") {
        if (block.payload.action === "choice") {
            return compileChoice(ctx, block);
        }
        if (block.payload.action === "choiceOption") {
            // Normally normalized to the parent choice upstream; preview the option's branch state.
            return [];
        }
        return compileNodeAction(ctx, block);
    }
    if (block.kind === "action") {
        if (block.payload.action === "nvl") {
            return compileNvl(ctx, block);
        }
        return compileStoryAction(ctx, block);
    }
    if (block.kind === "control") {
        if (block.payload.control === "condition") {
            return compileCondition(ctx, block);
        }
        if (block.payload.control === "conditionBranch") {
            return [];
        }
        return compileControlGroup(ctx, block);
    }
    return [];
}

async function compileNodeAction(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "nodeAction" }>): Promise<NlrStatement[]> {
    if (block.payload.action === "narration") {
        const segment = block.payload.text;
        if (!segment.value.trim() && !segmentHasInterpolation(segment) && !segmentHasEvent(segment)) {
            return [];
        }
        const voiceConfig = voiceConfigForLine(ctx, segment.textId);
        const eventMap = await resolveSegmentEvents(ctx, segment, block.id);
        return [recordStatement(ctx, Narrator.say(buildLocalizedSentencePrompt(ctx, segment, block.id, eventMap) as any, voiceConfig as any), block, segment.textId)];
    }

    if (block.payload.action === "dialogue") {
        const text = block.payload.text.value;
        if (!text.trim() && !segmentHasInterpolation(block.payload.text) && !segmentHasEvent(block.payload.text)) {
            return [];
        }
        const character = getCharacter(ctx, block.payload.characterId, block.payload.speakerName);
        // Voice module (id-keyed take for the active language) wins; the legacy
        // per-line `voiceAssetId` stays as an inline fallback the engine tries
        // when the scene voice map has no entry (`scene.getVoice(id) || voice`).
        const voiceConfig = voiceConfigForLine(ctx, block.payload.text.textId);
        const voiceUrl = block.payload.voiceAssetId
            ? await resolveAsset(ctx, block.payload.voiceAssetId, "audio", block.id)
            : null;
        const config: Record<string, unknown> = {};
        if (voiceConfig) {
            config.voiceId = voiceConfig.voiceId;
        }
        if (voiceUrl) {
            // On the speaker's own bus, not the bare `voice` one. That is the whole per-character
            // voice feature: `voice/alice` gives the player a slider for Alice alone, and a
            // character with no track of its own resolves to `voice`, i.e. to what this always was.
            config.voice = createBusSound(
                ctx.audioTracks,
                characterVoiceBusId(ctx, block.payload.characterId),
                AUDIO_TRACK_ID_VOICE,
                { src: voiceUrl },
            );
        }
        if (block.payload.pauseAfter !== undefined) {
            config.pause = block.payload.pauseAfter;
        }
        const sayConfig = Object.keys(config).length > 0 ? (config as any) : undefined;
        const eventMap = await resolveSegmentEvents(ctx, block.payload.text, block.id);
        return [recordStatement(ctx, character.say(buildLocalizedSentencePrompt(ctx, block.payload.text, block.id, eventMap) as any, sayConfig), block, block.payload.text.textId)];
    }

    return [];
}

/** Build an NLR sentence prompt from a text segment: a plain string, or Word/Pause tokens. */
function buildSentencePrompt(segment: StoryTextSegment, ctx: SceneCompileContext, blockId: string, eventMap?: Map<StoryRichRun, TextEvent>): string | unknown[] {
    return buildSentenceParts(segment, ctx, blockId, eventMap).prompt;
}

/**
 * Build the sentence prompt and, alongside it, the compiled interpolation Words in
 * segment order - the `{n}` placeholder targets when a translation renders instead.
 */
function buildSentenceParts(
    segment: StoryTextSegment,
    ctx: SceneCompileContext,
    blockId: string,
    eventMap?: Map<StoryRichRun, TextEvent>,
): { prompt: string | unknown[]; interpolationWords: unknown[] } {
    if (!segment.rich || segment.rich.length === 0) {
        return { prompt: segment.value, interpolationWords: [] };
    }
    const prompt: unknown[] = [];
    const interpolationWords: unknown[] = [];
    for (const run of segment.rich) {
        if ("pause" in run) {
            prompt.push(run.pause === true ? new Pause() : Pause.wait(run.pause));
            continue;
        }
        if ("event" in run) {
            // Reveal-time event token (zero-width, like Pause). It was resolved asynchronously by the
            // caller (asset URLs) into a TextEvent; an unresolvable event was already diagnosed and is
            // simply omitted here. It contributes no `{n}` placeholder, so interpolation indices stay
            // aligned.
            const event = eventMap?.get(run);
            if (event) {
                prompt.push(event);
            }
            continue;
        }
        if ("interpolation" in run) {
            const word = buildInterpolationWord(ctx, run.interpolation, blockId, run.marks);
            // Keep placeholder indices aligned with the source serialization even
            // when a broken interpolation compiles to nothing.
            interpolationWords.push(word ?? "");
            if (word != null) {
                prompt.push(word);
            }
            continue;
        }
        if (!run.text) {
            continue;
        }
        prompt.push(buildWord(run.text, run.marks));
    }
    return { prompt: prompt.length > 0 ? prompt : segment.value, interpolationWords };
}

/**
 * Localization-aware variant of {@link buildSentencePrompt}. When the segment has
 * at least one translation, the whole line compiles to a single dynamic Word that
 * re-resolves per render: the current locale's translation (with `{n}` placeholders
 * mapped back to the source line's interpolation Words), or the original
 * source-language prompt when no translation applies. Untranslated segments keep
 * their plain compiled form - zero overhead.
 */
function buildLocalizedSentencePrompt(ctx: SceneCompileContext, segment: StoryTextSegment, blockId: string, eventMap?: Map<StoryRichRun, TextEvent>): string | unknown[] {
    const { prompt, interpolationWords } = buildSentenceParts(segment, ctx, blockId, eventMap);
    const localization = ctx.localization;
    if (!localization || !localization.hasTranslation(segment.textId)) {
        return prompt;
    }
    const textId = segment.textId;
    // KNOWN LIMITATION (Pause family): a translated line is rebuilt from the translation string, which
    // carries only text and `{n}` interpolation placeholders. Zero-width reveal-time tokens - inline
    // `Pause`s and inline events (`TextEvent`) - have no placeholder in the translation, so they are
    // dropped from the translated rendering and survive only in the source-language prompt above. Not
    // fixed here: recovering them needs a token-preserving translation format. See the migration report.
    const resolveDynamic = () => {
        const target = localization.resolve(textId);
        if (target === null) {
            return prompt as never;
        }
        return parseTranslatedText(target).map(part =>
            part.kind === "text" ? part.text : (interpolationWords[part.index] ?? ""),
        ) as never;
    };
    return [new Word((resolveDynamic as unknown) as any)];
}

/** True when a segment carries an inline interpolation run (so an empty plain value is intentional). */
function segmentHasInterpolation(segment: StoryTextSegment): boolean {
    return Boolean(segment.rich?.some(run => "interpolation" in run));
}

/** True when a segment carries an inline reveal-time event run (so an empty plain value is intentional). */
function segmentHasEvent(segment: StoryTextSegment): boolean {
    return Boolean(segment.rich?.some(run => "event" in run));
}

/**
 * Pre-resolve every inline event run in a segment into an engine `TextEvent`. Asset URLs (the
 * expression's character image and the optional SE) resolve asynchronously, so this runs before the
 * synchronous {@link buildSentenceParts}. An event that cannot be resolved is diagnosed and omitted
 * (its run maps to nothing), leaving the surrounding text intact.
 */
async function resolveSegmentEvents(
    ctx: SceneCompileContext,
    segment: StoryTextSegment,
    blockId: string,
): Promise<Map<StoryRichRun, TextEvent>> {
    const map = new Map<StoryRichRun, TextEvent>();
    if (!segment.rich) {
        return map;
    }
    for (const run of segment.rich) {
        if (!("event" in run)) {
            continue;
        }
        const event = await compileEventRun(ctx, run.event, blockId);
        if (event) {
            map.set(run, event);
        }
    }
    return map;
}

/** Compile one inline event descriptor into a `TextEvent`, or null when nothing usable resolves. */
async function compileEventRun(
    ctx: SceneCompileContext,
    event: StoryInlineEvent,
    blockId: string,
): Promise<TextEvent | null> {
    let sound: Sound | undefined;
    if (event.sound?.assetId) {
        const url = await resolveAsset(ctx, event.sound.assetId, "audio", blockId);
        if (url) {
            sound = Sound.sound(url);
        } else {
            diagnostic(ctx, "warning", blockId, "Inline event: sound asset not found; sound skipped.");
        }
    }

    if (event.expression) {
        const { characterId, pose, tags } = event.expression;
        if (!characterId) {
            diagnostic(ctx, "warning", blockId, "Inline event: expression has no character; expression skipped.");
        } else {
            // A layered character switches by tag, which `TextEventAppearance` accepts alongside a
            // src — and the tags stay partial here for the same reason a `/face` row's do.
            const layeredTags = ctx.characterSummaries.get(characterId)?.appearance.kind === "layered"
                ? Object.values(tags ?? {})
                : null;
            const src: string | string[] | null = layeredTags?.length
                ? layeredTags
                : await resolveCharacterImageUrl(ctx, characterId, pose, blockId);
            if (src) {
                // Address the portrait through the shared stage-name rule, exactly as the character's
                // `/show` does (see `characterStageName`). An expression run carries only a characterId,
                // so a character shown under a custom stage `objectName` is not reachable from here - and
                // must not silently swap a phantom off-stage image. Require the target to already be on
                // stage (a prior `/show` registered it) and warn with the family message otherwise, so a
                // missed swap is diagnosed rather than lost. Do NOT seed a src: the appearance only
                // switches when the token is revealed, not at line start.
                const name = characterStageName(characterId);
                const image = ctx.images.get(normalizeObjectName(name));
                if (image) {
                    return TextEvent.expression(image, src, sound ? { sound } : undefined);
                }
                diagnostic(ctx, "warning", blockId, `Inline event: character "${characterId}" is not on stage (show it before this line; a character shown under a custom stage name cannot be targeted by an inline expression); expression skipped.`);
            } else {
                diagnostic(ctx, "warning", blockId, `Inline event: character image source not found for ${characterId}.`);
            }
        }
    }

    // No (usable) expression: fall back to a sound-only event when an SE resolved.
    return sound ? TextEvent.sound(sound) : null;
}

/**
 * Assemble the shared compile input for a scene's Story Action Blueprints - used by both block-level
 * actions (compiled to a `Script`) and inline interpolations (evaluated synchronously). Callers must
 * ensure `ctx.blueprintDocument` is present.
 */
function buildStoryActionScriptInput(
    ctx: SceneCompileContext,
    blueprintId: string,
    onDiagnostic: (message: string) => void,
): CompileStoryActionScriptInput {
    return {
        blueprintDocument: ctx.blueprintDocument as BlueprintDocument,
        persistentVariables: ctx.persistentVariables,
        blueprintId,
        nlrScene: ctx.nlrScene,
        sceneFnCatalog: ctx.sceneFnCatalog,
        sceneVariables: ctx.sceneVariables,
        savedVariables: ctx.savedVariables,
        savedNamespace: SAVED_PERSISTENT_NAMESPACE,
        persistence: ctx.persistence,
        onDiagnostic,
    };
}

/**
 * Style an inline value's dynamic word: bold/italic/color apply to the rendered value text (matching
 * how the chip renders in the editor). `toWord` takes no config, so we compose the public Word helpers.
 */
function applyInterpolationWordMarks(word: unknown, marks: StoryTextMarks | undefined): unknown {
    const clean = marks;
    if (!clean || (!clean.bold && !clean.italic && !clean.color)) {
        return word;
    }
    let styled = word as Word;
    if (clean.color) styled = Word.color(styled, clean.color as never);
    if (clean.bold) styled = Word.bold(styled);
    if (clean.italic) styled = Word.italic(styled);
    return styled;
}

/** Compile an inline interpolation run to an NLR word (a dynamic value shown in dialogue). */
function buildInterpolationWord(
    ctx: SceneCompileContext,
    interp: StoryInterpolationRef,
    blockId: string,
    marks?: StoryTextMarks,
): unknown | null {
    if (interp.kind === "blueprint") {
        if (!ctx.blueprintDocument) {
            diagnostic(ctx, "warning", blockId, "Blueprint text interpolation needs the project blueprint document; interpolation skipped.");
            return null;
        }
        // Inline blueprints are restricted to synchronous nodes, so the "On Call" Return Value can be
        // evaluated in-line by a dynamic word. Any async node reached at runtime throws and renders empty.
        const input = buildStoryActionScriptInput(ctx, interp.blueprintId, message => diagnostic(ctx, "warning", blockId, message));
        return applyInterpolationWordMarks(new Word((((scriptCtx: ScriptCtx) => {
            try {
                const value = evaluateStoryActionBlueprintValueSync(input, scriptCtx);
                return value === null || value === undefined ? "" : String(value);
            } catch {
                return "";
            }
        }) as unknown) as any), marks);
    }
    if (interp.kind === "expression") {
        const { expression } = interp;
        if (!isStoryExpressionEvaluable(expression.ast)) {
            diagnostic(ctx, "warning", blockId, `Inline expression \`${expression.source}\` did not resolve; interpolation skipped.`);
            return null;
        }
        const readerFor = buildExpressionReader(ctx, expression.ast, blockId);
        if (!readerFor) {
            return null;
        }
        // `toDisplayString`, not `String(...)`: a null variable renders as nothing rather than as the
        // word "null" in the middle of a line of dialogue.
        return applyInterpolationWordMarks(new Word((((scriptCtx: ScriptCtx) =>
            toDisplayString(evaluateStoryExpression(expression.ast, readerFor(scriptCtx)))) as unknown) as any), marks);
    }
    const target = interp.target;
    if (target.scope === "scene") {
        const def = ctx.sceneVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Scene variable not found; interpolation skipped.");
            return null;
        }
        return applyInterpolationWordMarks(ctx.nlrScene.local.toWord(def.storageKey as any), marks);
    }
    if (target.scope === "saved") {
        const def = ctx.savedVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Saved variable not found; interpolation skipped.");
            return null;
        }
        return applyInterpolationWordMarks(ctx.savedPersistent.toWord(def.storageKey as any), marks);
    }
    // Persistent (app-level): a dynamic word reading the shared host snapshot synchronously,
    // falling back to the story-declared default while the host has never stored a value.
    if (!ctx.persistentKeys.has(target.variableId)) {
        diagnostic(ctx, "warning", blockId, "Persistent variable not found; interpolation skipped.");
        return null;
    }
    const persistence = ctx.persistence;
    if (!persistence) {
        diagnostic(ctx, "warning", blockId, "Persistent variables require Dev Mode host persistence; interpolation skipped.");
        return null;
    }
    const storageKey = target.variableId;
    const persistentDefaults = ctx.persistentDefaults;
    return applyInterpolationWordMarks(new Word(((() => {
        const stored = persistence.get(storageKey);
        const value = stored === undefined ? persistentDefaults[storageKey] : stored;
        return value === null || value === undefined ? "" : String(value);
    }) as unknown) as any), marks);
}

function buildWord(text: string, marks: StoryTextMarks | undefined): string | Word {
    if (!marks) {
        return text;
    }
    const config: Record<string, unknown> = {};
    if (marks.bold) config.bold = true;
    if (marks.italic) config.italic = true;
    if (marks.color) config.color = marks.color;
    if (marks.ruby) config.ruby = marks.ruby;
    if (typeof marks.cps === "number") config.cps = marks.cps;
    if (typeof marks.fontSize === "number") config.fontSize = marks.fontSize;
    return Object.keys(config).length > 0 ? new Word(text, config as any) : text;
}

async function compileStoryAction(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "action" }>): Promise<NlrStatement[]> {
    const payload = block.payload;
    if (payload.action === "setBackground") {
        const src = payload.assetId
            ? await resolveAsset(ctx, payload.assetId, "image", block.id)
            : payload.color;
        if (!src) {
            diagnostic(ctx, "warning", block.id, "Background has no image or color.");
            return [];
        }
        return [recordStatement(ctx, ctx.nlrScene.setBackground(src as any, createTransition(payload.transition, ctx, block.id) as any), block)];
    }

    if (payload.action === "character") {
        return compileCharacterStageAction(ctx, block, payload);
    }

    if (payload.action === "audio") {
        return compileAudioAction(ctx, block, payload);
    }

    if (payload.action === "setVariable") {
        const chain = setVariable(ctx, payload.target, payload.value, block.id, payload.expression);
        return chain ? [recordStatement(ctx, chain, block)] : [];
    }

    if (payload.action === "blueprint") {
        if (!ctx.blueprintDocument) {
            diagnostic(ctx, "warning", block.id, "Story Action Blueprint needs the project blueprint document; the action was skipped.");
            return [];
        }
        const script = compileStoryActionBlueprintToScript(
            buildStoryActionScriptInput(ctx, payload.blueprintId, message => diagnostic(ctx, "warning", block.id, message)),
        );
        return script ? [recordStatement(ctx, script, block)] : [];
    }

    if (payload.action === "wait") {
        const chain = payload.mode === "click"
            ? Control.waitForClick()
            : Control.sleep(Math.max(0, payload.durationMs ?? 0));
        return [recordStatement(ctx, chain, block)];
    }

    if (payload.action === "image") {
        return compileImageAction(ctx, block, payload);
    }

    if (payload.action === "displayable") {
        const target = resolveDisplayableActionTarget(ctx, payload.target);
        if (!target) {
            const label = resolveDisplayableTargetRef(ctx.scene, payload.target).label || "(empty)";
            diagnostic(ctx, "warning", block.id, `Displayable target not found: ${label}`);
            return [];
        }
        if (isDisplayableEffectOperation(payload.operation)) {
            return compileDisplayableEffect(ctx, block, payload, target);
        }
        const chain = compileDisplayableOperation(target, payload.operation as "show" | "hide" | "transform", payload.transform, ctx, block.id);
        return chain ? [recordStatement(ctx, chain, block)] : [];
    }

    if (payload.action === "text") {
        return compileTextAction(ctx, block, payload);
    }

    if (payload.action === "layer") {
        return compileLayerAction(ctx, block, payload);
    }

    if (payload.action === "video") {
        return compileVideoAction(ctx, block, payload);
    }

    if (payload.action === "vfx") {
        return compileVfxAction(ctx, block, payload);
    }

    if (payload.action === "screenEffect") {
        const options = {
            duration: payload.durationMs,
            closeDuration: payload.durationMs,
            openDuration: payload.durationMs,
            hold: payload.holdMs,
            color: payload.color,
            opacity: payload.opacity,
            easing: payload.easing,
        };
        const chain = payload.effect === "blink"
            ? blink(ctx.nlrScene, options as any)
            : vignette(ctx.nlrScene, options as any);
        return [recordStatement(ctx, chain, block)];
    }

    if (payload.action === "camera") {
        return compileCameraAction(ctx, block, payload);
    }

    return [];
}

/** Lower bound on camera zoom: 0 or a negative scale is not a shot, it is a broken transform. */
const MIN_CAMERA_ZOOM = 0.05;

/** A finite number, or the neutral fallback - a NaN reaching a Transform prop silently kills the whole animation. */
function finiteOr(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * `story.camera` - the one stage camera, addressed straight off the compile context's story.
 *
 * Every numeric input is clamped here rather than trusted from the payload: the engine's `Darkness`
 * does not clamp, so a `darkness` of 2 compiles to `brightness(-1)` and silently produces no visible
 * change at all (the 0.16.1 defect that made this rule). The same reasoning covers zoom, where 0 or a
 * negative value is not a shot the author meant.
 */
function compileCameraAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "camera" }>,
): NlrStatement[] {
    const camera = ctx.nlrStory.camera;
    const duration = Math.max(0, finiteOr(payload.durationMs, 0));
    const easing = payload.easing as any;
    switch (payload.operation) {
        case "pan": {
            const position = getPresetPosition("custom", {
                xalign: payload.position?.xalign ?? 0.5,
                yalign: payload.position?.yalign ?? 0.5,
                ...(payload.position?.xoffset !== undefined ? { xoffset: payload.position.xoffset } : {}),
                ...(payload.position?.yoffset !== undefined ? { yoffset: payload.position.yoffset } : {}),
            });
            return [recordStatement(ctx, camera.pan(position as any, duration, easing), block)];
        }
        case "zoom":
            return [recordStatement(ctx, camera.zoom(Math.max(MIN_CAMERA_ZOOM, finiteOr(payload.zoom, 1)), duration, easing), block)];
        case "rotate":
            return [recordStatement(ctx, camera.rotate(finiteOr(payload.rotation, 0), duration, easing), block)];
        case "darken":
            return [recordStatement(ctx, camera.darken(Math.min(1, Math.max(0, finiteOr(payload.darkness, 0))), duration, easing), block)];
        case "reset":
            return [recordStatement(ctx, camera.reset(duration, easing), block)];
        case "motion": {
            // A whole keyframed shot rather than one settled pose. `Camera` is a `Displayable`, so it
            // takes the same `Transform` a sprite does, built by the same function `/transform` uses -
            // which also owns the missing-id / unknown-asset diagnostics. `durationMs` and `easing` are
            // deliberately ignored: the timing is in the keyframes, and honouring the row's `d=` too
            // would silently compete with them.
            const motion = payload.motion;
            if (!motion || motion.mode !== "animation") {
                diagnostic(ctx, "warning", block.id, "Camera motion is missing a Story Motion binding.");
                return [];
            }
            const transform = createAnimationTransform(motion, ctx, block.id, "none");
            return transform ? [recordStatement(ctx, camera.transform(transform), block)] : [];
        }
        default:
            return [];
    }
}

async function compileCharacterStageAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "character" }>,
): Promise<NlrStatement[]> {
    const name = getCharacterStageObjectName(payload);
    const statements: NlrStatement[] = [];

    // The only operation that addresses the Character record rather than its portrait: it renames the
    // speaker label from this row on ("？？？" → the real name), so it needs no image and no transform.
    if (payload.operation === "setName") {
        const character = getCharacter(ctx, payload.characterId);
        return [recordStatement(ctx, character.setName(payload.displayName ?? ""), block)];
    }

    // A puppet character is a different element class, not a differently-sourced Image, so it
    // branches before anything reaches `getImage`.
    const characterAppearance = payload.characterId
        ? ctx.characterSummaries.get(payload.characterId)?.appearance
        : undefined;
    if (characterAppearance?.kind === "puppet") {
        return compileCharacterPuppetAction(ctx, block, payload, name, characterAppearance);
    }

    // Runtime state on a character Studio draws itself: there is no backend to ask, and the row was
    // authored against the wrong character rather than being a no-op worth swallowing.
    if (payload.operation === "setMotion" || payload.operation === "setSkin" || payload.operation === "setParams") {
        const channel = payload.operation === "setMotion" ? "motion" : payload.operation === "setSkin" ? "skin" : "parameters";
        diagnostic(ctx, "warning", block.id, `${payload.characterId || name} is not drawn by a runtime, so it has no ${channel} to set.`);
        return statements;
    }

    if (payload.operation === "exit") {
        const image = getImage(ctx, name, { autoFit: true });
        await bindCharacterPortrait(ctx, payload.characterId, image);
        const chain = compileDisplayableOperation(image, "hide", payload.transform ?? { preset: "fadeOut", durationMs: 250 }, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
        return statements;
    }

    if (payload.operation === "move") {
        const image = getImage(ctx, name, { autoFit: true });
        await bindCharacterPortrait(ctx, payload.characterId, image);
        const chain = compileDisplayableOperation(image, "transform", payload.transform, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
        return statements;
    }

    // A layered character is one Image built from its whole stack; what a row changes is the tags,
    // never the src. `enter` resolves the selection out to every axis because it has to pose the
    // whole character; `expression` sends only the axes the row touched, so switching the mood
    // leaves the outfit exactly as an earlier row put it.
    const layeredSrc = payload.assetId ? null : await resolveCharacterLayeredSrc(ctx, payload.characterId, block.id);
    if (layeredSrc) {
        const appearance = ctx.characterSummaries.get(payload.characterId!)?.appearance;
        const image = getImage(ctx, name, { autoFit: true, src: layeredSrc as never });
        await bindCharacterPortrait(ctx, payload.characterId, image);
        const selection = payload.operation === "enter"
            ? resolveTagSelection(appearance, payload.tags)
            : payload.tags ?? {};
        const tags = Object.values(selection);
        if (payload.operation === "enter") {
            const chain = image.char(tags as never).show(createShowTransform(payload.transform, ctx, block.id) as any);
            statements.push(recordStatement(ctx, chain, block));
            return statements;
        }
        if (tags.length === 0) {
            diagnostic(ctx, "warning", block.id, `Expression for ${payload.characterId || name} selects no tag; nothing changes.`);
            return statements;
        }
        const chain = image.char(tags as never, createTransition(payload.transition, ctx, block.id) as any);
        statements.push(recordStatement(ctx, chain, block));
        return statements;
    }

    const src = payload.assetId
        ? await resolveAsset(ctx, payload.assetId, "image", block.id)
        : await resolveCharacterImageUrl(ctx, payload.characterId, payload.pose, block.id);
    if (!src) {
        diagnostic(ctx, "warning", block.id, `Character image source not found for ${payload.characterId || name}.`);
        return statements;
    }

    const image = getImage(ctx, name, { autoFit: true, src });
    await bindCharacterPortrait(ctx, payload.characterId, image);
    if (payload.operation === "enter") {
        // An entering character has no prior image to transition from, so `enter` never uses a
        // transition - its entrance is driven entirely by the show transform. (A transition only
        // applies to `expression`, which swaps a visible character's source.)
        const chain = image.char(src as any).show(createShowTransform(payload.transform, ctx, block.id) as any);
        statements.push(recordStatement(ctx, chain, block));
        return statements;
    }

    // expression: swap a visible character's appearance, optionally with an image transition.
    const sourceChain = image.char(src as any, createTransition(payload.transition, ctx, block.id) as any);
    statements.push(recordStatement(ctx, sourceChain, block));
    return statements;
}

/**
 * Compile a stage row for a character the author's own runtime draws.
 *
 * A puppet is a box: the engine owns where it sits, its layer, its transform and its place in a
 * saved game, and hands the inside to a backend registered under `appearance.backend`. So the
 * operations that mean something here are exactly the ones that address the box - enter / exit /
 * move - and they are compiled through the same `compileDisplayableOperation` an Image row uses,
 * which is the point: a puppet character participates in a scene the way any other character does.
 *
 * The other four - `expression`, `setMotion`, `setSkin`, `setParams` - address the INSIDE of the box,
 * which no other character kind has. They are not a source swap: the row carries a name the backend
 * owns (`puppetName`), handed over verbatim, and the engine remembers it as persistent state that a
 * saved game restores. A row that names nothing clears that channel, which is the engine's own
 * `null`: "the absence of a request", not "leave whatever is there".
 *
 * `setParams` is the one that is not a single name. Its payload is a map and the engine's `setParam`
 * merges, so it compiles to one statement per entry - and a parameter has no `null`: an absent key
 * means "keep the model's own default", which is why nothing here clears one.
 */
async function compileCharacterPuppetAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "character" }>,
    name: string,
    appearance: Extract<DevModeCharacterSummary["appearance"], { kind: "puppet" }>,
): Promise<NlrStatement[]> {
    const puppet = await getPuppetElement(ctx, name, appearance, block.id);
    if (!puppet) {
        return [];
    }
    await bindPuppetAvatar(ctx, payload.characterId);

    // Blank and absent both mean `null` - the row requests nothing on this channel, and the model
    // visibly drops back to whatever it looks like with none applied.
    const requested = payload.puppetName?.trim() || null;
    if (payload.operation === "expression") {
        return [recordStatement(ctx, puppet.setExpression(requested), block)];
    }
    if (payload.operation === "setMotion") {
        return [recordStatement(ctx, puppet.setMotion(requested), block)];
    }
    if (payload.operation === "setSkin") {
        return [recordStatement(ctx, puppet.setSkin(requested), block)];
    }
    if (payload.operation === "setParams") {
        // One statement per entry. `Puppet.setParam` merges - it sets one id and leaves the others
        // alone - so the row's whole map arrives as a run of calls with no read-modify-write in
        // between, and the order among them cannot matter. A row asking for nothing compiles to
        // nothing rather than to a no-op statement the timeline would then have to draw.
        return Object.entries(payload.params ?? {})
            .filter(([id, value]) => id.trim() !== "" && Number.isFinite(value))
            .map(([id, value]) => recordStatement(ctx, puppet.setParam(id.trim(), value), block));
    }

    const operation = payload.operation === "exit" ? "hide" : payload.operation === "move" ? "transform" : "show";
    const transform = payload.operation === "exit"
        ? payload.transform ?? { preset: "fadeOut" as const, durationMs: 250 }
        : payload.transform;
    const chain = compileDisplayableOperation(puppet, operation, transform, ctx, block.id);
    return chain ? [recordStatement(ctx, chain, block)] : [];
}

/**
 * The scene's `Puppet` for a stage name, created on first use.
 *
 * Created once and never re-sourced, because a puppet **cannot** change its `src`: the backend's
 * instance lives as long as the element is on stage, and swapping the model underneath it would
 * tear that instance down while the engine's box, transform and saved state stayed put. Returns
 * null when the character names no model - the engine's `src` is required, and an empty one would
 * reach a backend as a resource descriptor pointing at nothing.
 */
async function getPuppetElement(
    ctx: SceneCompileContext,
    objectName: string,
    appearance: Extract<DevModeCharacterSummary["appearance"], { kind: "puppet" }>,
    blockId: string,
): Promise<Puppet | null> {
    const key = normalizeObjectName(objectName);
    const existing = ctx.puppets.get(key);
    if (existing) {
        return existing;
    }
    if (!appearance.assetId) {
        diagnostic(ctx, "warning", blockId, `Puppet character "${objectName}" has no model asset.`);
        return null;
    }
    if (!appearance.backend) {
        diagnostic(ctx, "warning", blockId, `Puppet character "${objectName}" names no runtime; nothing will draw it.`);
        return null;
    }
    // The bundle's entry file. Studio resolves the asset and stops there: which siblings a model
    // pulls in is knowable only after parsing this one, and the engine does that arithmetic itself
    // (`PuppetMountContext.resolveSibling`) against exactly this URL.
    const bundleUrl = await resolveAsset(ctx, appearance.assetId, "model", blockId);
    if (!bundleUrl) {
        diagnostic(ctx, "warning", blockId, `Puppet model not found for ${objectName}.`);
        return null;
    }
    const src = appearance.entry ? resolveBundleEntry(bundleUrl, appearance.entry) : bundleUrl;
    const puppet = new Puppet({
        backend: appearance.backend,
        src,
        options: appearance.options,
        // null is the engine's own default and means the stage size, so it is passed through
        // rather than substituted with a guess at what the stage happens to be.
        size: appearance.size,
        // The pose the author chose in the inspector. It has to be constructor config rather than a
        // first action: `IPuppetUserConfig` is what survives `reset()`, so a puppet restored from a
        // save or re-entered after `newGame()` comes back wearing it. Each channel is independently
        // optional, and `null` is a real value there - "nothing applied" - so an unset channel is
        // omitted rather than sent as null, which would overwrite the model's own default.
        ...(appearance.defaultState?.motion ? { motion: appearance.defaultState.motion } : {}),
        ...(appearance.defaultState?.expression ? { expression: appearance.defaultState.expression } : {}),
        ...(appearance.defaultState?.skin ? { skin: appearance.defaultState.skin } : {}),
    });
    ctx.puppets.set(key, puppet);
    return puppet;
}

/**
 * Resolve an entry override against the bundle URL, by the same rule the engine's `resolveSibling`
 * applies: everything before the last `/` is the bundle root, `.` and `..` fold, an already-absolute
 * path wins outright, and a backslash reads as `/`.
 *
 * Written out rather than delegated because the engine only offers this arithmetic to a *mounted*
 * backend, and the entry has to be decided at compile time - and duplicated deliberately rather
 * than approximated, so the two never disagree about where a bundle's root is.
 */
export function resolveBundleEntry(bundleUrl: string, entry: string): string {
    const path = entry.replace(/\\/g, "/").trim();
    if (!path) {
        return bundleUrl;
    }
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(path) || path.startsWith("/")) {
        return path;
    }
    const base = bundleUrl.replace(/\\/g, "/");
    const cut = base.lastIndexOf("/");
    const root = cut === -1 ? "" : base.slice(0, cut + 1);
    const segments: string[] = [];
    for (const segment of `${root}${path}`.split("/")) {
        if (segment === ".") continue;
        if (segment === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") {
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    return segments.join("/");
}

/**
 * Give a puppet character the dialog avatar its profile declares.
 *
 * Not `bindCharacterPortrait`: that one registers the *stage sprite* as a portrait so the engine
 * can report which differential is on screen, and a puppet has neither a sprite nor differentials.
 * What is left is the character-level default, which is set directly.
 */
async function bindPuppetAvatar(ctx: SceneCompileContext, characterId: string | undefined): Promise<void> {
    const summary = characterId ? ctx.characterSummaries.get(characterId) : undefined;
    const assetId = summary?.defaultAvatarAssetId?.trim();
    if (!summary || !assetId) {
        return;
    }
    if (ctx.avatarBoundCharacterIds.has(summary.id)) {
        return;
    }
    ctx.avatarBoundCharacterIds.add(summary.id);
    const url = await resolveAsset(ctx, assetId, "image", `avatar:${summary.id}`);
    if (url) {
        ctx.avatarAssetIdByUrl.set(url, assetId);
        getCharacter(ctx, summary.id).setAvatar(url);
    }
}

/**
 * The bus an operation lands on when its row names no track.
 *
 * `setBgm` is music by construction, everything else is a sound effect - which is exactly the split
 * this compiler used to hard-code as `Sound.bgm` / `Sound.sound`. It survives as the *fallback*
 * rather than the rule, so a project with no tracks configured compiles to what it always did.
 * (Dialogue voice is not here: it is not an audio row, and its bus comes off the speaking character
 * - see {@link characterVoiceBusId}.)
 */
function audioActionFallbackChannel(
    operation: Extract<StoryActionPayload, { action: "audio" }>["operation"],
): AudioTrackChannel {
    return operation === "setBgm" ? "bgm" : "sound";
}

/**
 * The bus a voice clip may play on, given what a character asks for.
 *
 * Three ways to land back on plain `voice`, and all three are degradations rather than errors:
 *
 * - **Nothing asked for.** Every character until an author gives one a track, so a project that
 *   never opens Project → Audio compiles the bytes it always did.
 * - **A track that no longer exists.** `resolveAudioTrack`'s ordinary fallback. References are never
 *   rewritten, so restoring the track restores the routing; losing the separate slider is a far
 *   lesser harm than losing the line.
 * - **A track that is not beneath `voice`.** Only reachable by re-parenting a bus in Project → Audio
 *   after a character was pointed at it, since the character editor offers nothing else. It matters
 *   because the engine *throws* on a voice that is not on the voice subtree, and it throws while
 *   constructing the `Scene` - so honouring the stale id would not misroute one line, it would fail
 *   the whole compile on a project the author can no longer see the problem in.
 */
function resolveVoiceBusId(
    tracks: readonly ProjectAudioTrack[],
    requested: string | null | undefined,
): string {
    const track = resolveAudioTrack(tracks, requested, AUDIO_TRACK_ID_VOICE);
    const underVoice = resolveAudioTrackChain(tracks, track.id, AUDIO_TRACK_ID_VOICE)
        .some(entry => entry.id === AUDIO_TRACK_ID_VOICE);
    return underVoice ? track.id : AUDIO_TRACK_ID_VOICE;
}

/**
 * The bus this line's speaker's voice plays on.
 *
 * A temp speaker (a bare name with no character behind it) has no track to read and lands on
 * `voice` through the same path - `characterSummaries` simply does not have the id.
 */
function characterVoiceBusId(ctx: SceneCompileContext, characterId: string | undefined): string {
    const id = characterId?.trim();
    return resolveVoiceBusId(ctx.audioTracks, id ? ctx.characterSummaries.get(id)?.voiceTrackId : undefined);
}

/**
 * The track a row plays on, and the resolved playback that follows from it.
 *
 * `payload.audioTrackId` wins when the row names one. Otherwise the handle's OWN track is used when
 * it has one - the handle was built on that bus and there is only one of it, so a later row that
 * resolved to a different one would describe a routing the game cannot perform. Only when neither
 * exists does the operation's natural bus decide.
 */
function resolveRowPlayback(
    ctx: SceneCompileContext,
    payload: Extract<StoryActionPayload, { action: "audio" }>,
    soundName: string | null,
): { track: ProjectAudioTrack; playback: AudioTrackPlayback } {
    const trackId = payload.audioTrackId?.trim()
        || (soundName ? ctx.soundTrackIds.get(soundName) : undefined);
    const track = resolveAudioTrack(ctx.audioTracks, trackId, audioActionFallbackChannel(payload.operation));
    return {
        track,
        playback: resolveAudioTrackPlayback(track, {
            volume: payload.volume,
            loop: payload.loop,
        }),
    };
}

/**
 * The fade a row asks for, in ms. Absent is a hard cut.
 *
 * It comes from the row and only from the row. A track used to carry a fade pair and hand it over
 * whenever a row left the field empty, which invented a default that had never existed - the same
 * `/bgm theme` meant a cut before and an ease after, with nothing on screen saying so. Every verb
 * here already takes its own `fade`, so there was never anything for the track's to fill in.
 */
function rowFadeMs(payload: Extract<StoryActionPayload, { action: "audio" }>): number {
    return payload.fadeMs ?? 0;
}

async function compileAudioAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "audio" }>,
): Promise<NlrStatement[]> {
    if (payload.operation === "setBgm") {
        if (!payload.assetId) {
            // Clearing addresses the music that is PLAYING, so the handle goes with it. There is no
            // track to resolve: nothing is being routed, only stopped, over this row's own fade.
            ctx.sounds.delete(BGM_SOUND_NAME);
            ctx.soundTrackIds.delete(BGM_SOUND_NAME);
            return [recordStatement(ctx, ctx.nlrScene.setBackgroundMusic(null, rowFadeMs(payload)), block)];
        }
        // A `/bgm` with an asset builds a NEW handle and replaces whatever was under `bgm`, so it
        // resolves from its own row alone: inheriting the previous music's track would make the
        // second `/bgm` in a scene mean something different from the first, invisibly. For the same
        // reason there is no conflict check here - a re-point is not a dropped intent.
        const { track, playback } = resolveRowPlayback(ctx, payload, null);
        const url = await resolveAsset(ctx, payload.assetId, "audio", block.id);
        if (!url) {
            return [];
        }
        const sound = createBusSound(ctx.audioTracks, playback.busId, "bgm", {
            src: url,
            loop: playback.loop,
            volume: playback.volume,
            ...clipRegionConfig(ctx, payload.assetId),
        });
        // The reserved name the sound-control family defaults to: `/vol 0.5` addresses the music
        // channel by registering the BGM handle under "bgm" (see BGM_OBJECT_NAME in the editor).
        ctx.sounds.set(BGM_SOUND_NAME, sound);
        ctx.soundTrackIds.set(BGM_SOUND_NAME, track.id);
        return [recordStatement(ctx, ctx.nlrScene.setBackgroundMusic(sound, rowFadeMs(payload)), block)];
    }

    const name = normalizeObjectName(payload.objectName || payload.assetId || "sound");
    const sound = await getSound(ctx, name, payload.assetId, block.id, payload);
    if (!sound) {
        return [];
    }
    // Resolved AFTER `getSound`, so a row that just created the handle reads back the track it was
    // created on rather than the fallback - the two must agree or the row's diagnostic would name a
    // different bus from the one the handle actually holds.
    const { playback } = resolveRowPlayback(ctx, payload, name);
    const fadeMs = rowFadeMs(payload);

    switch (payload.operation) {
        case "playSound":
            return [recordStatement(ctx, sound.play(fadeMs), block)];
        case "stopSound":
            return [recordStatement(ctx, sound.stop(fadeMs), block)];
        case "pauseSound":
            return [recordStatement(ctx, sound.pause(fadeMs), block)];
        case "resumeSound":
            return [recordStatement(ctx, sound.resume(fadeMs), block)];
        case "setVolume":
            // The clip's own level, unmultiplied - the buses above it apply live in the gain graph,
            // so a `/vol piano 0.4` sets `piano` to 0.4 of whatever the player's sliders allow.
            return [recordStatement(ctx, sound.setVolume(playback.volume, fadeMs), block)];
        case "setRate":
            return [recordStatement(ctx, sound.setRate(payload.rate ?? 1), block)];
        case "muteSound":
            return [recordStatement(ctx, sound.mute(payload.muted ?? true), block)];
        case "seekSound":
            // Seconds at the engine boundary, milliseconds in the payload - the same conversion
            // every other time in this compiler makes.
            return [recordStatement(ctx, sound.seek((payload.timeMs ?? 0) / 1000), block)];
        default:
            return [];
    }
}

/**
 * Report a row that names a track for a sound handle that already has a different one.
 *
 * The handle is created once, by whichever row reaches it first, and every later row addressing that
 * name inherits its bus - so a second `/sound piano track=Ambience` does nothing at all. That is two
 * expressed intents and only one outcome, which is a diagnostic rather than a silent win: the author
 * who typed the second track name would otherwise have no way to learn it was dropped.
 *
 * A row that names NO track is not a conflict. Inheriting is the normal case, and complaining about
 * it would put a mark on every `/vol` line in the story.
 */
function reportTrackConflict(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "audio" }>,
    name: string,
): void {
    const requested = payload.audioTrackId?.trim();
    if (!requested) {
        return;
    }
    const existing = ctx.soundTrackIds.get(name);
    if (!existing || existing === requested) {
        return;
    }
    const nameOf = (id: string): string => ctx.audioTracks.find(track => track.id === id)?.name ?? id;
    diagnostic(
        ctx,
        "warning",
        blockId,
        `"${name}" is already playing on the "${nameOf(existing)}" track, so this row's "${nameOf(requested)}" `
        + "is ignored. Use a different sound name, or set the track on the row that starts it.",
    );
}

async function compileImageAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "image" }>,
): Promise<NlrStatement[]> {
    const image = getImage(ctx, payload.objectName, {
        autoFit: payload.autoFit,
        layer: resolveLayerForRef(ctx, payload.layer),
    });
    const statements: NlrStatement[] = [];
    const src = payload.assetId
        ? await resolveAsset(ctx, payload.assetId, "image", block.id)
        : payload.color;

    if ((payload.operation === "create" || payload.operation === "setSource") && src) {
        statements.push(recordStatement(ctx, image.char(src as any, createTransition(payload.transition, ctx, block.id) as any), block));
    } else if ((payload.operation === "create" || payload.operation === "setSource") && !src) {
        diagnostic(ctx, "warning", block.id, `Image "${payload.objectName}" has no asset or color source.`);
    }

    if (payload.operation === "show" || payload.operation === "hide" || payload.operation === "create") {
        const operation = payload.operation === "hide" ? "hide" : "show";
        const chain = compileDisplayableOperation(image, operation, payload.transform, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
    }

    return statements;
}

function compileTextAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "text" }>,
): NlrStatement[] {
    const text = getText(ctx, payload.objectName, {
        text: payload.text,
        fontSize: payload.fontSize,
        fontColor: payload.fontColor,
        layer: resolveLayerForRef(ctx, payload.layer),
    });
    const statements: NlrStatement[] = [];

    if ((payload.operation === "create" || payload.operation === "setText") && payload.text !== undefined) {
        statements.push(recordStatement(ctx, text.setText(payload.text), block));
    }
    if (payload.operation === "setFontSize" || (payload.operation === "create" && payload.fontSize !== undefined)) {
        statements.push(recordStatement(ctx, text.setFontSize(payload.fontSize ?? 16, payload.transform?.durationMs ?? 0, payload.transform?.easing as any), block));
    }
    if (payload.operation === "setFontColor" || (payload.operation === "create" && payload.fontColor)) {
        statements.push(recordStatement(ctx, text.setFontColor((payload.fontColor ?? "#ffffff") as any, payload.transform?.durationMs ?? 0, payload.transform?.easing as any), block));
    }
    if (payload.operation === "show" || payload.operation === "hide" || payload.operation === "create") {
        const chain = compileDisplayableOperation(text, payload.operation === "hide" ? "hide" : "show", payload.transform, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
    }

    return statements;
}

function compileLayerAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "layer" }>,
): NlrStatement[] {
    // `create` names a new custom layer; every other op resolves an existing layer - a built-in
    // (background / displayable) or a custom one - via the target ref (falling back to the default
    // displayable layer), so a transform can now target the background instead of only named layers.
    const layer = payload.operation === "create"
        ? getLayer(ctx, payload.objectName, payload.zIndex)
        : resolveLayerForRef(ctx, layerActionTargetRef(payload.target, payload.objectName)) ?? ctx.nlrScene.displayableLayer;
    const statements: NlrStatement[] = [];
    if (payload.operation === "setZIndex" || (payload.operation === "create" && payload.zIndex !== undefined)) {
        statements.push(recordStatement(ctx, layer.setZIndex(payload.zIndex ?? 0), block));
    }
    if (payload.operation === "show" || payload.operation === "hide" || payload.operation === "transform") {
        const operation = payload.operation === "show" || payload.operation === "hide" ? payload.operation : "transform";
        const chain = compileDisplayableOperation(layer, operation, payload.transform, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
    }
    return statements;
}

async function compileVideoAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "video" }>,
): Promise<NlrStatement[]> {
    const video = await getVideo(ctx, payload.objectName, payload.assetId, payload.muted, block.id);
    if (!video) {
        return [];
    }
    if (payload.operation === "show" || payload.operation === "create") {
        return [recordStatement(ctx, video.show(), block)];
    }
    if (payload.operation === "hide") {
        return [recordStatement(ctx, video.hide(), block)];
    }
    if (payload.operation === "play") {
        return [recordStatement(ctx, video.play(), block)];
    }
    if (payload.operation === "pause") {
        return [recordStatement(ctx, video.pause(), block)];
    }
    if (payload.operation === "resume") {
        return [recordStatement(ctx, video.resume(), block)];
    }
    if (payload.operation === "stop") {
        return [recordStatement(ctx, video.stop(), block)];
    }
    if (payload.operation === "seek") {
        // The engine seeks in SECONDS; the payload stores milliseconds like every other time in this
        // document. A negative position is not a frame, so it floors at the start of the clip.
        return [recordStatement(ctx, video.seek(Math.max(0, finiteOr(payload.timeMs, 0)) / 1000), block)];
    }
    return [];
}

/**
 * `vfx` - the full-screen ambience overlay. Shaped like `compileVideoAction`, not like the displayable
 * ops, because a `Vfx` is an `Actionable`: it has `show`/`hide`/`pause`/`resume`/`setPlaybackRate` and
 * nothing else. `create` both constructs it and registers the name the later rows address.
 */
async function compileVfxAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "vfx" }>,
): Promise<NlrStatement[]> {
    const vfx = await getVfx(ctx, payload, block.id);
    if (!vfx) {
        return [];
    }
    // A create shows the overlay: the row an author writes to "put petals on screen" must put them on
    // screen, exactly as `/image` and `/video` do.
    const fade = { duration: Math.max(0, finiteOr(payload.durationMs, 0)), ease: payload.easing as any };
    switch (payload.operation) {
        case "create":
        case "show":
            return [recordStatement(ctx, vfx.show(fade as any), block)];
        case "hide":
            return [recordStatement(ctx, vfx.hide(fade as any), block)];
        case "pause":
            return [recordStatement(ctx, vfx.pause(), block)];
        case "resume":
            return [recordStatement(ctx, vfx.resume(), block)];
        case "setRate":
            // A rate of 0 freezes the loop, which is what `pause` is for; a negative one is not a speed.
            return [recordStatement(ctx, vfx.setPlaybackRate(Math.max(0, finiteOr(payload.rate, 1))), block)];
        default:
            return [];
    }
}

async function getVfx(
    ctx: SceneCompileContext,
    payload: Extract<StoryActionPayload, { action: "vfx" }>,
    blockId: string,
): Promise<Vfx | null> {
    const name = normalizeObjectName(payload.objectName);
    const existing = ctx.vfx.get(name);
    if (existing) {
        return existing;
    }
    if (!payload.assetId) {
        diagnostic(ctx, "warning", blockId, `Ambience effect "${name}" has no clip.`);
        return null;
    }
    const url = await resolveAsset(ctx, payload.assetId, "video", blockId);
    if (!url) {
        return null;
    }
    const vfx = new Vfx({
        src: url,
        ...(payload.blendMode ? { blendMode: payload.blendMode } : {}),
        ...(payload.opacity !== undefined ? { opacity: Math.min(1, Math.max(0, finiteOr(payload.opacity, 1))) } : {}),
        ...(payload.loop !== undefined ? { loop: payload.loop } : {}),
        ...(payload.fit ? { fit: payload.fit } : {}),
        ...(payload.zIndex !== undefined ? { zIndex: payload.zIndex } : {}),
        // A rate on the CREATE row is the loop's resting speed - and the only one that survives a save,
        // since the engine does not persist a runtime `setPlaybackRate`.
        ...(payload.rate !== undefined ? { playbackRate: Math.max(0, finiteOr(payload.rate, 1)) } : {}),
    });
    ctx.vfx.set(name, vfx);
    return vfx;
}

async function compileChoice(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "nodeAction" }>): Promise<NlrStatement[]> {
    if (block.payload.action !== "choice") {
        return [];
    }
    const choiceBlocks = block.childrenIds
        .map(childId => ctx.scene.blocks[childId])
        // A disabled option is compiled out like any other disabled row — the menu never offers it.
        .filter((child): child is Extract<StoryBlock, { kind: "nodeAction" }> => child?.kind === "nodeAction" && child.payload.action === "choiceOption" && !child.disabled);

    if (choiceBlocks.length === 0) {
        diagnostic(ctx, "warning", block.id, "Choice has no options.");
        return [];
    }

    const promptSegment = block.payload.prompt;
    let chain: any = Menu.prompt(
        promptSegment ? (buildLocalizedSentencePrompt(ctx, promptSegment, block.id) as any) : null,
    );
    for (const option of choiceBlocks) {
        if (option.payload.action !== "choiceOption") {
            continue;
        }
        const optionSegment = option.payload.text;
        chain = chain.choose({
            prompt: optionSegment.value || segmentHasInterpolation(optionSegment)
                ? (buildLocalizedSentencePrompt(ctx, optionSegment, option.id) as any)
                : "Option",
            action: await compileBlockList(ctx, option.childrenIds) as any,
            config: {
                hidden: conditionToLambda(ctx, option.payload.hiddenWhen, option.id),
                disabled: conditionToLambda(ctx, option.payload.disabledWhen, option.id),
            },
        });
    }
    return [recordStatement(ctx, chain, block)];
}

async function compileCondition(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "control" }>): Promise<NlrStatement[]> {
    const branches = block.childrenIds
        .map(childId => ctx.scene.blocks[childId])
        // A disabled branch is compiled out — the condition behaves as if that branch were never written.
        .filter((child): child is Extract<StoryBlock, { kind: "control" }> => child?.kind === "control" && child.payload.control === "conditionBranch" && !child.disabled);

    const firstBranch = branches.find(branch => branch.payload.control === "conditionBranch" && branch.payload.branch !== "else");
    if (!firstBranch || firstBranch.payload.control !== "conditionBranch") {
        diagnostic(ctx, "warning", block.id, "Condition has no if branch.");
        return [];
    }

    let chain: any = Condition.If(
        conditionToLambda(ctx, firstBranch.payload.condition, firstBranch.id) ?? falseCondition,
        await compileBlockList(ctx, firstBranch.childrenIds) as any,
    );

    for (const branch of branches) {
        if (branch.id === firstBranch.id || branch.payload.control !== "conditionBranch") {
            continue;
        }
        if (branch.payload.branch === "else") {
            chain = chain.Else(await compileBlockList(ctx, branch.childrenIds) as any);
            continue;
        }
        chain = chain.ElseIf(
            conditionToLambda(ctx, branch.payload.condition, branch.id) ?? falseCondition,
            await compileBlockList(ctx, branch.childrenIds) as any,
        );
    }

    return [recordStatement(ctx, chain, block)];
}

/**
 * `label` and `goto` - the in-scene play head, and the two ways an author can break it.
 *
 * Both faults are diagnosed HERE rather than left to the engine, because both make the engine's own
 * `Story.build` throw: the author would get a build failure with no row to blame. `error` (not
 * `warning`) is deliberate - a production build refuses on error diagnostics, which is exactly the
 * outcome wanted, only reported against the row that caused it.
 *
 * Labels are matched by NAME, scene-scoped, so the same name may recur in another scene; the checks
 * read the one shared scan (`listSceneLabels`) the command line's completion reads, so a name the
 * editor offered can never be a name the compile then rejects.
 */
function compileLabelControl(
    ctx: SceneCompileContext,
    block: Extract<StoryBlock, { kind: "control" }>,
    payload: Extract<StoryControlPayload, { control: "label" | "goto" }>,
): NlrStatement[] {
    if (payload.control === "label") {
        const name = payload.name.trim();
        if (!name) {
            diagnostic(ctx, "error", block.id, "Label has no name.");
            return [];
        }
        // The first declaration is the one that stands, so only the later rows are faulted.
        if (duplicateSceneLabels(ctx.scene).some(duplicate => duplicate.blockId === block.id)) {
            diagnostic(ctx, "error", block.id, `Label "${name}" is declared more than once in this scene.`);
            return [];
        }
        return [recordStatement(ctx, Control.label(name), block)];
    }

    const target = payload.targetLabel.trim();
    if (!target) {
        diagnostic(ctx, "error", block.id, "Go to has no target label.");
        return [];
    }
    // Exactly, case included - the engine matches a jump against a plain `Map` of declared names, so
    // a `/goto start` left behind by a label renamed `Start` IS a broken jump and has to be said so.
    if (!sceneLabelNames(ctx.scene).includes(target)) {
        diagnostic(ctx, "error", block.id, `Go to target label not found in this scene: ${target}`);
        return [];
    }
    return [recordStatement(ctx, Control.jump(target), block)];
}

async function compileControlGroup(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "control" }>): Promise<NlrStatement[]> {
    const payload = block.payload as Extract<StoryControlPayload, { control: "sequence" | "parallel" | "race" | "repeat" }>;
    const children = await compileBlockList(ctx, block.childrenIds);
    const mode = payload.mode ?? (payload.control === "parallel" ? "all" : payload.control === "race" ? "any" : "do");
    const chain = payload.control === "repeat"
        ? Control.repeat(Math.max(0, payload.times ?? 1), children as any)
        : mode === "doAsync"
            ? Control.doAsync(children as any)
            : mode === "all"
                ? Control.all(children as any)
                : mode === "allAsync"
                    ? Control.allAsync(children as any)
                    : mode === "any"
                        ? Control.any(children as any)
                        : Control.do(children as any);
    return [recordStatement(ctx, chain, block)];
}

async function compileNvl(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "action" }>): Promise<NlrStatement[]> {
    if (block.payload.action !== "nvl") {
        return [];
    }
    const children = await compileBlockList(ctx, block.childrenIds);
    const chain = ctx.nlrScene.nvl(transformOptions(block.payload.transition) as any, children as any);
    return [recordStatement(ctx, chain, block)];
}

function getCharacter(ctx: SceneCompileContext, characterId: string | undefined, speakerName?: string): Character {
    const id = characterId?.trim();
    const tempName = speakerName?.trim();
    // A temp speaker - a bare name with no Studio character behind it - is a valid line, not an
    // error: NLR's dialogue box only ever displays the name its Character carries. It also covers
    // the case where `characterId` no longer resolves (the character was deleted): falling back to
    // the name the author wrote beats collapsing the line to "Unknown".
    if (tempName && (!id || !ctx.characterSummaries.has(id))) {
        // Keyed on the name so every line by the same temp speaker shares one Character. ':' cannot
        // appear in a characterId UUID, so this can never collide with the real-character keys.
        const key = `name:${tempName}`;
        const cached = ctx.characters.get(key);
        if (cached) {
            return cached;
        }
        const created = new Character(tempName);
        ctx.characters.set(key, created);
        return created;
    }
    const normalizedId = id || UNKNOWN_CHARACTER_ID;
    const existing = ctx.characters.get(normalizedId);
    if (existing) {
        return existing;
    }
    // Two things this fallback must never produce. An empty name makes the Character
    // indistinguishable from NLR's Narrator (`Narrator = new Character(null)` collapses to
    // `state.name === ""`), so `useDialog` reports a real character as `isNarrator` and the avatar
    // silently disappears. `normalizedId` is a characterId UUID, which must never reach the UI.
    // Identity is keyed on `normalizedId` above, so this string is cosmetic only.
    const summary = ctx.characterSummaries.get(normalizedId);
    const displayName = summary?.name?.trim() || UNKNOWN_CHARACTER_NAME;
    const character = new Character(displayName, characterNametagConfig(summary));
    ctx.characters.set(normalizedId, character);
    return character;
}

/** `#rgb` or `#rrggbb`; anything else is not a colour Studio wrote and is not forwarded. */
const CHARACTER_ACCENT_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * The engine-side half of the character accent: `CharacterConfig.color`, which NLR's `Nametag`
 * applies as the CSS colour of the speaker's name. Absent config when the character has none, so the
 * dialogue box keeps whatever its own theme says.
 *
 * **Deliberately NOT filtered through `isReadableAccentColor`.** That band exists so an accent stays
 * legible on Studio's own two chrome surfaces, light and dark — it is a statement about the editor,
 * not about the game. The dialogue box is the author's artwork: a near-white name over a dark box is
 * an ordinary choice there, and Studio silently discarding it would ship a game that disagrees with
 * the colour the author picked, with nothing anywhere to explain why. The band still governs every
 * Studio surface (the story rows, the Dev Mode timeline), so the one place the two can differ is a
 * colour Studio declines to draw in its own chrome and forwards to the game exactly as authored.
 *
 * The hex is validated, though — a malformed value would land in a CSS declaration.
 */
function characterNametagConfig(summary: DevModeCharacterSummary | undefined): { color: `#${string}` } | undefined {
    const hex = summary?.color?.trim();
    return hex && CHARACTER_ACCENT_HEX.test(hex) ? { color: hex as `#${string}` } : undefined;
}

/**
 * `src` is either a url/colour or a layered definition — the engine takes both, and a layered
 * character's stack has to reach the constructor because an Image's src shape is fixed there. What
 * a later row changes is the tags, never the src.
 */
function getImage(ctx: SceneCompileContext, objectName: string, options?: { layer?: Layer; autoFit?: boolean; src?: string | { layers: unknown[]; defaults: string[] }; initialProps?: Record<string, unknown> }): Image {
    const name = normalizeObjectName(objectName);
    const existing = ctx.images.get(name);
    if (existing) {
        if (options?.layer) {
            existing.useLayer(options.layer);
        }
        return existing;
    }
    const image = new Image({
        name,
        src: options?.src ?? EMPTY_IMAGE_SRC,
        autoFit: options?.autoFit ?? false,
        layer: options?.layer,
        // Initial transform-state pose baked into the constructor config (survives reset()).
        ...(options?.initialProps ?? {}),
    } as any);
    ctx.images.set(name, image);
    return image;
}

function getText(ctx: SceneCompileContext, objectName: string, options: { text?: string; fontSize?: number; fontColor?: string; layer?: Layer; initialProps?: Record<string, unknown> }): Text {
    const name = normalizeObjectName(objectName);
    const existing = ctx.texts.get(name);
    if (existing) {
        if (options.layer) {
            existing.useLayer(options.layer);
        }
        return existing;
    }
    const text = new Text(options.text ?? "", {
        fontSize: options.fontSize ?? 32,
        fontColor: (options.fontColor ?? "#ffffff") as any,
        layer: options.layer,
        ...(options.initialProps ?? {}),
    } as any);
    ctx.texts.set(name, text);
    return text;
}

function getLayer(ctx: SceneCompileContext, objectName: string, zIndex = 0, initialProps?: Record<string, unknown>): Layer {
    const name = normalizeObjectName(objectName);
    const existing = ctx.layers.get(name);
    if (existing) {
        return existing;
    }
    const layer = new Layer(name, { zIndex, ...(initialProps ?? {}) } as any);
    ((ctx.nlrScene as unknown as { config: { layers: Layer[] } }).config.layers).push(layer);
    ctx.layers.set(name, layer);
    return layer;
}

/**
 * Resolve an image/text `layer` reference to a concrete NLR {@link Layer}, or `undefined` to leave
 * the displayable on the scene's default layer. Built-in refs map to NLR's `Scene.backgroundLayer`
 * / `Scene.displayableLayer`; a custom ref resolves through its stable creator block (so it follows
 * renames) to the same name-keyed layer the `layer` create block registers.
 */
function resolveLayerForRef(ctx: SceneCompileContext, ref: StoryLayerRef | undefined): Layer | undefined {
    if (!ref) {
        return undefined;
    }
    if (ref.kind === "default") {
        return ref.layer === "background" ? ctx.nlrScene.backgroundLayer : ctx.nlrScene.displayableLayer;
    }
    const name = resolveStoryLayerRef(ctx.scene, ref).name.trim();
    if (!name) {
        return undefined;
    }
    const sourceBlock = ref.sourceBlockId ? ctx.scene.blocks[ref.sourceBlockId] : undefined;
    const zIndex = sourceBlock?.kind === "action" && sourceBlock.payload.action === "layer"
        ? sourceBlock.payload.zIndex ?? 0
        : 0;
    return getLayer(ctx, name, zIndex);
}

async function getVideo(ctx: SceneCompileContext, objectName: string, assetId: string | undefined, muted: boolean | undefined, blockId: string): Promise<Video | null> {
    const name = normalizeObjectName(objectName);
    const existing = ctx.videos.get(name);
    if (existing) {
        return existing;
    }
    if (!assetId) {
        diagnostic(ctx, "warning", blockId, `Video "${name}" has no asset.`);
        return null;
    }
    const url = await resolveAsset(ctx, assetId, "video", blockId);
    if (!url) {
        return null;
    }
    const video = new Video({ src: url, muted: muted ?? false });
    ctx.videos.set(name, video);
    return video;
}

/**
 * The named sound handle, created on first mention and reused after.
 *
 * **The cache is keyed by NAME, and the bus rides on the handle.** A row that names an existing
 * sound and also names a different track cannot get its track - the handle it addresses was routed
 * to the first row's bus, and there is only one of it. So that case is reported rather than passed
 * over; see {@link reportTrackConflict}.
 */
async function getSound(
    ctx: SceneCompileContext,
    objectName: string,
    assetId: string | undefined,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "audio" }>,
): Promise<Sound | null> {
    const name = normalizeObjectName(objectName);
    const existing = ctx.sounds.get(name);
    if (existing) {
        reportTrackConflict(ctx, blockId, payload, name);
        return existing;
    }
    if (!assetId) {
        diagnostic(ctx, "warning", blockId, name === "bgm"
            ? "No background music is set before this row - /bgm has to run first."
            : `Sound "${name}" has no asset.`);
        return null;
    }
    const url = await resolveAsset(ctx, assetId, "audio", blockId);
    if (!url) {
        return null;
    }
    const { track, playback } = resolveRowPlayback(ctx, payload, null);
    const sound = createBusSound(ctx.audioTracks, playback.busId, audioActionFallbackChannel(payload.operation), {
        src: url,
        loop: playback.loop,
        volume: playback.volume,
        rate: payload.rate ?? 1,
        ...clipRegionConfig(ctx, assetId),
    });
    ctx.sounds.set(name, sound);
    ctx.soundTrackIds.set(name, track.id);
    return sound;
}

/**
 * The in/out points marked on an asset, as `Sound` config.
 *
 * Applied to every sound the compiler builds, not only background music: an out point trims a sound
 * effect's tail as usefully as it loops a track's body, and the author marked one region per asset -
 * asking them to mark it again per row would be a second source of truth.
 *
 * The return type is inferred rather than written out. It was written out once, and when
 * `audioClipRegionToSoundConfig` grew `loopStart` the stale annotation statically widened the new key
 * away again - every clip's intro→loop point silently dropped on its way into the `Sound` config,
 * with nothing failing to say so. There is no second caller that needs the type named, so the fix is
 * to stop naming it.
 */
function clipRegionConfig(ctx: SceneCompileContext, assetId: string | undefined) {
    return audioClipRegionToSoundConfig(assetId ? ctx.audioClips?.[assetId] : undefined);
}

/**
 * Resolve a `displayable` action target to its concrete NLR object. Built-in singletons map to the
 * scene's `background` Image / built-in layers (always present); every other target resolves through
 * the stable creator-block ref to a named image / text / character / custom layer on stage.
 */
function resolveDisplayableActionTarget(ctx: SceneCompileContext, ref: StoryDisplayableTargetRef): any | null {
    if (ref.builtin === "background") return ctx.nlrScene.background;
    if (ref.builtin === "backgroundLayer") return ctx.nlrScene.backgroundLayer;
    if (ref.builtin === "displayableLayer") return ctx.nlrScene.displayableLayer;
    const resolved = resolveDisplayableTargetRef(ctx.scene, ref);
    return getDisplayable(ctx, resolved.name, resolved.kind);
}

function getDisplayable(ctx: SceneCompileContext, name: string, kind?: string): any | null {
    const normalized = normalizeObjectName(name);
    if (kind === "image" || !kind) return ctx.images.get(normalized) ?? (!kind ? ctx.texts.get(normalized) ?? ctx.layers.get(normalized) ?? null : null);
    if (kind === "text") return ctx.texts.get(normalized) ?? null;
    if (kind === "layer") return ctx.layers.get(normalized) ?? null;
    // A character is one element or the other, never both, so the lookup can simply try each.
    if (kind === "character") return ctx.images.get(normalized) ?? ctx.puppets.get(normalized) ?? null;
    return null;
}

const DISPLAYABLE_EFFECT_OPS = new Set([
    "mask", "clearMask", "clip", "clearClip", "filter", "clearFilter", "backdrop", "blend", "darken", "circleReveal", "circleClose", "wipe",
]);

function isDisplayableEffectOperation(operation: string): boolean {
    return DISPLAYABLE_EFFECT_OPS.has(operation);
}

type DisplayablePayload = Extract<StoryActionPayload, { action: "displayable" }>;

function effectVisualOptions(payload: DisplayablePayload): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    if (payload.durationMs !== undefined) {
        options.duration = Math.max(0, payload.durationMs);
    }
    if (payload.easing) {
        options.ease = payload.easing;
    }
    return options;
}

function circleEffectOptions(payload: DisplayablePayload, base: Record<string, unknown>): Record<string, unknown> {
    const props = payload.effectProps ?? {};
    const options: Record<string, unknown> = { ...base };
    const center = stringProp(props, "center", "");
    if (center) {
        options.center = center;
    }
    if (typeof props.from === "number") {
        options.from = props.from;
    }
    if (typeof props.to === "number") {
        options.to = props.to;
    }
    return options;
}

function wipeEffectOptions(payload: DisplayablePayload, base: Record<string, unknown>): Record<string, unknown> {
    const props = payload.effectProps ?? {};
    return {
        ...base,
        direction: stringProp(props, "direction", "left"),
        reverse: boolProp(props, "reverse", false),
    };
}

async function compileDisplayableEffect(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: DisplayablePayload,
    target: any,
): Promise<NlrStatement[]> {
    const options = effectVisualOptions(payload);
    const record = (chain: NlrStatement | null | undefined): NlrStatement[] => chain ? [recordStatement(ctx, chain, block)] : [];
    switch (payload.operation) {
        case "mask": {
            if (!payload.maskAssetId) {
                diagnostic(ctx, "warning", block.id, "Mask effect has no image asset.");
                return [];
            }
            const src = await resolveAsset(ctx, payload.maskAssetId, "image", block.id);
            return src ? record(target.mask(src, options)) : [];
        }
        case "clearMask":
            return record(target.clearMask(options));
        case "clip": {
            if (!payload.clipPath) {
                diagnostic(ctx, "warning", block.id, "Clip effect has no clip-path.");
                return [];
            }
            return record(target.clip(payload.clipPath, options));
        }
        case "clearClip":
            return record(target.clearClip(options));
        case "filter": {
            if (!payload.filter) {
                diagnostic(ctx, "warning", block.id, "Filter effect has no CSS filter.");
                return [];
            }
            return record(target.filter(payload.filter, options));
        }
        case "clearFilter":
            return record(target.clearFilter(options));
        case "backdrop": {
            if (!payload.backdropFilter) {
                diagnostic(ctx, "warning", block.id, "Backdrop effect has no CSS backdrop-filter.");
                return [];
            }
            return record(target.backdrop(payload.backdropFilter, options));
        }
        case "blend":
            // The full CSS type is what the engine takes; only the six curated modes ever reach here
            // (the inspector offers no others), so "normal" is the safe reset when a payload has none.
            return record(target.blend(payload.mixBlendMode ?? "normal", options));
        case "darken": {
            if (typeof target.darken !== "function") {
                diagnostic(ctx, "warning", block.id, "Darken applies to image / character targets only.");
                return [];
            }
            const darkness = Math.min(1, Math.max(0, payload.darkness ?? 0));
            return record(target.darken(darkness, payload.durationMs, payload.easing as any));
        }
        case "circleReveal":
            return record(target.circleReveal(circleEffectOptions(payload, options)));
        case "circleClose":
            return record(target.circleClose(circleEffectOptions(payload, options)));
        case "wipe":
            return record(target.wipe(wipeEffectOptions(payload, options)));
        default:
            return [];
    }
}

function compileDisplayableOperation(
    target: any,
    operation: "show" | "hide" | "transform",
    transform: StoryTransformRef | undefined,
    ctx: SceneCompileContext,
    blockId: string,
): NlrStatement | null {
    if (transform?.mode === "animation") {
        const animationTransform = createAnimationTransform(transform, ctx, blockId, operation === "transform" ? "none" : operation);
        if (operation === "show") {
            return target.show(animationTransform ?? transformOptions(undefined));
        }
        if (operation === "hide") {
            return target.hide(animationTransform ?? transformOptions(undefined));
        }
        return animationTransform ? target.transform(animationTransform) : null;
    }
    if (operation === "show") {
        if (transform?.preset && !["none", "fadeIn"].includes(transform.preset)) {
            const visible = target.show({ duration: 0, ease: transform.easing });
            return applyTransformPreset(visible, transform, ctx, blockId) ?? visible;
        }
        return target.show(transformOptions(transform));
    }
    if (operation === "hide") {
        if (transform?.preset && !["none", "fadeOut"].includes(transform.preset)) {
            const chain = applyTransformPreset(target, transform, ctx, blockId);
            return (chain ?? target).hide({ duration: 0, ease: transform.easing });
        }
        return target.hide(transformOptions(transform));
    }
    return applyTransformPreset(target, transform, ctx, blockId);
}

function applyTransformPreset(target: any, transform: StoryTransformRef | undefined, ctx: SceneCompileContext, blockId: string): NlrStatement | null {
    if (!transform || transform.mode === "animation") {
        return null;
    }
    const preset = transform.preset ?? "none";
    if (preset === "none") {
        return null;
    }
    const duration = transform.durationMs ?? 0;
    const easing = transform.easing as any;
    const props = transform.props ?? {};
    const position = getPresetPosition(preset, props);

    if (position) {
        return target.pos(position, duration, easing);
    }
    if (preset === "fadeIn") return target.show({ duration, ease: easing });
    if (preset === "fadeOut") return target.hide({ duration, ease: easing });
    if (preset === "zoom") return target.zoom(numberProp(props, "zoom", 1), duration, easing);
    if (preset === "scale") {
        const scale = numberProp(props, "scale", 1);
        return target.scaleXY(numberProp(props, "scaleX", scale), numberProp(props, "scaleY", scale), duration, easing);
    }
    if (preset === "rotate") return target.rotate(numberProp(props, "rotation", numberProp(props, "degrees", 0)), duration, easing);
    if (preset === "opacity") return target.opacity(numberProp(props, "opacity", 1), duration, easing);
    if (preset === "darken") {
        if (typeof target.darken === "function") {
            return target.darken(numberProp(props, "darkness", 0.5), duration, easing);
        }
        diagnostic(ctx, "warning", blockId, "Darken transform only works on Image targets.");
        return null;
    }
    if (preset === "circleReveal" && typeof target.circleReveal === "function") {
        return target.circleReveal({ duration, ease: easing, center: stringProp(props, "center", "50% 50%") });
    }
    if (preset === "circleClose" && typeof target.circleClose === "function") {
        return target.circleClose({ duration, ease: easing, center: stringProp(props, "center", "50% 50%") });
    }
    if (preset === "wipe" && typeof target.wipe === "function") {
        return target.wipe({ duration, ease: easing, direction: stringProp(props, "direction", "left") as any, reverse: boolProp(props, "reverse", false) });
    }
    return null;
}

function createShowTransform(transform: StoryTransformRef | undefined, ctx: SceneCompileContext, blockId: string): Transform {
    if (transform?.mode === "animation") {
        return createAnimationTransform(transform, ctx, blockId, "show")
            ?? new Transform({ opacity: 1 } as any, transformOptions(undefined) as any);
    }
    return new Transform({
        opacity: 1,
        ...getInlineTransformProps(transform, ctx, blockId),
    } as any, transformOptions(transform) as any);
}

function getInlineTransformProps(transform: StoryTransformRef | undefined, ctx: SceneCompileContext, blockId: string): Record<string, unknown> {
    return getInlineTransformPropsShared(transform, message => diagnostic(ctx, "warning", blockId, message));
}

type VisibilityTransformMode = "show" | "hide" | "none";

function createAnimationTransform(
    transform: StoryTransformRef,
    ctx: SceneCompileContext,
    blockId: string,
    visibility: VisibilityTransformMode,
): Transform | null {
    const animationId = transform.animationId?.trim();
    if (!animationId) {
        diagnostic(ctx, "warning", blockId, "Animation transform is missing animationId.");
        return null;
    }
    const asset = ctx.animations.get(animationId);
    if (!asset) {
        diagnostic(ctx, "warning", blockId, `Story animation not found: ${animationId}`);
        return null;
    }

    const sequences = asset.timeline?.tracks.length
        ? timelineToNlrTransformSequences(asset.timeline)
        : asset.sequences.length > 0
            ? asset.sequences.map(sequence => toNlrTransformSequence(sequence))
            : [{ props: {}, options: { duration: 0 } }];
    injectVisibilityDefault(sequences, visibility);
    return new Transform(sequences as any, {
        repeat: asset.config?.repeat,
        repeatDelay: asset.config?.repeatDelayMs,
    } as any);
}

function transformOptions(transform: StoryTransformRef | undefined): { duration: number; ease?: string } {
    return {
        duration: Math.max(0, transform?.durationMs ?? 0),
        ease: transform?.easing,
    };
}

function createTransition(transition: StoryTransitionRef | undefined, ctx: SceneCompileContext, blockId: string): unknown | undefined {
    if (!transition || transition.kind === "none") {
        return undefined;
    }
    const duration = Math.max(0, transition.durationMs ?? 300);
    const easing = transition.easing as any;
    const props = transition.props ?? {};

    switch (transition.kind) {
        case "dissolve":
            return new Dissolve({ duration, easing });
        case "fadeIn":
            return new FadeIn({ duration, offset: [numberProp(props, "x", 0), numberProp(props, "y", 0)], easing });
        case "slide":
            // NLR keeps `TransformDefinitions.WipeDirection` off its public surface, so the literal
            // union stands in for it - still a checked cast, unlike `as any`.
            return new Push({ duration, direction: stringProp(props, "direction", "left") as "left" | "right" | "top" | "bottom", easing });
        case "maskCircle":
            // Hard-edged iris (feather 0) is the 0.16.0 equivalent of the removed `MaskTransition.circle`.
            // The old partial from/to radii have no built-in equivalent; the `circle` word never set them.
            return new Reveal({ duration, easing, pattern: Mask.iris({ center: stringProp(props, "center", "50% 50%"), feather: 0 }) });
        case "maskWipe":
            return new Reveal({ duration, easing, pattern: Mask.wipe({ direction: stringProp(props, "direction", "left") as any, feather: 0 }) });
        case "softWipe":
            return new Reveal({ duration, easing, pattern: Mask.wipe({ direction: stringProp(props, "direction", "left") as any, feather: numberProp(props, "feather", 12) }) });
        case "blinds":
            return new Reveal({ duration, easing, pattern: Mask.blinds({ orientation: stringProp(props, "orientation", "horizontal") as any, slats: numberProp(props, "slats", 8), feather: numberProp(props, "feather", 0) }) });
        case "softIris":
            return new Reveal({ duration, easing, pattern: Mask.iris({ center: stringProp(props, "center", "50% 50%"), feather: numberProp(props, "feather", 12), shape: stringProp(props, "shape", "circle") as any }) });
        case "barnDoor":
            return new Reveal({ duration, easing, pattern: Mask.barnDoor({ axis: stringProp(props, "axis", "horizontal") as any, feather: numberProp(props, "feather", 12) }) });
        case "clock":
            return new Reveal({ duration, easing, pattern: Mask.clock({ center: stringProp(props, "center", "50% 50%"), from: numberProp(props, "from", 0), feather: numberProp(props, "feather", 24), direction: stringProp(props, "direction", "clockwise") as any }) });
        case "fan":
            return new Reveal({ duration, easing, pattern: Mask.fan({ blades: numberProp(props, "blades", 4), center: stringProp(props, "center", "50% 50%"), from: numberProp(props, "from", 0), feather: numberProp(props, "feather", 10) }) });
        case "dots":
            return new Reveal({ duration, easing, pattern: Mask.dots({ rows: numberProp(props, "rows", 6), cols: numberProp(props, "cols", 10), feather: numberProp(props, "feather", 20), stagger: numberProp(props, "stagger", 0) }) });
        case "blurDissolve":
            return new BlurDissolve({ duration, blur: numberProp(props, "blur", 16), easing });
        case "throughColor":
            return new ThroughColor({
                duration,
                easing,
                color: stringProp(props, "color", "#000"),
                hold: numberProp(props, "hold", 30) / 100,
                ...throughColorPattern(props),
            });
        case "darkness":
            // The incoming image is swapped in at `from` darkness and lifted to `to` - so the default
            // pair (1 → 0) reads as "the new frame emerges out of black". Clamped here because
            // `Darkness` does not clamp the way `Image.darken` does: darkness `d` renders as
            // `brightness(1 - d)`, so an out-of-range value emits invalid CSS that the browser drops
            // whole - the transition would silently become a no-op rather than saturate.
            return new Darkness({
                duration,
                easing,
                from: Math.min(1, Math.max(0, numberProp(props, "from", 1))),
                to: Math.min(1, Math.max(0, numberProp(props, "to", 0))),
            });
        default:
            diagnostic(ctx, "warning", blockId, `Transition "${transition.kind}" is not supported by public NLR imports.`);
            return undefined;
    }
}

/** Map a stored `throughColor` pattern prop to the native `ThroughColor` `pattern`/`inverted` pair. */
function throughColorPattern(props: Record<string, StoryLiteralValue>): { pattern?: MaskPattern; inverted?: boolean } {
    switch (stringProp(props, "pattern", "plain")) {
        case "linear":
            return { pattern: Mask.wipe({ direction: stringProp(props, "direction", "left") as any, feather: numberProp(props, "feather", 12) }) };
        case "blinds":
            return { pattern: Mask.blinds({ orientation: stringProp(props, "orientation", "horizontal") as any, slats: numberProp(props, "slats", 8), feather: numberProp(props, "feather", 0) }) };
        case "iris":
            // The old iris pattern covered rim-in - the pattern's inverted orientation.
            return { pattern: Mask.iris({ center: stringProp(props, "center", "50% 50%"), feather: numberProp(props, "feather", 12) }), inverted: true };
        default:
            // "plain" → no pattern: the colour simply fades in and out (flash with hold 0).
            return {};
    }
}

/**
 * Where a variable actually lives at runtime, resolved once at compile time.
 *
 * The two backings differ in more than their address. A `storable` slot is reached through the
 * `ScriptCtx` NLR hands every script and condition, so reads and writes are ordinary synchronous
 * calls inside the running game. A `host` slot is the app-level persistence bridge shared with UI
 * blueprints: reads come synchronously off its snapshot, writes are fire-and-forget async - which is
 * what lets a persistent variable be read inside an expression without making the row latent.
 */
type StoryVariableSlot =
    | { kind: "storable"; namespace: string; key: string }
    | { kind: "host"; key: string };

/**
 * Resolve a variable reference to its runtime slot, or emit a diagnostic and return null.
 *
 * The namespace is read off the live `Persistent` via `DevTools.getNamespaceName` rather than
 * reconstructed from NLR's prefix convention - the prefix is an implementation detail of the engine
 * and would silently desynchronize on an engine bump, whereas an accessor that disappears breaks the
 * build.
 */
function resolveVariableSlot(ctx: SceneCompileContext, ref: StoryVariableRef, blockId: string): StoryVariableSlot | null {
    if (ref.scope === "scene") {
        const def = ctx.sceneVariables[ref.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Scene variable not found; the assignment was skipped.");
            return null;
        }
        return { kind: "storable", namespace: DevTools.getNamespaceName(ctx.nlrScene.local), key: def.storageKey };
    }
    if (ref.scope === "saved") {
        const def = ctx.savedVariables[ref.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Saved variable not found; the assignment was skipped.");
            return null;
        }
        return { kind: "storable", namespace: DevTools.getNamespaceName(ctx.savedPersistent), key: def.storageKey };
    }
    // Existence is checked before host availability: an undeclared persistent variable is a fault the
    // author must fix regardless of whether Dev Mode host persistence is up (bible §3.3, same diagnostic
    // as a missing scene/saved variable).
    if (!ctx.persistentKeys.has(ref.variableId)) {
        diagnostic(ctx, "warning", blockId, "Persistent variable not found; the assignment was skipped.");
        return null;
    }
    if (!ctx.persistence) {
        diagnostic(ctx, "warning", blockId, "Persistent variables require Dev Mode host persistence and were skipped.");
        return null;
    }
    return { kind: "host", key: ref.variableId };
}

/**
 * Build the reader an expression evaluates against, with every referenced variable's slot resolved up
 * front. Returns null when any of them fails to resolve: an expression that silently treated a
 * deleted variable as `0` would produce a plausible wrong number, which is worse than not running.
 */
function buildExpressionReader(
    ctx: SceneCompileContext,
    expr: StoryExpr,
    blockId: string,
): ((scriptCtx: ScriptCtx) => StoryExpressionReader) | null {
    const slots = new Map<string, StoryVariableSlot>();
    for (const ref of collectStoryExpressionVariables(expr)) {
        const slot = resolveVariableSlot(ctx, ref, blockId);
        if (!slot) {
            return null;
        }
        slots.set(storyVariableRefKey(ref), slot);
    }
    const persistence = ctx.persistence;
    const persistentDefaults = ctx.persistentDefaults;

    return (scriptCtx: ScriptCtx) => ref => {
        const slot = slots.get(storyVariableRefKey(ref));
        if (!slot) {
            return undefined;
        }
        if (slot.kind === "host") {
            const stored = persistence?.get(slot.key) as StoryLiteralValue | undefined;
            // Declared persistent rows read as their default until the host first stores a value.
            return stored === undefined ? persistentDefaults[slot.key] : stored;
        }
        return scriptCtx.storable.getNamespace(slot.namespace).get(slot.key) as StoryLiteralValue | undefined;
    };
}

function setVariable(
    ctx: SceneCompileContext,
    target: StoryVariableRef,
    value: StoryLiteralValue,
    blockId: string,
    expression?: StoryExpression,
): NlrStatement | null {
    if (expression) {
        return setVariableFromExpression(ctx, target, expression, blockId);
    }
    if (target.scope === "scene") {
        const def = ctx.sceneVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Scene variable not found; the assignment was skipped.");
            return null;
        }
        return ctx.nlrScene.local.set(def.storageKey, value as any);
    }
    if (target.scope === "saved") {
        const def = ctx.savedVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Saved variable not found; the assignment was skipped.");
            return null;
        }
        return ctx.savedPersistent.set(def.storageKey, value as any);
    }
    // Persistent (app-level, host-managed, shared with UI blueprints). Existence is checked first, so
    // an undeclared persistent target faults regardless of host availability (bible §3.3).
    if (!ctx.persistentKeys.has(target.variableId)) {
        diagnostic(ctx, "warning", blockId, "Persistent variable not found; the assignment was skipped.");
        return null;
    }
    const persistence = ctx.persistence;
    if (!persistence) {
        diagnostic(ctx, "warning", blockId, "Persistent variables require Dev Mode host persistence and were skipped.");
        return null;
    }
    const storageKey = target.variableId;
    return Script.execute(() => {
        void persistence.set(storageKey, value);
    });
}

/**
 * `/set gold gold + 1` - one `Script` that reads its operands and writes the result.
 *
 * A single script for all three scopes, rather than routing through each backing's own chainable
 * `set`, because an expression's reads and its write need not share a scope: `/set gold saved.bonus +
 * 1` reads one namespace and writes another. Doing it in one script also makes the whole assignment
 * atomic with respect to the action queue, so a read can never observe a half-applied earlier row.
 */
function setVariableFromExpression(
    ctx: SceneCompileContext,
    target: StoryVariableRef,
    expression: StoryExpression,
    blockId: string,
): NlrStatement | null {
    if (!isStoryExpressionEvaluable(expression.ast)) {
        diagnostic(ctx, "warning", blockId, `Expression \`${expression.source}\` did not resolve; the assignment was skipped.`);
        return null;
    }
    const readerFor = buildExpressionReader(ctx, expression.ast, blockId);
    const slot = resolveVariableSlot(ctx, target, blockId);
    if (!readerFor || !slot) {
        return null;
    }
    const persistence = ctx.persistence;

    return Script.execute(scriptCtx => {
        const result = evaluateStoryExpression(expression.ast, readerFor(scriptCtx));
        if (slot.kind === "host") {
            void persistence?.set(slot.key, result);
            return;
        }
        scriptCtx.storable.getNamespace(slot.namespace).set(slot.key, result as any);
    });
}

function conditionToLambda(ctx: SceneCompileContext, condition: StoryConditionRef | undefined, blockId: string): NlrCondition | undefined {
    if (!condition) {
        return undefined;
    }
    if (condition.kind === "expression") {
        const { expression } = condition;
        if (!isStoryExpressionEvaluable(expression.ast)) {
            diagnostic(ctx, "warning", blockId, `Condition \`${expression.source}\` did not resolve; it evaluates false.`);
            return falseCondition;
        }
        const readerFor = buildExpressionReader(ctx, expression.ast, blockId);
        if (!readerFor) {
            return falseCondition;
        }
        // Re-read on every test, like the blueprint condition beside it: a branch inside a loop must
        // see the value as it stands now, not as it stood when the scene compiled.
        return (scriptCtx: ScriptCtx) => isTruthy(evaluateStoryExpression(expression.ast, readerFor(scriptCtx)));
    }
    if (condition.kind === "blueprint") {
        if (!ctx.blueprintDocument) {
            diagnostic(ctx, "warning", blockId, "Blueprint condition needs the project blueprint document; condition evaluates false.");
            return falseCondition;
        }
        // The condition blueprint's "On Call" graph is synchronous (async nodes disallowed while
        // authoring), so its boolean Return Value can be evaluated inline every time the branch is
        // tested. NLR hands the condition lambda a ScriptCtx (LambdaHandler), the same ctx the inline
        // interpolation words receive.
        const input = buildStoryActionScriptInput(ctx, condition.blueprintId, message => diagnostic(ctx, "warning", blockId, message));
        return (scriptCtx: ScriptCtx) => {
            try {
                return Boolean(evaluateStoryActionBlueprintValueSync(input, scriptCtx));
            } catch {
                return false;
            }
        };
    }
    const target = condition.target;
    if (target.scope === "persistent") {
        if (!ctx.persistentKeys.has(target.variableId)) {
            diagnostic(ctx, "warning", blockId, "Persistent variable not found; condition evaluates false.");
            return falseCondition;
        }
        return persistentCondition(ctx, target.variableId, condition.operator, condition.value);
    }
    let persistent: Persistent<any>;
    let storageKey: string;
    if (target.scope === "scene") {
        const def = ctx.sceneVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Scene variable not found; condition evaluates false.");
            return falseCondition;
        }
        persistent = ctx.nlrScene.local as Persistent<any>;
        storageKey = def.storageKey;
    } else {
        const def = ctx.savedVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Saved variable not found; condition evaluates false.");
            return falseCondition;
        }
        persistent = ctx.savedPersistent as Persistent<any>;
        storageKey = def.storageKey;
    }
    switch (condition.operator) {
        case "isTrue":
            return persistent.isTrue(storageKey);
        case "isFalse":
            return persistent.isFalse(storageKey);
        case "equals":
            return persistent.equals(storageKey, condition.value as any);
        case "notEquals":
            return persistent.notEquals(storageKey, condition.value as any);
        case "exists":
            return persistent.isNotNull(storageKey);
        default:
            return falseCondition;
    }
}

/** App-level persistent condition: a runtime closure reading the shared host snapshot. */
function persistentCondition(
    ctx: SceneCompileContext,
    storageKey: string,
    operator: Extract<StoryConditionRef, { kind: "variable" }>["operator"],
    value: StoryLiteralValue | undefined,
): NlrCondition {
    const persistence = ctx.persistence;
    if (!persistence) {
        return falseCondition;
    }
    const persistentDefaults = ctx.persistentDefaults;
    // Structural equality (`strictEquals`), the same rule `/if` expressions use — so a json/array
    // persistent variable compares by shape, not by reference identity, matching scene/saved conditions
    // which go through NLR's `persistent.equals()` (bible §3.3). The undefined guard keeps the old
    // "both absent" behaviour: a not-yet-stored, default-less variable equals only an undefined target.
    const equals = (a: StoryLiteralValue | undefined, b: StoryLiteralValue | undefined): boolean =>
        a === undefined || b === undefined ? a === b : strictEquals(a, b);
    return () => {
        const stored = persistence.get(storageKey);
        // Declared persistent rows test against their default until the host first stores a value.
        const current = (stored === undefined ? persistentDefaults[storageKey] : stored) as StoryLiteralValue | undefined;
        switch (operator) {
            case "isTrue":
                return current === true;
            case "isFalse":
                return current === false;
            case "equals":
                return equals(current, value);
            case "notEquals":
                return !equals(current, value);
            case "exists":
                return current !== null && current !== undefined;
            default:
                return false;
        }
    };
}

function falseCondition(): boolean {
    return false;
}

/**
 * The single image a `preset` character's pose selection resolves to.
 *
 * Null when the pose names nothing — deliberately, and unlike the model this replaced, which fell
 * back to any image the character happened to own and so made a missing differential look like a
 * working one. Callers turn null into a diagnostic.
 *
 * A layered character has no single image; see {@link resolveCharacterLayeredSrc}.
 */
async function resolveCharacterImageUrl(
    ctx: SceneCompileContext,
    characterId: string | undefined,
    pose: string | undefined,
    blockId: string,
): Promise<string | null> {
    if (!characterId) {
        return null;
    }
    const appearance = ctx.characterSummaries.get(characterId)?.appearance;
    const assetId = resolvePoseAssetId(appearance, pose);
    return assetId ? resolveAsset(ctx, assetId, "image", blockId) : null;
}

/**
 * A layered character's stack as the engine's `src`, or null when the character is not layered (or
 * has no layer that draws anything).
 *
 * Every layer bound to an axis becomes a variants map keyed by tag id. The engine identifies a tag
 * group by its tag *set*, so all the layers on one axis collapse onto that axis's single group —
 * which is exactly what makes one `char(["angry"])` move the brows and the mouth together, and why
 * the appearance model keeps each bound layer's option map complete.
 */
async function resolveCharacterLayeredSrc(
    ctx: SceneCompileContext,
    characterId: string | undefined,
    blockId: string,
): Promise<{ layers: (string | null | Record<string, string | null>)[]; defaults: string[] } | null> {
    const appearance = characterId ? ctx.characterSummaries.get(characterId)?.appearance : undefined;
    if (appearance?.kind !== "layered") {
        return null;
    }

    const layers: (string | null | Record<string, string | null>)[] = [];
    for (const layer of appearance.layers) {
        if (layer.hidden) continue;
        if (!layer.axisId) {
            const url = layer.assetId ? await resolveAsset(ctx, layer.assetId, "image", blockId) : null;
            if (url) {
                layers.push(url);
            }
            continue;
        }
        const axis = appearance.axes.find(candidate => candidate.id === layer.axisId);
        if (!axis || axis.tags.length === 0) continue;
        const variants: Record<string, string | null> = {};
        for (const tag of axis.tags) {
            const assetId = layer.options?.[tag.id] ?? null;
            variants[tag.id] = assetId ? await resolveAsset(ctx, assetId, "image", blockId) : null;
        }
        layers.push(variants);
    }
    if (layers.length === 0) {
        return null;
    }

    // A default naming a group no layer emitted is a tag the engine has never heard of, and it
    // rejects the whole image for it.
    const emitted = new Set(
        layers.flatMap(layer => (typeof layer === "object" && layer !== null ? Object.keys(layer) : [])),
    );
    const defaults = Object.values(resolveTagSelection(appearance, undefined)).filter(tagId => emitted.has(tagId));
    return { layers, defaults };
}

/**
 * Everything the dialog-avatar resolver can possibly answer with, resolved to URLs up front.
 *
 * The resolver runs inside the dialog's own render and cannot await anything, so nothing may be
 * resolved lazily. Resolving it all here is also what makes the avatars preloadable — see
 * {@link bindCharacterPortrait}.
 */
type CompiledCharacterAvatars = {
    /** Avatar key → avatar image URL. */
    byKey: Map<string, string>;
    /** Pose sprite URL → pose id: how a preset character's current differential is read back. */
    poseByUrl: Map<string, string>;
    /** Shown when no differential resolves an avatar (off-stage, or nothing baked for this look). */
    fallback: string | null;
};

async function compileCharacterAvatars(
    ctx: SceneCompileContext,
    summary: DevModeCharacterSummary,
): Promise<CompiledCharacterAvatars> {
    // Not a block id: avatar assets belong to the character, not to any one row. Diagnostics about
    // them should point at the character, and `resolveSnapshotImageSource` already sets the
    // precedent of passing a non-block label here.
    const blockId = `avatar:${summary.id}`;
    const byKey = new Map<string, string>();
    const poseByUrl = new Map<string, string>();

    // Only keys with an entry are worth resolving: a key with neither a bake nor an override
    // resolves to the character default, which `fallback` already holds.
    // A puppet carries no avatar table: it has no differentials to key one on (see
    // `bindPuppetAvatar`, which sets the character-level default instead).
    const avatarTable = summary.appearance.kind === "puppet" ? undefined : summary.appearance.avatars;
    for (const key of Object.keys(avatarTable ?? {})) {
        const assetId = resolveCharacterAvatarAssetId(summary, key);
        const url = assetId ? await resolveAsset(ctx, assetId, "image", blockId) : null;
        if (url && assetId) {
            byKey.set(key, url);
            ctx.avatarAssetIdByUrl.set(url, assetId);
        }
    }

    if (summary.appearance.kind === "preset") {
        for (const pose of summary.appearance.poses) {
            const url = pose.assetId ? await resolveAsset(ctx, pose.assetId, "image", blockId) : null;
            // Two poses sharing one sprite are indistinguishable at runtime - the engine reports a
            // src, not a pose. First wins; their avatars would have to picture the same thing anyway.
            if (url && !poseByUrl.has(url)) {
                poseByUrl.set(url, pose.id);
            }
        }
    }

    const defaultAvatarAssetId = summary.defaultAvatarAssetId?.trim();
    const fallback = defaultAvatarAssetId
        ? await resolveAsset(ctx, defaultAvatarAssetId, "image", blockId)
        : null;
    if (fallback && defaultAvatarAssetId) {
        ctx.avatarAssetIdByUrl.set(fallback, defaultAvatarAssetId);
    }
    return { byKey, poseByUrl, fallback };
}

/**
 * Turn the engine's report of what the character is currently wearing into an avatar URL.
 *
 * The two kinds report differently, because they *are* different: a preset character has one src
 * and the engine hands back that URL; a layered one has no single src (`Image.getSrcURL` returns
 * null for it) and the engine hands back the active tags instead.
 */
function resolveCompiledAvatar(
    summary: DevModeCharacterSummary,
    avatars: CompiledCharacterAvatars,
    context: Pick<DialogAvatarResolverContext, "currentSrc" | "tags">,
): string | null {
    const key = summary.appearance.kind === "layered"
        ? characterAvatarKeyFromTags(summary.appearance, context.tags)
        : context.currentSrc
            ? avatars.poseByUrl.get(context.currentSrc) ?? null
            : null;
    return (key ? avatars.byKey.get(key) : undefined) ?? avatars.fallback;
}

/**
 * Register a character's stage sprite as an NLR portrait and install its dialog-avatar resolver.
 *
 * This is the whole of "which differential is the speaker wearing right now". The engine finds the
 * character's topmost *visible* portrait and hands the resolver that image's live state, so the
 * answer survives undo, load and skip — which a Studio-side mirror of the story's rows would not,
 * for exactly the reasons the Is Speaking plan documented about `onCharacterPrompt`.
 *
 * A character with no summary (an unnamed temp speaker) is skipped: it has no appearance to key an
 * avatar on, and `getCharacter` hands those a name-keyed instance that outlives no differential.
 */
async function bindCharacterPortrait(
    ctx: SceneCompileContext,
    characterId: string | undefined,
    image: Image,
): Promise<void> {
    const summary = characterId ? ctx.characterSummaries.get(characterId) : undefined;
    if (!summary) {
        return;
    }
    const bound = ctx.boundPortraits ?? (ctx.boundPortraits = new WeakSet());
    if (bound.has(image)) {
        return;
    }
    bound.add(image);

    const cache = ctx.characterAvatars ?? (ctx.characterAvatars = new Map());
    let avatars = cache.get(summary.id);
    if (!avatars) {
        avatars = await compileCharacterAvatars(ctx, summary);
        cache.set(summary.id, avatars);
    }
    const resolved = avatars;

    const character = getCharacter(ctx, summary.id);
    character.addPortrait(image);
    character.setAvatar(context => resolveCompiledAvatar(summary, resolved, context));
    // Claim the character so the off-stage fallback pass leaves this resolver alone. It must: the
    // resolver reads the engine's *live* Image (`currentSrc` / `tags`), which is what keeps the
    // avatar right through undo, load and skip, and a flat url would freeze it at compile time.
    ctx.avatarBoundCharacterIds.add(summary.id);

    // Deliberately NOT registered with `ctx.nlrScene.preloadImage`. That warms `ImageCacheManager`,
    // which stores a base64 re-encoding and decodes *that*, reachable only through
    // `cacheManager.get(url)` — which the engine's `<Image>` uses but its `<Avatar>` does not, and
    // a Studio Image widget certainly does not. Registering avatars there would buy a fetch, a
    // base64 blowup, a decode and a retained full-resolution bitmap that every consumer then
    // ignores. The warm that actually helps is keyed to the URL the widget renders and lives in
    // `characterAvatarAssets.warmAvatarDecode`, run when the session mounts this compile's table.
}

/**
 * Give every character that spoke but never stood on stage the dialog avatar its profile declares.
 *
 * `defaultAvatarAssetId` is documented as "shown when no differential resolves one — the character is
 * speaking from off-stage". That promise was only ever kept for characters who *had* been on stage:
 * the resolver holding the fallback is installed by {@link bindCharacterPortrait}, which only stage
 * rows call, so a preset or layered character who talks from off-stage for a whole scene got no
 * resolver and therefore no avatar at all — while a puppet, which never stages, got one
 * unconditionally ({@link bindPuppetAvatar}). Two paths, opposite answers to the same question.
 *
 * This closes it from the other end, and only from the other end: it runs after everything is
 * compiled and skips every character already claimed, so a staged character keeps the resolver that
 * reads the live `Image`. Studio never mirrors story state — it only fills in the case where there is
 * no story state to read.
 */
async function bindOffstageDefaultAvatars(params: {
    characters: Map<string, Character>;
    characterSummaries: Map<string, DevModeCharacterSummary>;
    avatarBoundCharacterIds: Set<string>;
    avatarAssetIdByUrl: Map<string, string>;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
}): Promise<void> {
    for (const [key, character] of params.characters) {
        // Temp speakers are keyed `name:<name>` and have no profile behind them; `UNKNOWN_CHARACTER_ID`
        // resolves to no summary either. Both fall out here.
        const summary = params.characterSummaries.get(key);
        const assetId = summary?.defaultAvatarAssetId?.trim();
        if (!summary || !assetId || params.avatarBoundCharacterIds.has(summary.id)) {
            continue;
        }
        params.avatarBoundCharacterIds.add(summary.id);
        const url = await resolveAssetUrlCached({
            assetId,
            assetType: "image",
            blockId: `avatar:${summary.id}`,
            resolveAssetUrl: params.resolveAssetUrl,
            assetUrlCache: params.assetUrlCache,
            diagnostics: params.diagnostics,
        });
        if (url) {
            params.avatarAssetIdByUrl.set(url, assetId);
            character.setAvatar(url);
        }
    }
}

async function resolveAsset(ctx: SceneCompileContext, assetId: string, assetType: StoryAssetKind, blockId: string): Promise<string | null> {
    return resolveAssetUrlCached({
        assetId,
        assetType,
        blockId,
        resolveAssetUrl: ctx.resolveAssetUrl,
        assetUrlCache: ctx.assetUrlCache,
        diagnostics: ctx.diagnostics,
    });
}

async function resolveAssetUrlCached(input: {
    assetId: string;
    assetType: StoryAssetKind;
    blockId: string;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
}): Promise<string | null> {
    const { assetId, assetType, blockId, resolveAssetUrl, assetUrlCache, diagnostics } = input;
    const cacheKey = `${assetType}:${assetId}`;
    if (assetUrlCache.has(cacheKey)) {
        return assetUrlCache.get(cacheKey) ?? null;
    }
    try {
        const resolved = await resolveAssetUrl(assetId, assetType);
        const url = typeof resolved === "string" && resolved.trim() ? resolved : null;
        assetUrlCache.set(cacheKey, url);
        if (!url) {
            pushDiagnostic(diagnostics, "warning", blockId, `Asset could not be resolved: ${assetId}`);
        }
        return url;
    } catch (error) {
        pushDiagnostic(
            diagnostics,
            "warning",
            blockId,
            `Asset resolver failed for ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        assetUrlCache.set(cacheKey, null);
        return null;
    }
}

function recordStatement(ctx: SceneCompileContext, statement: NlrStatement, block: StoryBlock, textId?: string): NlrStatement {
    for (const action of statementToActions(statement)) {
        const staticId = stableActionId(ctx.document.id, ctx.scene.id, block.id, textId, ctx.nextActionIndex());
        setStableActionId(action, staticId);
        ctx.actionIdBindings.push({
            action,
            staticId,
            blockId: block.id,
            textId,
        });
    }
    return statement;
}

function statementToActions(statement: NlrStatement): NlrAction[] {
    if (!statement) {
        return [];
    }
    if (Array.isArray(statement)) {
        return statement.flatMap(item => statementToActions(item));
    }
    if (isChainLike(statement)) {
        return DevTools.chainToActions(statement as any)
            .flat(Number.POSITIVE_INFINITY)
            .flatMap(item => statementToActions(item));
    }
    if (isActionLike(statement)) {
        return [statement as NlrAction];
    }
    return [];
}

function isChainLike(value: unknown): value is NlrChainLike {
    return Boolean(value && (typeof value === "object" || typeof value === "function") && typeof (value as NlrChainLike).getActions === "function");
}

function isActionLike(value: unknown): value is NlrAction {
    return Boolean(value &&
        typeof value === "object" &&
        "contentNode" in value &&
        "type" in value &&
        typeof (value as { setStaticId?: unknown }).setStaticId === "function");
}

function stableActionId(storyId: string, sceneId: string, blockId: string, textId: string | undefined, index: number): string {
    return `studio:${storyId}:${sceneId}:${blockId}:${textId ?? "action"}:${index}`;
}

function setStableActionId(action: NlrAction, staticId: string): void {
    const tools = DevTools as DevToolsWithStaticId;
    if (tools.setStaticId) {
        tools.setStaticId(action, staticId);
        return;
    }
    DevTools.setActionId(action, staticId);
}

function diagnostic(ctx: SceneCompileContext, level: NlrStoryCompileDiagnostic["level"], blockId: string | undefined, message: string): void {
    pushDiagnostic(ctx.diagnostics, level, blockId, message);
}

function pushDiagnostic(
    diagnostics: NlrStoryCompileDiagnostic[],
    level: NlrStoryCompileDiagnostic["level"],
    blockId: string | undefined,
    message: string,
): void {
    diagnostics.push({ level, blockId, message });
}



function normalizePersistentNamespace(namespace: string | undefined): string {
    return namespace?.trim() || "story";
}




