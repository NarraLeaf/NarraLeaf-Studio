import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand, type ActionCommandId } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue, StoryCommandTargetValue, StoryCommandValue } from "../../storyCommandValues";
import {
    asEnum,
    asTarget,
    defineStoryCommand,
    placementParam,
    secondsParam,
    targetParam,
    type ResolvedArgsOf,
    type StoryCommandBuildContext,
    type StoryCommandParamsShape,
    type StoryCommandValidateContext,
} from "../spec";
import { withPlacementTransform, withRevealTransform, withTransitionRef } from "../payloadHelpers";
import { mergedTransitionOptions, supportedTransitionWords, transformPresetFor, transitionKindFor } from "../transitions";

/**
 * The generic verbs and the character commands: `/show`, `/hide`, `/move`, `/face`, `/say`.
 *
 * `/show` and `/hide` are the bible's B3 in action: one verb, any subject. The target resolves to a
 * character or a stage object and the build dispatches on what it found - the author never memorizes
 * an "object type × verb" matrix of tokens.
 */

const SHOW_HIDE_ACCEPTS = ["character", "image", "text", "video", "layer"] as const;

/**
 * Reject a transition word the resolved target's context cannot express - `/show Alice t=zoom` parses
 * (the union offers zoom for stage objects) but a character entrance has no zoom.
 */
function validateTransitionForTarget(
    direction: "show" | "hide",
    args: { readonly target?: StoryCommandValue; readonly t?: StoryCommandValue },
    ctx: StoryCommandValidateContext,
): StoryCommandResolutionIssue[] {
    const word = asEnum(args.t);
    const target = asTarget(args.target);
    if (word === undefined || target === undefined) {
        return [];
    }
    const span = ctx.spanOf("t");
    if (!span) {
        return [];
    }
    if (target.type === "character") {
        if (transitionKindFor("character", word) === undefined) {
            return [{ code: "unsupportedOption", span, value: word, allowed: supportedTransitionWords("character") }];
        }
        return [];
    }
    const context = direction === "show" ? "reveal" : "conceal";
    if (target.objectKind !== "video" && transformPresetFor(context, word) === undefined) {
        return [{ code: "unsupportedOption", span, value: word, allowed: supportedTransitionWords(context) }];
    }
    return [];
}

/** A form filled against a non-character target names nothing - say so on the form's own span. */
function validateFormTarget(
    args: { readonly target?: StoryCommandValue; readonly form?: StoryCommandValue },
    ctx: StoryCommandValidateContext,
): StoryCommandResolutionIssue[] {
    const target = asTarget(args.target);
    const span = ctx.spanOf("form");
    if (!span || args.form === undefined || target === undefined || target.type === "character") {
        return [];
    }
    return [{ code: "unknownForm", span, value: args.form.kind === "characterForm" ? args.form.formName : "", characterName: target.name }];
}

/** The show/hide block for a stage-object target. Layers ride the displayable payload - they have no show/hide command family of their own. */
function stageObjectBlockId(target: Extract<StoryCommandTargetValue, { type: "stageObject" }>, direction: "show" | "hide"): ActionCommandId {
    switch (target.objectKind) {
        case "image":
            return direction === "show" ? "imageShow" : "imageHide";
        case "text":
            return direction === "show" ? "textShow" : "textHide";
        case "video":
            return direction === "show" ? "videoShow" : "videoHide";
        case "layer":
        case "audio":
            return direction === "show" ? "displayableShow" : "displayableHide";
    }
}

function buildShowHide<P extends StoryCommandParamsShape>(
    direction: "show" | "hide",
    args: ResolvedArgsOf<P> & {
        readonly target?: StoryCommandValue;
        readonly form?: StoryCommandValue;
        readonly at?: StoryCommandValue;
        readonly t?: StoryCommandValue;
        readonly d?: StoryCommandValue;
    },
    ctx: StoryCommandBuildContext,
): StoryBlock {
    const target = asTarget(args.target);

    // A character, or nothing yet: the default block is the character one - the most common subject.
    if (!target || target.type === "character") {
        const block = createBlockForCommand(direction === "show" ? "characterEnter" : "characterExit", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "character") {
            return block;
        }
        const payload = { ...block.payload };
        if (target) {
            payload.characterId = target.characterId;
        }
        if (args.form?.kind === "characterForm") {
            payload.formName = args.form.formName;
        }
        const transform = direction === "show"
            ? withPlacementTransform(payload.transform, args.at, args.d)
            : withPlacementTransform(payload.transform, undefined, args.d);
        const transition = withTransitionRef(payload.transition, "character", args.t, undefined);
        return { ...block, payload: { ...payload, ...(transform ? { transform } : {}), ...(transition ? { transition } : {}) } };
    }

    const block = createBlockForCommand(stageObjectBlockId(target, direction), ctx.generateId);
    if (block.kind !== "action") {
        return block;
    }
    if (block.payload.action === "image" || block.payload.action === "text") {
        const transform = withRevealTransform(block.payload.transform, direction === "show" ? "reveal" : "conceal", args.t, args.d);
        return { ...block, payload: { ...block.payload, objectName: target.name, ...(transform ? { transform } : {}) } };
    }
    if (block.payload.action === "video") {
        return { ...block, payload: { ...block.payload, objectName: target.name } };
    }
    if (block.payload.action === "displayable") {
        const transform = withRevealTransform(block.payload.transform, direction === "show" ? "reveal" : "conceal", args.t, args.d);
        return {
            ...block,
            payload: { ...block.payload, target: { kind: "layer", name: target.name }, ...(transform ? { transform } : {}) },
        };
    }
    return block;
}

export const show = defineStoryCommand({
    id: "show",
    token: "show",
    aliases: ["enter"],
    category: "character",
    // Inline quick-edit (WI-2): the enter transition duration (the transition kind stays inspector-only).
    quickParams: ["d"],
    params: {
        target: targetParam(SHOW_HIDE_ACCEPTS, { core: true }),
        form: { hint: "form", type: { kind: "characterForm", dependsOn: "target" }, positional: true },
        at: placementParam(),
        t: { aliases: ["transition"], hint: "transition", type: { kind: "enum", options: mergedTransitionOptions("character", "reveal") } },
        d: secondsParam(),
    },
    build: (args, ctx) => buildShowHide("show", args, ctx),
    validate: (args, ctx) => [
        ...validateTransitionForTarget("show", args, ctx),
        ...validateFormTarget(args, ctx),
    ],
});

export const hide = defineStoryCommand({
    id: "hide",
    token: "hide",
    aliases: ["exit"],
    category: "character",
    // Inline quick-edit (WI-2): the exit transition duration (the transition kind stays inspector-only).
    quickParams: ["d"],
    params: {
        target: targetParam(SHOW_HIDE_ACCEPTS, { core: true }),
        t: { aliases: ["transition"], hint: "transition", type: { kind: "enum", options: mergedTransitionOptions("character", "conceal") } },
        d: secondsParam(),
    },
    build: (args, ctx) => buildShowHide("hide", args, ctx),
    validate: (args, ctx) => validateTransitionForTarget("hide", args, ctx),
});

export const move = defineStoryCommand({
    id: "move",
    token: "move",
    category: "character",
    params: {
        character: { hint: "character", type: { kind: "character" }, positional: true, core: true },
        at: { ...placementParam(), core: true },
        d: secondsParam(),
    },
    build(args, ctx) {
        const block = createBlockForCommand("characterMove", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "character") {
            return block;
        }
        const payload = { ...block.payload };
        if (args.character?.kind === "character") {
            payload.characterId = args.character.characterId;
        }
        const transform = withPlacementTransform(payload.transform, args.at, args.d);
        return { ...block, payload: { ...payload, ...(transform ? { transform } : {}) } };
    },
});

export const face = defineStoryCommand({
    id: "face",
    token: "face",
    aliases: ["expr", "expression"],
    category: "character",
    params: {
        character: { hint: "character", type: { kind: "character" }, positional: true, core: true },
        form: { hint: "form", type: { kind: "characterForm", dependsOn: "character" }, positional: true, core: true },
    },
    build(args, ctx) {
        const block = createBlockForCommand("characterExpression", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "character") {
            return block;
        }
        const payload = { ...block.payload };
        if (args.character?.kind === "character") {
            payload.characterId = args.character.characterId;
        }
        if (args.form?.kind === "characterForm") {
            payload.formName = args.form.formName;
        }
        return { ...block, payload };
    },
});

export const say = defineStoryCommand({
    id: "say",
    token: "say",
    category: "character",
    params: {
        character: { hint: "speaker", type: { kind: "character", allowTemp: true }, positional: true, core: true },
        // Optional on purpose: `/say Alice` commits and drops the caret into the row's text - the
        // same "speaker first, words after" flow the `#` line has.
        text: { hint: "lineText", type: { kind: "text" }, positional: true, greedy: true },
    },
    build(args, ctx) {
        const block = createBlockForCommand("dialogue", ctx.generateId);
        if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
            return block;
        }
        const payload = { ...block.payload };
        // characterId XOR speakerName - the row points at a record or carries a bare name, never both.
        if (args.character?.kind === "character") {
            payload.characterId = args.character.characterId;
            payload.speakerName = undefined;
        } else if (args.character?.kind === "speakerName") {
            payload.speakerName = args.character.speakerName;
            payload.characterId = undefined;
        }
        if (args.text?.kind === "text") {
            // Typed on one line, so it is plain: `rich` is dropped rather than left describing the
            // text this line replaced.
            payload.text = { ...payload.text, value: args.text.value, rich: undefined };
        }
        return { ...block, payload };
    },
});

export const CHARACTER_COMMANDS = [show, hide, move, face, say];
