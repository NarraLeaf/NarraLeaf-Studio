import type { StoryVariableRef } from "./document";

/**
 * The story rows that talk to the player's hands rather than to the stage: a pad that shakes, a line
 * the player cannot click past, and a story that waits for one gesture before it goes on.
 *
 * One payload arm (`action: "input"`) rather than one per command, for the reason `camera` is one arm:
 * every operation here addresses the same subject - the player's input - and the compiler hands all of
 * them to the same host. The operation is the verb; the commands (`/rumble`, `/input`, `/waitinput`,
 * `/hold`, `/mash`) are what an author types to reach one.
 *
 * Kept in `shared` because three places read it that cannot share a renderer import: the compiler,
 * the command line that writes it, and the inspector that edits it.
 *
 * Comments in English per project convention.
 */

/**
 * A named rumble an author picks instead of dialling numbers.
 *
 * `custom` is the one that is not a shape: it means "the row's own numbers and nothing else", so a
 * motor the row does not mention is off rather than the table's value.
 */
export type StoryRumblePresetId = "tap" | "pulse" | "impact" | "quake" | "alert" | "custom";

export type StoryRumbleShape = {
    /** The large, low-frequency motor in the LEFT grip, 0-1. */
    strongMagnitude: number;
    /** The small, high-frequency motor in the RIGHT grip, 0-1. */
    weakMagnitude: number;
    durationMs: number;
};

/**
 * The shapes, in the order they are offered.
 *
 * A row stores the preset's NAME plus whatever it overrides, so `/rumble impact` reads back as itself.
 * That makes this table part of what a shipped story plays: moving a number here retunes every row
 * that names the preset, which is the reason the numbers are few and each one is argued for.
 */
export const STORY_RUMBLE_PRESETS: Readonly<Record<Exclude<StoryRumblePresetId, "custom">, StoryRumbleShape>> = {
    // A nudge: a cursor landing, a confirmation. Short enough to fire on every press without becoming
    // the texture of the scene.
    tap: { strongMagnitude: 0.2, weakMagnitude: 0.3, durationMs: 80 },
    // The default "something happened". Balanced across both motors because it has no character of its
    // own - it is emphasis, not an event.
    pulse: { strongMagnitude: 0.45, weakMagnitude: 0.5, durationMs: 180 },
    // A hit. Heavy and over quickly: most of it in the left grip, because an impact is low.
    impact: { strongMagnitude: 1, weakMagnitude: 0.7, durationMs: 150 },
    // Something large and ongoing - a train, a quake, machinery in the walls. Almost all low motor, and
    // long, because this one is an atmosphere rather than a beat.
    quake: { strongMagnitude: 0.85, weakMagnitude: 0.1, durationMs: 1200 },
    // The answering shape: thin, high and insistent. A phone, an alarm, a held nerve.
    alert: { strongMagnitude: 0.15, weakMagnitude: 0.85, durationMs: 600 },
};

/** Every value the preset slot takes, `custom` last. */
export const STORY_RUMBLE_PRESET_IDS: readonly StoryRumblePresetId[] = ["tap", "pulse", "impact", "quake", "alert", "custom"];

/** The preset a row that names none plays. */
export const STORY_RUMBLE_DEFAULT_PRESET: StoryRumblePresetId = "pulse";

/**
 * Longest rumble a row may ask for. Browsers cap one effect at about five seconds and a pad left past
 * that may keep shaking on some engines, so a longer request is clamped rather than trusted.
 */
export const STORY_RUMBLE_MAX_DURATION_MS = 5000;

/** The fields every waiting operation shares. */
export type StoryInputWaitFields = {
    /**
     * The project input action this row waits for (`UIDocument.actions` key). Absent means any of
     * them: the first action the player performs, whichever it is.
     */
    actionId?: string;
    /**
     * Give up after this long. Absent waits for as long as it takes - which is the right default for a
     * row whose whole point is the player's gesture, and the reason a row that wants a deadline has to
     * say so.
     */
    timeoutMs?: number;
    /**
     * A boolean variable to write the outcome into: `true` when the player did it in time, `false` when
     * the deadline passed first. Absent leaves nothing behind, so a row without a deadline does not
     * need one.
     */
    resultTarget?: StoryVariableRef;
};

export type StoryInputActionPayload =
    | {
          action: "input";
          /** Shake every connected pad. */
          operation: "rumble";
          preset?: StoryRumblePresetId;
          /** Overrides the preset's left motor (or, under `custom`, is the left motor). */
          strongMagnitude?: number;
          /** Overrides the preset's right motor. */
          weakMagnitude?: number;
          /** Overrides the preset's length. */
          durationMs?: number;
          /** Hold the story until the rumble has finished. Absent lets the story move on at once. */
          wait?: boolean;
      }
    | {
          action: "input";
          /** End any rumble still running. */
          operation: "stopRumble";
      }
    | {
          action: "input";
          /**
           * Take the story out of the player's hands: a click, the advance key, auto-forward and
           * skipping all do nothing until an `unlock` row runs. Rows that do not wait for the player
           * go on playing, which is what makes a locked passage a cutscene rather than a frozen frame -
           * and why a dialogue line inside one strands the player.
           *
           * Its own member rather than `"lock" | "unlock"` on one, so a check of the two narrows the
           * union the way every other operation here does.
           */
          operation: "lock";
      }
    | {
          action: "input";
          /** Give the story back to the player. */
          operation: "unlock";
      }
    | ({
          action: "input";
          /** Wait for one press of the action. */
          operation: "wait";
      } & StoryInputWaitFields)
    | ({
          action: "input";
          /** Wait for the action to be held down, unbroken, for `holdMs`. */
          operation: "hold";
          holdMs: number;
      } & StoryInputWaitFields)
    | ({
          action: "input";
          /** Wait for the action to be pressed `count` times. */
          operation: "mash";
          count: number;
      } & StoryInputWaitFields);

export type StoryInputOperation = StoryInputActionPayload["operation"];

/** The three operations that wait for the player and can report how it went. */
export type StoryInputWaitPayload = Extract<StoryInputActionPayload, { operation: "wait" | "hold" | "mash" }>;

export function isStoryInputWaitPayload(payload: StoryInputActionPayload): payload is StoryInputWaitPayload {
    return payload.operation === "wait" || payload.operation === "hold" || payload.operation === "mash";
}

function clamp01(value: number | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.min(1, Math.max(0, value));
}

function clampDuration(value: number | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.min(STORY_RUMBLE_MAX_DURATION_MS, Math.max(0, value));
}

/**
 * The rumble a row plays: its preset's shape with the row's own numbers laid over it.
 *
 * Under `custom` the table contributes nothing, so a motor the row never mentions is 0 - the motor
 * off, never "the whole pad" - and a length the row never mentions is the default preset's, because a
 * rumble of no length is a row that does nothing.
 */
export function resolveStoryRumble(payload: Extract<StoryInputActionPayload, { operation: "rumble" }>): StoryRumbleShape {
    const preset = payload.preset ?? STORY_RUMBLE_DEFAULT_PRESET;
    const base: StoryRumbleShape = preset === "custom"
        ? { strongMagnitude: 0, weakMagnitude: 0, durationMs: STORY_RUMBLE_PRESETS.pulse.durationMs }
        : STORY_RUMBLE_PRESETS[preset] ?? STORY_RUMBLE_PRESETS.pulse;
    return {
        strongMagnitude: clamp01(payload.strongMagnitude) ?? base.strongMagnitude,
        weakMagnitude: clamp01(payload.weakMagnitude) ?? base.weakMagnitude,
        durationMs: clampDuration(payload.durationMs) ?? base.durationMs,
    };
}
