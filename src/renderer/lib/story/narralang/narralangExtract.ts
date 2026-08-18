/**
 * The coverage pass: a story block becomes a {@link NarralangShape}, or an issue saying why it cannot.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * ## This is where "can NarraLang say this row?" is answered
 *
 * Every {@link NarralangIssue} comes from here and only from here. That is deliberate: a shape is a
 * structure the renderer can always spell, so a row that produced one is a row with a spelling, and a
 * row that could not produce one reported why. The renderer therefore has no opinion about coverage
 * and cannot develop one - which is what stops the printer and the analyser drifting apart, and the
 * stake is real: a scene reported as expressible is one the text view opens for editing.
 *
 * ## Nothing here knows a word of the language
 *
 * The extractor resolves ids to names, lowers structured conditions into expression source, and picks
 * the verb - and never decides how any of it is written. `at left` is not built here; `placement:
 * left` is. See {@link ./narralangDialect} for the other half.
 *
 * ## No locale, ever
 *
 * Nothing in this file may call `translate` or read the localised command tables. The `resolve*`
 * half of the row projection is used throughout rather than its display twin: the display twin
 * answers a miss with a translated word, which would put "Unknown character" in an English export and
 * "未知角色" in a Chinese one for the same document.
 */

import type {
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryConditionRef,
    StoryControlPayload,
    StoryDeclarationPayload,
    StoryJumpPayload,
    StoryLayerRef,
    StoryLiteralValue,
    StoryNodeActionPayload,
    StoryScene,
    StoryTextSegment,
    StoryTransformRef,
    StoryTransitionRef,
    StoryVariableRef,
} from "@shared/types/story";
import { resolveDisplayableTargetRef, resolveStoryLayerRef } from "@shared/types/story";
import { formatStoryExpressionName } from "@shared/utils/storyExpressionParser";

import {
    resolveStoryCharacterName,
    resolveStorySceneName,
    resolveStoryVariableName,
    storyCameraPanPlacement,
    type StoryRowLookups,
} from "@/lib/story/storyRowProjection";
import {
    transitionWordFor,
    transitionWordForPreset,
} from "@/apps/workspace/modules/story/scene-editor/commands/transitions";

import type {
    NarralangProseContext,
    NarralangShape,
    NarralangSlots,
    NarralangText,
    NarralangTextRun,
    NarralangValue,
    NarralangWord,
} from "./narralangShape";

// --- Coverage -------------------------------------------------------------------------------------

/**
 * Why a row has no NarraLang spelling.
 *
 * Closed and coarse: the reason is shown to an author as "this scene cannot be edited as text
 * because of these rows", so it names the *class* of thing that is missing, not the field.
 */
export type NarralangIssueReason =
    /** A Story Action Blueprint row. Its meaning lives in a graph document, not in any script. */
    | "blueprintAction"
    /** A condition computed by a blueprint (`/if` backed by a graph). */
    | "blueprintCondition"
    /** An inline value computed by a blueprint. */
    | "blueprintInterpolation"
    /** An inline reveal-time event run (expression switch / SE fired mid-typewriter). */
    | "inlineEvent"
    /** A row whose command line never parsed. Re-reading it as script would change what it means. */
    | "invalidRow"
    /** A transform with custom props, a custom preset, or a keyframed Story Motion. */
    | "customTransform"
    /** A transition with custom props or a custom kind. */
    | "customTransition"
    /** An effect carrying `effectProps` beyond the modifiers the grammar names. */
    | "effectProps"
    /** An id that resolves to no name - the text has nothing to call it by. */
    | "unresolvedRef"
    /** A payload shape this extractor does not know. Defensive: a new action kind lands here first. */
    | "unknownPayload";

/**
 * What kind of thing an issue is about.
 *
 * Closed, so a surface can turn it into a sentence in the author's language. It was a free `string`
 * first, which meant the export report could only say "this row points at something that no longer
 * exists" - true, and useless when the author has to guess whether the something is an asset or a
 * character. A union makes the report specific and makes a new value a compile error at every
 * consumer rather than a key that quietly falls back to itself.
 */
export type NarralangIssueDetail =
    | "asset"
    | "character"
    | "appearance"
    | "motion"
    | "scene"
    | "variable"
    | "variant"
    | "camera";

export type NarralangIssue = {
    blockId: StoryBlockId;
    reason: NarralangIssueReason;
    /** What the issue is about, when the reason alone does not say. Never an id. */
    detail?: NarralangIssueDetail;
};

/**
 * What the extractor needs from outside a block.
 *
 * `StoryRowLookups` already covers characters, assets, motions, appearances and scenes - exactly the
 * same table the row projection reads, which is the point: two surfaces over one set of lookups, not
 * two lookup vocabularies. The one addition is build variants, which the row projection reads off
 * `commandContext` (a command-line concern this has no business carrying) and which a `cut` row needs
 * to name.
 */
export type NarralangLookups = StoryRowLookups & {
    /** The author-facing name of a build variant (`AppTag`), or `null` when the id answers to none. */
    appTagName?: (appTagId: string) => string | null;
};

export type NarralangExtractContext = {
    scene: StoryScene;
    lookups: NarralangLookups;
    report: (blockId: StoryBlockId, reason: NarralangIssueReason, detail?: NarralangIssueDetail) => void;
};

// --- Value constructors ----------------------------------------------------------------------------

const asName = (name: string): NarralangValue => ({ kind: "name", name });
const asNames = (names: readonly string[]): NarralangValue => ({ kind: "names", names });
const asWord = (word: NarralangWord): NarralangValue => ({ kind: "word", word });
const asBuiltin = (word: NarralangWord): NarralangValue => ({ kind: "builtin", word });
const asString = (value: string): NarralangValue => ({ kind: "string", value });
const asNumber = (value: number): NarralangValue => ({ kind: "number", value });
const asSeconds = (ms: number): NarralangValue => ({ kind: "seconds", ms });
const asColor = (value: string): NarralangValue => ({ kind: "color", value });
const asLiteral = (value: StoryLiteralValue): NarralangValue => ({ kind: "literal", value });
const asExpression = (source: string): NarralangValue => ({ kind: "expression", source });

/** `undefined` stays `undefined`, so an absent field never fills a slot with a zero. */
const optSeconds = (ms: number | undefined): NarralangValue | undefined =>
    ms === undefined ? undefined : asSeconds(ms);
const optNumber = (value: number | undefined): NarralangValue | undefined =>
    value === undefined ? undefined : asNumber(value);

// --- Reference resolution ---------------------------------------------------------------------------

function assetName(ctx: NarralangExtractContext, blockId: StoryBlockId, assetId: string | undefined): NarralangValue | undefined {
    if (!assetId) {
        return undefined;
    }
    const name = ctx.lookups.assetName?.(assetId) ?? null;
    if (!name) {
        ctx.report(blockId, "unresolvedRef", "asset");
        return undefined;
    }
    return asName(name);
}

/**
 * A character by name.
 *
 * A name that cannot be resolved is a row that cannot be spelled, so it is reported and the scene
 * stops being expressible - the honest outcome, since the author has a dangling reference. The empty
 * name that comes back is what the dialect's quoting turns into a visibly empty slot rather than an
 * id leaking into the script.
 */
function characterName(ctx: NarralangExtractContext, blockId: StoryBlockId, characterId: string | undefined): NarralangValue {
    const name = resolveStoryCharacterName(ctx.lookups, characterId);
    if (name === null || name === "") {
        ctx.report(blockId, "unresolvedRef", "character");
        return asName("");
    }
    return asName(name);
}

/** Same split, same reason, as {@link characterName}. */
function variableName(ctx: NarralangExtractContext, blockId: StoryBlockId, ref: StoryVariableRef): string {
    const name = resolveStoryVariableName(ref, ctx.lookups);
    if (name === null || name === "") {
        ctx.report(blockId, "unresolvedRef", "variable");
        return "";
    }
    return name;
}

function layerValue(ctx: NarralangExtractContext, ref: StoryLayerRef | undefined): NarralangValue | undefined {
    if (!ref) {
        return undefined;
    }
    const resolved = resolveStoryLayerRef(ctx.scene, ref);
    if (resolved.kind === "default") {
        return asBuiltin(resolved.layer === "background" ? "backgroundLayer" : "stageLayer");
    }
    return asName(resolved.name);
}

/** A displayable target: a stage singleton, or the stage name of its creator row. */
function displayableValue(ctx: NarralangExtractContext, payload: { target: { builtin?: string; name: string } }): NarralangValue {
    const target = payload.target as Parameters<typeof resolveDisplayableTargetRef>[1];
    if (target.builtin) {
        return asBuiltin(
            target.builtin === "background"
                ? "background"
                : target.builtin === "backgroundLayer"
                    ? "backgroundLayer"
                    : "stageLayer",
        );
    }
    return asName(resolveDisplayableTargetRef(ctx.scene, target).name);
}

// --- Shared tails -------------------------------------------------------------------------------------

/**
 * The slots a transform contributes.
 *
 * A transform says two different things depending on its preset: a placement (`left`/`center`/
 * `right`) is *where*, and a reveal/conceal preset is *how*. Both can carry a duration, which is why
 * the transition arm swallows it: `fade 0.3` already states the timing, and a second duration slot
 * after it would say the same thing twice.
 */
function transformSlots(
    ctx: NarralangExtractContext,
    blockId: StoryBlockId,
    ref: StoryTransformRef | undefined,
    context: "reveal" | "conceal" | "nvl",
): NarralangSlots {
    if (!ref) {
        return {};
    }
    if (ref.mode === "animation" || ref.preset === "custom" || (ref.props && Object.keys(ref.props).length > 0)) {
        ctx.report(blockId, "customTransform");
        return {};
    }
    const slots: NarralangSlots = {};
    if (ref.preset === "left" || ref.preset === "center" || ref.preset === "right") {
        slots.placement = asWord(ref.preset);
    } else if (ref.preset && ref.preset !== "none") {
        const word = transitionWordForPreset(context, ref.preset);
        if (!word) {
            ctx.report(blockId, "customTransform");
        } else {
            slots.transformTransition = { kind: "timedWord", word, ms: ref.durationMs };
            if (ref.easing) {
                slots.transformEasing = asName(ref.easing);
            }
            return slots;
        }
    }
    if (ref.durationMs !== undefined) {
        slots.transformDuration = asSeconds(ref.durationMs);
    }
    if (ref.easing) {
        slots.transformEasing = asName(ref.easing);
    }
    return slots;
}

/** The slots a transition contributes. Kept apart from the transform's - one row can carry both. */
function transitionSlots(
    ctx: NarralangExtractContext,
    blockId: StoryBlockId,
    ref: StoryTransitionRef | undefined,
    context: "scene" | "character",
): NarralangSlots {
    if (!ref || ref.kind === "none") {
        return {};
    }
    if (ref.kind === "custom" || (ref.props && Object.keys(ref.props).length > 0)) {
        ctx.report(blockId, "customTransition");
        return {};
    }
    const word = transitionWordFor(context, ref.kind);
    if (!word) {
        ctx.report(blockId, "customTransition");
        return {};
    }
    const slots: NarralangSlots = { transition: { kind: "timedWord", word, ms: ref.durationMs } };
    if (ref.easing) {
        slots.transitionEasing = asName(ref.easing);
    }
    return slots;
}

/** The plain timing the raw effect channels carry. */
function timingSlots(durationMs: number | undefined, easing: string | undefined): NarralangSlots {
    return {
        duration: optSeconds(durationMs),
        easing: easing === undefined ? undefined : asName(easing),
    };
}

// --- Conditions ----------------------------------------------------------------------------------

/**
 * A literal inside expression source.
 *
 * Not {@link narralangLiteral}: what follows `==` is expression-language text, and the expression
 * language's string quoting is its own and does not move when a dialect renames a verb.
 */
function expressionLiteral(value: StoryLiteralValue): string {
    if (typeof value === "number") {
        return Number.isFinite(value) ? String(Number(value.toFixed(6))) : "0";
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (value === null || value === undefined) {
        return "null";
    }
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * A condition as expression source.
 *
 * The five `variable` operators lower to the expression language's own spelling rather than keeping a
 * vocabulary of their own - `isTrue` is just the variable, `equals` is `==`. That keeps one syntax
 * for conditions whether the row stored a structured ref or a parsed expression, which is what lets
 * `if trust > 0` and a variable-ref condition read the same. It is also why nothing here is the
 * dialect's to re-spell: the expression language is a second grammar this surface embeds, not a part
 * of NarraLang's own vocabulary.
 */
function conditionSource(
    ctx: NarralangExtractContext,
    blockId: StoryBlockId,
    ref: StoryConditionRef | undefined,
): string | undefined {
    if (!ref) {
        return undefined;
    }
    if (ref.kind === "blueprint") {
        ctx.report(blockId, "blueprintCondition");
        return undefined;
    }
    if (ref.kind === "expression") {
        return ref.expression.source;
    }
    const name = formatStoryExpressionName(variableName(ctx, blockId, ref.target));
    switch (ref.operator) {
        case "isTrue":
            return name;
        case "isFalse":
            return `not ${name}`;
        case "equals":
            return `${name} == ${expressionLiteral(ref.value ?? null)}`;
        case "notEquals":
            return `${name} != ${expressionLiteral(ref.value ?? null)}`;
        case "exists":
            return `exists ${name}`;
        default:
            return name;
    }
}

// --- Text -----------------------------------------------------------------------------------------

/**
 * A stored segment as resolved runs.
 *
 * Falls back to `segment.value` when there are no runs, which is the plain case and the overwhelming
 * majority of rows. `value` is documented as the plain-text projection of `rich`, but it is NOT used
 * when runs exist: it would drop every mark.
 */
function textOf(
    ctx: NarralangExtractContext,
    blockId: StoryBlockId,
    segment: StoryTextSegment | undefined,
    context: NarralangProseContext,
): NarralangText {
    const stored = segment?.rich;
    if (!stored || stored.length === 0) {
        return { context, runs: [{ text: segment?.value ?? "" }] };
    }
    const runs: NarralangTextRun[] = [];
    for (const run of stored) {
        if ("text" in run) {
            runs.push(run.marks === undefined ? { text: run.text } : { text: run.text, marks: run.marks });
            continue;
        }
        if ("pause" in run) {
            runs.push({ pause: run.pause });
            continue;
        }
        if ("interpolation" in run) {
            const ref = run.interpolation;
            let source: string | null;
            if (ref.kind === "variable") {
                // Printed through the expression language's own name printer, so a name with a space
                // survives as one reference instead of two tokens the parser would split.
                const name = resolveStoryVariableName(ref.target, ctx.lookups);
                if (name === null || name === "") {
                    ctx.report(blockId, "unresolvedRef", "variable");
                    source = null;
                } else {
                    source = formatStoryExpressionName(name);
                }
            } else if (ref.kind === "expression") {
                source = ref.expression.source;
            } else {
                // A blueprint-computed value. Already reported by the run scan below.
                source = null;
            }
            runs.push(run.marks === undefined ? { interpolation: source } : { interpolation: source, marks: run.marks });
            continue;
        }
        // An inline reveal event contributes nothing to the line; the scan below reports the row.
    }
    return { context, runs };
}

/**
 * Whether a text row's runs carry something with no spelling. Reported on the row, once per cause.
 *
 * Kept as its own scan rather than folded into {@link textOf} so the "once per cause" span is the
 * BLOCK, not the segment - a row with two segments carrying the same defect is one problem to fix.
 */
function reportTextIssues(ctx: NarralangExtractContext, block: StoryBlock): void {
    const payload = block.kind === "nodeAction" || block.kind === "note" ? block.payload : null;
    if (!payload) {
        return;
    }
    const segments = [
        "text" in payload ? payload.text : undefined,
        "prompt" in payload ? payload.prompt : undefined,
    ];
    let sawEvent = false;
    let sawBlueprint = false;
    for (const segment of segments) {
        for (const run of segment?.rich ?? []) {
            if ("event" in run && !sawEvent) {
                sawEvent = true;
                ctx.report(block.id, "inlineEvent");
            }
            if ("interpolation" in run && run.interpolation.kind === "blueprint" && !sawBlueprint) {
                sawBlueprint = true;
                ctx.report(block.id, "blueprintInterpolation");
            }
        }
    }
}

// --- Node actions (prose) ---------------------------------------------------------------------------

function nodeActionShape(ctx: NarralangExtractContext, block: StoryBlock, payload: StoryNodeActionPayload): NarralangShape {
    switch (payload.action) {
        case "narration":
            return {
                form: "statement",
                verb: "narration",
                slots: { text: { kind: "text", text: textOf(ctx, block.id, payload.text, "narration") } },
            };
        case "dialogue": {
            // A bare `speakerName` is a first-class state (a line spoken by nobody in the character
            // list), so only a characterId that resolves to nothing is a miss.
            const speaker = payload.characterId
                ? characterName(ctx, block.id, payload.characterId)
                : asName(payload.speakerName ?? "");
            const voice = payload.voiceAssetId ? assetName(ctx, block.id, payload.voiceAssetId) : undefined;
            const pause = payload.pauseAfter === true
                ? asWord("click")
                : typeof payload.pauseAfter === "number"
                    ? asSeconds(payload.pauseAfter)
                    : undefined;
            return {
                form: "statement",
                verb: "dialogue",
                slots: {
                    speaker,
                    voice,
                    pause,
                    text: { kind: "text", text: textOf(ctx, block.id, payload.text, "dialogueText") },
                },
            };
        }
        case "choice":
            return {
                form: "statement",
                verb: "choice",
                opensBlock: true,
                slots: {
                    prompt: payload.prompt
                        ? { kind: "text", text: textOf(ctx, block.id, payload.prompt, "narration") }
                        : undefined,
                },
            };
        case "choiceOption": {
            const showIf = conditionSource(ctx, block.id, payload.hiddenWhen);
            const enableIf = conditionSource(ctx, block.id, payload.disabledWhen);
            return {
                form: "statement",
                verb: "choiceOption",
                opensBlock: true,
                slots: {
                    text: { kind: "text", text: textOf(ctx, block.id, payload.text, "option") },
                    showIf: showIf ? asExpression(showIf) : undefined,
                    enableIf: enableIf ? asExpression(enableIf) : undefined,
                },
            };
        }
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

// --- Characters -------------------------------------------------------------------------------------

/**
 * The appearance a character row carries: a pose, a tag per axis, or a puppet's state name.
 *
 * Tags carry tag NAMES, not axis/tag pairs, because nothing in `StoryRowLookups` can name an axis -
 * `appearanceName` resolves a pose or tag id and there is no axis equivalent. The command line has
 * the same limit, so this is not a step down from what an author can already read.
 */
function appearanceNames(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "character" }>,
): string[] {
    const out: string[] = [];
    const characterId = payload.characterId;
    if (payload.pose && characterId) {
        const name = ctx.lookups.appearanceName?.(characterId, payload.pose) ?? null;
        if (!name) {
            ctx.report(block.id, "unresolvedRef", "appearance");
        } else {
            out.push(name);
        }
    }
    for (const tagId of Object.values(payload.tags ?? {})) {
        const name = characterId ? ctx.lookups.appearanceName?.(characterId, tagId) ?? null : null;
        if (!name) {
            ctx.report(block.id, "unresolvedRef", "appearance");
        } else {
            out.push(name);
        }
    }
    if (payload.puppetName) {
        out.push(payload.puppetName);
    }
    return out;
}

function characterShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "character" }>,
): NarralangShape {
    const subject = characterName(ctx, block.id, payload.characterId);
    switch (payload.operation) {
        case "enter":
            return {
                form: "statement",
                verb: "characterEnter",
                slots: {
                    subject,
                    appearance: asNames(appearanceNames(ctx, block, payload)),
                    ...transformSlots(ctx, block.id, payload.transform, "reveal"),
                    ...transitionSlots(ctx, block.id, payload.transition, "character"),
                },
            };
        case "exit":
            return {
                form: "statement",
                verb: "characterExit",
                slots: {
                    subject,
                    ...transformSlots(ctx, block.id, payload.transform, "conceal"),
                    ...transitionSlots(ctx, block.id, payload.transition, "character"),
                },
            };
        case "move":
            return {
                form: "statement",
                verb: "characterMove",
                slots: { subject, ...transformSlots(ctx, block.id, payload.transform, "reveal") },
            };
        case "expression":
            return {
                form: "statement",
                verb: "characterExpression",
                slots: { subject, appearance: asNames(appearanceNames(ctx, block, payload)) },
            };
        case "setName":
            return {
                form: "statement",
                verb: "characterRename",
                slots: { subject, displayName: asName(payload.displayName ?? "") },
            };
        case "setMotion":
            return {
                form: "statement",
                verb: "characterMotion",
                slots: { subject, appearance: asNames(appearanceNames(ctx, block, payload)) },
            };
        case "setSkin":
            return {
                form: "statement",
                verb: "characterSkin",
                slots: { subject, appearance: asNames(appearanceNames(ctx, block, payload)) },
            };
        case "setParams":
            return {
                form: "statement",
                verb: "characterParams",
                slots: {
                    subject,
                    params: {
                        kind: "pairs",
                        entries: Object.entries(payload.params ?? {}).map(([key, value]) => ({ key, value })),
                    },
                },
            };
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

// --- Audio ------------------------------------------------------------------------------------------

function audioShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "audio" }>,
): NarralangShape {
    // A row that names no handle addresses the music bus, which is a target the language spells with a
    // word rather than a name - the bus has no author-facing name to resolve.
    const handle = payload.objectName ? asName(payload.objectName) : undefined;
    const subject = handle ?? asWord("bgm");

    switch (payload.operation) {
        case "setBgm":
        case "playSound": {
            const isBgm = payload.operation === "setBgm";
            return {
                form: "statement",
                verb: "audioPlay",
                slots: {
                    channel: asWord(isBgm ? "bgm" : "sound"),
                    source: assetName(ctx, block.id, payload.assetId),
                    handle: isBgm ? undefined : handle,
                    volume: optNumber(payload.volume),
                    fadeIn: optSeconds(payload.fadeMs),
                    loop: payload.loop === undefined ? undefined : asWord(payload.loop ? "loop" : "once"),
                    rate: optNumber(payload.rate),
                },
            };
        }
        case "stopSound":
            return { form: "statement", verb: "audioStop", slots: { subject, fadeOut: optSeconds(payload.fadeMs) } };
        case "pauseSound":
            return { form: "statement", verb: "audioPause", slots: { subject, fadeOut: optSeconds(payload.fadeMs) } };
        case "resumeSound":
            return { form: "statement", verb: "audioResume", slots: { subject, fadeIn: optSeconds(payload.fadeMs) } };
        case "setVolume":
            return {
                form: "statement",
                verb: "audioVolume",
                slots: { subject, level: asNumber(payload.volume ?? 0), duration: optSeconds(payload.fadeMs) },
            };
        case "setRate":
            return { form: "statement", verb: "audioRate", slots: { subject, rate: asNumber(payload.rate ?? 1) } };
        case "muteSound":
            return { form: "statement", verb: payload.muted === false ? "audioUnmute" : "audioMute", slots: { subject } };
        case "seekSound":
            return { form: "statement", verb: "audioSeek", slots: { subject, time: asSeconds(payload.timeMs ?? 0) } };
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

// --- Stage objects ------------------------------------------------------------------------------------

function imageShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "image" }>,
): NarralangShape {
    const subject = asName(payload.objectName);
    const source = payload.color ? asColor(payload.color) : assetName(ctx, block.id, payload.assetId);
    switch (payload.operation) {
        case "create":
            return {
                form: "statement",
                verb: "imageCreate",
                slots: {
                    subject,
                    source,
                    layer: layerValue(ctx, payload.layer),
                    autoFit: payload.autoFit ? asWord("autoFit") : undefined,
                    ...transformSlots(ctx, block.id, payload.transform, "reveal"),
                },
            };
        case "setSource":
            return { form: "statement", verb: "imageSource", slots: { subject, source } };
        case "show":
            return {
                form: "statement",
                verb: "imageShow",
                slots: {
                    subject,
                    ...transformSlots(ctx, block.id, payload.transform, "reveal"),
                    ...transitionSlots(ctx, block.id, payload.transition, "character"),
                },
            };
        case "hide":
            return {
                form: "statement",
                verb: "imageHide",
                slots: {
                    subject,
                    ...transformSlots(ctx, block.id, payload.transform, "conceal"),
                    ...transitionSlots(ctx, block.id, payload.transition, "character"),
                },
            };
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

function textObjectShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "text" }>,
): NarralangShape {
    const subject = asName(payload.objectName);
    switch (payload.operation) {
        case "create":
            return {
                form: "statement",
                verb: "textCreate",
                slots: {
                    subject,
                    content: payload.text === undefined ? undefined : asString(payload.text),
                    layer: layerValue(ctx, payload.layer),
                    ...transformSlots(ctx, block.id, payload.transform, "reveal"),
                },
            };
        case "setText":
            return { form: "statement", verb: "textSet", slots: { subject, content: asString(payload.text ?? "") } };
        case "setFontSize":
            return { form: "statement", verb: "textSize", slots: { subject, fontSize: asNumber(payload.fontSize ?? 0) } };
        case "setFontColor":
            return {
                form: "statement",
                verb: "textColor",
                slots: { subject, color: payload.fontColor ? asColor(payload.fontColor) : undefined },
            };
        case "show":
        case "hide":
            return {
                form: "statement",
                verb: payload.operation === "show" ? "textShow" : "textHide",
                slots: {
                    subject,
                    ...transformSlots(ctx, block.id, payload.transform, payload.operation === "show" ? "reveal" : "conceal"),
                },
            };
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

function layerShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "layer" }>,
): NarralangShape {
    const target = layerValue(ctx, payload.target) ?? asName(payload.objectName);
    switch (payload.operation) {
        case "create":
            return {
                form: "statement",
                verb: "layerCreate",
                slots: { subject: asName(payload.objectName), zIndex: optNumber(payload.zIndex) },
            };
        case "setZIndex":
            return {
                form: "statement",
                verb: "layerZIndex",
                slots: { subject: target, zIndex: asNumber(payload.zIndex ?? 0) },
            };
        case "show":
        case "hide":
            return {
                form: "statement",
                verb: payload.operation === "show" ? "layerShow" : "layerHide",
                slots: { subject: target },
            };
        case "transform":
            return {
                form: "statement",
                verb: "layerTransform",
                slots: { subject: target, ...transformSlots(ctx, block.id, payload.transform, "reveal") },
            };
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

const VIDEO_TRANSPORT = {
    play: "videoPlay",
    pause: "videoPause",
    resume: "videoResume",
    stop: "videoStop",
} as const;

function videoShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "video" }>,
): NarralangShape {
    const subject = asName(payload.objectName);
    switch (payload.operation) {
        case "create":
            return {
                form: "statement",
                verb: "videoCreate",
                slots: {
                    subject,
                    source: assetName(ctx, block.id, payload.assetId),
                    muted: payload.muted ? asWord("muted") : undefined,
                },
            };
        case "seek":
            return { form: "statement", verb: "videoSeek", slots: { subject, time: asSeconds(payload.timeMs ?? 0) } };
        case "show":
        case "hide":
            return {
                form: "statement",
                verb: payload.operation === "show" ? "videoShow" : "videoHide",
                slots: { subject },
            };
        default:
            return { form: "statement", verb: VIDEO_TRANSPORT[payload.operation], slots: { subject } };
    }
}

function vfxShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "vfx" }>,
): NarralangShape {
    const subject = asName(payload.objectName);
    switch (payload.operation) {
        case "create":
            return {
                form: "statement",
                verb: "vfxCreate",
                slots: {
                    subject,
                    source: assetName(ctx, block.id, payload.assetId),
                    blend: payload.blendMode === undefined ? undefined : asWord(payload.blendMode),
                    opacity: optNumber(payload.opacity),
                    fit: payload.fit === undefined ? undefined : asWord(payload.fit),
                    zIndex: optNumber(payload.zIndex),
                    rate: optNumber(payload.rate),
                    loop: payload.loop === false ? asWord("once") : undefined,
                },
            };
        case "setRate":
            return { form: "statement", verb: "vfxRate", slots: { subject, rate: asNumber(payload.rate ?? 1) } };
        case "show":
        case "hide":
            return {
                form: "statement",
                verb: payload.operation === "show" ? "vfxShow" : "vfxHide",
                slots: { subject, duration: optSeconds(payload.durationMs) },
            };
        default:
            return {
                form: "statement",
                verb: payload.operation === "pause" ? "vfxPause" : "vfxResume",
                slots: { subject },
            };
    }
}

const DISPLAYABLE_VERBS = {
    mask: "displayableMask",
    clearMask: "displayableClearMask",
    clip: "displayableClip",
    clearClip: "displayableClearClip",
    filter: "displayableFilter",
    clearFilter: "displayableClearFilter",
    backdrop: "displayableBackdrop",
    blend: "displayableBlend",
    darken: "displayableDarken",
    circleReveal: "displayableReveal",
    circleClose: "displayableClose",
    wipe: "displayableWipe",
} as const;

/** The `displayable` verbs, which are the raw effect channel every stage object shares. */
function displayableShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "displayable" }>,
): NarralangShape {
    const subject = displayableValue(ctx, payload);
    const timing = timingSlots(payload.durationMs, payload.easing);
    if (payload.effectProps && Object.keys(payload.effectProps).length > 0) {
        ctx.report(block.id, "effectProps");
    }
    switch (payload.operation) {
        case "show":
        case "hide":
            return {
                form: "statement",
                verb: payload.operation === "show" ? "displayableShow" : "displayableHide",
                slots: {
                    subject,
                    ...transformSlots(ctx, block.id, payload.transform, payload.operation === "show" ? "reveal" : "conceal"),
                },
            };
        case "transform":
            return {
                form: "statement",
                verb: "displayableTransform",
                slots: { subject, ...transformSlots(ctx, block.id, payload.transform, "reveal") },
            };
        case "mask":
            return {
                form: "statement",
                verb: "displayableMask",
                slots: { subject, mask: assetName(ctx, block.id, payload.maskAssetId), ...timing },
            };
        case "clip":
            return {
                form: "statement",
                verb: "displayableClip",
                slots: { subject, clipPath: asString(payload.clipPath ?? ""), ...timing },
            };
        case "filter":
            return {
                form: "statement",
                verb: "displayableFilter",
                slots: { subject, filter: asString(payload.filter ?? ""), ...timing },
            };
        case "backdrop":
            return {
                form: "statement",
                verb: "displayableBackdrop",
                slots: { subject, filter: asString(payload.backdropFilter ?? ""), ...timing },
            };
        case "blend":
            return {
                form: "statement",
                verb: "displayableBlend",
                slots: { subject, blend: asWord(payload.mixBlendMode ?? "normal"), ...timing },
            };
        case "darken":
            return {
                form: "statement",
                verb: "displayableDarken",
                slots: { subject, darkness: asNumber(payload.darkness ?? 0), ...timing },
            };
        case "clearMask":
        case "clearClip":
        case "clearFilter":
        case "circleReveal":
        case "circleClose":
        case "wipe":
            return { form: "statement", verb: DISPLAYABLE_VERBS[payload.operation], slots: { subject, ...timing } };
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

function cameraShape(
    ctx: NarralangExtractContext,
    block: StoryBlock,
    payload: Extract<StoryActionPayload, { action: "camera" }>,
): NarralangShape {
    const timing = timingSlots(payload.durationMs, payload.easing);
    switch (payload.operation) {
        case "pan": {
            const placement = storyCameraPanPlacement(payload.position);
            if (!placement) {
                ctx.report(block.id, "customTransform", "camera");
                return { form: "statement", verb: "cameraPan", slots: timing };
            }
            return { form: "statement", verb: "cameraPan", slots: { placement: asWord(placement), ...timing } };
        }
        case "zoom":
            return { form: "statement", verb: "cameraZoom", slots: { zoom: asNumber(payload.zoom ?? 1), ...timing } };
        case "rotate":
            return {
                form: "statement",
                verb: "cameraRotate",
                slots: { rotation: asNumber(payload.rotation ?? 0), ...timing },
            };
        case "darken":
            return {
                form: "statement",
                verb: "cameraDarken",
                slots: { darkness: asNumber(payload.darkness ?? 0), ...timing },
            };
        case "look": {
            // A hand-written filter is printed as itself and the preset name goes with it when there
            // is one: the compile prefers the filter, so a script that showed only the grade name
            // would read as a different row than the one that plays.
            const preset = payload.lookPreset;
            const custom = payload.filter?.trim();
            if (!preset && !custom) {
                // Nothing chosen yet - the row compiles to nothing, so the script says the same.
                return { form: "statement", verb: "cameraLook", slots: timing };
            }
            return {
                form: "statement",
                verb: "cameraLook",
                slots: {
                    ...(preset ? { look: asName(preset) } : {}),
                    ...(payload.lookIntensity === undefined ? {} : { strength: asNumber(payload.lookIntensity) }),
                    ...(custom ? { filter: asString(custom) } : {}),
                    ...timing,
                },
            };
        }
        case "reset":
            return { form: "statement", verb: "cameraReset", slots: timing };
        case "motion": {
            const animationId = payload.motion?.animationId;
            const name = animationId ? ctx.lookups.motionName?.(animationId) ?? null : null;
            if (!name) {
                ctx.report(block.id, "unresolvedRef", "motion");
                return { form: "statement", verb: "cameraMotion", slots: {} };
            }
            return { form: "statement", verb: "cameraMotion", slots: { motion: asName(name) } };
        }
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

// --- Actions ------------------------------------------------------------------------------------------

function actionShape(ctx: NarralangExtractContext, block: StoryBlock, payload: StoryActionPayload): NarralangShape {
    switch (payload.action) {
        case "setBackground":
            return {
                form: "statement",
                verb: "background",
                slots: {
                    source: payload.color ? asColor(payload.color) : assetName(ctx, block.id, payload.assetId),
                    ...transitionSlots(ctx, block.id, payload.transition, "scene"),
                },
            };
        case "character":
            return characterShape(ctx, block, payload);
        case "audio":
            return audioShape(ctx, block, payload);
        case "setVariable":
            return {
                form: "statement",
                verb: "variableSet",
                slots: {
                    subject: asName(variableName(ctx, block.id, payload.target)),
                    value: payload.expression ? asExpression(payload.expression.source) : asLiteral(payload.value),
                },
            };
        case "wait":
            return {
                form: "statement",
                verb: "wait",
                slots: {
                    amount: payload.mode === "click" ? asWord("click") : asSeconds(payload.durationMs ?? 0),
                },
            };
        case "image":
            return imageShape(ctx, block, payload);
        case "displayable":
            return displayableShape(ctx, block, payload);
        case "text":
            return textObjectShape(ctx, block, payload);
        case "layer":
            return layerShape(ctx, block, payload);
        case "video":
            return videoShape(ctx, block, payload);
        case "camera":
            return cameraShape(ctx, block, payload);
        case "vfx":
            return vfxShape(ctx, block, payload);
        case "nvl":
            return {
                form: "statement",
                verb: "nvl",
                slots: transformSlots(ctx, block.id, payload.transition, "nvl"),
            };
        case "screenEffect":
            // `inner` and `outer` are vignette-only in the grammar, so they are extracted only for it -
            // printing them on a blink would produce a line the matcher then refuses.
            return {
                form: "statement",
                verb: payload.effect === "blink" ? "screenBlink" : "screenVignette",
                slots: {
                    duration: optSeconds(payload.durationMs),
                    fadeIn: optSeconds(payload.inMs),
                    fadeOut: optSeconds(payload.outMs),
                    hold: optSeconds(payload.holdMs),
                    color: payload.color === undefined ? undefined : asColor(payload.color),
                    opacity: optNumber(payload.opacity),
                    ...(payload.effect === "vignette" ? {
                        inner: optNumber(payload.inner),
                        outer: optNumber(payload.outer),
                    } : {}),
                    easing: payload.easing === undefined ? undefined : asName(payload.easing),
                },
            };
        case "blueprint":
            ctx.report(block.id, "blueprintAction");
            return { form: "silent" };
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

// --- Control ------------------------------------------------------------------------------------------

function controlShape(ctx: NarralangExtractContext, block: StoryBlock, payload: StoryControlPayload): NarralangShape {
    switch (payload.control) {
        case "condition":
            // The container the branches hang off. A script writes the branches directly, so printing
            // anything here would insert a level of indentation the language does not have.
            return { form: "transparent" };
        case "conditionBranch": {
            if (payload.branch === "else") {
                return { form: "statement", verb: "conditionElse", opensBlock: true, slots: {} };
            }
            const test = conditionSource(ctx, block.id, payload.condition);
            return {
                form: "statement",
                verb: payload.branch === "if" ? "conditionIf" : "conditionElseIf",
                opensBlock: true,
                slots: { test: test ? asExpression(test) : undefined },
            };
        }
        case "sequence":
        case "parallel":
        case "race":
        case "repeat": {
            const asyncWord = payload.mode === "doAsync" || payload.mode === "allAsync" ? asWord("async") : undefined;
            if (payload.control === "repeat") {
                const until = payload.until ? conditionSource(ctx, block.id, payload.until) : undefined;
                return {
                    form: "statement",
                    verb: "repeat",
                    opensBlock: true,
                    slots: until
                        ? { test: asExpression(until), async: asyncWord }
                        : { times: optNumber(payload.times), async: asyncWord },
                };
            }
            return { form: "statement", verb: payload.control, opensBlock: true, slots: { async: asyncWord } };
        }
        case "break":
            return { form: "statement", verb: "break", slots: {} };
        case "label":
            return { form: "statement", verb: "label", slots: { label: asName(payload.name) } };
        case "goto":
            return { form: "statement", verb: "goto", slots: { label: asName(payload.targetLabel) } };
        case "cut": {
            const name = ctx.lookups.appTagName?.(payload.appTagId) ?? null;
            if (!name) {
                ctx.report(block.id, "unresolvedRef", "variant");
                return { form: "statement", verb: "cut", slots: {} };
            }
            return { form: "statement", verb: "cut", slots: { variant: asName(name) } };
        }
        default:
            ctx.report(block.id, "unknownPayload");
            return { form: "silent" };
    }
}

// --- Jump / declaration ---------------------------------------------------------------------------------

function jumpShape(ctx: NarralangExtractContext, block: StoryBlock, payload: StoryJumpPayload): NarralangShape {
    const name = resolveStorySceneName(ctx.lookups.scenes, payload.targetSceneId);
    if (name === null) {
        ctx.report(block.id, "unresolvedRef", "scene");
    }
    return {
        form: "statement",
        verb: "jump",
        slots: {
            scene: asName(name ?? ""),
            ...transitionSlots(ctx, block.id, payload.transition, "scene"),
        },
    };
}

function declarationShape(payload: StoryDeclarationPayload): NarralangShape {
    return {
        form: "statement",
        verb: "declaration",
        slots: {
            subject: asName(payload.name),
            valueType: asWord(payload.valueType),
            value: payload.defaultValue === undefined ? undefined : asLiteral(payload.defaultValue),
            // A scene-scoped variable is the default, so saying so would be noise on every row.
            scope: payload.scope === "scene" ? undefined : asWord(payload.scope),
            description: payload.description ? asString(payload.description) : undefined,
        },
    };
}

// --- Entry ------------------------------------------------------------------------------------------

/** One row's structure, with every reason it could not be spelled already reported. */
export function narralangShapeOf(ctx: NarralangExtractContext, block: StoryBlock): NarralangShape {
    reportTextIssues(ctx, block);
    // Read before the switch: a block kind this build does not know narrows `block` to `never`, and
    // the defensive arm still has to name the row it is refusing.
    const blockId = block.id;
    switch (block.kind) {
        case "nodeAction":
            return nodeActionShape(ctx, block, block.payload);
        case "action":
            return actionShape(ctx, block, block.payload);
        case "control":
            return controlShape(ctx, block, block.payload);
        case "jump":
            return jumpShape(ctx, block, block.payload);
        case "note":
            return { form: "note", text: textOf(ctx, block.id, block.payload.text, "note") };
        case "declaration":
            return declarationShape(block.payload);
        case "invalid":
            ctx.report(blockId, "invalidRow");
            return { form: "raw", source: block.payload.source };
        default:
            ctx.report(blockId, "unknownPayload");
            return { form: "silent" };
    }
}
