import {
    BlurDissolve,
    Character,
    Condition,
    Control,
    Darkness,
    Exposure,
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
    RuleReveal,
    Scene,
    Script,
    Sentence,
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
import { resolveBrandColorValue } from "@shared/brand/brandRegistry";
import { weatherRefIdentity } from "@shared/weather/bakeKey";
import type { WeatherSeedRef } from "@shared/weather/model";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type { DialogAvatarResolverContext } from "narraleaf-react";
import { resolvePoseEntry, resolveTagSelection } from "@shared/utils/characterVariant";
import { parseStoryEasing } from "@shared/utils/storyEasing";
import { storyMarksToWordConfig } from "@shared/utils/storyTextMarks";
import {
    characterAvatarKeyFromTags,
    resolveCharacterAvatarAssetId,
} from "@shared/utils/characterAvatar";
import type {
    StoryActionableKind,
    StoryActionableTargetRef,
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
    StoryEndingPage,
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
    StoryTransformProps,
    StoryTransformRef,
    StoryVariableRef,
} from "@shared/types/story";
import {
    BGM_STAGE_OBJECT_NAME,
    actionableStageRefName,
    collectStoryExpressionInvocations,
    collectStoryExpressionVariables,
    declaresStageObject,
    displayableStageRefName,
    duplicateSceneLabels,
    isStoryExpressionEvaluable,
    storyVisitedRefId,
    layerActionTargetRef,
    listScenesInDocumentOrder,
    sceneLabelNames,
    resolveDisplayableTargetRef,
    resolveStoryLayerRef,
    sceneVariableDefs,
    soundStageObjectName,
    storyPersistentDefs,
    storyTransitionKindOf,
    storyVariableRefKey,
} from "@shared/types/story";
import type { StoryExpressionEnv } from "@shared/utils/storyExpressionEval";
import { compareStoryCondition, evaluateStoryExpression, isTruthy, strictEquals, toDisplayString } from "@shared/utils/storyExpressionEval";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { PersistentVariableRuntimeTable, SavedVariableRuntimeTable } from "@shared/types/variables/registry";
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
import { parseTranslatedRuns } from "@shared/utils/localizationText";
import { resolveStoryAssetVariant, type StoryAssetVariants } from "@shared/types/story";
import {
    composeStoryFilter,
    isEmptyStoryTransformProps,
    splitStoryTransformChange,
    foldStoryTransformLook,
    storyTransformPropsConflicts,
    storyTransformPropsToNlr,
} from "@shared/story/transformProps";
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
// The look library sits beside the command spec and the inspector that pick from it; the compile is
// its third reader rather than its owner, which is the same relation `storyReplace` already has with
// the scene editor's find/replace model.
import { resolveStoryCameraLook, resolveStoryCameraLookOscillation, storyCameraLookTweens } from "@/lib/ui-editor/runtime/game/cameraLookPresets";
import { neutralStoryCameraLensProps, resolveStoryCameraLensSteps } from "@/lib/ui-editor/runtime/game/cameraLensPresets";
import type { StageSnapshotDisplayable, StageSnapshotEffects, StoryStageSnapshot } from "./storyStageSnapshot";
import { collectSavedVariableView, savedVariableDefsFromView } from "./storyStageSnapshot";
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
    type StoryDevtoolsBridge,
} from "./storyActionBlueprint";
import {
    getStoryCompilePasses,
    type CompileBlockView,
    type EngineAction,
    type RuntimeFlag,
    type SceneCompileContext as PluginSceneCompileContext,
    type StageImage,
} from "./storyCompilePass";
import {
    createStoryVisitedPersistent,
    isStoryVisited,
    markStoryVisitedStatement,
    STORY_VISITED_OPTIONS_KEY,
    STORY_VISITED_SCENES_KEY,
    type StoryVisitedContent,
} from "./storyVisited";

/**
 * App-level persistent variable bridge (shared with UI blueprints). `get` reads a cached snapshot
 * synchronously (for conditions); `set` may be async. Absent outside Dev Mode host persistence.
 */
export type StoryPersistenceBridge = {
    get: (storageKey: string) => unknown;
    set: (storageKey: string, value: unknown) => void | Promise<void>;
};

/**
 * What an `/ending` row hands the host when it runs.
 *
 * Carries the row's own values and nothing derived: the id is the identity everything records
 * against, the name is what a screen shows, and the page is the row's override of the build's own
 * ending page. Resolving the page against the build is the host's job, because the build is what the
 * host knows and the compiler deliberately does not.
 */
export type StoryEndingReach = {
    /** The `ending` row's block id. */
    endingId: string;
    /** Trimmed display name. Empty when the author has not named the ending. */
    name: string;
    page?: StoryEndingPage;
};

/** Single NLR Storable namespace holding all Story "saved" variables. */
const SAVED_PERSISTENT_NAMESPACE = "__nlr_story_saved__";

/**
 * Declared persistent defaults, keyed by storage key. The host bridge only carries values that were
 * ever written, so a read with no stored entry falls back here.
 *
 * Taken off the MERGED view rather than the document's own `/persis` rows, exactly as the saved
 * defaults are: a persistent variable declared in the project registry - which since the declaration
 * migration is nearly all of them - otherwise reached the runtime with no default at all, so a flag
 * the author gave a starting value read as "not set" until something wrote it.
 */
function collectPersistentDefaults(view: MergedPersistentView): Record<string, StoryLiteralValue> {
    const defaults: Record<string, StoryLiteralValue> = {};
    for (const entry of view.entries) {
        if (entry.defaultValue !== undefined) {
            defaults[entry.storageKey] = entry.defaultValue;
        }
    }
    return defaults;
}

/**
 * Every declared persistent variable's storage key - the set a persistent reference is validated
 * against. Persistent variables come from two authoring surfaces until the project-level
 * registry lands: story `//persis` declaration rows and the blueprint document's own persistent
 * variables. Both key host persistence by `storageKey`, so the reference (also keyed by storageKey)
 * checks membership here; a miss is an undeclared variable and gets the same diagnostic as a missing
 * scene/saved one.
 */
/**
 * The merged persistent view for a compile: the registry (blueprint-declared, baked into the bundle)
 * unioned with the story `/persis` declaration rows. Reference validation reads its storage
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
 * The saved twin of {@link pushPersistentNameCollisionDiagnostics}. `saved` became a registry scope
 * alongside `persistent`, so it inherited the same two-surface ambiguity: one display name can now be
 * declared once in the variables panel and once as a `/save` row, and an author reading either row
 * has no way to tell which one a reference points at.
 */
function pushSavedNameCollisionDiagnostics(diagnostics: NlrStoryCompileDiagnostic[], view: MergedPersistentView): void {
    for (const collision of view.nameCollisions) {
        pushDiagnostic(
            diagnostics,
            "warning",
            undefined,
            `Saved variable "${collision.name}" is declared in both the variable registry and a story row; references are ambiguous.`,
        );
    }
}

/**
 * The saved namespace's seed record: every declared saved variable's default, keyed by storage key.
 *
 * `?? null` rather than "skip when absent", unlike the persistent defaults: the NLR Storable namespace
 * is created once from this record, so a key missing here is a key the namespace never holds, and a
 * later read of a default-less variable would come back `undefined` instead of empty.
 */
function collectSavedDefaults(savedVariables: Record<string, StorySavedVariableDefinition>): Record<string, StoryLiteralValue> {
    const defaults: Record<string, StoryLiteralValue> = {};
    for (const saved of Object.values(savedVariables)) {
        defaults[saved.storageKey] = saved.defaultValue ?? null;
    }
    return defaults;
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
    /**
     * The asset a materialised set reference resolves to for the current locale.
     *
     * Lives beside {@link resolve} because it answers the same question about the same moment: a
     * line's words and the picture behind it are in one language, and two places reading the locale
     * separately is how they come to disagree.
     */
    variant: (variants: StoryAssetVariants | undefined, assetId: string) => string | null;
};

function createSceneLocalizationResolver(input: StoryLocalizationRuntime): SceneLocalizationResolver {
    const chains = new Map<string, string[]>();
    for (const locale of input.locales) {
        chains.set(locale.code, resolveLocaleChain(input, locale.code));
    }
    // Hosts hand this in through a cast (`as Parameters<typeof compileStudioStoryToNlr>[0]`), so a
    // bundle payload with no `getLocale` on it reaches here typed as if it had one. Reading the
    // source locale in that case keeps a compile walking instead of throwing halfway down a story.
    const activeLocale = () => (typeof input.getLocale === "function" ? input.getLocale() : input.sourceLocale);
    return {
        hasTranslation: textId => Object.values(input.tables).some(table => Boolean(table[textId])),
        variant: (variants, assetId) =>
            resolveStoryAssetVariant(variants, assetId, activeLocale(), input.sourceLocale),
        resolve: textId => {
            const locale = activeLocale();
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
 * Resolve EVERY voice language's clips (unit id → asset id) into unit id → URL maps.
 *
 * All languages, not just the active one, and that is what makes switching dub language a runtime
 * act rather than a recompile. URL resolution is an id-to-`nlr://` rewrite, not a load, so carrying
 * the other languages costs a map; the bytes are still only fetched for whatever actually plays.
 *
 * The map (object) form is used deliberately over the function-generator form: the engine's
 * generator path throws on an unresolved id, whereas a plain map returns null for a line with no
 * take - exactly what partial voicing needs.
 */
async function buildVoiceMapsByLocale(input: {
    voice: StoryVoiceRuntime;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
}): Promise<Record<string, Record<string, string>>> {
    const byLocale: Record<string, Record<string, string>> = {};
    for (const [locale, table] of Object.entries(input.voice.tables)) {
        const map: Record<string, string> = {};
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
        byLocale[locale] = map;
    }
    return byLocale;
}

/**
 * Every unit id voiced in ANY language.
 *
 * This is what decides whether a line carries a `voiceId`, and it has to be the union rather than
 * the active language's set: a line recorded in Japanese but not in English must still carry its id
 * in an English-first build, or switching to Japanese mid-game would find nothing to play. A line
 * whose id resolves to nothing in the active language is exactly the case the map form handles -
 * `getVoice` returns null and the engine falls back to the inline `config.voice`.
 */
function collectVoicedUnitIds(byLocale: Record<string, Record<string, string>>): Set<string> {
    const ids = new Set<string>();
    for (const map of Object.values(byLocale)) {
        for (const unitId of Object.keys(map)) {
            ids.add(unitId);
        }
    }
    return ids;
}

/** Sentence voice config for a line: attach the engine `voiceId` when a take exists in any voice language. */
function voiceConfigForLine(ctx: SceneCompileContext, textId: string): { voiceId: string } | undefined {
    return ctx.voicedUnitIds?.has(textId) ? { voiceId: textId } : undefined;
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
 * The voice unit ids each scene's own rows speak, keyed by scene id.
 *
 * Voice ids are global, so the obvious table is one global table - and that is what this used to
 * hand every scene. But the engine COPIES the config a `Scene` is constructed with, so one global
 * table meant every scene held its own copy of every take in the project: `scenes x takes` entries
 * built on every compile and kept for as long as the story is loaded. MEASURED: the same 10,000-line
 * story with 30,000 takes compiled in 607ms split into 40 scenes and 976ms split into 200 - the
 * whole difference being copies of a table 199 of those scenes never read from.
 *
 * A scene only ever resolves the ids its own lines carry (`getVoice` is asked by the line, and a
 * line belongs to the scene that holds it), so each scene is given exactly those. The total copied
 * is then the number of takes, once - linear in the script rather than in script x scenes.
 */
function voiceUnitIdsByScene(document: StoryDocument): Map<string, Set<string>> {
    const byScene = new Map<string, Set<string>>();
    for (const scene of Object.values(document.scenes ?? {})) {
        const ids = new Set<string>();
        for (const block of Object.values(scene.blocks ?? {})) {
            if (block.kind !== "nodeAction") {
                continue;
            }
            const textId = block.payload.action === "dialogue" || block.payload.action === "narration"
                ? block.payload.text?.textId
                : undefined;
            if (textId) {
                ids.add(textId);
            }
        }
        byScene.set(scene.id, ids);
    }
    return byScene;
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
    voiceIdMap: Record<string, string>;
    busIdByUnit: ReadonlyMap<string, string>;
    audioTracks: readonly ProjectAudioTrack[];
    /** Only these units, or every unit in the map when absent. See {@link voiceUnitIdsByScene}. */
    unitIds?: ReadonlySet<string>;
}): Record<string, string | Sound> {
    const voices: Record<string, string | Sound> = {};
    // Driven by whichever side is smaller: a scene's own ids when it has been given a set, the whole
    // take table when it has not. Filtering the table per scene instead would walk every take once
    // per scene, which is the cost this split exists to remove.
    const add = (unitId: string, url: string | undefined): void => {
        if (!url) {
            return;
        }
        const busId = input.busIdByUnit.get(unitId) ?? AUDIO_TRACK_ID_VOICE;
        voices[unitId] = busId === AUDIO_TRACK_ID_VOICE
            ? url
            : createBusSound(input.audioTracks, busId, AUDIO_TRACK_ID_VOICE, { src: url });
    };
    if (input.unitIds) {
        for (const unitId of input.unitIds) {
            add(unitId, input.voiceIdMap[unitId]);
        }
    } else {
        for (const [unitId, url] of Object.entries(input.voiceIdMap)) {
            add(unitId, url);
        }
    }
    return voices;
}

/**
 * Which bus each voice unit plays on - its speaker's, or the plain `voice` bus.
 *
 * Language-independent (the same character speaks the line in every dub), so it is computed once and
 * shared by every language's table and by the replay path.
 */
function voiceBusIdByUnit(input: {
    document: StoryDocument;
    characters: ReadonlyMap<string, DevModeCharacterSummary>;
    audioTracks: readonly ProjectAudioTrack[];
}): Map<string, string> {
    const busIds = new Map<string, string>();
    for (const [unitId, characterId] of speakerByTextId(input.document)) {
        const requested = input.characters.get(characterId)?.voiceTrackId;
        busIds.set(unitId, resolveVoiceBusId(input.audioTracks, requested));
    }
    return busIds;
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
    /**
     * The audio asset this action starts, for the actions that start one.
     *
     * Only a `/bgm` that names an asset and a `/sound` play carry it: stopping, seeking or
     * re-levelling a clip is not the player hearing it for the first time. A host that watches the
     * play head can therefore say which clip began without decoding the engine action.
     *
     * Deliberately absent from {@link stableActionId}: the static id is what a save anchors on, so
     * folding an asset id into it would invalidate every existing save the moment an author
     * re-pointed a row at a different file.
     */
    audioAssetId?: string;
};

type NlrAction = Parameters<typeof DevTools.setActionId>[0];
type NlrElement = Parameters<typeof DevTools.setElementId>[0];
type DevToolsWithStaticId = typeof DevTools & {
    setStaticId?: (action: NlrAction, id: string | null) => NlrAction;
    setElementStaticId?: (element: NlrElement, id: string | null) => void;
};

/**
 * Name an element from the document it came from.
 *
 * Without this the engine names elements by where they sit in a walk of the action tree, so writing
 * one line ahead of an element hands its name to a different one - and a save restoring by that name
 * then puts one element's state on another. Nothing reports it, because the name it asks for still
 * exists. Every name here is built from what the element *is* (its scene and the name the author
 * gave it, or a library id), so a row written elsewhere cannot reach it.
 *
 * Feature-detected for the same reason the action-id twin is: an engine without it still produces a
 * playable game, and refusing to compile against one would make the two repositories lock-step.
 */
function setStableElementId(sink: string[], element: unknown, staticId: string): void {
    (DevTools as DevToolsWithStaticId).setElementStaticId?.(element as NlrElement, staticId);
    // Recorded at the one place that stamps, so nothing can name an element without the record
    // seeing it. A second list built from the document would be a second copy of this naming rule,
    // and the failure it would hide - an element the compiler names and the record does not - is
    // silent by nature.
    sink.push(staticId);
}

/** Whether the engine in use keeps the names above. */
function engineKeepsElementNames(): boolean {
    return typeof (DevTools as DevToolsWithStaticId).setElementStaticId === "function";
}
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
     * Every stable element id this compile stamped.
     *
     * Alongside the action ids because a save anchors on both, and the two fail in opposite ways: a
     * missing action id is refused at load, while a missing element id is not noticed at all - the
     * pre-resolution only asks whether an id exists, so the state that pointed at it is quietly
     * applied to nothing. Anything comparing two builds has to see both or it reports half the
     * damage.
     */
    elementIdBindings: string[];
    /**
     * Swap the dub language of this compile, in place, while the game is running. Returns false for a
     * language this compile has no take table for (and for a story compiled without voice).
     *
     * Every scene shares one voices object and the engine reads it per line, so the next spoken line
     * plays the new language - the same "applies from the next line" rule a text language switch
     * follows. Absent on the preview/empty compiles, which build no voice table.
     */
    setVoiceLocale?: (locale: string) => boolean;
    /**
     * The clip and bus for one voice unit in the CURRENT dub language, for replaying a line on
     * demand (a backlog replay button, a "listen again" control). Null when the line has no take in
     * that language. Absent on the preview/empty compiles.
     */
    getVoicePlayback?: (unitId: string) => { src: string; busId: string } | null;
    /**
     * Storable namespace holding every "saved" (editor: Var) variable, resolved via
     * {@link DevTools.getNamespaceName} so hosts read live values without depending on the engine's
     * namespace-prefix convention. Empty when the compiled story has no saved namespace.
     */
    savedNamespaceName: string;
    /**
     * Every saved variable this compile knows, keyed by the id a blueprint node names, holding the
     * `storageKey` its value lives under and the default it opens at.
     *
     * Published because a Game UI screen reads these too (`game.getSavedVariable`), and it has to
     * resolve an id to a key by exactly the rule the story writes it with. The compiler already
     * merges the project registry with whatever `/save` rows a legacy document still carries, so
     * handing over that merged view is what keeps the reader and the writer talking about the same
     * variable - a second projection built from the registry alone would silently miss the rows.
     */
    savedVariables: Record<string, StorySavedVariableDefinition>;
    /**
     * Storable namespace holding the visited record (see `./storyVisited`), resolved the same way as
     * {@link CompiledNlrStory.savedNamespaceName}. Hosts read `Is Scene Visited` / `Is Option Picked`
     * out of it. Empty when the compile builds no visited namespace (the boot-time empty story).
     */
    visitedNamespaceName: string;
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
    /**
     * The audio asset each scene's configured background music was built from, keyed by Studio
     * scene id. Only scenes that both declare music and resolved it are present.
     *
     * A scene's music is scene *config*, not a row, so it starts on mount with no action of its
     * own - which means the play head never reports it. A host that follows what the player is
     * hearing has to read it here and pair it with the scene mount instead.
     */
    sceneBackgroundMusicAssetIds?: Record<string, string>;
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
    /**
     * Optional here for the same reason it is optional on {@link CompileInput}, and usually absent.
     *
     * A stage preview is a still of a settled stage; an ambience overlay is a moving thing that has
     * to be produced first. A host that has a baker may pass one and get the overlay; one that does
     * not gets a preview without it, and a diagnostic saying so rather than a silent omission.
     */
    resolveWeatherClip?: CompileInput["resolveWeatherClip"];
    blueprintDocument?: BlueprintDocument;
    /** M-VAR: persistent variable registry table, baked into the bundle; replaces the old blueprint-doc field. */
    persistentVariables?: PersistentVariableRuntimeTable;
    /** M-VAR: saved variable registry table; see {@link CompileInput.savedVariables}. */
    savedVariables?: SavedVariableRuntimeTable;
    persistence?: StoryPersistenceBridge;
    /** Host debug stream for a story row's log lines; see {@link CompileInput.devtools}. */
    devtools?: StoryDevtoolsBridge;
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
    /**
     * The visited record's Persistent (see `./storyVisited`). Compile-wide like `savedPersistent`,
     * because the record is: a scene entered from another scene must land in the same two sets.
     */
    visitedPersistent: Persistent<StoryVisitedContent>;
    /** Scene-scope declaration table of this scene (variableId → def), scanned once per compile. */
    sceneVariables: Record<string, StorySceneVariableDefinition>;
    /**
     * Every saved variable of this compile (variableId → def), built once: the project registry's
     * `saved` entries merged with the document's `/save` declaration rows. Resolvers index it
     * directly by `variableId`, which is why the merge has to happen before the table is built rather
     * than at each lookup.
     */
    savedVariables: Record<string, StorySavedVariableDefinition>;
    /** Story-declared persistent defaults (storageKey → default), the fallback for host reads. */
    persistentDefaults: Record<string, StoryLiteralValue>;
    /** Every declared persistent storage key (story rows + registry), for reference validation. */
    persistentKeys: Set<string>;
    /** M-VAR registry table (id → def), baked into the bundle; used to compile blueprint persistent GET/SET. */
    persistentVariables: PersistentVariableRuntimeTable;
    /** App-level persistent bridge (shared with UI blueprints); absent outside Dev Mode host. */
    persistence?: StoryPersistenceBridge;
    /** Host debug stream for a story row's log lines; absent for a host with no debugger. */
    devtools?: StoryDevtoolsBridge;
    /** Host hook for an `/ending` row; see {@link CompileInput.onEndingReached}. */
    onEndingReached?: (ending: StoryEndingReach) => void;
    /** Host hook for a `/quit` row; see {@link CompileInput.onQuitToPage}. */
    onQuitToPage?: (surfaceId: string) => void;
    /** Blueprint document for compiling story-action blueprints referenced by this scene. */
    blueprintDocument?: BlueprintDocument;
    /** Game localization resolver; absent when the project has no localization or the host passes none. */
    localization?: SceneLocalizationResolver;
    /** Unit ids voiced in any language; absent when the project has no voice or the host passes none. */
    voicedUnitIds?: ReadonlySet<string>;
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
    /**
     * The audio asset each named sound handle was created from, keyed the same way `sounds` is.
     *
     * Same reason `soundTrackIds` exists: `/sound piano` after `/sound piano asset=x` addresses the
     * handle without naming a file, so the row that starts the clip again has no asset id of its
     * own. This is what lets the play head still report which file began.
     */
    soundAssetIds: Map<string, string>;
    /** Fn declarations shared across all story-action blueprints in this scene. */
    sceneFnCatalog: StoryActionFnCatalog;
    images: Map<string, Image>;
    texts: Map<string, Text>;
    /** Puppet-kind characters. A separate map because a `Puppet` is not an `Image` and shares no API with one. */
    puppets: Map<string, Puppet>;
    layers: Map<string, Layer>;
    videos: Map<string, Video>;
    vfx: Map<string, Vfx>;
    /**
     * The clip each named overlay was built from, keyed the same way {@link SceneCompileContext.vfx}
     * is, and compile-wide with it.
     *
     * Exists for the reason `soundTrackIds` does: two rows may name one overlay and only the first
     * creates it, so a later row naming a DIFFERENT clip has to be reported rather than silently
     * ignored.
     */
    vfxAssetIds: Map<string, string | undefined>;
    sounds: Map<string, Sound>;
    animations: Map<string, StoryAnimationAsset>;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    /** Absent when the host compiles for something other than playback; see {@link CompileInput}. */
    resolveWeatherClip: CompileInput["resolveWeatherClip"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
    actionIdBindings: NlrActionIdBinding[];
    elementIdBindings: string[];
    nextActionIndex: (blockId: string) => number;
    /**
     * What a plugin compile pass attached around each row, keyed by block id.
     *
     * Set once per scene, before its rows compile, and **only on the game-compile path**. The stage
     * preview leaves it undefined, which is what keeps a preview snapshot free of injected actions:
     * a preview is asking "what does the stage look like at this row", and an answer that included a
     * plugin's darkens would show the author a stage the row does not describe.
     */
    pluginInjections?: Map<string, { before: NlrStatement[]; after: NlrStatement[] }>;
};

type CompileInput = {
    document: StoryDocument;
    sceneId: string;
    characters?: readonly DevModeCharacterSummary[];
    animations?: Record<string, StoryAnimationAsset>;
    resolveAssetUrl?: (assetId: string, assetType?: StoryAssetKind) => Promise<string | null | undefined> | string | null | undefined;
    /**
     * The clip a weather seed describes, as a URL this host's engine can fetch.
     *
     * A seed is not an asset - there is no id to look up, and the file it names may not exist yet -
     * so producing one is the HOST's business: Dev Mode bakes and hands back a granted URL, a build
     * bakes and packages, and the hosts that only want the graph (save anchors, the shipped-content
     * audit) pass nothing and get a diagnostic instead of a clip. The compiler deliberately does not
     * know the size to bake at either; that follows the project's stage, which the host owns.
     */
    resolveWeatherClip?: (ref: WeatherSeedRef) => Promise<string | null | undefined> | string | null | undefined;
    /** Blueprint document; enables Story Action Blueprints and shared Persistent resolution. */
    blueprintDocument?: BlueprintDocument;
    /** M-VAR: persistent variable registry table, baked into the bundle; replaces the old blueprint-doc field. */
    persistentVariables?: PersistentVariableRuntimeTable;
    /**
     * M-VAR: saved variable registry table (bundle `ui.savedVariables`), keyed by variable id.
     *
     * Half of the saved-variable population; the story's own `/save` declaration rows are the other
     * half, and the compiler unions the two. Absent means "no project-level saved variables", which
     * compiles exactly as it did before the registry grew a saved scope.
     */
    savedVariables?: SavedVariableRuntimeTable;
    /** App-level persistent bridge (shared with UI blueprints); from the Dev Mode scope-store bridge. */
    persistence?: StoryPersistenceBridge;
    /**
     * Where a story row's log lines go, from the host's own debug stream.
     *
     * The same object a Surface blueprint's host API carries, so a `Log` node in a story row and one
     * on a page write to the same place. Absent for a host with no debugger, which leaves the
     * console line and nothing else.
     */
    devtools?: StoryDevtoolsBridge;
    /**
     * Called when an `/ending` row runs.
     *
     * The row itself does nothing else: recording the ending, telling the plugins and putting the
     * player on a page are all host acts, and the host is the only thing that can do them in one
     * order. So the compiler's whole contribution is a statement that says which ending was reached.
     *
     * Absent is a normal state, not a degraded one. The build sweeps compile the same document to
     * read what it references, and the scene preview compiles one scene to a settled stage; neither
     * is playing a story, so neither may be told that one ended. Their ending rows compile to
     * nothing.
     */
    onEndingReached?: (ending: StoryEndingReach) => void;
    /**
     * Called when a `/quit` row runs, with the id of the page to land on.
     *
     * The row's whole contribution is naming the page. Ending the run - tearing the session down,
     * putting the surface stack back on an app page, letting go of the stage - is the host's, and it
     * is the same act `Quit Game` and an ending page already go through, so the row hands it over
     * rather than growing a second path to it.
     *
     * Absent for the same callers `onEndingReached` is absent for, and with the same consequence:
     * a compile that is not playing a story may not be told one has stopped, so its quit rows
     * compile to nothing.
     */
    onQuitToPage?: (surfaceId: string) => void;
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
 * (`/vol 0.5` is the music channel).
 *
 * Bound to the shared constant rather than spelled again. It was a second literal `"bgm"` until the
 * project lint grew a third reader: whether this name is exempt from "that sound is not playing" is
 * a rule of the document, and a rule with three spellings is a rule waiting to be changed in two.
 */
const BGM_SOUND_NAME = BGM_STAGE_OBJECT_NAME;
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
        elementIdBindings: [],
        savedNamespaceName: "",
        savedVariables: {},
        visitedNamespaceName: "",
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
    if (!engineKeepsElementNames()) {
        // Said out loud rather than shrugged off. Without the engine's half, elements fall back to
        // being named by their position, and the failure that produces is a save quietly restoring
        // one element's state onto another - the one shape of breakage nothing else reports.
        pushDiagnostic(
            diagnostics,
            "warning",
            undefined,
            "This engine names elements by position, so saves will not survive edits to the script.",
        );
    }
    const actionIdBindings: NlrActionIdBinding[] = [];
    const elementIdBindings: string[] = [];
    const sceneElements: Record<string, CompiledSceneElements> = {};
    const characters = new Map<string, Character>();
    const avatarAssetIdByUrl = new Map<string, string>();
    // Compile-wide, because `characters` is: see `SceneCompileContext.avatarBoundCharacterIds`.
    const avatarBoundCharacterIds = new Set<string>();
    const characterSummaries = new Map((input.characters ?? []).map(character => [character.id, character]));
    const animations = new Map(Object.entries(input.animations ?? {}));
    const assetUrlCache = new Map<string, string | null>();
    /**
     * How many actions a row has already produced.
     *
     * Per row, deliberately, and this is the whole of what makes a save survive an edit. The count
     * is part of every action's id, and a single counter for the compile put every later row's id
     * downstream of every earlier row: adding one line at the top of chapter one renamed every
     * action after it, and every save taken past that point stopped resolving. Counted per row, a
     * row's ids depend on that row alone.
     */
    const actionIndexByBlock = new Map<string, number>();
    const nextActionIndex = (blockId: string): number => {
        const next = actionIndexByBlock.get(blockId) ?? 0;
        actionIndexByBlock.set(blockId, next + 1);
        return next;
    };
    const resolveAssetUrl = input.resolveAssetUrl ?? ((assetId: string) => assetId);
    const voiceUrlsByLocale = input.voice
        ? await buildVoiceMapsByLocale({ voice: input.voice, resolveAssetUrl, assetUrlCache, diagnostics })
        : undefined;
    const voicedUnitIds = voiceUrlsByLocale ? collectVoicedUnitIds(voiceUrlsByLocale) : undefined;
    // Built here rather than beside the variable tables further down: a scene's own background and
    // music are resolved while the scenes are created, and a set named there needs the same reader a
    // row's set reference uses.
    const localization = input.localization ? createSceneLocalizationResolver(input.localization) : undefined;
    const audioTracks = input.audioTracks ?? BUILTIN_AUDIO_TRACKS;
    const sceneBackgroundMusic = new Map<string, { sound: Sound; trackId: string; assetId: string }>();
    /**
     * Ambience overlays, keyed by name, for the WHOLE compile rather than per scene.
     *
     * A `Vfx` is the one stage object the engine does not scope to a scene: `GameState` holds it,
     * scene exit does not remove it, and only its own `hide` does. So rain started in one scene is
     * still falling in the next, and a per-scene map made that unreachable - the next scene's
     * `/hide rain` resolved no handle and compiled to nothing, while a second `/vfx rain` built a
     * SECOND overlay on top of the first. One map means one name is one overlay, everywhere.
     */
    const vfxByName = new Map<string, Vfx>();
    const vfxAssetIds = new Map<string, string | undefined>();
    const scenesBuild = await createNlrScenes({
        elementIdBindings,
        document: input.document,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
        voiceUrlsByLocale,
        activeVoiceLocale: input.voice?.getVoiceLocale() ?? "",
        audioClips: input.audioClips,
        audioTracks,
        characters: characterSummaries,
        backgroundMusic: sceneBackgroundMusic,
        localization,
    });
    const allScenes = scenesBuild.scenes;

    // Single Storable-backed namespace seeded with every saved variable's default. "Every" spans both
    // authoring surfaces since `saved` became a registry scope: the project registry's saved entries
    // and the document's `/save` rows land in one table, and a name declared on both is reported.
    const savedView = collectSavedVariableView(input.document, input.savedVariables);
    const savedVariables = savedVariableDefsFromView(savedView);
    pushSavedNameCollisionDiagnostics(diagnostics, savedView);
    const savedDefaults = collectSavedDefaults(savedVariables);
    // A launch starts the story mid-way, so the saved namespace opens at the snapshot's accumulated
    // values (defaults overlaid with everything set on the path to the target row). Applied AFTER the
    // defaults: the snapshot is the later state, and re-seeding a default over it would rewind it.
    if (input.launch) {
        Object.assign(savedDefaults, input.launch.snapshot.savedVariables);
    }
    const savedPersistent = nlrStory.createPersistent(SAVED_PERSISTENT_NAMESPACE, savedDefaults);
    // Deliberately NOT seeded from `input.launch`: a row-precise launch fabricates a starting state,
    // and pretending the player had already walked the scenes on the way there would put fake
    // entries in a record whose whole job is to say where the player has actually been.
    const visitedPersistent = createStoryVisitedPersistent(nlrStory);
    const persistentVariables = input.persistentVariables ?? {};
    const persistentView = collectPersistentView(input.document, persistentVariables);
    const persistentDefaults = collectPersistentDefaults(persistentView);
    const persistentKeys = mergedPersistentStorageKeys(persistentView);
    pushPersistentNameCollisionDiagnostics(diagnostics, persistentView);

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
            visitedPersistent,
            sceneVariables: sceneVariableDefs(scene),
            savedVariables,
            persistentDefaults,
            persistentKeys,
            persistentVariables,
            persistence: input.persistence,
            devtools: input.devtools,
            onEndingReached: input.onEndingReached,
            onQuitToPage: input.onQuitToPage,
            blueprintDocument: input.blueprintDocument,
            localization,
            voicedUnitIds,
            sceneFnCatalog,
            images: new Map(),
            texts: new Map(),
            puppets: new Map(),
            layers: new Map(),
            videos: new Map(),
            vfx: vfxByName,
            vfxAssetIds,
            resolveWeatherClip: input.resolveWeatherClip,
            // Seeded with the scene's configured track under the name the sound-control family
            // defaults to, so `/vol 0.5` on a scene with music means what it looks like.
            sounds: sceneMusic ? new Map([[BGM_SOUND_NAME, sceneMusic.sound]]) : new Map(),
            soundTrackIds: sceneMusic ? new Map([[BGM_SOUND_NAME, sceneMusic.trackId]]) : new Map(),
            soundAssetIds: sceneMusic ? new Map([[BGM_SOUND_NAME, sceneMusic.assetId]]) : new Map(),
            audioClips: input.audioClips,
            audioTracks,
            animations,
            resolveAssetUrl,
            assetUrlCache,
            diagnostics,
            actionIdBindings,
            elementIdBindings,
            nextActionIndex,
        };
        // Let the registered plugin compile passes read this scene and say what they attach around
        // each row. Before the seeds and before any row compiles, because `compileBlock` reads the
        // result. This call is what makes it the game-compile path: the two preview compilers below
        // never make it, so `ctx.pluginInjections` stays unset there and their snapshots stay free of
        // anything a plugin injected.
        runStoryCompilePasses(ctx);
        // Seed declared scene-local defaults at the head of the scene's statement list. They must be
        // statements (not build-time sets): `Scene.local.init` resets the namespace on every scene
        // entry, so the seeds have to re-run each time the scene starts.
        //
        // The visit is recorded from the same position, and for the same reason: it belongs to the
        // moment the scene STARTS, and it must re-run on every entry (a re-entry after a load has to
        // put the id back). Nothing an author writes is involved - Ink's `visited`, Ren'Py's
        // `seen_label` and Yarn's `visited()` are all automatic, and a feature that needs a manual
        // marker row on every scene is a feature nobody turns on.
        const seeds: NlrStatement[] = [
            markStoryVisitedStatement(visitedPersistent, STORY_VISITED_SCENES_KEY, scene.id),
        ];
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
            vfx: vfxByName,
            vfxAssetIds,
            actionIdBindings,
            elementIdBindings,
            diagnostics,
            characters,
            characterSummaries,
            avatarAssetIdByUrl,
            avatarBoundCharacterIds,
            savedPersistent,
            visitedPersistent,
            savedVariables,
            persistentDefaults,
            persistentKeys,
            persistentVariables,
            animations,
            resolveAssetUrl,
                assetUrlCache,
            localization,
            voicedUnitIds,
            nextActionIndex,
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
        elementIdBindings,
        savedNamespaceName: DevTools.getNamespaceName(savedPersistent),
        savedVariables,
        visitedNamespaceName: DevTools.getNamespaceName(visitedPersistent),
        sceneLocalNamespaceNames,
        diagnostics,
        characters,
        avatarAssetIdByUrl,
        sceneBackgroundMusicAssetIds: Object.fromEntries(
            Array.from(sceneBackgroundMusic, ([sceneId, music]) => [sceneId, music.assetId] as const),
        ),
        sceneElements,
        setVoiceLocale: scenesBuild.setVoiceLocale,
        getVoicePlayback: scenesBuild.getVoicePlayback,
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
    /** The compile's ambience overlays - shared, so the entry scene and the story it hands over to
     *  address one overlay per name rather than two objects wearing one id. */
    vfx: Map<string, Vfx>;
    vfxAssetIds: Map<string, string | undefined>;
    actionIdBindings: NlrActionIdBinding[];
    elementIdBindings: string[];
    diagnostics: NlrStoryCompileDiagnostic[];
    characters: Map<string, Character>;
    characterSummaries: Map<string, DevModeCharacterSummary>;
    avatarAssetIdByUrl: Map<string, string>;
    avatarBoundCharacterIds: Set<string>;
    savedPersistent: Persistent<Record<string, StoryLiteralValue>>;
    visitedPersistent: Persistent<StoryVisitedContent>;
    savedVariables: Record<string, StorySavedVariableDefinition>;
    persistentDefaults: Record<string, StoryLiteralValue>;
    persistentKeys: Set<string>;
    persistentVariables: PersistentVariableRuntimeTable;
    animations: Map<string, StoryAnimationAsset>;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    localization?: SceneLocalizationResolver;
    voicedUnitIds?: ReadonlySet<string>;
    nextActionIndex: (blockId: string) => number;
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
            ?? await resolveSceneInitialBackground({
                scene,
                resolveAssetUrl,
                assetUrlCache,
                diagnostics,
                ...(params.localization ? { localization: params.localization } : {}),
            });
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
        ...(params.localization ? { localization: params.localization } : {}),
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
        visitedPersistent: params.visitedPersistent,
        sceneVariables: sceneVariableDefs(scene),
        savedVariables: params.savedVariables,
        persistentDefaults: params.persistentDefaults,
        persistentKeys: params.persistentKeys,
        persistentVariables: params.persistentVariables,
        persistence: input.persistence,
        devtools: input.devtools,
        onEndingReached: input.onEndingReached,
        onQuitToPage: input.onQuitToPage,
        blueprintDocument: input.blueprintDocument,
        localization: params.localization,
        voicedUnitIds: params.voicedUnitIds,
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
        vfx: params.vfx,
        vfxAssetIds: params.vfxAssetIds,
        resolveWeatherClip: params.input.resolveWeatherClip,
        sounds: launchMusic ? new Map([[BGM_SOUND_NAME, launchMusic.sound]]) : new Map(),
        soundTrackIds: launchMusic ? new Map([[BGM_SOUND_NAME, launchMusic.trackId]]) : new Map(),
        soundAssetIds: launchMusic ? new Map([[BGM_SOUND_NAME, launchMusic.assetId]]) : new Map(),
        audioClips: input.audioClips,
        audioTracks,
        animations: params.animations,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
        actionIdBindings: params.actionIdBindings,
        elementIdBindings: params.elementIdBindings,
        nextActionIndex: params.nextActionIndex,
    };

    // The stage as it stands at the target row, followed by everything the rest of the scene
    // declares that this path never reached. The second half is not stage state and arrives hidden:
    // it is here so the tail's rows find the objects a full compile of the scene would have
    // registered for them - see `StoryStageSnapshot.declarations`. The real state goes first, so a
    // name that IS on stage is always built from its own record.
    const preposed = [...snapshot.displayables, ...snapshot.declarations];

    // Custom layers first so images/texts can bind to them, all pre-posed via constructor config.
    for (const record of preposed) {
        if (record.kind === "layer") {
            getLayer(ctx, record.objectName, record.zIndex ?? 0, snapshotPoseProps(record));
        }
    }
    const registrations: { element: Image | Text; layer: Layer | undefined }[] = [];
    for (const record of preposed) {
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

    // A loop is state at the target row, not a pose, so it is replayed as its own call rather than
    // pre-posed. Without this a launch from a row after `/transform hero loop` would open on a
    // character who has stopped breathing - while a SAVE taken at the same row restores the motion,
    // which is the disagreement this closes.
    for (const record of snapshot.displayables) {
        if (!record.loop) {
            continue;
        }
        const element = record.kind === "image"
            ? ctx.images.get(normalizeObjectName(record.objectName))
            : record.kind === "text"
                ? ctx.texts.get(normalizeObjectName(record.objectName))
                : ctx.layers.get(normalizeObjectName(record.objectName));
        const statement = element && compileSnapshotLoop(ctx, element, record.loop, params.launch.targetBlockId ?? "");
        if (statement) {
            statements.push(statement);
        }
    }
    if (snapshot.camera?.loop) {
        const statement = compileSnapshotLoop(ctx, nlrStory.camera, snapshot.camera.loop, params.launch.targetBlockId ?? "");
        if (statement) {
            statements.push(statement);
        }
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
    const elementIdBindings: string[] = [];
    const characterSummaries = new Map((input.characters ?? []).map(character => [character.id, character]));
    const animations = new Map(Object.entries(input.animations ?? {}));
    const assetUrlCache = new Map<string, string | null>();
    const resolveAssetUrl = input.resolveAssetUrl ?? ((assetId: string) => assetId);
    /**
     * How many actions a row has already produced.
     *
     * Per row, deliberately, and this is the whole of what makes a save survive an edit. The count
     * is part of every action's id, and a single counter for the compile put every later row's id
     * downstream of every earlier row: adding one line at the top of chapter one renamed every
     * action after it, and every save taken past that point stopped resolving. Counted per row, a
     * row's ids depend on that row alone.
     */
    const actionIndexByBlock = new Map<string, number>();
    const nextActionIndex = (blockId: string): number => {
        const next = actionIndexByBlock.get(blockId) ?? 0;
        actionIndexByBlock.set(blockId, next + 1);
        return next;
    };

    const nlrStory = new Story(`${input.document.name || input.document.id} (preview)`);
    // Same merged saved table as a full compile - the preview must agree with the game about which
    // saved variables exist, or a registry-backed one would resolve here and not there.
    const savedView = collectSavedVariableView(input.document, input.savedVariables);
    const savedVariables = savedVariableDefsFromView(savedView);
    pushSavedNameCollisionDiagnostics(diagnostics, savedView);
    const savedDefaults = collectSavedDefaults(savedVariables);
    Object.assign(savedDefaults, snapshot.savedVariables);
    const savedPersistent = nlrStory.createPersistent(SAVED_PERSISTENT_NAMESPACE, savedDefaults);
    // The preview compiles a single row, not a playthrough, so nothing here ever records a visit -
    // the namespace exists only because `SceneCompileContext` requires one and a choice row inside
    // the previewed block still compiles its (never-taken) option branches.
    const visitedPersistent = createStoryVisitedPersistent(nlrStory);

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
        visitedPersistent,
        sceneVariables: sceneVariableDefs(scene),
        savedVariables,
        persistentDefaults: collectPersistentDefaults(previewPersistentView),
        persistentKeys: mergedPersistentStorageKeys(previewPersistentView),
        persistentVariables: input.persistentVariables ?? {},
        persistence: input.persistence,
        devtools: input.devtools,
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
        vfxAssetIds: new Map(),
        sounds: new Map(),
        soundTrackIds: new Map(),
        soundAssetIds: new Map(),
        audioClips: input.audioClips,
        audioTracks: input.audioTracks ?? BUILTIN_AUDIO_TRACKS,
        animations,
        resolveAssetUrl,
        resolveWeatherClip: input.resolveWeatherClip,
        assetUrlCache,
        diagnostics,
        actionIdBindings,
        elementIdBindings,
        nextActionIndex,
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
            playbackStop = { reason: "jump", ...ctx.previewEncounteredJump, followed: false };
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
        elementIdBindings,
        savedNamespaceName: DevTools.getNamespaceName(savedPersistent),
        savedVariables,
        visitedNamespaceName: DevTools.getNamespaceName(visitedPersistent),
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
    // Only the preview holds at a jump. A launch emits it and control leaves for the target scene,
    // so there is nothing to report - the row did exactly what it says.
    if (plan.stop.reason === "jump" && !plan.stop.followed) {
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

/**
 * The `src` a pre-posed snapshot element is CONSTRUCTED with.
 *
 * A layered character has to be rebuilt as its whole stack here, not as the single url a preset
 * character resolves to: an Image's src shape is fixed in its constructor, and every later row for
 * that character changes tags rather than the source. Handing it a url would leave the portrait
 * unable to accept a tag change at all - the engine rejects the whole story for it while registering
 * preloadable sources, so a mid-scene launch into a scene with a layered character crashed the
 * player instead of starting.
 */
async function resolveSnapshotImageSource(
    ctx: SceneCompileContext,
    record: StageSnapshotDisplayable,
): Promise<string | { layers: (string | null | Record<string, string | null>)[]; defaults: string[] } | null> {
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
    // The snapshot accumulated the tag selection row by row, so the stack opens on the look the
    // character wore at the launch row rather than on its declared default.
    const layered = await resolveCharacterLayeredSrc(ctx, source.characterId, blockId, source.tags);
    if (layered) {
        return layered;
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
    /** For the sets a scene's own two asset fields may name. Absent in a project with no languages. */
    localization?: SceneLocalizationResolver;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
    /** Where the ids stamped on each scene's own elements are recorded. */
    elementIdBindings: string[];
    /** Every voice language's unit id → clip URL map. Voice ids are global, so one table serves every scene. */
    voiceUrlsByLocale?: Record<string, Record<string, string>>;
    /** Which language the scenes open on. */
    activeVoiceLocale?: string;
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
    backgroundMusic?: Map<string, { sound: Sound; trackId: string; assetId: string }>;
}): Promise<{
    scenes: Record<string, Scene>;
    setVoiceLocale: (locale: string) => boolean;
    getVoicePlayback: (unitId: string) => { src: string; busId: string } | null;
}> {
    const scenes: Record<string, Scene> = {};

    /**
     * The take tables, and the live objects the scenes actually read.
     *
     * `Scene.getVoice` reads `config.voices[id]` fresh on every line, so repopulating that object in
     * place is all it takes to change dub language mid-game - no recompile, no remount, no restart.
     *
     * The catch, and it is only visible in a running game: **`Scene` copies the config it is handed**,
     * so the object passed to the constructor is NOT the object the scene ends up reading. Mutating
     * the one we built here changed nothing and the switch silently did nothing - the same shape of
     * defect ("ships, never works") this whole change exists to remove. So each scene's own table is
     * collected after construction and they are all rewritten together.
     *
     * That copy is also why the tables are cut per scene rather than shared: see
     * {@link voiceUnitIdsByScene}. Each scene is handed only the units its own lines speak, so what
     * the engine copies is the script's takes once rather than once per scene.
     */
    const busIdByUnit = voiceBusIdByUnit({
        document: input.document,
        characters: input.characters,
        audioTracks: input.audioTracks,
    });
    const unitIdsByScene = voiceUnitIdsByScene(input.document);
    const urlsByLocale = input.voiceUrlsByLocale ?? {};
    /**
     * Per language, per scene: only that scene's takes - built the first time that language is
     * asked for, and kept.
     *
     * Lazily, because a compile installs exactly one language and most projects never switch: doing
     * every language up front is work per language that the run will not read, and it is the same
     * per-scene work three times over.
     */
    const voicesByLocale: Record<string, Record<string, Record<string, string | Sound>>> = {};
    const sceneVoicesFor = (locale: string): Record<string, Record<string, string | Sound>> | null => {
        const urls = urlsByLocale[locale];
        if (!urls) {
            return null;
        }
        const cached = voicesByLocale[locale];
        if (cached) {
            return cached;
        }
        const byScene: Record<string, Record<string, string | Sound>> = {};
        for (const [sceneId, unitIds] of unitIdsByScene) {
            byScene[sceneId] = buildSceneVoices({ voiceIdMap: urls, busIdByUnit, audioTracks: input.audioTracks, unitIds });
        }
        voicesByLocale[locale] = byScene;
        return byScene;
    };
    const anyVoices = Object.values(urlsByLocale).some(urls => Object.keys(urls).length > 0);
    /**
     * The table handed to each scene's constructor, by scene id.
     *
     * Present for every scene when the project has any takes at all, including the scenes that have
     * none of their own: a scene constructed without a `voices` config would answer `null` for a
     * line whose take arrives later with a dub switch, and the empty object costs nothing.
     */
    const voicesForScene = anyVoices
        ? new Map(Array.from(unitIdsByScene.keys(), sceneId => [sceneId, {} as Record<string, string | Sound>]))
        : null;
    /** Each scene's OWN copy of its table, paired with the scene it belongs to. */
    const liveTables: Array<{ sceneId: string; live: Record<string, string | Sound> }> = [];
    if (voicesForScene) {
        for (const [sceneId, table] of voicesForScene) {
            liveTables.push({ sceneId, live: table });
        }
    }
    let activeLocale = "";
    const applyLocale = (locale: string): boolean => {
        const byScene = sceneVoicesFor(locale);
        if (!voicesForScene || !byScene) {
            return false;
        }
        for (const { sceneId, live } of liveTables) {
            for (const key of Object.keys(live)) {
                delete live[key];
            }
            Object.assign(live, byScene[sceneId] ?? {});
        }
        activeLocale = locale;
        return true;
    };
    applyLocale(input.activeVoiceLocale ?? "");

    /**
     * What a replay of one line needs: the clip and the bus it belongs on.
     *
     * Deliberately NOT the `Sound` the scene table holds - that instance is the one the story itself
     * plays through, and the audio manager keys a playing token by instance, so replaying a backlog
     * line would collide with the line still on screen. The caller builds a fresh sound from this.
     */
    const getVoicePlayback = (unitId: string): { src: string; busId: string } | null => {
        const src = input.voiceUrlsByLocale?.[activeLocale]?.[unitId];
        return src ? { src, busId: busIdByUnit.get(unitId) ?? AUDIO_TRACK_ID_VOICE } : null;
    };
    // Two scenes with the same runtime name share one `Scene.local` namespace, so their scene-local
    // variables would silently read and write each other's values. The name keys the namespace
    // (`DevTools.getNamespaceName`), so a collision is a real data hazard, not cosmetic.
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
            ...(input.localization ? { localization: input.localization } : {}),
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
        const sceneVoices = voicesForScene?.get(scene.id);
        if (sceneVoices) {
            config.voices = sceneVoices;
        }
        const music = await resolveSceneBackgroundMusic({
            scene,
            audioClips: input.audioClips,
            audioTracks: input.audioTracks,
            resolveAssetUrl: input.resolveAssetUrl,
            assetUrlCache: input.assetUrlCache,
            diagnostics: input.diagnostics,
            ...(input.localization ? { localization: input.localization } : {}),
        });
        if (music) {
            config.backgroundMusic = music.sound;
            config.backgroundMusicFade = music.fadeMs;
            input.backgroundMusic?.set(scene.id, { sound: music.sound, trackId: music.trackId, assetId: music.assetId });
        }
        const built = new Scene(
            runtimeName,
            Object.keys(config).length > 0 ? config : undefined,
        );
        setStableSceneElementIds(input.elementIdBindings, built, scene.id);
        scenes[scene.id] = built;
        // The scene's OWN table, which is a copy of the one just handed in - see the note above.
        const live = (built as unknown as { config?: { voices?: unknown } }).config?.voices;
        if (sceneVoices && live && live !== sceneVoices && typeof live === "object") {
            // The scene's own copy replaces the one handed in: it is what `getVoice` reads, so it is
            // what a dub switch has to rewrite.
            const slot = liveTables.find(entry => entry.sceneId === scene.id);
            if (slot) {
                slot.live = live as Record<string, string | Sound>;
            }
        }
    }
    return { scenes, setVoiceLocale: applyLocale, getVoicePlayback };
}

async function resolveSceneInitialBackground(input: {
    scene: StoryScene;
    resolveAssetUrl: Required<CompileInput>["resolveAssetUrl"];
    assetUrlCache: Map<string, string | null>;
    diagnostics: NlrStoryCompileDiagnostic[];
    /** Present once the story has been assembled; a scene naming a set needs it to pick a member. */
    localization?: SceneLocalizationResolver;
}): Promise<string | null> {
    const assetId = input.scene.defaultBackgroundAssetId?.trim();
    if (!assetId) {
        return null;
    }
    return resolveAssetUrlCached({
        assetId: resolveVariantReference({
            variants: input.scene.assetVariants,
            assetId,
            blockId: SCENE_INITIAL_BACKGROUND_BLOCK_ID,
            localization: input.localization,
            diagnostics: input.diagnostics,
        }),
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
    /** Present once the story has been assembled; a scene naming a set needs it to pick a member. */
    localization?: SceneLocalizationResolver;
}): Promise<{ sound: Sound; fadeMs: number; trackId: string; assetId: string } | null> {
    const bgm = input.scene.bgm;
    const assetId = bgm?.assetId?.trim();
    if (!bgm || !assetId) {
        return null;
    }
    const member = resolveVariantReference({
        variants: input.scene.assetVariants,
        assetId,
        blockId: SCENE_BACKGROUND_MUSIC_BLOCK_ID,
        localization: input.localization,
        diagnostics: input.diagnostics,
    });
    const url = await resolveAssetUrlCached({
        assetId: member,
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
            // The member, not the set: a clip region is authored against a file, and a set id would
            // find none - the scene would play the whole track where the author trimmed it.
            ...audioClipRegionToSoundConfig(input.audioClips?.[member]),
        }),
        fadeMs: bgm.fadeMs ?? 0,
        trackId: track.id,
        assetId: member,
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
        // An `/ending` or `/quit` row is where this list stops. Not an optimisation: the engine has
        // no primitive that halts a running story, so a row written after one would otherwise play
        // after it - with the stage already hidden, on its way to a page. Rows nested further out
        // are beyond what this can reach and are reported by `story/rows-after-ending` instead.
        if (endsPlayback(ctx.scene.blocks[blockId])) {
            break;
        }
    }
    return statements;
}

/**
 * Whether this row ends playback and is actually in the build (a disabled row is not).
 *
 * Both rows that leave the run qualify: an `/ending` says the story is over, a `/quit` says this run
 * is, and in either case what follows in the same list would be playing to a stage on its way out.
 */
function endsPlayback(block: StoryBlock | undefined): boolean {
    if (!block || block.disabled || block.kind !== "control") {
        return false;
    }
    return block.payload.control === "ending" || block.payload.control === "quit";
}

/** A runtime flag whose predicate the compiler reads back internally to build a guard. */
type InternalRuntimeFlag = RuntimeFlag & { __read(scriptCtx: ScriptCtx): boolean };

/**
 * Run every registered plugin compile pass over one scene and record what they inject.
 *
 * Called once per scene on the game-compile path, before the scene's rows compile. It flattens the
 * scene into the execution-ordered views a pass reads, builds the character roster, and hands each
 * pass a context whose methods turn its requests into engine actions. The `inject` calls land in
 * `ctx.pluginInjections`, which {@link compileBlock} splices around each row.
 *
 * With no pass registered it returns immediately and leaves `pluginInjections` unset - so a project
 * with no such plugin pays one array-length check per scene, and nothing else.
 */
function runStoryCompilePasses(ctx: SceneCompileContext): void {
    const passes = getStoryCompilePasses();
    if (passes.length === 0) {
        return;
    }

    // The roster is the stage object names the scene mentions, plus the characterId -> stage name
    // inversion a dialogue row needs: a line carries only `characterId`, while `getImage` and every
    // character row key on the stage object name, and the two have to line up or a pass would darken
    // a name nothing on stage answers to.
    const rosterSet = new Set<string>();
    const stageNameByCharacterId = new Map<string, string>();
    for (const block of Object.values(ctx.scene.blocks)) {
        if (block.disabled || block.kind !== "action" || block.payload.action !== "character") {
            continue;
        }
        const stageName = normalizeObjectName(getCharacterStageObjectName(block.payload));
        rosterSet.add(stageName);
        if (block.payload.characterId && !stageNameByCharacterId.has(block.payload.characterId)) {
            stageNameByCharacterId.set(block.payload.characterId, stageName);
        }
    }

    const speakerOf = (characterId: string | undefined): string | null => {
        if (!characterId) {
            return null;
        }
        return stageNameByCharacterId.get(characterId) ?? normalizeObjectName(characterId);
    };

    const classify = (block: StoryBlock): CompileBlockView => {
        if (block.kind === "nodeAction") {
            if (block.payload.action === "dialogue") {
                return { kind: "dialogue", id: block.id, speaker: speakerOf(block.payload.characterId) };
            }
            if (block.payload.action === "narration") {
                return { kind: "dialogue", id: block.id, speaker: null };
            }
            // A choice and its options are where the scene stops being a straight line, which is
            // exactly what a boundary means here.
            if (block.payload.action === "choice" || block.payload.action === "choiceOption") {
                return { kind: "boundary", id: block.id };
            }
            return { kind: "other", id: block.id };
        }
        if (block.kind === "action") {
            if (block.payload.action === "plugin") {
                return {
                    kind: "pluginAction",
                    id: block.id,
                    pluginId: block.payload.pluginId,
                    actionId: block.payload.actionId,
                    params: block.payload.params,
                };
            }
            return { kind: "other", id: block.id };
        }
        if (block.kind === "control" || block.kind === "jump") {
            return { kind: "boundary", id: block.id };
        }
        // A note, a declaration, an invalid draft: rows that say nothing about who speaks.
        return { kind: "other", id: block.id };
    };

    const views: CompileBlockView[] = [];
    const walk = (blockIds: readonly string[]): void => {
        for (const blockId of blockIds) {
            const block = ctx.scene.blocks[blockId];
            // Disabled rows are skipped with their subtree, exactly as `compileBlock` skips them: a
            // pass must see the order that will actually run, not the one on screen.
            if (!block || block.disabled) {
                continue;
            }
            views.push(classify(block));
            if (block.childrenIds.length > 0) {
                walk(block.childrenIds);
            }
        }
    };
    walk(ctx.scene.rootBlockIds);

    const injections = new Map<string, { before: NlrStatement[]; after: NlrStatement[] }>();
    const flags = new Map<string, InternalRuntimeFlag>();
    const namespaceName = DevTools.getNamespaceName(ctx.nlrScene.local);

    const makeFlag = (name: string): InternalRuntimeFlag => {
        const existing = flags.get(name);
        if (existing) {
            return existing;
        }
        const flag: InternalRuntimeFlag = {
            write: (value: boolean) => Script.execute((scriptCtx: ScriptCtx) => {
                const ns = scriptCtx.storable.getNamespace(namespaceName);
                const had = ns.has(name);
                const previous = ns.get(name);
                ns.set(name, value as never);
                // The cleaner is the whole reason this is a Script and not a plain set. Returning one
                // is what puts the write in the action history; without it a rewind past this row
                // leaves the flag at its new value and every guard after it takes the wrong branch -
                // a save that plays differently the second time, with nothing on screen to explain it.
                return () => { ns.set(name, (had ? previous : undefined) as never); };
            }) as unknown as EngineAction,
            __read: (scriptCtx: ScriptCtx) => Boolean(scriptCtx.storable.getNamespace(namespaceName).get(name)),
        };
        flags.set(name, flag);
        return flag;
    };

    const context: PluginSceneCompileContext = {
        blocks: views,
        roster: () => [...rosterSet],
        resolveCharacterImage: (objectName: string): StageImage | null => {
            const name = normalizeObjectName(objectName);
            if (!rosterSet.has(name)) {
                return null;
            }
            const image = getImage(ctx, name, { autoFit: true });
            return {
                darken: (darkness, durationMs, easing) => image.darken(
                    Math.min(1, Math.max(0, darkness)),
                    Math.max(0, durationMs),
                    parseStoryEasing(easing) as never,
                ) as unknown as EngineAction,
                bringToFront: () => image.bringToFront() as unknown as EngineAction,
            };
        },
        // `allAsync`, never `doAsync` - see the note in storyCompilePass.ts. This is the single place
        // that decision is made, which is the point of the method existing at all.
        parallel: (actions: EngineAction[]) => Control.allAsync(actions as never) as unknown as EngineAction,
        guarded: (flag: RuntimeFlag, actions: EngineAction[]) => Condition.If(
            (scriptCtx: ScriptCtx) => (flag as InternalRuntimeFlag).__read(scriptCtx),
            actions as never,
        ) as unknown as EngineAction,
        runtimeFlag: (name: string) => makeFlag(name),
        inject: (blockId: string, injection) => {
            if (!ctx.scene.blocks[blockId]) {
                // Silently ignoring it would make a pass's own bug look like the feature not working.
                diagnostic(ctx, "warning", undefined, `Compile pass injected into a row that is not in this scene: ${blockId}`);
                return;
            }
            const entry = injections.get(blockId) ?? { before: [], after: [] };
            if (injection.before) {
                entry.before.push(...(injection.before as unknown as NlrStatement[]));
            }
            if (injection.after) {
                entry.after.push(...(injection.after as unknown as NlrStatement[]));
            }
            injections.set(blockId, entry);
        },
    };

    for (const pass of passes) {
        try {
            pass.scene(context);
        } catch (error) {
            // One pass throwing must not take the compile down with it: the author's story is not at
            // fault, and a scene that compiles without a plugin's contribution is a far better
            // outcome than a project that cannot be built until the plugin is fixed.
            diagnostic(
                ctx,
                "warning",
                undefined,
                `Compile pass "${pass.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    ctx.pluginInjections = injections;
}

/**
 * One row, with anything a plugin compile pass attached around it.
 *
 * The injection wraps the row's *whole* compiled output, children included. For the rows a pass
 * actually addresses - a line of dialogue, a marker - that is the same thing either way, since they
 * have no children; for a container it is the reading that matches what a pass asked for, which is
 * "before this happens" and "after this has happened".
 *
 * `pluginInjections` is undefined on the preview path and whenever no pass is registered, so the
 * common case costs one property read.
 */
async function compileBlock(ctx: SceneCompileContext, blockId: string): Promise<NlrStatement[]> {
    const own = await compileBlockCore(ctx, blockId);
    const injection = ctx.pluginInjections?.get(blockId);
    if (!injection || (injection.before.length === 0 && injection.after.length === 0)) {
        return own;
    }
    // A row that compiled to nothing still gets its injection: a marker block IS that case, and it is
    // the one carrying the pass's own before/after.
    return [...injection.before, ...own, ...injection.after];
}

async function compileBlockCore(ctx: SceneCompileContext, blockId: string): Promise<NlrStatement[]> {
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
        if (block.payload.control === "break") {
            return compileBreak(ctx, block);
        }
        if (block.payload.control === "cut") {
            // Nothing to emit. This compiler serves the editor's preview and Dev Mode, both of which
            // play the story as the author sees it - the release edition, which no cut point ends.
            // Where a variant's package is assembled is where the rows after this one are dropped;
            // here the row is a marker and the scene carries on. Answered explicitly so it cannot
            // fall into the group arm below and compile as an empty container.
            return [];
        }
        if (block.payload.control === "ending") {
            return compileEnding(ctx, block, block.payload);
        }
        if (block.payload.control === "quit") {
            return compileQuit(ctx, block, block.payload);
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
        const transition = await createTransition(block.payload.transition, ctx, block.id);
        // A returnable jump takes the config object, because that is where the flag lives; a plain
        // one keeps handing the transition straight in, which is the call every existing row makes.
        const chain = block.payload.returnable
            ? ctx.nlrScene.jumpTo(target, { returnable: true, ...(transition ? { transition } : {}) } as any)
            : ctx.nlrScene.jumpTo(target, transition as any);
        return [recordStatement(ctx, chain, block)];
    }

    if (block.kind === "declaration") {
        // Authoring metadata, not a runtime action: the scanned variable tables carry its meaning,
        // and the scene-head seeds carry its default. Nothing to emit, nothing to warn about.
        return [];
    }

    if (block.kind === "invalid") {
        // Skipped rather than fatal so preview still runs: a half-typed command is a normal thing to
        // have on screen while writing. `error` (not `warning`) is what stops it there - a production
        // build refuses on error diagnostics, so an unfinished line cannot ship quietly.
        diagnostic(ctx, "error", block.id, `Invalid command, skipped: ${block.payload.source}`);
        return [];
    }

    if (block.kind === "empty") {
        // A blank line: nothing to emit and nothing to say about it. Not a diagnostic of any level -
        // an author leaves these behind by clearing a line, which is editing, not a mistake.
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
        if (block.payload.control === "break") {
            // The preview compiles this row on its own, without the loop it belongs to. Emitting
            // `breakLoop()` there is an engine error at play time, so the preview holds instead.
            diagnostic(ctx, "warning", block.id, "Preview holds at the break; it needs its loop to do anything.");
            return [];
        }
        if (block.payload.control === "cut") {
            // A marker, not an action: no statement here and none in the walk above.
            return [];
        }
        if (block.payload.control === "ending") {
            // The preview settles one scene's stage. Ending the story is not a stage state, and this
            // path has no host to end it for - `onEndingReached` is absent here by construction.
            return [];
        }
        if (block.payload.control === "quit") {
            // Same as the ending above: there is no run for this path to end, and no page for it to
            // hand the screen to - the preview IS the screen.
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
 * re-resolves per render: the current locale's translation, or the original
 * source-language prompt when no translation applies. Untranslated segments keep
 * their plain compiled form - zero overhead.
 *
 * A translation is rebuilt into the same three kinds of token the source line compiles to:
 *
 *  - `{n}` resolves to the source line's nth interpolation Word, which already carries whatever
 *    styling the author put on the value itself.
 *  - `‹i›…‹/i›` puts run i's marks on the characters the translator wrapped, so emphasis, colour,
 *    ruby and a size step survive into every language.
 *  - `‹i›` alone drops run i in where the translation asks for it, which is how an inline pause or a
 *    reveal-time event keeps its beat when the word order changes.
 *
 * A translation that names none of them renders exactly as it did before run tags existed: plain
 * text with its values in it.
 */
function buildLocalizedSentencePrompt(ctx: SceneCompileContext, segment: StoryTextSegment, blockId: string, eventMap?: Map<StoryRichRun, TextEvent>): string | unknown[] {
    const { prompt, interpolationWords } = buildSentenceParts(segment, ctx, blockId, eventMap);
    const localization = ctx.localization;
    if (!localization || !localization.hasTranslation(segment.textId)) {
        return prompt;
    }
    const textId = segment.textId;
    const sourceRuns = segment.rich ?? [];
    /**
     * The zero-width tokens a run tag can name, compiled once and re-used at every render.
     *
     * `Pause` is a value object and `TextEvent` carries its own fired-once guard keyed on the token
     * identity, so handing back the same instance is what makes a translated line replay the way the
     * source line does rather than re-firing on every re-render.
     */
    const tokensByRun = new Map<number, unknown>();
    for (let index = 0; index < sourceRuns.length; index += 1) {
        const run = sourceRuns[index];
        if ("pause" in run) {
            tokensByRun.set(index, run.pause === true ? new Pause() : Pause.wait(run.pause));
        } else if ("event" in run) {
            const event = eventMap?.get(run);
            if (event) {
                tokensByRun.set(index, event);
            }
        }
    }
    const resolveDynamic = () => {
        const target = localization.resolve(textId);
        if (target === null) {
            return prompt as never;
        }
        const out: unknown[] = [];
        for (const part of parseTranslatedRuns(target, sourceRuns)) {
            if (part.kind === "placeholder") {
                out.push(interpolationWords[part.index] ?? "");
                continue;
            }
            if (part.kind === "run") {
                const token = tokensByRun.get(part.runIndex);
                if (token) {
                    out.push(token);
                }
                continue;
            }
            const marks = part.runIndex === undefined
                ? undefined
                : (sourceRuns[part.runIndex] as { marks?: StoryTextMarks } | undefined)?.marks;
            out.push(buildWord(part.text, marks));
        }
        return out as never;
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
                if (image && Array.isArray(src) && !acceptsAppearanceTags(image)) {
                    // Same mismatch a `/face` row can hit, and the engine's answer is the same throw -
                    // here at reveal time rather than during construction. See {@link acceptsAppearanceTags}.
                    diagnostic(ctx, "warning", blockId, `Inline event: character "${characterId}" is on stage as a single image, so its appearance tags cannot change; expression skipped.`);
                } else if (image) {
                    return TextEvent.expression(image, src, sound ? { sound } : undefined);
                } else {
                    diagnostic(ctx, "warning", blockId, `Inline event: character "${characterId}" is not on stage (show it before this line; a character shown under a custom stage name cannot be targeted by an inline expression); expression skipped.`);
                }
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
        devtools: ctx.devtools,
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
        const envFor = buildExpressionEnv(ctx, expression.ast, blockId);
        if (!envFor) {
            return null;
        }
        // `toDisplayString`, not `String(...)`: a null variable renders as nothing rather than as the
        // word "null" in the middle of a line of dialogue.
        return applyInterpolationWordMarks(new Word((((scriptCtx: ScriptCtx) =>
            toDisplayString(evaluateStoryExpression(expression.ast, envFor(scriptCtx)))) as unknown) as any), marks);
    }
    const target = interp.target;
    if (target.scope === "scene") {
        const def = ctx.sceneVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "error", blockId, "Scene variable not found; interpolation skipped.");
            return null;
        }
        return applyInterpolationWordMarks(ctx.nlrScene.local.toWord(def.storageKey as any), marks);
    }
    if (target.scope === "saved") {
        const def = ctx.savedVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "error", blockId, "Saved variable not found; interpolation skipped.");
            return null;
        }
        return applyInterpolationWordMarks(ctx.savedPersistent.toWord(def.storageKey as any), marks);
    }
    // Persistent (app-level): a dynamic word reading the shared host snapshot synchronously,
    // falling back to the story-declared default while the host has never stored a value.
    if (!ctx.persistentKeys.has(target.variableId)) {
        diagnostic(ctx, "error", blockId, "Persistent variable not found; interpolation skipped.");
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
    const config = storyMarksToWordConfig(marks);
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
        return [recordStatement(ctx, ctx.nlrScene.setBackground(src as any, await createTransition(payload.transition, ctx, block.id) as any), block)];
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

    if (payload.action === "plugin") {
        // A marker emits nothing by itself. Its owner's compile pass has already read it out of the
        // scene prescan and attached whatever it wants around this block; `withPluginInjections`
        // splices that in for every block, so there is nothing to do here and nothing to warn about.
        // A marker whose plugin is absent therefore compiles to exactly nothing - the scene still
        // plays, minus the behaviour, and `ProjectDependencyService` is what says so out loud.
        return [];
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
            diagnostic(ctx, "error", block.id, `Displayable target not found: ${label}`);
            return [];
        }
        if (payload.operation === "bringToFront") {
            return [recordStatement(ctx, target.bringToFront(), block)];
        }
        const chain = await compileDisplayableOperation(target, payload.operation, payload.transform, ctx, block.id);
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

    if (payload.action === "camera") {
        return await compileCameraAction(ctx, block, payload);
    }

    return [];
}

/**
 * Restart one looping transform on a pre-posed element - the launch scene's half of
 * {@link StageSnapshotDisplayable.loop}.
 *
 * The same two calls a `loop` row compiles to, so a launch and a normal play reach the same stage.
 * An engine without the feature reports it once per element rather than throwing, exactly as the row
 * itself does.
 */
function compileSnapshotLoop(
    ctx: SceneCompileContext,
    element: any,
    ref: StoryTransformRef,
    blockId: string,
): NlrStatement | null {
    if (!supportsLoop(element, ctx, blockId)) {
        return null;
    }
    const loop = buildLoopTransform(ref, ctx, blockId);
    return loop ? element.loop(loop, loopOptions(ref)) : null;
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
 * Since v19 there is almost nothing here, and that is the point: the camera is a `Displayable`, its
 * row states the same prop bag every other subject's does, and the ONE emitter decides per prop what
 * may be eased. What is left is the zoom clamp - the engine does not floor it, and a zoom of 0 is not
 * a shot but a broken transform - and `reset`, which is a different engine call rather than a bag.
 */
async function compileCameraAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "camera" }>,
): Promise<NlrStatement[]> {
    const camera = ctx.nlrStory.camera;
    if (payload.operation === "reset") {
        // Ending a grade used to walk the picture through the colour wheel - blue, cyan, green, olive
        // on the way out of the moonlight look - because `resetCamera` packed `filter: "none"` into the
        // same transform as the pose and eased the two together.
        //
        // **That is fixed in the engine, not here** (narraleaf-react 0.29.0: `resetCamera` now drops
        // the filter in a zero-duration sequence and eases only the pose). Studio tried to paper over
        // it from this side twice - a zero-duration `clearFilter` emitted first, and a hand-built pose
        // transform carrying no `filter` prop - and neither worked, because both statements land in one
        // tick and the renderer sees a single style diff either way.
        //
        // It is also why `reset` survived the fold into the prop bag: "put the camera back" is this
        // call, and a bag of neutral values would put the filter and the pose in one transform again.
        const duration = Math.max(0, finiteOr(payload.durationMs, 0));
        return [recordStatement(ctx, camera.resetCamera(duration, parseStoryEasing(payload.easing) as any), block)];
    }
    if (payload.operation === "loop" || payload.operation === "stopLoop") {
        // The camera is a Displayable like any other subject, so its half of the loop is the same
        // two calls - see the displayable arm for why one is awaited and the other is not.
        if (!supportsLoop(camera, ctx, block.id)) {
            return [];
        }
        if (payload.operation === "stopLoop") {
            return [recordStatement(ctx, camera.stopLoop(transformOptions(timingOf(payload.transform))), block)];
        }
        const loop = buildLoopTransform(clampCameraTransform(payload.transform) ?? {}, ctx, block.id);
        return loop ? [recordStatement(ctx, camera.loop(loop, loopOptions(payload.transform)), block)] : [];
    }
    const transform = payload.transform;
    if (!transform) {
        // Every authoring path writes a ref, even an empty one, so a row without one states nothing
        // this Studio can read - and a camera row that compiles to no statement is invisible on
        // stage: the scene plays straight past it and the shot the author asked for never happens.
        diagnostic(ctx, "warning", block.id, "Camera row is missing its transform.");
        return [];
    }
    if (transform.mode === "animation") {
        // A whole keyframed shot rather than one settled pose, built by the same function `/transform`
        // uses - which also owns the missing-id / unknown-asset diagnostics. The ref's `durationMs` is
        // deliberately not read: the timing is in the keyframes, and honouring a `d=` beside them would
        // silently compete.
        const shot = createAnimationTransform(transform, ctx, block.id, "none");
        return shot ? [recordStatement(ctx, camera.transform(shot), block)] : [];
    }
    const chain = await emitTransformProps(camera, clampCameraTransform(transform), ctx, block.id);
    return chain === camera ? [] : [recordStatement(ctx, chain, block)];
}

/**
 * A named lens gesture, as the keyframes it plays.
 *
 * In, hold, out - and the last leg returns the channel to zero, so a gesture leaves no residue. A row
 * that wants the eyes to STAY shut writes `shutter=1`, which is a different instruction and reads
 * like one.
 *
 * The legs are handed to a `Transform` rather than chained as three calls because a browser
 * interpolates a keyframe list as one animation: three separate awaited statements would each settle
 * and restart, which is visible as a hitch at every joint.
 */
function cameraLensGesture(
    lens: NonNullable<StoryTransformProps["lens"]>,
    ctx: SceneCompileContext,
    blockId: string,
): Transform | null {
    const steps = resolveStoryCameraLensSteps(lens);
    if (!steps) {
        diagnostic(ctx, "warning", blockId, `Camera lens "${lens.preset}" is not a known effect.`);
        return null;
    }
    const sequences = steps.map(step => ({
        // `as any` below for the same reason the sway's is, and it is NOT about the engine version:
        // a step's `easing` is a plain string here while `Sequence` wants `EasingDefinition`, and
        // `storyTransformPropsToNlr` answers `Record<string, unknown>` because it serves every
        // subject. Raising the pin does not remove it; narrowing those two types would.
        props: storyTransformPropsToNlr(step.props),
        options: { duration: step.durationMs, ease: step.easing },
    }));
    return new Transform(sequences as any);
}

/**
 * The camera's one clamp, applied here rather than trusted from the payload.
 *
 * The engine floors nothing: `zoom: 0` compiles to `scale(0)` and the stage disappears, and a negative
 * one flips it inside out. Every other channel of the bag is already safe on any subject, so this is
 * the whole of what the camera adds - the 0.16.1 `darkness` defect that made this rule now lives in
 * the `filter` record's own clamps.
 */
function clampCameraTransform(transform: StoryTransformRef | undefined): StoryTransformRef | undefined {
    if (!transform?.to || transform.to.zoom === undefined) {
        return transform;
    }
    return { ...transform, to: { ...transform.to, zoom: Math.max(MIN_CAMERA_ZOOM, finiteOr(transform.to.zoom, 1)) } };
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
        diagnostic(ctx, "warning", block.id, `${characterDiagnosticName(ctx, payload)} is not drawn by a runtime, so it has no ${channel} to set.`);
        return statements;
    }

    // `enter` is the one character row that DECLARES the portrait; exit / move / expression address
    // the one an earlier row put on stage. Which is which is `declaresStageObject` - the single
    // table, read by project lint too, so a preview and a build cannot disagree about which rows may
    // build. Addressing a portrait nothing entered used to conjure a blank Image and then hide, move
    // or re-dress it, with nothing anywhere saying so; the character was the last kind still doing it.
    //
    // The lookup runs here, ahead of any appearance resolution, so a row with nothing to act on
    // reports that one fact rather than first complaining about a source it was never going to apply.
    const declares = declaresStageObject(payload);
    const staged = declares ? null : findStageCharacterImage(ctx, block.id, payload, name);
    if (!declares && !staged) {
        return statements;
    }

    if (payload.operation === "exit" && staged) {
        await bindCharacterPortrait(ctx, payload.characterId, staged);
        const chain = await compileDisplayableOperation(staged, "hide", payload.transform ?? { to: { opacity: 0 }, durationMs: 250 }, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
        return statements;
    }

    if (payload.operation === "move" && staged) {
        await bindCharacterPortrait(ctx, payload.characterId, staged);
        const chain = await compileDisplayableOperation(staged, "transform", payload.transform, ctx, block.id);
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
        const image = staged ?? getImage(ctx, name, { autoFit: true, src: layeredSrc as never });
        // An Image built from a single url has no tag groups, and the engine rejects the whole story
        // for a tag change aimed at one - during construction, so the player never starts and the row
        // that caused it is nowhere in the message. That mismatch means an earlier row put this
        // character on stage as a flat image (an `enter` with its own asset override, or an `/image`
        // row sharing the stage name), so the diagnostic names the row that cannot act.
        if (!acceptsAppearanceTags(image)) {
            diagnostic(ctx, "warning", block.id, `${characterDiagnosticName(ctx, payload)} is on stage as a single image, so its appearance tags cannot change here.`);
            return statements;
        }
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
            diagnostic(ctx, "warning", block.id, `Expression for ${characterDiagnosticName(ctx, payload)} selects no tag; nothing changes.`);
            return statements;
        }
        const chain = image.char(tags as never, await createTransition(payload.transition, ctx, block.id) as any);
        statements.push(recordStatement(ctx, chain, block));
        return statements;
    }

    const src = payload.assetId
        ? await resolveAsset(ctx, payload.assetId, "image", block.id)
        : await resolveCharacterImageUrl(ctx, payload.characterId, payload.pose, block.id);
    if (!src) {
        diagnostic(ctx, "warning", block.id, `Character image source not found for ${characterDiagnosticName(ctx, payload)}.`);
        return statements;
    }

    const image = staged ?? getImage(ctx, name, { autoFit: true, src });
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
    const sourceChain = image.char(src as any, await createTransition(payload.transition, ctx, block.id) as any);
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
    // The same split every other stage kind now makes, and here it is `enter` against everything
    // else: the box's own verbs (exit, move) and the four that reach INSIDE it alike address a box
    // an earlier row put on stage. Reaching inside one nothing entered built a puppet on the spot,
    // loaded its model and set a motion on an element that is never shown - a row that costs the
    // whole backend and produces no scene, reported by nothing.
    //
    // A row-precise launch is the one place a puppet arrives without an `enter` row of its own, and
    // it arrives wearing the wrong class: the stage snapshot has no notion of a puppet and files
    // every character as an image record, so the replay pre-poses this character as an `Image` and
    // the box is never restored. An `Image` under a puppet character's key can have come from
    // nowhere else - a compile of the rows sends a puppet character here on every operation and
    // never builds one - so it reads as "on stage, box not restorable" and the box is built.
    const preposed = stagedCharacterElement(ctx, name) instanceof Image;
    const puppet = declaresStageObject(payload) || preposed
        ? await getPuppetElement(ctx, name, appearance, block.id)
        : findStageCharacterPuppet(ctx, block.id, payload, name);
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
    const chain = await compileDisplayableOperation(puppet, operation, transform, ctx, block.id);
    return chain ? [recordStatement(ctx, chain, block)] : [];
}

/**
 * The scene's `Puppet` for a stage name, built by the row that declares it.
 *
 * Get-or-create on the same terms as {@link getImage}, and reached only from the path entitled to
 * create: a character `enter`. A row that merely addresses the puppet goes through
 * {@link findStageCharacterPuppet} and reports a miss instead.
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
    setStableElementId(ctx.elementIdBindings, puppet, `nl:puppet:${ctx.scene.id}:${key}`);
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
            ctx.soundAssetIds.delete(BGM_SOUND_NAME);
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
        ctx.soundAssetIds.set(BGM_SOUND_NAME, payload.assetId);
        return [recordStatement(
            ctx,
            ctx.nlrScene.setBackgroundMusic(sound, rowFadeMs(payload)),
            block,
            undefined,
            payload.assetId,
        )];
    }

    // `playSound` is the row that starts the handle and names it; the control family addresses one an
    // earlier row started, through the reference when the row carries one. The reserved music channel
    // resolves the same way - `{ builtin: "bgm" }` routes to the reserved key without a block to bind.
    //
    // `declaredName` is the key a `playSound` row registers under, and the binding a control row with
    // no reference falls back to. One shared rule, so no surface can key a sound differently.
    const declaredName = soundStageObjectName(payload);
    const declares = declaresStageObject(payload);
    const { name, label } = declares
        ? { name: declaredName, label: payload.objectName?.trim() || declaredName }
        : actionableActionTargetName(ctx, payload.target, "audio", declaredName);
    const sound = declares
        ? await getSound(ctx, name, payload.assetId, block.id, payload)
        : findPlayingSound(ctx, block.id, payload, name, label);
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
            // The only operation here that STARTS a clip, so the only one that binds an asset id.
            // Read back off the handle when the row named no file, which is the `/sound piano`
            // replay case.
            return [recordStatement(
                ctx,
                // Only a row that asked for it holds the script until the clip ends; see
                // `waitForEnd` on the payload.
                sound.play(fadeMs, { waitForEnd: payload.waitForEnd === true }),
                block,
                undefined,
                payload.assetId?.trim() || ctx.soundAssetIds.get(name),
            )];
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
    // `create` declares the image; every other op addresses one an earlier row declared, and a miss
    // is reported rather than filled in with a blank Image nothing on stage would show.
    const layer = resolveLayerForRef(ctx, payload.layer);
    const image = declaresStageObject(payload)
        ? getImage(ctx, payload.objectName, { autoFit: payload.autoFit, layer })
        : findStageImage(ctx, block.id, payload, layer);
    if (!image) {
        return [];
    }
    const statements: NlrStatement[] = [];
    const src = payload.assetId
        ? await resolveAsset(ctx, payload.assetId, "image", block.id)
        : payload.color;

    if ((payload.operation === "create" || payload.operation === "setSource") && src) {
        // A transition only on the swap. A create DECLARES - the object is mounted at opacity zero
        // and nothing is looking at it until a `/show` reveals it - so a transition here plays out
        // in full on an invisible element and changes nothing that reaches the player. The property
        // editor offers it on the swap alone for the same reason.
        const transition = payload.operation === "setSource"
            ? await createTransition(payload.transition, ctx, block.id)
            : undefined;
        statements.push(recordStatement(ctx, image.char(src as any, transition as any), block));
    } else if ((payload.operation === "create" || payload.operation === "setSource") && !src) {
        diagnostic(ctx, "warning", block.id, `Image "${payload.objectName}" has no asset or color source.`);
    }

    // A create row DECLARES: it names the object, gives it a source and puts it where it starts, and
    // nothing appears. `/show` is what reveals it. The pose still lands, so the object is already in
    // position when something shows it - a declaration says where a thing IS, not that it is seen.
    if (payload.operation === "show" || payload.operation === "hide" || payload.operation === "create") {
        const operation = payload.operation === "create" ? "transform" : payload.operation;
        const chain = await compileDisplayableOperation(image, operation, payload.transform, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
    }

    return statements;
}

async function compileTextAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "text" }>,
): Promise<NlrStatement[]> {
    // Same split as `/image`: `create` declares the text, the rest address one already on stage.
    const layer = resolveLayerForRef(ctx, payload.layer);
    const text = declaresStageObject(payload)
        ? getText(ctx, payload.objectName, {
            text: payload.text,
            fontSize: payload.fontSize,
            fontColor: payload.fontColor,
            layer,
        })
        : findStageText(ctx, block.id, payload, layer);
    if (!text) {
        return [];
    }
    const statements: NlrStatement[] = [];

    if ((payload.operation === "create" || payload.operation === "setText") && payload.text !== undefined) {
        statements.push(recordStatement(ctx, text.setText(payload.text), block));
    }
    if (payload.operation === "setFontSize" || (payload.operation === "create" && payload.fontSize !== undefined)) {
        statements.push(recordStatement(ctx, text.setFontSize(payload.fontSize ?? 16, payload.transform?.durationMs ?? 0, parseStoryEasing(payload.transform?.easing) as any), block));
    }
    if (payload.operation === "setFontColor" || (payload.operation === "create" && payload.fontColor)) {
        statements.push(recordStatement(ctx, text.setFontColor((payload.fontColor ?? "#ffffff") as any, payload.transform?.durationMs ?? 0, parseStoryEasing(payload.transform?.easing) as any), block));
    }
    // Declares, like `/image` create: the words, the size, the colour and the pose, all without
    // showing anything. See there.
    if (payload.operation === "show" || payload.operation === "hide" || payload.operation === "create") {
        const operation = payload.operation === "create" ? "transform" : payload.operation;
        const chain = await compileDisplayableOperation(text, operation, payload.transform, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
    }

    return statements;
}

async function compileLayerAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "layer" }>,
): Promise<NlrStatement[]> {
    // `create` names a new custom layer; every other op resolves an existing layer - a built-in
    // (background / displayable) or a custom one - via the target ref (falling back to the default
    // displayable layer), so a transform can now target the background instead of only named layers.
    const layer = declaresStageObject(payload)
        ? getLayer(ctx, payload.objectName, payload.zIndex)
        : findStageLayer(ctx, block.id, payload);
    if (!layer) {
        return [];
    }
    const statements: NlrStatement[] = [];
    if (payload.operation === "setZIndex" || (payload.operation === "create" && payload.zIndex !== undefined)) {
        statements.push(recordStatement(ctx, layer.setZIndex(payload.zIndex ?? 0), block));
    }
    if (payload.operation === "show" || payload.operation === "hide" || payload.operation === "transform") {
        const operation = payload.operation === "show" || payload.operation === "hide" ? payload.operation : "transform";
        const chain = await compileDisplayableOperation(layer, operation, payload.transform, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
    }
    return statements;
}

async function compileVideoAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "video" }>,
): Promise<NlrStatement[]> {
    // `create` builds the clip; the transport verbs address one an earlier row built.
    const video = declaresStageObject(payload)
        ? await getVideo(ctx, payload.objectName, payload.assetId, payload.muted, block.id)
        : findStageVideo(ctx, block.id, payload);
    if (!video) {
        return [];
    }
    if (payload.operation === "create") {
        // Declares rather than shows, like `/image`. `preload` is what makes that worth writing on
        // its own row: the element mounts hidden and starts buffering, so the `/show` or `/play`
        // that follows is not the first moment anything has been fetched.
        return [recordStatement(ctx, video.preload(), block)];
    }
    if (payload.operation === "show") {
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
 * ops, because a `Vfx` is an `Actionable`: it has `preload`/`show`/`hide`/`pause`/`resume`/
 * `setPlaybackRate` and nothing else.
 *
 * `create` DECLARES the overlay: it builds it, registers the name every later row addresses, and
 * preloads the clip without showing anything. That is the whole shape of the feature - an overlay is
 * defined once and then shown, hidden and shown again from anywhere in the story, and the definition
 * is a place rather than a moment. `show` is the only row that puts it on screen, and it may carry an
 * opacity and a rate for that showing alone.
 */
async function compileVfxAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "vfx" }>,
): Promise<NlrStatement[]> {
    const vfx = declaresStageObject(payload)
        ? await getVfx(ctx, payload, block.id)
        : findStageVfx(ctx, block.id, payload);
    if (!vfx) {
        return [];
    }
    const fade = { duration: Math.max(0, finiteOr(payload.durationMs, 0)), ease: parseStoryEasing(payload.easing) as any };
    switch (payload.operation) {
        case "create":
            return [recordStatement(ctx, vfx.preload(), block)];
        case "show":
            // Opacity and rate on a SHOW row are that showing's own - the same rain reading faintly
            // behind a memory and at full strength in the storm - so they are passed as options and
            // never written into the overlay. On a create row the very same two fields ARE the
            // overlay's configuration, which is why only this arm reads them as overrides.
            return [recordStatement(ctx, vfx.show({
                ...fade,
                ...(payload.opacity !== undefined ? { opacity: Math.min(1, Math.max(0, finiteOr(payload.opacity, 1))) } : {}),
                ...(payload.rate !== undefined ? { rate: Math.max(0, finiteOr(payload.rate, 1)) } : {}),
            } as any), block)];
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

/** Builds the overlay a `/vfx create` row declares; every other verb looks up instead. */
async function getVfx(
    ctx: SceneCompileContext,
    payload: Extract<StoryActionPayload, { action: "vfx" }>,
    blockId: string,
): Promise<Vfx | null> {
    const name = normalizeObjectName(payload.objectName);
    const existing = ctx.vfx.get(name);
    // What this row asks to play, whichever kind of source it names. Both arms answer the same
    // question - "is this the same ambience as the row that made the overlay?" - so they share one
    // identity rather than two parallel checks that could disagree.
    const source = payload.seed ? `seed:${weatherRefIdentity(payload.seed)}` : payload.assetId;
    if (existing) {
        // A create row for a name that already has an overlay is the author setting the same
        // ambience up twice - fine, and it addresses the one overlay. Naming a DIFFERENT clip is
        // two answers to one question, and it is reported rather than resolved: silently keeping
        // the first would leave a row whose clip never plays and nothing to say why.
        if (payload.operation === "create" && source && ctx.vfxAssetIds.get(name) !== source) {
            diagnostic(ctx, "warning", blockId, `Ambience effect "${name}" already plays a different clip; this row reuses the first one.`);
        }
        return existing;
    }
    if (!source) {
        diagnostic(ctx, "warning", blockId, `Ambience effect "${name}" has no clip.`);
        return null;
    }
    const url = payload.seed
        ? await resolveWeatherClip(ctx, payload.seed, name, blockId)
        : await resolveAsset(ctx, payload.assetId!, "video", blockId);
    if (!url) {
        return null;
    }
    const vfx = new Vfx({
        src: url,
        // A seed's clip is lit particles on black, and it has exactly one correct compositing route:
        // `screen`, which drops the black and keeps the light. It is not the author's choice because
        // there is no alternative to choose - WebKit discards a WebM's alpha, so the clip cannot be
        // transparent, and `normal` would cover the stage with a black rectangle. An imported clip
        // still declares its own route, because only the author knows how theirs was rendered.
        ...(payload.seed ? { blendMode: "screen" as const } : payload.blendMode ? { blendMode: payload.blendMode } : {}),
        ...(payload.opacity !== undefined ? { opacity: Math.min(1, Math.max(0, finiteOr(payload.opacity, 1))) } : {}),
        ...(payload.loop !== undefined ? { loop: payload.loop } : {}),
        ...(payload.fit ? { fit: payload.fit } : {}),
        ...(payload.zIndex !== undefined ? { zIndex: payload.zIndex } : {}),
        // A rate on the CREATE row is the loop's resting speed - and the only one that survives a save,
        // since the engine does not persist a runtime `setPlaybackRate`.
        ...(payload.rate !== undefined ? { playbackRate: Math.max(0, finiteOr(payload.rate, 1)) } : {}),
    });
    // No scene in the id, unlike every other element: this overlay does not belong to one. Naming
    // it after the scene that happened to create it first would also make the anchor depend on
    // scene ORDER, so reordering scenes would move it under a save that referenced it.
    setStableElementId(ctx.elementIdBindings, vfx, `nl:vfx:${name}`);
    ctx.vfx.set(name, vfx);
    ctx.vfxAssetIds.set(name, source);
    return vfx;
}

/**
 * One choice option's prompt, carrying its voice unit id when a take exists for it.
 *
 * The engine's menu never speaks an option, so the id travels as sentence metadata rather than as
 * `voiceId`: `Sentence.getMetadata()` is the one published read of it, and the choice slot surface
 * is what turns it into audible playback (`Play Choice Voice`). Metadata is runtime-only and is not
 * written to a save, which is the right lifetime - the id is recomputed by every compile.
 *
 * An unvoiced option stays a bare prompt, exactly as every option was before this existed, so the
 * `Sentence` wrapper only appears where it carries something.
 */
function choiceOptionPrompt(ctx: SceneCompileContext, segment: StoryTextSegment, blockId: string): unknown {
    if (!segment.value && !segmentHasInterpolation(segment)) {
        return "Option";
    }
    const prompt = buildLocalizedSentencePrompt(ctx, segment, blockId);
    const voiceConfig = voiceConfigForLine(ctx, segment.textId);
    return voiceConfig
        ? new Sentence(prompt as any, { metadata: { voiceId: voiceConfig.voiceId } })
        : prompt;
}

/**
 * The URL for a weather seed's clip, or null with a diagnostic saying why there is none.
 *
 * Refused rather than guessed at. A `Vfx` REQUIRES a source - the engine throws on one without -
 * so a compile that could not produce the clip has to leave the overlay out and say so, which is a
 * scene that plays without weather rather than a runtime that will not start.
 */
async function resolveWeatherClip(
    ctx: SceneCompileContext,
    ref: WeatherSeedRef,
    name: string,
    blockId: string,
): Promise<string | null> {
    if (!ctx.resolveWeatherClip) {
        // The host asked for a graph rather than something playable (save anchors, the content
        // audit). Said out loud so a compile that quietly lost an overlay is never mistaken for one
        // that never had it.
        diagnostic(ctx, "warning", blockId, `Ambience effect "${name}" needs its weather produced, which this compile cannot do.`);
        return null;
    }
    const url = await ctx.resolveWeatherClip(ref);
    if (!url) {
        diagnostic(ctx, "warning", blockId, `Weather for ambience effect "${name}" could not be produced.`);
        return null;
    }
    return url;
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
            prompt: choiceOptionPrompt(ctx, optionSegment, option.id),
            // The pick is recorded at the head of the option's OWN branch, which is the one place
            // that runs if and only if the player chose this option. Recording anywhere else (with
            // the menu, or via the engine's text-read record) would count an option the player only
            // ever looked at - and "did they pick it" is the entire reason this record exists.
            // It goes ahead of the option's authored rows so a `goto` in the first row cannot skip
            // past it, and it survives an empty option (the branch is then just this one statement).
            action: [
                markStoryVisitedStatement(ctx.visitedPersistent, STORY_VISITED_OPTIONS_KEY, option.id),
                ...await compileBlockList(ctx, option.childrenIds),
            ] as any,
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

/**
 * `/ending <name>` - the story reached one of its endings.
 *
 * One statement, and it only tells the host. What follows from an ending - recording it so a gallery
 * can ask, telling the plugins, and putting the player on a page - has to happen in one order and in
 * one place, and that place is the host: it owns the persistence that outlives the save, the plugin
 * event hub, and the session it is about to tear down.
 *
 * **Nothing here stops the engine, because the engine has no way to be stopped.** Its own ending is
 * the action stack running dry, and `Control.sleep` cannot stand in for one: a player who is
 * fast-forwarding skips straight through it (`ControlAction`'s sleep resolves immediately while
 * `isFastForwarding`). Three things cover the gap instead, in the order they apply: the rows written
 * after an ending in the SAME list are dropped at compile time (see {@link compileBlockList}), so
 * the ordinary shape - an ending as the last row of a branch - has nothing left to play; a host with
 * a page to show tears the session down; and rows further out, which neither of those reaches, are
 * reported by `story/ending-not-last` as the authoring mistake they are.
 */
function compileEnding(
    ctx: SceneCompileContext,
    block: Extract<StoryBlock, { kind: "control" }>,
    payload: Extract<StoryControlPayload, { control: "ending" }>,
): NlrStatement[] {
    const notify = ctx.onEndingReached;
    if (!notify) {
        return [];
    }
    // Built once, at compile time, and frozen into the closure: the row cannot change under a
    // running game, and reading it out here keeps the statement free of the document.
    const reached: StoryEndingReach = {
        endingId: block.id,
        name: payload.name.trim(),
        ...(payload.page ? { page: payload.page } : {}),
    };
    return [recordStatement(ctx, Script.execute(() => {
        notify(reached);
    }), block)];
}

/**
 * `/quit <page>` - this run is over; the player gets a page.
 *
 * The same shape as {@link compileEnding} and for the same reasons: one statement that only tells
 * the host, because tearing a session down and putting a page on screen is the host's job and has
 * exactly one implementation there. Nothing here stops the engine either - the rows after this one
 * in the same list are dropped by {@link compileBlockList}, and rows further out are reported by
 * `story/rows-after-ending`.
 *
 * A row with no page compiles to nothing rather than to a quit with nowhere to go: it is an
 * unfinished row, `story/quit-page-missing` says so in the editor, and running it would take the
 * story away and leave the player on a frame with nothing to touch.
 */
function compileQuit(
    ctx: SceneCompileContext,
    block: Extract<StoryBlock, { kind: "control" }>,
    payload: Extract<StoryControlPayload, { control: "quit" }>,
): NlrStatement[] {
    const notify = ctx.onQuitToPage;
    const surfaceId = payload.surfaceId.trim();
    if (!notify || !surfaceId) {
        return [];
    }
    return [recordStatement(ctx, Script.execute(() => {
        notify(surfaceId);
    }), block)];
}

/**
 * `/break` - leave the innermost `repeat`.
 *
 * Faulted here rather than left to the engine when there is no loop above it. NLR's `breakLoop`
 * outside a loop is a play-time error, which for a stray row means the author finds out on the
 * player's screen; an `error` diagnostic finds them in the editor and refuses the production build.
 */
function compileBreak(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "control" }>): NlrStatement[] {
    let parentId = block.parentId;
    let insideLoop = false;
    while (parentId) {
        const parent = ctx.scene.blocks[parentId];
        if (!parent) {
            break;
        }
        if (parent.kind === "control" && parent.payload.control === "repeat") {
            insideLoop = true;
            break;
        }
        parentId = parent.parentId;
    }
    if (!insideLoop) {
        diagnostic(ctx, "error", block.id, "Break is not inside a repeat group; there is no loop for it to leave.");
        return [];
    }
    return [recordStatement(ctx, Control.breakLoop(), block)];
}

/**
 * The ceiling an `until` loop is allowed to reach before it is cut off.
 *
 * A conditional loop needs one, and this language in particular. The expression language has no side
 * effects a *condition* can produce, so a condition over variables the body never assigns is not a
 * slow loop - it is an exactly-never-terminating one, with no error, no frame, and no way for the
 * player to tell the game from a hang. Ten thousand iterations of a body that draws nothing costs
 * milliseconds, and any real loop that legitimately wants more of them is a script, not a scene.
 */
export const STORY_WHILE_LOOP_MAX_ITERATIONS = 10000;

/**
 * The engine-facing lambda for a `/repeat until` group.
 *
 * Two inversions live here and both are easy to read past:
 *
 *  1. **The negation.** `until` is a STOP condition ("go round again until the door opens"), and
 *     `Control.whileLoop` takes a CONTINUE condition. So the value handed to the engine is `!until`.
 *     Written as an explicit `=== false`-style negation rather than folded into the condition builder,
 *     because `conditionToLambda` is shared with `/if` and the branch there must NOT be inverted.
 *  2. **The counter resets on exit, not on entry.** There is no "loop entered" hook - the condition
 *     lambda is all we get - so the tally is cleared at the moment it answers "stop". A loop nested
 *     inside another therefore starts fresh on every outer pass, instead of spending one shared
 *     budget across all of them and cutting later passes short.
 */
function whileLoopCondition(until: (scriptCtx: ScriptCtx) => boolean, blockId: string): NlrCondition {
    let iterations = 0;
    return (scriptCtx: ScriptCtx) => {
        if (iterations >= STORY_WHILE_LOOP_MAX_ITERATIONS) {
            // Runtime, not compile time: the diagnostics array was handed back to the caller long ago,
            // and nothing about the document says this loop will spin. The console is where a Dev Mode
            // session reads it.
            console.warn(
                `[storyCompiler] Repeat-until loop (block ${blockId}) stopped after ${STORY_WHILE_LOOP_MAX_ITERATIONS} iterations; its condition never became true.`,
            );
            iterations = 0;
            return false;
        }
        if (until(scriptCtx)) {
            iterations = 0;
            return false;
        }
        iterations += 1;
        return true;
    };
}

/**
 * Whether this row is a `/jump <scene> return` that is actually in the build.
 *
 * The one row whose actions have to stay together, and {@link compileUnchainedGroupBody} is the only
 * reader. A disabled row compiles to nothing, so it is not one.
 */
function isReturnableJump(block: StoryBlock | undefined): block is Extract<StoryBlock, { kind: "jump" }> {
    return Boolean(block && !block.disabled && block.kind === "jump" && block.payload.returnable);
}

/**
 * Compile a group's rows for a body the engine stores UNCHAINED, folding a returnable jump into a
 * branch of its own.
 *
 * `Control.all`, `any`, `allAsync`, `repeat` and `whileLoop` hand the engine a flat array and start
 * one concurrent branch per action in it, where `Control.do` and `doAsync` link theirs into a single
 * run. The difference is invisible for a row that compiles to one action, and fatal for the one row
 * that does not. A returnable jump is three actions - the `control:do` that enters the target,
 * `scene:callTo`, and the `scene:resume` linked behind it that IS the call's return address - so
 * spread across three branches the call has nothing behind it and the engine stops the game with
 * "A scene call has no return address."
 *
 * Wrapping that row's actions in a `Control.do` puts the three back into one branch, which the call
 * can read its return address out of again. Only that row is wrapped: every other row that compiles
 * to several actions is *meant* to be several branches here, and stories written against that shape
 * would play differently if it changed. The wrapper carries no link of its own, which the engine
 * requires of anything it is handed as a branch (`ControlAction.checkActionChain`).
 *
 * A compile pass's injections around that row go inside the wrapper with it, because they are what
 * the pass asked for: "before this happens" and "after this has happened" is a run, not three things
 * racing. Injections around any other row are untouched.
 */
async function compileUnchainedGroupBody(ctx: SceneCompileContext, blockIds: readonly string[]): Promise<NlrStatement[]> {
    const statements: NlrStatement[] = [];
    for (const blockId of blockIds) {
        const block = ctx.scene.blocks[blockId];
        const compiled = await compileBlock(ctx, blockId);
        if (compiled.length > 0 && isReturnableJump(block)) {
            // Recorded against the jump's own row, after the actions that row already emitted. An
            // action id is numbered within its row alone, so the wrapper takes the next number in
            // that row's own run and no other row's ids move.
            statements.push(recordStatement(ctx, Control.do(compiled as any), block));
        } else {
            statements.push(...compiled);
        }
        // The same stop `compileBlockList` makes: nothing written after an `/ending` row plays.
        if (endsPlayback(block)) {
            break;
        }
    }
    return statements;
}

async function compileControlGroup(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "control" }>): Promise<NlrStatement[]> {
    const payload = block.payload as Extract<StoryControlPayload, { control: "sequence" | "parallel" | "race" | "repeat" }>;
    const mode = payload.mode ?? (payload.control === "parallel" ? "all" : payload.control === "race" ? "any" : "do");
    // Which of the two body shapes below this group hands the engine. `repeat` is decided by the row
    // and not by `mode`, in its counted form and in its `until` form alike, so it is tested first -
    // a stale `mode` on a repeat row never reaches the call.
    const unchainedBody = payload.control === "repeat" || mode === "all" || mode === "allAsync" || mode === "any";
    const children = unchainedBody
        ? await compileUnchainedGroupBody(ctx, block.childrenIds)
        : await compileBlockList(ctx, block.childrenIds);
    // `until` selects the conditional form. A group that carries one is never a counted repeat, even
    // if a stale `times` rode along - the schema calls them mutually exclusive and this is where it
    // has to be true.
    if (payload.control === "repeat" && payload.until) {
        const until = conditionToLambda(ctx, payload.until, block.id);
        // `falseCondition` is the single value every unresolvable arm of `conditionToLambda` returns,
        // so the identity check is exact. It matters here far more than it does for `/if`: a branch
        // that tests false is a branch that does not run, while a STOP condition that can never
        // become true is a loop that never ends. Refusing to emit the group is the only answer that
        // is not "spin until the ceiling catches you".
        if (!until || until === falseCondition) {
            diagnostic(ctx, "error", block.id, "Repeat-until loop has no usable condition; the group was skipped.");
            return [];
        }
        // The `Lambda` arm of `NlrCondition` is an empty class - structurally `{}`, so it neither
        // narrows nor excludes anything - and no arm of `conditionToLambda` ever produces one. The
        // assertion says that, rather than letting the vestigial arm block the call.
        const untilFn = until as (scriptCtx: ScriptCtx) => boolean;
        return [recordStatement(ctx, Control.whileLoop(whileLoopCondition(untilFn, block.id) as any, children as any), block)];
    }
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
    const chain = ctx.nlrScene.nvl(transformOptions(timingOf(block.payload.transition)) as any, children as any);
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
        setStableElementId(ctx.elementIdBindings, created, `nl:character:${key}`);
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
    setStableElementId(ctx.elementIdBindings, character, `nl:character:${normalizedId}`);
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
 * The summary carries the value exactly as the project stored it — `characterSummaries.ts` trims and
 * forwards, and it is right not to judge — so a `nlbrand:` link at the project palette arrives here
 * intact and is resolved against the live palette first. This module is compiled into both hosts and
 * each publishes its own palette (`BrandService` in the editor, the pack in the shipped game), so
 * the one summary yields the one colour on either side. Resolving before the test rather than
 * teaching the test about links is deliberate: `CHARACTER_ACCENT_HEX` answers "is this a hex a CSS
 * declaration can take", and that question has one answer.
 *
 * The hex is validated, though — a malformed value would land in a CSS declaration. So would a link
 * the palette cannot resolve, or one that lands on a translucent entry; both fail the test and leave
 * the nametag untinted, which is what every other unusable accent has always done.
 */
function characterNametagConfig(summary: DevModeCharacterSummary | undefined): { color: `#${string}` } | undefined {
    const hex = resolveBrandColorValue(summary?.color);
    return hex && CHARACTER_ACCENT_HEX.test(hex) ? { color: hex as `#${string}` } : undefined;
}

/**
 * `src` is either a url/colour or a layered definition — the engine takes both, and a layered
 * character's stack has to reach the constructor because an Image's src shape is fixed there. What
 * a later row changes is the tags, never the src.
 *
 * Get-or-create, and reached only by the paths that are entitled to create: an `/image create` row,
 * a character `enter` row, and the snapshot replay that seeds a mid-scene launch with the stage as
 * it already stood. A row that merely ADDRESSES an image goes through {@link findStageImage} - or
 * {@link findStageCharacterImage} for a portrait - and reports a miss instead.
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
    setStableElementId(ctx.elementIdBindings, image, `nl:image:${ctx.scene.id}:${name}`);
    ctx.images.set(name, image);
    return image;
}

/**
 * Whether an Image can take a tag change (`char([...])`) at all.
 *
 * The engine normalizes a tag or layered definition into a src object and leaves `config.src` null
 * for a plain url or colour, so this is the same question it asks - and it has to be asked before a
 * tag change is compiled, because the engine's own answer is thrown while the story is being
 * constructed, which takes the whole player down rather than reporting a row.
 */
function acceptsAppearanceTags(image: Image): boolean {
    return (image as unknown as { config?: { src?: unknown } }).config?.src != null;
}

/** Get-or-create, on the same terms as {@link getImage}: `/text create` rows and snapshot replay. */
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
    setStableElementId(ctx.elementIdBindings, text, `nl:text:${ctx.scene.id}:${name}`);
    ctx.texts.set(name, text);
    return text;
}

/**
 * Get-or-create, on the same terms as {@link getImage}: `/layer create` rows, snapshot replay, and
 * PLACEMENT - an image or text can name the layer it sits on before the row declaring that layer has
 * compiled, and dropping it on the default layer instead would silently restack the scene. A `/layer`
 * row that addresses an existing layer goes through {@link findStageLayer}.
 */
function getLayer(ctx: SceneCompileContext, objectName: string, zIndex = 0, initialProps?: Record<string, unknown>): Layer {
    const name = normalizeObjectName(objectName);
    const existing = ctx.layers.get(name);
    if (existing) {
        return existing;
    }
    const layer = new Layer(name, { zIndex, ...(initialProps ?? {}) } as any);
    setStableElementId(ctx.elementIdBindings, layer, `nl:layer:${ctx.scene.id}:${name}`);
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

/** Builds the clip a `/video create` row declares; the transport verbs look up instead. */
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
    setStableElementId(ctx.elementIdBindings, video, `nl:video:${ctx.scene.id}:${name}`);
    ctx.videos.set(name, video);
    return video;
}

/**
 * The named sound handle a `playSound` row starts, reused when an earlier row already started one
 * under the same name. Only that operation reaches here - the control family looks up instead, see
 * {@link findPlayingSound} - so this is where a handle comes into existence and nowhere else.
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
        // The music channel's own "nothing to address yet" reading lives on the control path now,
        // where the rows that ask for it are; a `/sound` row with no clip is just a row with no clip.
        diagnostic(ctx, "warning", blockId, `Sound "${name}" has no asset.`);
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
    ctx.soundAssetIds.set(name, assetId);
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
    // A character is one element or the other, never both, so the lookup simply tries each - the same
    // one a character row makes, so `/show alice` and `/face alice` cannot find different answers.
    if (kind === "character") return stagedCharacterElement(ctx, normalized);
    return null;
}

// ---------------------------------------------------------------------------------------------
// Addressing an object that is already on stage
// ---------------------------------------------------------------------------------------------
//
// A row either DECLARES a stage object or ADDRESSES one. The declaring ops (`create`, `playSound`,
// a character `enter`) build through the `get*` constructors above; every other op resolves through
// this section, which only ever looks up. The two were one thing until now - `getImage`/`getText`/
// `getLayer` are get-or-create - so a `/show poster` with no `poster` anywhere in the scene built a
// blank Image, showed nothing, and reported nothing. It is the reference identity landing that makes
// the split possible: a row can now say WHICH row declared the object it means, so failing to find
// that object is a fact about the document rather than an artefact of how it was spelled.
//
// Which op falls on which side is `declaresStageObject`, and how a reference resolves to a key is
// `displayableStageRefName` / `actionableStageRefName` - all three in
// `@shared/types/story/stageObjects`, because project lint asks the same questions of the same rows
// and refuses a build on its answer. The dispatch below reads that table rather than restating it.

/**
 * The stage key + author-facing label a non-`create` displayable row addresses. `name` is the key to
 * look up and `label` the only half safe to print - a character's stage key is its `characterId`,
 * which is a UUID.
 *
 * The rule itself is `displayableStageRefName` in `@shared/types/story/stageObjects`, and this is a
 * caller rather than the owner. Project lint asks the same question of the same rows and its answer
 * stops a build, so a second copy of "what does this row address" is a copy that will one day let a
 * preview error through a release, or refuse a release a preview was happy with.
 */
function displayableActionTargetName(
    ctx: SceneCompileContext,
    target: StoryDisplayableTargetRef | undefined,
    objectName: string,
): { name: string; label: string } {
    return displayableStageRefName(ctx.scene, target, objectName);
}

/**
 * The `Actionable` counterpart of {@link displayableActionTargetName} - a clip, an ambience overlay,
 * a sound handle. Same rule, same shared home, and same reason for it; the `kind` is passed because
 * the reference does not carry one (the row's own `action` states it) and resolution checks it
 * rather than assuming.
 */
function actionableActionTargetName(
    ctx: SceneCompileContext,
    target: StoryActionableTargetRef | undefined,
    kind: StoryActionableKind,
    objectName: string,
): { name: string; label: string } {
    return actionableStageRefName(ctx.scene, target, kind, objectName);
}

/**
 * The one diagnostic for a row that acts on a stage object no earlier row put there.
 *
 * `error`, not `warning`: the row compiles to nothing at all and the stage is missing the thing the
 * author wrote the row to move, swap or hide, which is as far from the expected scene as a row can
 * land. The alternative was what stood here before - a blank object conjured on the spot, a scene
 * that plays through with an empty stage, and nothing anywhere saying why.
 *
 * The LABEL is printed, never the stage key: a character keys on its `characterId` and an unnamed
 * sound on its `assetId`, and neither is a word an author would recognise.
 *
 * A diagnostic does not stop a build - it reaches the Story console during a preview. The same miss
 * is reported again by the project lint's `story/stage-object-missing`, which does, and both read
 * the one judgement in `@shared/types/story/stageObjects`.
 *
 * Half the value of the sentence is the remedy, so the closing clause follows what the row acts on.
 * Nothing in Studio CREATES a character: an author brings one on stage, and a message telling them
 * to create it names a step they will not find. One shape with one varying clause, so the two
 * remedies cannot grow into two messages.
 */
function reportMissingStageObject(
    ctx: SceneCompileContext,
    blockId: string,
    noun: string,
    label: string,
    remedy: "create" | "enter" = "create",
): void {
    const clause = remedy === "enter"
        ? "an earlier row has to bring it on stage"
        : "an earlier row has to create it";
    diagnostic(ctx, "error", blockId, `${noun} "${label}" is not on stage; ${clause}.`);
}

/**
 * The image a non-`create` `/image` row acts on, or null with the miss already reported.
 *
 * A `layer` on such a row moves the object onto it, which is what passing the layer through
 * `getImage` did for an object it found rather than built.
 */
function findStageImage(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "image" }>,
    layer: Layer | undefined,
): Image | null {
    const { name, label } = displayableActionTargetName(ctx, payload.target, payload.objectName);
    const existing = ctx.images.get(name);
    if (existing) {
        if (layer) {
            existing.useLayer(layer);
        }
        return existing;
    }
    reportMissingStageObject(ctx, blockId, "Image", label);
    return null;
}

/**
 * Whatever already answers to a character's stage name, in either table.
 *
 * **Both**, because a character is an `Image` or a `Puppet` and never both, and which one it is
 * follows from the character's profile rather than from the row - exactly the reason
 * {@link getDisplayable} searches both on its `character` arm. A lookup that read only the image
 * table would report every row on an entered puppet character as addressing nothing.
 */
function stagedCharacterElement(ctx: SceneCompileContext, objectName: string): Image | Puppet | null {
    const name = normalizeObjectName(objectName);
    return ctx.images.get(name) ?? ctx.puppets.get(name) ?? null;
}

/**
 * The portrait a non-`enter` character row acts on, or null with the miss already reported.
 *
 * The LABEL is printed and never the stage key: a character with no stage name of its own keys on
 * its `characterId`, which is a UUID. {@link characterDiagnosticName} is the same ladder every other
 * character diagnostic climbs - the author's name for the character, then a stage name they typed.
 */
function findStageCharacterImage(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "character" }>,
    objectName: string,
): Image | null {
    const existing = stagedCharacterElement(ctx, objectName);
    if (existing instanceof Image) {
        return existing;
    }
    reportMissingStageObject(ctx, blockId, "Character", characterDiagnosticName(ctx, payload), "enter");
    return null;
}

/** The puppet a non-`enter` row on a puppet character acts on. Same rule as {@link findStageCharacterImage}. */
function findStageCharacterPuppet(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "character" }>,
    objectName: string,
): Puppet | null {
    const existing = stagedCharacterElement(ctx, objectName);
    if (existing instanceof Puppet) {
        return existing;
    }
    reportMissingStageObject(ctx, blockId, "Character", characterDiagnosticName(ctx, payload), "enter");
    return null;
}

/** The text a non-`create` `/text` row acts on. Same rule as {@link findStageImage}. */
function findStageText(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "text" }>,
    layer: Layer | undefined,
): Text | null {
    const { name, label } = displayableActionTargetName(ctx, payload.target, payload.objectName);
    const existing = ctx.texts.get(name);
    if (existing) {
        if (layer) {
            existing.useLayer(layer);
        }
        return existing;
    }
    reportMissingStageObject(ctx, blockId, "Text", label);
    return null;
}

/**
 * The layer a non-`create` `/layer` row acts on.
 *
 * The two built-in layers are in every scene, so a row addressing one - or a row naming no target at
 * all, which means the scene's default - always resolves. Only a custom layer can be missing, and it
 * is the one displayable kind the engine will not conjure from a mention, so a row that addresses
 * one no `create` row declared has never had anything to act on.
 */
function findStageLayer(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "layer" }>,
): Layer | null {
    const resolved = resolveStoryLayerRef(ctx.scene, layerActionTargetRef(payload.target, payload.objectName));
    if (resolved.kind === "default") {
        return resolved.layer === "background" ? ctx.nlrScene.backgroundLayer : ctx.nlrScene.displayableLayer;
    }
    const name = normalizeObjectName(resolved.name);
    const existing = ctx.layers.get(name);
    if (existing) {
        return existing;
    }
    reportMissingStageObject(ctx, blockId, "Layer", resolved.name || name);
    return null;
}

/** The clip a non-`create` `/video` row addresses. */
function findStageVideo(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "video" }>,
): Video | null {
    const { name, label } = actionableActionTargetName(ctx, payload.target, "video", payload.objectName);
    const existing = ctx.videos.get(name);
    if (existing) {
        return existing;
    }
    reportMissingStageObject(ctx, blockId, "Video", label);
    return null;
}

/** The ambience overlay a non-`create` `/vfx` row addresses. */
function findStageVfx(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "vfx" }>,
): Vfx | null {
    const { name, label } = actionableActionTargetName(ctx, payload.target, "vfx", payload.objectName);
    const existing = ctx.vfx.get(name);
    if (existing) {
        return existing;
    }
    reportMissingStageObject(ctx, blockId, "Ambience effect", label);
    return null;
}

/**
 * The sound handle a control row addresses (`/vol`, `/stop`, `/seek` and the rest of the family).
 *
 * The reserved music channel is deliberately NOT an error. It is the one handle that outlives the
 * scene that starts it - a `/bgm` in scene 1 is still playing in scene 2, and the launch compile
 * seeds it into this table for exactly that reason - so this compile genuinely cannot tell an
 * unreachable row from music set somewhere it cannot see. That is the long-standing warning, kept
 * word for word; every other name belongs to a `playSound` row in THIS scene, and its absence is a
 * fact rather than a guess.
 */
function findPlayingSound(
    ctx: SceneCompileContext,
    blockId: string,
    payload: Extract<StoryActionPayload, { action: "audio" }>,
    name: string,
    label: string,
): Sound | null {
    const existing = ctx.sounds.get(name);
    if (existing) {
        reportTrackConflict(ctx, blockId, payload, name);
        return existing;
    }
    if (name === BGM_SOUND_NAME) {
        diagnostic(ctx, "warning", blockId, "No background music is set before this row; /bgm has to run first.");
        return null;
    }
    diagnostic(ctx, "error", blockId, `Sound "${label}" is not playing; an earlier /sound row has to start it.`);
    return null;
}

type DisplayablePayload = Extract<StoryActionPayload, { action: "displayable" }>;

/**
 * The timing vocabulary, whole. `CommonTransformProps` is duration / ease / delay / at and
 * `TransformConfig` adds repeat / repeatDelay; Studio passed the first two and nothing else for
 * years, though the engine has always taken all of them.
 */
type TransformTiming = {
    durationMs?: number;
    easing?: string;
    delayMs?: number;
    repeat?: number;
    repeatDelayMs?: number;
    repeatType?: StoryTransformRef["repeatType"];
};

function timingOf(ref: StoryTransformRef | undefined): TransformTiming {
    return {
        durationMs: ref?.durationMs,
        easing: ref?.easing,
        delayMs: ref?.delayMs,
        repeat: ref?.repeat,
        repeatDelayMs: ref?.repeatDelayMs,
        repeatType: ref?.repeatType,
    };
}

/** The engine's `Partial<CommonTransformProps>` - what every chained call and every Transform takes. */
function transformOptions(timing: TransformTiming | undefined): Record<string, unknown> {
    const options: Record<string, unknown> = { duration: Math.max(0, timing?.durationMs ?? 0) };
    if (timing?.easing) {
        options.ease = parseStoryEasing(timing.easing);
    }
    if (timing?.delayMs !== undefined) {
        options.delay = Math.max(0, timing.delayMs);
    }
    return options;
}

/** A Transform over one prop bag, carrying repeat only when a row asked for it. */
function buildTransform(props: Record<string, unknown>, timing: TransformTiming | undefined): Transform {
    const options = transformOptions(timing);
    if (timing?.repeat === undefined && timing?.repeatDelayMs === undefined && timing?.repeatType === undefined) {
        return new Transform(props as any, options as any);
    }
    return new Transform([{ props, options }] as any, {
        repeat: timing.repeat,
        repeatDelay: timing.repeatDelayMs,
        repeatType: timing.repeatType,
    } as any);
}

/**
 * A looping transform: one Transform, and it must be ONE, because `Displayable.loop` takes a single
 * one rather than a chain.
 *
 * That is the whole difference from {@link emitTransformProps}, and it is what decides the loop's
 * vocabulary. The settled emitter may produce two statements - a discrete half that snaps and an
 * eased half that moves - plus separate calls for a mask (which registers a preload) and for the clip
 * generators. None of those can ride inside one Transform, so a loop carries the eased half and this
 * reports the rest rather than storing a channel that would never move.
 *
 * `from` becomes a zero-duration first step, which is exactly what a two-ended loop is: snap to the
 * trough, ease to the peak, repeat. With `repeatType: "mirror"` that is a breath.
 */
function buildLoopTransform(
    ref: StoryTransformRef,
    ctx: SceneCompileContext,
    blockId: string,
): Transform | null {
    if (ref.mode === "animation") {
        // A Story Motion is already a whole keyframed shot; looping one is the shot repeating, and
        // the engine takes any Transform. Its own timing lives in its keyframes.
        return createAnimationTransform(ref, ctx, blockId, "none");
    }
    if (ref.clipReveal) {
        diagnostic(ctx, "warning", blockId, "A looping transform cannot carry a clip reveal; the reveal is ignored.");
    }
    const to = foldStoryTransformLook(ref.to, resolveStoryCameraLook, preset =>
        diagnostic(ctx, "warning", blockId, `Camera look "${preset}" is not a known grade.`));
    const { cut, tween } = splitStoryTransformChange(ref.from, to);
    if (!isEmptyStoryTransformProps(cut)) {
        // Named, not swallowed: these are the channels that cannot be interpolated (a mask, a blend
        // mode, a raw filter chain), so inside a loop they would sit at one value for ever while the
        // author watched for a change that could never come.
        diagnostic(ctx, "warning", blockId, "A looping transform can only animate channels that interpolate; the rest of this row will not change.");
    }
    if (isEmptyStoryTransformProps(tween)) {
        diagnostic(ctx, "warning", blockId, "A looping transform states nothing to animate.");
        return null;
    }
    // No repeat config on the Transform itself: `Displayable.loop` forces `repeat: Infinity` and reads
    // the direction and the gap from its own options, so stating them twice would only give the two
    // somewhere to disagree.
    const options = transformOptions(timingOf(ref));
    const steps: { props: Record<string, unknown>; options: Record<string, unknown> }[] = [];
    if (ref.from && !isEmptyStoryTransformProps(ref.from)) {
        steps.push({ props: storyTransformPropsToNlr(ref.from), options: { duration: 0 } });
    }
    steps.push({ props: storyTransformPropsToNlr(tween), options });
    return new Transform(steps as any);
}

/**
 * Whether the engine behind this build can play a looping transform at all.
 *
 * A feature detect rather than a version compare, for the reason the element-id one is: the engine is
 * a normal dependency an author's machine may have pinned older, and a missing method would surface
 * as `target.loop is not a function` from inside a compile - a stack trace about Studio, for a row
 * the author wrote. Asking the object is both simpler and exactly the question.
 */
/**
 * The engine's `LoopOptions` - how each round runs, not how many there are.
 *
 * The count is not here and cannot be: a loop repeats until something stops it, which is the whole
 * difference between this and `transform.repeat(n)`. The spec refuses a row that states both.
 */
function loopOptions(ref: StoryTransformRef | undefined): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    if (ref?.repeatType) {
        options.repeatType = ref.repeatType;
    }
    if (ref?.repeatDelayMs !== undefined) {
        options.repeatDelay = Math.max(0, ref.repeatDelayMs);
    }
    return options;
}

function supportsLoop(target: any, ctx: SceneCompileContext, blockId: string): boolean {
    if (typeof target?.loop === "function" && typeof target?.stopLoop === "function") {
        return true;
    }
    diagnostic(ctx, "error", blockId, "This engine cannot play looping transforms. Update narraleaf-react to 0.32.0 or newer.");
    return false;
}

/**
 * **The one emitter.** Every settled pose in the whole story model comes through here: a `/show`, a
 * `/move`, a `/fx`, a camera pan, a camera grade.
 *
 * Two statements at most, and which is which is not a preference. {@link splitStoryTransformChange}
 * decides per prop whether the change may be eased, and the half that may not lands FIRST in its own
 * zero-duration statement, leaving the eased half to animate on the row's own timing. That is the
 * shape `1e626400` arrived at for the camera, generalised: a grade snaps and the pan still moves.
 *
 * A mask is emitted through `Displayable.mask` rather than as a `maskImage` prop, because that call
 * also registers the source for preload - writing the URL straight into a Transform would leave the
 * first frame unmasked.
 */
async function emitTransformProps(
    chain: any,
    ref: StoryTransformRef | undefined,
    ctx: SceneCompileContext,
    blockId: string,
): Promise<any> {
    if (!ref) {
        return chain;
    }
    for (const conflict of storyTransformPropsConflicts(ref.to)) {
        if (conflict === "filterBoth") {
            diagnostic(ctx, "warning", blockId, "A transform names more than one writer of the CSS filter channel; only one can reach the stage.");
        }
    }
    const timing = timingOf(ref);
    const grade = ref.to?.look ? cameraLookEmission(ref.to.look, ref) : null;
    // A SWAY never settles onto its grade until its last step, so the recipe's resting chain is the
    // sway statement's own business and must not also be written into the pose - a bag carrying both
    // would put the grade on at frame zero and then swing away from it.
    let bag = grade?.sway ? { ...ref.to, look: undefined } : ref.to;
    // A lens GESTURE is three keyframes rather than a destination, so it plays as its own statement
    // too. `lens: null` is the opposite instruction and IS a destination: put the glass back.
    const gesture = ref.to?.lens ? cameraLensGesture(ref.to.lens, ctx, blockId) : null;
    if (ref.to?.lens !== undefined) {
        bag = { ...bag, lens: undefined, ...(ref.to.lens === null ? neutralStoryCameraLensProps() : {}) };
    }
    const to = foldStoryTransformLook(bag, resolveStoryCameraLook, preset =>
        diagnostic(ctx, "warning", blockId, `Camera look "${preset}" is not a known grade.`));
    const { cut, tween } = splitStoryTransformChange(ref.from, to);
    // **Getting to a grade is a separate problem from being on one, and only the library can say
    // which of its own routes is safe.** `filterRaw` is discrete to everyone else - a chain nothing
    // can read cannot be interpolated responsibly - but a recipe that turns no hue moves every term
    // monotonically toward its target, and easing it is the effect rather than decoration. So the one
    // caller that DID write the chain moves it into the eased half.
    if (grade?.tweens && cut.filterRaw !== undefined) {
        tween.filterRaw = cut.filterRaw;
        delete cut.filterRaw;
    }
    let next = chain;
    if (!isEmptyStoryTransformProps(cut)) {
        next = await emitCutProps(next, cut, ctx, blockId);
    }
    if (!isEmptyStoryTransformProps(tween)) {
        next = next.transform(buildTransform(storyTransformPropsToNlr(tween), timing));
    }
    if (grade?.sway) {
        // The sway, then the settle onto the resting grade. `repeat` covers the whole sequence list,
        // so the swing ends on its last step rather than at neutral, and the settle is what leaves
        // the stage in the state a still grade would have left it in.
        next = next.transform(grade.sway).filter(grade.css, { duration: grade.settleMs, ease: "easeOut" });
    }
    if (gesture) {
        next = next.transform(gesture);
    }
    if (ref.clipReveal) {
        next = emitClipReveal(next, ref.clipReveal, timing, ctx, blockId);
    }
    return next;
}

/**
 * What a named grade asks the emitter for: whether its route may be eased, and the sway it plays
 * first when it has one.
 *
 * **A filter animation eases every term of the chain at once**, so the default route into a grade is
 * the straight line between two parameter sets. For `moonlight` that line is the bare-hue-rotate trap
 * reached from the other side: `grayscale` ramps up WHILE the angle sweeps 185 degrees, so the
 * midpoint keeps most of the source's own hues and drags them half a turn. Measured frame by frame on
 * that grade - blue at full, cyan by 0.8, green through 0.6-0.4, olive at 0.2. A green face. So a
 * chain that turns a hue cuts, and `storyCameraLookTweens` asks the recipe rather than a hard-coded
 * list: a new grade that grows an angle stops tweening without anyone remembering to say so.
 *
 * **A sway is exempt by construction rather than by judgement.** Every keyframe names the same filter
 * functions in the same order as the grade it settles onto, holds the flatten terms fixed, and moves
 * the hue only a few degrees either side of neutral. Nothing crosses the wheel, so there is no
 * midpoint to land wrong on - which is also why the step list and the resting recipe must stay
 * function-for-function identical: a browser interpolates two filter lists only when they match, and
 * a mismatched pair snaps instead of animating.
 */
function cameraLookEmission(
    look: NonNullable<StoryTransformProps["look"]>,
    ref: StoryTransformRef,
): { css: string; tweens: boolean; sway: Transform | null; settleMs: number } | null {
    const css = resolveStoryCameraLook(look.preset, look.intensity);
    if (!css) {
        return null;
    }
    const duration = Math.max(0, ref.durationMs ?? 0);
    const oscillation = resolveStoryCameraLookOscillation(look.preset, look.intensity, duration);
    if (oscillation && oscillation.steps.length > 0) {
        const sequences = oscillation.steps.map(step => ({
            props: { filter: step },
            options: { duration: oscillation.stepMs, ease: ref.easing ?? "easeInOut" },
        }));
        return {
            css,
            tweens: false,
            sway: new Transform(sequences as any, { repeat: oscillation.cycles } as any),
            settleMs: oscillation.settleMs,
        };
    }
    return { css, tweens: duration > 0 && storyCameraLookTweens(look.preset, look.intensity), sway: null, settleMs: 0 };
}

/** The half that lands in one frame, through the engine's own effect entries where it has them. */
async function emitCutProps(
    chain: any,
    cut: StoryTransformProps,
    ctx: SceneCompileContext,
    blockId: string,
): Promise<any> {
    const instant = { duration: 0 };
    let next = chain;
    if (cut.maskAssetId !== undefined) {
        if (cut.maskAssetId === null) {
            next = next.clearMask(instant);
        } else if (!cut.maskAssetId.trim()) {
            // A mask channel with no image is not "clear the mask" - `null` says that. It is a row the
            // author opened and did not finish, and silently doing nothing would look like a mask that
            // failed to load.
            diagnostic(ctx, "warning", blockId, "Mask effect has no image asset.");
        } else {
            const src = await resolveAsset(ctx, cut.maskAssetId, "image", blockId);
            if (src) {
                next = next.mask(src, {
                    ...instant,
                    ...(cut.maskSize != null ? { maskSize: cut.maskSize } : {}),
                    ...(cut.maskPosition != null ? { maskPosition: cut.maskPosition } : {}),
                    ...(cut.maskRepeat != null ? { maskRepeat: cut.maskRepeat } : {}),
                    ...(cut.maskMode != null ? { maskMode: cut.maskMode } : {}),
                });
            }
        }
    }
    if (cut.clipPath !== undefined) {
        next = cut.clipPath === null ? next.clearClip(instant) : next.clip(cut.clipPath, instant);
    }
    if (cut.filterRaw !== undefined) {
        next = cut.filterRaw === null ? next.clearFilter(instant) : next.filter(cut.filterRaw, instant);
    } else if (cut.filter !== undefined) {
        next = cut.filter === null ? next.clearFilter(instant) : next.filter(composeStoryFilter(cut.filter), instant);
    }
    if (cut.backdropFilter !== undefined) {
        next = next.backdrop(cut.backdropFilter ?? "none", instant);
    }
    if (cut.mixBlendMode !== undefined) {
        next = next.blend(cut.mixBlendMode ?? "normal", instant);
    }
    // What is left has no dedicated entry - the three mask settings when no mask image came with them,
    // a text colour, and the camera lens's dressing - so it goes through a Transform that simply does
    // not animate.
    //
    // The four lens keys have to be listed here for the same reason the mask settings are: this bag is
    // a LITERAL, so a discrete channel missing from it is not emitted and nothing says so. That is
    // exactly what happened to them - `/transform camera vignetteInner=30 vignetteOuter=70` compiled
    // to no statement at all, and a row carrying a strength beside them (`vignette=0.6 vignetteInner=30`)
    // kept the strength, which tweens, and lost the geometry, which cuts.
    const rest = storyTransformPropsToNlr({
        ...(cut.maskAssetId === undefined ? {
            maskSize: cut.maskSize,
            maskPosition: cut.maskPosition,
            maskRepeat: cut.maskRepeat,
            maskMode: cut.maskMode,
        } : {}),
        fontColor: cut.fontColor,
        shutterColor: cut.shutterColor,
        vignetteColor: cut.vignetteColor,
        vignetteInner: cut.vignetteInner,
        vignetteOuter: cut.vignetteOuter,
    });
    if (Object.keys(rest).length > 0) {
        next = next.transform(buildTransform(rest, undefined));
    }
    return next;
}

/**
 * The three clip-path generators, which are verbs and not values.
 *
 * They synthesize a new `clip-path` every frame from an interpolated radius or edge, so there is no
 * prop that holds one - which is exactly why they were never foldable as transform presets and why
 * they did not follow the other twelve operations into the bag.
 */
function emitClipReveal(
    chain: any,
    reveal: NonNullable<StoryTransformRef["clipReveal"]>,
    timing: TransformTiming,
    ctx: SceneCompileContext,
    blockId: string,
): any {
    const base = transformOptions(timing);
    if (reveal.kind === "wipe") {
        if (typeof chain.wipe !== "function") {
            diagnostic(ctx, "warning", blockId, "Wipe applies to displayable targets only.");
            return chain;
        }
        return chain.wipe({
            ...base,
            direction: reveal.direction ?? "left",
            reverse: reveal.reverse ?? false,
        });
    }
    const call = reveal.kind === "circleReveal" ? chain.circleReveal : chain.circleClose;
    if (typeof call !== "function") {
        diagnostic(ctx, "warning", blockId, "Circle reveal applies to displayable targets only.");
        return chain;
    }
    return call.call(chain, {
        ...base,
        ...(reveal.center ? { center: reveal.center } : {}),
        ...(reveal.fromRadius !== undefined ? { from: reveal.fromRadius } : {}),
        ...(reveal.toRadius !== undefined ? { to: reveal.toRadius } : {}),
    });
}

async function compileDisplayableOperation(
    target: any,
    operation: "show" | "hide" | "transform" | "loop" | "stopLoop",
    transform: StoryTransformRef | undefined,
    ctx: SceneCompileContext,
    blockId: string,
): Promise<NlrStatement | null> {
    if (operation === "loop" || operation === "stopLoop") {
        if (!supportsLoop(target, ctx, blockId)) {
            return null;
        }
        if (operation === "stopLoop") {
            // The way back is finite even when it is instant, so this one IS awaited - unlike the
            // loop it ends.
            return target.stopLoop(transformOptions(timingOf(transform)));
        }
        const loop = buildLoopTransform(transform ?? {}, ctx, blockId);
        return loop ? target.loop(loop, loopOptions(transform)) : null;
    }
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
    const timing = timingOf(transform);
    if (operation === "show") {
        // The engine's own `show(options)` IS the fade, so a row that asks for nothing but full opacity
        // uses it. Anything else has to arrive visible first and then move, or the pose would play
        // against an element the fade is still bringing up.
        if (isOpacityOnly(transform, 1)) {
            return target.show(transformOptions(timing));
        }
        const visible = target.show({ duration: 0, ...(transform?.easing ? { ease: parseStoryEasing(transform.easing) } : {}) });
        return await emitTransformProps(visible, transform, ctx, blockId);
    }
    if (operation === "hide") {
        if (isOpacityOnly(transform, 0)) {
            return target.hide(transformOptions(timing));
        }
        const posed = await emitTransformProps(target, transform, ctx, blockId);
        return (posed ?? target).hide({ duration: 0, ...(transform?.easing ? { ease: parseStoryEasing(transform.easing) } : {}) });
    }
    const chain = await emitTransformProps(target, transform, ctx, blockId);
    return chain === target ? null : chain;
}

/**
 * True when the bag says nothing but "end up at this opacity", which is what `show()` and `hide()`
 * already do. A bag carrying an opacity the verb does not imply (a half-visible ghost) is NOT this
 * case: it has to be animated after the element is up, or the value would be overwritten.
 */
function isOpacityOnly(transform: StoryTransformRef | undefined, opacity: number): boolean {
    if (transform?.clipReveal) {
        return false;
    }
    const to = transform?.to;
    if (!to) {
        return true;
    }
    const keys = Object.entries(to).filter(([, value]) => value !== undefined).map(([key]) => key);
    if (keys.length === 0) {
        return true;
    }
    return keys.length === 1 && keys[0] === "opacity" && to.opacity === opacity;
}

function createShowTransform(transform: StoryTransformRef | undefined, ctx: SceneCompileContext, blockId: string): Transform {
    if (transform?.mode === "animation") {
        return createAnimationTransform(transform, ctx, blockId, "show")
            ?? new Transform({ opacity: 1 } as any, transformOptions(undefined) as any);
    }
    // A character's entrance folds its whole pose into the show, so the cut/tween split does not apply:
    // there is no previous state to cut away from. A mask asset cannot be resolved from here (this is
    // sync, and the entrance is one statement by construction), so a bag carrying one says so.
    if (transform?.to?.maskAssetId) {
        diagnostic(ctx, "warning", blockId, "A mask cannot be applied by an entrance; use a separate transform row.");
    }
    return buildTransform({
        opacity: 1,
        ...getInlineTransformProps(transform, ctx, blockId),
    }, timingOf(transform));
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
        diagnostic(ctx, "error", blockId, `Story animation not found: ${animationId}`);
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

async function createTransition(transition: StoryTransitionRef | undefined, ctx: SceneCompileContext, blockId: string): Promise<unknown | undefined> {
    // A ref that names no kind plays a cut, the same as one that says `none` - see
    // `storyTransitionKindOf`. Deliberately not reported: the row names no transition, so there is
    // none for this build to be missing, and the row an eaten `kind` leaves behind is
    // indistinguishable from one the author never gave a transition to.
    //
    // `kind === "none"` is stated here as well as asked through the helper, and has to be: the
    // literal comparison is what narrows `none` out of the union, without which `kind` is not
    // `never` at the bottom of the switch and the exhaustiveness gate there cannot compile.
    if (!transition || transition.kind === "none" || storyTransitionKindOf(transition) === "none") {
        return undefined;
    }
    const duration = Math.max(0, transition.durationMs ?? 300);
    const easing = parseStoryEasing(transition.easing) as any;
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
            return new Reveal({ duration, easing, pattern: Mask.blinds({ orientation: stringProp(props, "orientation", "horizontal") as any, slats: numberProp(props, "slats", 8), feather: numberProp(props, "feather", 0), stagger: numberProp(props, "stagger", 0) }) });
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
                // Absent leaves the engine's own 30%-of-the-run default in place, which is what a row
                // that has never been given a hold has always played.
                ...(transition.holdMs === undefined ? {} : { holdMs: Math.max(0, transition.holdMs) }),
                ...throughColorPattern(props),
                ...throughColorUncover(props),
            });
        case "exposure":
            // Stops, not a multiplier: the gain is `2 ** ev`, so a linear-looking slider stays
            // perceptually even. Capped at 12 EV (a gain of 4096) because past the point where
            // every channel has clipped the extra stops buy nothing but a longer white hold.
            //
            // `lift` is clamped for the same reason `darkness` is: it lands inside a CSS
            // `brightness()`, and one out-of-range value makes the browser drop the whole filter
            // declaration - the transition would go silently inert rather than saturate.
            return new Exposure({
                duration,
                easing,
                ev: Math.min(12, Math.max(0, numberProp(props, "ev", 4.6))),
                lift: Math.min(1, Math.max(0, numberProp(props, "lift", 0.04))),
                holdMs: Math.max(0, transition.holdMs ?? 0),
            });
        case "ruleReveal": {
            // The only transition that reads an asset, which is why this factory is async. A rule
            // with no picture is a row the author has not finished: reported, and played as a cut,
            // rather than guessed at with some other engine that would look deliberate.
            if (!transition.ruleAssetId) {
                diagnostic(ctx, "warning", blockId, "Rule transition names no rule image; the change was played as a cut.");
                return undefined;
            }
            const rule = await resolveAsset(ctx, transition.ruleAssetId, "image", blockId);
            if (!rule) {
                return undefined;
            }
            return new RuleReveal({
                duration,
                easing,
                rule,
                // Percent on the way in, like every other feather this file writes, and a fraction
                // on the way out because that is what the engine's tonal range is measured in.
                feather: numberProp(props, "feather", 12) / 100,
                inverted: props.inverted === true,
            });
        }
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
                // Held at `from`, where the image swap happens - the window the swap hides in, which
                // is the same thing the other two transitions call a hold.
                holdMs: Math.max(0, transition.holdMs ?? 0),
            });
        case "custom":
            // The union's escape hatch: a transition that is nothing but its `props`, with no engine
            // behind it to build. Nothing in Studio writes one and no script can name one, but a
            // document is free to carry one, so it is routed here by hand rather than left to the
            // `default` below. It has to be: it is a member of the union, so leaving it to `default`
            // would narrow `kind` to `"custom"` there instead of `never`, and the exhaustiveness
            // check below could not be written at all.
            return reportUnplayableTransition(ctx, blockId, "custom");
        default: {
            // Exhaustiveness gate, and the reason this `default` is not just a runtime fallback.
            // Every member of `StoryTransitionRef["kind"]` is either built above or routed by the
            // `custom` case, so `kind` is `never` by the time it reaches here and this assignment
            // fails to compile the moment a kind is added to the union without a branch. Adding a
            // transition kind touches eleven places across the engine and Studio and this one had
            // no compile-time guard at all; a forgotten branch used to reach an author as a console
            // line nobody reads.
            //
            // The runtime path is still live, and is the only thing that reaches it: a `kind` the
            // union does not contain - a document written by a newer Studio, or one carrying a kind
            // that has since been retired. `unknownKind` holds that stored string.
            const unknownKind: never = transition.kind;
            return reportUnplayableTransition(ctx, blockId, unknownKind);
        }
    }
}

/**
 * Report a transition this build cannot play, and play the change as a cut.
 *
 * `error`, by the rule {@link diagnostic} states: the row names a transition, this compile can prove
 * it holds none by that name, and the part of the row that name governs does not happen - the change
 * still lands, but instantly, with nothing on stage saying why. That is the same shape as a Story
 * Motion the project no longer holds, which is already an error. It is not a row left unfinished
 * (the author picked something) and not state from outside this compile (the kind is right there in
 * the document), so neither warning clause fits.
 *
 * `story/transition-unavailable` is the half of this that refuses a build; this half is what an author
 * sees while writing.
 */
function reportUnplayableTransition(ctx: SceneCompileContext, blockId: string, kind: string): undefined {
    diagnostic(ctx, "error", blockId, `Transition "${kind}" is not available; the change was played as a cut. Choose a transition on this row.`);
    return undefined;
}

/**
 * Map a stored `throughColor` pattern prop to the native `ThroughColor` `pattern`/`inverted` pair.
 *
 * The geometries are the {@link Mask} catalogue, the same one `Reveal` draws its kinds from - the
 * colour covers through a shape, and there is no shape it can cover through that a direct cut cannot
 * reveal through. Offering four of the seven made "cover the frame with a clock" unreachable while
 * "cut to the new frame with a clock" was one menu item away.
 *
 * `inverted` defaults to `true` for the iris and `false` for the rest, which is the orientation each
 * is asked for: an iris that closes rim-in is the classic iris-to-black, while a wipe or a clock
 * covering in reverse is the exception. A row that states `inverted` gets what it states.
 */
function throughColorPattern(props: Record<string, StoryLiteralValue>): { pattern?: MaskPattern; inverted?: boolean } {
    const kind = stringProp(props, "pattern", "plain");
    const center = () => stringProp(props, "center", "50% 50%");
    const inverted = (fallback: boolean) => ({ inverted: props.inverted === undefined ? fallback : props.inverted === true });
    switch (kind) {
        case "linear":
            return { pattern: Mask.wipe({ direction: stringProp(props, "direction", "left") as any, feather: numberProp(props, "feather", 12) }), ...inverted(false) };
        case "blinds":
            return { pattern: Mask.blinds({ orientation: stringProp(props, "orientation", "horizontal") as any, slats: numberProp(props, "slats", 8), feather: numberProp(props, "feather", 0), stagger: numberProp(props, "stagger", 0) }), ...inverted(false) };
        case "iris":
            // Rim-in by default: the colour closes over the frame, which is the iris-to-black every
            // document written before this option existed was getting.
            return { pattern: Mask.iris({ center: center(), feather: numberProp(props, "feather", 12), shape: stringProp(props, "shape", "circle") as any }), ...inverted(true) };
        case "barnDoor":
            return { pattern: Mask.barnDoor({ axis: stringProp(props, "axis", "horizontal") as any, feather: numberProp(props, "feather", 12) }), ...inverted(false) };
        case "clock":
            return { pattern: Mask.clock({ center: center(), from: numberProp(props, "from", 0), feather: numberProp(props, "feather", 24), direction: stringProp(props, "direction", "clockwise") as any }), ...inverted(false) };
        case "fan":
            return { pattern: Mask.fan({ blades: numberProp(props, "blades", 4), center: center(), from: numberProp(props, "from", 0), feather: numberProp(props, "feather", 10) }), ...inverted(false) };
        case "dots":
            return { pattern: Mask.dots({ rows: numberProp(props, "rows", 6), cols: numberProp(props, "cols", 10), feather: numberProp(props, "feather", 20), stagger: numberProp(props, "stagger", 0) }), ...inverted(false) };
        default:
            // "plain" → no pattern: the colour simply fades in and out (flash with no hold).
            return {};
    }
}

/**
 * How the colour comes back off the frame: `retreat` backs the pattern out the way it came,
 * `continue` keeps the edge travelling so the geometry passes through - a wipe exits out the far
 * side, a clock hand completes a second lap.
 *
 * Ignored by the engine without a pattern, and left unstated when the row says nothing, so a plain
 * fade's compiled options are unchanged.
 */
function throughColorUncover(props: Record<string, StoryLiteralValue>): { uncover?: "retreat" | "continue" } {
    const uncover = stringProp(props, "uncover", "retreat");
    return uncover === "continue" ? { uncover: "continue" } : {};
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
            diagnostic(ctx, "error", blockId, "Scene variable not found; the assignment was skipped.");
            return null;
        }
        return { kind: "storable", namespace: DevTools.getNamespaceName(ctx.nlrScene.local), key: def.storageKey };
    }
    if (ref.scope === "saved") {
        const def = ctx.savedVariables[ref.variableId];
        if (!def) {
            diagnostic(ctx, "error", blockId, "Saved variable not found; the assignment was skipped.");
            return null;
        }
        return { kind: "storable", namespace: DevTools.getNamespaceName(ctx.savedPersistent), key: def.storageKey };
    }
    // Existence is checked before host availability: an undeclared persistent variable is a fault the
    // author must fix regardless of whether Dev Mode host persistence is up (same diagnostic
    // as a missing scene/saved variable).
    if (!ctx.persistentKeys.has(ref.variableId)) {
        diagnostic(ctx, "error", blockId, "Persistent variable not found; the assignment was skipped.");
        return null;
    }
    if (!ctx.persistence) {
        diagnostic(ctx, "warning", blockId, "Persistent variables require Dev Mode host persistence and were skipped.");
        return null;
    }
    return { kind: "host", key: ref.variableId };
}

/**
 * Build the environment an expression evaluates against, with everything it reaches outside its own
 * tree resolved up front: every referenced variable's slot, and every blueprint it calls.
 *
 * Returns null when any of them fails to resolve. That is the whole doctrine of this function - an
 * expression that silently treated a deleted variable as `0`, or a deleted blueprint as `null`, would
 * produce a plausible wrong number, which is worse than not running at all.
 *
 * The visited capability needs no resolution pass: the record is addressed by the very ids the
 * `visited` node carries, so there is nothing that can fail to bind. An id naming a scene the author
 * has since deleted simply never appears in the record, which is exactly "not visited".
 */
function buildExpressionEnv(
    ctx: SceneCompileContext,
    expr: StoryExpr,
    blockId: string,
): ((scriptCtx: ScriptCtx) => StoryExpressionEnv) | null {
    const slots = new Map<string, StoryVariableSlot>();
    for (const ref of collectStoryExpressionVariables(expr)) {
        const slot = resolveVariableSlot(ctx, ref, blockId);
        if (!slot) {
            return null;
        }
        slots.set(storyVariableRefKey(ref), slot);
    }

    // One compile input per callee, built here rather than per evaluation: `buildStoryActionScriptInput`
    // is pure assembly, but doing it inside the lambda would rebuild it on every branch test and every
    // dialogue repaint.
    const invocations = new Map<string, CompileStoryActionScriptInput>();
    for (const call of collectStoryExpressionInvocations(expr)) {
        if (!ctx.blueprintDocument) {
            diagnostic(ctx, "warning", blockId, `Expression calls \`${call.name}()\`, which needs the project blueprint document; the expression was skipped.`);
            return null;
        }
        invocations.set(
            call.blueprintId,
            buildStoryActionScriptInput(ctx, call.blueprintId, message => diagnostic(ctx, "warning", blockId, message)),
        );
    }

    const persistence = ctx.persistence;
    const persistentDefaults = ctx.persistentDefaults;
    // Resolved once at compile time like `savedNamespaceName`: the accessor is what keeps this in step
    // with the engine's own prefix convention instead of reconstructing it (see `storyVisited.ts`).
    const visitedNamespace = DevTools.getNamespaceName(ctx.visitedPersistent);

    return (scriptCtx: ScriptCtx) => ({
        read: ref => {
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
        },
        // Read live off the storable on every test, not captured: a `repeat until picked(…)` and a
        // choice option's `hiddenWhen` both have to see the record as it stands now.
        visited: ref => isStoryVisited(
            scriptCtx.storable,
            visitedNamespace,
            ref.kind === "scene" ? STORY_VISITED_SCENES_KEY : STORY_VISITED_OPTIONS_KEY,
            storyVisitedRefId(ref),
        ),
        invoke: blueprintId => {
            const input = invocations.get(blueprintId);
            // Unreachable: every callee in the tree was collected above or this function returned
            // null. Answering `undefined` rather than throwing keeps that true even if it stops being.
            return input
                ? evaluateStoryActionBlueprintValueSync(input, scriptCtx) as StoryLiteralValue | undefined
                : undefined;
        },
    });
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
            diagnostic(ctx, "error", blockId, "Scene variable not found; the assignment was skipped.");
            return null;
        }
        return ctx.nlrScene.local.set(def.storageKey, value as any);
    }
    if (target.scope === "saved") {
        const def = ctx.savedVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "error", blockId, "Saved variable not found; the assignment was skipped.");
            return null;
        }
        return ctx.savedPersistent.set(def.storageKey, value as any);
    }
    // Persistent (app-level, host-managed, shared with UI blueprints). Existence is checked first, so
    // an undeclared persistent target faults regardless of host availability.
    if (!ctx.persistentKeys.has(target.variableId)) {
        diagnostic(ctx, "error", blockId, "Persistent variable not found; the assignment was skipped.");
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
    const envFor = buildExpressionEnv(ctx, expression.ast, blockId);
    const slot = resolveVariableSlot(ctx, target, blockId);
    if (!envFor || !slot) {
        return null;
    }
    const persistence = ctx.persistence;

    return Script.execute(scriptCtx => {
        const result = evaluateStoryExpression(expression.ast, envFor(scriptCtx));
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
        const envFor = buildExpressionEnv(ctx, expression.ast, blockId);
        if (!envFor) {
            return falseCondition;
        }
        // Re-read on every test, like the blueprint condition beside it: a branch inside a loop must
        // see the value as it stands now, not as it stood when the scene compiled.
        return (scriptCtx: ScriptCtx) => isTruthy(evaluateStoryExpression(expression.ast, envFor(scriptCtx)));
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
            diagnostic(ctx, "error", blockId, "Persistent variable not found; condition evaluates false.");
            return falseCondition;
        }
        return persistentCondition(ctx, target.variableId, condition.operator, condition.value);
    }
    let persistent: Persistent<any>;
    let storageKey: string;
    if (target.scope === "scene") {
        const def = ctx.sceneVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "error", blockId, "Scene variable not found; condition evaluates false.");
            return falseCondition;
        }
        persistent = ctx.nlrScene.local as Persistent<any>;
        storageKey = def.storageKey;
    } else {
        const def = ctx.savedVariables[target.variableId];
        if (!def) {
            diagnostic(ctx, "error", blockId, "Saved variable not found; condition evaluates false.");
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
        case "greaterThan":
        case "greaterOrEqual":
        case "lessThan":
        case "lessOrEqual": {
            // `evaluate` rather than a dedicated Persistent method: the engine has none for ordering,
            // and routing the four through the expression evaluator's own rule is what keeps a
            // dropdown threshold and a typed `gold >= 100` from disagreeing on the same values.
            const operator = condition.operator;
            const target = condition.value as StoryLiteralValue | undefined;
            return persistent.evaluate(storageKey, (current: any) =>
                compareStoryCondition(operator, current as StoryLiteralValue | undefined, target));
        }
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
    // which go through NLR's `persistent.equals()`. The undefined guard keeps the old
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
            case "greaterThan":
            case "greaterOrEqual":
            case "lessThan":
            case "lessOrEqual":
                return compareStoryCondition(operator, current, value);
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
    const entry = resolvePoseEntry(appearance, pose);
    return entry?.assetId ? resolveAsset(ctx, entry.assetId, "image", blockId, entry.assetVariants) : null;
}

/**
 * A layered character's stack as the engine's `src`, or null when the character is not layered (or
 * has no layer that draws anything).
 *
 * Every layer bound to an axis becomes a variants map keyed by tag id. The engine identifies a tag
 * group by its tag *set*, so all the layers on one axis collapse onto that axis's single group —
 * which is exactly what makes one `char(["angry"])` move the brows and the mouth together, and why
 * the appearance model keeps each bound layer's option map complete.
 *
 * `tags` is the selection the stack opens on. A row leaves it out and gets the character's declared
 * default look; the snapshot pre-pose passes the selection accumulated up to the launch row, because
 * an Image's src shape is fixed in its constructor and so is the appearance it starts in.
 */
async function resolveCharacterLayeredSrc(
    ctx: SceneCompileContext,
    characterId: string | undefined,
    blockId: string,
    tags?: StoryCharacterTagSelection,
): Promise<{ layers: (string | null | Record<string, string | null>)[]; defaults: string[] } | null> {
    const appearance = characterId ? ctx.characterSummaries.get(characterId)?.appearance : undefined;
    if (appearance?.kind !== "layered") {
        return null;
    }

    const layers: (string | null | Record<string, string | null>)[] = [];
    for (const layer of appearance.layers) {
        if (layer.hidden) continue;
        if (!layer.axisId) {
            const url = layer.assetId
                ? await resolveAsset(ctx, layer.assetId, "image", blockId, layer.assetVariants)
                : null;
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
            variants[tag.id] = assetId
                ? await resolveAsset(ctx, assetId, "image", blockId, layer.assetVariants)
                : null;
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
    const defaults = Object.values(resolveTagSelection(appearance, tags)).filter(tagId => emitted.has(tagId));
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
    // Concurrently, and this is the one place in the compile where that is worth doing: a baked
    // avatar is a derived project file rather than a library asset, so it is the one kind of id a
    // host cannot resolve ahead of time - and a character with a few differentials has hundreds of
    // keys, each of which was a full round trip to whatever answers for the host before the next
    // was sent. The keys are independent and both maps below are keyed by this loop's own values,
    // so the only thing the order decided was how long it took.
    const avatarKeys = Object.keys(avatarTable ?? {});
    const avatarUrls = await Promise.all(avatarKeys.map(async key => {
        const assetId = resolveCharacterAvatarAssetId(summary, key);
        const url = assetId
            ? await resolveAsset(ctx, assetId, "image", blockId, avatarTable?.[key]?.assetVariants)
            : null;
        return { key, assetId, url };
    }));
    for (const { key, assetId, url } of avatarUrls) {
        if (url && assetId) {
            byKey.set(key, url);
            ctx.avatarAssetIdByUrl.set(url, assetId);
        }
    }

    if (summary.appearance.kind === "preset") {
        for (const pose of summary.appearance.poses) {
            const url = pose.assetId
                ? await resolveAsset(ctx, pose.assetId, "image", blockId, pose.assetVariants)
                : null;
            // Two poses sharing one sprite are indistinguishable at runtime - the engine reports a
            // src, not a pose. First wins; their avatars would have to picture the same thing anyway.
            if (url && !poseByUrl.has(url)) {
                poseByUrl.set(url, pose.id);
            }
        }
    }

    const defaultAvatarAssetId = summary.defaultAvatarAssetId?.trim();
    const fallback = defaultAvatarAssetId
        ? await resolveAsset(ctx, defaultAvatarAssetId, "image", blockId, summary.assetVariants)
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

/**
 * The asset a row means, following a materialised set reference when the row carries one.
 *
 * The single point where a set stops being a set. Everything downstream - the URL, the cache entry,
 * the preload registration - sees an ordinary asset id, which is why nothing else in this compiler
 * had to learn what a set is.
 *
 * **Resolution happens here, before the URL, and therefore before the preload sweep that runs on
 * the URLs this compile produced.** Deferring it to the moment the action runs would leave the
 * preloader warming either nothing or the wrong language's file, and the player would watch a frame
 * of blank stage while the right one loaded.
 */
function resolveSetReference(ctx: SceneCompileContext, assetId: string, blockId: string): string {
    // The row's own map, and the scene's for the two fields that belong to no row (its opening
    // background and its music). One lookup order, so a scene-level reference resolves by the same
    // rule as a row's.
    return resolveVariantReference({
        variants: ctx.scene.blocks?.[blockId]?.assetVariants ?? ctx.scene.assetVariants,
        assetId,
        blockId,
        localization: ctx.localization,
        diagnostics: ctx.diagnostics,
    });
}

/**
 * The same reading for a scene's own fields, which have no row and therefore no context.
 *
 * Split out rather than duplicated: a second copy of "which member does this locale get" is a second
 * place for the scene's background and its rows to disagree about what language they are in.
 */
function resolveVariantReference(input: {
    variants: StoryAssetVariants | undefined;
    assetId: string;
    blockId: string;
    localization: SceneLocalizationResolver | undefined;
    diagnostics: NlrStoryCompileDiagnostic[];
}): string {
    const { variants, assetId, blockId, localization, diagnostics } = input;
    const map = variants?.[assetId];
    if (!map) {
        return assetId;
    }
    const resolved = localization?.variant(variants, assetId);
    if (resolved) {
        return resolved;
    }
    // A materialised story reached a compile with no localization to resolve it against - a host
    // wiring fault, not an authoring one, because assembly only writes these maps for a project that
    // has languages. Any member draws the scene; the diagnostic is what keeps it from being silent.
    const [fallback] = Object.values(map);
    if (fallback) {
        pushDiagnostic(
            diagnostics,
            "warning",
            blockId,
            `Asset set ${assetId} was resolved without a language; the stage may show the wrong one.`,
        );
        return fallback;
    }
    return assetId;
}

/**
 * `variants` is for a reference that is not a row: a character's pose, layer or avatar carries its
 * own answer on the record that names the set, so the caller hands that map in rather than this
 * looking in the row and scene maps, which have nothing to say about it.
 */
async function resolveAsset(
    ctx: SceneCompileContext,
    assetId: string,
    assetType: StoryAssetKind,
    blockId: string,
    variants?: StoryAssetVariants,
): Promise<string | null> {
    return resolveAssetUrlCached({
        assetId: variants
            ? resolveVariantReference({
                variants,
                assetId,
                blockId,
                localization: ctx.localization,
                diagnostics: ctx.diagnostics,
            })
            : resolveSetReference(ctx, assetId, blockId),
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

function recordStatement(
    ctx: SceneCompileContext,
    statement: NlrStatement,
    block: StoryBlock,
    textId?: string,
    audioAssetId?: string,
): NlrStatement {
    for (const action of statementToActions(statement)) {
        const staticId = stableActionId(ctx.document.id, ctx.scene.id, block.id, textId, ctx.nextActionIndex(block.id));
        setStableActionId(action, staticId);
        ctx.actionIdBindings.push({
            action,
            staticId,
            blockId: block.id,
            textId,
            ...(audioAssetId ? { audioAssetId } : {}),
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

/**
 * A scene, plus the three elements the engine gives every scene: its two default layers and its
 * background image.
 *
 * They are elements like any other and a save carries their state the same way, but nothing outside
 * the engine constructs them - so left alone they would keep positional names while everything
 * around them stopped moving, and a save would still put a layer's pose onto a background.
 */
function setStableSceneElementIds(sink: string[], scene: Scene, sceneId: string): void {
    setStableElementId(sink, scene, `nl:scene:${sceneId}`);
    setStableElementId(sink, scene.backgroundLayer, `nl:scene:${sceneId}:layer:background`);
    setStableElementId(sink, scene.displayableLayer, `nl:scene:${sceneId}:layer:displayable`);
    setStableElementId(sink, scene.background, `nl:scene:${sceneId}:background`);
    // The narrator is the engine's own `Character(null)`, shared by every narration line in every
    // scene, and nothing here constructs it - so like the three above it would keep a positional
    // name. It began carrying state in engine 0.26.0, when `Character` started serialising its
    // name, and a positional name is only harmless while an element reaches no save. Naming a
    // singleton repeatedly is the same write each time.
    setStableElementId(sink, Narrator, "nl:character:narrator");
}

function setStableActionId(action: NlrAction, staticId: string): void {
    const tools = DevTools as DevToolsWithStaticId;
    if (tools.setStaticId) {
        tools.setStaticId(action, staticId);
        return;
    }
    DevTools.setActionId(action, staticId);
}

/**
 * Report something about a row. **The level is not a matter of taste** - it answers one question:
 * does what the author will see differ badly from what the row says?
 *
 * `error` - a reference names something the document is supposed to contain and does not, and this
 * compile can prove it: a stage object no row declares, a variable no row declares, a Story Motion
 * the project no longer holds, a scene or label that is gone. The row - or the part of it the
 * reference governs - does not happen, and nothing on stage says why. Whether a reference resolves
 * is a fact about the document, so it is stated as one.
 *
 * `warning` - everything this compile cannot settle by itself, and everything that is merely
 * unfinished:
 *  - state from outside this compile (music set in an earlier scene, Dev Mode host persistence, a
 *    character possibly on stage under a name an inline token cannot address),
 *  - a row the author has not finished (no clip picked yet, no `animationId` chosen yet) - dropping a
 *    row and then filling it in is ordinary authoring, not a fault,
 *  - an asset the host's resolver would not hand over, which is the project lint's `reference-missing`
 *    to gate rather than a second verdict from here,
 *  - a legal outcome the author can see, where two instructions met and one had to give.
 *
 * Neither level blocks a build. These reach the Story console during a preview; `BuildService`'s lint
 * gate is what stops a release.
 */
function diagnostic(ctx: SceneCompileContext, level: NlrStoryCompileDiagnostic["level"], blockId: string | undefined, message: string): void {
    pushDiagnostic(ctx.diagnostics, level, blockId, message);
}

/**
 * What to call a character inside a diagnostic an author will read.
 *
 * Never the id. `characterStageName` falls back to the character id when no explicit stage name was
 * given, so `payload.characterId || stageName` — which is what these messages used to interpolate —
 * printed a bare UUID either way. That was survivable while diagnostics only reached the console;
 * they are now shown in the Dev Mode error banner, where a UUID is exactly the thing an author
 * cannot match to anything they wrote.
 *
 * Order: the author's own name for the character, then a stage name they typed, then a generic —
 * every rung being something that appears somewhere in their project.
 */
function characterDiagnosticName(
    ctx: SceneCompileContext,
    payload: Extract<StoryActionPayload, { action: "character" }>,
): string {
    const summaryName = payload.characterId ? ctx.characterSummaries.get(payload.characterId)?.name?.trim() : "";
    if (summaryName) {
        return summaryName;
    }
    const explicitName = payload.objectName?.trim();
    if (explicitName && explicitName !== "character") {
        return explicitName;
    }
    return "this character";
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




