import { ALargeSmall, BringToFront, Image, Layers, Play, Replace, Type } from "lucide-react";
import type { StoryBlock, StoryTextOutline } from "@shared/types/story";
import { STORY_TEXT_OUTLINE_DEFAULT_COLOR, STORY_TEXT_OUTLINE_MAX_WIDTH } from "@shared/story/textOutline";
import { addSceneLayer, sceneLayerNameProblem, sceneLayerStack } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue, StoryCommandValue } from "../../storyCommandValues";
import {
    asBoolean,
    asColor,
    asEnum,
    asNumber,
    asTarget,
    asText,
    defineStoryCommand,
    holdParam,
    secondsParam,
    targetParam,
    type StoryCommandValidateContext,
} from "../spec";
import {
    clipLeaveDurationMs,
    deriveObjectName,
    deriveShownObjectName,
    displayableTargetRef,
    withPlacementTransform,
    withRevealTransform,
    withTransitionRef,
} from "../payloadHelpers";
import { clipConcealOptions, transitionOptions } from "../transitions";
import { PLACEMENT_PARAMS, positionFromArgs, positionIssues } from "../transformVocabulary";
import { validateNameTarget } from "./character";

/** Media objects: `/image`, `/text`, `/layer`, `/swap`, `/play`, `/front`, `/font`. */

export const image = defineStoryCommand({
    id: "image",
    token: "image",
    aliases: ["img"],
    category: "image",
    icon: Image,
    examples: ["/image night name=sky", "/image night name=sky pos=center", "/image forest_day name=backdrop in=fade d=0.4"],
    sequence: {
        note: "Declares an image object and does not display it. A later `/show <name>` reveals it; "
            + "`/show <image asset> name=<name>` declares and reveals in one row.",
        lines: ["/image night name=sky pos=center", "/show sky in=fade d=0.5"],
    },
    params: {
        image: { aliases: ["src"], hint: "imageAsset", type: { kind: "asset", assetType: "image", allowSets: true }, positional: true, core: true },
        name: { hint: "objectName", type: { kind: "text" } },
        ...PLACEMENT_PARAMS,
        // `in=`, the same rename `/show` carries: what this writes is the create's entrance TRANSFORM,
        // not a `StoryTransitionRef`. An image has no transition field at all.
        in: { aliases: ["reveal"], hint: "reveal", type: { kind: "enum", options: transitionOptions("reveal") } },
        d: secondsParam(),
    },
    deriveArgs: deriveObjectName("image", "image", "image"),
    build(args, ctx) {
        const block = createBlockForCommand("imageCreate", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "image") {
            return block;
        }
        const payload = { ...block.payload };
        const name = asText(args.name);
        if (name !== undefined) {
            payload.objectName = name;
        }
        if (args.image?.kind === "asset") {
            payload.assetId = args.image.assetId;
        }
        // Placement wins when both are given - a create is placed; its entrance rides `t=` only when
        // no placement pins the preset (the transform holds one preset).
        const transform = args.pos
            ? withPlacementTransform(payload.transform, positionFromArgs(args), args.d)
            : withRevealTransform(payload.transform, "reveal", args.in, args.d);
        return { ...block, payload: { ...payload, ...(transform ? { transform } : {}) } };
    },
    validate: (args, ctx) => positionIssues(args, ctx),
});

export const text = defineStoryCommand({
    id: "text",
    token: "text",
    aliases: ["txt"],
    category: "text",
    icon: Type,
    examples: ["/text name=title Welcome home", "/text name=title pos=center Chapter One"],
    sequence: {
        note: "Declares a text object and does not display it: nothing is on screen until a `/show <name>` row. "
            + "Write `name=` (before the text) so the `/show` can address it.",
        lines: ["/text name=title pos=center Chapter One", "/show title in=fade d=0.5"],
    },
    params: {
        // `name=` must be typed before the greedy content - the one ordering rule greedy imposes.
        name: { hint: "objectName", type: { kind: "text" } },
        ...PLACEMENT_PARAMS,
        content: { hint: "content", type: { kind: "text" }, positional: true, greedy: true, core: true },
    },
    deriveArgs: deriveObjectName("text", null, "text"),
    build(args, ctx) {
        const block = createBlockForCommand("textCreate", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "text") {
            return block;
        }
        const payload = { ...block.payload };
        const name = asText(args.name);
        if (name !== undefined) {
            payload.objectName = name;
        }
        if (args.content?.kind === "text") {
            payload.text = args.content.value;
        }
        const transform = withPlacementTransform(payload.transform, positionFromArgs(args), undefined);
        return { ...block, payload: { ...payload, ...(transform ? { transform } : {}) } };
    },
    validate: (args, ctx) => positionIssues(args, ctx),
});

/**
 * `/layer` - add a layer to the scene.
 *
 * It writes no row. A layer belongs to its scene, which puts up every layer it has as it starts, so
 * the command adds one to the scene's stack: just behind the characters and moving exactly with the
 * camera, which is how every layer has always moved until the author places it in the live preview's
 * layer view. A name the scene's layers already use, or one a built-in layer is written with, is
 * refused on the line.
 */
export const layer = defineStoryCommand({
    id: "layer",
    token: "layer",
    category: "layer",
    icon: Layers,
    examples: ["/layer hills"],
    header: {
        note: "Not a row in a file. A scene's layers are header lines, one #layer per layer, nearest first; "
            + "displayableLayer is the base layer, which holds everything not placed on another layer, at distance 1; distance= is how far away a layer is "
            + "(below 1 is nearer; 2 is twice as far and moves half as much with the camera; inf does not move).",
        lines: ["#layer displayableLayer", "#layer hills distance=3", "#layer sky distance=inf"],
    },
    params: {
        name: { hint: "objectName", type: { kind: "text" }, positional: true, core: true },
    },
    editScene(args, ctx) {
        const stack = sceneLayerStack(ctx.scene);
        const name = asText(args.name)?.trim() ?? "";
        if (sceneLayerNameProblem(stack, name) !== null) {
            return null;
        }
        return { layers: addSceneLayer(stack, { id: ctx.generateId(), name }) };
    },
    validate(args, ctx) {
        const name = asText(args.name)?.trim();
        const span = name ? ctx.spanOf("name") : undefined;
        if (!name || !span) {
            return [];
        }
        // The stage objects the line sees are the scene's layers as the context read them.
        const stack = ctx.context.stageObjects.layer.map((existing, index) => ({ kind: "custom" as const, id: `existing-${index}`, name: existing }));
        const problem = sceneLayerNameProblem(stack, name);
        if (problem === "taken") {
            return [{ code: "duplicateLayer", span, value: name }];
        }
        if (problem === "reserved") {
            return [{ code: "reservedLayerName", span, value: name }];
        }
        return [];
    },
});

/** What `/swap`'s transition slots say in the catalogue: they are an image swap's alone. */
const SWAP_IMAGE_ONLY = "Image targets only. A text swap changes the words at once; to fade it, write /hide <text> out=fade, then /swap, then /show <text> in=fade.";

export const swap = defineStoryCommand({
    id: "swap",
    token: "swap",
    // `setimg` / `settext` are gone (§3.6): they spelled "object type × verb", which is the exact
    // model B3's generic verbs replace - the target says what is being swapped, the token never does.
    aliases: ["src"],
    category: "image",
    icon: Replace,
    examples: ["/swap hero night", "/swap title A new title", "/swap hero t=fade d=0.4 night"],
    params: {
        target: targetParam(["image", "text"], { core: true }),
        // The same three slots `/char` carries, for the same reason: an image swap compiles to
        // `char(src, transition)`, so this row plays a `StoryTransitionRef` too. Without them the
        // transition an author set in the inspector was a setting no line could say - the row printed
        // as a bare `/swap`, so the line and the row disagreed about what the row does.
        //
        // Before the content and not after it, the rule `/text`'s `name=` already lives under: the
        // content is greedy, so it takes the rest of the line and nothing may follow it. On a text
        // target there is no source to swap and nothing reads them; `validate` says so.
        //
        // The catalogue says so per slot (`about`), because the grammar cannot: it lists every slot the
        // command has, and an agent reading `t=` there had no way to know a text target refuses it.
        t: { aliases: ["transition"], hint: "transition", type: { kind: "enum", options: transitionOptions("expression") }, about: SWAP_IMAGE_ONLY },
        d: { ...secondsParam(), about: SWAP_IMAGE_ONLY },
        hold: { ...holdParam(), about: SWAP_IMAGE_ONLY },
        // Typed by the target: an image's new content is an image asset, a text's is its new words.
        content: { hint: "content", type: { kind: "content", dependsOn: "target", allowSets: true }, positional: true, greedy: true, core: true },
    },
    build(args, ctx) {
        const target = asTarget(args.target);
        if (target?.type === "stageObject" && target.objectKind === "text") {
            const block = createBlockForCommand("textSet", ctx.generateId);
            if (block.kind !== "action" || block.payload.action !== "text") {
                return block;
            }
            // Both, always: `objectName` stays the authoritative key the compiler and the script view
            // read, and `target` is the anchor that survives a rename of the row that created it.
            const payload = { ...block.payload, objectName: target.name, target: displayableTargetRef(target) };
            if (args.content?.kind === "text") {
                payload.text = args.content.value;
            }
            return { ...block, payload };
        }
        const block = createBlockForCommand("imageSetSource", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "image") {
            return block;
        }
        const payload = { ...block.payload };
        if (target) {
            payload.objectName = target.name;
            payload.target = displayableTargetRef(target);
        }
        if (args.content?.kind === "asset") {
            payload.assetId = args.content.assetId;
        }
        const transition = withTransitionRef(payload.transition, "expression", args.t, args.d, undefined, args.hold);
        return { ...block, payload: { ...payload, ...(transition ? { transition } : {}) } };
    },
    validate(args, ctx) {
        const target = asTarget(args.target);
        if (target?.type !== "stageObject" || target.objectKind !== "text") {
            return [];
        }
        // A text swap replaces words, and there is no frame to change over. Reported rather than
        // dropped, so the author is told which half of the line did nothing.
        const issues: StoryCommandResolutionIssue[] = [];
        for (const key of ["t", "d", "hold"] as const) {
            const span = args[key] === undefined ? undefined : ctx.spanOf(key);
            if (span) {
                issues.push({ code: "unsupportedParam", span, key, kind: "text object" });
            }
        }
        return issues;
    },
});

/**
 * `/play` - the one row that puts a story video on the stage.
 *
 * Every play carries its file and defines its clip: it reveals the clip, runs it, and clears it away
 * when it ends. A video in a story is a cutscene the story plays rather than an object it stages, so
 * there is no row that declares or reveals a clip without running it - `/video` and `/vid` are this
 * command's other names, kept so the word an author reaches for still finds it.
 *
 * Two subjects, on the terms `/show` reads a picture. A file out of the library defines a clip under
 * `name=`, or the file's own name. A clip an earlier play defined is what a name means once one has:
 * `/play intro` plays `intro` again, and the row it builds carries that clip's file and name like any
 * other play, so it reads back as the play it is.
 *
 * **Whether the story waits.** `wait=` (default true) holds the story until the clip ends - or until
 * the player clicks or skips, which ends it early; `false` moves on at once while the clip plays, and
 * the clip still leaves when it ends. The later rows that name the clip - `/pause`, `/resume`,
 * `/seek`, `/stop`, `/hide` - are what reach a clip the story did not wait for.
 *
 * **And whether it goes.** A clip that ends holds its last frame above every scene, a jump included,
 * and the next scene has no name for it to hide it by - so every play clears its clip away by
 * default, and `hide=false` holds the last frame until a `/hide` takes it. How the clip leaves is the
 * conceal half `/hide` already writes, `out=` and `d=`, cut down to the two a clip can do: a fade (the
 * default) and none.
 */
export const play = defineStoryCommand({
    id: "play",
    token: "play",
    aliases: ["video", "vid"],
    category: "video",
    icon: Play,
    examples: ["/play intro", "/play intro name=cutscene muted", "/play intro name=cutscene wait=false", "/play intro name=cutscene out=fade d=1", "/play intro name=cutscene hide=false"],
    params: {
        target: targetParam(["video"], { core: true, assets: ["video"], namedBy: "name" }),
        // What the clip this row defines is called on stage, for the rows that address it later -
        // `/pause`, `/stop`, `/hide`. Only meaningful on a file; refused on a clip a play already
        // defined, which has a name of its own.
        name: { hint: "objectName", type: { kind: "text" } },
        wait: { hint: "waitForEnd", type: { kind: "boolean" } },
        hide: { hint: "hideOnEnd", type: { kind: "boolean" } },
        out: { aliases: ["conceal"], hint: "conceal", type: { kind: "enum", options: clipConcealOptions() } },
        d: secondsParam(),
        muted: { hint: "muted", type: { kind: "boolean" } },
    },
    deriveArgs: deriveShownObjectName(),
    build(args, ctx) {
        const block = createBlockForCommand("videoPlay", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "video") {
            return block;
        }
        const target = asTarget(args.target);
        const payload = { ...block.payload };
        if (target?.type === "asset") {
            payload.objectName = asText(args.name) ?? target.name;
            payload.assetId = target.assetId;
        } else if (target?.type === "stageObject") {
            // Playing a clip again: the row names the clip's file and mute flag as the play that
            // defined it does, so it defines the same clip and reads back as `/play <file> name=`.
            const clip = ctx.context.videoClips?.[target.name.trim().toLowerCase()];
            payload.objectName = target.name;
            if (clip) {
                payload.assetId = clip.assetId;
                if (clip.muted !== undefined) {
                    payload.muted = clip.muted;
                }
            }
        }
        const muted = asBoolean(args.muted);
        if (muted !== undefined) {
            payload.muted = muted;
        }
        const waitForEnd = asBoolean(args.wait);
        if (waitForEnd !== undefined) {
            payload.waitForEnd = waitForEnd;
        }
        const hideOnEnd = asBoolean(args.hide);
        if (hideOnEnd !== undefined) {
            payload.hideOnEnd = hideOnEnd;
        }
        // A play fades its clip out by default, so an `out=fade` with no `d=` says nothing that needs
        // storing.
        const durationMs = clipLeaveDurationMs(args.out, args.d, undefined);
        if (durationMs !== undefined) {
            payload.durationMs = durationMs;
        }
        return { ...block, payload };
    },
    validate: (args, ctx) => [
        ...validateNameTarget(args, ctx),
        ...validateClipFile(args, ctx),
        ...validateLeaveWithoutHide(args, ctx),
    ],
});

/**
 * A `/play` naming a clip no earlier play in the scene gave a file, so the row would have nothing to
 * play. Reported on the subject, as a file the line names and the library does not hold.
 */
function validateClipFile(
    args: { readonly target?: StoryCommandValue },
    ctx: StoryCommandValidateContext,
): StoryCommandResolutionIssue[] {
    const target = asTarget(args.target);
    if (target?.type !== "stageObject" || ctx.context.videoClips?.[target.name.trim().toLowerCase()]) {
        return [];
    }
    const span = ctx.spanOf("target");
    return span ? [{ code: "unknownAsset", span, value: target.name, assetType: "video", allowSets: true }] : [];
}

/**
 * `out=` or `d=` beside `hide=false`: how a clip leaves, on a row that keeps it. Refused rather than
 * stored, because nothing would read it.
 */
function validateLeaveWithoutHide(
    args: { readonly hide?: StoryCommandValue; readonly out?: StoryCommandValue; readonly d?: StoryCommandValue },
    ctx: StoryCommandValidateContext,
): StoryCommandResolutionIssue[] {
    if (asBoolean(args.hide) !== false) {
        return [];
    }
    const key = args.out !== undefined ? "out" : args.d !== undefined ? "d" : null;
    const span = key ? ctx.spanOf(key) : undefined;
    return key && span ? [{ code: "conflictingParams", span, keys: ["hide", key] }] : [];
}

/**
 * `/front` - put this in front of everything else in its layer.
 *
 * **The only ordering verb, and that is the whole design.** A displayable has no z of its own (only a
 * `Layer` does), so the stacking order inside a layer is the order the elements were created in - and
 * three sprites on stage together had no way at all to put the speaker in front. An absolute z would
 * have answered that with a number an author cannot see the effect of without a stacking editor to
 * see it in; "bring this to the front" states its whole effect on the line that writes it. It also
 * loses nothing: any arrangement is reachable by bringing each element forward from back to front, so
 * there is no `/back` to write.
 *
 * One frame, one slot, no duration - there is no intermediate state between behind and in front, so
 * there is nothing for a `d=` to spread across.
 */
export const front = defineStoryCommand({
    id: "front",
    token: "front",
    aliases: ["top", "raise"],
    // Only the flat surfaces read this; `accepts` files the command under image, text and character.
    category: "image",
    icon: BringToFront,
    examples: ["/front Alice", "/front hero", "/front title"],
    params: {
        // A layer, a video and an ambience overlay are refused rather than left out, the same way
        // `/transform` refuses the last two: each is on stage under a name the author can see, so a
        // slot that did not resolve them would answer "nothing on stage is named that" about a thing
        // sitting in plain sight. A layer's own front-to-back is its place in the scene's layers.
        target: targetParam(["image", "text", "character"], { core: true, refuses: ["layer", "video", "vfx"] }),
    },
    build(args, ctx): StoryBlock {
        const target = displayableTargetRef(asTarget(args.target));
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "action",
            // The unfilled default matches the other displayable seeds: a row the menu path produces
            // names the placeholder object, and the target field replaces it once the line says who.
            payload: { action: "displayable", operation: "bringToFront", target: target ?? { name: "image" } },
        };
    },
});

/**
 * `/font` - a text object's size, colour and outline, any of them, on one row.
 *
 * A line that names one value builds the single op it always did (`setFontSize` / `setFontColor`), so
 * the rows those wrote keep reading back unchanged. Anything more - two values, or an outline at all -
 * builds `setFont`, which sets whichever fields it carries and leaves the rest of the text alone.
 *
 * The outline is Ren'Py's `outlines [(1, "#332e3e", 0, 0)]`: `outline=1 outlineColor=#332e3e`. A width
 * alone draws in black; a colour alone draws one pixel wide; `outline=0` takes an outline away.
 */
export const font = defineStoryCommand({
    id: "font",
    token: "font",
    aliases: ["txtfont"],
    category: "text",
    icon: ALargeSmall,
    examples: ["/font title 24", "/font title color=#ffcc00", "/font title 48 color=#ffffff outline=1 outlineColor=#332e3e"],
    params: {
        target: targetParam(["text"], { core: true }),
        size: { hint: "size", type: { kind: "number", min: 1 }, positional: true },
        color: { hint: "color", type: { kind: "color" } },
        outline: {
            hint: "outline",
            type: { kind: "number", min: 0, max: STORY_TEXT_OUTLINE_MAX_WIDTH },
            about: "Outline width round the glyphs, in design pixels; 0 removes the outline. Drawn on the text's filter channel, so a later /transform filter or look replaces it.",
        },
        outlineColor: {
            hint: "outlineColor",
            type: { kind: "color" },
            about: "Outline colour. Without outline= it draws a 1 px outline; outline= without it draws in black.",
        },
    },
    build(args, ctx) {
        const block = createBlockForCommand("textFont", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "text") {
            return block;
        }
        const payload = { ...block.payload };
        const target = asTarget(args.target);
        if (target) {
            payload.objectName = target.name;
            payload.target = displayableTargetRef(target);
        }
        const size = asNumber(args.size);
        const color = asColor(args.color);
        const outline = fontOutlineOf(asNumber(args.outline), asColor(args.outlineColor));
        if (outline !== undefined || (size !== undefined && color !== undefined)) {
            payload.operation = "setFont";
            // The seed's 32 is a single-op default; the combined op states only what the line does.
            delete payload.fontSize;
            if (size !== undefined) payload.fontSize = size;
            if (color !== undefined) payload.fontColor = color;
            if (outline !== undefined) payload.outline = outline;
        } else if (size !== undefined) {
            payload.operation = "setFontSize";
            payload.fontSize = size;
        } else if (color !== undefined) {
            payload.operation = "setFontColor";
            payload.fontColor = color;
        }
        return { ...block, payload };
    },
});

/**
 * The outline a `/font` line states, or `undefined` when it names none. `outline=0` is `null` - take
 * the outline away - and is what the row stores for it, so it prints back as the same `outline=0`.
 */
function fontOutlineOf(width: number | undefined, color: string | undefined): StoryTextOutline | null | undefined {
    if (width === undefined && color === undefined) {
        return undefined;
    }
    if (width === 0) {
        return null;
    }
    return { width: width ?? 1, color: color ?? STORY_TEXT_OUTLINE_DEFAULT_COLOR };
}

export const OBJECT_COMMANDS = [image, text, layer, swap, play, front, font];
