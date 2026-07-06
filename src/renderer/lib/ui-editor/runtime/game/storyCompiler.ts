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
    Sound,
    Story,
    Text,
    Transform,
    Video,
    Word,
} from "narraleaf-react";
import { blink, vignette } from "narraleaf-react/built-in";
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
    StoryDocument,
    StoryLiteralValue,
    StoryScene,
    StoryTextMarks,
    StoryTextSegment,
    StoryTransitionRef,
    StoryTransformSequenceProps,
    StoryTransformRef,
    StoryVariableRef,
} from "@shared/types/story";
import { parseStoryEasing } from "@shared/utils/storyEasing";

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
type NlrCondition = Lambda<boolean> | (() => boolean);

export type CompiledNlrStory = {
    story: Story;
    scene: Scene;
    scenes: Record<string, Scene>;
    storyId: string;
    sceneId: string;
    actionIdBindings: NlrActionIdBinding[];
    diagnostics: NlrStoryCompileDiagnostic[];
};

type SceneCompileContext = {
    document: StoryDocument;
    nlrStory: Story;
    scene: StoryScene;
    nlrScene: Scene;
    allScenes: Record<string, Scene>;
    characters: Map<string, Character>;
    characterSummaries: Map<string, DevModeCharacterSummary>;
    persistentByNamespace: Map<string, Persistent<Record<string, StoryLiteralValue>>>;
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
};

const EMPTY_IMAGE_SRC = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'></svg>";
const SCENE_INITIAL_BACKGROUND_BLOCK_ID = "__scene_initial_background";
const EMPTY_STORY_ID = "__nlr_empty_story__";
const EMPTY_SCENE_ID = "__nlr_empty_scene__";

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
    const characters = new Map<string, Character>();
    const characterSummaries = new Map((input.characters ?? []).map(character => [character.id, character]));
    const animations = new Map(Object.entries(input.animations ?? {}));
    const persistentByNamespace = new Map<string, Persistent<Record<string, StoryLiteralValue>>>();
    const assetUrlCache = new Map<string, string | null>();
    let actionIndex = 0;
    const resolveAssetUrl = input.resolveAssetUrl ?? ((assetId: string) => assetId);
    const allScenes = await createNlrScenes({
        document: input.document,
        resolveAssetUrl,
        assetUrlCache,
        diagnostics,
    });

    for (const persistent of Object.values(input.document.gamePersistents ?? {})) {
        const namespace = normalizePersistentNamespace(persistent.namespace);
        const nlrPersistent = nlrStory.createPersistent(namespace, persistent.defaultContent ?? {});
        persistentByNamespace.set(namespace, nlrPersistent);
    }

    for (const scene of Object.values(input.document.scenes)) {
        const nlrScene = allScenes[scene.id];
        const ctx: SceneCompileContext = {
            document: input.document,
            nlrStory,
            scene,
            nlrScene,
            allScenes,
            characters,
            characterSummaries,
            persistentByNamespace,
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
    };
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

async function compileNodeAction(ctx: SceneCompileContext, block: Extract<StoryBlock, { kind: "nodeAction" }>): Promise<NlrStatement[]> {
    if (block.payload.action === "narration") {
        const segment = block.payload.text;
        if (!segment.value.trim()) {
            return [];
        }
        return [recordStatement(ctx, Narrator.say(buildSentencePrompt(segment) as any), block, segment.textId)];
    }

    if (block.payload.action === "dialogue") {
        const text = block.payload.text.value;
        if (!text.trim()) {
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
        return [recordStatement(ctx, character.say(buildSentencePrompt(block.payload.text) as any, sayConfig), block, block.payload.text.textId)];
    }

    return [];
}

/** Build an NLR sentence prompt from a text segment: a plain string, or Word/Pause tokens. */
function buildSentencePrompt(segment: StoryTextSegment): string | unknown[] {
    if (!segment.rich || segment.rich.length === 0) {
        return segment.value;
    }
    const prompt: unknown[] = [];
    for (const run of segment.rich) {
        if ("pause" in run) {
            prompt.push(run.pause === true ? new Pause() : Pause.wait(run.pause));
            continue;
        }
        if (!run.text) {
            continue;
        }
        prompt.push(buildWord(run.text, run.marks));
    }
    return prompt.length > 0 ? prompt : segment.value;
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
        const target = getDisplayable(ctx, payload.target.name, payload.target.kind);
        if (!target) {
            diagnostic(ctx, "warning", block.id, `Displayable target not found: ${payload.target.name || "(empty)"}`);
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
    const image = getImage(ctx, payload.objectName, payload);
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
    const text = getText(ctx, payload.objectName, payload);
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
    const layer = getLayer(ctx, payload.objectName, payload.zIndex);
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

    let chain: any = Menu.prompt(block.payload.prompt?.value ?? null);
    for (const option of choiceBlocks) {
        if (option.payload.action !== "choiceOption") {
            continue;
        }
        chain = chain.choose({
            prompt: option.payload.text.value || "Option",
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
    const normalizedId = characterId?.trim() || "__unknown_character__";
    const existing = ctx.characters.get(normalizedId);
    if (existing) {
        return existing;
    }
    const displayName = ctx.characterSummaries.get(normalizedId)?.name ?? (normalizedId === "__unknown_character__" ? "Unknown" : normalizedId);
    const character = new Character(displayName);
    ctx.characters.set(normalizedId, character);
    return character;
}

function getImage(ctx: SceneCompileContext, objectName: string, options?: { layerName?: string; autoFit?: boolean; src?: string }): Image {
    const name = normalizeObjectName(objectName);
    const existing = ctx.images.get(name);
    if (existing) {
        if (options?.layerName) {
            existing.useLayer(getLayer(ctx, options.layerName));
        }
        return existing;
    }
    const image = new Image({
        name,
        src: options?.src ?? EMPTY_IMAGE_SRC,
        autoFit: options?.autoFit ?? false,
        layer: options?.layerName ? getLayer(ctx, options.layerName) : undefined,
    });
    ctx.images.set(name, image);
    return image;
}

function getText(ctx: SceneCompileContext, objectName: string, payload: Extract<StoryActionPayload, { action: "text" }>): Text {
    const name = normalizeObjectName(objectName);
    const existing = ctx.texts.get(name);
    if (existing) {
        if (payload.layerName) {
            existing.useLayer(getLayer(ctx, payload.layerName));
        }
        return existing;
    }
    const text = new Text(payload.text ?? "", {
        fontSize: payload.fontSize ?? 32,
        fontColor: (payload.fontColor ?? "#ffffff") as any,
        layer: payload.layerName ? getLayer(ctx, payload.layerName) : undefined,
    });
    ctx.texts.set(name, text);
    return text;
}

function getLayer(ctx: SceneCompileContext, objectName: string, zIndex = 0): Layer {
    const name = normalizeObjectName(objectName);
    const existing = ctx.layers.get(name);
    if (existing) {
        return existing;
    }
    const layer = new Layer(name, { zIndex });
    ((ctx.nlrScene as unknown as { config: { layers: Layer[] } }).config.layers).push(layer);
    ctx.layers.set(name, layer);
    return layer;
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
    if (!transform) {
        return {};
    }
    if (transform.mode === "animation") {
        return {};
    }
    const preset = transform.preset ?? "none";
    if (preset === "none" || preset === "fadeIn" || preset === "fadeOut") {
        return {};
    }

    const props = transform.props ?? {};
    const inlineProps: Record<string, unknown> = {};
    const position = getPresetPosition(preset, props);
    if (position) {
        inlineProps.position = position;
    }

    const explicitZoom = optionalNumberProp(props, "zoom");
    if (explicitZoom !== undefined) {
        inlineProps.zoom = explicitZoom;
    }
    if (preset === "zoom") {
        inlineProps.zoom = explicitZoom ?? 1;
        return inlineProps;
    }
    if (preset === "scale") {
        const scale = numberProp(props, "scale", 1);
        inlineProps.scaleX = numberProp(props, "scaleX", scale);
        inlineProps.scaleY = numberProp(props, "scaleY", scale);
        return inlineProps;
    }
    if (preset === "rotate") {
        inlineProps.rotation = numberProp(props, "rotation", numberProp(props, "degrees", 0));
        return inlineProps;
    }
    if (preset === "opacity") {
        inlineProps.opacity = numberProp(props, "opacity", 1);
        return inlineProps;
    }
    if (preset === "darken") {
        inlineProps.filter = `brightness(${1 - numberProp(props, "darkness", 0.5)})`;
        return inlineProps;
    }
    if (preset === "circleReveal" || preset === "circleClose" || preset === "wipe") {
        diagnostic(ctx, "warning", blockId, `${preset} transforms cannot be folded into character show yet.`);
    }
    return inlineProps;
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

function timelineToNlrTransformSequences(timeline: StoryAnimationTimeline): { props: Record<string, unknown>; options: Record<string, unknown> }[] {
    const groups = new Map<string, {
        startMs: number;
        durationMs: number;
        props: Record<string, unknown>;
        options: Record<string, unknown>;
    }>();
    for (const track of timeline.tracks) {
        const keyframes = [...track.keyframes].sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
        let previousTimeMs = 0;
        for (const keyframe of keyframes) {
            const startMs = Math.max(0, previousTimeMs);
            const endMs = Math.max(startMs, keyframe.timeMs);
            const durationMs = endMs - startMs;
            const props = keyframeToTransformProps(track, keyframe);
            previousTimeMs = endMs;
            if (Object.keys(props).length === 0) {
                continue;
            }
            const groupKey = `${startMs}:${durationMs}:${keyframe.easing ?? ""}`;
            const group = groups.get(groupKey) ?? {
                startMs,
                durationMs,
                props: {},
                options: cleanObject({
                    duration: durationMs,
                    ease: parseStoryEasing(keyframe.easing),
                    at: startMs,
                }),
            };
            group.props = {
                ...group.props,
                ...props,
            };
            groups.set(groupKey, group);
        }
    }
    const sequences = [...groups.values()]
        .sort((a, b) => a.startMs - b.startMs || a.durationMs - b.durationMs)
        .map(group => ({
            props: group.props,
            options: group.options,
        }));
    return sequences.length > 0 ? sequences : [{ props: {}, options: { duration: 0 } }];
}

function keyframeToTransformProps(track: StoryAnimationTrack, keyframe: StoryAnimationKeyframe): Record<string, unknown> {
    const props: StoryTransformSequenceProps = {};
    if (track.property === "position" && keyframe.value && typeof keyframe.value === "object") {
        props.position = keyframe.value as StoryTransformSequenceProps["position"];
    } else if (isNumericTrackProperty(track.property) && typeof keyframe.value === "number") {
        (props as Record<string, unknown>)[track.property] = keyframe.value;
    } else if (typeof keyframe.value === "string") {
        (props as Record<string, unknown>)[track.property] = keyframe.value;
    }
    return cleanTransformSequenceProps(props);
}

function isNumericTrackProperty(property: StoryAnimationTrackProperty): boolean {
    return property === "opacity"
        || property === "zoom"
        || property === "scaleX"
        || property === "scaleY"
        || property === "rotation";
}

function toNlrTransformSequence(sequence: StoryAnimationSequence): { props: Record<string, unknown>; options: Record<string, unknown> } {
    return {
        props: cleanTransformSequenceProps(sequence.props),
        options: cleanTransformSequenceOptions(sequence),
    };
}

function cleanTransformSequenceProps(props: StoryTransformSequenceProps): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    if (props.position) {
        const position = cleanObject({
            xalign: props.position.xalign,
            yalign: props.position.yalign,
            xoffset: props.position.xoffset,
            yoffset: props.position.yoffset,
        });
        if (Object.keys(position).length > 0) {
            next.position = position;
        }
    }
    assignDefined(next, "opacity", props.opacity);
    assignDefined(next, "zoom", props.zoom);
    assignDefined(next, "scaleX", props.scaleX);
    assignDefined(next, "scaleY", props.scaleY);
    assignDefined(next, "rotation", props.rotation);
    assignDefined(next, "fontColor", props.fontColor);
    assignDefined(next, "maskImage", props.maskImage);
    assignDefined(next, "maskSize", props.maskSize);
    assignDefined(next, "maskPosition", props.maskPosition);
    assignDefined(next, "maskRepeat", props.maskRepeat);
    assignDefined(next, "maskMode", props.maskMode);
    assignDefined(next, "clipPath", props.clipPath);
    assignDefined(next, "filter", props.filter);
    assignDefined(next, "backdropFilter", props.backdropFilter);
    assignDefined(next, "mixBlendMode", props.mixBlendMode);
    return next;
}

function cleanTransformSequenceOptions(sequence: StoryAnimationSequence): Record<string, unknown> {
    const options = sequence.options ?? {};
    const next: Record<string, unknown> = {};
    assignDefined(next, "duration", options.durationMs);
    assignDefined(next, "ease", parseStoryEasing(options.easing));
    assignDefined(next, "delay", options.delayMs);
    assignDefined(next, "at", options.at);
    return next;
}

function injectVisibilityDefault(sequences: { props: Record<string, unknown>; options: Record<string, unknown> }[], visibility: VisibilityTransformMode): void {
    if (visibility === "none" || sequences.length === 0) {
        return;
    }
    const opacity = visibility === "show" ? 1 : 0;
    const last = sequences[sequences.length - 1];
    if (last.props.opacity === undefined) {
        last.props = {
            ...last.props,
            opacity,
        };
    }
}

function cleanObject(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function assignDefined(target: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined) {
        target[key] = value;
    }
}

type StoryAlignPosition = {
    xalign: number;
    yalign: number;
    xoffset?: number;
    yoffset?: number;
};

function getPresetPosition(preset: string, props: Record<string, StoryLiteralValue>): StoryAlignPosition | null {
    const xalign = optionalNumberProp(props, "xalign") ?? optionalNumberProp(props, "x");
    const yalign = optionalNumberProp(props, "yalign") ?? optionalNumberProp(props, "y") ?? 0.5;
    const xoffset = optionalNumberProp(props, "xoffset") ?? optionalNumberProp(props, "xOffset");
    const yoffset = optionalNumberProp(props, "yoffset") ?? optionalNumberProp(props, "yOffset");
    const withOffsets = (position: { xalign: number; yalign: number }): StoryAlignPosition => ({
        ...position,
        ...(xoffset !== undefined ? { xoffset } : {}),
        ...(yoffset !== undefined ? { yoffset } : {}),
    });

    if (preset === "left" || preset === "center" || preset === "right" || preset === "custom") {
        const targetX = preset === "left" ? 0.25 : preset === "right" ? 0.75 : preset === "center" ? 0.5 : xalign ?? 0.5;
        return withOffsets({ xalign: targetX, yalign });
    }
    if (preset === "slideLeft") return withOffsets({ xalign: xalign ?? 0.25, yalign });
    if (preset === "slideRight") return withOffsets({ xalign: xalign ?? 0.75, yalign });
    if (preset === "slideUp") return withOffsets({ xalign: xalign ?? 0.5, yalign: yalign ?? 0.7 });
    if (preset === "slideDown") return withOffsets({ xalign: xalign ?? 0.5, yalign: yalign ?? 0.3 });
    return null;
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
        return MaskTransition.wipe({
            duration,
            easing,
            direction: stringProp(props, "direction", "left") as any,
            reverse: boolProp(props, "reverse", false),
        });
    }
    diagnostic(ctx, "warning", blockId, `Transition "${transition.kind}" is not supported by public NLR imports yet.`);
    return undefined;
}

function setVariable(ctx: SceneCompileContext, target: StoryVariableRef, value: StoryLiteralValue, blockId: string): NlrStatement | null {
    if (target.scope === "studioGlobal") {
        diagnostic(ctx, "warning", blockId, `studioGlobal variable "${target.key}" is editor-only and was not written to NLR runtime.`);
        return null;
    }
    if (target.scope === "sceneLocal") {
        return ctx.nlrScene.local.set(target.key, value as any);
    }
    return getPersistent(ctx, target.namespace).set(target.key, value as any);
}

function conditionToLambda(ctx: SceneCompileContext, condition: StoryConditionRef | undefined, blockId: string): NlrCondition | undefined {
    if (!condition) {
        return undefined;
    }
    if (condition.kind === "expression") {
        diagnostic(ctx, "warning", blockId, "Expression condition was skipped because raw script is outside the NLR Story action surface.");
        return falseCondition;
    }
    if (condition.target.scope === "studioGlobal") {
        diagnostic(ctx, "warning", blockId, `studioGlobal condition "${condition.target.key}" is editor-only and evaluates false in NLR.`);
        return falseCondition;
    }
    const persistent = (
        condition.target.scope === "sceneLocal"
            ? ctx.nlrScene.local
            : getPersistent(ctx, condition.target.namespace)
    ) as Persistent<any>;
    switch (condition.operator) {
        case "isTrue":
            return persistent.isTrue(condition.target.key);
        case "isFalse":
            return persistent.isFalse(condition.target.key);
        case "equals":
            return persistent.equals(condition.target.key, condition.value as any);
        case "notEquals":
            return persistent.notEquals(condition.target.key, condition.value as any);
        case "exists":
            return persistent.isNotNull(condition.target.key);
        default:
            return falseCondition;
    }
}

function falseCondition(): boolean {
    return false;
}

function getPersistent(ctx: SceneCompileContext, namespace: string | undefined): Persistent<Record<string, StoryLiteralValue>> {
    const normalized = normalizePersistentNamespace(namespace);
    const existing = ctx.persistentByNamespace.get(normalized);
    if (existing) {
        return existing;
    }
    const definition = Object.values(ctx.document.gamePersistents ?? {}).find(candidate => normalizePersistentNamespace(candidate.namespace) === normalized);
    const persistent = new Persistent(normalized, definition?.defaultContent ?? {});
    ctx.persistentByNamespace.set(normalized, persistent);
    ctx.nlrStory.registerPersistent(persistent);
    return persistent;
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

function normalizeObjectName(value: string | undefined): string {
    const normalized = value?.trim();
    return normalized || "object";
}

function getCharacterStageObjectName(payload: Extract<StoryActionPayload, { action: "character" }>): string {
    const explicitName = payload.objectName?.trim();
    if (explicitName && explicitName !== "character") {
        return normalizeObjectName(explicitName);
    }
    return normalizeObjectName(payload.characterId || explicitName || "character");
}

function normalizePersistentNamespace(namespace: string | undefined): string {
    return namespace?.trim() || "story";
}

function numberProp(props: Record<string, StoryLiteralValue>, key: string, fallback: number | undefined): number {
    return optionalNumberProp(props, key) ?? fallback ?? 0;
}

function optionalNumberProp(props: Record<string, StoryLiteralValue>, key: string): number | undefined {
    const value = props[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function stringProp(props: Record<string, StoryLiteralValue>, key: string, fallback: string): string {
    const value = props[key];
    return typeof value === "string" && value.trim() ? value : fallback;
}

function boolProp(props: Record<string, StoryLiteralValue>, key: string, fallback: boolean): boolean {
    const value = props[key];
    return typeof value === "boolean" ? value : fallback;
}
