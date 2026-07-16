import {
    Character,
    Condition,
    Control,
    DevTools,
    Dissolve,
    FadeIn,
    Image,
    Lambda,
    Layer,
    MaskTransition,
    Menu,
    Narrator,
    Pause,
    Persistent,
    Scene,
    Script,
    Sound,
    Story,
    Text,
    Transform,
    Video,
    Word,
} from "narraleaf-react";
import { blink, vignette } from "narraleaf-react/built-in";
import {
    Blinds,
    BlurDissolve,
    Slide,
    SoftIris,
    SoftWipe,
    ThroughColor,
    type BlindsOrientation,
    type ThroughColorPattern,
    type WipeDirection,
} from "./transitions/customImageTransitions";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type {
    StoryActionPayload,
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationSequence,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
    StoryBlock,
    StoryCharacterVariantSelection,
    StoryConditionRef,
    StoryControlPayload,
    StoryDisplayableTargetRef,
    StoryDocument,
    StoryInterpolationRef,
    StoryLayerRef,
    StoryLiteralValue,
    StoryScene,
    StoryTextMarks,
    StoryTextSegment,
    StoryTransitionRef,
    StoryTransformSequenceProps,
    StoryTransformRef,
    StoryVariableRef,
} from "@shared/types/story";
import { layerActionTargetRef, resolveDisplayableTargetRef, resolveStoryLayerRef } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { GameLocalizationBundle } from "@shared/types/localization";
import { resolveLocaleChain } from "@shared/types/localization";
import { parseTranslatedText } from "@shared/utils/localizationText";
import {
    boolProp,
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
 * Game localization input: the bundle payload (locales + translation tables)
 * plus a synchronous current-locale getter (host persistence snapshot). Text
 * segments with translations compile to dynamic NLR Words that re-resolve on
 * every render, so switching the language applies immediately — no recompile.
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
export type StoryAssetKind = "image" | "audio" | "video" | "font" | "other";
type NlrCondition = Lambda<boolean> | ((ctx: ScriptCtx) => boolean);

/** Name-keyed NLR elements a compiled scene created; lets hosts look up live objects (e.g. a preview's transform target). */
export type CompiledSceneElements = {
    images: Map<string, Image>;
    texts: Map<string, Text>;
    layers: Map<string, Layer>;
};

export type CompiledNlrStory = {
    story: Story;
    scene: Scene;
    scenes: Record<string, Scene>;
    storyId: string;
    sceneId: string;
    actionIdBindings: NlrActionIdBinding[];
    diagnostics: NlrStoryCompileDiagnostic[];
    /** Per-scene element registries, keyed by scene id (normalized object name → element). */
    sceneElements?: Record<string, CompiledSceneElements>;
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
    persistence?: StoryPersistenceBridge;
    /**
     * Fires synchronously once the pre-posed stage state has been fully applied (elements
     * registered, residual effects settled) — the first frame at which the stage is a faithful
     * still of the snapshot. Precedes the reveal gate.
     */
    onStagePosed?: () => void;
    /**
     * Reveal gate for double-buffered hosts: after `onStagePosed`, execution pauses until this
     * promise resolves, so the host can swap the posed (but hidden) stage in before the target's
     * own action plays. Superseded runs never need it resolved — disposing the game aborts the wait.
     */
    revealGate?: Promise<void>;
    /** Fires synchronously immediately before the target's own statements. */
    onBeforeTarget: () => void;
    /** Fires synchronously immediately after the target's own statements complete. */
    onAfterTarget: () => void;
};

type SceneCompileContext = {
    document: StoryDocument;
    nlrStory: Story;
    scene: StoryScene;
    nlrScene: Scene;
    allScenes: Record<string, Scene>;
    characters: Map<string, Character>;
    characterSummaries: Map<string, DevModeCharacterSummary>;
    /** Single NLR Persistent (Storable-backed, per-save) holding all "saved" variables. */
    savedPersistent: Persistent<Record<string, StoryLiteralValue>>;
    /** App-level persistent bridge (shared with UI blueprints); absent outside Dev Mode host. */
    persistence?: StoryPersistenceBridge;
    /** Blueprint document for compiling story-action blueprints referenced by this scene. */
    blueprintDocument?: BlueprintDocument;
    /** Game localization resolver; absent when the project has no localization or the host passes none. */
    localization?: SceneLocalizationResolver;
    /** Fn declarations shared across all story-action blueprints in this scene. */
    sceneFnCatalog: StoryActionFnCatalog;
    images: Map<string, Image>;
    texts: Map<string, Text>;
    layers: Map<string, Layer>;
    videos: Map<string, Video>;
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
    /** App-level persistent bridge (shared with UI blueprints); from the Dev Mode scope-store bridge. */
    persistence?: StoryPersistenceBridge;
    /** Game localization (bundle payload + current-locale getter); see {@link StoryLocalizationRuntime}. */
    localization?: StoryLocalizationRuntime;
};

const EMPTY_IMAGE_SRC = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'></svg>";
const SCENE_INITIAL_BACKGROUND_BLOCK_ID = "__scene_initial_background";
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
        actionIdBindings: [],
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
    const characterSummaries = new Map((input.characters ?? []).map(character => [character.id, character]));
    const animations = new Map(Object.entries(input.animations ?? {}));
    const assetUrlCache = new Map<string, string | null>();
    let actionIndex = 0;
    const resolveAssetUrl = input.resolveAssetUrl ?? ((assetId: string) => assetId);
    const allScenes = await createNlrScenes({
        document: input.document,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
    });

    // Single Storable-backed namespace seeded with every saved variable's default.
    const savedDefaults: Record<string, StoryLiteralValue> = {};
    for (const saved of Object.values(input.document.savedVariables ?? {})) {
        savedDefaults[saved.storageKey] = saved.defaultValue ?? null;
    }
    const savedPersistent = nlrStory.createPersistent(SAVED_PERSISTENT_NAMESPACE, savedDefaults);
    const localization = input.localization ? createSceneLocalizationResolver(input.localization) : undefined;

    for (const scene of Object.values(input.document.scenes)) {
        const nlrScene = allScenes[scene.id];
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
            savedPersistent,
            persistence: input.persistence,
            blueprintDocument: input.blueprintDocument,
            localization,
            sceneFnCatalog,
            images: new Map(),
            texts: new Map(),
            layers: new Map(),
            videos: new Map(),
            sounds: new Map(),
            animations,
            resolveAssetUrl,
            assetUrlCache,
            diagnostics,
            actionIdBindings,
            nextActionIndex: () => actionIndex++,
        };
        const statements = await compileBlockList(ctx, scene.rootBlockIds);
        nlrScene.action(statements as unknown as Parameters<Scene["action"]>[0]);
        sceneElements[scene.id] = { images: ctx.images, texts: ctx.texts, layers: ctx.layers };
    }

    const nlrEntryScene = allScenes[input.sceneId];
    nlrStory.entry(nlrEntryScene);

    return {
        story: nlrStory,
        scene: nlrEntryScene,
        scenes: allScenes,
        storyId: input.document.id,
        sceneId: entryScene.id,
        actionIdBindings,
        diagnostics,
        sceneElements,
    };
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
 * markers. No runtime fast-forwarding is involved — the compiled story IS the state, and looping
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
    const savedDefaults: Record<string, StoryLiteralValue> = {};
    for (const saved of Object.values(input.document.savedVariables ?? {})) {
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

    const ctx: SceneCompileContext = {
        document: input.document,
        nlrStory,
        scene,
        nlrScene: previewScene,
        allScenes: { [scene.id]: previewScene },
        characters: new Map(),
        characterSummaries,
        savedPersistent,
        persistence: input.persistence,
        blueprintDocument: input.blueprintDocument,
        sceneFnCatalog: collectSceneStoryActionFns({
            document: input.document,
            blueprintDocument: input.blueprintDocument,
            scene,
        }),
        images: new Map(),
        texts: new Map(),
        layers: new Map(),
        videos: new Map(),
        sounds: new Map(),
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
    // ids — give each a unique one or they collide as React keys on the stage.
    registrations.forEach((registration, index) => {
        DevTools.setElementId(registration.element as any, `preview-e-${index}`);
    });

    const statements: NlrStatement[] = [];
    // Seed scene variables (defaults overlaid with the snapshot's assignments) so conditions and
    // inline interpolations in the target line read the accumulated values.
    for (const def of Object.values(scene.sceneVariables ?? {})) {
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
    const targetBlock = input.targetBlockId ? scene.blocks[input.targetBlockId] : undefined;
    if (targetBlock) {
        let own = await compilePreviewTargetOwnStatements(ctx, targetBlock);
        if (snapshot.nvl && own.length > 0) {
            own = [previewScene.nvl({ duration: 0 } as any, own as any)];
        }
        statements.push(...own);
    }
    statements.push(previewMarker(input.onAfterTarget));

    // Register every image URL this compile resolved (snapshot poses AND the target's own
    // sources) with the scene's preloader — injected elements bypass NLR's usual preload
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
        diagnostics,
        sceneElements: { [scene.id]: { images: ctx.images, texts: ctx.texts, layers: ctx.layers } },
    };
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
    return resolveCharacterImageUrl(ctx, source.characterId, source.formName, source.variants, blockId);
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
}): Promise<Record<string, Scene>> {
    const scenes: Record<string, Scene> = {};
    for (const scene of Object.values(input.document.scenes)) {
        const background = await resolveSceneInitialBackground({
            scene,
            resolveAssetUrl: input.resolveAssetUrl,
            assetUrlCache: input.assetUrlCache,
            diagnostics: input.diagnostics,
        });
        scenes[scene.id] = new Scene(
            scene.runtimeName || scene.name || scene.id,
            background ? { background } : undefined,
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
        return compileControlGroup(ctx, block);
    }

    if (block.kind === "jump") {
        const target = ctx.allScenes[block.payload.targetSceneId];
        if (!target) {
            diagnostic(ctx, "error", block.id, `Jump target scene not found: ${block.payload.targetSceneId || "(empty)"}`);
            return [];
        }
        const chain = ctx.nlrScene.jumpTo(target, createTransition(block.payload.transition, ctx, block.id) as any);
        return [recordStatement(ctx, chain, block)];
    }

    if (block.kind === "code") {
        diagnostic(ctx, "warning", block.id, "Code/Script blocks are not part of the NLR Story action surface and were skipped.");
        return [];
    }

    return [];
}

/**
 * Compile a preview target block's OWN statements (no trailing children): the action that plays
 * live on the pre-posed snapshot stage. Container targets (choice, condition, control, nvl) keep
 * their full body so the row previews as the real construct — e.g. a choice target renders its
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
        if (!segment.value.trim() && !segmentHasInterpolation(segment)) {
            return [];
        }
        return [recordStatement(ctx, Narrator.say(buildLocalizedSentencePrompt(ctx, segment, block.id) as any), block, segment.textId)];
    }

    if (block.payload.action === "dialogue") {
        const text = block.payload.text.value;
        if (!text.trim() && !segmentHasInterpolation(block.payload.text)) {
            return [];
        }
        const character = getCharacter(ctx, block.payload.characterId);
        const voiceUrl = block.payload.voiceAssetId
            ? await resolveAsset(ctx, block.payload.voiceAssetId, "audio", block.id)
            : null;
        const config: Record<string, unknown> = {};
        if (voiceUrl) {
            config.voice = Sound.voice(voiceUrl);
        }
        if (block.payload.pauseAfter !== undefined) {
            config.pause = block.payload.pauseAfter;
        }
        const sayConfig = Object.keys(config).length > 0 ? (config as any) : undefined;
        return [recordStatement(ctx, character.say(buildLocalizedSentencePrompt(ctx, block.payload.text, block.id) as any, sayConfig), block, block.payload.text.textId)];
    }

    return [];
}

/** Build an NLR sentence prompt from a text segment: a plain string, or Word/Pause tokens. */
function buildSentencePrompt(segment: StoryTextSegment, ctx: SceneCompileContext, blockId: string): string | unknown[] {
    return buildSentenceParts(segment, ctx, blockId).prompt;
}

/**
 * Build the sentence prompt and, alongside it, the compiled interpolation Words in
 * segment order — the `{n}` placeholder targets when a translation renders instead.
 */
function buildSentenceParts(
    segment: StoryTextSegment,
    ctx: SceneCompileContext,
    blockId: string,
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
 * their plain compiled form — zero overhead.
 */
function buildLocalizedSentencePrompt(ctx: SceneCompileContext, segment: StoryTextSegment, blockId: string): string | unknown[] {
    const { prompt, interpolationWords } = buildSentenceParts(segment, ctx, blockId);
    const localization = ctx.localization;
    if (!localization || !localization.hasTranslation(segment.textId)) {
        return prompt;
    }
    const textId = segment.textId;
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

/**
 * Assemble the shared compile input for a scene's Story Action Blueprints — used by both block-level
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
        blueprintId,
        nlrScene: ctx.nlrScene,
        sceneFnCatalog: ctx.sceneFnCatalog,
        sceneVariables: ctx.scene.sceneVariables ?? {},
        savedVariables: ctx.document.savedVariables ?? {},
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
    const target = interp.target;
    if (target.scope === "scene") {
        const def = ctx.scene.sceneVariables?.[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Scene variable not found; interpolation skipped.");
            return null;
        }
        return applyInterpolationWordMarks(ctx.nlrScene.local.toWord(def.storageKey as any), marks);
    }
    if (target.scope === "saved") {
        const def = ctx.document.savedVariables?.[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Saved variable not found; interpolation skipped.");
            return null;
        }
        return applyInterpolationWordMarks(ctx.savedPersistent.toWord(def.storageKey as any), marks);
    }
    // Persistent (app-level): a dynamic word reading the shared host snapshot synchronously.
    const persistence = ctx.persistence;
    if (!persistence) {
        diagnostic(ctx, "warning", blockId, "Persistent variables require Dev Mode host persistence; interpolation skipped.");
        return null;
    }
    const storageKey = target.storageKey;
    return applyInterpolationWordMarks(new Word(((() => {
        const value = persistence.get(storageKey);
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
        const chain = setVariable(ctx, payload.target, payload.value, block.id);
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

    return [];
}

async function compileCharacterStageAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "character" }>,
): Promise<NlrStatement[]> {
    const name = getCharacterStageObjectName(payload);
    const statements: NlrStatement[] = [];

    if (payload.operation === "exit") {
        const image = getImage(ctx, name, { autoFit: true });
        const chain = compileDisplayableOperation(image, "hide", payload.transform ?? { preset: "fadeOut", durationMs: 250 }, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
        return statements;
    }

    if (payload.operation === "move") {
        const image = getImage(ctx, name, { autoFit: true });
        const chain = compileDisplayableOperation(image, "transform", payload.transform, ctx, block.id);
        if (chain) statements.push(recordStatement(ctx, chain, block));
        return statements;
    }

    const src = payload.assetId
        ? await resolveAsset(ctx, payload.assetId, "image", block.id)
        : await resolveCharacterImageUrl(ctx, payload.characterId, payload.formName, payload.variants, block.id);
    if (!src) {
        diagnostic(ctx, "warning", block.id, `Character image source not found for ${payload.characterId || name}.`);
        return statements;
    }

    const image = getImage(ctx, name, { autoFit: true, src });
    if (payload.operation === "enter") {
        // An entering character has no prior image to transition from, so `enter` never uses a
        // transition — its entrance is driven entirely by the show transform. (A transition only
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

async function compileAudioAction(
    ctx: SceneCompileContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "audio" }>,
): Promise<NlrStatement[]> {
    if (payload.operation === "setBgm") {
        if (!payload.assetId) {
            return [recordStatement(ctx, ctx.nlrScene.setBackgroundMusic(null, payload.fadeMs), block)];
        }
        const url = await resolveAsset(ctx, payload.assetId, "audio", block.id);
        if (!url) {
            return [];
        }
        const sound = Sound.bgm({ src: url, loop: payload.loop ?? true, volume: payload.volume ?? 1 });
        return [recordStatement(ctx, ctx.nlrScene.setBackgroundMusic(sound, payload.fadeMs), block)];
    }

    const sound = await getSound(ctx, payload.objectName || payload.assetId || "sound", payload.assetId, block.id, payload);
    if (!sound) {
        return [];
    }

    switch (payload.operation) {
        case "playSound":
            return [recordStatement(ctx, sound.play(payload.fadeMs), block)];
        case "stopSound":
            return [recordStatement(ctx, sound.stop(payload.fadeMs), block)];
        case "pauseSound":
            return [recordStatement(ctx, sound.pause(payload.fadeMs), block)];
        case "resumeSound":
            return [recordStatement(ctx, sound.resume(payload.fadeMs), block)];
        case "setVolume":
            return [recordStatement(ctx, sound.setVolume(payload.volume ?? 1, payload.fadeMs), block)];
        case "setRate":
            return [recordStatement(ctx, sound.setRate(payload.rate ?? 1), block)];
        case "muteSound":
            return [recordStatement(ctx, sound.mute(payload.muted ?? true), block)];
        default:
            return [];
    }
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
    // `create` names a new custom layer; every other op resolves an existing layer — a built-in
    // (background / displayable) or a custom one — via the target ref (falling back to the default
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
    return [];
}

async function compileChoice(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "nodeAction" }>): Promise<NlrStatement[]> {
    if (block.payload.action !== "choice") {
        return [];
    }
    const choiceBlocks = block.childrenIds
        .map(childId => ctx.scene.blocks[childId])
        .filter((child): child is Extract<StoryBlock, { kind: "nodeAction" }> => child?.kind === "nodeAction" && child.payload.action === "choiceOption");

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
        .filter((child): child is Extract<StoryBlock, { kind: "control" }> => child?.kind === "control" && child.payload.control === "conditionBranch");

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

function getCharacter(ctx: SceneCompileContext, characterId: string | undefined): Character {
    const normalizedId = characterId?.trim() || UNKNOWN_CHARACTER_ID;
    const existing = ctx.characters.get(normalizedId);
    if (existing) {
        return existing;
    }
    // Two things this fallback must never produce. An empty name makes the Character
    // indistinguishable from NLR's Narrator (`Narrator = new Character(null)` collapses to
    // `state.name === ""`), so `useDialog` reports a real character as `isNarrator` and the avatar
    // silently disappears. `normalizedId` is a characterId UUID, which must never reach the UI.
    // Identity is keyed on `normalizedId` above, so this string is cosmetic only.
    const displayName = ctx.characterSummaries.get(normalizedId)?.name?.trim() || UNKNOWN_CHARACTER_NAME;
    const character = new Character(displayName);
    ctx.characters.set(normalizedId, character);
    return character;
}

function getImage(ctx: SceneCompileContext, objectName: string, options?: { layer?: Layer; autoFit?: boolean; src?: string; initialProps?: Record<string, unknown> }): Image {
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
        return existing;
    }
    if (!assetId) {
        diagnostic(ctx, "warning", blockId, `Sound "${name}" has no asset.`);
        return null;
    }
    const url = await resolveAsset(ctx, assetId, "audio", blockId);
    if (!url) {
        return null;
    }
    const sound = Sound.sound({
        src: url,
        loop: payload.loop ?? false,
        volume: payload.volume ?? 1,
        rate: payload.rate ?? 1,
    });
    ctx.sounds.set(name, sound);
    return sound;
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
    if (kind === "character") return ctx.images.get(normalized) ?? null;
    return null;
}

const DISPLAYABLE_EFFECT_OPS = new Set([
    "mask", "clearMask", "clip", "clearClip", "filter", "clearFilter", "darken", "circleReveal", "circleClose", "wipe",
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
    if (transition.kind === "dissolve") {
        return new Dissolve(duration, easing);
    }
    if (transition.kind === "fadeIn") {
        const props = transition.props ?? {};
        return new FadeIn(duration, [numberProp(props, "x", 0), numberProp(props, "y", 0)], easing);
    }
    if (transition.kind === "maskCircle") {
        const props = transition.props ?? {};
        return MaskTransition.circle({
            duration,
            easing,
            center: stringProp(props, "center", "50% 50%"),
            from: numberProp(props, "from", 0),
            to: numberProp(props, "to", 150),
        });
    }
    if (transition.kind === "maskWipe") {
        const props = transition.props ?? {};
        // NOTE: NLR's MaskTransition.wipe `reverse` does not flip the wipe
        // direction — it wipes the *new* background out to nothing, which (since
        // setBackground discards the old background) ends on a black frame. It is
        // never a valid "reveal", so we always reveal (no reverse) here.
        return MaskTransition.wipe({
            duration,
            easing,
            direction: stringProp(props, "direction", "left") as any,
        });
    }
    if (transition.kind === "softWipe") {
        const props = transition.props ?? {};
        return new SoftWipe(
            duration,
            stringProp(props, "direction", "left") as WipeDirection,
            numberProp(props, "feather", 12),
            easing,
        );
    }
    if (transition.kind === "blinds") {
        const props = transition.props ?? {};
        return new Blinds(
            duration,
            stringProp(props, "orientation", "horizontal") as BlindsOrientation,
            numberProp(props, "slats", 8),
            easing,
        );
    }
    if (transition.kind === "slide") {
        const props = transition.props ?? {};
        return new Slide(duration, stringProp(props, "direction", "left") as WipeDirection, easing);
    }
    if (transition.kind === "softIris") {
        const props = transition.props ?? {};
        return new SoftIris(duration, stringProp(props, "center", "50% 50%"), numberProp(props, "feather", 12), easing);
    }
    if (transition.kind === "blurDissolve") {
        const props = transition.props ?? {};
        return new BlurDissolve(duration, numberProp(props, "blur", 16), easing);
    }
    if (transition.kind === "throughColor") {
        const props = transition.props ?? {};
        return new ThroughColor(
            duration,
            stringProp(props, "pattern", "plain") as ThroughColorPattern,
            stringProp(props, "color", "#000"),
            numberProp(props, "hold", 30) / 100,
            {
                direction: stringProp(props, "direction", "left") as WipeDirection,
                feather: numberProp(props, "feather", 12),
                orientation: stringProp(props, "orientation", "horizontal") as BlindsOrientation,
                slats: numberProp(props, "slats", 8),
                center: stringProp(props, "center", "50% 50%"),
            },
            easing,
        );
    }
    diagnostic(ctx, "warning", blockId, `Transition "${transition.kind}" is not supported by public NLR imports yet.`);
    return undefined;
}

function setVariable(ctx: SceneCompileContext, target: StoryVariableRef, value: StoryLiteralValue, blockId: string): NlrStatement | null {
    if (target.scope === "scene") {
        const def = ctx.scene.sceneVariables?.[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Scene variable not found; the assignment was skipped.");
            return null;
        }
        return ctx.nlrScene.local.set(def.storageKey, value as any);
    }
    if (target.scope === "saved") {
        const def = ctx.document.savedVariables?.[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Saved variable not found; the assignment was skipped.");
            return null;
        }
        return ctx.savedPersistent.set(def.storageKey, value as any);
    }
    // Persistent (app-level, host-managed, shared with UI blueprints).
    const persistence = ctx.persistence;
    if (!persistence) {
        diagnostic(ctx, "warning", blockId, "Persistent variables require Dev Mode host persistence and were skipped.");
        return null;
    }
    const storageKey = target.storageKey;
    return Script.execute(() => {
        void persistence.set(storageKey, value);
    });
}

function conditionToLambda(ctx: SceneCompileContext, condition: StoryConditionRef | undefined, blockId: string): NlrCondition | undefined {
    if (!condition) {
        return undefined;
    }
    if (condition.kind === "expression") {
        diagnostic(ctx, "warning", blockId, "Expression condition was skipped because raw script is outside the NLR Story action surface.");
        return falseCondition;
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
        return persistentCondition(ctx, target.storageKey, condition.operator, condition.value);
    }
    let persistent: Persistent<any>;
    let storageKey: string;
    if (target.scope === "scene") {
        const def = ctx.scene.sceneVariables?.[target.variableId];
        if (!def) {
            diagnostic(ctx, "warning", blockId, "Scene variable not found; condition evaluates false.");
            return falseCondition;
        }
        persistent = ctx.nlrScene.local as Persistent<any>;
        storageKey = def.storageKey;
    } else {
        const def = ctx.document.savedVariables?.[target.variableId];
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
    return () => {
        const current = persistence.get(storageKey);
        switch (operator) {
            case "isTrue":
                return current === true;
            case "isFalse":
                return current === false;
            case "equals":
                return current === value;
            case "notEquals":
                return current !== value;
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

async function resolveCharacterImageUrl(
    ctx: SceneCompileContext,
    characterId: string | undefined,
    formName: string | undefined,
    variants: StoryCharacterVariantSelection | undefined,
    blockId: string,
): Promise<string | null> {
    if (!characterId) {
        return null;
    }
    const summary = ctx.characterSummaries.get(characterId);
    const forms = summary?.forms ?? [];
    const form = forms.find(candidate => candidate.name === formName)
        ?? forms.find(candidate => candidate.name === summary?.defaultForm)
        ?? forms[0];
    if (!form) {
        return null;
    }
    const variantNames = selectCharacterVariantNames(form, variants);
    for (const variantName of variantNames) {
        const assetId = form.variantAssets?.[variantName]?.assetId;
        if (assetId) {
            return resolveAsset(ctx, assetId, "image", blockId);
        }
    }
    const firstAsset = Object.values(form.variantAssets ?? {}).find(asset => asset.assetId)?.assetId;
    return firstAsset ? resolveAsset(ctx, firstAsset, "image", blockId) : null;
}

function selectCharacterVariantNames(
    form: NonNullable<DevModeCharacterSummary["forms"]>[number],
    variants: StoryCharacterVariantSelection | undefined,
): string[] {
    if (Array.isArray(variants)) {
        return variants;
    }
    const selected: string[] = [];
    for (const group of form.groups ?? []) {
        const explicit = variants?.[group.name];
        const fallback = group.defaultVariant ?? group.variants?.[0]?.name;
        if (explicit || fallback) {
            selected.push(explicit || fallback);
        }
    }
    return selected;
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




