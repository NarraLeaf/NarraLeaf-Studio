import { createBlockForCommand } from "../../storyActionCommands";
import { asNumber, defineStoryCommand, secondsParam } from "../spec";
import { withRevealTransform, withTransitionRef } from "../payloadHelpers";
import { transitionOptions } from "../transitions";
import { storySecondsToMs } from "@shared/utils/storyTime";

/** Scene & flow: `/bg`, `/jump`, `/wait`, `/nvl`. */

export const bg = defineStoryCommand({
    id: "background",
    token: "bg",
    aliases: ["background"],
    category: "scene",
    params: {
        image: {
            hint: "imageOrColor",
            type: [{ kind: "asset", assetType: "image" }, { kind: "color" }],
            positional: true,
            core: true,
        },
        t: { aliases: ["transition"], hint: "transition", type: { kind: "enum", options: transitionOptions("scene") } },
        d: secondsParam(),
    },
    build(args, ctx) {
        const block = createBlockForCommand("background", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "setBackground") {
            return block;
        }
        const payload = { ...block.payload };
        // assetId XOR color: setting one must clear the other, or the compiler sees both.
        if (args.image?.kind === "asset") {
            payload.assetId = args.image.assetId;
            payload.color = undefined;
        } else if (args.image?.kind === "color") {
            payload.color = args.image.color;
            payload.assetId = undefined;
        }
        const transition = withTransitionRef(payload.transition, "scene", args.t, args.d);
        return { ...block, payload: { ...payload, ...(transition ? { transition } : {}) } };
    },
});

export const jump = defineStoryCommand({
    id: "jump",
    token: "jump",
    category: "scene",
    params: {
        scene: { hint: "scene", type: { kind: "scene" }, positional: true, core: true },
        t: { aliases: ["transition"], hint: "transition", type: { kind: "enum", options: transitionOptions("scene") } },
        d: secondsParam(),
    },
    build(args, ctx) {
        const block = createBlockForCommand("jump", ctx.generateId);
        if (block.kind !== "jump") {
            return block;
        }
        const payload = { ...block.payload };
        if (args.scene?.kind === "scene") {
            payload.targetSceneId = args.scene.sceneId;
        }
        const transition = withTransitionRef(payload.transition, "scene", args.t, args.d);
        return { ...block, payload: { ...payload, ...(transition ? { transition } : {}) } };
    },
});

export const wait = defineStoryCommand({
    id: "wait",
    token: "wait",
    category: "control",
    params: {
        // `/wait 2` pauses two seconds, `/wait click` (or a bare `/wait`) waits for the player.
        seconds: { hint: "waitFor", type: [{ kind: "keyword", value: "click" }, { kind: "number", min: 0 }], positional: true },
    },
    build(args, ctx) {
        const block = createBlockForCommand("waitClick", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "wait") {
            return block;
        }
        const seconds = asNumber(args.seconds);
        if (seconds !== undefined) {
            return { ...block, payload: { action: "wait", mode: "duration", durationMs: storySecondsToMs(seconds) } };
        }
        // The keyword, or nothing at all: waiting for a click is what a bare `/wait` means.
        return { ...block, payload: { action: "wait", mode: "click" } };
    },
});

export const nvl = defineStoryCommand({
    id: "nvl",
    token: "nvl",
    category: "scene",
    params: {
        t: { aliases: ["transition"], hint: "transition", type: { kind: "enum", options: transitionOptions("nvl") } },
        d: secondsParam(),
    },
    build(args, ctx) {
        const block = createBlockForCommand("nvl", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "nvl") {
            return block;
        }
        // NVL's `transition` field is a transform ref (preset-based) - see the payload's note.
        const transition = withRevealTransform(block.payload.transition, "nvl", args.t, args.d);
        return transition ? { ...block, payload: { ...block.payload, transition } } : block;
    },
});

export const SCENE_COMMANDS = [bg, jump, wait, nvl];
