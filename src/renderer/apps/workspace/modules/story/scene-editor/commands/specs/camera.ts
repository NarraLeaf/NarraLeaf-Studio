import { Aperture } from "lucide-react";
import type { StoryActionPayload, StoryBlock } from "@shared/types/story";
import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { getStoryCameraLookPreset, STORY_CAMERA_LOOK_PRESETS } from "../../cameraLookPresets";
import { asDurationMs, asEnum, asNumber, defineStoryCommand, PLACEMENT_OPTIONS, secondsParam } from "../spec";

/**
 * `/camera` - the story's stage camera.
 *
 * One token with the operation as its first positional, rather than seven tokens: the operations are
 * one instrument, and an author reaching for the camera knows which knob they want before they know
 * its name. The second positional is that knob's value - a placement for `pan`, a number for
 * `zoom` / `rotate` / `darken`, a look preset for `look`, nothing for `reset`.
 *
 * The camera is a story-level singleton whose pose survives a scene change, which is why `reset` is
 * one of the completions offered the moment `/camera ` is typed rather than something an author has
 * to know to look for.
 */

/** Neutral values, so a knob named without a value still builds a coherent block (specs must build from `{}`). */
const CAMERA_DEFAULT_DURATION_MS = 600;
const NEUTRAL_ZOOM = 1;
const NEUTRAL_ROTATION = 0;
const DEFAULT_DARKNESS = 0.5;

const CAMERA_OPERATIONS = [
    { value: "zoom" },
    { value: "pan" },
    { value: "rotate", aliases: ["tilt"] },
    { value: "darken", aliases: ["dim"] },
    // `grade` is the word the rest of the craft uses for this, and an author who knows it should not
    // have to discover that Studio calls it something else. `look` stays canonical because it is what
    // the row and the inspector print, and it is the shorter half of the pair.
    { value: "look", aliases: ["grade"] },
    { value: "motion", aliases: ["shot"] },
    { value: "reset" },
] as const;

/**
 * The look library, as the `amount` slot's word list.
 *
 * Derived from the library rather than spelled again: the two lists disagreeing would mean a preset
 * the inspector offers and the command line rejects, which is exactly the kind of split the spec file
 * exists to prevent.
 */
const CAMERA_LOOK_OPTIONS = STORY_CAMERA_LOOK_PRESETS.map(preset => ({ value: preset.id }));

type CameraOperation = Extract<StoryActionPayload, { action: "camera" }>["operation"];

function isCameraOperation(value: string | undefined): value is CameraOperation {
    return value === "zoom" || value === "pan" || value === "rotate" || value === "darken"
        || value === "look" || value === "motion" || value === "reset";
}

/**
 * The knob value, read against the operation it belongs to. A number typed for `pan` (or a placement
 * word typed for `zoom`) is simply not that operation's value and leaves the neutral default standing -
 * the payload stays coherent, and the author sees the row say what it will actually do.
 */
function cameraOperand(
    operation: CameraOperation,
    amount: number | undefined,
    placement: string | undefined,
    strength: number | undefined,
): Partial<Extract<StoryActionPayload, { action: "camera" }>> {
    switch (operation) {
        case "pan": {
            // `left`/`center`/`right` mean here exactly what they mean for a sprite's `at=`, read from
            // the one table that owns that mapping.
            const position = getPresetPosition(placement ?? "center", {});
            return position ? { position } : {};
        }
        case "zoom":
            return { zoom: amount ?? NEUTRAL_ZOOM };
        case "rotate":
            return { rotation: amount ?? NEUTRAL_ROTATION };
        case "darken":
            return { darkness: amount ?? DEFAULT_DARKNESS };
        case "look": {
            // The knob is a word from the library, and the strength rides a separate key because the
            // positional is already spent naming the grade. An unrecognised word leaves the preset
            // unset rather than guessing at one - `/camera look` with nothing chosen is a defined
            // state that opens the inspector (see `inspectorAfterCommit`), and a typo landing on
            // `memory` would be a row that plays a grade the author never named.
            const preset = getStoryCameraLookPreset(placement);
            if (!preset) {
                return strength === undefined ? {} : { lookIntensity: strength };
            }
            return { lookPreset: preset.id, lookIntensity: strength ?? preset.defaultIntensity };
        }
        case "motion":
            // The knob here is a Story Motion asset, which is a binding rather than a word - so the
            // line names the operation and the inspector does the picking (`inspectorAfterCommit`).
            // The ref is written in `animation` mode straight away so the editor opens on the motion
            // field instead of on a preset picker the camera has no use for.
            return { motion: { mode: "animation" } };
        case "reset":
            return {};
    }
}

export const camera = defineStoryCommand({
    id: "camera",
    token: "camera",
    aliases: ["cam"],
    // Its own top-level category (§3.3): the pose outlives the scene, so `scene` would have claimed a
    // lifetime the camera does not have, and no other subject is a camera.
    category: "camera",
    icon: Aperture,
    examples: ["/camera zoom 2", "/camera pan left", "/camera look moonlight", "/camera motion", "/camera reset"],
    quickParams: ["d"],
    params: {
        op: {
            hint: "cameraOperation",
            type: { kind: "enum", options: CAMERA_OPERATIONS },
            positional: true,
            core: true,
        },
        amount: {
            hint: "cameraAmount",
            // One slot, three vocabularies: the placements `pan` reads, the look names `look` reads,
            // and the number the rest read. They cannot collide - no grade is called `left` - and one
            // slot is what keeps `/camera <op> <value>` a single sentence shape across every operation.
            type: [{ kind: "enum", options: [...PLACEMENT_OPTIONS, ...CAMERA_LOOK_OPTIONS] }, { kind: "number" }],
            positional: true,
        },
        // `look` only. Its own key rather than the positional, which the grade name has already spent;
        // `strength=` also keeps `/camera look moonlight` readable as the common case, with the dial
        // as something an author adds when the nominal grade is too much.
        strength: { aliases: ["intensity"], hint: "cameraLookStrength", type: { kind: "number", min: 0, max: 2 } },
        d: secondsParam(),
    },
    build(args, ctx): StoryBlock {
        const operationValue = asEnum(args.op);
        const operation: CameraOperation = isCameraOperation(operationValue) ? operationValue : "zoom";
        const payload: Extract<StoryActionPayload, { action: "camera" }> = {
            action: "camera",
            operation,
            durationMs: asDurationMs(args.d) ?? CAMERA_DEFAULT_DURATION_MS,
            ...cameraOperand(operation, asNumber(args.amount), asEnum(args.amount), asNumber(args.strength)),
        };
        return { id: ctx.generateId(), parentId: null, childrenIds: [], kind: "action", payload };
    },
    /**
     * Inspector-first only where the line cannot finish the row.
     *
     * `motion` always is: it commits an unbound Story Motion ref, and the asset it needs is not
     * something a command line can name. `look` is only *sometimes* - `/camera look moonlight` is
     * complete as typed and must not have the caret yanked out of the row, but a bare `/camera look`
     * names no grade and would compile to nothing, so that one row opens on the picker instead of
     * sitting there as a line that does nothing. The remaining operations are complete as typed.
     */
    inspectorAfterCommit: block => {
        if (block.kind !== "action" || block.payload.action !== "camera") {
            return false;
        }
        const payload = block.payload;
        return payload.operation === "motion"
            || (payload.operation === "look" && !payload.lookPreset && !payload.filter);
    },
});

export const CAMERA_COMMANDS = [camera];
