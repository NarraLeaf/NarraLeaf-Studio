import { describe, expect, it } from "vitest";
import { weatherFrameCountOf, weatherLoopSeconds, weatherLoopSecondsOf } from "./model";
import {
    onWeatherParamGrid,
    resolveWeatherParams,
    snapWeatherParam,
    WEATHER_PARAMS,
    WEATHER_SEED_IDS,
    WEATHER_SEEDS,
    weatherBakeSize,
    weatherParamsOf,
    type WeatherParamKey,
    type WeatherSeedId,
} from "./model";
import { buildWeatherField, createWeatherRenderer, scaleWeatherParams } from "./field";
import { petalSprite, PETAL_SPRITE_SIZE } from "./petalSprite";
import { weatherBakeDescriptor, weatherBakeKey } from "./bakeKey";

/**
 * Small enough to render dozens of frames per test, large enough for the geometry to be real.
 *
 * Not smaller: density is stated per megapixel, so a tiny canvas resolves to a handful of particles
 * and any assertion about what is VISIBLE becomes a question of where those few happened to land.
 */
const W = 480;
const H = 270;

/** Few frames and few sub-steps: the tests are about geometry and identity, not about the blur. */
const FRAMES = 60;

function frameAt(seed: WeatherSeedId, phase: number, params = resolveWeatherParams({ seed }), subSteps = 2, frames = FRAMES) {
    const field = buildWeatherField(seed, params, W, H);
    const renderer = createWeatherRenderer(field, W, H, { frames, subSteps });
    renderer.render(phase);
    // Copied: the renderer reuses its buffer, so two frames compared without this would be one frame
    // compared with itself - a seam test that can never fail.
    return new Uint8ClampedArray(renderer.frame);
}

function litPixels(buf: Uint8ClampedArray): number {
    let lit = 0;
    for (let i = 0; i < buf.length; i += 4) {
        if (buf[i] > 8 || buf[i + 1] > 8 || buf[i + 2] > 8) {
            lit++;
        }
    }
    return lit;
}

describe("weather seeds", () => {
    it("every seed exposes only parameters the table defines", () => {
        for (const id of WEATHER_SEED_IDS) {
            for (const key of WEATHER_SEEDS[id].params) {
                expect(WEATHER_PARAMS[key], `${id} exposes unknown parameter ${key}`).toBeDefined();
            }
        }
    });

    it("exposes every parameter it states a default for, apart from the ones it pins deliberately", () => {
        // `resolveWeatherParams` pins a parameter the seed does not expose, which is right for a
        // value the seed means to switch OFF and silent for one it merely forgot to list. Sakura
        // shipped a thirty-six second loop it could not show or change for exactly that reason: the
        // default was read, the slider never appeared, and every override was discarded.
        const pinned: Partial<Record<WeatherSeedId, readonly WeatherParamKey[]>> = {
            // Rain falls in straight parallel lines. A sway control on it would be a control for
            // something rain is defined by not having.
            rain: ["sway"],
        };
        for (const seed of WEATHER_SEED_IDS) {
            const exposed = new Set<string>(weatherParamsOf(seed));
            const allowed = new Set<string>(pinned[seed] ?? []);
            const unreachable = Object.keys(WEATHER_SEEDS[seed].defaults)
                .filter(key => !exposed.has(key) && !allowed.has(key));
            expect({ seed, unreachable }).toEqual({ seed, unreachable: [] });
        }
    });

    it("resolves an empty ref to the seed's own defaults", () => {
        const params = resolveWeatherParams({ seed: "rain" });
        expect(params.streak).toBe(WEATHER_SEEDS.rain.defaults.streak);
        // Rain does not sway, and its seeded zero must win over the shared default.
        expect(params.sway).toBe(0);
    });

    it("clamps a stored value that is out of range instead of refusing it", () => {
        const params = resolveWeatherParams({ seed: "snow", params: { density: 99999, wind: -999 } });
        expect(params.density).toBe(WEATHER_PARAMS.density.max);
        expect(params.wind).toBe(WEATHER_PARAMS.wind.min);
    });

    it("ignores a stored parameter the seed does not expose", () => {
        // Rain has no sway control; a value left behind by a seed switch must not reach the renderer.
        const params = resolveWeatherParams({ seed: "rain", params: { sway: 200 } });
        expect(params.sway).toBe(0);
    });

    it("substitutes the default for a non-finite value", () => {
        const params = resolveWeatherParams({ seed: "snow", params: { density: Number.NaN } });
        expect(params.density).toBe(WEATHER_SEEDS.snow.defaults.density);
    });
});

describe("the loop seam", () => {
    // The property the whole design rests on: phase 1 is phase 0, to the byte, for every seed and
    // whatever the wind is doing. If this fails the clip visibly stutters once per loop.
    for (const seed of WEATHER_SEED_IDS) {
        it(`${seed} renders phase 1 identically to phase 0`, () => {
            expect(frameAt(seed, 1)).toEqual(frameAt(seed, 0));
        });

        it(`${seed} keeps the seam under wind`, () => {
            const params = resolveWeatherParams({ seed, params: { wind: 37 } });
            expect(frameAt(seed, 1, params)).toEqual(frameAt(seed, 0, params));
        });
    }

    it("moves between frames", () => {
        // A seam test alone would pass on a field that never moves at all.
        expect(frameAt("snow", 0)).not.toEqual(frameAt("snow", 0.37));
    });
});

describe("the fall speed", () => {
    const fallsOf = (seed: WeatherSeedId, fallSpeed: number, depthSpread?: number) =>
        buildWeatherField(
            seed,
            resolveWeatherParams({
                seed,
                params: { fallSpeed, ...(depthSpread === undefined ? {} : { depthSpread }) },
            }),
            W,
            H,
        ).particles.map(particle => particle.fall);

    it("is a whole number of fall-lengths, whatever the document stored", () => {
        // A fraction is a visible jump once per loop, so the renderer rounds rather than trusts what
        // it was handed - the value arrives from a stored row, not from the control.
        for (const fall of fallsOf("rain", 3.4)) {
            expect(Number.isInteger(fall)).toBe(true);
            expect(fall).toBeGreaterThanOrEqual(1);
        }
    });

    for (const seed of WEATHER_SEED_IDS) {
        it(`${seed} keeps the seam exact when the speed is raised`, () => {
            const params = resolveWeatherParams({ seed, params: { fallSpeed: 5 } });
            expect(frameAt(seed, 1, params)).toEqual(frameAt(seed, 0, params));
        });
    }

    it("puts every seed's default clear of both ends of every range it exposes", () => {
        // Twice now a seed has shipped with a default sitting on a bound: `fallSpeed` on the floor,
        // which gave a sakura that fell more slowly than the snow beside it, and `sizeNear` on the
        // ceiling, which left an author unable to ask for a larger petal than the one they were
        // already looking at. Both read to the author as "this slider does nothing in the direction
        // I want", and neither is visible in a diff. Only EXPOSED parameters: a seed pins the rest
        // at whatever it wants, and rain's `sway` of 0 is the point of rain.
        for (const seed of WEATHER_SEED_IDS) {
            const resolved = resolveWeatherParams({ seed });
            for (const key of weatherParamsOf(seed)) {
                const spec = WEATHER_PARAMS[key];
                expect({ seed, key, value: resolved[key] }).toMatchObject({ seed, key });
                expect(resolved[key]).toBeGreaterThan(spec.min);
                expect(resolved[key]).toBeLessThan(spec.max);
            }
        }
    });

    it("is a control rather than a pair of buttons", () => {
        // The value the AUTHOR states is not rounded, only each particle's own count of lengths is.
        // Rounding the base made the smallest change anyone could ask for a doubling of the whole
        // field, and left no speed at all between two of them.
        const mean = (speed: number) => {
            const falls = fallsOf("sakura", speed);
            return falls.reduce((sum, fall) => sum + fall, 0) / falls.length;
        };
        const steps = [0.2, 0.25, 0.3, 0.35, 0.4].map(mean);
        for (let i = 1; i < steps.length; i++) {
            expect(steps[i]).toBeGreaterThan(steps[i - 1]);
        }
    });

    it("scales the whole field rather than flattening the depth it already had", () => {
        const falls = fallsOf("snow", 4, 6);
        // Multiplying, not adding. An ADDITIVE base would top out near 4 + (6 - 1) = 9 here, leaving
        // the near field barely faster than the far one: the same weather with its depth washed out.
        expect(Math.min(...falls)).toBeGreaterThanOrEqual(4);
        expect(Math.max(...falls)).toBeGreaterThan(18);
    });

    it("actually moves every particle farther per loop", () => {
        // The thing the author is buying. Particle i is the same particle in both fields (the layout
        // draws from the same sequence and the count does not depend on speed), so this compares
        // like with like.
        const slow = fallsOf("rain", 1);
        const fast = fallsOf("rain", 3);
        expect(fast.length).toBe(slow.length);
        expect(fast.every((fall, index) => fall > slow[index])).toBe(true);
    });
});

describe("the flutter", () => {
    const fieldOf = (seed: WeatherSeedId, params: Partial<Record<WeatherParamKey, number>> = {}) =>
        buildWeatherField(seed, resolveWeatherParams({ seed, params }), W, H);

    it("is a rate in seconds rather than a harmonic of the loop", () => {
        // The bug this exists to catch: harmonics drawn straight from 1..3 mean 1..3 cycles per
        // TWELVE SECONDS, which is 0.08 to 0.25 Hz - a drift, not a flutter, and a slow pale blob is
        // a snowflake whatever sprite it was drawn from. Nothing in the expression mentions how long
        // a loop is, so nothing but this notices when the two are confused again.
        for (const rate of [0.4, 1.1, 2.5]) {
            const harmonics = fieldOf("sakura", { flutter: rate }).particles.map(p => p.swayHarm);
            // Against the loop THIS seed asks for. Reaching for the shared constant here is the
            // exact mistake the constant's own comment warns about, and it would pass on a seed that
            // happened to use twelve seconds while silently failing to check anything.
            const wanted = rate * weatherLoopSecondsOf({ seed: "sakura", params: { flutter: rate } });
            for (const harmonic of harmonics) {
                expect(Number.isInteger(harmonic)).toBe(true);
                // Each particle sits within a third of the seed's rate, so the field does not pulse
                // in unison; anything wider would be two weathers in one picture.
                expect(harmonic).toBeGreaterThanOrEqual(Math.floor(wanted * 0.7));
                expect(harmonic).toBeLessThanOrEqual(Math.ceil(wanted * 1.3));
            }
        }
    });

    for (const seed of WEATHER_SEED_IDS) {
        it(`${seed} keeps the seam exact at both ends of the rate`, () => {
            // The hang displaces a particle along its own fall line, which looks like the one thing
            // that could break the seam and does not: it is zero-mean and on an integer harmonic.
            for (const flutter of [WEATHER_PARAMS.flutter.min, WEATHER_PARAMS.flutter.max]) {
                const params = resolveWeatherParams({ seed, params: { flutter, fallSpeed: 4.5 } });
                expect(frameAt(seed, 1, params)).toEqual(frameAt(seed, 0, params));
            }
        });
    }

    it("hangs without ever letting a particle climb", () => {
        // The hang subtracts `bobAmp * sin(2 * flutter)` from the fall, so its steepest slope against
        // phase is `bobAmp * 4pi * swayHarm`. Once that exceeds the particle's own fall rate the
        // particle moves UPWARD at the top of its hang, which nothing falling does. The margin is
        // set by a constant in the field builder; this is what holds that constant honest.
        for (const seed of WEATHER_SEED_IDS) {
            for (const fallSpeed of [WEATHER_PARAMS.fallSpeed.min, 4, WEATHER_PARAMS.fallSpeed.max]) {
                const field = fieldOf(seed, { fallSpeed, flutter: WEATHER_PARAMS.flutter.max });
                for (const p of field.particles) {
                    const slowest = p.fall * field.fallSpan - p.bobAmp * 4 * Math.PI * p.swayHarm;
                    expect(slowest).toBeGreaterThan(0);
                }
            }
        }
    });

    it("does not reach rain, which falls at one speed", () => {
        // A drop has no face to turn, so it has no drag cycle - and its streak is drawn for one
        // speed, so a drop that slowed would be a smear that had come loose from its own motion.
        expect(fieldOf("rain").particles.every(p => p.bobAmp === 0)).toBe(true);
        expect(fieldOf("sakura").particles.some(p => p.bobAmp > 0)).toBe(true);
    });
});

describe("the sway", () => {
    it("gives neighbours different rhythms, which one harmonic cannot", () => {
        // The seam needs a whole number of cycles per loop, so the rates available are a handful of
        // integers - sakura's flutter over its own loop offers five. Forty petals on five rates put
        // fourteen of them on one, and particles sharing a rate do not merely look similar: they
        // sway at exactly the same rate for ever, and a phase offset does not hide that. Two modes
        // at unrelated rates make a SHAPE, and a shape is what an eye matches against its neighbour.
        // At the STAGE's size, because this is a statement about the field an author sees: sakura
        // ships fifteen particles per megapixel and the shared test canvas is an eighth of one, so
        // six particles cannot demonstrate anything about how many rhythms forty of them have. No
        // frames are drawn here, so the size costs nothing.
        const field = buildWeatherField("sakura", resolveWeatherParams({ seed: "sakura" }), 1920, 1080);
        const rates = new Set(field.particles.map(p => p.swayHarm));
        const shapes = new Set(field.particles.map(p => `${p.swayHarm}/${p.swayHarm2}`));
        expect(rates.size).toBeLessThan(8);
        expect(shapes.size).toBeGreaterThan(rates.size * 3);
        // And no rhythm may be shared by a large fraction of the field, which is the actual report:
        // fourteen of forty petals kept time with each other.
        const perShape = new Map<string, number>();
        for (const p of field.particles) {
            const shape = `${p.swayHarm}/${p.swayHarm2}`;
            perShape.set(shape, (perShape.get(shape) ?? 0) + 1);
        }
        expect(Math.max(...perShape.values())).toBeLessThan(field.particles.length / 5);
    });

    it("keeps the second mode clear of the first, so the sum is not one thicker sine", () => {
        for (const seed of WEATHER_SEED_IDS) {
            for (const p of buildWeatherField(seed, resolveWeatherParams({ seed }), W, H).particles) {
                expect(Number.isInteger(p.swayHarm2)).toBe(true);
                expect(p.swayHarm2).not.toBe(p.swayHarm);
                expect(p.swayHarm2).toBeGreaterThan(p.swayHarm);
            }
        }
    });

    it("scales the second mode down by how much faster it is, so it is a flutter and not a jitter", () => {
        // Equal amplitudes at three times the rate would be three times the speed sideways. The
        // weight carries `harm / harm2`, so what the two modes contribute is comparable.
        for (const p of buildWeatherField("sakura", resolveWeatherParams({ seed: "sakura" }), 1920, 1080).particles) {
            expect(p.swayMix).toBeGreaterThan(0);
            expect(p.swayMix).toBeLessThan(1);
            expect(p.swayMix * p.swayHarm2).toBeCloseTo(0.9 * p.swayHarm, 6);
        }
    });

    it("carries a depth, so the flutter is a circulation rather than a slide along a rail", () => {
        // The report this replaced a separate face rate for: "it is not going around any axis". A
        // circle has ONE phase, and giving the lateral offset, the depth and the face three of their
        // own is what made it three coincidences instead. The depth is the half a flat clip has
        // nowhere to put except into apparent size, so a particle with none of it cannot circle
        // anything - it can only slide.
        const field = buildWeatherField("sakura", resolveWeatherParams({ seed: "sakura" }), 1920, 1080);
        for (const p of field.particles) {
            expect(p.swirlDepth).toBeGreaterThan(0);
            // Small: a particle that doubled would read as coming at the lens rather than as going
            // round a line a few centimetres across.
            expect(p.swirlDepth).toBeLessThan(0.4);
        }
        expect(new Set(field.particles.map(p => p.swirlDepth)).size).toBeGreaterThan(field.particles.length / 2);
    });

    // There is deliberately no test that the flutter is horizontal rather than perpendicular to a
    // tilted fall line, and it is worth saying why rather than leaving a gap. The property is one
    // term in one expression - the lateral offset is added to `cx` and nothing is added to `cy` -
    // and every probe cheap enough to write measures something else. A whole field's centroid is
    // dominated by which particles are crossing the frame edge: on the code that HAD the bug, at
    // wind 0 where the flutter is horizontal by definition, that probe still reported ten pixels of
    // vertical spread. Comparing two `sway` values compares two different layouts, because the
    // across-fall span is extended by it. A single hand-placed particle needs the basis inverted to
    // put it on screen at all. A test that agreed with the code by re-deriving it would be worth
    // less than the comment on the expression itself, which is where this is recorded.
    for (const seed of WEATHER_SEED_IDS) {
        it(`${seed} keeps the seam exact with both modes running`, () => {
            // Both harmonics are whole numbers, so both return to where they started at phase 1.
            const params = resolveWeatherParams({ seed, params: { flutter: WEATHER_PARAMS.flutter.max, sway: 200 } });
            expect(frameAt(seed, 1, params)).toEqual(frameAt(seed, 0, params));
        });
    }
});

describe("the solidity", () => {
    // Density stated rather than the seed's own: sakura ships fifteen per megapixel, and this
    // canvas is an eighth of one, so a field at the default would be two petals and every assertion
    // below would be a question about where those two happened to land.
    const paramsAt = (solidity: number) =>
        resolveWeatherParams({ seed: "sakura", params: { solidity, density: 400 } });
    // The one block that states its own frame count, because the shutter is a fraction of a FRAME:
    // at the file's sixty a frame spans two fifths of a second of fall, so every petal arrives as a
    // smear four times its own length and the shape these cases are about is not on the canvas to
    // measure. Thirty a second over the seed's own loop is what a bake writes.
    const REAL_FRAMES = Math.round(weatherLoopSeconds(resolveWeatherParams({ seed: "sakura" })) * 30);
    const frameOf = (solidity: number) => frameAt("sakura", 0.25, paramsAt(solidity), 4, REAL_FRAMES);

    const saturated = (buf: Uint8ClampedArray) => {
        let n = 0;
        for (let i = 0; i < buf.length; i += 4) {
            if (buf[i] >= 254) n++;
        }
        return n;
    };
    const edgeEnergy = (buf: Uint8ClampedArray) => {
        let sum = 0;
        for (let y = 0; y < H - 1; y++) {
            for (let x = 0; x < W - 1; x++) {
                const i = (y * W + x) * 4;
                sum += Math.abs(buf[(y * W + x + 1) * 4] - buf[i]) + Math.abs(buf[((y + 1) * W + x) * 4] - buf[i]);
            }
        }
        return sum;
    };

    const gainsAt = (solidity: number) =>
        buildWeatherField("sakura", paramsAt(solidity), W, H).particles.map(p => p.gain);

    it("leaves the depth ramp exactly as it was at 1, and below", () => {
        // The neutral point. Everything at or under 1 is the classic ramp times the number, so an
        // author who never touches this control gets the picture the seed was designed around.
        const one = gainsAt(1);
        const half = gainsAt(0.5);
        // Inside the ramp's own ends rather than on them: depth is drawn at random, and a finite
        // field never contains a particle at exactly 0 or exactly 1.
        expect(Math.min(...one)).toBeGreaterThanOrEqual(0.28);
        expect(Math.max(...one)).toBeLessThanOrEqual(0.95);
        expect(Math.max(...one) / Math.min(...one)).toBeGreaterThan(2.5);
        for (let i = 0; i < one.length; i++) {
            expect(half[i]).toBeCloseTo(one[i] * 0.5, 6);
        }
    });

    it("flattens the depth ramp on the way up, which is what lets the FAR field reach opaque", () => {
        // A plain multiple cannot: the far end starts at 0.28 of the near end and stays there, so
        // the mid-field - most of what an author is looking at - never arrives. Measured before the
        // lift existed: 55% of the lit area opaque at 4, still under 90% at 32. So the ramp is
        // lerped toward flat in proportion to how far up the range the control has been pushed, and
        // the cost is stated where the parameter is: depth keeps its size cue and loses its
        // brightness one.
        const spread = (solidity: number) => {
            const g = gainsAt(solidity);
            return Math.max(...g) / Math.min(...g);
        };
        const neutral = spread(1);
        const top = spread(WEATHER_PARAMS.solidity.max);
        // Near the ramp's own 0.95/0.28, loosely: the sample's extremes are not the ramp's.
        expect(neutral).toBeGreaterThan(2.5);
        expect(neutral).toBeLessThanOrEqual(0.95 / 0.28);
        expect(top).toBeLessThan(1.05);
        // Monotone in between, so the control never reverses under the author's hand.
        const mid = spread((1 + WEATHER_PARAMS.solidity.max) / 2);
        expect(mid).toBeLessThan(neutral);
        expect(mid).toBeGreaterThan(top);
    });

    it("is allowed past 1, where it buys an edge rather than a glow", () => {
        // The reason it exists. Everything accumulates in float and clamps once, so a gain past 1
        // CLIPS the falloff: the particle gains a flat core and a narrower rim. If this were merely
        // a brightness the lit area would grow with it and the edges would not sharpen.
        const dull = frameOf(1);
        const solid = frameOf(WEATHER_PARAMS.solidity.max);
        // Not "none at 1": a dense field saturates by OVERLAP wherever two particles cross, because
        // the accumulator adds them. What the control buys is that the shapes themselves saturate.
        //
        // Six rather than the eight this held before coverage was clamped per particle. The missing
        // two are the motion smear: a pixel the petal crossed for part of the shutter used to write
        // full anyway, because a fraction of a large gain is still over 1. It now writes the
        // fraction, which is what a shutter is for - so the number here is the property's floor
        // rather than the last measurement of it.
        expect(saturated(solid)).toBeGreaterThan(saturated(dull) * 6);
        expect(edgeEnergy(solid)).toBeGreaterThan(edgeEnergy(dull));
        // And it is not simply covering more of the frame with light.
        expect(litPixels(solid)).toBeLessThan(litPixels(dull) * 1.6);
    });

    // One `it` per seed, like the flutter block above. Six seam frames in a single case ran seven
    // seconds against a five-second default under a full-suite load and failed as a timeout, which
    // reads exactly like a broken seam in the report and is not one.
    for (const seed of WEATHER_SEED_IDS) {
        it(`${seed} keeps the seam exact at both ends`, () => {
            for (const solidity of [WEATHER_PARAMS.solidity.min, WEATHER_PARAMS.solidity.max]) {
                const params = resolveWeatherParams({ seed, params: { solidity } });
                expect(frameAt(seed, 1, params)).toEqual(frameAt(seed, 0, params));
            }
        });
    }

    it("reaches full coverage at the top of its range, which a multiple alone never did", () => {
        // The complaint this range was widened for: at the old ceiling of 4 the field still read as
        // a wash. Measured on the shape's interior rather than on a luminance floor, because a
        // luminance floor grows with the gain and would flatter the answer.
        //
        // Full coverage is the seed's TINT, not white. This asked for white until the rasteriser
        // began clamping coverage before tinting, and asking for white is what quietly required
        // every solid seed to be colourless - see `addPetal`.
        const buf = frameOf(WEATHER_SEEDS.sakura.params.includes("solidity") ? WEATHER_PARAMS.solidity.max : 1);
        const [tr, tg, tb] = WEATHER_SEEDS.sakura.tint;
        let inside = 0;
        let full = 0;
        for (let i = 0; i < buf.length; i += 4) {
            const luminance = buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114;
            if (luminance > 24) {
                inside++;
                // Within a couple of counts of the tint on every channel, or brighter - two petals
                // crossing add, and the pair is allowed to be brighter than either.
                if (buf[i] >= tr - 2 && buf[i + 1] >= tg - 2 && buf[i + 2] >= tb - 2) {
                    full++;
                }
            }
        }
        expect(inside).toBeGreaterThan(0);
        // Not 100%: what is left is the antialiased rim, and a rim is what an edge IS.
        expect(full / inside).toBeGreaterThan(0.8);
    });

    it("does not spend the seed's colour on the way up, which is what it used to do", () => {
        // The regression this guards is the one an author reported as "the petals are too white to
        // be cherry blossom". Coverage used to be left unclamped, so a gain past 1 pushed all three
        // channels past 255 and the clamp at write-out took the brightest first: the middle of every
        // petal - the part the control exists to make solid - arrived white. At sakura's shipping
        // defaults seven tenths of the lit area was pure white.
        //
        // Stated against the seed's own tint rather than against a colour, so it is a question about
        // the renderer and not about what anybody thinks cherry blossom looks like.
        //
        // Drawn at the seed's OWN composition rather than at this block's crowded one: a field at
        // twenty-six times the shipping density loses a third of its saturation to particles simply
        // overlapping, which is correct additive behaviour and has nothing to do with what is being
        // asked here. `scaleWeatherParams` is what puts a stage-sized picture on a small canvas.
        const shipping = (solidity: number) =>
            frameAt(
                "sakura",
                0.25,
                scaleWeatherParams(resolveWeatherParams({ seed: "sakura", params: { solidity } }), W / 1920),
                4,
                REAL_FRAMES,
            );
        const hueOf = (buf: Uint8ClampedArray) => {
            let n = 0;
            let sum = 0;
            for (let i = 0; i < buf.length; i += 4) {
                if (Math.max(buf[i], buf[i + 1], buf[i + 2]) < 24) {
                    continue;
                }
                n++;
                const max = Math.max(buf[i], buf[i + 1], buf[i + 2]);
                sum += (max - Math.min(buf[i], buf[i + 1], buf[i + 2])) / max;
            }
            return sum / Math.max(1, n);
        };
        const declared = (() => {
            const [r, g, b] = WEATHER_SEEDS.sakura.tint;
            return (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
        })();
        // A tinted seed keeps its own saturation at every solidity it offers, including the top -
        // where the whole shape is at full coverage and therefore at exactly the tint. Not "most of"
        // it: away from an overlap the ratio between the channels is the tint's ratio at every
        // coverage, so anything short of this is a channel having clipped on its own.
        expect(declared).toBeGreaterThan(0.2);
        for (const solidity of [1, 6, WEATHER_PARAMS.solidity.max]) {
            expect(hueOf(shipping(solidity))).toBeGreaterThan(declared * 0.95);
        }
    });

    it("is a seed parameter because it changes the file, not how loudly the file is played", () => {
        // The payload's own `opacity` scales the finished overlay and cannot pass 1, so it can never
        // produce this. Two different questions, and the bake key has to be able to tell them apart.
        const dull = weatherBakeKey({ ref: { seed: "sakura", params: { solidity: 1 } }, width: W, height: H, fps: 30, frames: FRAMES });
        const solid = weatherBakeKey({ ref: { seed: "sakura", params: { solidity: 3 } }, width: W, height: H, fps: 30, frames: FRAMES });
        expect(solid).not.toBe(dull);
    });
});

describe("the derived loop length", () => {
    const secondsAt = (fallSpeed: number, flutter = 0.3) =>
        weatherLoopSeconds(resolveWeatherParams({ seed: "sakura", params: { fallSpeed, flutter } }));

    it("is a whole number of crossings, so the stated speed is the rendered speed", () => {
        // The point of deriving it rather than asking. The seam needs each particle to cross a WHOLE
        // number of fall-lengths per loop; if the length is chosen to BE a whole number of the far
        // field's crossings then that requirement is met by construction and nothing has to be
        // rounded away from what the author asked for.
        for (const fallSpeed of [0.011, 0.02, 0.05, 0.08, 0.125, 0.17, 0.25, 0.4, 0.7, 1, 1.5]) {
            const crossings = fallSpeed * secondsAt(fallSpeed);
            expect(crossings).toBeCloseTo(Math.round(crossings), 6);
            expect(Math.round(crossings)).toBeGreaterThanOrEqual(1);
        }
    });

    it("gets longer as the weather gets slower, which is the only way slow weather can exist", () => {
        // One fall-length per loop is the floor on speed, so a slow drift is not something a short
        // clip can contain. Compared across the range rather than step by step: the length is a
        // whole number of crossings, and whole numbers do not vary smoothly - between two adjacent
        // speeds the count can drop by one and take the length with it. Exactness is worth more than
        // a tidy curve here, and both ends of the curve are what an author actually notices.
        expect(secondsAt(WEATHER_PARAMS.fallSpeed.min)).toBeGreaterThan(secondsAt(WEATHER_PARAMS.fallSpeed.max) * 3);
        expect(secondsAt(0.02)).toBeGreaterThan(secondsAt(0.5) * 1.5);
    });

    it("stays inside its bounds at every speed and flutter the controls offer", () => {
        for (const fallSpeed of [WEATHER_PARAMS.fallSpeed.min, 0.05, 0.25, WEATHER_PARAMS.fallSpeed.max]) {
            for (const flutter of [WEATHER_PARAMS.flutter.min, 0.3, WEATHER_PARAMS.flutter.max]) {
                const seconds = secondsAt(fallSpeed, flutter);
                expect(seconds).toBeGreaterThan(0);
                expect(seconds).toBeLessThanOrEqual(91);
                expect(Number.isFinite(seconds)).toBe(true);
            }
        }
    });

    it("reaches a fall an order of magnitude slower than a twelve-second clip could", () => {
        // The report this exists for: "the slowest setting is still too fast". A twelve-second loop
        // floors the far field at one screen every twelve seconds however low the speed is set.
        const seconds = secondsAt(WEATHER_PARAMS.fallSpeed.min);
        const spans = buildWeatherField(
            "sakura",
            resolveWeatherParams({ seed: "sakura", params: { fallSpeed: WEATHER_PARAMS.fallSpeed.min } }),
            W,
            H,
        ).particles.map(p => p.fall);
        const slowest = Math.min(...spans) / seconds; // fall-lengths per second
        expect(slowest).toBeLessThan(1 / 12 / 4);
    });

    it("is the only answer anybody gets, so a preview and a bake cannot disagree", () => {
        expect(weatherFrameCountOf({ seed: "sakura" }, 30))
            .toBe(Math.round(weatherLoopSecondsOf({ seed: "sakura" }) * 30));
        expect(weatherLoopSecondsOf({ seed: "sakura" }))
            .toBeCloseTo(weatherLoopSeconds(resolveWeatherParams({ seed: "sakura" })), 9);
        // Whole, whatever it is asked: a fractional phase grid is the one way to get a stutter out
        // of a field that is mathematically exact.
        expect(Number.isInteger(weatherFrameCountOf({ seed: "rain", params: { fallSpeed: 0.083 } }, 120))).toBe(true);
    });

    for (const seed of WEATHER_SEED_IDS) {
        it(`${seed} keeps the seam exact at the slowest fall it offers`, () => {
            const params = resolveWeatherParams({ seed, params: { fallSpeed: WEATHER_PARAMS.fallSpeed.min } });
            expect(frameAt(seed, 1, params)).toEqual(frameAt(seed, 0, params));
        });
    }
});

describe("the shutter", () => {
    it("is stated by every seed, and open for the whole frame only where a streak needs it", () => {
        for (const id of WEATHER_SEED_IDS) {
            expect(WEATHER_SEEDS[id].shutter).toBeGreaterThan(0);
            expect(WEATHER_SEEDS[id].shutter).toBeLessThanOrEqual(1);
        }
        // Rain's streak IS the smear: anything less leaves gaps between one frame's streak and the
        // next, which is a field of dashes. A petal is a shape, and a shape smeared over its own
        // body length is a smudge - measured, a fully open shutter costs sakura 28% of its edge
        // energy and 44% of its peak brightness at the top of the speed range.
        expect(WEATHER_SEEDS.rain.shutter).toBe(1);
        expect(WEATHER_SEEDS.sakura.shutter).toBeLessThan(1);
    });

    it("reaches the renderer rather than being a constant beside it", () => {
        const params = resolveWeatherParams({ seed: "sakura", params: { fallSpeed: 10 } });
        const render = (shutter: number) => {
            const field = { ...buildWeatherField("sakura", params, W, H), shutter };
            const renderer = createWeatherRenderer(field, W, H, { frames: FRAMES, subSteps: 8 });
            renderer.render(0.3);
            return new Uint8ClampedArray(renderer.frame);
        };
        // A longer shutter integrates a longer arc, so it lights more pixels more faintly. If the
        // renderer had gone on reading a module constant these two would be identical.
        expect(litPixels(render(1))).toBeGreaterThan(litPixels(render(0.25)));
    });
});

describe("the reduction the inspector's preview draws", () => {
    // The preview shows the whole stage at panel size rather than a window onto it at 1:1. What
    // makes that the same picture is this scaling, and what makes it worth a test is that the
    // alternative is not obviously wrong: a window is honest about every LENGTH in it and still
    // showed fourteen enormous petals where the clip has hundreds of small ones.
    const scale = 320 / W;

    for (const seed of WEATHER_SEED_IDS) {
        it(`${seed} keeps the count, the timing and the flutter of the full-size field`, () => {
            const params = resolveWeatherParams({ seed });
            const full = buildWeatherField(seed, params, W, H);
            const small = buildWeatherField(
                seed,
                scaleWeatherParams(params, scale),
                Math.round(W * scale),
                Math.round(H * scale),
            );
            // Within one: the two spans are rounded to whole pixels independently.
            expect(Math.abs(small.particles.length - full.particles.length)).toBeLessThanOrEqual(1);
            const count = Math.min(small.particles.length, full.particles.length);
            for (let i = 0; i < count; i++) {
                expect(small.particles[i].fall).toBe(full.particles[i].fall);
                expect(small.particles[i].swayHarm).toBe(full.particles[i].swayHarm);
                // A particle's share of the frame, not its pixel size.
                expect(small.particles[i].radius / small.fallSpan).toBeCloseTo(
                    full.particles[i].radius / full.fallSpan,
                    3,
                );
            }
        });
    }

    it("leaves a scaled density unclamped, because the range describes a stage-sized picture", () => {
        const scaled = scaleWeatherParams(resolveWeatherParams({ seed: "sakura" }), 0.1);
        expect(scaled.density).toBeGreaterThan(WEATHER_PARAMS.density.max);
    });
});

describe("determinism", () => {
    it("renders the same bytes for the same inputs", () => {
        expect(frameAt("sakura", 0.42)).toEqual(frameAt("sakura", 0.42));
    });

    it("answers the same pixels whatever order the phases are asked in", () => {
        // What lets a bake draw its frames on several threads at once: the renderer zeroes its
        // accumulator at the top of every frame, so frame 200 does not need frame 199. A renderer
        // that carried anything across would make a clip depend on how many threads drew it.
        const params = resolveWeatherParams({ seed: "rain" });
        const field = buildWeatherField("rain", params, W, H);
        const forwards = createWeatherRenderer(field, W, H, { frames: FRAMES, subSteps: 2 });
        const backwards = createWeatherRenderer(field, W, H, { frames: FRAMES, subSteps: 2 });
        const phases = [0, 0.2, 0.4];

        const inOrder = phases.map(phase => {
            forwards.render(phase);
            return new Uint8ClampedArray(forwards.frame);
        });
        const reversed = [...phases].reverse().map(phase => {
            backwards.render(phase);
            return new Uint8ClampedArray(backwards.frame);
        });

        expect(reversed.reverse()).toEqual(inOrder);
        // Six full frames at this size is seconds of real work, and this file already renders a lot.
    }, 30000);

    it("gives different seeds different layouts", () => {
        const params = resolveWeatherParams({ seed: "snow" });
        const snow = buildWeatherField("snow", params, W, H);
        const sakura = buildWeatherField("sakura", params, W, H);
        expect(snow.particles[0]).not.toEqual(sakura.particles[0]);
    });
});

describe("the field", () => {
    it("paints something, and more of it at a higher density", () => {
        const sparse = litPixels(frameAt("snow", 0.2, resolveWeatherParams({ seed: "snow", params: { density: 200 } })));
        const dense = litPixels(frameAt("snow", 0.2, resolveWeatherParams({ seed: "snow", params: { density: 800 } })));
        expect(sparse).toBeGreaterThan(0);
        expect(dense).toBeGreaterThan(sparse);
    });

    it("holds its density when the wind tilts the field", () => {
        // Tilting enlarges the area that has to be covered; the areal density is what stays fixed, so
        // the visible amount must not fall away as the angle grows.
        //
        // Density stated rather than the seed's own, and stated high. This asks a question about a
        // STATISTIC and the seed's default resolves to thirty-four particles on this canvas, which
        // is few enough that the answer is really about where those thirty-four happened to land:
        // measured across the same ten phases, the ratio wanders between 0.93 and 1.60 at that count
        // and settles at 1.0 by eighty-five. It passed for as long as it did because nothing had
        // disturbed the draw - and then something did, and it failed for a reason that had nothing
        // to do with density. The file's own header says not to do this; this test did it anyway.
        const params = (over: Partial<Record<WeatherParamKey, number>>) =>
            resolveWeatherParams({ seed: "snow", params: { density: 600, ...over } });
        const upright = litPixels(frameAt("snow", 0.2, params({})));
        const tilted = litPixels(frameAt("snow", 0.2, params({ wind: 45 })));
        expect(tilted).toBeGreaterThan(upright * 0.7);
        expect(tilted).toBeLessThan(upright * 1.4);
    });

    it("integrates several instants into one frame", () => {
        // A blurred frame lights more pixels than a single instant of the same field: that difference
        // IS the shutter. Rain is the seed it matters most for, so it is the one asserted.
        const instant = litPixels(frameAt("rain", 0.3, undefined, 1));
        const blurred = litPixels(frameAt("rain", 0.3, undefined, 8));
        expect(blurred).toBeGreaterThan(instant);
    });

    it("leaves the alpha channel opaque", () => {
        const buf = frameAt("snow", 0.5);
        for (let i = 3; i < buf.length; i += 4) {
            expect(buf[i]).toBe(255);
        }
    });

    it("renders nothing at zero density without throwing", () => {
        const params = resolveWeatherParams({ seed: "snow", params: { density: WEATHER_PARAMS.density.min } });
        expect(litPixels(frameAt("snow", 0, params))).toBeGreaterThanOrEqual(0);
    });
});

describe("the bake key", () => {
    const size = { width: 1920, height: 1080, fps: 30, frames: 360 };

    it("is the same for a stated default and an omitted one", () => {
        const stated = weatherBakeKey({ ref: { seed: "snow", params: { density: WEATHER_SEEDS.snow.defaults.density } }, ...size });
        const omitted = weatherBakeKey({ ref: { seed: "snow" }, ...size });
        expect(stated).toBe(omitted);
    });

    it("changes when a parameter changes", () => {
        const a = weatherBakeKey({ ref: { seed: "snow" }, ...size });
        const b = weatherBakeKey({ ref: { seed: "snow", params: { wind: 12 } }, ...size });
        expect(a).not.toBe(b);
    });

    it("changes when the size changes", () => {
        const a = weatherBakeKey({ ref: { seed: "snow" }, ...size });
        const b = weatherBakeKey({ ref: { seed: "snow" }, ...size, width: 1280 });
        expect(a).not.toBe(b);
    });

    it("names the seed, so a cache directory can be read by a human", () => {
        expect(weatherBakeKey({ ref: { seed: "sakura" }, ...size }).startsWith("sakura-")).toBe(true);
    });

    it("orders parameters canonically", () => {
        const descriptor = weatherBakeDescriptor({ ref: { seed: "snow" }, ...size });
        const keys = (descriptor.split("|").pop() ?? "").split(",").map(part => part.split("=")[0]);
        expect(keys).toEqual([...keys].sort());
    });

    it("distinguishes two seeds carrying identical parameters", () => {
        const params: Partial<Record<WeatherParamKey, number>> = { density: 100 };
        expect(weatherBakeKey({ ref: { seed: "snow", params }, ...size }))
            .not.toBe(weatherBakeKey({ ref: { seed: "rain", params }, ...size }));
    });
});

describe("the bake size", () => {
    it("keeps a stage that already fits", () => {
        expect(weatherBakeSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    });

    it("makes a 4K project's weather at 4K", () => {
        // It used to cap here at 1080p and let the player's machine stretch it. A project created at
        // 3840x2160 asked for that resolution on purpose, and weather is the one layer that would
        // have arrived softer than everything drawn beside it.
        expect(weatherBakeSize(3840, 2160)).toEqual({ width: 3840, height: 2160 });
    });

    it("always returns even dimensions, which yuv420p requires", () => {
        for (const [w, h] of [[1001, 563], [2731, 1537], [321, 199]] as const) {
            const size = weatherBakeSize(w, h);
            expect(size.width % 2).toBe(0);
            expect(size.height % 2).toBe(0);
        }
    });
});

describe("the labels every surface asks for", () => {
    // These keys are reached through a cast (`storyInspector.weather.<key>`), so the compiler cannot
    // see them and the i18n parity test cannot either - parity compares the three languages against
    // each other, and a key all three are missing is aligned. A missing one would silently echo its
    // own path into the panel, which is the one place an author cannot argue with a wrong answer.
    it("has an inspector label for every parameter and a word for every seed", async () => {
        const { createTranslator } = await import("@shared/i18n");
        const translator = createTranslator("en");
        // Negative control: without this the assertion below would also pass against a translator
        // that answered `true` to everything, which is the shape of a test that cannot fail.
        expect(translator.has("storyInspector.weather.notAParameter" as never)).toBe(false);
        const missing: string[] = [];
        for (const key of Object.keys(WEATHER_PARAMS)) {
            if (!translator.has(`storyInspector.weather.${key}` as never)) {
                missing.push(`storyInspector.weather.${key}`);
            }
        }
        for (const id of WEATHER_SEED_IDS) {
            if (!translator.has(`story.enumValue.${id}` as never)) {
                missing.push(`story.enumValue.${id}`);
            }
        }
        expect(missing).toEqual([]);
    });
});

/**
 * The petal, which is the one particle in this system that has a shape.
 *
 * Snow and rain are lights: an ellipse with a soft falloff is not an approximation of a snowflake,
 * it is what one looks like. A petal is an outline with tone across it, and neither of those is
 * something a formula in the rasteriser gives you - which is why it is a bitmap, and why what is
 * pinned here is the bitmap being a petal rather than a blob.
 */
describe("the petal sprite", () => {
    const sprite = petalSprite();
    const at = (row: number, column: number) => sprite[row * PETAL_SPRITE_SIZE + column];

    it("is a 64x64 single channel that decodes to exactly its declared size", () => {
        expect(sprite.length).toBe(PETAL_SPRITE_SIZE * PETAL_SPRITE_SIZE);
    });

    it("has an outline: the corners are empty and the middle is not", () => {
        const half = PETAL_SPRITE_SIZE / 2;
        expect(at(0, 0)).toBe(0);
        expect(at(0, PETAL_SPRITE_SIZE - 1)).toBe(0);
        expect(at(PETAL_SPRITE_SIZE - 1, 0)).toBe(0);
        expect(at(PETAL_SPRITE_SIZE - 1, PETAL_SPRITE_SIZE - 1)).toBe(0);
        expect(at(half, half)).toBeGreaterThan(128);
    });

    it("is notched at the tip, which is what says cherry rather than leaf", () => {
        // The last rows are cut into two lobes: the centre column is empty where the sides are not.
        const half = PETAL_SPRITE_SIZE / 2;
        const notchRow = PETAL_SPRITE_SIZE - 10;
        expect(at(notchRow, half)).toBe(0);
        expect(Math.max(at(notchRow, half - 10), at(notchRow, half + 10))).toBeGreaterThan(0);
    });

    it("carries tone rather than being a mask, and is brighter toward the tip", () => {
        const half = PETAL_SPRITE_SIZE / 2;
        // Mean over what the petal actually covers, not a sum: the tip half is the narrower one, so
        // a sum would be measuring area and answering the opposite question.
        const meanLight = (from: number, to: number) => {
            let total = 0;
            let lit = 0;
            for (let row = from; row < to; row++) {
                for (let column = 0; column < PETAL_SPRITE_SIZE; column++) {
                    if (at(row, column) > 0) {
                        total += at(row, column);
                        lit++;
                    }
                }
            }
            return total / Math.max(1, lit);
        };
        const values = new Set(sprite);
        // A silhouette would hold two values; this holds a gradient.
        expect(values.size).toBeGreaterThan(64);
        expect(meanLight(half, PETAL_SPRITE_SIZE)).toBeGreaterThan(meanLight(0, half));
    });

    it("is not radially symmetric, which is the whole reason a rotation means anything", () => {
        // The old sakura particle was a disc whose cross-axis breathed. A disc looks the same at
        // every angle, so the "tumble" it had could only ever read as a pulse. Turning this one
        // through a right angle gives a different picture, and the marginals are the cheapest proof:
        // a radially symmetric sprite has identical row and column profiles.
        let difference = 0;
        for (let i = 0; i < PETAL_SPRITE_SIZE; i++) {
            let row = 0;
            let column = 0;
            for (let j = 0; j < PETAL_SPRITE_SIZE; j++) {
                row += at(i, j);
                column += at(j, i);
            }
            difference += Math.abs(row - column);
        }
        expect(difference).toBeGreaterThan(PETAL_SPRITE_SIZE * 256);
    });

    it("is drawn from by sakura and by nothing else", () => {
        const params = (seed: WeatherSeedId) => resolveWeatherParams({ seed });
        expect(buildWeatherField("sakura", params("sakura"), 320, 180).sprite).toBe(true);
        expect(buildWeatherField("snow", params("snow"), 320, 180).sprite).toBe(false);
        expect(buildWeatherField("rain", params("rain"), 320, 180).sprite).toBe(false);
    });
});

/**
 * The grid a control moves a parameter on.
 *
 * Asserted on the function rather than on any seed's numbers: a default that happens to sit between
 * two increments today may be tidied tomorrow, and a test written against that coincidence would go
 * red for a change that is not a regression.
 */
describe("weather parameter grid", () => {
    it("snaps to increments counted from the floor of the range", () => {
        const spec = { min: 2, max: 48, step: 5, default: 2 };
        expect(snapWeatherParam(2, spec)).toBe(2);
        expect(snapWeatherParam(9, spec)).toBe(7);
        expect(snapWeatherParam(10, spec)).toBe(12);
    });

    it("keeps the increment's own precision", () => {
        // 0.5 + 4 x 0.5 is 2.5000000000000004 before the rounding, which a number box would print.
        const spec = WEATHER_PARAMS.sizeFar;
        expect(spec.step).toBe(0.5);
        expect(snapWeatherParam(2.4, spec)).toBe(2.5);
    });

    it("stays inside the range", () => {
        const spec = WEATHER_PARAMS.wind;
        expect(snapWeatherParam(-999, spec)).toBe(spec.min);
        expect(snapWeatherParam(999, spec)).toBe(spec.max);
    });

    it("falls back to the parameter's default rather than emitting NaN", () => {
        expect(snapWeatherParam(Number.NaN, WEATHER_PARAMS.density)).toBe(WEATHER_PARAMS.density.default);
    });

    it("reports a value between two increments as off the grid", () => {
        const spec = { min: 2, max: 48, step: 1, default: 2 };
        expect(onWeatherParamGrid(3, spec)).toBe(true);
        expect(onWeatherParamGrid(2.4, spec)).toBe(false);
        // Float dust from arithmetic on the grid is still on the grid.
        expect(onWeatherParamGrid(2 + 0.1 * 3 * 10 / 3, spec)).toBe(true);
    });
});
