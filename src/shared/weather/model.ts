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
 * ⚠ {@link WEATHER_PARAMS.solidity} is the near miss, and it is worth stating why it is not a
 * duplicate of the payload's `opacity`. The payload's scales the finished OVERLAY, uniformly, at
 * playback, and cannot exceed 1. The seed's decides how much light one PARTICLE lays down before any
 * of that — so it can pass 1, where the falloff clips and the particle gains a solid core and a
 * tighter edge instead of merely getting brighter. Turning the overlay up cannot produce that,
 * because the wash and the petal are scaled together. One is how loud the effect is; the other is
 * what the effect is a picture of.
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
    | "flutter"
    | "solidity"
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
    /**
     * Radius in stage px of the nearest particles — the big, soft, out-of-focus ones.
     *
     * ⚠ Past about 32 the sakura seed is MAGNIFYING its sprite (the petal bitmap is 64px square, so
     * a radius of 32 already spans it) and its outline softens in proportion. That is a real cost
     * and not a reason to cap the range: a sparse field of a few large petals is a legitimate look,
     * the softness is largely paid off by {@link solidity} clipping the core flat, and a ceiling
     * that a seed's own default sat on would be the worse fault. See `petalSprite.ts`.
     */
    sizeNear: { min: 2, max: 96, step: 1, default: 17 },
    /** Radius in stage px of the farthest particles. */
    sizeFar: { min: 0.5, max: 24, step: 0.5, default: 2 },
    /** How far a particle drifts across its fall line, in stage px. */
    sway: { min: 0, max: 240, step: 4, default: 52 },
    /** Length of the motion smear along the fall line, in stage px. Rain's whole identity. */
    streak: { min: 0, max: 120, step: 2, default: 30 },
    /** Fall direction, in degrees off straight down. Negative leans left. */
    wind: { min: -60, max: 60, step: 1, default: 0 },
    /**
     * How fast the field falls, as fall-lengths crossed **per second** by the FARTHEST particles.
     *
     * ## Why per second and not per loop
     *
     * It was per loop until the loop stopped being a constant. Both readings give the same picture
     * while {@link loopSeconds} is twelve, and they part company the moment an author lengthens it:
     * per-loop, a longer clip is a slower one, so the control for "how long before it repeats"
     * silently doubles as a control for "how fast it falls" and neither can be set without the
     * other. Per second, lengthening the loop leaves the motion exactly where it was and buys only
     * what it should — a later repeat, and a slower floor.
     *
     * ## What the seam still costs here
     *
     * Each PARTICLE has to cross a whole number of fall-lengths per loop, or it is somewhere other
     * than where it started when the last frame hands over to the first. So its count is
     * `round(fallSpeed x loopSeconds)`, floored at one, and two consequences follow that no wording
     * can remove:
     *
     *  - **the slowest possible fall is one length per loop.** At a twelve-second loop that is
     *    1/12 of a length a second whatever this says; asking for less means asking for a longer
     *    loop. That is not a limitation of the control, it is what a seamless loop IS.
     *  - **the achievable speeds are a grid of 1/loopSeconds,** so a long loop is also a finer
     *    control. At twelve seconds this dial moves in twelfths however small its step is; at sixty
     *    it moves in sixtieths.
     *
     * The near field scales up from this by {@link depthSpread}, so raising the speed keeps the
     * depth reading it already had instead of flattening it.
     *
     * ⚠ Faster rain wants a longer {@link streak}: the smear is a shutter length in pixels, and it
     * does not follow the speed on its own. Nothing enforces this — a short streak at high speed is
     * a legitimate look (hail rather than drizzle) — but it is the first thing to reach for when
     * fast rain reads as a field of dashes.
     */
    fallSpeed: { min: 0.011, max: 1.5, step: 0.001, default: 0.17 },
    /**
     * How often a particle completes one flutter - one sway across its fall line, one turn of its
     * face - stated in TIMES PER SECOND.
     *
     * ## Why a rate in seconds rather than the harmonic the renderer wants
     *
     * The renderer needs a whole number of cycles per loop, and for three rounds that number was
     * drawn straight from `1..3`. Nothing marked it wrong, because nothing in the expression says how
     * long a loop IS - and a loop is {@link weatherLoopSeconds}, tens of seconds. So every petal in
     * the catalogue turned once every four to twelve seconds: 0.08 to 0.25 Hz, which is not a
     * flutter at all. It is a drift, and a drifting pale blob is a snowflake whatever shape it was
     * drawn from.
     *
     * Stating the rate in the unit an eye judges - cycles a second - and converting against the loop
     * length is what stops that returning. The conversion rounds to a whole number, so the seam is
     * exactly as safe as it was when the whole number was the input.
     */
    flutter: { min: 0.1, max: 3, step: 0.1, default: 0.8 },
    /**
     * How much light one particle lays down, against the depth ramp that would otherwise decide it
     * alone. 1 leaves that ramp exactly as it was.
     *
     * ## Why a particle needs this and the overlay's own `opacity` cannot give it
     *
     * Two multiplications were eating the picture before anything composited it: the petal bitmap
     * peaks at 216 of 255, and the depth gain runs 0.28 to 0.95. A median petal's brightest pixel
     * was therefore 133, and its average across the whole shape 82 — a third of full, which through
     * `screen` on anything but a dark scene is a haze rather than a petal. Turning the payload's
     * `opacity` up does not reach it: that scales the finished overlay, so the haze and the petal
     * come up together and the ratio between them never moves.
     *
     * ## Why it may exceed 1, which is the whole point
     *
     * Everything here is light accumulated in float and clamped once, when the frame is written. A
     * multiplier past 1 therefore does not simply brighten: the soft falloff CLIPS, and the particle
     * gains a flat saturated core with the ramp compressed into a narrower rim. Measured on sakura's
     * defaults, 1 to 2.5 doubles the frame's edge energy (0.245 to 0.498) while the lit area moves
     * by a fifteenth — so it is read as a sharper petal rather than a bigger glow. That is what
     * answers "the petals look transparent AND blurry", which are one complaint and not two.
     *
     * ## Why it also lifts the depth floor, and why it has to
     *
     * A plain multiplier cannot make the field opaque, and the reason is arithmetic rather than
     * taste. The depth ramp starts at 0.28, the sprite peaks at 216 of 255, so the brightest pixel
     * a FAR particle can produce is `0.28 x s x 0.847` — it needs an `s` of 4.2 just to reach white
     * at its very centre, and the mid-field is most of what an author is looking at. Measured: at
     * `s` 4 the lit area was 55% opaque, at 16 it was 82%, at 32 it was 87% and still climbing by
     * halves. So above 1 this also lerps the depth ramp toward 1, in proportion to how far up the
     * range it has been pushed. At the top every particle is equally solid and the petal is a
     * hard-edged cut-out.
     *
     * ⚠ Two things are spent to get there, and both are spent knowingly.
     *
     *  - **Depth's brightness cue.** At the top of the range the far field is as bright as the near
     *    one and only SIZE still says which is which. That is the price of the far field being able
     *    to reach opaque at all, and it is why the lift is proportional rather than switched on.
     *  - **The colour.** The clip is light on black composited with `screen`, and `screen` leaves the
     *    background alone in any channel where the source is not full. A pixel that covers what is
     *    behind it is therefore white in every channel BY DEFINITION - "opaque" and "pink" are
     *    mutually exclusive here, and no setting can have both. Around 8 a petal reads as solid with
     *    a pink rim; at the top it is a white cut-out.
     *
     * ⚠ It buys its sharpness by throwing away tone inside the core, which is what the bitmap
     * exists to carry.
     */
    solidity: { min: 0.2, max: 20, step: 0.1, default: 1 },
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
     * How much of a frame's interval the shutter is open for, in `[0, 1]`.
     *
     * Not one answer for every seed, because the seeds want opposite things of it. A rain streak IS
     * the smear - open the shutter for less than the whole frame and the streaks come apart into
     * dashes with gaps between them. A petal is a SHAPE, and a shape smeared over its own body
     * length is a smudge: measured at the top of the speed range, a fully open shutter costs the
     * sakura seed 28% of its edge energy and 44% of its peak brightness, so the faster an author
     * asks it to fall the less it looks like a petal. Half a frame is the film convention - a 180
     * degree shutter - and keeps the motion continuous without dissolving what is moving.
     */
    shutter: number;
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
        params: ["density", "sizeNear", "sizeFar", "sway", "wind", "fallSpeed", "flutter", "solidity", "depthSpread"],
        defaults: { density: 160, sizeNear: 17, sizeFar: 2, sway: 52, fallSpeed: 0.17, flutter: 0.35, depthSpread: 3 },
        tint: [255, 255, 255],
        streaked: false,
        tumbles: false,
        shutter: 0.5,
    },
    rain: {
        id: "rain",
        params: ["density", "sizeNear", "sizeFar", "streak", "wind", "fallSpeed", "solidity", "depthSpread"],
        // No sway and no flutter: rain falls in straight parallel lines, which is also why `wind`
        // reads as a tilt of the whole field rather than as a wobble. A drop has no face to turn.
        //
        // This one comes out at the shortest length there is, and rightly: a drop crosses the frame
        // twice a second and looks like every other drop, so there is nothing here an eye could
        // recognise coming round again.
        defaults: { density: 170, sizeNear: 2.4, sizeFar: 1, streak: 30, sway: 0, fallSpeed: 0.25, depthSpread: 7 },
        tint: [198, 214, 255],
        streaked: true,
        tumbles: false,
        // The whole frame. A streak with a gap in it is a dash, and a field of dashes is not rain.
        shutter: 1,
    },
    sakura: {
        id: "sakura",
        params: ["density", "sizeNear", "sizeFar", "sway", "wind", "fallSpeed", "flutter", "solidity", "depthSpread"],
        // Petals nearly twice the size the first rounds shipped. 26px of radius is 2.4% of a 1080p
        // frame's height, and at that size the sprite's outline - the notch that says cherry rather
        // than leaf - is below what the picture can carry, so it reads as a pale dot. A pale dot
        // falling slowly is snow, which is what the finished clips in fact looked like.
        //
        // Few of them, drifting: forty petals on a 1080p frame turning once every three seconds. It
        // is a deliberately sparser and calmer field than the other two seeds, so each petal is read
        // as an object rather than as texture - which is also why this is the seed that needs
        // `solidity` above 1. At 1 a petal of this size is a muddy wash with no edge.
        //
        // `solidity` 6 rather than 2. At 2 the core is solid and everything outside it is still a
        // gradient, because a plain multiple cannot lift the far field's 0.28 floor - see the
        // parameter. 6 puts about seventy per cent of a petal's interior at full, which is an object
        // rather than a wash, and stops short of the top of the range, which is a bare white cut-out.
        //
        // ⚠ It is also past the point where this seed is still PINK, and no default can avoid that.
        // `screen` leaves the background alone in any channel the source does not fill, so a pixel
        // that covers what is behind it is white by definition - and this tint's green sits at 81%
        // of its red, so the three channels arrive at full almost together. Measured across the lit
        // area: solidity 1 is 19% saturated, 3 is 11%, 6 is 6%. The only lever that widens the band
        // where a petal is both solid and coloured is a more saturated `tint` (at 255,150,178 the
        // same solidity 5 measures 17% rather than 7%), and that is a decision about what this seed
        // LOOKS like rather than about how it is rendered.
        //
        // The clip's length is not here and is not the author's: `weatherLoopSeconds` derives it
        // from this speed, and these values come out at twenty-four seconds - six crossings of the
        // frame by the far field, about 2 MiB at 1080p30.
        defaults: { density: 15, sizeNear: 48, sizeFar: 11, sway: 110, fallSpeed: 0.25, flutter: 0.3, solidity: 6, depthSpread: 2 },
        tint: [255, 206, 214],
        streaked: false,
        tumbles: true,
        sprite: true,
        shutter: 0.5,
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
 * The shortest a loop is allowed to be, in seconds.
 *
 * Twenty-four rather than the twelve this was for three rounds. Measured: a sixteen-second loop
 * costs 1.44x an eight-second one rather than 2x, because the cost is dominated by the first frames
 * of the sequence — so length is the cheapest way to buy a less obvious repeat, and a clip has to
 * survive a conversation that lasts minutes.
 */
const WEATHER_LOOP_MIN_SECONDS = 24;

/**
 * The longest, in seconds. Also the thing that decides how slowly weather can fall at all.
 *
 * At ninety a fall-length a loop is a screen every ninety seconds, which is eight times slower than
 * the twelve-second constant allowed and slower than anything an author has wanted. Past here the
 * bake time starts to be felt and the repeat is already invisible.
 */
const WEATHER_LOOP_MAX_SECONDS = 90;

/**
 * The fewest crossings of the frame a loop should contain.
 *
 * Every phase in the field repeats with the loop — the sway, the tumble, the hang — so a loop that
 * is one or two passes of the far field is a choreography an eye can learn even when it is long in
 * seconds. Three is where a field stops reading as a cycle and starts reading as weather.
 */
const WEATHER_LOOP_MIN_CROSSINGS = 3;

/** A flutter that completes fewer than this many cycles per loop is quantised by a large part of itself. */
const WEATHER_LOOP_MIN_FLUTTER_CYCLES = 2;

/**
 * How long this weather's clip runs before it repeats, in seconds — **derived, never asked for**.
 *
 * ## Why the author does not set this
 *
 * It was a control for exactly one round, and the round showed why it should not be. Length is not
 * a property of the weather an author is imagining; it is a consequence of how fast the weather
 * moves, and the author has nothing to judge it by. Worse, the two are not independent: the seam
 * requires each particle to cross a WHOLE number of fall-lengths per loop, so the length silently
 * decides both the slowest speed available (one length per loop) and the grid the speed lands on
 * (multiples of `1/length`). An author setting them separately is being asked to solve for a
 * constraint nothing shows them, and to re-solve it every time they touch the speed.
 *
 * ## What it is derived from
 *
 * A whole number of crossings of the far field, which is what makes the seam exact rather than
 * approximate: `fallSpeed x loopSeconds` is that whole number by construction, so the speed an
 * author states is the speed that renders, to the frame grid. The count is the smallest that
 * reaches {@link WEATHER_LOOP_MIN_SECONDS} — and at least {@link WEATHER_LOOP_MIN_CROSSINGS}, and
 * enough for {@link WEATHER_LOOP_MIN_FLUTTER_CYCLES} — capped at what fits in
 * {@link WEATHER_LOOP_MAX_SECONDS}.
 *
 * So slow weather gets a long clip because it needs one, fast weather gets a short one because a
 * long one would buy nothing, and neither is a question anybody was asked. A drift at the bottom of
 * the speed range comes out at ninety seconds; rain at a quarter of a screen a second comes out at
 * twenty-four.
 */
export function weatherLoopSeconds(params: ResolvedWeatherParams): number {
    // One crossing of the frame by the FARTHEST particles, which is the unit the seam counts in.
    const crossing = 1 / Math.max(WEATHER_PARAMS.fallSpeed.min, params.fallSpeed);
    const mostThatFit = Math.max(1, Math.floor(WEATHER_LOOP_MAX_SECONDS / crossing));
    const forLength = Math.ceil(WEATHER_LOOP_MIN_SECONDS / crossing);
    const forFlutter = Math.ceil(WEATHER_LOOP_MIN_FLUTTER_CYCLES / Math.max(1e-6, params.flutter) / crossing);
    // The cap outranks the three floors, and has to: at the bottom of the speed range one crossing
    // already takes longer than the longest clip allowed, and refusing to go under three would mean
    // refusing to render the slow drift the range exists for. A consequence worth naming because it
    // looks like a bug in a table: the length is NOT monotone in the speed. Whole crossings do not
    // vary smoothly, so 0.02 a second comes out at fifty seconds while 0.05 comes out at sixty. Both
    // are inside the bounds, both realise their speed exactly, and exactness is the thing being
    // bought - a length that moved smoothly would have to round the speed instead.
    const crossings = Math.min(
        mostThatFit,
        Math.max(WEATHER_LOOP_MIN_CROSSINGS, forLength, forFlutter),
    );
    return crossings * crossing;
}

/**
 * The same answer for a ref rather than resolved parameters.
 *
 * ⚠ Not seconds an author typed — see {@link weatherLoopSeconds}. Everything that needs a length or
 * a frame count goes through one of these two, so a preview and a bake cannot disagree about how
 * long the same effect is.
 */
export function weatherLoopSecondsOf(ref: WeatherSeedRef): number {
    return weatherLoopSeconds(resolveWeatherParams(ref));
}

/**
 * Frames in the clip one seed ref describes, at a given rate. Whole, because a phase grid must be.
 *
 * The derived length is a whole number of CROSSINGS rather than of seconds, so this rounds — by at
 * most half a frame, which moves the clip's realised duration and with it the realised fall speed by
 * a few hundredths of a per cent. The seam does not care either way: it is a property of the phases
 * being `i / frames`, whatever `frames` turns out to be.
 */
export function weatherFrameCountOf(ref: WeatherSeedRef, fps: number): number {
    return Math.max(1, Math.round(weatherLoopSecondsOf(ref) * fps));
}

/*
 * There is deliberately no frame-rate constant here.
 *
 * The rate is the project's (`app.vfx.frameRate`, see `@shared/types/vfx`) and reaches a bake
 * through `weatherSpecForStage`, which is the one place that turns a seed into a spec. A constant
 * beside the loop length would read as the answer and would be picked up by the next caller that
 * needed a number, which is exactly how a preview and a bake come to disagree about what the same
 * row looks like.
 */

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

/**
 * How much work a bake is allowed to spend on the encoder.
 *
 * **Not part of the clip.** Two tiers of the same spec are the same picture at the same size for the
 * same number of frames; what differs is how hard the encoder looked for a smaller way to say it.
 * That is why this is not a field of {@link WeatherBakeSpec} and never reaches
 * `weatherBakeKey` — an identity that included it would put the tier into the asset id a shipped
 * game asks for, and a game that asks for `final` while the pack carries `draft` finds nothing and
 * plays with no weather at all.
 *
 * The tiers, and the measurements behind them (1080p, 720 frames, this project's own renderer):
 *
 * - `final` — libvpx `-deadline good -cpu-used 2`. ~13 ms a frame.
 * - `draft` — libvpx `-deadline realtime -cpu-used 4`. ~3 ms a frame, ~30% more bytes, SSIM 0.9993
 *   against the same source's 0.9997.
 *
 * `realtime` is a different encoder, not a faster setting of the same one: no lookahead, so no
 * alt-ref frames and no temporal filtering, and a coarser mode search. The bytes it saves nothing on
 * do not matter here — a clip is ~1.5 MB against a budget measured in tens of megabytes — and the
 * quality it gives up is not visible on **this** content, which is sparse bright particles on black.
 *
 * ⚠ That last clause is the whole justification, and it is content-dependent. `realtime`'s coarser
 * partitioning is known to band on large smooth gradients. A seed that is fog, haze or god-rays
 * rather than particles has to be measured again before it is allowed to bake at `draft`.
 *
 * `-cpu-used 4` rather than 5 or 6 is also measured rather than picked: libvpx switches to its
 * non-RD decision path at 5, which costs the same wall-clock and 27% more bytes.
 */
export const WEATHER_BAKE_QUALITIES = ["draft", "final"] as const;

export type WeatherBakeQuality = typeof WEATHER_BAKE_QUALITIES[number];
