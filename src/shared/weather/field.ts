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
 * phase is `k * phase` with **integer k** — an integer number of fall-lengths, an integer sway
 * harmonic, an integer tumble harmonic. At phase 1 every particle is therefore exactly where it was
 * at phase 0, so the last frame hands over to the first with nothing to interpolate. This is a
 * property of the construction, not a tuning: no parameter an author can move breaks it, which is
 * why the "speed" they see is the playback rate rather than a fall distance.
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
    WEATHER_SEEDS,
    type ResolvedWeatherParams,
    type WeatherSeedId,
    type WeatherTint,
} from "./model";

/** One particle, in the basis aligned to the fall direction. */
type Particle = {
    /** Along-fall offset at phase 0, inside `[0, fallSpan)`. */
    u0: number;
    /** Across-fall position; constant apart from the sway. */
    v0: number;
    /** Whole fall-spans travelled per loop. Integer — this is what makes the seam exact. */
    fall: number;
    swayAmp: number;
    /** Integer sway harmonic. */
    swayHarm: number;
    swayPhase: number;
    /** Integer tumble harmonic. */
    spinHarm: number;
    spinPhase: number;
    /** Radius across the fall line. */
    radius: number;
    /** Radius along the fall line — larger than `radius` only for a streaked seed. */
    length: number;
    gain: number;
};

export type WeatherField = {
    seed: WeatherSeedId;
    tint: WeatherTint;
    tumbles: boolean;
    particles: readonly Particle[];
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
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
        // 0 = far, 1 = near. Drives size, brightness and fall rate together, which is what reads as
        // depth: a big flake close to the lens is also the one that crosses the frame fastest.
        const depth = rnd();
        const radius = params.sizeFar + depth * (params.sizeNear - params.sizeFar);
        particles.push({
            u0: rnd() * fallSpan,
            v0: rnd() * vSpan,
            fall: 1 + Math.round(depth * (spread - 1)),
            swayAmp: params.sway * (0.4 + rnd() * 0.6),
            swayHarm: 1 + Math.floor(rnd() * 3),
            swayPhase: rnd(),
            spinHarm: 1 + Math.floor(rnd() * 3),
            spinPhase: rnd(),
            radius,
            length: seed.streaked ? Math.max(radius, params.streak * (0.35 + depth * 0.65)) : radius,
            gain: 0.28 + depth * 0.67,
        });
    }

    return {
        seed: seedId,
        tint: seed.tint,
        tumbles: seed.tumbles,
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
 * encoder is the other 98%**. Eight times the cheap half is a few percent on the whole, which is why
 * the editor's live preview drops it and the bake does not.
 */
export const WEATHER_SUB_STEPS = 8;

/**
 * The shutter is open for the whole frame interval rather than the half a film camera would use.
 *
 * A shorter shutter would leave gaps between one frame's streak and the next one's, and the gap is
 * exactly the artefact being removed. It also needs no per-seed tuning: a particle that barely moves
 * in a frame barely blurs, whichever shutter it is given.
 */
const SHUTTER = 1;

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
        // Along the fall line: an integer number of spans per loop, wrapped out of sight.
        const u = originU + ((p.u0 + phase * p.fall * fallSpan) % fallSpan);
        // Across it: a periodic sway, so the position at phase 1 equals the position at phase 0.
        const v = originV + p.v0 + p.swayAmp * Math.sin(twoPi * (p.swayHarm * phase + p.swayPhase));

        const cx = u * dirX + v * crossX;
        const cy = u * dirY + v * crossY;

        const across = field.tumbles
            ? p.radius * (0.35 + 0.65 * Math.abs(Math.cos(twoPi * (p.spinHarm * phase + p.spinPhase))))
            : p.radius;
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
    // The shutter is one frame long, so the renderer has to be told how long a frame IS in phase
    // units. Both hosts pass the same loop length for the same reason they share this file: a preview
    // integrating over a different shutter than the bake would be a preview of something else.
    const frames = Math.max(1, Math.round(options.frames));
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
                accumulateInstant(acc, field, width, height, phase + (SHUTTER * step) / (subSteps * frames), weight);
            }
            for (let pixel = 0, rgb = 0, rgba = 0; pixel < width * height; pixel++, rgb += 3, rgba += 4) {
                frame[rgba] = acc[rgb];
                frame[rgba + 1] = acc[rgb + 1];
                frame[rgba + 2] = acc[rgb + 2];
            }
        },
    };
}
