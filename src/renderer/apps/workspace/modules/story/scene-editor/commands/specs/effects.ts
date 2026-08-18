import { Zap } from "lucide-react";
import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue } from "../../storyCommandValues";
import {
    asColor,
    asDurationMs,
    asEnum,
    asNumber,
    defineStoryCommand,
    SECONDS_TYPE,
    secondsParam,
    type StoryCommandValidateContext,
} from "../spec";

/**
 * `/screen` - the screen-wide gestures: the eyes closing, the frame darkening at its edges.
 *
 * **Why this is a verb of its own and not a transform.** Everything else that moves on stage is one
 * object interpolating one prop bag, which is why `/transform` can be the only writing verb. A blink
 * is not that: it is two eyelid overlays, each running its own timeline (the engine splits them as
 * `closeDuration` / `openDuration`), drawn on the scene's own effect layer over everything including
 * the sprites. One-object-at-a-time cannot express it, and no spelling of the prop vocabulary would
 * make it able to. So the screen effects stay a canned-routine verb: the line names the routine and
 * its knobs, and the engine owns the choreography.
 *
 * **One token, effect first.** `/blink` and `/vignette` were two tokens for one gesture shape - both
 * are an in-and-out move with a pause at full, both draw on the same layer, and neither is a subject
 * anything else in the language addresses. The operation goes in the first positional, exactly as the
 * retired `/camera` put its knob there, so the family grows by a word rather than by a token.
 *
 * **The cost, stated.** Merging means one param set spanning two effects, so `in=` parses on a
 * vignette and is then reported. That is the shape `/show t=` already has (the union of every
 * context's words parses, and the spec rejects the ones this target cannot honour), and it is the
 * price of the merge: the alternative is a second token whose only job is to carry a different
 * subset. The rejection names the effect, so the report is actionable rather than a flat refusal.
 */

const SCREEN_EFFECTS = [{ value: "blink" }, { value: "vignette" }] as const;

/** `blink` only. `/vignette` has no counterpart because the ENGINE has none: `VignetteOptions` carries
 * a single `duration` driving its fade in and its fade out together. The split is ABSENT rather than
 * unimplemented, and it is NLR that would have to grow the pair first. */
const BLINK_ONLY = ["in", "out"] as const;

/** `vignette` only: a blink has no radius and no opacity, it has two shutters. */
const VIGNETTE_ONLY = ["opacity", "inner", "outer"] as const;

export const screen = defineStoryCommand({
    id: "screen",
    token: "screen",
    aliases: ["screenfx"],
    category: "scene",
    icon: Zap,
    examples: [
        "/screen blink",
        "/screen blink in=0.08 hold=0.4 out=0.9",
        "/screen vignette d=0.5 opacity=0.6",
        "/screen vignette inner=30 outer=70",
    ],
    quickParams: ["d"],
    params: {
        effect: { hint: "screenEffect", type: { kind: "enum", options: SCREEN_EFFECTS }, positional: true, core: true },
        // `d` is the WHOLE in-and-out move and `hold` the pause at full - one meaning per word across
        // both effects, which is the part that has to be uniform.
        d: secondsParam(),
        hold: { hint: "hold", type: SECONDS_TYPE },
        color: { hint: "color", type: { kind: "color" } },
        // The two halves of a blink, each overriding its own end of `d`. Being ABSENT is what means
        // "derive from `d`", so neither carries a default: writing one at build time would make an
        // author who wanted the halves equal indistinguishable from one who never split them.
        in: { hint: "effectIn", type: SECONDS_TYPE },
        out: { hint: "effectOut", type: SECONDS_TYPE },
        opacity: { hint: "opacity", type: { kind: "number", min: 0, max: 1 } },
        // Percentages of the frame rather than the engine's free-form CSS length, so the mask stays
        // resolution-independent and the pair can be ordered (`inner` above `outer` is a gradient the
        // browser drops whole) without parsing units.
        inner: { hint: "vignetteInner", type: { kind: "number", min: 0, max: 100 } },
        outer: { hint: "vignetteOuter", type: { kind: "number", min: 0, max: 100 } },
    },
    build(args, ctx): StoryBlock {
        const effect = asEnum(args.effect) === "vignette" ? "vignette" : "blink";
        const block = createBlockForCommand(effect === "vignette" ? "screenVignette" : "screenBlink", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "screenEffect") {
            return block;
        }
        const payload = { ...block.payload };
        const write = <K extends keyof typeof payload>(key: K, value: (typeof payload)[K] | undefined) => {
            if (value !== undefined) {
                payload[key] = value;
            }
        };
        write("durationMs", asDurationMs(args.d));
        write("holdMs", asDurationMs(args.hold));
        write("color", asColor(args.color));
        if (effect === "blink") {
            write("inMs", asDurationMs(args.in));
            write("outMs", asDurationMs(args.out));
        } else {
            write("opacity", asNumber(args.opacity));
            write("inner", asNumber(args.inner));
            write("outer", asNumber(args.outer));
        }
        return { ...block, payload };
    },
    validate(args, ctx: StoryCommandValidateContext): StoryCommandResolutionIssue[] {
        const effect = asEnum(args.effect);
        if (effect === undefined) {
            return [];
        }
        const wrong: readonly ("in" | "out" | "opacity" | "inner" | "outer")[] = effect === "vignette" ? BLINK_ONLY : VIGNETTE_ONLY;
        const issues: StoryCommandResolutionIssue[] = [];
        for (const key of wrong) {
            const span = args[key] === undefined ? undefined : ctx.spanOf(key);
            if (span) {
                issues.push({ code: "unsupportedParam", span, key, kind: effect });
            }
        }
        return issues;
    },
});

export const EFFECT_COMMANDS = [screen];
