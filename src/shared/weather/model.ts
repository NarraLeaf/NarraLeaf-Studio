/**
 * The weather seeds: what an author chooses, and what a bake is keyed on.
 *
 * A weather effect is not an asset the author imported — it is a **seed plus parameters**, rendered
 * live while they tune it and baked into a clip when something actually needs to play one. The clip
 * never appears in the asset library, because the library holds what the author brought; a generated
 * overlay is a build product, and the author should never have to know one exists.
 *
 * ## What is in here and what is deliberately not
 *
 * Only the parameters that change PIXELS live here. Everything about how the finished overlay reads
 * on stage — how strongly, how fast, in front of what — is already a runtime knob on the `vfx`
 * payload (`opacity`, `rate`, `zIndex`, `fit`) and must never be duplicated as a seed parameter:
 * duplicating one would mean two answers to one question, and only the baked one would survive a
 * change of mind without a re-bake.
 *
 * `rate` is the important case. It is the author's "how fast", it is continuous, and it costs
 * nothing: the same frames played faster are still the same frames, so the loop stays seamless. What
 * IS baked is only the *spread* between near and far particles, which is a look rather than a speed.
 *
 * ⚠ A `rate` set on the CREATE row survives a save; one set by a later `/rate` row does not (the
 * engine does not persist a runtime rate change). So the author's speed control has to write the
 * create row, not emit a separate row.
 *
 * ## Why the ranges live beside the fields
 *
 * The inspector, the command line's value hints and the bake's own clamping all need the same
 * bounds. Stating them once here is what keeps a control from offering a value the renderer would
 * refuse — the same rule the transform vocabulary follows.
 */

/** The seeds a project can reach. Adding one is a table entry here plus a branch in the field builder. */
export const WEATHER_SEED_IDS = ["snow", "rain", "sakura"] as const;

export type WeatherSeedId = (typeof WEATHER_SEED_IDS)[number];

/**
 * One tunable number, with the bounds every surface shares.
 *
 * `step` is the inspector's increment, not a quantisation the renderer enforces — the renderer takes
 * any value inside the range. The one real quantisation in this system (the integer fall harmonics)
 * is internal and never reaches a control; see {@link WeatherFieldSpec}.
 */
export type WeatherParamSpec = {
    min: number;
    max: number;
    step: number;
    default: number;
};

/** Every numeric parameter a seed can carry. A seed declares which of these it uses. */
export type WeatherParamKey =
    | "density"
    | "sizeNear"
    | "sizeFar"
    | "sway"
    | "streak"
    | "wind"
    | "depthSpread";

/**
 * The parameter table.
 *
 * `density` is stated **per megapixel of covered area** rather than as a particle count, so the same
 * number means the same look whatever the project's stage size is — and so a wind angle, which makes
 * the covered area larger than the screen, does not silently thin the field out.
 */
export const WEATHER_PARAMS: Record<WeatherParamKey, WeatherParamSpec> = {
    /** Particles per megapixel of covered area. */
    density: { min: 10, max: 900, step: 10, default: 200 },
    /** Radius in stage px of the nearest particles — the big, soft, out-of-focus ones. */
    sizeNear: { min: 2, max: 48, step: 1, default: 17 },
    /** Radius in stage px of the farthest particles. */
    sizeFar: { min: 0.5, max: 12, step: 0.5, default: 2 },
    /** How far a particle drifts across its fall line, in stage px. */
    sway: { min: 0, max: 240, step: 4, default: 52 },
    /** Length of the motion smear along the fall line, in stage px. Rain's whole identity. */
    streak: { min: 0, max: 120, step: 2, default: 30 },
    /** Fall direction, in degrees off straight down. Negative leans left. */
    wind: { min: -60, max: 60, step: 1, default: 0 },
    /** How much faster the near field falls than the far field. 1 = everything falls together. */
    depthSpread: { min: 1, max: 8, step: 1, default: 3 },
};

/** An RGB triple in 0-255. Stored rather than a CSS string so the renderer never parses. */
export type WeatherTint = readonly [number, number, number];

export type WeatherSeedDefinition = {
    id: WeatherSeedId;
    /** Which parameters this seed exposes. Anything absent is fixed at its default and not shown. */
    params: readonly WeatherParamKey[];
    /** Per-seed overrides of the shared defaults — what "snow" means before anyone touches a slider. */
    defaults: Partial<Record<WeatherParamKey, number>>;
    tint: WeatherTint;
    /** Particles are drawn as a smear along the fall line rather than a disc. */
    streaked: boolean;
    /**
     * Particles tumble: the disc's cross-axis breathes on an integer harmonic, which reads as a petal
     * turning over without costing a per-pixel rotation.
     */
    tumbles: boolean;
};

/**
 * The seeds.
 *
 * Sakura's tint is deliberately warm and pale rather than a saturated pink. The overlay composites
 * with `screen`, which pushes toward white over a bright background, so a saturated petal loses its
 * colour exactly in the daylight scenes sakura is used for. A pale warm petal reads by its SHAPE
 * there, and shape is what `screen` cannot take away.
 */
export const WEATHER_SEEDS: Record<WeatherSeedId, WeatherSeedDefinition> = {
    snow: {
        id: "snow",
        params: ["density", "sizeNear", "sizeFar", "sway", "wind", "depthSpread"],
        defaults: { density: 160, sizeNear: 17, sizeFar: 2, sway: 52, depthSpread: 3 },
        tint: [255, 255, 255],
        streaked: false,
        tumbles: false,
    },
    rain: {
        id: "rain",
        params: ["density", "sizeNear", "sizeFar", "streak", "wind", "depthSpread"],
        // No sway: rain falls in straight parallel lines, which is also why `wind` reads as a tilt of
        // the whole field rather than as a wobble.
        defaults: { density: 170, sizeNear: 2.4, sizeFar: 1, streak: 30, sway: 0, depthSpread: 7 },
        tint: [198, 214, 255],
        streaked: true,
        tumbles: false,
    },
    sakura: {
        id: "sakura",
        params: ["density", "sizeNear", "sizeFar", "sway", "wind", "depthSpread"],
        defaults: { density: 90, sizeNear: 26, sizeFar: 5, sway: 110, depthSpread: 2 },
        tint: [255, 206, 214],
        streaked: false,
        tumbles: true,
    },
};

/** What a `/vfx` row stores when its source is a seed rather than a clip the author imported. */
export type WeatherSeedRef = {
    seed: WeatherSeedId;
    /** Only the parameters this author moved; everything else resolves from the seed's defaults. */
    params?: Partial<Record<WeatherParamKey, number>>;
};

/**
 * Every parameter of a seed, resolved and clamped — the single shape the renderer and the bake key
 * both read.
 *
 * Resolution order is shared default -> seed default -> author value, and the result is clamped
 * rather than rejected: these arrive from a stored document that an older or newer Studio may have
 * written, and a weather effect that refuses to render is worse than one that renders at the edge of
 * its range.
 */
export type ResolvedWeatherParams = Record<WeatherParamKey, number>;

/**
 * `fallback` rather than `spec.default`: a value that cannot be used has to land on what this SEED
 * would have shown, not on the table's shared default. Falling back to the shared one would quietly
 * turn a corrupt snow row into a differently-dense snow, which is the kind of wrong that reads as a
 * rendering bug rather than as bad data.
 */
function clamp(value: number, spec: WeatherParamSpec, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(spec.max, Math.max(spec.min, value));
}

export function resolveWeatherParams(ref: WeatherSeedRef): ResolvedWeatherParams {
    const seed = WEATHER_SEEDS[ref.seed] ?? WEATHER_SEEDS.snow;
    const out = {} as ResolvedWeatherParams;
    for (const key of Object.keys(WEATHER_PARAMS) as WeatherParamKey[]) {
        const spec = WEATHER_PARAMS[key];
        const seeded = seed.defaults[key] ?? spec.default;
        // A parameter the seed does not expose is pinned at its seeded value: a stored document may
        // still carry one (an author switched seeds), and honouring it would render a look no control
        // in front of them can explain.
        const stated = seed.params.includes(key) ? ref.params?.[key] : undefined;
        out[key] = clamp(stated ?? seeded, spec, seeded);
    }
    return out;
}

/**
 * The parameters the inspector shows for a seed, in the order it shows them.
 *
 * Ordered by what an author reaches for: how much of it, then how big, then how it moves.
 */
export function weatherParamsOf(id: WeatherSeedId): readonly WeatherParamKey[] {
    return WEATHER_SEEDS[id]?.params ?? [];
}

/**
 * The clip a bake produces, described independently of how it is produced.
 *
 * `frames` and `fps` are stated rather than derived at the last moment because the whole seam
 * guarantee rests on the renderer being asked for phases `i / frames` — an off-by-one here is the
 * one way to get a visible stutter out of a mathematically seamless field.
 */
export type WeatherBakeSpec = {
    ref: WeatherSeedRef;
    width: number;
    height: number;
    fps: number;
    frames: number;
};

/**
 * How long a loop runs, in seconds.
 *
 * Twelve rather than eight. Measured: a sixteen-second loop costs 1.44x an eight-second one rather
 * than 2x, because the cost is dominated by the first frames of the sequence — so length is the
 * cheapest way to buy a less obvious repeat, and eight seconds is short enough to be noticed during
 * a long conversation.
 */
export const WEATHER_LOOP_SECONDS = 12;

export const WEATHER_FPS = 30;

/**
 * The ceiling a bake renders at.
 *
 * The clip is `cover`-fitted over a stage whose coordinate system is the project's `designSize`, and
 * its content is high-frequency noise, so stretching it costs nothing an eye can find. Baking one
 * clip at the stage size (capped here) is therefore the whole story — a second size per target would
 * multiply the package for a difference nobody can see.
 */
export const WEATHER_MAX_BAKE_WIDTH = 1920;
export const WEATHER_MAX_BAKE_HEIGHT = 1080;

export function weatherBakeSize(designWidth: number, designHeight: number): { width: number; height: number } {
    const scale = Math.min(1, WEATHER_MAX_BAKE_WIDTH / designWidth, WEATHER_MAX_BAKE_HEIGHT / designHeight);
    // Even dimensions: yuv420p subsamples chroma by two, and an odd edge is a whole extra code path
    // in every encoder that has to pad it.
    const even = (n: number) => Math.max(2, Math.round(n * scale / 2) * 2);
    return { width: even(designWidth), height: even(designHeight) };
}
