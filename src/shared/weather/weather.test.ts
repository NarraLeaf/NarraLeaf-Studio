import { describe, expect, it } from "vitest";
import {
    resolveWeatherParams,
    WEATHER_PARAMS,
    WEATHER_SEED_IDS,
    WEATHER_SEEDS,
    weatherBakeSize,
    type WeatherParamKey,
    type WeatherSeedId,
} from "./model";
import { buildWeatherField, createWeatherRenderer } from "./field";
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

function frameAt(seed: WeatherSeedId, phase: number, params = resolveWeatherParams({ seed }), subSteps = 2) {
    const field = buildWeatherField(seed, params, W, H);
    const renderer = createWeatherRenderer(field, W, H, { frames: FRAMES, subSteps });
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

describe("determinism", () => {
    it("renders the same bytes for the same inputs", () => {
        expect(frameAt("sakura", 0.42)).toEqual(frameAt("sakura", 0.42));
    });

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
        const upright = litPixels(frameAt("snow", 0.2));
        const tilted = litPixels(frameAt("snow", 0.2, resolveWeatherParams({ seed: "snow", params: { wind: 45 } })));
        expect(tilted).toBeGreaterThan(upright * 0.6);
        expect(tilted).toBeLessThan(upright * 1.6);
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

    it("caps a larger stage and keeps its shape", () => {
        const { width, height } = weatherBakeSize(3840, 2160);
        expect(width).toBe(1920);
        expect(height).toBe(1080);
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
