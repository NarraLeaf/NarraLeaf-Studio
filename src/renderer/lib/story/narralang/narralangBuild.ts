/**
 * The inverse of {@link ./narralangExtract}: a {@link NarralangShape} becomes a story block's payload,
 * or a reason it cannot.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * ## Why this file has a switch and the matcher does not
 *
 * The matcher runs the dialect table backwards and knows no statement; this file knows no *word*. A
 * verb is a meaning, and turning a meaning into a payload is per-meaning work - exactly as the
 * extractor's per-payload switch is. The two are mirror images and are meant to be read side by side:
 * every arm here undoes one arm there.
 *
 * ## Refusing is how the language stays unambiguous
 *
 * Seven verbs are spelled `show` in the default dialect, and no arrangement of prepositions tells them
 * apart. What does is the SUBJECT: a name is a character, or an image someone created earlier, or a
 * layer, and each arm here refuses a subject that is not its own. So the matcher may hand over five
 * candidates and four of them fail to build - that is the disambiguation, and it is the same rule
 * `resolveDisplayableTargetRef` already follows for a stored reference.
 *
 * A refusal is never a downgrade to prose. A line that opens with a keyword and does not build is a
 * diagnostic, because turning an author's broken command into a line of narration is how a story
 * silently changes meaning.
 *
 * ## No locale, ever
 *
 * Same rule as the printer: nothing here may call `translate` or read a localised table. Names come
 * from the caller's lookups, which are the mirror of the ones the printer resolves ids through.
 */

import type {
    StoryActionPayload,
    StoryAlignPositionValue,
    StoryBlockId,
    StoryCharacterTagSelection,
    StoryConditionRef,
    StoryControlPayload,
    StoryDeclarationPayload,
    StoryDisplayableTargetRef,
    StoryExpression,
    StoryJumpPayload,
    StoryLayerRef,
    StoryLiteralValue,
    StoryNodeActionPayload,
    StoryNotePayload,
    StoryRichRun,
    StoryTextSegment,
    StoryTransformProps,
    StoryTransformRef,
    StoryTransitionRef,
    StoryVariableRef,
    StoryVfxBlendMode,
} from "@shared/types/story";
import { formatStoryExpressionName } from "@shared/utils/storyExpressionParser";

import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { parseStoryFilter } from "@shared/story/transformProps";
import { applyPlacementToTransform, applyTransitionWordToTransform, transitionKindFor } from "@/apps/workspace/modules/story/scene-editor/commands/transitions";
import { getStoryCameraLensPreset } from "@/lib/ui-editor/runtime/game/cameraLensPresets";
import { getStoryCameraLookPreset } from "@/lib/ui-editor/runtime/game/cameraLookPresets";

import type {
    NarralangSlot,
    NarralangSlots,
    NarralangText,
    NarralangTextRun,
    NarralangValue,
    NarralangVerb,
    NarralangWord,
} from "./narralangShape";

// --- What the builder needs from outside a line ------------------------------------------------------

/**
 * A name-keyed lookup's three outcomes.
 *
 * Three, not two, for the reason the expression language's `StoryExpressionNameResolution` gives: two
 * things answering to one name is a distinct answer from nothing answering to it, and a parser that
 * collapsed them would silently bind a row to whichever the caller happened to list first.
 */
export type NarralangResolution<T> = T | null | "ambiguous";

/** Which appearance a name is on a character - the reverse of `StoryRowLookups.appearanceName`. */
export type NarralangAppearanceRef =
    | { readonly kind: "pose"; readonly id: string }
    | { readonly kind: "tag"; readonly axisId: string; readonly id: string }
    /** A puppet's own state name, which is stored verbatim because the model owns it. */
    | { readonly kind: "puppet" };

/**
 * The mirror of the printer's lookups: every table it reads forwards, read backwards.
 *
 * All optional, and an omitted one is "this caller cannot answer", not "nothing answers" - the same
 * convention the row projection's tables use. The consequence is a diagnostic on the row rather than a
 * guess, because a name the parser cannot resolve has no id to store.
 */
export type NarralangParseLookups = {
    characterId?: (name: string) => NarralangResolution<string>;
    assetId?: (name: string) => NarralangResolution<string>;
    appearanceRef?: (characterId: string, name: string) => NarralangResolution<NarralangAppearanceRef>;
    motionId?: (name: string) => NarralangResolution<string>;
    appTagId?: (name: string) => NarralangResolution<string>;
    sceneId?: (name: string) => NarralangResolution<string>;
    /** A variable declared outside the text being parsed. Declarations inside it always win. */
    variableRef?: (name: string) => NarralangResolution<StoryVariableRef>;
};

/** What a stage name turned out to be - the table the seven `show` verbs are told apart by. */
export type NarralangStageEntry = {
    readonly kind: "image" | "text" | "layer" | "video" | "vfx" | "character";
    /** The block that created it, which is what a stored reference binds to so a rename cannot break it. */
    readonly blockId: StoryBlockId;
};

export type NarralangBuildContext = {
    readonly lookups: NarralangParseLookups;
    /** A stage object created earlier in the same text. */
    readonly stage: (name: string) => NarralangStageEntry | null;
    /** A variable declared in the same text, falling back to the caller's table. */
    readonly variable: (name: string) => NarralangResolution<StoryVariableRef>;
    readonly expression: (source: string) => { expression: StoryExpression; ok: boolean };
    readonly createTextId: () => string;
    /** The block id this draft will be filed under - a declaration's storage key is its own row. */
    readonly blockId: StoryBlockId;
};

export type NarralangBlockDraft =
    | { readonly kind: "nodeAction"; readonly payload: StoryNodeActionPayload }
    | { readonly kind: "action"; readonly payload: StoryActionPayload }
    | { readonly kind: "control"; readonly payload: StoryControlPayload }
    | { readonly kind: "jump"; readonly payload: StoryJumpPayload }
    | { readonly kind: "note"; readonly payload: StoryNotePayload }
    | { readonly kind: "declaration"; readonly payload: StoryDeclarationPayload };

/** Why a shape cannot become a payload. Mirrors {@link NarralangIssueReason} from the other direction. */
export type NarralangBuildFailure =
    /** A name nothing in the project answers to. */
    | "unknownName"
    /** A name several things answer to - the parser must not pick one. */
    | "ambiguousName"
    /** A word outside the vocabulary this slot accepts (`blend bird fade`). */
    | "badWord"
    /** A slot the statement cannot do without. */
    | "missingValue"
    /** Two slots that cannot both be filled - a placement AND a reveal preset are one field. */
    | "conflictingValues";

export type NarralangBuildResult =
    | { readonly ok: true; readonly draft: NarralangBlockDraft; readonly warnings: readonly NarralangBuildWarning[] }
    | { readonly ok: false; readonly reason: NarralangBuildFailure; readonly detail?: string };

export type NarralangBuildWarning = { readonly reason: "badExpression"; readonly detail?: string };

/**
 * How strongly a verb wants a line that several verbs accept.
 *
 * The raw `displayable` channel can address anything with a transform, so it accepts every line the
 * typed verbs do. An author who wrote `show bird` about an image meant the image row - the one the
 * editor's own `/show` writes - so the typed verb wins and the generic one is the fallback.
 */
const VERB_PREFERENCE: Partial<Record<NarralangVerb, number>> = {
    displayableShow: -1,
    displayableHide: -1,
    displayableTransform: -1,
};

export function narralangVerbPreference(verb: NarralangVerb): number {
    return VERB_PREFERENCE[verb] ?? 0;
}

/** The verbs whose row takes children, so a trailing block marker on their line is structure, not text. */
export const NARRALANG_CONTAINER_VERBS: ReadonlySet<NarralangVerb> = new Set<NarralangVerb>([
    "choice",
    "choiceOption",
    "conditionIf",
    "conditionElseIf",
    "conditionElse",
    "sequence",
    "parallel",
    "race",
    "repeat",
]);

// --- Slot readers -------------------------------------------------------------------------------------

const valueOf = (slots: NarralangSlots, slot: NarralangSlot): NarralangValue | undefined => slots[slot];

function nameOf(slots: NarralangSlots, slot: NarralangSlot): string | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "name" ? value.name : undefined;
}

function namesOf(slots: NarralangSlots, slot: NarralangSlot): readonly string[] {
    const value = valueOf(slots, slot);
    return value?.kind === "names" ? value.names : [];
}

function wordOf(slots: NarralangSlots, slot: NarralangSlot): NarralangWord | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "word" || value?.kind === "builtin" ? value.word : undefined;
}

function builtinOf(slots: NarralangSlots, slot: NarralangSlot): NarralangWord | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "builtin" ? value.word : undefined;
}

function numberOf(slots: NarralangSlots, slot: NarralangSlot): number | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "number" ? value.value : undefined;
}

function msOf(slots: NarralangSlots, slot: NarralangSlot): number | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "seconds" ? value.ms : undefined;
}

function stringOf(slots: NarralangSlots, slot: NarralangSlot): string | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "string" ? value.value : undefined;
}

function colorOf(slots: NarralangSlots, slot: NarralangSlot): string | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "color" ? value.value : undefined;
}

function literalOf(slots: NarralangSlots, slot: NarralangSlot): { value: StoryLiteralValue } | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "literal" ? { value: value.value } : undefined;
}

function sourceOf(slots: NarralangSlots, slot: NarralangSlot): string | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "expression" ? value.source : undefined;
}

function textOf(slots: NarralangSlots, slot: NarralangSlot): NarralangText | undefined {
    const value = valueOf(slots, slot);
    return value?.kind === "text" ? value.text : undefined;
}

function pairsOf(slots: NarralangSlots, slot: NarralangSlot): readonly { key: string; value: number }[] {
    const value = valueOf(slots, slot);
    return value?.kind === "pairs" ? value.entries : [];
}

// --- Shared tails ---------------------------------------------------------------------------------------

const PLACEMENTS: ReadonlySet<NarralangWord> = new Set<NarralangWord>(["left", "center", "right"]);

type Fail = { ok: false; reason: NarralangBuildFailure; detail?: string };
const fail = (reason: NarralangBuildFailure, detail?: string): Fail => ({ ok: false, reason, detail });

function isFail(value: unknown): value is Fail {
    return typeof value === "object" && value !== null && (value as Fail).ok === false;
}

/**
 * The transform a row's slots describe - the inverse of the extractor's `transformSlots`.
 *
 * A placement and a reveal preset are the same stored field, so a line carrying both is a line the
 * printer could never have produced. Refusing it is what lets the matcher hand over every reading of
 * `at left with fade 0.3` and get exactly one back: the one where `with` is the ROW's transition.
 */
function transformOf(slots: NarralangSlots, context: "reveal" | "conceal" | "nvl"): StoryTransformRef | undefined | Fail {
    const placement = wordOf(slots, "placement");
    const preset = valueOf(slots, "transformTransition");
    const durationMs = msOf(slots, "transformDuration");
    const easing = nameOf(slots, "transformEasing");
    if (placement !== undefined && preset !== undefined) {
        return fail("conflictingValues", "transform");
    }
    if (placement !== undefined) {
        if (!PLACEMENTS.has(placement)) {
            return fail("badWord", placement);
        }
        return prune({ ...applyPlacementToTransform(undefined, placement), durationMs, easing });
    }
    if (preset !== undefined) {
        if (preset.kind !== "timedWord") {
            return fail("badWord", "transform");
        }
        // The word already states the timing, which is why the extractor never emits both.
        if (durationMs !== undefined) {
            return fail("conflictingValues", "transform");
        }
        const resolved = applyTransitionWordToTransform(undefined, context, preset.word);
        if (!resolved) {
            return fail("badWord", preset.word);
        }
        return prune({ ...resolved, durationMs: preset.ms, easing });
    }
    if (durationMs === undefined && easing === undefined) {
        return undefined;
    }
    return prune({ durationMs, easing });
}

/** The row's own transition - kept apart from the transform's, because one row can carry both. */
function transitionOf(slots: NarralangSlots, context: "scene" | "character"): StoryTransitionRef | undefined | Fail {
    const value = valueOf(slots, "transition");
    const easing = nameOf(slots, "transitionEasing");
    if (value === undefined) {
        return easing === undefined ? undefined : fail("missingValue", "transition");
    }
    if (value.kind !== "timedWord") {
        return fail("badWord", "transition");
    }
    const kind = transitionKindFor(context, value.word);
    if (!kind) {
        return fail("badWord", value.word);
    }
    return prune({ kind, durationMs: value.ms, easing });
}

/** Drop the keys whose value is absent, so a built payload equals the one the printer read. */
function prune<T extends object>(value: T): T {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry !== undefined) {
            out[key] = entry;
        }
    }
    return out as T;
}

// --- References -------------------------------------------------------------------------------------------

type Resolved<T> = { ok: true; value: T } | Fail;

function resolve<T>(result: NarralangResolution<T> | undefined, detail: string): Resolved<T> {
    if (result === "ambiguous") {
        return fail("ambiguousName", detail);
    }
    if (result === null || result === undefined) {
        return fail("unknownName", detail);
    }
    return { ok: true, value: result };
}

function layerRefOf(ctx: NarralangBuildContext, slots: NarralangSlots, slot: NarralangSlot): StoryLayerRef | undefined | Fail {
    const builtin = builtinOf(slots, slot);
    if (builtin !== undefined) {
        if (builtin === "backgroundLayer") {
            return { kind: "default", layer: "background" };
        }
        if (builtin === "stageLayer") {
            return { kind: "default", layer: "displayable" };
        }
        return fail("badWord", builtin);
    }
    const name = nameOf(slots, slot);
    if (name === undefined) {
        return undefined;
    }
    const entry = ctx.stage(name);
    if (!entry || entry.kind !== "layer") {
        return fail("unknownName", "layer");
    }
    return { kind: "custom", sourceBlockId: entry.blockId, name };
}

/** A `displayable` row's target: a stage singleton, or an object some earlier row created. */
function displayableTargetOf(ctx: NarralangBuildContext, slots: NarralangSlots): StoryDisplayableTargetRef | Fail {
    const builtin = builtinOf(slots, "subject");
    if (builtin !== undefined) {
        if (builtin === "background") {
            return { builtin: "background", name: "Scene background", kind: "image" };
        }
        if (builtin === "backgroundLayer") {
            return { builtin: "backgroundLayer", name: "Background layer", kind: "layer" };
        }
        if (builtin === "stageLayer") {
            return { builtin: "displayableLayer", name: "Displayable layer", kind: "layer" };
        }
        return fail("badWord", builtin);
    }
    const name = nameOf(slots, "subject");
    if (name === undefined) {
        return fail("missingValue", "subject");
    }
    const entry = ctx.stage(name);
    if (!entry) {
        return fail("unknownName", "displayable");
    }
    // Video and vfx are Actionables, not Displayables: they carry no transform pipeline at all.
    if (entry.kind === "video" || entry.kind === "vfx") {
        return fail("unknownName", "displayable");
    }
    return { kind: entry.kind, name, sourceBlockId: entry.blockId };
}

/** A stage object of exactly one kind, which is how a `show` line picks its verb. */
function stageObjectOf(ctx: NarralangBuildContext, slots: NarralangSlots, kind: NarralangStageEntry["kind"]): Resolved<string> {
    const name = nameOf(slots, "subject");
    if (name === undefined) {
        return fail("missingValue", "subject");
    }
    const entry = ctx.stage(name);
    if (!entry || entry.kind !== kind) {
        return fail("unknownName", kind);
    }
    return { ok: true, value: name };
}

function conditionOf(ctx: NarralangBuildContext, source: string, warnings: NarralangBuildWarning[]): StoryConditionRef {
    return { kind: "expression", expression: expressionOf(ctx, source, warnings) };
}

function expressionOf(ctx: NarralangBuildContext, source: string, warnings: NarralangBuildWarning[]): StoryExpression {
    const parsed = ctx.expression(source);
    if (!parsed.ok) {
        warnings.push({ reason: "badExpression", detail: source });
    }
    return parsed.expression;
}

// --- Text ------------------------------------------------------------------------------------------------

const ROLES = {
    narration: "narration",
    dialogueText: "dialogue",
    option: "choiceText",
    note: "note",
} as const;

/**
 * A parsed line of author text as a stored segment.
 *
 * `rich` is left off when the runs say nothing a plain string cannot, which is the overwhelming
 * majority of rows and the shape the extractor's own fallback expects. `value` is the plain-text
 * projection the type documents: the text runs, concatenated.
 */
function segmentOf(
    ctx: NarralangBuildContext,
    text: NarralangText | undefined,
    role?: StoryTextSegment["role"],
): StoryTextSegment {
    const runs = text?.runs ?? [];
    const resolvedRole = role ?? ROLES[(text?.context ?? "narration") as keyof typeof ROLES];
    const value = runs.map((run) => ("text" in run ? run.text : "")).join("");
    const plain = runs.length === 0
        || (runs.length === 1 && "text" in runs[0] && runs[0].marks === undefined);
    if (plain) {
        return { textId: ctx.createTextId(), value, role: resolvedRole };
    }
    return { textId: ctx.createTextId(), value, role: resolvedRole, rich: runs.map((run) => richRunOf(ctx, run)) };
}

/**
 * A parsed line of text as a stored segment, for the one row that has no verb.
 *
 * A note is a block kind rather than a statement, so it cannot reach the segment through the verb
 * table the way narration does - and duplicating the run conversion for it is how the two would drift.
 */
export function buildNarralangSegment(
    ctx: NarralangBuildContext,
    text: NarralangText | undefined,
    role: StoryTextSegment["role"],
): StoryTextSegment {
    return segmentOf(ctx, text, role);
}

function richRunOf(ctx: NarralangBuildContext, run: NarralangTextRun): StoryRichRun {
    if ("text" in run) {
        return run.marks === undefined ? { text: run.text } : { text: run.text, marks: run.marks };
    }
    if ("pause" in run) {
        return { pause: run.pause };
    }
    const source = run.interpolation ?? "";
    // A bare name normalizes to a variable interpolation, which is the one representation of "show
    // this variable" the document has - the same rule the expression path applies on the way in.
    const bare = source.startsWith("'") && source.endsWith("'") && source.length > 1
        ? source.slice(1, -1)
        : source;
    const variable = formatStoryExpressionName(bare) === source ? ctx.variable(bare) : null;
    if (variable !== null && variable !== "ambiguous") {
        return run.marks === undefined
            ? { interpolation: { kind: "variable", target: variable } }
            : { interpolation: { kind: "variable", target: variable }, marks: run.marks };
    }
    const expression = ctx.expression(source).expression;
    return run.marks === undefined
        ? { interpolation: { kind: "expression", expression } }
        : { interpolation: { kind: "expression", expression }, marks: run.marks };
}

// --- The builder -------------------------------------------------------------------------------------------

/** One statement as a block draft, or the reason this verb is not what the line said. */
export function buildNarralangBlock(
    ctx: NarralangBuildContext,
    verb: NarralangVerb,
    slots: NarralangSlots,
): NarralangBuildResult {
    const warnings: NarralangBuildWarning[] = [];
    const built = buildDraft(ctx, verb, slots, warnings);
    return isFail(built) ? built : { ok: true, draft: built, warnings };
}

/**
 * A `json` declaration's default, read back from the string the script carries it in.
 *
 * Kept deliberately total: a default that does not parse is left as the string it was written as
 * rather than dropped or turned into a diagnostic. The value is authoring data with no runtime
 * meaning until the variable is read, and refusing the whole declaration over a malformed default
 * would lose the variable itself - which is the thing the rest of the scene refers to.
 */
function jsonDefaultOf(value: StoryLiteralValue | undefined): StoryLiteralValue | undefined {
    if (typeof value !== "string") {
        return value;
    }
    try {
        return JSON.parse(value) as StoryLiteralValue;
    } catch {
        return value;
    }
}

function buildDraft(
    ctx: NarralangBuildContext,
    verb: NarralangVerb,
    slots: NarralangSlots,
    warnings: NarralangBuildWarning[],
): NarralangBlockDraft | Fail {
    switch (verb) {
        // --- Prose -------------------------------------------------------------------------------------
        case "narration":
            return {
                kind: "nodeAction",
                payload: { action: "narration", text: segmentOf(ctx, textOf(slots, "text"), "narration") },
            };
        case "dialogue": {
            const speaker = nameOf(slots, "speaker") ?? "";
            const character = ctx.lookups.characterId?.(speaker);
            if (character === "ambiguous") {
                return fail("ambiguousName", "character");
            }
            const voiceName = nameOf(slots, "voice");
            let voiceAssetId: string | undefined;
            if (voiceName !== undefined) {
                const asset = resolve(ctx.lookups.assetId?.(voiceName), "asset");
                if (isFail(asset)) {
                    return asset;
                }
                voiceAssetId = asset.value;
            }
            const pauseWord = wordOf(slots, "pause");
            const pauseMs = msOf(slots, "pause");
            return {
                kind: "nodeAction",
                payload: prune({
                    action: "dialogue" as const,
                    characterId: character ?? undefined,
                    speakerName: character ? undefined : speaker,
                    text: segmentOf(ctx, textOf(slots, "text"), "dialogue"),
                    voiceAssetId,
                    pauseAfter: pauseWord === "click" ? true : pauseMs,
                }),
            };
        }
        case "choice": {
            const prompt = textOf(slots, "prompt");
            return {
                kind: "nodeAction",
                payload: prune({
                    action: "choice" as const,
                    prompt: prompt === undefined ? undefined : segmentOf(ctx, prompt, "choicePrompt"),
                }),
            };
        }
        case "choiceOption": {
            const showIf = sourceOf(slots, "showIf");
            const enableIf = sourceOf(slots, "enableIf");
            return {
                kind: "nodeAction",
                payload: prune({
                    action: "choiceOption" as const,
                    text: segmentOf(ctx, textOf(slots, "text"), "choiceText"),
                    hiddenWhen: showIf === undefined ? undefined : conditionOf(ctx, showIf, warnings),
                    disabledWhen: enableIf === undefined ? undefined : conditionOf(ctx, enableIf, warnings),
                }),
            };
        }

        // --- Scene -------------------------------------------------------------------------------------
        case "background": {
            const transition = transitionOf(slots, "scene");
            if (isFail(transition)) {
                return transition;
            }
            const color = colorOf(slots, "source");
            const assetName = nameOf(slots, "source");
            let assetId: string | undefined;
            if (color === undefined && assetName !== undefined) {
                const asset = resolve(ctx.lookups.assetId?.(assetName), "asset");
                if (isFail(asset)) {
                    return asset;
                }
                assetId = asset.value;
            }
            return { kind: "action", payload: prune({ action: "setBackground" as const, assetId, color, transition }) };
        }
        case "jump": {
            const transition = transitionOf(slots, "scene");
            if (isFail(transition)) {
                return transition;
            }
            const scene = resolve(ctx.lookups.sceneId?.(nameOf(slots, "scene") ?? ""), "scene");
            if (isFail(scene)) {
                return scene;
            }
            return { kind: "jump", payload: prune({ targetSceneId: scene.value, transition }) };
        }
        case "wait": {
            const word = wordOf(slots, "amount");
            if (word === "click") {
                return { kind: "action", payload: { action: "wait", mode: "click" } };
            }
            const durationMs = msOf(slots, "amount");
            if (durationMs === undefined) {
                return fail("missingValue", "wait");
            }
            return { kind: "action", payload: { action: "wait", mode: "duration", durationMs } };
        }
        case "nvl": {
            const transition = transformOf(slots, "nvl");
            if (isFail(transition)) {
                return transition;
            }
            return { kind: "action", payload: prune({ action: "nvl" as const, transition }) };
        }

        // --- Characters --------------------------------------------------------------------------------
        case "characterEnter":
        case "characterExit":
        case "characterMove":
        case "characterExpression":
        case "characterRename":
        case "characterMotion":
        case "characterSkin":
        case "characterParams":
            return characterDraft(ctx, verb, slots);

        // --- Audio -------------------------------------------------------------------------------------
        case "audioPlay": {
            const channel = wordOf(slots, "channel");
            if (channel !== "bgm" && channel !== "sound") {
                return fail("badWord", "channel");
            }
            const assetName = nameOf(slots, "source");
            if (assetName === undefined) {
                return fail("missingValue", "source");
            }
            const asset = resolve(ctx.lookups.assetId?.(assetName), "asset");
            if (isFail(asset)) {
                return asset;
            }
            const loop = wordOf(slots, "loop");
            if (loop !== undefined && loop !== "loop" && loop !== "once") {
                return fail("badWord", loop);
            }
            return {
                kind: "action",
                payload: prune({
                    action: "audio" as const,
                    operation: channel === "bgm" ? ("setBgm" as const) : ("playSound" as const),
                    assetId: asset.value,
                    objectName: nameOf(slots, "handle"),
                    volume: numberOf(slots, "volume"),
                    fadeMs: msOf(slots, "fadeIn"),
                    loop: loop === undefined ? undefined : loop === "loop",
                    rate: numberOf(slots, "rate"),
                }),
            };
        }
        case "audioStop":
        case "audioPause":
        case "audioResume":
        case "audioVolume":
        case "audioRate":
        case "audioMute":
        case "audioUnmute":
        case "audioSeek":
            return audioDraft(verb, slots);

        // --- Data --------------------------------------------------------------------------------------
        case "variableSet": {
            const target = resolve(ctx.variable(nameOf(slots, "subject") ?? ""), "variable");
            if (isFail(target)) {
                return target;
            }
            const literal = literalOf(slots, "value");
            const source = sourceOf(slots, "value");
            if (literal === undefined && source === undefined) {
                return fail("missingValue", "value");
            }
            return {
                kind: "action",
                payload: prune({
                    action: "setVariable" as const,
                    target: target.value,
                    // A computed right-hand side wins; `value` is only the last literal the row held,
                    // and a script never carries it, so it is written as the language's own null.
                    value: literal === undefined ? null : literal.value,
                    expression: source === undefined ? undefined : expressionOf(ctx, source, warnings),
                }),
            };
        }
        case "declaration": {
            const name = nameOf(slots, "subject");
            const valueType = wordOf(slots, "valueType");
            if (name === undefined) {
                return fail("missingValue", "subject");
            }
            if (valueType !== "boolean" && valueType !== "number" && valueType !== "string" && valueType !== "json") {
                return fail("badWord", "valueType");
            }
            const scope = wordOf(slots, "scope") ?? "scene";
            if (scope !== "scene" && scope !== "saved" && scope !== "persistent") {
                return fail("badWord", "scope");
            }
            return {
                kind: "declaration",
                payload: prune({
                    scope,
                    name,
                    valueType,
                    // A `json` default is a whole value, and a script has one place to put one: a
                    // quoted string. The printer writes `JSON.stringify(value)` there, so this is the
                    // only slot whose declared type decides how its literal is read. A default that
                    // does not parse stays the string it was written as, which is what the inspector's
                    // own editor would hold for a malformed one.
                    defaultValue: valueType === "json"
                        ? jsonDefaultOf(literalOf(slots, "value")?.value)
                        : literalOf(slots, "value")?.value,
                    description: stringOf(slots, "description"),
                    // The row IS the variable, so its own id is the stable key - the default the
                    // declaration model documents.
                    storageKey: ctx.blockId,
                }),
            };
        }

        // --- Stage objects -------------------------------------------------------------------------------
        case "imageCreate":
        case "imageSource":
        case "imageShow":
        case "imageHide":
            return imageDraft(ctx, verb, slots);
        case "textCreate":
        case "textSet":
        case "textSize":
        case "textColor":
        case "textShow":
        case "textHide":
            return textObjectDraft(ctx, verb, slots);
        case "layerCreate":
        case "layerZIndex":
        case "layerShow":
        case "layerHide":
        case "layerTransform":
            return layerDraft(ctx, verb, slots);
        case "videoCreate":
        case "videoSeek":
        case "videoShow":
        case "videoHide":
        case "videoPlay":
        case "videoPause":
        case "videoResume":
        case "videoStop":
            return videoDraft(ctx, verb, slots);
        case "vfxCreate":
        case "vfxRate":
        case "vfxShow":
        case "vfxHide":
        case "vfxPause":
        case "vfxResume":
            return vfxDraft(ctx, verb, slots);

        // --- The raw effect channel -----------------------------------------------------------------------
        case "displayableShow":
        case "displayableHide":
        case "displayableTransform":
        case "displayableMask":
        case "displayableClearMask":
        case "displayableClip":
        case "displayableClearClip":
        case "displayableFilter":
        case "displayableClearFilter":
        case "displayableBackdrop":
        case "displayableBlend":
        case "displayableDarken":
        case "displayableReveal":
        case "displayableClose":
        case "displayableWipe":
            return displayableDraft(ctx, verb, slots);

        // --- Camera & screen ------------------------------------------------------------------------------
        case "cameraPan":
        case "cameraZoom":
        case "cameraRotate":
        case "cameraDarken":
        case "cameraLook":
        case "cameraReset":
        case "cameraMotion":
            return cameraDraft(ctx, verb, slots);
        case "cameraLens": {
            // A gesture the library does not know is a `badWord` rather than a name stored as typed,
            // for the reason a grade is: an unknown id compiles to a diagnostic and plays nothing, so
            // accepting it here would move a real failure from where the author is typing to where
            // they are testing.
            const preset = nameOf(slots, "lens");
            if (preset === undefined || !getStoryCameraLensPreset(preset)) {
                return fail("badWord", preset ?? "lens");
            }
            return {
                kind: "action",
                payload: {
                    action: "camera",
                    operation: "transform",
                    transform: {
                        mode: "props",
                        to: {
                            lens: prune({
                                preset,
                                inMs: msOf(slots, "fadeIn"),
                                holdMs: msOf(slots, "hold"),
                                outMs: msOf(slots, "fadeOut"),
                                color: colorOf(slots, "color"),
                                amount: numberOf(slots, "opacity"),
                                inner: numberOf(slots, "inner"),
                                outer: numberOf(slots, "outer"),
                                easing: nameOf(slots, "easing"),
                            }) as { preset: string },
                        },
                    },
                },
            };
        }

        // --- Control ---------------------------------------------------------------------------------------
        case "conditionIf":
        case "conditionElseIf":
        case "conditionElse": {
            const source = sourceOf(slots, "test");
            if (verb !== "conditionElse" && source === undefined) {
                return fail("missingValue", "condition");
            }
            return {
                kind: "control",
                payload: prune({
                    control: "conditionBranch" as const,
                    branch: verb === "conditionIf"
                        ? ("if" as const)
                        : verb === "conditionElseIf" ? ("elseIf" as const) : ("else" as const),
                    condition: source === undefined ? undefined : conditionOf(ctx, source, warnings),
                }),
            };
        }
        case "sequence":
        case "parallel":
        case "race": {
            const async = wordOf(slots, "async");
            if (async !== undefined && async !== "async") {
                return fail("badWord", async);
            }
            return {
                kind: "control",
                payload: prune({
                    control: verb,
                    mode: async === undefined ? undefined : verb === "sequence" ? ("doAsync" as const) : ("allAsync" as const),
                }),
            };
        }
        case "repeat": {
            const async = wordOf(slots, "async");
            if (async !== undefined && async !== "async") {
                return fail("badWord", async);
            }
            const until = sourceOf(slots, "test");
            const times = numberOf(slots, "times");
            if (until !== undefined && times !== undefined) {
                return fail("conflictingValues", "repeat");
            }
            return {
                kind: "control",
                payload: prune({
                    control: "repeat" as const,
                    mode: async === undefined ? undefined : ("doAsync" as const),
                    times,
                    until: until === undefined ? undefined : conditionOf(ctx, until, warnings),
                }),
            };
        }
        case "label":
        case "goto": {
            const name = nameOf(slots, "label");
            if (name === undefined) {
                return fail("missingValue", "label");
            }
            return {
                kind: "control",
                payload: verb === "label" ? { control: "label", name } : { control: "goto", targetLabel: name },
            };
        }
        case "break":
            return { kind: "control", payload: { control: "break" } };
        case "cut": {
            const variant = resolve(ctx.lookups.appTagId?.(nameOf(slots, "variant") ?? ""), "variant");
            if (isFail(variant)) {
                return variant;
            }
            return { kind: "control", payload: { control: "cut", appTagId: variant.value } };
        }
    }
}

// --- Per-subject builders ------------------------------------------------------------------------------------

function characterDraft(ctx: NarralangBuildContext, verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    const name = nameOf(slots, "subject");
    if (name === undefined) {
        return fail("missingValue", "subject");
    }
    const character = resolve(ctx.lookups.characterId?.(name), "character");
    if (isFail(character)) {
        return character;
    }
    const characterId = character.value;
    const appearance = appearanceOf(ctx, characterId, namesOf(slots, "appearance"));
    if (isFail(appearance)) {
        return appearance;
    }
    const base = { action: "character" as const, characterId };
    switch (verb) {
        case "characterEnter":
        case "characterExit": {
            const transform = transformOf(slots, verb === "characterEnter" ? "reveal" : "conceal");
            if (isFail(transform)) {
                return transform;
            }
            const transition = transitionOf(slots, "character");
            if (isFail(transition)) {
                return transition;
            }
            return {
                kind: "action",
                payload: prune({
                    ...base,
                    operation: verb === "characterEnter" ? ("enter" as const) : ("exit" as const),
                    ...(verb === "characterEnter" ? appearance.value : {}),
                    transform,
                    transition,
                }),
            };
        }
        case "characterMove": {
            const transform = transformOf(slots, "reveal");
            if (isFail(transform)) {
                return transform;
            }
            return { kind: "action", payload: prune({ ...base, operation: "move" as const, transform }) };
        }
        case "characterExpression":
            return { kind: "action", payload: prune({ ...base, operation: "expression" as const, ...appearance.value }) };
        case "characterMotion":
            return { kind: "action", payload: prune({ ...base, operation: "setMotion" as const, ...appearance.value }) };
        case "characterSkin":
            return { kind: "action", payload: prune({ ...base, operation: "setSkin" as const, ...appearance.value }) };
        case "characterRename":
            return {
                kind: "action",
                payload: prune({ ...base, operation: "setName" as const, displayName: nameOf(slots, "displayName") ?? "" }),
            };
        default: {
            const entries = pairsOf(slots, "params");
            const params: Record<string, number> = {};
            for (const entry of entries) {
                params[entry.key] = entry.value;
            }
            return { kind: "action", payload: { ...base, operation: "setParams", params } };
        }
    }
}

type AppearanceFields = { pose?: string; tags?: StoryCharacterTagSelection; puppetName?: string };

/**
 * Appearance names as the fields that store them.
 *
 * A name is a pose, a tag on some axis, or a state only the puppet's own backend knows - which is why
 * the reverse lookup answers with a kind rather than an id. A name nothing answers to is refused: the
 * alternative is a row that points at an appearance the character does not have.
 */
function appearanceOf(ctx: NarralangBuildContext, characterId: string, names: readonly string[]): Resolved<AppearanceFields> {
    if (names.length === 0) {
        return { ok: true, value: {} };
    }
    const out: AppearanceFields = {};
    const tags: StoryCharacterTagSelection = {};
    for (const name of names) {
        const found = ctx.lookups.appearanceRef?.(characterId, name);
        if (found === "ambiguous") {
            return fail("ambiguousName", "appearance");
        }
        if (found === null || found === undefined) {
            return fail("unknownName", "appearance");
        }
        if (found.kind === "pose") {
            out.pose = found.id;
        } else if (found.kind === "tag") {
            tags[found.axisId] = found.id;
        } else {
            out.puppetName = name;
        }
    }
    if (Object.keys(tags).length > 0) {
        out.tags = tags;
    }
    return { ok: true, value: out };
}

function audioDraft(verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    // A row that names no handle addresses the bus, which the language spells with a word - the bus
    // has no author-facing name to resolve.
    const objectName = nameOf(slots, "subject");
    const bus = wordOf(slots, "subject");
    if (objectName === undefined && bus !== "bgm" && bus !== "sound") {
        return fail("missingValue", "subject");
    }
    const base = prune({ action: "audio" as const, objectName });
    switch (verb) {
        case "audioStop":
            return {
                kind: "action",
                payload: prune({ ...base, operation: "stopSound" as const, fadeMs: msOf(slots, "fadeOut") }),
            };
        case "audioPause":
            return {
                kind: "action",
                payload: prune({ ...base, operation: "pauseSound" as const, fadeMs: msOf(slots, "fadeOut") }),
            };
        case "audioResume":
            return {
                kind: "action",
                payload: prune({ ...base, operation: "resumeSound" as const, fadeMs: msOf(slots, "fadeIn") }),
            };
        case "audioVolume": {
            const volume = numberOf(slots, "level");
            if (volume === undefined) {
                return fail("missingValue", "level");
            }
            return {
                kind: "action",
                payload: prune({ ...base, operation: "setVolume" as const, volume, fadeMs: msOf(slots, "duration") }),
            };
        }
        case "audioRate": {
            const rate = numberOf(slots, "rate");
            if (rate === undefined) {
                return fail("missingValue", "rate");
            }
            return { kind: "action", payload: { ...base, operation: "setRate", rate } };
        }
        case "audioMute":
        case "audioUnmute":
            return { kind: "action", payload: { ...base, operation: "muteSound", muted: verb === "audioMute" } };
        default: {
            const timeMs = msOf(slots, "time");
            if (timeMs === undefined) {
                return fail("missingValue", "time");
            }
            return { kind: "action", payload: { ...base, operation: "seekSound", timeMs } };
        }
    }
}

function imageDraft(ctx: NarralangBuildContext, verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    if (verb === "imageCreate" || verb === "imageSource") {
        const objectName = nameOf(slots, "subject");
        if (objectName === undefined) {
            return fail("missingValue", "subject");
        }
        const color = colorOf(slots, "source");
        const assetName = nameOf(slots, "source");
        let assetId: string | undefined;
        if (color === undefined && assetName !== undefined) {
            const asset = resolve(ctx.lookups.assetId?.(assetName), "asset");
            if (isFail(asset)) {
                return asset;
            }
            assetId = asset.value;
        }
        if (verb === "imageSource") {
            return {
                kind: "action",
                payload: prune({ action: "image" as const, operation: "setSource" as const, objectName, assetId, color }),
            };
        }
        const layer = layerRefOf(ctx, slots, "layer");
        if (isFail(layer)) {
            return layer;
        }
        const transform = transformOf(slots, "reveal");
        if (isFail(transform)) {
            return transform;
        }
        const autoFit = wordOf(slots, "autoFit");
        if (autoFit !== undefined && autoFit !== "autoFit") {
            return fail("badWord", autoFit);
        }
        return {
            kind: "action",
            payload: prune({
                action: "image" as const,
                operation: "create" as const,
                objectName,
                assetId,
                color,
                layer,
                autoFit: autoFit === undefined ? undefined : true,
                transform,
            }),
        };
    }
    const subject = stageObjectOf(ctx, slots, "image");
    if (isFail(subject)) {
        return subject;
    }
    const transform = transformOf(slots, verb === "imageShow" ? "reveal" : "conceal");
    if (isFail(transform)) {
        return transform;
    }
    const transition = transitionOf(slots, "character");
    if (isFail(transition)) {
        return transition;
    }
    return {
        kind: "action",
        payload: prune({
            action: "image" as const,
            operation: verb === "imageShow" ? ("show" as const) : ("hide" as const),
            objectName: subject.value,
            transform,
            transition,
        }),
    };
}

function textObjectDraft(ctx: NarralangBuildContext, verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    if (verb === "textCreate") {
        const objectName = nameOf(slots, "subject");
        if (objectName === undefined) {
            return fail("missingValue", "subject");
        }
        const layer = layerRefOf(ctx, slots, "layer");
        if (isFail(layer)) {
            return layer;
        }
        const transform = transformOf(slots, "reveal");
        if (isFail(transform)) {
            return transform;
        }
        return {
            kind: "action",
            payload: prune({
                action: "text" as const,
                operation: "create" as const,
                objectName,
                text: stringOf(slots, "content"),
                layer,
                transform,
            }),
        };
    }
    const subject = stageObjectOf(ctx, slots, "text");
    if (isFail(subject)) {
        return subject;
    }
    const objectName = subject.value;
    switch (verb) {
        case "textSet":
            return {
                kind: "action",
                payload: { action: "text", operation: "setText", objectName, text: stringOf(slots, "content") ?? "" },
            };
        case "textSize": {
            const fontSize = numberOf(slots, "fontSize");
            if (fontSize === undefined) {
                return fail("missingValue", "fontSize");
            }
            return { kind: "action", payload: { action: "text", operation: "setFontSize", objectName, fontSize } };
        }
        case "textColor": {
            const fontColor = colorOf(slots, "color");
            if (fontColor === undefined) {
                return fail("missingValue", "color");
            }
            return { kind: "action", payload: { action: "text", operation: "setFontColor", objectName, fontColor } };
        }
        default: {
            const transform = transformOf(slots, verb === "textShow" ? "reveal" : "conceal");
            if (isFail(transform)) {
                return transform;
            }
            return {
                kind: "action",
                payload: prune({
                    action: "text" as const,
                    operation: verb === "textShow" ? ("show" as const) : ("hide" as const),
                    objectName,
                    transform,
                }),
            };
        }
    }
}

function layerDraft(ctx: NarralangBuildContext, verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    if (verb === "layerCreate") {
        const objectName = nameOf(slots, "subject");
        if (objectName === undefined) {
            return fail("missingValue", "subject");
        }
        return {
            kind: "action",
            payload: prune({
                action: "layer" as const,
                operation: "create" as const,
                objectName,
                zIndex: numberOf(slots, "zIndex"),
            }),
        };
    }
    const target = layerRefOf(ctx, slots, "subject");
    if (isFail(target)) {
        return target;
    }
    if (target === undefined) {
        return fail("missingValue", "subject");
    }
    // The legacy name field is kept in step with the ref, so a document read by an older Studio still
    // finds the layer it names.
    const objectName = target.kind === "custom" ? target.name ?? "" : "";
    switch (verb) {
        case "layerZIndex": {
            const zIndex = numberOf(slots, "zIndex");
            if (zIndex === undefined) {
                return fail("missingValue", "zIndex");
            }
            return { kind: "action", payload: { action: "layer", operation: "setZIndex", objectName, target, zIndex } };
        }
        case "layerShow":
        case "layerHide":
            return {
                kind: "action",
                payload: {
                    action: "layer",
                    operation: verb === "layerShow" ? "show" : "hide",
                    objectName,
                    target,
                },
            };
        default: {
            const transform = transformOf(slots, "reveal");
            if (isFail(transform)) {
                return transform;
            }
            return {
                kind: "action",
                payload: prune({ action: "layer" as const, operation: "transform" as const, objectName, target, transform }),
            };
        }
    }
}

function videoDraft(ctx: NarralangBuildContext, verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    if (verb === "videoCreate") {
        const objectName = nameOf(slots, "subject");
        if (objectName === undefined) {
            return fail("missingValue", "subject");
        }
        const assetName = nameOf(slots, "source");
        let assetId: string | undefined;
        if (assetName !== undefined) {
            const asset = resolve(ctx.lookups.assetId?.(assetName), "asset");
            if (isFail(asset)) {
                return asset;
            }
            assetId = asset.value;
        }
        const muted = wordOf(slots, "muted");
        if (muted !== undefined && muted !== "muted") {
            return fail("badWord", muted);
        }
        return {
            kind: "action",
            payload: prune({
                action: "video" as const,
                operation: "create" as const,
                objectName,
                assetId,
                muted: muted === undefined ? undefined : true,
            }),
        };
    }
    const subject = stageObjectOf(ctx, slots, "video");
    if (isFail(subject)) {
        return subject;
    }
    const objectName = subject.value;
    if (verb === "videoSeek") {
        const timeMs = msOf(slots, "time");
        if (timeMs === undefined) {
            return fail("missingValue", "time");
        }
        return { kind: "action", payload: { action: "video", operation: "seek", objectName, timeMs } };
    }
    const operation = verb === "videoShow"
        ? "show"
        : verb === "videoHide"
            ? "hide"
            : verb === "videoPlay"
                ? "play"
                : verb === "videoPause"
                    ? "pause"
                    : verb === "videoResume"
                        ? "resume"
                        : "stop";
    return { kind: "action", payload: { action: "video", operation, objectName } };
}

const BLEND_MODES: ReadonlySet<string> = new Set<StoryVfxBlendMode>([
    "normal", "screen", "multiply", "lighten", "color-dodge", "overlay",
]);

function vfxDraft(ctx: NarralangBuildContext, verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    if (verb === "vfxCreate") {
        const objectName = nameOf(slots, "subject");
        if (objectName === undefined) {
            return fail("missingValue", "subject");
        }
        const assetName = nameOf(slots, "source");
        let assetId: string | undefined;
        if (assetName !== undefined) {
            const asset = resolve(ctx.lookups.assetId?.(assetName), "asset");
            if (isFail(asset)) {
                return asset;
            }
            assetId = asset.value;
        }
        const blend = wordOf(slots, "blend");
        if (blend !== undefined && !BLEND_MODES.has(blend)) {
            return fail("badWord", blend);
        }
        const fit = wordOf(slots, "fit");
        if (fit !== undefined && fit !== "cover" && fit !== "contain" && fit !== "fill") {
            return fail("badWord", fit);
        }
        const loop = wordOf(slots, "loop");
        if (loop !== undefined && loop !== "once" && loop !== "loop") {
            return fail("badWord", loop);
        }
        return {
            kind: "action",
            payload: prune({
                action: "vfx" as const,
                operation: "create" as const,
                objectName,
                assetId,
                blendMode: blend as StoryVfxBlendMode | undefined,
                opacity: numberOf(slots, "opacity"),
                fit,
                zIndex: numberOf(slots, "zIndex"),
                rate: numberOf(slots, "rate"),
                loop: loop === undefined ? undefined : loop === "loop",
            }),
        };
    }
    const subject = stageObjectOf(ctx, slots, "vfx");
    if (isFail(subject)) {
        return subject;
    }
    const objectName = subject.value;
    switch (verb) {
        case "vfxRate": {
            const rate = numberOf(slots, "rate");
            if (rate === undefined) {
                return fail("missingValue", "rate");
            }
            return { kind: "action", payload: { action: "vfx", operation: "setRate", objectName, rate } };
        }
        case "vfxShow":
        case "vfxHide":
            return {
                kind: "action",
                payload: prune({
                    action: "vfx" as const,
                    operation: verb === "vfxShow" ? ("show" as const) : ("hide" as const),
                    objectName,
                    durationMs: msOf(slots, "duration"),
                }),
            };
        default:
            return {
                kind: "action",
                payload: { action: "vfx", operation: verb === "vfxPause" ? "pause" : "resume", objectName },
            };
    }
}

function displayableDraft(ctx: NarralangBuildContext, verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    const target = displayableTargetOf(ctx, slots);
    if (isFail(target)) {
        return target;
    }
    const timing = prune({ durationMs: msOf(slots, "duration"), easing: nameOf(slots, "easing") });
    const base = { action: "displayable" as const, target };
    switch (verb) {
        case "displayableShow":
        case "displayableHide":
        case "displayableTransform": {
            const transform = transformOf(slots, verb === "displayableHide" ? "conceal" : "reveal");
            if (isFail(transform)) {
                return transform;
            }
            const operation = verb === "displayableShow" ? "show" : verb === "displayableHide" ? "hide" : "transform";
            return { kind: "action", payload: prune({ ...base, operation, transform }) };
        }
        // The twelve effect verbs are one operation now, and the verb only says which channel of the
        // bag the line filled in. The dialect is unchanged - `mask`, `clip`, `filter` and the rest are
        // still the words an author types - but what they build is `transform` plus a prop.
        case "displayableMask": {
            const assetName = nameOf(slots, "mask");
            if (assetName === undefined) {
                return fail("missingValue", "mask");
            }
            const asset = resolve(ctx.lookups.assetId?.(assetName), "asset");
            if (isFail(asset)) {
                return asset;
            }
            return effectDraft(base, { maskAssetId: asset.value }, timing);
        }
        case "displayableClip":
            return effectDraft(base, { clipPath: stringOf(slots, "clipPath") ?? "" }, timing);
        case "displayableFilter":
            return effectDraft(base, parseStoryFilter(stringOf(slots, "filter") ?? ""), timing);
        case "displayableBackdrop":
            return effectDraft(base, { backdropFilter: stringOf(slots, "filter") ?? "" }, timing);
        case "displayableBlend": {
            const blend = wordOf(slots, "blend");
            if (blend === undefined || !BLEND_MODES.has(blend)) {
                return fail("badWord", "blend");
            }
            return effectDraft(base, { mixBlendMode: blend }, timing);
        }
        case "displayableDarken": {
            const darkness = numberOf(slots, "darkness");
            if (darkness === undefined) {
                return fail("missingValue", "darkness");
            }
            return effectDraft(base, { filter: { brightness: 1 - Math.min(1, Math.max(0, darkness)) } }, timing);
        }
        case "displayableClearMask":
            return effectDraft(base, { maskAssetId: null }, timing);
        case "displayableClearClip":
            return effectDraft(base, { clipPath: null }, timing);
        case "displayableClearFilter":
            return effectDraft(base, { filter: null }, timing);
        case "displayableReveal":
            return clipRevealDraft(base, "circleReveal", timing);
        case "displayableClose":
            return clipRevealDraft(base, "circleClose", timing);
        case "displayableWipe":
            return clipRevealDraft(base, "wipe", timing);
        default:
            return fail("badWord", "displayable");
    }
}

/** One `transform` row carrying one appearance prop - what every effect verb builds now. */
function effectDraft(
    base: { action: "displayable"; target: StoryDisplayableTargetRef },
    to: StoryTransformProps,
    timing: { durationMs?: number; easing?: string },
): NarralangBlockDraft {
    return { kind: "action", payload: { ...base, operation: "transform", transform: prune({ to, ...timing }) } };
}

function clipRevealDraft(
    base: { action: "displayable"; target: StoryDisplayableTargetRef },
    kind: NonNullable<StoryTransformRef["clipReveal"]>["kind"],
    timing: { durationMs?: number; easing?: string },
): NarralangBlockDraft {
    return { kind: "action", payload: { ...base, operation: "transform", transform: prune({ clipReveal: { kind }, ...timing }) } };
}

/**
 * The camera's seven words, as the one prop bag they all write.
 *
 * The dialect keeps a word per channel - `camera zoom 1.4` reads better in a script than a bag
 * spelled out - but what each one BUILDS is the same `StoryTransformRef` every other subject gets, so
 * a script row and an editor row are the same document.
 */
function cameraDraft(ctx: NarralangBuildContext, verb: NarralangVerb, slots: NarralangSlots): NarralangBlockDraft | Fail {
    const timing = prune({ durationMs: msOf(slots, "duration"), easing: nameOf(slots, "easing") });
    const pose = (to: StoryTransformProps): NarralangBlockDraft => ({
        kind: "action",
        payload: { action: "camera", operation: "transform", transform: prune({ mode: "props" as const, to, ...timing }) },
    });
    switch (verb) {
        case "cameraPan": {
            const placement = wordOf(slots, "placement");
            if (placement === undefined || !PLACEMENTS.has(placement)) {
                return fail("badWord", "placement");
            }
            // Through the one forward table for `left/center/right -> xalign`, so the two directions
            // cannot drift into naming different sides.
            const position = getPresetPosition(placement, {}) as StoryAlignPositionValue | null;
            if (!position) {
                return fail("badWord", placement);
            }
            return pose({ position });
        }
        case "cameraZoom": {
            const zoom = numberOf(slots, "zoom");
            if (zoom === undefined) {
                return fail("missingValue", "zoom");
            }
            return pose({ zoom });
        }
        case "cameraRotate": {
            const rotation = numberOf(slots, "rotation");
            if (rotation === undefined) {
                return fail("missingValue", "rotation");
            }
            return pose({ rotation });
        }
        case "cameraDarken": {
            const darkness = numberOf(slots, "darkness");
            if (darkness === undefined) {
                return fail("missingValue", "darkness");
            }
            // `Camera.darken(d)` IS `filter("brightness(1 - d)")` in the engine, so the word keeps its
            // spelling in the script and the bag states the channel it always wrote.
            return pose({ filter: { brightness: 1 - Math.min(1, Math.max(0, darkness)) } });
        }
        case "cameraLook": {
            // A grade the library does not know is a `badWord` rather than a name stored as typed:
            // an unknown id compiles to a diagnostic and plays nothing, so accepting it here would
            // move a real failure from where the author is typing to where they are testing.
            const look = nameOf(slots, "look");
            const filter = stringOf(slots, "filter");
            if (look !== undefined && !getStoryCameraLookPreset(look)) {
                return fail("badWord", look);
            }
            const strength = numberOf(slots, "strength");
            return pose(prune({
                ...(look !== undefined ? { look: prune({ preset: look, intensity: strength }) } : {}),
                filterRaw: filter,
            }) as StoryTransformProps);
        }
        case "cameraReset":
            return { kind: "action", payload: prune({ action: "camera" as const, operation: "reset" as const, ...timing }) };
        default: {
            const motion = resolve(ctx.lookups.motionId?.(nameOf(slots, "motion") ?? ""), "motion");
            if (isFail(motion)) {
                return motion;
            }
            return {
                kind: "action",
                payload: { action: "camera", operation: "transform", transform: { mode: "animation", animationId: motion.value } },
            };
        }
    }
}

