import { ALargeSmall, Image, Layers, Play, Replace, Type, Video } from "lucide-react";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue } from "../../storyCommandValues";
import {
    asBoolean,
    asColor,
    asNumber,
    asTarget,
    asText,
    defineStoryCommand,
    placementParam,
    secondsParam,
    targetParam,
    type StoryCommandValidateContext,
} from "../spec";
import { actionableTargetRef, deriveObjectName, displayableTargetRef, withPlacementTransform, withRevealTransform } from "../payloadHelpers";
import { transitionOptions } from "../transitions";

/** Media objects: `/image`, `/text`, `/video`, `/layer`, `/swap`, `/play`, `/font`. */

export const image = defineStoryCommand({
    id: "image",
    token: "image",
    aliases: ["img"],
    category: "image",
    icon: Image,
    examples: ["/image night", "/image night name=sky pos=center", "/image forest_day name=backdrop in=fade d=0.4"],
    params: {
        image: { aliases: ["src"], hint: "imageAsset", type: { kind: "asset", assetType: "image" }, positional: true, core: true },
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
        video: { aliases: ["src"], hint: "videoAsset", type: { kind: "asset", assetType: "video" }, positional: true, core: true },
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
    examples: ["/swap hero night", "/swap title A new title"],
    params: {
        target: targetParam(["image", "text"], { core: true }),
        // Typed by the target: an image's new content is an image asset, a text's is its new words.
        content: { hint: "content", type: { kind: "content", dependsOn: "target" }, positional: true, greedy: true, core: true },
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
        return { ...block, payload };
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

export const OBJECT_COMMANDS = [image, text, video, layer, swap, play, font];
