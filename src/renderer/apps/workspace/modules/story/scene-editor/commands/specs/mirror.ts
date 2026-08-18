import { FlipHorizontal } from "lucide-react";
import { createBlockForCommand } from "../../storyActionCommands";
import { displayableTargetRef } from "../payloadHelpers";
import { asDurationMs, asEnum, asTarget, defineStoryCommand, secondsParam, targetParam } from "../spec";

/**
 * `/mirror` - face a sprite the other way.
 *
 * A visual novel draws one portrait and reuses it on both sides of the stage; until now there was no
 * way to say "and this time she is looking the other way" without a second image. The engine has
 * always been able to: `Displayable.scale` documents "use negative value to invert the scale", and
 * NLR maps the pair onto `scale(zoom*scaleX, zoom*scaleY)`, so `scaleX: -1` is the mirror.
 *
 * **A displayable transform, not an effect of its own.** The row it builds is the one `/transform`
 * builds, carrying the `flip` preset - so the inspector edits it as a transform, a saved document
 * needs no new payload arm, and the mirror composes with everything else a transform does. The word
 * exists because "mirror the sprite" is a thing an author reaches for by name, not because the shape
 * underneath is new.
 *
 * **Absolute, never a toggle.** The second word says which way to face, not "change". It has to: the
 * compiler emits a STATIC transform - `scaleX(-1)` is decided when the scene is built and the built
 * chain has no way to read what the sprite's scale happens to be when the line runs. A `/mirror hero`
 * meaning "whichever way it faces now, face the other way" would need that value at play time. So
 * `on` mirrors and `off` restores, saying either one twice is a no-op, and a scene read top to bottom
 * says what its sprites look like rather than what changed.
 *
 * **`d=` animates the mirror rather than cutting to it.** A duration walks `scaleX` from 1 to -1,
 * which passes through 0 - the sprite squashes to nothing edge-on and opens out reversed. That is a
 * real move (a page turning, a card flipping), so it is offered; it is not the default, because "she
 * faces the other way now" is the sentence the command is for.
 *
 * **Called `/mirror`, not `/flip`.** `flip` was already taken: it is a live alias of `/toggle`, the
 * boolean verb, and a token is what a stored line RE-PARSES as (see `RETIRED_COMMAND_TOKENS` in the
 * registry). Handing it to this command would turn every `/flip met` an author has written - in a
 * scene, or in a script file exported years ago and re-parsed on import - into a mirror of a stage
 * object that does not exist, with no diagnostic anywhere. `mirror` is also the word the effect goes
 * by; nothing is lost by using it.
 *
 * Lives in its own file rather than beside `/fx` and `/transform` in `specs/effects.ts` purely to
 * keep two branches off one file; it belongs with them and can be folded in later.
 */

/** Mirrored, or back to the drawing's own facing. Two states, since a static transform cannot invert a value it cannot read. */
const MIRROR_STATES = [{ value: "on" }, { value: "off" }] as const;

export const mirror = defineStoryCommand({
    id: "mirror",
    token: "mirror",
    // Only the flat surfaces read this; the sidebar files `/mirror` under all four subjects it
    // accepts, exactly as it does the `/transform` its rows are.
    category: "image",
    icon: FlipHorizontal,
    examples: ["/mirror hero", "/mirror hero off", "/mirror Alice d=0.3"],
    params: {
        // The same four subjects `/transform` reaches: every Displayable, and nothing that is not one.
        target: targetParam(["image", "text", "layer", "character"], { core: true }),
        state: { hint: "mirrorState", type: { kind: "enum", options: MIRROR_STATES }, positional: true },
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
        // The whole bag is replaced, not patched: the seeded block carries a placement, and a row that
        // mirrored AND moved the sprite is not what `/mirror` says. `scaleY` is deliberately absent -
        // a mirror is horizontal, and restating a vertical scale would reset one an earlier row set.
        payload.transform = {
            to: { scaleX: asEnum(args.state) === "off" ? 1 : -1 },
            ...(durationMs !== undefined ? { durationMs } : {}),
        };
        return { ...block, payload };
    },
});

export const MIRROR_COMMANDS = [mirror];
