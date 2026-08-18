import { Eye, EyeOff, MessageSquare, PersonStanding, Shirt, SlidersHorizontal, Smile, Tag } from "lucide-react";
import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand, type ActionCommandId } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue, StoryCommandTargetValue, StoryCommandValue } from "../../storyCommandValues";
import {
    asDurationMs,
    asEnum,
    asNumber,
    asPuppetName,
    asTarget,
    asText,
    defineStoryCommand,
    placementParam,
    puppetNameParam,
    secondsParam,
    targetParam,
    type ResolvedArgsOf,
    type StoryCommandBuildContext,
    type StoryCommandParamsShape,
    type StoryCommandValidateContext,
} from "../spec";
import { vfxOperationBlock, withPlacementTransform, withRevealTransform } from "../payloadHelpers";
import { supportedTransitionWords, transformEffectFor, transitionOptions } from "../transitions";

/**
 * The generic verbs and the character commands: `/show`, `/hide`, `/face`, `/motion`, `/skin`,
 * `/param`, `/say`.
 *
 * `/move` is gone (M2). It was "object type × operation" wearing a friendly word: a move is a
 * POSITION, which is one prop of the one bag every displayable interpolates, and a token that reached
 * only characters and only that one prop is exactly what `/transform Alice pos=left` says with
 * nothing special about it. Its token is burned in `registry.ts` for the usual reason.
 *
 * `/show` and `/hide` are the generic-verb rule in action: one verb, any subject. The target resolves to a
 * character or a stage object and the build dispatches on what it found - the author never memorizes
 * an "object type × verb" matrix of tokens.
 *
 * ## Puppet characters (the three state channels)
 *
 * A character an author's own runtime draws has no authoring-time differentials: what it looks like
 * and what it is doing are named by the model, not enumerated in the project. The engine models that
 * as three channels every 2D character renderer has - motion, expression, skin - plus two free maps
 * and a command escape hatch.
 *
 * The channels are not a new object type, so they get no token of their own:
 *
 *  - **expression already had a verb.** `/face <character> <name>` is the "which of this character's
 *    looks is showing" verb, and its slot already means a different stored thing per appearance kind
 *    (a pose id for `preset`, a tag id for `layered`). A puppet's expression is the third answer to
 *    the same question, so it is the same slot and the same verb - a union branch, not a command.
 *  - **motion and skin had none.** Nothing in the vocabulary names "which loop is this character in"
 *    or "which costume is it wearing", so each takes one token. `/play` was the near miss and is
 *    wrong: it is transport (a clip that runs and ends), while a motion is persistent state that is
 *    saved and re-applied on load - the engine puts the one-shot in `Puppet.command` precisely to
 *    keep the two apart. Both verbs are named after the idea, not the type: the taxonomy forbids
 *    "object type × verb", and `/motion` reads on any character that ever grows motions.
 *
 *  - **the free numeric parameters got one too**, later, and only once they could be listed. See
 *    `/param` below: the round that added the three channels refused it *pending* `describe()`'s
 *    min/max/default, and that condition has since been met.
 *
 * What is still deliberately NOT here: `setSlot` and `command`. `PuppetDescription` - the only thing
 * that can ever enumerate a model's vocabulary - lists motions, expressions, skins and params, and
 * lists neither slots nor commands. A line for those would be free text pretending to be a command:
 * a slot is an unbounded string nobody can check, and a command name plus its payload shape belong to
 * the backend, which is why the engine documents them as forwarded verbatim. Both unblock the same
 * way params did - `describe()` (or a manifest beside the author's runtime) growing a list - and
 * `specs.test.ts` pins the refusal so it is reversed on purpose rather than by drift.
 */

const SHOW_HIDE_ACCEPTS = ["character", "image", "text", "video", "layer", "vfx"] as const;

/**
 * Reject a reveal/conceal word the resolved target's context cannot express - `/show Alice in=zoom`
 * parses (the union offers zoom for stage objects) but a character entrance has no zoom.
 */
function validateTransitionForTarget(
    direction: "show" | "hide",
    args: { readonly target?: StoryCommandValue; readonly in?: StoryCommandValue; readonly out?: StoryCommandValue },
    ctx: StoryCommandValidateContext,
): StoryCommandResolutionIssue[] {
    const key = direction === "show" ? "in" : "out";
    const word = asEnum(direction === "show" ? args.in : args.out);
    const target = asTarget(args.target);
    if (word === undefined || target === undefined) {
        return [];
    }
    const span = ctx.spanOf(key);
    if (!span) {
        return [];
    }
    const context = direction === "show" ? "reveal" : "conceal";
    // A character now animates through the same reveal/conceal presets a stage object does (see
    // `buildShowHide`), so it is judged against the same table rather than against the portrait-swap
    // transitions it no longer writes.
    if (target.type === "character" || target.type === "reserved") {
        if (transformEffectFor(context, word) === undefined) {
            return [{ code: "unsupportedOption", span, value: word, allowed: supportedTransitionWords(context) }];
        }
        return [];
    }
    // Video and vfx are not Displayables, so the reveal/conceal preset table does not describe them
    // at all - there is no legal word to name, and reporting against a table they do not use would be
    // reporting the wrong thing.
    if (target.objectKind !== "video" && target.objectKind !== "vfx" && transformEffectFor(context, word) === undefined) {
        return [{ code: "unsupportedOption", span, value: word, allowed: supportedTransitionWords(context) }];
    }
    return [];
}

/**
 * Store a resolved appearance ref on a character payload.
 *
 * `axisId` is what distinguishes the two kinds: a layered character's ref is a tag on some axis and
 * lands in `tags` (merged, never replacing — an expression row names only the axes it changes), a
 * preset character's is a pose id and lands in `pose`.
 */
function applyAppearanceRef(payload: Record<string, unknown>, refId: string, axisId: string | undefined): void {
    if (axisId) {
        payload.tags = { ...(payload.tags as Record<string, string> | undefined), [axisId]: refId };
    } else {
        payload.pose = refId;
    }
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
    return [{ code: "unknownForm", span, value: args.form.kind === "characterForm" ? args.form.label : "", characterName: target.name }];
}

/**
 * The show/hide block for a stage-object target. Layers ride the displayable payload - they have no
 * show/hide command family of their own. `vfx` never reaches here: it has its own payload and is
 * dispatched before this, which is why its kind is excluded rather than given a dead arm.
 */
function stageObjectBlockId(
    objectKind: Exclude<Extract<StoryCommandTargetValue, { type: "stageObject" }>["objectKind"], "vfx">,
    direction: "show" | "hide",
): ActionCommandId {
    switch (objectKind) {
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
        readonly pos?: StoryCommandValue;
        readonly in?: StoryCommandValue;
        readonly out?: StoryCommandValue;
        readonly d?: StoryCommandValue;
    },
    ctx: StoryCommandBuildContext,
): StoryBlock {
    const target = asTarget(args.target);
    // One slot per direction, so a build reads whichever its verb owns; the other is never declared.
    const word = direction === "show" ? args.in : args.out;

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
        if (args.form?.kind === "characterForm" && args.form.refId) {
            applyAppearanceRef(payload, args.form.refId, args.form.axisId);
        }
        // `t=` lands on the TRANSFORM, not on the transition ref.
        //
        // The engine ignores a character's transition on the way in and out: `enter` compiles to
        // `char(src).show(showTransform)` and `exit` to `hide(transform)` — a transition only applies
        // where the image source is swapped, which is `expression`. Writing `transition` here filled a
        // field nothing reads, and the row and the inspector then showed two different answers to
        // "how does this character leave" (the inspector edits the transform, which is the live one).
        //
        // Placement wins when both are given, the rule `/image` already follows: a transform holds one
        // preset, and `at=` is the more specific instruction.
        const placed = direction === "show"
            ? withPlacementTransform(payload.transform, args.pos, args.d)
            : withPlacementTransform(payload.transform, undefined, args.d);
        const transform = direction === "show" && args.pos
            ? placed
            : withRevealTransform(placed, direction === "show" ? "reveal" : "conceal", word, args.d);
        return { ...block, payload: { ...payload, ...(transform ? { transform } : {}) } };
    }

    // A reserved word names a stage singleton with no payload of its own here: the two built-in
    // layers and the scene background are Displayables, so they ride the displayable arm, and the
    // camera is not a `/show` subject at all (it has nothing to reveal). Both are unreachable from
    // this verb's `accepts`, so this arm keeps the function total rather than serving a line.
    if (target.type === "reserved") {
        return createBlockForCommand(direction === "show" ? "displayableShow" : "displayableHide", ctx.generateId);
    }

    // An ambience overlay fades rather than shows: its own payload, and `d=` is the fade the action
    // waits out (NLR `Vfx.show({duration})`), not a transform preset it has no pipeline for.
    if (target.objectKind === "vfx") {
        const durationMs = asDurationMs(args.d);
        return vfxOperationBlock(direction, target.name, ctx.generateId, durationMs === undefined ? undefined : { durationMs });
    }

    const block = createBlockForCommand(stageObjectBlockId(target.objectKind, direction), ctx.generateId);
    if (block.kind !== "action") {
        return block;
    }
    if (block.payload.action === "image" || block.payload.action === "text") {
        const transform = withRevealTransform(block.payload.transform, direction === "show" ? "reveal" : "conceal", word, args.d);
        return { ...block, payload: { ...block.payload, objectName: target.name, ...(transform ? { transform } : {}) } };
    }
    if (block.payload.action === "video") {
        return { ...block, payload: { ...block.payload, objectName: target.name } };
    }
    if (block.payload.action === "displayable") {
        const transform = withRevealTransform(block.payload.transform, direction === "show" ? "reveal" : "conceal", word, args.d);
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
    icon: Eye,
    examples: ["/show Alice", "/show Alice smile pos=left", "/show hero in=fade d=0.3"],
    // Inline quick-edit: how long the entrance takes - the duration this line writes onto the
    // show transform, which is what drives a character's entrance (the placement `at=` stays a word).
    quickParams: ["d"],
    params: {
        target: targetParam(SHOW_HIDE_ACCEPTS, { core: true }),
        form: { hint: "form", type: { kind: "characterForm", dependsOn: "target" }, positional: true },
        pos: placementParam(),
        // `in=`, not `t=`. What this slot writes is a TRANSFORM preset - a bag of props the entrance
        // interpolates - and it always was: the engine ignores a character's `StoryTransitionRef` on
        // the way in, and a stage object has none at all. Calling it "transition" made it look like
        // the `t=` on `/bg` and `/face`, which really do name an engine transition, so the one word
        // covered two different things and the row could not say which. The direction is in the name
        // because the direction is what the verb already decided.
        in: { aliases: ["reveal"], hint: "reveal", type: { kind: "enum", options: transitionOptions("reveal") } },
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
    icon: EyeOff,
    examples: ["/hide Alice", "/hide hero out=fade d=0.3"],
    // Inline quick-edit: how long the exit takes - the same transform duration `hide()` reads.
    quickParams: ["d"],
    params: {
        target: targetParam(SHOW_HIDE_ACCEPTS, { core: true }),
        // The conceal half of `/show in=` - see there for why this is not `t=`.
        out: { aliases: ["conceal"], hint: "conceal", type: { kind: "enum", options: transitionOptions("conceal") } },
        d: secondsParam(),
    },
    build: (args, ctx) => buildShowHide("hide", args, ctx),
    validate: (args, ctx) => validateTransitionForTarget("hide", args, ctx),
});

export const face = defineStoryCommand({
    id: "face",
    token: "face",
    aliases: ["expr", "expression"],
    category: "character",
    icon: Smile,
    examples: ["/face Alice smile"],
    params: {
        character: { hint: "character", type: { kind: "character" }, positional: true, core: true },
        // One slot, three appearance kinds. The branches are tried in order and the FIRST that
        // accepts wins, so a character Studio draws resolves exactly as it always did; only a
        // character whose forms live in a model file reaches the second branch (the first declines
        // it, having nothing to offer), and its name is stored verbatim because there is no id.
        form: {
            hint: "form",
            type: [
                { kind: "characterForm", dependsOn: "character" },
                { kind: "puppetName", channel: "expression", dependsOn: "character" },
            ],
            positional: true,
            core: true,
        },
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
        if (args.form?.kind === "characterForm" && args.form.refId) {
            applyAppearanceRef(payload, args.form.refId, args.form.axisId);
        }
        const puppetName = asPuppetName(args.form);
        if (puppetName !== undefined) {
            payload.puppetName = puppetName;
        }
        return { ...block, payload };
    },
});

/**
 * Build a puppet state row for `/motion` and `/skin`.
 *
 * Written here rather than through `createBlockForCommand`: the block carries no transform, no
 * transition and no stage name, so there is nothing for the shared constructor to seed - the same
 * reason `/rename` and `/camera` build their own.
 */
function puppetStateBlock(
    operation: "setMotion" | "setSkin",
    args: { readonly character?: StoryCommandValue; readonly name?: StoryCommandValue },
    ctx: StoryCommandBuildContext,
): StoryBlock {
    const name = asPuppetName(args.name);
    return {
        id: ctx.generateId(),
        parentId: null,
        childrenIds: [],
        kind: "action",
        payload: {
            action: "character",
            operation,
            ...(args.character?.kind === "character" ? { characterId: args.character.characterId } : {}),
            // Omitted on purpose when the author named nothing: that IS the engine's `null`, and the
            // model visibly drops back to rest.
            ...(name !== undefined ? { puppetName: name } : {}),
        },
    };
}

/** A character these verbs cannot address - Studio draws it, so it has no runtime state to ask for. */
function validatePuppetCharacter(
    args: { readonly character?: StoryCommandValue },
    ctx: StoryCommandValidateContext,
): StoryCommandResolutionIssue[] {
    const character = args.character;
    if (character?.kind !== "character" || ctx.context.puppetCharacterIds.includes(character.characterId)) {
        return [];
    }
    const span = ctx.spanOf("character");
    if (!span) {
        return [];
    }
    const name = ctx.context.characters.find(entry => entry.id === character.characterId)?.name ?? "";
    return [{ code: "notPuppetCharacter", span, value: name }];
}

export const motion = defineStoryCommand({
    id: "motion",
    token: "motion",
    aliases: ["anim"],
    category: "character",
    icon: PersonStanding,
    examples: ["/motion Doll run", "/motion Doll"],
    params: {
        character: { hint: "character", type: { kind: "character" }, positional: true, core: true },
        name: puppetNameParam("motion", "character", "motion"),
    },
    build: (args, ctx) => puppetStateBlock("setMotion", args, ctx),
    validate: validatePuppetCharacter,
});

export const skin = defineStoryCommand({
    id: "skin",
    token: "skin",
    aliases: ["costume"],
    category: "character",
    icon: Shirt,
    examples: ["/skin Doll winter", "/skin Doll"],
    params: {
        character: { hint: "character", type: { kind: "character" }, positional: true, core: true },
        name: puppetNameParam("skin", "character", "skin"),
    },
    build: (args, ctx) => puppetStateBlock("setSkin", args, ctx),
    validate: validatePuppetCharacter,
});

/**
 * `/param` - one numeric knob of a puppet's model.
 *
 * This one was refused in the round that added the three channels above, on a stated condition: a
 * parameter is "an id plus a continuous number tuned by eye against the stage", and it wanted
 * `describe()`'s min / max / default "before it is worth a persisted shape". That condition has since
 * been met - `PuppetDescriptionService` mounts the author's runtime and asks - so the id is a list to
 * pick from and the number has a range. What remains refused is `setSlot` and `command`: a slot has
 * no bounds and a command name is the backend's private vocabulary, and `PuppetDescription` reports
 * neither, so a row for those would still be free text pretending to be a command.
 *
 * All three of `character`, `id` and `value` are core. Unlike a motion, a parameter has no meaningful
 * "clear": the engine reads an absent key as "keep the model's default", so a row naming an id with no
 * value would ask for nothing at all. The multi-parameter gesture is the inspector's - the row's
 * payload is a map, and the line fills its first entry.
 */
export const param = defineStoryCommand({
    id: "param",
    token: "param",
    category: "character",
    icon: SlidersHorizontal,
    examples: ["/param Doll ParamAngleX 12"],
    params: {
        character: { hint: "character", type: { kind: "character" }, positional: true, core: true },
        id: { hint: "puppetParam", type: { kind: "puppetParam", dependsOn: "character" }, positional: true, core: true },
        value: { hint: "puppetParamValue", type: { kind: "number" }, positional: true, core: true },
    },
    build(args, ctx): StoryBlock {
        const id = args.id?.kind === "puppetParam" ? args.id.id : undefined;
        const value = asNumber(args.value);
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "action",
            payload: {
                action: "character",
                operation: "setParams",
                ...(args.character?.kind === "character" ? { characterId: args.character.characterId } : {}),
                ...(id !== undefined && value !== undefined ? { params: { [id]: value } } : {}),
            },
        };
    },
    validate: validatePuppetCharacter,
});

/**
 * `/rename` - the speaker label, not the portrait.
 *
 * It exists for one narrative move: the "？？？" speaker who becomes a name. That is why the new name
 * is a greedy positional rather than a `name=` modifier - it is the point of the line, and a label may
 * well contain spaces ("the man in grey").
 */
export const rename = defineStoryCommand({
    id: "rename",
    token: "rename",
    aliases: ["setname"],
    category: "character",
    icon: Tag,
    examples: ["/rename Alice The Stranger"],
    params: {
        character: { hint: "character", type: { kind: "character" }, positional: true, core: true },
        name: { hint: "displayName", type: { kind: "text" }, positional: true, greedy: true, core: true },
    },
    // Built here rather than through `createBlockForCommand`: the block carries no transform, no
    // transition and no stage name, so there is nothing for the shared constructor to seed. This
    // follows `/camera` (A2), which did the same for the same reason - `ActionCommandId` is the
    // retired catalogue's residue and does not need to grow for every new command.
    build(args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "action",
            payload: {
                action: "character",
                operation: "setName",
                ...(args.character?.kind === "character" ? { characterId: args.character.characterId } : {}),
                displayName: asText(args.name) ?? "",
            },
        };
    },
});

export const say = defineStoryCommand({
    id: "say",
    token: "say",
    category: "character",
    icon: MessageSquare,
    examples: ["/say Alice Hello there.", "/say Zoe Who are you?"],
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

export const CHARACTER_COMMANDS = [show, hide, face, motion, skin, param, rename, say];
