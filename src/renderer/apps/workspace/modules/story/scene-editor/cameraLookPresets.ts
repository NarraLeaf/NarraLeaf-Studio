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
    | "faint";

export type StoryCameraLookPreset = {
    /** Stable id — also the i18n key suffix (`storyInspector.cameraLook.<id>`) and the payload's value. */
    id: StoryCameraLookPresetId;
    /**
     * The intensity a freshly-picked preset lands on. Every preset opens at its nominal 1: the
     * verified recipes below ARE the look, and a preset that opened at half strength would be
     * teaching the author that the library is weaker than it is.
     */
    defaultIntensity: number;
    /** The CSS filter for this look at `intensity`. `"none"` at zero, which is a valid filter value. */
    build: (intensity: number) => string;
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
        build: intensity => {
            const k = clampIntensity(intensity);
            return k <= 0 ? NO_LOOK : filter([
                ["blur", 5 * k, "px"],
                ["brightness", 1 - 0.25 * k],
                ["saturate", 1 - 0.3 * k],
            ]);
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
 * Print a filter list, clamping every term at its own floor.
 *
 * Negative arguments are invalid for all of these functions, and an intensity above 1 pushes the
 * subtractive terms (`saturate(1 - 0.65k)`) below zero long before the intensity cap does. The floor
 * is here rather than at each call site because the cost of missing one is the whole declaration
 * being dropped, not the one term being wrong.
 */
function filter(terms: readonly FilterTerm[]): string {
    return terms
        .map(([name, value, unit]) => `${name}(${round(Math.max(0, value))}${unit ?? ""})`)
        .join(" ");
}

/** Three decimals is finer than any of these terms can be seen at, and keeps 1 - 0.65 out of the string. */
function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
