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
 * on stage — how strongly, in front of what — is already a runtime knob on the `vfx` payload
 * (`opacity`, `zIndex`, `fit`) and must never be duplicated as a seed parameter: duplicating one
 * would mean two answers to one question, and only the baked one would survive a change of mind
 * without a re-bake.
 *
 * ## Speed is baked, and `rate` is not the same question
 *
 * How fast the particles fall IS a pixel decision, so {@link WEATHER_PARAMS.fallSpeed} is here. The
 * first round said otherwise — that the playback `rate` was the author's "how fast", since the same
 * frames played faster cost nothing and keep the seam. That was true and still insufficient, for
 * three reasons the author hits immediately:
 *
 *  - `rate` speeds up the CLIP, so a twelve-second loop played at 3x repeats every four seconds, and
 *    the repeat is the one artefact this whole approach exists to avoid;
 *  - it moves everything, including the sway and the tumble, which is a fast-forward rather than
 *    heavier weather;
 *  - the inspector's live preview runs the field at its own phase and cannot show a playback rate at
 *    all, so the one control for speed was invisible in the one place speed is tuned.
 *
 * A baked fall speed has none of those: the loop is still twelve seconds, the sway is untouched, and
 * the preview shows exactly what will play. `rate` remains, unchanged, as what it always really was:
 * a playback trim for a clip — the author's own, or a baked one — at the moment it plays.
 *
 * ⚠ A `rate` set on the CREATE row survives a save; one set by a later `/rate` row does not (the
 * engine does not persist a runtime rate change). A baked speed has no such asymmetry, which is the
 * other reason it belongs here.
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
 * any value inside the range. `fallSpeed` is the one exception, and it is exact rather than
 * approximate: the renderer rounds it to a whole number because a fraction of a fall-length does not
 * close the loop, so its step of 1 is the grid the value actually lives on.
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
    | "fallSpeed"
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
    /**
     * How fast the field falls, as whole fall-lengths crossed per loop by the FARTHEST particles.
     *
     * Whole ones because that is what closes the loop: a particle has to be exactly where it started
     * when the last frame hands over to the first, and any fraction of a length is a jump. The near
     * field scales up from this by {@link depthSpread}, so raising the speed keeps the depth reading
     * it already had instead of flattening it.
     *
     * ⚠ Faster rain wants a longer {@link streak}: the smear is a shutter length in pixels, and it
     * does not follow the speed on its own. Nothing enforces this — a short streak at high speed is
     * a legitimate look (hail rather than drizzle) — but it is the first thing to reach for when
     * fast rain reads as a field of dashes.
     */
    fallSpeed: { min: 1, max: 12, step: 1, default: 1 },
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
     * Particles tumble: they turn in the plane and foreshorten across it, both on integer harmonics
     * so the loop still closes. Only worth anything on a seed whose particle has a shape to turn -
     * a disc looks identical at every angle, which is why this travels with {@link sprite}.
     */
    tumbles: boolean;
    /**
     * Particles are drawn from the petal bitmap rather than as an ellipse of light.
     *
     * Snow and rain are lights, and an ellipse with a soft falloff is not an approximation of them:
     * it is what they look like. A petal has an outline and tone across it, which is the half no
     * formula gives you and, at the size sakura draws at, the half that reads.
     */
    sprite?: boolean;
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
        params: ["density", "sizeNear", "sizeFar", "sway", "wind", "fallSpeed", "depthSpread"],
        defaults: { density: 160, sizeNear: 17, sizeFar: 2, sway: 52, depthSpread: 3 },
        tint: [255, 255, 255],
        streaked: false,
        tumbles: false,
    },
    rain: {
        id: "rain",
        params: ["density", "sizeNear", "sizeFar", "streak", "wind", "fallSpeed", "depthSpread"],
        // No sway: rain falls in straight parallel lines, which is also why `wind` reads as a tilt of
        // the whole field rather than as a wobble.
        defaults: { density: 170, sizeNear: 2.4, sizeFar: 1, streak: 30, sway: 0, depthSpread: 7 },
        tint: [198, 214, 255],
        streaked: true,
        tumbles: false,
    },
    sakura: {
        id: "sakura",
        params: ["density", "sizeNear", "sizeFar", "sway", "wind", "fallSpeed", "depthSpread"],
        defaults: { density: 90, sizeNear: 26, sizeFar: 5, sway: 110, depthSpread: 2 },
        tint: [255, 206, 214],
        streaked: false,
        tumbles: true,
        sprite: true,
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
 * The nearest value on a parameter's own increments: `min + n x step`, clamped to the range.
 *
 * This is the grid a CONTROL moves on, not one the renderer imposes - the renderer takes any value
 * inside the range, and the box in the inspector is how an author reaches a figure between two
 * increments. It lives here because the increments do: a slider that rounded to a step of its own
 * invention would disagree with the command line's hints about the same parameter.
 *
 * The result is rounded at the step's own precision, so a grid of halves answers `2.5` rather than
 * the `2.5000000000000004` the arithmetic leaves behind.
 */
export function snapWeatherParam(value: number, spec: WeatherParamSpec): number {
    if (!Number.isFinite(value)) {
        return spec.default;
    }
    const decimals = (String(spec.step).split(".")[1] ?? "").length;
    const stepped = spec.min + Math.round((value - spec.min) / spec.step) * spec.step;
    return Number(Math.min(spec.max, Math.max(spec.min, stepped)).toFixed(decimals));
}

/**
 * Whether a value already sits on {@link snapWeatherParam}'s grid.
 *
 * A stored value need not: a seed's own default may fall between two increments (rain's `sizeNear`
 * is 2.4 against a step of 1), and the inspector's box writes whatever was typed. A control that
 * quantises has to know, or it shows a value it cannot represent.
 */
export function onWeatherParamGrid(value: number, spec: WeatherParamSpec): boolean {
    return Math.abs(snapWeatherParam(value, spec) - value) < 1e-6;
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
 * The size a bake renders at: the stage's own.
 *
 * The stage size is the resolution the project was created at — asked once in the wizard and fixed
 * for the life of the project — and it is the coordinate system the clip is `cover`-fitted over. So
 * making the clip at that size is the only way the author sees the picture at the resolution they
 * chose.
 *
 * There used to be a 1920x1080 ceiling here, on the argument that weather is high-frequency noise
 * and stretching it costs nothing an eye can find. A 4K project's snow was therefore a 1080p clip
 * blown up, which is exactly the trade a 4K project was created to avoid. The stage's own limit
 * (`STAGE_SIZE_MAX`, 4K) is the only ceiling left.
 *
 * Density is stated per megapixel, so the same numbers describe the same weather at any size: a 4K
 * clip has four times the particles, not four times the spacing.
 */
export function weatherBakeSize(designWidth: number, designHeight: number): { width: number; height: number } {
    // Even dimensions: yuv420p subsamples chroma by two, and an odd edge is a whole extra code path
    // in every encoder that has to pad it.
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    return { width: even(designWidth), height: even(designHeight) };
}
