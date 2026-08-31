import { ALargeSmall, BringToFront, Image, Layers, Play, Replace, Type, Video } from "lucide-react";
import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue } from "../../storyCommandValues";
import {
    asBoolean,
    asColor,
    asNumber,
    asTarget,
    asText,
    defineStoryCommand,
    holdParam,
    placementParam,
    secondsParam,
    targetParam,
    type StoryCommandValidateContext,
} from "../spec";
import { actionableTargetRef, deriveObjectName, displayableTargetRef, withPlacementTransform, withRevealTransform, withTransitionRef } from "../payloadHelpers";
import { transitionOptions } from "../transitions";

/** Media objects: `/image`, `/text`, `/video`, `/layer`, `/swap`, `/play`, `/front`, `/font`. */

export const image = defineStoryCommand({
    id: "image",
    token: "image",
    aliases: ["img"],
    category: "image",
    icon: Image,
    examples: ["/image night", "/image night name=sky pos=center", "/image forest_day name=backdrop in=fade d=0.4"],
    params: {
        image: { aliases: ["src"], hint: "imageAsset", type: { kind: "asset", assetType: "image", allowSets: true }, positional: true, core: true },
        name: { hint: "objectName", type: { kind: "text" } },
        pos: placementParam(),
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
            ? withPlacementTransform(payload.transform, args.pos, args.d)
            : withRevealTransform(payload.transform, "reveal", args.in, args.d);
        return { ...block, payload: { ...payload, ...(transform ? { transform } : {}) } };
    },
});

export const text = defineStoryCommand({
    id: "text",
    token: "text",
    aliases: ["txt"],
    category: "text",
    icon: Type,
    examples: ["/text Welcome home", "/text name=title pos=center Chapter One"],
    params: {
        // `name=` must be typed before the greedy content - the one ordering rule greedy imposes.
        name: { hint: "objectName", type: { kind: "text" } },
        pos: placementParam(),
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
        const transform = withPlacementTransform(payload.transform, args.pos, undefined);
        return { ...block, payload: { ...payload, ...(transform ? { transform } : {}) } };
    },
});

export const video = defineStoryCommand({
    id: "video",
    token: "video",
    aliases: ["vid"],
    category: "video",
    icon: Video,
    examples: ["/video intro", "/video intro name=cutscene muted"],
    params: {
        video: { aliases: ["src"], hint: "videoAsset", type: { kind: "asset", assetType: "video", allowSets: true }, positional: true, core: true },
        name: { hint: "objectName", type: { kind: "text" } },
        muted: { hint: "muted", type: { kind: "boolean" } },
    },
    deriveArgs: deriveObjectName("video", "video", "video"),
    build(args, ctx) {
        const block = createBlockForCommand("videoCreate", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "video") {
            return block;
        }
        const payload = { ...block.payload };
        const name = asText(args.name);
        if (name !== undefined) {
            payload.objectName = name;
        }
        if (args.video?.kind === "asset") {
            payload.assetId = args.video.assetId;
        }
        const muted = asBoolean(args.muted);
        if (muted !== undefined) {
            payload.muted = muted;
        }
        return { ...block, payload };
    },
});

export const layer = defineStoryCommand({
    id: "layer",
    token: "layer",
    category: "layer",
    icon: Layers,
    examples: ["/layer overlay", "/layer overlay z=10"],
    params: {
        name: { hint: "objectName", type: { kind: "text" }, positional: true, core: true },
        z: { aliases: ["zindex"], hint: "z", type: { kind: "number", integer: true } },
    },
    build(args, ctx) {
        const block = createBlockForCommand("layerCreate", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "layer") {
            return block;
        }
        const payload = { ...block.payload };
        const name = asText(args.name);
        if (name !== undefined) {
            payload.objectName = name;
        }
        const zIndex = asNumber(args.z);
        if (zIndex !== undefined) {
            payload.zIndex = zIndex;
        }
        return { ...block, payload };
    },
});

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
        t: { aliases: ["transition"], hint: "transition", type: { kind: "enum", options: transitionOptions("expression") } },
        d: secondsParam(),
        hold: holdParam(),
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

export const play = defineStoryCommand({
    id: "play",
    token: "play",
    category: "video",
    icon: Play,
    examples: ["/play clip"],
    params: {
        target: targetParam(["video"], { core: true }),
    },
    build(args, ctx) {
        const block = createBlockForCommand("videoPlay", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "video") {
            return block;
        }
        const target = asTarget(args.target);
        if (target?.type !== "stageObject") {
            return block;
        }
        return { ...block, payload: { ...block.payload, objectName: target.name, target: actionableTargetRef(target) } };
    },
});

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
        // sitting in plain sight. A layer's own front-to-back is `z=`, which `/layer` already writes.
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

export const font = defineStoryCommand({
    id: "font",
    token: "font",
    aliases: ["txtfont"],
    category: "text",
    icon: ALargeSmall,
    examples: ["/font title 24", "/font title color=#ffcc00"],
    params: {
        target: targetParam(["text"], { core: true }),
        size: { hint: "size", type: { kind: "number", min: 1 }, positional: true },
        color: { hint: "color", type: { kind: "color" } },
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
        // One block runs one op: a size sets the size, otherwise a colour sets the colour. Both at
        // once is a `conflictingParams` fault (below) until the combined op lands with schema v6.
        const size = asNumber(args.size);
        const color = asColor(args.color);
        if (size !== undefined) {
            payload.operation = "setFontSize";
            payload.fontSize = size;
        } else if (color !== undefined) {
            payload.operation = "setFontColor";
            payload.fontColor = color;
        }
        return { ...block, payload };
    },
    validate(args, ctx: StoryCommandValidateContext): StoryCommandResolutionIssue[] {
        if (asNumber(args.size) === undefined || asColor(args.color) === undefined) {
            return [];
        }
        const span = ctx.spanOf("color");
        return span ? [{ code: "conflictingParams", span, keys: ["size", "color"] }] : [];
    },
});

export const OBJECT_COMMANDS = [image, text, video, layer, swap, play, front, font];
