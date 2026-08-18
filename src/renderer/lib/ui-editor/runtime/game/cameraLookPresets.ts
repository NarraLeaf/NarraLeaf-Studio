/**
 * The camera look library — the colour grades a visual novel actually reaches for.
 *
 * A look is a CSS filter applied to the camera, which the engine puts over the **whole stage**:
 * backgrounds, sprites and videos are graded together while the dialogue box, the menus and the NVL
 * layer stay untouched. That is the whole reason the grade belongs to the camera and not to a
 * full-screen overlay object — an overlay would tint the words the player is reading.
 *
 * ## The one channel, and what it costs
 *
 * `Camera.darken` and `Displayable.filter` are the SAME channel: `darken(d)` is implemented as
 * `filter("brightness(1 - d)")`, so whichever runs last wins outright and the two never compose.
 * (The engine's own doc says so: "Because darken shares the single `filter` channel, combining it
 * with other filters means writing the full filter string yourself".) A preset that wanted to be
 * dark and expected the author to add `/camera darken` beside it would therefore be silently
 * cancelled by that row, or silently cancel it, depending on the order. So **every preset here folds
 * its own `brightness()` in**, and the inspector says out loud that picking a look replaces darken
 * rather than adding to it. `/camera reset` clears the filter (and with it any darken), which is why
 * this library needs no "clear grade" operation of its own.
 *
 * ## Why the recipes look the way they do
 *
 * A bare `hue-rotate()` is the trap. On an already-coloured image it rotates *every* hue, so a
 * `hue-rotate(200deg)` meant to read as moonlight turns blue hair khaki-olive and skin yellow-brown —
 * every source colour lands somewhere different, and none of them where the author aimed. The fix is
 * to flatten first: `grayscale(1) sepia(1)` collapses any source to ONE uniform sepia hue, so
 * everything after it operates on a constant colour that no longer depends on the picture. That is
 * also what makes a high `saturate()` safe in `moonlight` — it is amplifying one known hue rather
 * than arbitrary source colours, which is what the same value would do without the leading grayscale.
 *
 * ## Intensity
 *
 * `build(intensity)` interpolates each term from its own neutral (`saturate` 1, `sepia` 0,
 * `brightness` 1, `contrast` 1, `grayscale` 0, `blur` 0), so 1 is the preset's nominal strength and 0
 * is no grade at all (`"none"`).
 *
 * **The hue angle is never interpolated.** Walking `hue-rotate` toward 0° does not fade a tint, it
 * drags it through every wrong colour on the way; and scaling the `grayscale`/`sepia` pair below 1
 * is the same mistake wearing a disguise, because a partial flatten lets the fixed angle reach the
 * source's own hues again — the bare-hue-rotate trap, at half strength. So `moonlight` holds its
 * flatten and its angle constant and fades through `saturate` (how blue) and `brightness` (how dark)
 * instead: the path from a full moonlit blue down to a plain desaturated night never passes through
 * a colour the author did not ask for.
 *
 * ## Timing
 *
 * Every preset carries its own arrival time and easing, seeded into the row when it is picked and
 * overridden by any `d=` the author types. The speed is part of the look rather than a separate
 * taste: `mono` is a cut, `faint` is a slow slide whose duration IS the effect, and the same recipes
 * arriving at one shared speed would need the author to retype `d=` to get the thing the preset is
 * named after.
 *
 * ## The one grade that moves
 *
 * `hangover` does not settle — it sways, through {@link StoryCameraLookPreset.oscillate}, and so
 * compiles to a keyframed `camera.transform()` rather than a single `camera.filter()`. The sway is
 * finite because the row awaits it; the *state* it leaves behind (the blur, the lost saturation) does
 * persist, exactly like the still grades, until a `reset` or another look replaces it.
 */

/**
 * Every preset's id, spelled out rather than inferred from the table.
 *
 * Same reason as the Story Motion library: `TranslationKey` is a closed union built from the
 * catalogues, so `t(\`storyInspector.cameraLook.${id}\`)` only typechecks when `id` is a literal
 * union — which also means a preset added here without its entry in **all three** catalogues fails
 * to compile instead of rendering a raw key at an author.
 */
export type StoryCameraLookPresetId =
    | "memory"
    | "monologue"
    | "mono"
    | "moonlight"
    | "faint"
    | "hangover";

/**
 * An animated grade: a look that keeps moving instead of settling on one filter.
 *
 * Only `hangover` needs this, and it is a separate field rather than a second `build` because the
 * two compile to different engine calls — `camera.filter()` for a settled grade, a keyframed
 * `camera.transform()` for a moving one. A preset without it is a still image and stays one.
 *
 * **Finite by construction.** A `Transform` is awaited by the row that plays it, so an endless sway
 * would hang the scene on that row forever rather than looping under the dialogue — the same rule the
 * Story Motion library follows. `cycles` is therefore a count, never a flag.
 */
export type StoryCameraLookOscillation = {
    /**
     * One full cycle, in order. Every string here and the preset's resting `build()` output MUST list
     * the same filter functions in the same order — a browser interpolates two filter lists only when
     * they match, and a mismatched pair snaps instead of animating, which reads as the sway not
     * working rather than as a timing bug.
     */
    readonly steps: readonly string[];
    /** How long ONE step takes. The row's own duration, so `d=` is the tempo of the sway. */
    readonly stepMs: number;
    /** How many times the whole list runs before the look settles. */
    readonly cycles: number;
    /** How long the settle back to the resting grade takes. */
    readonly settleMs: number;
};

export type StoryCameraLookPreset = {
    /** Stable id — also the i18n key suffix (`storyInspector.cameraLook.<id>`) and the payload's value. */
    id: StoryCameraLookPresetId;
    /**
     * The intensity a freshly-picked preset lands on. Every preset opens at its nominal 1: the
     * verified recipes below ARE the look, and a preset that opened at half strength would be
     * teaching the author that the library is weaker than it is.
     */
    defaultIntensity: number;
    /**
     * How long this grade takes to come on, seeded into the row when the preset is picked.
     *
     * Per preset rather than one number for the whole library, because the timing is part of the
     * look and not a separate taste: consciousness goes slowly (`faint`), a cut to monochrome is a
     * cut and not a fade (`mono`), and a memory dissolves in somewhere between the two. A library
     * that graded correctly but arrived at the same speed every time would leave every author
     * retyping `d=` to get the effect the preset is named for.
     *
     * The author's own `d=` always wins; this only fills the slot they left empty.
     */
    defaultDurationMs: number;
    /**
     * The easing that arrival uses. `easeInOut` for grades that should feel like a settling change of
     * state, `linear` where any acceleration would read as the stage lurching rather than dimming.
     */
    defaultEasing: string;
    /** The CSS filter for this look at `intensity`. `"none"` at zero, which is a valid filter value. */
    build: (intensity: number) => string;
    /**
     * The sway, for the looks that have one. Absent means the grade arrives and holds.
     *
     * Takes the row's duration as well as the intensity, so the author's `d=` sets the tempo rather
     * than only the arrival — a sway is a rhythm, and one that ignored the row's timing would be the
     * one knob on this preset that does nothing.
     */
    oscillate?: (intensity: number, stepMs: number) => StoryCameraLookOscillation | null;
};

/** What the intensity control and the compiler both accept. Above 2 the grades stop being looks. */
export const STORY_CAMERA_LOOK_MIN_INTENSITY = 0;
export const STORY_CAMERA_LOOK_MAX_INTENSITY = 2;

/** The preset a `look` row with nothing chosen falls back to, and what the inspector opens on. */
export const STORY_CAMERA_LOOK_DEFAULT_PRESET_ID: StoryCameraLookPresetId = "memory";

export const STORY_CAMERA_LOOK_PRESETS: readonly StoryCameraLookPreset[] = [
    {
        // 回忆 — the colour drains, the warmth stays, the edges go soft. The warm shift is `sepia`
        // and not `hue-rotate`: sepia maps every hue onto one warm axis, so it cannot land a face
        // somewhere unintended the way a rotation can.
        id: "memory",
        defaultIntensity: 1,
        // A memory surfaces rather than cuts in, and it is the transition that says so: the same
        // recipe arriving instantly reads as a filter being switched on.
        defaultDurationMs: 900,
        defaultEasing: "easeInOut",
        build: intensity => {
            const k = clampIntensity(intensity);
            return k <= 0 ? NO_LOOK : filter([
                ["saturate", 1 - 0.65 * k],
                ["sepia", 0.4 * k],
                ["brightness", 1 + 0.1 * k],
                ["contrast", 1 - 0.1 * k],
                ["blur", 1 * k, "px"],
            ]);
        },
    },
    {
        // 心理独白 — the world recedes: colour drops out, the stage dims, the contrast tightens.
        //
        // It CANNOT do the darkened-edges half of an inner monologue. A CSS filter has no radial
        // falloff — it is a per-pixel colour map with no idea where the centre of the frame is — so
        // this preset is desaturation and dimming, full stop. The falloff is `/vignette`'s job, and
        // the two are authored as two rows. The UI hint says this rather than the preset faking it
        // with something that only looks like a vignette on a picture that happens to be dark at
        // the edges already.
        id: "monologue",
        defaultIntensity: 1,
        // Short enough to land before the line it introduces, slow enough not to read as a cut.
        defaultDurationMs: 700,
        defaultEasing: "easeInOut",
        build: intensity => {
            const k = clampIntensity(intensity);
            return k <= 0 ? NO_LOOK : filter([
                ["saturate", 1 - 0.5 * k],
                ["brightness", 1 - 0.18 * k],
                ["contrast", 1 + 0.08 * k],
            ]);
        },
    },
    {
        // 单色 — black and white. The brightness and contrast terms are not decoration: a straight
        // desaturation reads as a washed-out colour picture rather than as monochrome, because the
        // mid tones all collapse to the same grey. Pulling the exposure down and the contrast up is
        // what makes it read as a deliberate choice.
        id: "mono",
        defaultIntensity: 1,
        // Nearly a cut, and deliberately the fastest in the library: monochrome is a declaration, and
        // a slow fade to it looks like the colour is failing rather than like a choice. `linear`
        // because over this little time an ease is only visible as a hitch.
        defaultDurationMs: 260,
        defaultEasing: "linear",
        build: intensity => {
            const k = clampIntensity(intensity);
            return k <= 0 ? NO_LOOK : filter([
                ["grayscale", 1 * k],
                ["brightness", 1 - 0.1 * k],
                ["contrast", 1 + 0.15 * k],
            ]);
        },
    },
    {
        // 夜视/月光 — the flatten-first recipe, and the only preset that tints.
        //
        // `grayscale(1) sepia(1)` are held at full strength at EVERY intensity, and the angle never
        // moves; see this file's header for why fading either one would re-open the bare-hue-rotate
        // trap. `saturate(4)` is not a typo and must not be lowered: at 1.8 the stage renders as dull
        // grey rather than as night, because the sepia the flatten produces carries only about a
        // quarter of the chroma a saturated colour does, and the amplification is what puts it back.
        id: "moonlight",
        defaultIntensity: 1,
        // The slowest arrival in the library. Night falling is the one grade here that is a change of
        // place rather than a change of mind, and it is the only one an author is likely to run under
        // a line of dialogue instead of before one.
        defaultDurationMs: 1200,
        defaultEasing: "easeInOut",
        build: intensity => {
            const k = clampIntensity(intensity);
            return k <= 0 ? NO_LOOK : filter([
                ["grayscale", 1],
                ["sepia", 1],
                ["hue-rotate", 185, "deg"],
                ["saturate", 1 + 3 * k],
                ["brightness", 1 - 0.45 * k],
            ]);
        },
    },
    {
        // 昏迷/失焦 — the eyes stop focusing before they stop seeing, so the blur leads and the
        // exposure follows it down. The saturation drop rides along because colour is the first
        // thing to go; without it a blurred stage still reads as "out of focus" rather than as
        // "going under".
        id: "faint",
        defaultIntensity: 1,
        // The one preset whose duration IS the effect. Losing consciousness is gradual by definition,
        // so this grade applied quickly is not a fast faint, it is a smash cut to a blurred stage.
        // `easeIn` because it should creep and then go: a linear slide reads as a focus pull.
        defaultDurationMs: 2200,
        defaultEasing: "easeIn",
        build: intensity => {
            const k = clampIntensity(intensity);
            return k <= 0 ? NO_LOOK : filter([
                ["blur", 5 * k, "px"],
                ["brightness", 1 - 0.25 * k],
                ["saturate", 1 - 0.3 * k],
            ]);
        },
    },
    {
        // 宿醉 — the room will not hold still. The only preset in the library that MOVES: the blur and
        // the desaturation are the state, and the hue swinging either side of neutral is the sway.
        //
        // ## Why this one is allowed to `hue-rotate` when the header forbids it
        //
        // The header's rule is about rotations that mean to LAND somewhere — `moonlight` rotating to
        // 185° to arrive at blue, which only works from a flattened source. This one is not going
        // anywhere. It leaves neutral by a few degrees and comes straight back, so what the player
        // reads is the *deviation*, not the destination, and at ±7° every source hue moves by the same
        // small amount in the same direction. Nothing has to be flattened first because nothing is
        // being pinned to a target colour — which is also why this preset must never have its angle
        // opened up: past roughly 20° the swing stops reading as the room tilting and starts reading
        // as the picture changing colour, which is the trap the header describes.
        //
        // ## Why the resting grade carries `hue-rotate(0deg)`
        //
        // A browser interpolates one filter list into another only when the two name the same
        // functions in the same order; mismatched lists snap. The resting grade therefore lists a
        // no-op rotation it does not need, so that the sway's settle animates instead of jumping — the
        // exact failure that would look like "the parameters are right but the picture does not move".
        id: "hangover",
        defaultIntensity: 1,
        // One half-swing. The sway spends `cycles × steps × this` on top of it, so a long value here
        // is a row that holds the scene for a long time — see `oscillate`.
        defaultDurationMs: 650,
        defaultEasing: "easeInOut",
        build: intensity => {
            const k = clampIntensity(intensity);
            return k <= 0 ? NO_LOOK : filter([
                ["blur", 2.4 * k, "px"],
                ["saturate", 1 - 0.2 * k],
                ["brightness", 1 - 0.07 * k],
                ["contrast", 1 - 0.06 * k],
                ["hue-rotate", 0, "deg"],
            ]);
        },
        oscillate: (intensity, stepMs) => {
            const k = clampIntensity(intensity);
            if (k <= 0) {
                return null;
            }
            // The blur breathes with the swing rather than holding flat. A hue rotation on its own is
            // a colour flicker; it only reads as the room moving when the focus goes with it.
            const swing = (angle: number, blurScale: number) => filter([
                ["blur", 2.4 * k * blurScale, "px"],
                ["saturate", 1 - 0.2 * k],
                ["brightness", 1 - 0.07 * k],
                ["contrast", 1 - 0.06 * k],
                ["hue-rotate", angle * k, "deg"],
            ]);
            return {
                steps: [swing(7, 1.25), swing(-7, 1.25)],
                stepMs,
                // Two. A sway is finite here because the row awaits it (see the type's note), so every
                // extra cycle is dead time the author cannot write around; two is enough to read as a
                // rhythm rather than as a single wobble, and an author who wants more repeats the row.
                cycles: 2,
                settleMs: Math.round(stepMs * 0.8),
            };
        },
    },
];

export function getStoryCameraLookPreset(id: string | undefined): StoryCameraLookPreset | undefined {
    return STORY_CAMERA_LOOK_PRESETS.find(preset => preset.id === id);
}

/**
 * The CSS filter a `look` row resolves to, or `null` when it names nothing this library knows.
 *
 * `null` and not a fallback grade: a row pointing at a preset id that no longer exists asked for a
 * specific look, and quietly substituting a different one would be a scene that plays wrong without
 * saying so. The compiler turns the `null` into a diagnostic instead.
 */
export function resolveStoryCameraLook(presetId: string | undefined, intensity: number | undefined): string | null {
    const preset = getStoryCameraLookPreset(presetId);
    return preset ? preset.build(intensity ?? preset.defaultIntensity) : null;
}

/**
 * The sway a `look` row plays before it settles, or `null` when this grade does not move.
 *
 * Separate from {@link resolveStoryCameraLook} rather than folded into it because the two have
 * different consumers and only one of them can animate: the compiler asks for both, while the
 * editor's stage snapshot asks only for the resting grade — a preview is a still frame, and a
 * snapshot that tried to show the sway would be showing a moment the author cannot point at.
 */
/**
 * Whether this grade moves — and therefore whether the row's duration means anything.
 *
 * A still grade lands in one frame (see the compiler's `look` arm), so its timing fields are hidden
 * and nothing seeds them: a control that is present but never read is exactly what an author wastes
 * an afternoon on. A sway is the one grade that spends time, and for it the duration is the tempo.
 */
export function storyCameraLookSways(presetId: string | undefined): boolean {
    return Boolean(getStoryCameraLookPreset(presetId)?.oscillate);
}

export function resolveStoryCameraLookOscillation(
    presetId: string | undefined,
    intensity: number | undefined,
    stepMs: number,
): StoryCameraLookOscillation | null {
    const preset = getStoryCameraLookPreset(presetId);
    if (!preset?.oscillate) {
        return null;
    }
    // A non-positive step is a row asking for an instant sway, which is not a sway. Falling back to
    // the preset's own tempo keeps `/camera look hangover d=0` moving instead of silently landing on
    // the resting grade, which would read as the preset being broken.
    const step = Number.isFinite(stepMs) && stepMs > 0 ? stepMs : preset.defaultDurationMs;
    return preset.oscillate(intensity ?? preset.defaultIntensity, step);
}

/** A filter value that is valid CSS and does nothing — what intensity 0 means. */
const NO_LOOK = "none";

/**
 * Clamp to the range the whole feature agrees on.
 *
 * A non-finite intensity is the dangerous one: `saturate(NaN)` is not a value CSS can parse, and a
 * browser that cannot parse ONE function in a filter list drops the entire declaration — so a single
 * bad number does not weaken the grade, it removes it, silently and with no error anywhere.
 */
function clampIntensity(intensity: number): number {
    if (!Number.isFinite(intensity)) {
        return STORY_CAMERA_LOOK_MIN_INTENSITY;
    }
    return Math.min(STORY_CAMERA_LOOK_MAX_INTENSITY, Math.max(STORY_CAMERA_LOOK_MIN_INTENSITY, intensity));
}

type FilterTerm = readonly [name: string, value: number, unit?: string];

/**
 * The one function here whose argument is legally and meaningfully negative.
 *
 * An angle can swing either way, and `hangover` is built out of exactly that: clamping it at zero
 * would flatten half of every sway into a no-op, so the room would lurch one way and then sit still
 * — a bug that looks like a timing problem rather than like a clamp.
 */
const SIGNED_TERMS: ReadonlySet<string> = new Set(["hue-rotate"]);

/**
 * Print a filter list, clamping every term at its own floor.
 *
 * Negative arguments are invalid for all of these functions except {@link SIGNED_TERMS}, and an
 * intensity above 1 pushes the subtractive terms (`saturate(1 - 0.65k)`) below zero long before the
 * intensity cap does. The floor is here rather than at each call site because the cost of missing one
 * is the whole declaration being dropped, not the one term being wrong.
 */
function filter(terms: readonly FilterTerm[]): string {
    return terms
        .map(([name, value, unit]) =>
            `${name}(${round(SIGNED_TERMS.has(name) ? value : Math.max(0, value))}${unit ?? ""})`)
        .join(" ");
}

/** Three decimals is finer than any of these terms can be seen at, and keeps 1 - 0.65 out of the string. */
function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
