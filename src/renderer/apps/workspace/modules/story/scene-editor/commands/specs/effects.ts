import { Focus, Move3d, Sparkles, Zap } from "lucide-react";
import type { StoryDisplayableTargetRef } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandValue } from "../../storyCommandValues";
import { asColor, asDurationMs, asNumber, asTarget, defineStoryCommand, SECONDS_TYPE, secondsParam, targetParam } from "../spec";

/**
 * Screen and displayable effects: `/blink`, `/vignette`, `/fx`, `/transform`.
 *
 * The `effects` category these four shared is gone (§4.1): it cut by material domain while every other
 * category cut by subject, so "fade the portrait out" could argue for three different sections. They
 * split by what they act on - the screen-wide pair is a property of the SCENE, the displayable pair
 * acts on stage objects and reaches every subject its `accepts` lists.
 */

/**
 * The timing grammar the screen effects share: `d` is the whole in-and-out move, `hold` the pause at
 * full. One meaning per word across both, which is the part that has to be uniform.
 *
 * What is NOT uniform is which words each effect offers - `in` / `out` sit on `/blink` alone, below.
 * An effect offers the subset it can honour, the same way `SUPPORTED` in `commands/transitions.ts`
 * gives each context its own word list rather than one list plus a table of exceptions. A key that
 * parses and is then always reported is worse than a key that was never offered: it costs an author
 * the time to find out it leads nowhere, and the report is the only place they can find out.
 */
const SCREEN_EFFECT_TIMING = {
    d: secondsParam(),
    hold: { hint: "hold", type: SECONDS_TYPE },
} as const;

/**
 * `/blink` only: the two halves of the move, each overriding its own end of `d`.
 *
 * Being ABSENT is what means "derive from `d`", which is why neither carries a default - writing them
 * at build time would make an author who wanted the halves equal indistinguishable from one who never
 * split them, with no way back to following `d`.
 *
 * `/vignette` has no counterpart because the ENGINE has none: `VignetteOptions` carries a single
 * `duration` that drives its fade in and its fade out together. The split is absent here rather than
 * unimplemented, and it is NLR that would have to grow the pair first.
 */
const BLINK_HALVES = {
    in: { hint: "effectIn", type: SECONDS_TYPE },
    out: { hint: "effectOut", type: SECONDS_TYPE },
} as const;

function screenEffectBuild(commandId: "screenBlink" | "screenVignette") {
    return (
        args: {
            readonly d?: StoryCommandValue;
            readonly in?: StoryCommandValue;
            readonly out?: StoryCommandValue;
            readonly hold?: StoryCommandValue;
            readonly color?: StoryCommandValue;
            readonly opacity?: StoryCommandValue;
            readonly inner?: StoryCommandValue;
            readonly outer?: StoryCommandValue;
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
        const inMs = asDurationMs(args.in);
        if (inMs !== undefined) {
            payload.inMs = inMs;
        }
        const outMs = asDurationMs(args.out);
        if (outMs !== undefined) {
            payload.outMs = outMs;
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
        const inner = asNumber(args.inner);
        if (inner !== undefined) {
            payload.inner = inner;
        }
        const outer = asNumber(args.outer);
        if (outer !== undefined) {
            payload.outer = outer;
        }
        return { ...block, payload };
    };
}

export const blink = defineStoryCommand({
    id: "blink",
    token: "blink",
    category: "scene",
    icon: Zap,
    examples: ["/blink", "/blink d=0.2 hold=0.1", "/blink in=0.08 hold=0.4 out=0.9"],
    params: {
        ...SCREEN_EFFECT_TIMING,
        ...BLINK_HALVES,
        color: { hint: "color", type: { kind: "color" } },
    },
    build: screenEffectBuild("screenBlink"),
});

export const vignette = defineStoryCommand({
    id: "vignette",
    token: "vignette",
    aliases: ["vig"],
    category: "scene",
    icon: Focus,
    examples: ["/vignette", "/vignette d=0.5 opacity=0.6", "/vignette inner=30 outer=70"],
    params: {
        ...SCREEN_EFFECT_TIMING,
        color: { hint: "color", type: { kind: "color" } },
        opacity: { hint: "opacity", type: { kind: "number", min: 0, max: 1 } },
        // The falloff, and `/vignette` only: a blink has no radius, it has two shutters. Percentages
        // of the frame rather than the engine's free-form CSS length, so the mask stays
        // resolution-independent and the pair can be ordered (`inner` above `outer` is a gradient the
        // browser drops whole) without parsing units.
        inner: { hint: "vignetteInner", type: { kind: "number", min: 0, max: 100 } },
        outer: { hint: "vignetteOuter", type: { kind: "number", min: 0, max: 100 } },
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
    // Audio, video and vfx are not displayables; the target param never accepts them here. (The
    // payload type says so too - `StoryDisplayableTargetKind` excludes them - so this arm exists only
    // to keep the function total, not because a line can reach it.)
    if (target.objectKind === "audio" || target.objectKind === "video" || target.objectKind === "vfx") {
        return { name: target.name };
    }
    return { kind: target.objectKind, name: target.name };
}

export const fx = defineStoryCommand({
    id: "fx",
    token: "fx",
    aliases: ["effect"],
    // Only the flat surfaces read this; the sidebar files `/fx` under all four subjects it accepts.
    category: "image",
    icon: Sparkles,
    examples: ["/fx hero"],
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
    icon: Move3d,
    examples: ["/transform hero", "/transform hero d=0.5"],
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
