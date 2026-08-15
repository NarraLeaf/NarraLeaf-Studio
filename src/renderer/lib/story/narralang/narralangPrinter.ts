/**
 * The canonical NarraLang printer: a story scene as a script.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * ## Printing and coverage are one pass, on purpose
 *
 * "Which rows can NarraLang say?" and "what does NarraLang say for this row?" are the same question,
 * and answering them in two places is how they drift - the analyser keeps claiming a scene is
 * expressible after the printer has grown a case it cannot spell, or refuses one the printer handles
 * fine. So the printer collects {@link NarralangIssue}s as it goes and a scene is expressible exactly
 * when it produced none. {@link narralangSceneExpressible} is a thin wrapper that throws the text
 * away, not a second implementation.
 *
 * The stake is real: a scene reported as expressible is one the text view will open for editing.
 *
 * ## No locale, ever
 *
 * Nothing in this file may call `translate` or read the localised command tables
 * (`localizedParams` / `localizedEnums` / `localizedUnits`). `projectStoryCommandLine` is the
 * display-side twin of this printer and does all three, which is why this is a separate printer and
 * not a flag on that one.
 */

import type {
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryConditionRef,
    StoryControlPayload,
    StoryDeclarationPayload,
    StoryDocument,
    StoryJumpPayload,
    StoryLayerRef,
    StoryNodeActionPayload,
    StoryScene,
    StoryTransformRef,
    StoryTransitionRef,
    StoryVariableRef,
} from "@shared/types/story";
import { listSceneIdsInDocumentOrder, resolveDisplayableTargetRef, resolveStoryLayerRef } from "@shared/types/story";
import { storyMsToSeconds } from "@shared/utils/storyTime";

import {
    resolveStoryCharacterName,
    resolveStorySceneName,
    resolveStoryVariableName,
    storyCameraPanPlacement,
    type StoryRowLookups,
} from "@/lib/story/storyRowProjection";
import { transitionWordFor, transitionWordForPreset } from "@/apps/workspace/modules/story/scene-editor/commands/transitions";

import {
    NARRALANG_BUILTIN_SIGIL,
    NARRALANG_DISABLED_PREFIX,
    NARRALANG_INDENT,
    NARRALANG_NOTE_PREFIX,
    narralangLiteral,
    narralangName,
    narralangNumber,
    narralangSeconds,
    narralangStatement,
    narralangString,
} from "./narralangSyntax";
import { printNarralangText } from "./narralangText";

// --- Result types -------------------------------------------------------------------------------

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
    /** An inline `{…}` value computed by a blueprint. */
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
    /** A payload shape this printer does not know. Defensive: a new action kind lands here first. */
    | "unknownPayload";

export type NarralangIssue = {
    blockId: StoryBlockId;
    reason: NarralangIssueReason;
    /** A short, already-resolved noun for the thing at fault. Never an id. */
    detail?: string;
};

/**
 * What the printer needs from outside a block.
 *
 * `StoryRowLookups` already covers characters, assets, motions, appearances and scenes - the printer
 * needs exactly the same table the row projection does, which is the point: two surfaces over one
 * set of lookups, not two lookup vocabularies. The one addition is build variants, which the row
 * projection reads off `commandContext` (a command-line concern this printer has no business
 * carrying) and which a `cut` row needs to name.
 */
export type NarralangLookups = StoryRowLookups & {
    /** The author-facing name of a build variant (`AppTag`), or `null` when the id answers to none. */
    appTagName?: (appTagId: string) => string | null;
};

export type NarralangSceneResult = {
    /** The script. Always produced, even for a scene with issues - export is one-way and best effort. */
    text: string;
    /**
     * Empty exactly when every row in the scene has a spelling. The text view opens read-only unless
     * this is empty; see the design doc's "the gate".
     */
    issues: NarralangIssue[];
};

// --- Context ------------------------------------------------------------------------------------

type Ctx = {
    scene: StoryScene;
    lookups: NarralangLookups;
    issues: NarralangIssue[];
    lines: string[];
};

function report(ctx: Ctx, blockId: StoryBlockId, reason: NarralangIssueReason, detail?: string): void {
    ctx.issues.push(detail === undefined ? { blockId, reason } : { blockId, reason, detail });
}

function emit(ctx: Ctx, depth: number, line: string): void {
    ctx.lines.push(line === "" ? "" : `${NARRALANG_INDENT.repeat(depth)}${line}`);
}

// --- Shared value printers ----------------------------------------------------------------------

function assetToken(ctx: Ctx, blockId: StoryBlockId, assetId: string | undefined): string | undefined {
    if (!assetId) {
        return undefined;
    }
    const name = ctx.lookups.assetName?.(assetId) ?? null;
    if (!name) {
        report(ctx, blockId, "unresolvedRef", "asset");
        return undefined;
    }
    return narralangName(name);
}

/**
 * A character by name.
 *
 * Deliberately NOT `storyCharacterName`: that one answers a miss with `translate(…)`, which would put
 * "Unknown character" in an English export and "未知角色" in a Chinese one for the same document. A
 * name this printer cannot resolve is a row it cannot spell, so it is reported and the scene stops
 * being expressible - which is the honest outcome, since the author has a dangling reference.
 */
function characterToken(ctx: Ctx, blockId: StoryBlockId, characterId: string | undefined): string {
    const name = resolveStoryCharacterName(ctx.lookups, characterId);
    if (name === null || name === "") {
        report(ctx, blockId, "unresolvedRef", "character");
        return "''";
    }
    return narralangName(name);
}

/** Same split, same reason, as {@link characterToken}. */
function variableToken(ctx: Ctx, blockId: StoryBlockId, ref: StoryVariableRef): string {
    const name = resolveStoryVariableName(ref, ctx.lookups);
    if (name === null || name === "") {
        report(ctx, blockId, "unresolvedRef", "variable");
        return "''";
    }
    return narralangName(name);
}

function layerToken(ctx: Ctx, ref: StoryLayerRef | undefined): string | undefined {
    if (!ref) {
        return undefined;
    }
    const resolved = resolveStoryLayerRef(ctx.scene, ref);
    if (resolved.kind === "default") {
        return `${NARRALANG_BUILTIN_SIGIL}${resolved.layer === "background" ? "bglayer" : "stagelayer"}`;
    }
    return narralangName(resolved.name);
}

/** A displayable target: a built-in singleton under `@`, or the stage name of its creator row. */
function displayableToken(ctx: Ctx, payload: { target: { builtin?: string; name: string } }): string {
    const target = payload.target as Parameters<typeof resolveDisplayableTargetRef>[1];
    if (target.builtin) {
        const word = target.builtin === "background" ? "background" : target.builtin === "backgroundLayer" ? "bglayer" : "stagelayer";
        return `${NARRALANG_BUILTIN_SIGIL}${word}`;
    }
    return narralangName(resolveDisplayableTargetRef(ctx.scene, target).name);
}

/**
 * The `at` / `with` / `over` / `ease` tail a transform contributes.
 *
 * A transform says two different things depending on its preset: a placement (`left`/`center`/
 * `right`) is *where*, and a reveal/conceal preset is *how*. Both can carry a duration, so the tail
 * is assembled rather than switched.
 */
function transformTail(
    ctx: Ctx,
    blockId: StoryBlockId,
    ref: StoryTransformRef | undefined,
    context: "reveal" | "conceal" | "nvl",
): string[] {
    if (!ref) {
        return [];
    }
    if (ref.mode === "animation" || ref.preset === "custom" || (ref.props && Object.keys(ref.props).length > 0)) {
        report(ctx, blockId, "customTransform");
        return [];
    }
    const out: string[] = [];
    if (ref.preset === "left" || ref.preset === "center" || ref.preset === "right") {
        out.push(`at ${ref.preset}`);
    } else if (ref.preset && ref.preset !== "none") {
        const word = transitionWordForPreset(context, ref.preset);
        if (!word) {
            report(ctx, blockId, "customTransform");
        } else {
            out.push(`with ${word}${ref.durationMs === undefined ? "" : ` ${narralangSeconds(ref.durationMs)}`}`);
            if (ref.easing) {
                out.push(`ease ${narralangName(ref.easing)}`);
            }
            return out;
        }
    }
    if (ref.durationMs !== undefined) {
        out.push(`over ${narralangSeconds(ref.durationMs)}`);
    }
    if (ref.easing) {
        out.push(`ease ${narralangName(ref.easing)}`);
    }
    return out;
}

/** The `with <word> [seconds]` tail a transition contributes. */
function transitionTail(
    ctx: Ctx,
    blockId: StoryBlockId,
    ref: StoryTransitionRef | undefined,
    context: "scene" | "character",
): string[] {
    if (!ref || ref.kind === "none") {
        return [];
    }
    if (ref.kind === "custom" || (ref.props && Object.keys(ref.props).length > 0)) {
        report(ctx, blockId, "customTransition");
        return [];
    }
    const word = transitionWordFor(context, ref.kind);
    if (!word) {
        report(ctx, blockId, "customTransition");
        return [];
    }
    const out = [`with ${word}${ref.durationMs === undefined ? "" : ` ${narralangSeconds(ref.durationMs)}`}`];
    if (ref.easing) {
        out.push(`ease ${narralangName(ref.easing)}`);
    }
    return out;
}

/**
 * A condition as an expression.
 *
 * The five `variable` operators lower to the expression language's own spelling rather than keeping a
 * vocabulary of their own - `isTrue` is just the variable, `equals` is `==`. That keeps one syntax
 * for conditions whether the row stored a structured ref or a parsed expression, which is what lets
 * `if trust > 0` and a variable-ref condition read the same.
 */
function conditionText(ctx: Ctx, blockId: StoryBlockId, ref: StoryConditionRef | undefined): string | undefined {
    if (!ref) {
        return undefined;
    }
    if (ref.kind === "blueprint") {
        report(ctx, blockId, "blueprintCondition");
        return undefined;
    }
    if (ref.kind === "expression") {
        return ref.expression.source;
    }
    const name = variableToken(ctx, blockId, ref.target);
    switch (ref.operator) {
        case "isTrue":
            return name;
        case "isFalse":
            return `not ${name}`;
        case "equals":
            return `${name} == ${narralangLiteral(ref.value ?? null)}`;
        case "notEquals":
            return `${name} != ${narralangLiteral(ref.value ?? null)}`;
        case "exists":
            return `exists ${name}`;
        default:
            return name;
    }
}

// --- Node actions (prose) -----------------------------------------------------------------------

function printNodeAction(ctx: Ctx, block: StoryBlock, payload: StoryNodeActionPayload): string {
    switch (payload.action) {
        case "narration":
            return printNarralangText(payload.text, ctx.lookups, "narration");
        case "dialogue": {
            // A bare `speakerName` is a first-class state (a line spoken by nobody in the character
            // list), so only a characterId that resolves to nothing is a miss.
            const header: string[] = [
                payload.characterId
                    ? characterToken(ctx, block.id, payload.characterId)
                    : narralangName(payload.speakerName ?? ""),
            ];
            if (payload.voiceAssetId) {
                const voice = assetToken(ctx, block.id, payload.voiceAssetId);
                if (voice) {
                    header.push("voice", voice);
                }
            }
            if (payload.pauseAfter === true) {
                header.push("pause", "click");
            } else if (typeof payload.pauseAfter === "number") {
                header.push("pause", narralangSeconds(payload.pauseAfter));
            }
            return `${header.join(" ")}: ${printNarralangText(payload.text, ctx.lookups, "dialogueText")}`;
        }
        case "choice": {
            const prompt = payload.prompt ? printNarralangText(payload.prompt, ctx.lookups, "narration") : "";
            return narralangStatement("menu", prompt) + ":";
        }
        case "choiceOption": {
            const parts = [printNarralangText(payload.text, ctx.lookups, "option")];
            const hidden = conditionText(ctx, block.id, payload.hiddenWhen);
            if (hidden) {
                parts.push(`show if ${hidden}`);
            }
            const disabled = conditionText(ctx, block.id, payload.disabledWhen);
            if (disabled) {
                parts.push(`enable if ${disabled}`);
            }
            return `${parts.join(" ")}:`;
        }
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

// --- Character --------------------------------------------------------------------------------

/**
 * The appearance tokens a character row carries: a pose, a tag per axis, or a puppet's state name.
 *
 * Tags print as a list of tag NAMES, not `axis:tag` pairs, because nothing in `StoryRowLookups` can
 * name an axis - `appearanceName` resolves a pose or tag id and there is no axis equivalent. The
 * command line has the same limit (it can only name a single-entry selection at all), so this is not
 * a step down from what an author can already read.
 */
function appearanceTokens(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "character" }>): string[] {
    const out: string[] = [];
    const characterId = payload.characterId;
    if (payload.pose && characterId) {
        const name = ctx.lookups.appearanceName?.(characterId, payload.pose) ?? null;
        if (!name) {
            report(ctx, block.id, "unresolvedRef", "appearance");
        } else {
            out.push(narralangName(name));
        }
    }
    for (const tagId of Object.values(payload.tags ?? {})) {
        const name = characterId ? ctx.lookups.appearanceName?.(characterId, tagId) ?? null : null;
        if (!name) {
            report(ctx, block.id, "unresolvedRef", "appearance");
        } else {
            out.push(narralangName(name));
        }
    }
    if (payload.puppetName) {
        out.push(narralangName(payload.puppetName));
    }
    return out;
}

function printCharacter(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "character" }>): string {
    const who = characterToken(ctx, block.id, payload.characterId);
    switch (payload.operation) {
        case "enter":
            return narralangStatement(
                "show",
                who,
                ...appearanceTokens(ctx, block, payload),
                ...transformTail(ctx, block.id, payload.transform, "reveal"),
                ...transitionTail(ctx, block.id, payload.transition, "character"),
            );
        case "exit":
            return narralangStatement(
                "hide",
                who,
                ...transformTail(ctx, block.id, payload.transform, "conceal"),
                ...transitionTail(ctx, block.id, payload.transition, "character"),
            );
        case "move":
            return narralangStatement("move", who, ...transformTail(ctx, block.id, payload.transform, "reveal"));
        case "expression":
            return narralangStatement("face", who, ...appearanceTokens(ctx, block, payload));
        case "setName":
            return narralangStatement("rename", who, narralangName(payload.displayName ?? ""));
        case "setMotion":
            return narralangStatement("motion", who, ...appearanceTokens(ctx, block, payload));
        case "setSkin":
            return narralangStatement("skin", who, ...appearanceTokens(ctx, block, payload));
        case "setParams": {
            const pairs = Object.entries(payload.params ?? {}).map(
                ([id, value]) => `${narralangName(id)} ${narralangNumber(value)}`,
            );
            return narralangStatement("param", who, ...pairs);
        }
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

// --- Audio ------------------------------------------------------------------------------------

function printAudio(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "audio" }>): string {
    const handle = payload.objectName ? narralangName(payload.objectName) : undefined;
    const fade = payload.fadeMs === undefined ? undefined : narralangSeconds(payload.fadeMs);
    const volume = payload.volume === undefined ? undefined : `volume ${narralangNumber(payload.volume)}`;

    switch (payload.operation) {
        case "setBgm":
        case "playSound": {
            const isBgm = payload.operation === "setBgm";
            return narralangStatement(
                "play",
                isBgm ? "bgm" : "sound",
                assetToken(ctx, block.id, payload.assetId),
                !isBgm && handle ? `as ${handle}` : undefined,
                volume,
                fade === undefined ? undefined : `fadein ${fade}`,
                payload.loop === undefined ? undefined : payload.loop ? "loop" : "once",
                payload.rate === undefined ? undefined : `rate ${narralangNumber(payload.rate)}`,
            );
        }
        case "stopSound":
            return narralangStatement("stop", handle ?? "bgm", fade === undefined ? undefined : `fadeout ${fade}`);
        case "pauseSound":
            return narralangStatement("pause", handle ?? "bgm", fade === undefined ? undefined : `fadeout ${fade}`);
        case "resumeSound":
            return narralangStatement("resume", handle ?? "bgm", fade === undefined ? undefined : `fadein ${fade}`);
        case "setVolume":
            return narralangStatement(
                "volume",
                handle ?? "bgm",
                narralangNumber(payload.volume ?? 0),
                fade === undefined ? undefined : `over ${fade}`,
            );
        case "setRate":
            return narralangStatement("rate", handle ?? "bgm", narralangNumber(payload.rate ?? 1));
        case "muteSound":
            return narralangStatement(payload.muted === false ? "unmute" : "mute", handle ?? "bgm");
        case "seekSound":
            return narralangStatement("seek", handle ?? "bgm", narralangSeconds(payload.timeMs ?? 0));
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

// --- Stage objects ------------------------------------------------------------------------------

function printImage(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "image" }>): string {
    const name = narralangName(payload.objectName);
    const source = payload.color ? payload.color : assetToken(ctx, block.id, payload.assetId);
    switch (payload.operation) {
        case "create":
            return narralangStatement(
                "image",
                "create",
                name,
                source,
                layerToken(ctx, payload.layer) === undefined ? undefined : `on ${layerToken(ctx, payload.layer)}`,
                payload.autoFit ? "autofit" : undefined,
                ...transformTail(ctx, block.id, payload.transform, "reveal"),
            );
        case "setSource":
            return narralangStatement("image", "source", name, source);
        case "show":
            return narralangStatement(
                "show",
                name,
                ...transformTail(ctx, block.id, payload.transform, "reveal"),
                ...transitionTail(ctx, block.id, payload.transition, "character"),
            );
        case "hide":
            return narralangStatement(
                "hide",
                name,
                ...transformTail(ctx, block.id, payload.transform, "conceal"),
                ...transitionTail(ctx, block.id, payload.transition, "character"),
            );
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

function printText(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "text" }>): string {
    const name = narralangName(payload.objectName);
    const layer = layerToken(ctx, payload.layer);
    switch (payload.operation) {
        case "create":
            return narralangStatement(
                "text",
                "create",
                name,
                payload.text === undefined ? undefined : narralangString(payload.text),
                layer === undefined ? undefined : `on ${layer}`,
                ...transformTail(ctx, block.id, payload.transform, "reveal"),
            );
        case "setText":
            return narralangStatement("text", "set", name, narralangString(payload.text ?? ""));
        case "setFontSize":
            return narralangStatement("text", "size", name, narralangNumber(payload.fontSize ?? 0));
        case "setFontColor":
            return narralangStatement("text", "color", name, payload.fontColor ?? "");
        case "show":
        case "hide":
            return narralangStatement(payload.operation, name, ...transformTail(ctx, block.id, payload.transform, payload.operation === "show" ? "reveal" : "conceal"));
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

function printLayer(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "layer" }>): string {
    const target = layerToken(ctx, payload.target) ?? narralangName(payload.objectName);
    switch (payload.operation) {
        case "create":
            return narralangStatement(
                "layer",
                "create",
                narralangName(payload.objectName),
                payload.zIndex === undefined ? undefined : `zindex ${narralangNumber(payload.zIndex)}`,
            );
        case "setZIndex":
            return narralangStatement("layer", "zindex", target, narralangNumber(payload.zIndex ?? 0));
        case "show":
        case "hide":
            return narralangStatement(payload.operation, target);
        case "transform":
            return narralangStatement("transform", target, ...transformTail(ctx, block.id, payload.transform, "reveal"));
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

function printVideo(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "video" }>): string {
    const name = narralangName(payload.objectName);
    switch (payload.operation) {
        case "create":
            return narralangStatement(
                "video",
                "create",
                name,
                assetToken(ctx, block.id, payload.assetId),
                payload.muted ? "muted" : undefined,
            );
        case "seek":
            return narralangStatement("video", "seek", name, narralangSeconds(payload.timeMs ?? 0));
        case "show":
        case "hide":
            return narralangStatement(payload.operation, name);
        default:
            return narralangStatement("video", payload.operation, name);
    }
}

function printVfx(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "vfx" }>): string {
    const name = narralangName(payload.objectName);
    switch (payload.operation) {
        case "create":
            return narralangStatement(
                "vfx",
                "create",
                name,
                assetToken(ctx, block.id, payload.assetId),
                payload.blendMode === undefined ? undefined : `blend ${payload.blendMode}`,
                payload.opacity === undefined ? undefined : `opacity ${narralangNumber(payload.opacity)}`,
                payload.fit === undefined ? undefined : `fit ${payload.fit}`,
                payload.zIndex === undefined ? undefined : `zindex ${narralangNumber(payload.zIndex)}`,
                payload.rate === undefined ? undefined : `rate ${narralangNumber(payload.rate)}`,
                payload.loop === false ? "once" : undefined,
            );
        case "setRate":
            return narralangStatement("vfx", "rate", name, narralangNumber(payload.rate ?? 1));
        case "show":
        case "hide":
            return narralangStatement(
                payload.operation,
                name,
                payload.durationMs === undefined ? undefined : `over ${narralangSeconds(payload.durationMs)}`,
            );
        default:
            return narralangStatement("vfx", payload.operation, name);
    }
}

/** The `displayable` verbs, which are the raw effect channel every stage object shares. */
function printDisplayable(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "displayable" }>): string {
    const target = displayableToken(ctx, payload);
    const timing = [
        payload.durationMs === undefined ? undefined : `over ${narralangSeconds(payload.durationMs)}`,
        payload.easing === undefined ? undefined : `ease ${narralangName(payload.easing)}`,
    ];
    if (payload.effectProps && Object.keys(payload.effectProps).length > 0) {
        report(ctx, block.id, "effectProps");
    }
    switch (payload.operation) {
        case "show":
        case "hide":
            return narralangStatement(payload.operation, target, ...transformTail(ctx, block.id, payload.transform, payload.operation === "show" ? "reveal" : "conceal"));
        case "transform":
            return narralangStatement("transform", target, ...transformTail(ctx, block.id, payload.transform, "reveal"));
        case "mask":
            return narralangStatement("mask", target, assetToken(ctx, block.id, payload.maskAssetId), ...timing);
        case "clearMask":
            return narralangStatement("clearmask", target, ...timing);
        case "clip":
            return narralangStatement("clip", target, narralangString(payload.clipPath ?? ""), ...timing);
        case "clearClip":
            return narralangStatement("clearclip", target, ...timing);
        case "filter":
            return narralangStatement("filter", target, narralangString(payload.filter ?? ""), ...timing);
        case "clearFilter":
            return narralangStatement("clearfilter", target, ...timing);
        case "backdrop":
            return narralangStatement("backdrop", target, narralangString(payload.backdropFilter ?? ""), ...timing);
        case "blend":
            return narralangStatement("blend", target, payload.mixBlendMode ?? "normal", ...timing);
        case "darken":
            return narralangStatement("darken", target, narralangNumber(payload.darkness ?? 0), ...timing);
        case "circleReveal":
            return narralangStatement("reveal", target, ...timing);
        case "circleClose":
            return narralangStatement("close", target, ...timing);
        case "wipe":
            return narralangStatement("wipe", target, ...timing);
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

function printCamera(ctx: Ctx, block: StoryBlock, payload: Extract<StoryActionPayload, { action: "camera" }>): string {
    const timing = [
        payload.durationMs === undefined ? undefined : `over ${narralangSeconds(payload.durationMs)}`,
        payload.easing === undefined ? undefined : `ease ${narralangName(payload.easing)}`,
    ];
    switch (payload.operation) {
        case "pan": {
            const placement = storyCameraPanPlacement(payload.position);
            if (!placement) {
                report(ctx, block.id, "customTransform", "camera");
                return narralangStatement("camera", "pan", ...timing);
            }
            return narralangStatement("camera", "pan", placement, ...timing);
        }
        case "zoom":
            return narralangStatement("camera", "zoom", narralangNumber(payload.zoom ?? 1), ...timing);
        case "rotate":
            return narralangStatement("camera", "rotate", narralangNumber(payload.rotation ?? 0), ...timing);
        case "darken":
            return narralangStatement("camera", "darken", narralangNumber(payload.darkness ?? 0), ...timing);
        case "reset":
            return narralangStatement("camera", "reset", ...timing);
        case "motion": {
            const animationId = payload.motion?.animationId;
            const name = animationId ? ctx.lookups.motionName?.(animationId) ?? null : null;
            if (!name) {
                report(ctx, block.id, "unresolvedRef", "motion");
                return narralangStatement("camera", "motion");
            }
            return narralangStatement("camera", "motion", narralangName(name));
        }
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

// --- Actions ------------------------------------------------------------------------------------

function printAction(ctx: Ctx, block: StoryBlock, payload: StoryActionPayload): string {
    switch (payload.action) {
        case "setBackground": {
            const source = payload.color ? payload.color : assetToken(ctx, block.id, payload.assetId);
            return narralangStatement("bg", source, ...transitionTail(ctx, block.id, payload.transition, "scene"));
        }
        case "character":
            return printCharacter(ctx, block, payload);
        case "audio":
            return printAudio(ctx, block, payload);
        case "setVariable": {
            const name = variableToken(ctx, block.id, payload.target);
            const rhs = payload.expression ? payload.expression.source : narralangLiteral(payload.value);
            return `set ${name} = ${rhs}`;
        }
        case "wait":
            return payload.mode === "click"
                ? "wait click"
                : `wait ${narralangSeconds(payload.durationMs ?? 0)}`;
        case "image":
            return printImage(ctx, block, payload);
        case "displayable":
            return printDisplayable(ctx, block, payload);
        case "text":
            return printText(ctx, block, payload);
        case "layer":
            return printLayer(ctx, block, payload);
        case "video":
            return printVideo(ctx, block, payload);
        case "camera":
            return printCamera(ctx, block, payload);
        case "vfx":
            return printVfx(ctx, block, payload);
        case "nvl":
            return narralangStatement("nvl", ...transformTail(ctx, block.id, payload.transition, "nvl"));
        case "screenEffect":
            return narralangStatement(
                payload.effect,
                payload.durationMs === undefined ? undefined : `over ${narralangSeconds(payload.durationMs)}`,
                payload.holdMs === undefined ? undefined : `hold ${narralangSeconds(payload.holdMs)}`,
                payload.color === undefined ? undefined : `color ${payload.color}`,
                payload.opacity === undefined ? undefined : `opacity ${narralangNumber(payload.opacity)}`,
                payload.easing === undefined ? undefined : `ease ${narralangName(payload.easing)}`,
            );
        case "blueprint":
            report(ctx, block.id, "blueprintAction");
            return "";
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

// --- Control ------------------------------------------------------------------------------------

/**
 * A control row's line, or `null` when the row itself prints nothing.
 *
 * `condition` is the only null: it is the container the branches hang off, and a script writes the
 * branches directly (`if` / `elif` / `else`), so printing anything for the container would insert a
 * level of indentation the language does not have.
 */
function printControl(ctx: Ctx, block: StoryBlock, payload: StoryControlPayload): string | null {
    switch (payload.control) {
        case "condition":
            return null;
        case "conditionBranch": {
            if (payload.branch === "else") {
                return "else:";
            }
            const test = conditionText(ctx, block.id, payload.condition);
            return `${payload.branch === "if" ? "if" : "elif"}${test ? ` ${test}` : ""}:`;
        }
        case "sequence":
        case "parallel":
        case "race":
        case "repeat": {
            const async = payload.mode === "doAsync" || payload.mode === "allAsync";
            if (payload.control === "repeat") {
                const until = payload.until ? conditionText(ctx, block.id, payload.until) : undefined;
                if (until) {
                    return `${narralangStatement("repeat", "until", until, async ? "async" : undefined)}:`;
                }
                return `${narralangStatement("repeat", payload.times === undefined ? undefined : narralangNumber(payload.times), async ? "async" : undefined)}:`;
            }
            return `${narralangStatement(payload.control, async ? "async" : undefined)}:`;
        }
        case "break":
            return "break";
        case "label":
            return narralangStatement("label", narralangName(payload.name));
        case "goto":
            return narralangStatement("goto", narralangName(payload.targetLabel));
        case "cut": {
            const name = ctx.lookups.appTagName?.(payload.appTagId) ?? null;
            if (!name) {
                report(ctx, block.id, "unresolvedRef", "variant");
                return "cut";
            }
            return narralangStatement("cut", narralangName(name));
        }
        default:
            report(ctx, block.id, "unknownPayload");
            return "";
    }
}

// --- Jump / note / declaration ------------------------------------------------------------------

function printJump(ctx: Ctx, block: StoryBlock, payload: StoryJumpPayload): string {
    const name = resolveStorySceneName(ctx.lookups.scenes, payload.targetSceneId);
    if (name === null) {
        report(ctx, block.id, "unresolvedRef", "scene");
        return narralangStatement("jump", "''", ...transitionTail(ctx, block.id, payload.transition, "scene"));
    }
    return narralangStatement("jump", narralangName(name), ...transitionTail(ctx, block.id, payload.transition, "scene"));
}

function printDeclaration(payload: StoryDeclarationPayload): string {
    const head = `var ${narralangName(payload.name)}: ${payload.valueType}`;
    const withDefault = payload.defaultValue === undefined ? head : `${head} = ${narralangLiteral(payload.defaultValue)}`;
    return narralangStatement(
        withDefault,
        payload.scope === "scene" ? undefined : `in ${payload.scope}`,
        payload.description ? `desc ${narralangString(payload.description)}` : undefined,
    );
}

// --- Walk ---------------------------------------------------------------------------------------

/** Whether a text row's runs carry something with no spelling. Reported on the row, once per cause. */
function reportTextIssues(ctx: Ctx, block: StoryBlock): void {
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
                report(ctx, block.id, "inlineEvent");
            }
            if ("interpolation" in run && run.interpolation.kind === "blueprint" && !sawBlueprint) {
                sawBlueprint = true;
                report(ctx, block.id, "blueprintInterpolation");
            }
        }
    }
}

function walk(ctx: Ctx, blockIds: readonly StoryBlockId[], depth: number): void {
    for (const blockId of blockIds) {
        const block = ctx.scene.blocks[blockId];
        if (!block) {
            continue;
        }
        reportTextIssues(ctx, block);

        let line: string | null;
        switch (block.kind) {
            case "nodeAction":
                line = printNodeAction(ctx, block, block.payload);
                break;
            case "action":
                line = printAction(ctx, block, block.payload);
                break;
            case "control":
                line = printControl(ctx, block, block.payload);
                break;
            case "jump":
                line = printJump(ctx, block, block.payload);
                break;
            case "note":
                line = `${NARRALANG_NOTE_PREFIX} ${printNarralangText(block.payload.text, ctx.lookups, "note")}`;
                break;
            case "declaration":
                line = printDeclaration(block.payload);
                break;
            case "invalid":
                report(ctx, block.id, "invalidRow");
                line = `${NARRALANG_DISABLED_PREFIX}${NARRALANG_DISABLED_PREFIX} ${block.payload.source}`;
                break;
            default:
                report(ctx, blockId, "unknownPayload");
                line = "";
        }

        // A container that prints nothing keeps its children at the current level - that is what
        // makes `if` / `elif` / `else` siblings in the text while they are children in the document.
        if (line === null) {
            walk(ctx, block.childrenIds, depth);
            continue;
        }
        if (line !== "") {
            emit(ctx, depth, block.disabled ? `${NARRALANG_DISABLED_PREFIX} ${line}` : line);
        }
        if (block.childrenIds.length > 0) {
            walk(ctx, block.childrenIds, depth + 1);
        }
    }
}

/** One scene as a script, plus every row in it that has no spelling. */
export function printNarralangScene(scene: StoryScene, lookups: NarralangLookups): NarralangSceneResult {
    const ctx: Ctx = { scene, lookups: { ...lookups, scene }, issues: [], lines: [] };
    ctx.lines.push(`scene ${narralangName(scene.name)}:`);
    ctx.lines.push("");
    walk(ctx, scene.rootBlockIds, 1);
    return { text: `${ctx.lines.join("\n").replace(/\n+$/, "")}\n`, issues: ctx.issues };
}

/**
 * Whether the text view may open this scene for editing.
 *
 * Deliberately runs the printer rather than re-deciding: see the file header. The scene-level verdict
 * (not a per-row one) is the author's ruling - a partially editable buffer breaks the feel of a text
 * editor and is a way to lose work.
 */
export function narralangSceneExpressible(scene: StoryScene, lookups: NarralangLookups): boolean {
    return printNarralangScene(scene, lookups).issues.length === 0;
}

/** Every scene in the document, in authoring order, separated by a blank line. */
export function printNarralangStory(document: StoryDocument, lookups: NarralangLookups): NarralangSceneResult {
    const sceneIds = listSceneIdsInDocumentOrder(document);
    const texts: string[] = [];
    const issues: NarralangIssue[] = [];
    for (const sceneId of sceneIds) {
        const result = printNarralangScene(document.scenes[sceneId], { ...lookups, scenes: document.scenes, document });
        texts.push(result.text);
        issues.push(...result.issues);
    }
    return { text: texts.join("\n"), issues };
}

/** Seconds, for callers that need the same rounding the printer uses (tests, the export report). */
export const narralangSecondsOf = storyMsToSeconds;
