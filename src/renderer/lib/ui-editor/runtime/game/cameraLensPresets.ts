import type { StoryCameraLensRef, StoryTransformProps } from "@shared/types/story";

/**
 * The camera lens library — the gestures the camera's own glass makes.
 *
 * A lens effect is not a grade and not a pose. `shutter` draws two eyelids closing symmetrically over
 * the whole frame; `vignette` darkens its edges. Both are rendered by the camera's **lens overlay**,
 * which is a sibling of the camera's transform node rather than a child of it — so neither pans,
 * zooms nor rotates with the shot, and neither touches the dialogue box, the menus or the NVL layer.
 * That sibling relationship is the whole reason these are camera props instead of a full-screen
 * object standing on the stage: an object would be graded and scaled with everything else on it, and
 * would cover the words the player is reading.
 *
 * ## Why the gestures are presets and the channels are numbers
 *
 * The channels themselves (`shutter`, `vignette` and the four that dress them) are ordinary props: a
 * row can hold the eyes shut, or sit under a fixed vignette, and those are STATES an author dials.
 *
 * A blink is not a state. It is in, hold, out — three timings, a colour, and a shape that has to be
 * the same every time or the scene reads as sloppy. Asking an author to keyframe that by hand every
 * time somebody blinks is what this library refuses. So the gesture is named, and the numbers are
 * overrides on the name rather than a bag of keyframes the author assembles.
 *
 * ## The numbers
 *
 * They are the defaults the retired `/screen` command shipped with, to the millisecond. An author who
 * had a blink in their scene must not find that it now reads differently: the row moved to a
 * different instrument, and nothing about what the player sees was up for redesign.
 *
 * ## Where this file may import from
 *
 * `@shared/**` and `@/lib/ui-editor/**`, and nothing else. This module is in the runtime bundle, and
 * `build-runtime.js`'s alias plugin fails hard on an `@/apps/workspace/...` import — which neither
 * `tsc` nor vitest can see, so the first sign of a wrong import is a broken build.
 */

/**
 * Every preset's id, spelled out rather than inferred from the table.
 *
 * Same reason as the look library's: `TranslationKey` is a closed union built from the catalogues, so
 * ``t(`storyInspector.cameraLens.${id}`)`` only typechecks when `id` is a literal union — which also
 * means a preset added here without its entry in **all three** catalogues fails to compile instead of
 * rendering a raw key at an author.
 */
export type StoryCameraLensPresetId = "blink" | "slowBlink" | "vignettePulse";

/** Which of the lens's two channels a gesture drives. A gesture drives exactly one. */
export type StoryCameraLensChannel = "shutter" | "vignette";

export type StoryCameraLensPreset = {
    id: StoryCameraLensPresetId;
    channel: StoryCameraLensChannel;
    /** The move in, the pause at full, and the move out. Milliseconds. */
    inMs: number;
    holdMs: number;
    outMs: number;
    easing: string;
    /** What the shutter or the vignette is drawn in. */
    color: string;
    /** How far the gesture goes: 1 is fully shut, or the preset's nominal vignette strength. */
    amount: number;
    /** `vignette` — where the mask starts and finishes fading, as percentages of the frame. */
    inner?: number;
    outer?: number;
};

export const STORY_CAMERA_LENS_PRESETS: readonly StoryCameraLensPreset[] = [
    {
        // 眨眼 — the ordinary one, and the one a scene reaches for most. Shutting is faster than
        // opening because that is what an eye does, and the pause at full is what makes it read as a
        // blink rather than as a flicker.
        id: "blink",
        channel: "shutter",
        inMs: 180,
        holdMs: 100,
        outMs: 220,
        easing: "easeInOut",
        color: "#000",
        amount: 1,
    },
    {
        // 慢眨眼 — the same gesture at the speed of somebody who is tired, or taking something in.
        // Roughly two and a half times the blink throughout, so it reads as the same eye moving
        // slowly rather than as a different effect.
        id: "slowBlink",
        channel: "shutter",
        inMs: 420,
        holdMs: 260,
        outMs: 520,
        easing: "easeInOut",
        color: "#000",
        amount: 1,
    },
    {
        // 暗角脉冲 — the frame closing in and letting go. Symmetric, because the effect is the
        // pressure rather than a direction, and it holds longer than it moves for the same reason.
        //
        // `inner` below `outer` is not optional: they are the stops of a `radial-gradient`, and stops
        // that run backwards make a gradient the browser drops whole — taking the mask, and with it
        // the entire effect, silently.
        id: "vignettePulse",
        channel: "vignette",
        inMs: 300,
        holdMs: 600,
        outMs: 300,
        easing: "easeInOut",
        color: "#000",
        amount: 0.72,
        inner: 44,
        outer: 78,
    },
];

export function getStoryCameraLensPreset(id: string | undefined): StoryCameraLensPreset | undefined {
    return STORY_CAMERA_LENS_PRESETS.find(preset => preset.id === id);
}

/** One leg of a gesture: where the lens ends up, and how long it takes to get there. */
export type StoryCameraLensStep = {
    props: StoryTransformProps;
    durationMs: number;
    easing: string;
};

/**
 * The three legs a gesture plays, or `null` when it names no preset this library knows.
 *
 * `null` and not a fallback gesture: a row pointing at an id that no longer exists asked for a
 * specific effect, and quietly substituting a different one would be a scene that plays wrong without
 * saying so. The compiler turns the `null` into a diagnostic instead.
 *
 * **Every leg names the same props in the same order**, including the ones that do not move. A
 * browser interpolates two keyframes only when they name the same properties; a leg that dropped
 * `shutterColor` because it had not changed would make the next one snap rather than animate, which
 * reads as the gesture being broken rather than as a keyframe bug. The dressing props are therefore
 * restated on every leg.
 *
 * The final leg returns the channel to zero, so a gesture leaves no residue: the eyes end open. That
 * is what makes it a gesture rather than a state — a row that wants the eyes to STAY shut writes
 * `shutter=1`, which is a different instruction and looks like one.
 */
export function resolveStoryCameraLensSteps(lens: StoryCameraLensRef): readonly StoryCameraLensStep[] | null {
    const preset = getStoryCameraLensPreset(lens.preset);
    if (!preset) {
        return null;
    }
    const easing = lens.easing ?? preset.easing;
    const amount = clamp01(lens.amount ?? preset.amount);
    const color = lens.color ?? preset.color;
    // `inner` above `outer` is not a wider vignette - it is a gradient whose stops run backwards,
    // which the browser drops whole. Ordered here rather than trusted from the row.
    const inner = clampPercent(lens.inner ?? preset.inner ?? 0);
    const outer = Math.max(inner, clampPercent(lens.outer ?? preset.outer ?? 100));
    const dressing: StoryTransformProps = preset.channel === "shutter"
        ? { shutterColor: color }
        : { vignetteColor: color, vignetteInner: `${inner}%`, vignetteOuter: `${outer}%` };
    const at = (value: number): StoryTransformProps => (preset.channel === "shutter"
        ? { ...dressing, shutter: value }
        : { ...dressing, vignette: value });
    return [
        { props: at(amount), durationMs: nonNegative(lens.inMs ?? preset.inMs), easing },
        { props: at(amount), durationMs: nonNegative(lens.holdMs ?? preset.holdMs), easing: "linear" },
        { props: at(0), durationMs: nonNegative(lens.outMs ?? preset.outMs), easing },
    ];
}

/** The props that put the lens back: both channels at rest. What `lens=none` writes. */
export function neutralStoryCameraLensProps(): StoryTransformProps {
    return { shutter: 0, vignette: 0 };
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function clampPercent(value: number): number {
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/**
 * A non-finite or negative duration is not a fast gesture.
 *
 * The row awaits the whole thing, so a negative leg is a tween that never finishes and a scene that
 * stops on that row - the same reasoning the retired `/screen` compile followed.
 */
function nonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}
