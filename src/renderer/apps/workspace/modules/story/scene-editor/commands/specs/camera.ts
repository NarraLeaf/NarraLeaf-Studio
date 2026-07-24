import type { StoryActionPayload, StoryBlock } from "@shared/types/story";
import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { asDurationMs, asEnum, asNumber, defineStoryCommand, PLACEMENT_OPTIONS, secondsParam } from "../spec";

/**
 * `/camera` - the story's stage camera (plan 2026-07-24-006 §5.7).
 *
 * One token with the operation as its first positional, rather than five tokens: the five operations
 * are one instrument, and an author reaching for the camera knows which knob they want before they
 * know its name. The second positional is that knob's value - a placement for `pan`, a number for
 * `zoom` / `rotate` / `darken`, nothing for `reset`.
 *
 * The camera is a story-level singleton whose pose survives a scene change, which is why `reset` is
 * one of the five completions offered the moment `/camera ` is typed rather than something an author
 * has to know to look for.
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
    { value: "reset" },
] as const;

type CameraOperation = Extract<StoryActionPayload, { action: "camera" }>["operation"];

function isCameraOperation(value: string | undefined): value is CameraOperation {
    return value === "zoom" || value === "pan" || value === "rotate" || value === "darken" || value === "reset";
}

/**
 * The knob value, read against the operation it belongs to. A number typed for `pan` (or a placement
 * word typed for `zoom`) is simply not that operation's value and leaves the neutral default standing -
 * the payload stays coherent, and the author sees the row say what it will actually do.
 */
function cameraOperand(operation: CameraOperation, amount: number | undefined, placement: string | undefined): Partial<Extract<StoryActionPayload, { action: "camera" }>> {
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
            type: [{ kind: "enum", options: PLACEMENT_OPTIONS }, { kind: "number" }],
            positional: true,
        },
        d: secondsParam(),
    },
    build(args, ctx): StoryBlock {
        const operationValue = asEnum(args.op);
        const operation: CameraOperation = isCameraOperation(operationValue) ? operationValue : "zoom";
        const payload: Extract<StoryActionPayload, { action: "camera" }> = {
            action: "camera",
            operation,
            durationMs: asDurationMs(args.d) ?? CAMERA_DEFAULT_DURATION_MS,
            ...cameraOperand(operation, asNumber(args.amount), asEnum(args.amount)),
        };
        return { id: ctx.generateId(), parentId: null, childrenIds: [], kind: "action", payload };
    },
});

export const CAMERA_COMMANDS = [camera];
