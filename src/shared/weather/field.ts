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

/** RGBA bytes for one frame. Four bytes per pixel, alpha pinned opaque. */
export function createWeatherFrameBuffer(width: number, height: number): Uint8ClampedArray {
    return new Uint8ClampedArray(width * height * 4);
}

/**
 * Draw one ellipse of light, oriented along the fall direction.
 *
 * Additive with a squared falloff: the core reads solid and the rim dies out without leaving the ring
 * a linear falloff produces. Written straight into the RGBA buffer rather than through any canvas
 * API, because this same code has to run in the main process with no DOM.
 */
function addParticle(
    buf: Uint8ClampedArray,
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

    for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        let index = (y * width + x0) * 4;
        for (let x = x0; x <= x1; x++, index += 4) {
            const dx = x - cx;
            const du = dx * dirX + dy * dirY;
            const dv = dx * crossX + dy * crossY;
            const d2 = du * du * invAlong + dv * dv * invAcross;
            if (d2 >= 1) {
                continue;
            }
            const falloff = (1 - d2) * (1 - d2) * gain;
            buf[index] += tint[0] * falloff;
            buf[index + 1] += tint[1] * falloff;
            buf[index + 2] += tint[2] * falloff;
        }
    }
}

/**
 * Render the field at one phase into `buf`.
 *
 * `phase` runs `[0, 1)`: frame `i` of `n` is `i / n`, never `i / (n - 1)`. The distinction is the
 * whole seam — with `n - 1` the last frame would BE the first one and the loop would stutter on a
 * duplicated frame, which is exactly the artefact this construction exists to avoid.
 */
export function renderWeatherFrame(
    buf: Uint8ClampedArray,
    field: WeatherField,
    width: number,
    height: number,
    phase: number,
): void {
    buf.fill(0);
    // Alpha is opaque everywhere: the clip has no transparency by design, and leaving it at zero
    // would make a canvas preview of it invisible while the encoder ignored the channel entirely.
    for (let i = 3; i < buf.length; i += 4) {
        buf[i] = 255;
    }

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
        addParticle(buf, width, height, cx, cy, across, p.length, dirX, dirY, p.gain, tint);
    }
}
