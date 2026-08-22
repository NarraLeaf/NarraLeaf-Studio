/**
 * The weather renderer — one implementation, two hosts.
 *
 * The editor draws frames from this while the author drags a slider; the bake draws frames from this
 * and hands them to the encoder. They are the SAME function writing the SAME RGBA buffer, which is
 * the only way the preview can be trusted: a second implementation "for preview" would be a second
 * thing to keep in step, and the drift would show up as "it looked different in the editor" long
 * after anyone remembered there were two.
 *
 * ## The seam is structural
 *
 * Every time-varying term is a function of `phase = frame / frameCount` whose only dependence on
 * phase is `k * phase` with **integer k** — an integer number of fall-lengths, an integer flutter
 * harmonic and its integer octaves. At phase 1 every particle is therefore exactly where it was at
 * phase 0, so the last frame hands over to the first with nothing to interpolate. This is a property
 * of the construction, not a tuning: no parameter an author can move breaks it.
 *
 * Two things are worth naming because they look like they should break it and do not. `fallSpeed`
 * reaches into the along-fall term, and is admitted because it is only the BASE from which each
 * particle's whole number of fall-lengths is derived — the author's figure may be a half, the
 * particle's count never is. And the flutter's hang (below) displaces a particle along its own fall
 * line, but does it with a **zero-mean periodic** term at an integer harmonic, which returns to
 * where it started at phase 1 exactly as the sway does.
 *
 * ## What a flutter rate is measured in, and why it is not a harmonic
 *
 * A harmonic is cycles per LOOP, and a loop is twelve seconds. Three rounds of this file drew the
 * sway and tumble harmonics from `1..3` and nothing said that was wrong, because the expression
 * never mentions how long a loop is. It meant every petal took four to twelve seconds to complete
 * one turn — 0.08 to 0.25 Hz, a drift rather than a flutter, and a slow pale blob is a snowflake
 * whatever sprite it was drawn from. The rate is therefore stated in cycles per SECOND on the seed
 * and converted here, so the loop length is present in the arithmetic instead of implied by it.
 *
 * ## The flutter is one motion, not three independent ones
 *
 * A petal that sways on one sine, turns its face on a second and descends at a constant rate reads
 * as machinery, because nothing about it is a consequence of anything else. A real falling plate
 * couples them: the face it presents is what decides its drag, so it hangs when it shows its face
 * and drops when it turns edge-on, and it banks into the direction it is sliding. So one flutter
 * phase drives all three here — the sway across the fall line, the face turn, and a hang along the
 * fall line that is fastest exactly where the face is thinnest. That coupling is the difference
 * between a petal and a dot on a sine wave, and it costs one extra term.
 *
 * ## Wind rotates the field, it does not shear it
 *
 * A tilt done by drifting each particle sideways as it falls would break the seam (the drift per
 * loop is not generally a whole screen width) and would look wrong anyway — rain falls in parallel
 * lines, not along a shear. So the field is built in a basis aligned to the fall direction, wraps
 * along that axis, and is mapped back to the screen. The seam survives because the motion never
 * leaves that one axis.
 *
 * ## Everything is additive onto black
 *
 * There is no alpha channel and there will not be one: WebKit drops alpha from WebM (measured on
 * iOS and macOS Safari alike), so an overlay that relied on it would paint an opaque rectangle over
 * the stage on two of the six targets. Painting light onto black and compositing with `screen` is
 * what an overlay of falling light IS, and it behaves identically everywhere.
 */

import {
    weatherLoopSeconds,
    WEATHER_PARAMS,
    WEATHER_SEEDS,
    type ResolvedWeatherParams,
    type WeatherSeedId,
    type WeatherTint,
} from "./model";
import { petalSprite, PETAL_SPRITE_SIZE } from "./petalSprite";

/** One particle, in the basis aligned to the fall direction. */
type Particle = {
    /** Along-fall offset at phase 0, inside `[0, fallSpan)`. */
    u0: number;
    /** Across-fall position; constant apart from the sway. */
    v0: number;
    /** Whole fall-spans travelled per loop. Integer — this is what makes the seam exact. */
    fall: number;
    swayAmp: number;
    /**
     * Integer flutter harmonic: cycles per loop, converted from the seed's rate in cycles a second.
     *
     * ⚠ There are only a handful of these in any field, and that is forced: the seam needs a whole
     * number of cycles per loop, so a rate of 0.3 Hz over a 24-second loop can only be 5, 6, 7, 8 or
     * 9 - five rates for forty petals, fourteen of them identical. Particles sharing one do not
     * merely look similar, they sway at exactly the same rate for ever, and a phase offset does not
     * hide that: neighbours visibly keep time with each other. {@link Particle.swayHarm2} is what
     * breaks it.
     */
    swayHarm: number;
    /**
     * A second, faster integer harmonic mixed into the sway.
     *
     * Two sines at different rates make a shape neither of them has, and it is the SHAPE an eye
     * recognises, not the rate. Drawn independently of {@link Particle.swayHarm}, so two petals that
     * collide on the first almost never collide on both - five rates become fifty-odd waveforms, and
     * the field stops keeping time with itself. Still an integer, so the seam is untouched.
     */
    swayHarm2: number;
    swayPhase: number;
    /** Phase of the second mode, independent of the first. */
    swayPhase2: number;
    /** How much of the sway the second mode carries, relative to the first. */
    swayMix: number;
    /**
     * Integer harmonic of the face turn, and with it the hang.
     *
     * Its own rather than the sway's. The face and the drag it causes are coupled to each OTHER
     * because that is the physics; coupling them to the lateral swing as well made a petal that
     * hesitated at the exact end of every stroke, which is the mechanism showing through.
     */
    faceHarm: number;
    /** Phase of the face turn. */
    facePhase: number;
    /**
     * How far the flutter's hang displaces the particle along its own fall line, in px.
     *
     * Bounded at build time so the descent never actually reverses: the term is
     * `-bobAmp * sin(2 * flutter)`, so its steepest slope against phase is `bobAmp * 4pi * swayHarm`,
     * and holding that under the particle's own fall rate is what keeps a petal from visibly
     * floating upward at the top of its hang.
     */
    bobAmp: number;
    /** How far the petal banks into its sway, in radians. */
    rockAmp: number;
    /**
     * Integer harmonic of the SLOW reorientation, on top of the banking.
     *
     * One to three turns per loop is right for this one and wrong for the flutter: a petal drifts
     * round to face a new way over several seconds while it rocks several times a second, and having
     * both makes the two beat against each other instead of repeating visibly.
     */
    spinHarm: number;
    spinPhase: number;
    /** Radius across the fall line. */
    radius: number;
    /** Radius along the fall line — larger than `radius` only for a streaked seed. */
    length: number;
    /**
     * How much light this particle lays down: its depth ramp times the seed's `solidity`.
     *
     * May exceed 1, and is meant to. Everything accumulates in float and is clamped once when the
     * frame is written, so a gain past 1 saturates the particle's core and compresses its falloff
     * into a narrower rim - which is what makes a large petal read as a shape rather than a wash.
     */
    gain: number;
};

export type WeatherField = {
    seed: WeatherSeedId;
    tint: WeatherTint;
    tumbles: boolean;
    /** Drawn from the petal bitmap rather than as an ellipse of light. */
    sprite: boolean;
    particles: readonly Particle[];
    /** How much of a frame the shutter is open for; the seed's, see `WeatherSeedDefinition`. */
    shutter: number;
    /** Fall direction in screen space, as a unit vector. */
    dirX: number;
    dirY: number;
    /** Origin of the field basis in screen space. */
    originU: number;
    originV: number;
    fallSpan: number;
};

/**
 * Deterministic noise.
 *
 * The seed id and the author's parameters are the whole input, so the same project always bakes the
 * same clip — which is what lets a bake be content-addressed and cached at all. Nothing here may
 * reach for a clock or a global random source.
 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A stable integer seed for a given weather, so two seeds do not share a particle layout. */
function seedNumber(id: WeatherSeedId): number {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/**
 * The same weather, described for a picture `scale` times the size.
 *
 * Every parameter that is a LENGTH shrinks with the picture; `density`, being per unit of area,
 * shrinks with its square; and everything that is a rate, a count or an angle is untouched. The
 * result is that {@link buildWeatherField} lays out the same number of particles, each keeping its
 * share of the frame, crossing it in the same time and fluttering at the same rate - the stage's
 * composition photographed smaller, rather than a sparser weather that happens to fit.
 *
 * This exists because the inspector's preview draws at panel size and the bake draws at stage size,
 * and they have to be the same picture. Deriving the reduction in the component was how they came to
 * differ: a preview built at panel size from unscaled parameters is a WINDOW onto the stage, which
 * shows a dozen enormous particles where the clip has hundreds of small ones.
 *
 * ⚠ The result is not clamped to {@link WEATHER_PARAMS} and must not be: a scaled density routinely
 * exceeds the range an author may type, because the range describes a stage-sized picture.
 */
export function scaleWeatherParams(params: ResolvedWeatherParams, scale: number): ResolvedWeatherParams {
    const k = Math.max(1e-6, scale);
    return {
        ...params,
        density: params.density / (k * k),
        sizeNear: params.sizeNear * k,
        sizeFar: params.sizeFar * k,
        sway: params.sway * k,
        streak: params.streak * k,
    };
}

/**
 * Lay out the field for one stage size.
 *
 * The particle count comes from an areal density rather than a plain count, so the same `density`
 * means the same look at any stage size — and so tilting the field, which enlarges the area that has
 * to be covered, does not silently thin it out.
 */
export function buildWeatherField(
    seedId: WeatherSeedId,
    params: ResolvedWeatherParams,
    width: number,
    height: number,
): WeatherField {
    const seed = WEATHER_SEEDS[seedId] ?? WEATHER_SEEDS.snow;
    const rnd = mulberry32(seedNumber(seedId));

    const angle = (params.wind * Math.PI) / 180;
    // Fall direction: straight down at wind 0, leaning by `wind` degrees. Screen y grows downward.
    const dirX = Math.sin(angle);
    const dirY = Math.cos(angle);
    // Across-fall direction, the basis's second axis.
    const crossX = Math.cos(angle);
    const crossY = -Math.sin(angle);

    // The screen's extent in the field basis: project all four corners and take the span of each axis.
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]] as const) {
        const u = x * dirX + y * dirY;
        const v = x * crossX + y * crossY;
        uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
        vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }

    // Padding along the fall line, so a particle wraps entirely outside the visible band. The wrap is
    // the one discontinuity in the whole system and it must never happen where it can be seen.
    const maxRadius = Math.max(params.sizeNear, params.sizeFar);
    const pad = maxRadius + params.streak;
    const fallSpan = uMax - uMin + 2 * pad;
    // Across the fall line the field is EXTENDED by the sway amplitude rather than wrapped: a wrap
    // here would teleport a particle across the screen, while an extension merely means the outermost
    // particles spend part of the loop off-frame.
    const vSpan = vMax - vMin + 2 * params.sway;

    const count = Math.max(0, Math.round((params.density * fallSpan * vSpan) / 1_000_000));
    const spread = Math.max(1, Math.round(params.depthSpread));
    // Both rates are stated per SECOND and converted here against the loop this effect asked for,
    // which is what lets an author lengthen the clip without re-timing everything in it.
    const loopSeconds = Math.max(1, weatherLoopSeconds(params));
    // NOT rounded, unlike each particle's own count below. This is the base the depth scales, and
    // rounding it made the smallest change an author could ask for a doubling of the whole field.
    const baseFall = Math.max(0.001, params.fallSpeed) * loopSeconds;
    // Cycles a second into cycles a loop. The rounding is where the seam is bought: a whole number
    // of cycles per loop returns every particle to its starting attitude at phase 1.
    const flutterHarm = Math.max(1, Math.round(params.flutter * loopSeconds));
    // Whether this seed flutters at all. Listing the rate is how a seed says so, and rain does not:
    // a drop has no face to turn, so it has no drag cycle and must not hang. It falls at one speed,
    // which is also the only speed its fixed-length streak is drawn for - a drop that slowed while
    // its smear stayed the same length would be a streak that had come loose from its own motion.
    const flutters = seed.params.includes("flutter");
    // How far above the neutral 1 the author has pushed the solidity, as a fraction of the room
    // there is. Nothing below 1 lifts anything: dimmer than the ramp is just dimmer.
    const push = Math.max(0, Math.min(1, (params.solidity - 1) / (WEATHER_PARAMS.solidity.max - 1)));
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
        // 0 = far, 1 = near. Drives size, brightness and fall rate together, which is what reads as
        // depth: a big flake close to the lens is also the one that crosses the frame fastest.
        const depth = rnd();
        const radius = params.sizeFar + depth * (params.sizeNear - params.sizeFar);
        // Speed times the depth ratio, rounded to a whole number of lengths - THIS is where the seam
        // needs a whole number, not on the author's figure. Multiplying rather than adding is what
        // keeps `depthSpread` meaning the same thing at every speed: the near field stays `spread`
        // times the far field instead of the ratio flattening as the speed goes up.
        const fall = Math.max(1, Math.round(baseFall * (1 + depth * (spread - 1))));
        // Each particle a little off the seed's rate, so the field does not pulse in unison. Phase
        // alone would not do it: particles sharing a rate stay in step for ever, they merely start
        // apart. Kept inside a third either way, because a petal drifting at half its neighbour's
        // rate reads as two different weathers in one picture.
        const harm = Math.max(1, Math.round(flutterHarm * (0.72 + rnd() * 0.56)));
        // The second mode, well clear of the first so the sum is a new shape rather than a fatter
        // version of the same one. `+ 1` on a collision rather than a redraw: a redraw could collide
        // again, and one cycle per loop is already a different waveform.
        let harm2 = Math.max(1, Math.round(harm * (SWAY_SECOND_RATIO_MIN + rnd() * SWAY_SECOND_RATIO_SPAN)));
        if (harm2 === harm) {
            harm2 = harm + 1;
        }
        // The face turns at its own rate, drawn from the seed's band like the sway but independently
        // of it, so a petal does not hesitate at the exact end of every lateral stroke.
        const faceHarm = Math.max(1, Math.round(flutterHarm * (0.72 + rnd() * 0.56)));
        particles.push({
            u0: rnd() * fallSpan,
            v0: rnd() * vSpan,
            fall,
            swayAmp: params.sway * (0.4 + rnd() * 0.6),
            swayHarm: harm,
            swayHarm2: harm2,
            swayPhase: rnd(),
            swayPhase2: rnd(),
            // Scaled down by how much faster the second mode is, so it contributes a comparable
            // SPEED rather than a comparable distance - an equal-amplitude fast mode is a jitter,
            // not a flutter.
            swayMix: (SWAY_SECOND_WEIGHT * harm) / harm2,
            faceHarm,
            facePhase: rnd(),
            // A fraction of the distance one FACE cycle covers, because that is the cycle it rides
            // on. `HANG_FRACTION` is under the 1/4pi that would let the hang out-run the fall
            // itself; see the constant.
            bobAmp: flutters ? (HANG_FRACTION * fall * fallSpan) / faceHarm : 0,
            rockAmp: 0.3 + rnd() * 0.5,
            spinHarm: 1 + Math.floor(rnd() * 3),
            spinPhase: rnd(),
            radius,
            length: seed.streaked ? Math.max(radius, params.streak * (0.35 + depth * 0.65)) : radius,
            // The depth ramp, lifted toward 1 as the author pushes for opacity and then scaled by
            // what they asked for. Not clamped: the accumulator is float and the clamp happens once
            // at write-out, so a gain above 1 clips the falloff into a flat core rather than
            // overflowing anything. The LIFT is what lets the far field reach opaque at all - a
            // plain multiple leaves it at 0.28 of whatever the near field is, which measured 55%
            // opaque at solidity 4 and was still short of 90% at 32.
            gain: liftedGain(depth, params.solidity, push),
        });
    }

    return {
        seed: seedId,
        tint: seed.tint,
        tumbles: seed.tumbles,
        sprite: seed.sprite ?? false,
        shutter: seed.shutter,
        particles,
        dirX,
        dirY,
        originU: uMin - pad,
        originV: vMin - params.sway,
        fallSpan,
    };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/**
 * How many instants are integrated into one output frame.
 *
 * A frame is not an instant. A camera's shutter is open for a slice of time and what lands on the
 * film is the *integral* over that slice, which is why real rain photographs as streaks and why a
 * field of instantaneous dots reads as strobing rather than as falling. Eight sub-steps is enough
 * for the fastest thing here (a near raindrop crosses about twenty pixels per frame, so the samples
 * overlap) and it is affordable for a reason worth stating: **rasterising is about 2% of a bake, the
 * encoder is the other 98%**. Eight times the cheap half is a few percent on the whole.
 *
 * The editor's live preview used to turn this down to one and no longer does. Turning it down looks
 * free - the blur is not a parameter anybody is there to tune - but it is a function of SPEED, so a
 * preview without it stayed crisp exactly as an author raised the slider that provokes it. At panel
 * size the honest answer costs a few milliseconds a frame against a budget of thirty-three, so there
 * was never anything to buy. How much of a frame the shutter is open for is the seed's own
 * (`WeatherSeedDefinition.shutter`) and is shared by both hosts for the same reason.
 */
export const WEATHER_SUB_STEPS = 8;

/**
 * How much of one flutter cycle's travel the hang moves a particle along its own fall line.
 *
 * The ceiling is arithmetic rather than taste. The term is `-bobAmp * sin(2 * flutter)` with
 * `bobAmp = k * fall * fallSpan / harm`, so its steepest slope against phase is `k * 4pi` times the
 * particle's own fall rate. At `k = 1/4pi` the hang exactly cancels the fall for an instant and
 * beyond it the particle climbs, which no falling thing does. 0.06 sits under that with room to
 * spare and still varies the descent rate by about seven to one across a cycle, which is what
 * "hangs, then drops" has to look like to read as one.
 */
const HANG_FRACTION = 0.06;

/**
 * How much of the sway the second mode carries at equal rate, before the rate scaling.
 *
 * A single sine is a pendulum, and a field of pendulums reads as a mechanism - the more so because
 * the seam allows only a handful of rates, so most of the pendulums are the SAME pendulum. A second
 * sine at an unrelated rate is what makes each particle's path its own: the sum of two harmonics is
 * a shape neither has, and a shape is what an eye matches against its neighbour.
 *
 * The actual weight each particle uses is this times `harm / harm2`, so a mode three times faster
 * moves a third as far and contributes a comparable SPEED. Equal amplitudes would make the fast mode
 * a jitter riding on a swing rather than part of one motion.
 */
const SWAY_SECOND_WEIGHT = 0.9;

/** How much faster the second mode is than the first, as a range of ratios. Clear of 1, so it never reads as one thicker sine. */
const SWAY_SECOND_RATIO_MIN = 1.7;
const SWAY_SECOND_RATIO_SPAN = 1.6;

/**
 * How much light one particle lays down: the depth ramp, lifted toward flat, times the solidity.
 *
 * The ramp alone runs 0.28 to 0.95 and is the seed's depth cue. Multiplying it cannot make the far
 * end opaque, only the near end - so `push` lerps the whole ramp toward 1 in proportion to how far
 * up its range the solidity has been driven. At the top every particle is equally solid, which
 * costs the brightness half of the depth cue and keeps the size half. That trade is the only way
 * "as opaque as it goes" can mean the field rather than its nearest few particles.
 */
function liftedGain(depth: number, solidity: number, push: number): number {
    const shade = 0.28 + depth * 0.67;
    return (shade + (1 - shade) * push) * solidity;
}

/** Positive remainder. The hang can carry the along-fall term below zero, where `%` alone answers negative. */
function wrap(value: number, span: number): number {
    return ((value % span) + span) % span;
}

export type WeatherRenderer = {
    /** RGBA, four bytes per pixel, alpha opaque. Rewritten by every {@link WeatherRenderer.render}. */
    readonly frame: Uint8ClampedArray;
    /** Draw the loop at `phase` in `[0, 1)`. */
    render(phase: number): void;
};

/**
 * Add one ellipse of light, oriented along the fall direction, into the accumulator.
 *
 * Additive with a squared falloff: the core reads solid and the rim dies out without leaving the ring
 * a linear falloff produces. It accumulates in **float** rather than saturating per write, so two
 * particles crossing do not clip early — the clamp happens once, when the frame is written out.
 */
function addParticle(
    acc: Float32Array,
    width: number,
    height: number,
    cx: number,
    cy: number,
    across: number,
    along: number,
    dirX: number,
    dirY: number,
    gain: number,
    tint: WeatherTint,
): void {
    const bound = Math.max(across, along);
    const x0 = Math.max(0, Math.floor(cx - bound));
    const x1 = Math.min(width - 1, Math.ceil(cx + bound));
    const y0 = Math.max(0, Math.floor(cy - bound));
    const y1 = Math.min(height - 1, Math.ceil(cy + bound));
    if (x1 < x0 || y1 < y0) {
        return;
    }
    const invAlong = 1 / (along * along);
    const invAcross = 1 / (across * across);
    // The basis vectors again, so the ellipse tilts with the field instead of staying screen-aligned.
    const crossX = dirY;
    const crossY = -dirX;
    const [tr, tg, tb] = tint;

    for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        let index = (y * width + x0) * 3;
        for (let x = x0; x <= x1; x++, index += 3) {
            const dx = x - cx;
            const du = dx * dirX + dy * dirY;
            const dv = dx * crossX + dy * crossY;
            const d2 = du * du * invAlong + dv * dv * invAcross;
            if (d2 >= 1) {
                continue;
            }
            const falloff = (1 - d2) * (1 - d2) * gain;
            acc[index] += tr * falloff;
            acc[index + 1] += tg * falloff;
            acc[index + 2] += tb * falloff;
        }
    }
}

/**
 * Add one petal, turned and foreshortened, into the accumulator.
 *
 * The petal's own frame is `(a, b)`: `a` runs base-to-tip, `b` across. A pixel is transformed into
 * that frame and the bitmap is sampled bilinearly, which is what keeps a 10px far petal from
 * reading as a staircase.
 *
 * `squash` is the tumble across the plane - the petal turning its face away - applied to the across
 * axis only. It never reaches zero, because a petal exactly edge-on for one frame reads as a
 * flicker rather than as a turn.
 */
function addPetal(
    acc: Float32Array,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number,
    angle: number,
    squash: number,
    gain: number,
    tint: WeatherTint,
): void {
    const sprite = petalSprite();
    // The petal is drawn into a square of side 2*radius, so its half-diagonal bounds every rotation.
    const bound = Math.ceil(radius * Math.SQRT2);
    const x0 = Math.max(0, Math.floor(cx - bound));
    const x1 = Math.min(width - 1, Math.ceil(cx + bound));
    const y0 = Math.max(0, Math.floor(cy - bound));
    const y1 = Math.min(height - 1, Math.ceil(cy + bound));
    if (x1 < x0 || y1 < y0) {
        return;
    }
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const invAlong = 1 / radius;
    const invAcross = 1 / (radius * squash);
    const half = PETAL_SPRITE_SIZE / 2;
    const [tr, tg, tb] = tint;
    const scale = gain / 255;

    for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        let index = (y * width + x0) * 3;
        for (let x = x0; x <= x1; x++, index += 3) {
            const dx = x - cx;
            // Into the petal's frame, in units where the sprite spans -1..1 on both axes.
            const a = (dx * sin + dy * cos) * invAlong;
            const b = (dx * cos - dy * sin) * invAcross;
            if (a <= -1 || a >= 1 || b <= -1 || b >= 1) {
                continue;
            }
            const sx = (b + 1) * half - 0.5;
            const sy = (a + 1) * half - 0.5;
            const ix = Math.floor(sx);
            const iy = Math.floor(sy);
            const fx = sx - ix;
            const fy = sy - iy;
            const ix1 = ix + 1;
            const iy1 = iy + 1;
            // Out-of-range taps read as zero, which is the right value: outside the sprite is outside
            // the petal, and clamping would smear its edge row across the bounding box instead.
            const p00 = ix >= 0 && ix < PETAL_SPRITE_SIZE && iy >= 0 && iy < PETAL_SPRITE_SIZE ? sprite[iy * PETAL_SPRITE_SIZE + ix] : 0;
            const p10 = ix1 >= 0 && ix1 < PETAL_SPRITE_SIZE && iy >= 0 && iy < PETAL_SPRITE_SIZE ? sprite[iy * PETAL_SPRITE_SIZE + ix1] : 0;
            const p01 = ix >= 0 && ix < PETAL_SPRITE_SIZE && iy1 >= 0 && iy1 < PETAL_SPRITE_SIZE ? sprite[iy1 * PETAL_SPRITE_SIZE + ix] : 0;
            const p11 = ix1 >= 0 && ix1 < PETAL_SPRITE_SIZE && iy1 >= 0 && iy1 < PETAL_SPRITE_SIZE ? sprite[iy1 * PETAL_SPRITE_SIZE + ix1] : 0;
            const top = p00 + (p10 - p00) * fx;
            const bottom = p01 + (p11 - p01) * fx;
            const value = (top + (bottom - top) * fy) * scale;
            if (value <= 0) {
                continue;
            }
            acc[index] += tr * value;
            acc[index + 1] += tg * value;
            acc[index + 2] += tb * value;
        }
    }
}

/** One instant of the field, accumulated at `weight`. The sub-steps of a frame share one accumulator. */
function accumulateInstant(
    acc: Float32Array,
    field: WeatherField,
    width: number,
    height: number,
    phase: number,
    weight: number,
): void {
    const twoPi = Math.PI * 2;
    const { dirX, dirY, fallSpan, originU, originV, tint } = field;
    const crossX = dirY;
    const crossY = -dirX;

    for (const p of field.particles) {
        // The face turn, and with it the drag: these two are one phase because that IS the physics.
        // The lateral sway is deliberately NOT on it - see `faceHarm`.
        const facing = twoPi * (p.faceHarm * phase + p.facePhase);
        // How much of its face the particle is showing, 0 = edge on, 1 = flat on. Also its drag.
        const face = Math.abs(Math.cos(facing));

        // Along the fall line: an integer number of spans per loop, wrapped out of sight, less the
        // hang. The hang is steepest against the fall exactly where `face` is largest, so the
        // particle slows as it turns its face down and drops away as it goes edge-on. Inside the
        // wrap rather than outside it, so a hang can never carry a particle past the padded band and
        // into view at the moment it repeats.
        const u = originU + wrap(p.u0 + phase * p.fall * fallSpan - p.bobAmp * Math.sin(2 * facing), fallSpan);
        // Across it: two modes at unrelated integer rates, so the path is this particle's own rather
        // than one of the five the seam allows. Both periodic, so phase 1 is phase 0's position.
        const sway = (Math.sin(twoPi * (p.swayHarm * phase + p.swayPhase))
            + p.swayMix * Math.sin(twoPi * (p.swayHarm2 * phase + p.swayPhase2)))
            / (1 + p.swayMix);
        const v = originV + p.v0 + p.swayAmp * sway;

        const cx = u * dirX + v * crossX;
        const cy = u * dirY + v * crossY;

        if (field.sprite) {
            // The petal banks INTO its sway rather than spinning through it - a petal sliding left
            // leans left - and drifts slowly round on top of that, so its attitude never repeats at
            // the rate its position does. The angle starts from the fall direction, so a tilted
            // field carries its petals with it instead of leaving them upright in a slanted wind.
            const bank = p.rockAmp * Math.sin(twoPi * (p.swayHarm * phase + p.swayPhase));
            const drift = twoPi * (p.spinHarm * phase + p.spinPhase);
            const angle = Math.atan2(dirX, dirY) + bank + drift;
            // Never quite zero: a petal exactly edge-on for one frame reads as a flicker, not a turn.
            addPetal(acc, width, height, cx, cy, p.radius, angle, 0.3 + 0.7 * face, p.gain * weight, tint);
            continue;
        }

        const across = field.tumbles ? p.radius * (0.35 + 0.65 * face) : p.radius;
        addParticle(acc, width, height, cx, cy, across, p.length, dirX, dirY, p.gain * weight, tint);
    }
}

/**
 * A renderer bound to one field and one size.
 *
 * An object rather than a bare function because both hosts draw hundreds of frames in a row and the
 * accumulator is worth keeping: at 1080p it is 25 MB, which is nothing to hold and a great deal to
 * allocate three hundred and sixty times.
 *
 * `subSteps` is the one knob, and the editor is expected to turn it down. A live preview is judged
 * while it moves — the eye supplies its own persistence — and a slider that redraws at one sample is
 * the difference between a preview that keeps up with a drag and one that does not.
 */
export function createWeatherRenderer(
    field: WeatherField,
    width: number,
    height: number,
    options: { frames: number; subSteps?: number },
): WeatherRenderer {
    // The shutter is a fraction of a frame, so the renderer has to be told how long a frame IS in
    // phase units. Both hosts pass the same loop length for the same reason they share this file: a
    // preview integrating over a different shutter than the bake would be a preview of something else.
    const frames = Math.max(1, Math.round(options.frames));
    const shutter = field.shutter;
    const subSteps = Math.max(1, Math.round(options.subSteps ?? WEATHER_SUB_STEPS));
    const acc = new Float32Array(width * height * 3);
    const frame = new Uint8ClampedArray(width * height * 4);
    // Alpha is opaque everywhere and never written again: the clip has no transparency by design, and
    // a canvas preview of a zero-alpha buffer would simply be invisible.
    for (let i = 3; i < frame.length; i += 4) {
        frame[i] = 255;
    }

    return {
        frame,
        render(phase: number) {
            acc.fill(0);
            const weight = 1 / subSteps;
            for (let step = 0; step < subSteps; step++) {
                // Sub-phases spread across ONE frame's shutter. Every one of them is still a phase, so
                // every one is still periodic: a frame rendered at phase 1 integrates the same set of
                // instants as the frame at phase 0, and the seam survives the blur.
                accumulateInstant(acc, field, width, height, phase + (shutter * step) / (subSteps * frames), weight);
            }
            for (let pixel = 0, rgb = 0, rgba = 0; pixel < width * height; pixel++, rgb += 3, rgba += 4) {
                frame[rgba] = acc[rgb];
                frame[rgba + 1] = acc[rgb + 1];
                frame[rgba + 2] = acc[rgb + 2];
            }
        },
    };
}
