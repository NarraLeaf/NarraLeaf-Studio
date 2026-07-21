import type { StoryDisplayableTargetRef } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandValue } from "../../storyCommandValues";
import { asColor, asDurationMs, asNumber, asTarget, defineStoryCommand, secondsParam, targetParam } from "../spec";

/** Screen and displayable effects: `/blink`, `/vignette`, `/fx`, `/transform`. */

function screenEffectBuild(commandId: "screenBlink" | "screenVignette") {
    return (
        args: {
            readonly d?: StoryCommandValue;
            readonly hold?: StoryCommandValue;
            readonly color?: StoryCommandValue;
            readonly opacity?: StoryCommandValue;
        },
        ctx: { generateId: () => string },
    ) => {
        const block = createBlockForCommand(commandId, ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "screenEffect") {
            return block;
        }
        const payload = { ...block.payload };
        const durationMs = asDurationMs(args.d);
        if (durationMs !== undefined) {
            payload.durationMs = durationMs;
        }
        const holdMs = asDurationMs(args.hold);
        if (holdMs !== undefined) {
            payload.holdMs = holdMs;
        }
        const color = asColor(args.color);
        if (color !== undefined) {
            payload.color = color;
        }
        const opacity = asNumber(args.opacity);
        if (opacity !== undefined) {
            payload.opacity = opacity;
        }
        return { ...block, payload };
    };
}

export const blink = defineStoryCommand({
    id: "blink",
    token: "blink",
    category: "effects",
    params: {
        d: secondsParam(),
        hold: { hint: "hold", type: { kind: "number", min: 0 } },
        color: { hint: "color", type: { kind: "color" } },
    },
    build: screenEffectBuild("screenBlink"),
});

export const vignette = defineStoryCommand({
    id: "vignette",
    token: "vignette",
    aliases: ["vig"],
    category: "effects",
    params: {
        d: secondsParam(),
        hold: { hint: "hold", type: { kind: "number", min: 0 } },
        color: { hint: "color", type: { kind: "color" } },
        opacity: { hint: "opacity", type: { kind: "number", min: 0, max: 1 } },
    },
    build: screenEffectBuild("screenVignette"),
});

/** The displayable target ref a generic-effect block addresses - name plus kind, resolved later by the inspector's binding. */
function displayableTargetRef(target: ReturnType<typeof asTarget>): StoryDisplayableTargetRef | undefined {
    if (!target) {
        return undefined;
    }
    if (target.type === "character") {
        return { kind: "character", name: target.name };
    }
    // Audio and video objects are not displayables; the target param never accepts them here.
    if (target.objectKind === "audio" || target.objectKind === "video") {
        return { name: target.name };
    }
    return { kind: target.objectKind, name: target.name };
}

export const fx = defineStoryCommand({
    id: "fx",
    token: "fx",
    aliases: ["effect"],
    category: "effects",
    params: {
        target: targetParam(["image", "text", "layer", "character"], { core: true }),
    },
    build(args, ctx) {
        const block = createBlockForCommand("displayableEffect", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "displayable") {
            return block;
        }
        const ref = displayableTargetRef(asTarget(args.target));
        return ref ? { ...block, payload: { ...block.payload, target: ref } } : block;
    },
    // Which effect, and its knobs, is inspector territory - the line only says what it acts on.
    inspectorAfterCommit: true,
});

export const transform = defineStoryCommand({
    id: "transform",
    token: "transform",
    aliases: ["displayabletransform"],
    category: "image",
    params: {
        target: targetParam(["image", "text", "layer", "character"], { core: true }),
        d: secondsParam(),
    },
    build(args, ctx) {
        const block = createBlockForCommand("displayableTransform", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "displayable") {
            return block;
        }
        const payload = { ...block.payload };
        const ref = displayableTargetRef(asTarget(args.target));
        if (ref) {
            payload.target = ref;
        }
        const durationMs = asDurationMs(args.d);
        if (durationMs !== undefined) {
            payload.durationMs = durationMs;
        }
        return { ...block, payload };
    },
    inspectorAfterCommit: true,
});

export const EFFECT_COMMANDS = [blink, vignette, fx, transform];
