/**
 * What identifies a baked weather clip.
 *
 * A bake is content-addressed: the same seed with the same parameters at the same size is the same
 * clip, so it is produced once and then found rather than made again. That is what lets there be no
 * preset matrix at all — the author's own values ARE the key, and a project carries exactly the
 * clips it uses.
 *
 * ## Why the key includes things that are not parameters
 *
 * `size` and `frames` are part of the picture the encoder produced, so a project whose stage size
 * changed must not be handed the old clip. {@link WEATHER_BAKE_VERSION} covers the rest: the field
 * builder and the rasteriser are as much an input to the pixels as any slider, and there is no way
 * to hash a function. **Anyone who changes the look must bump it** — otherwise every machine with a
 * warm cache keeps serving the previous look, and the difference shows up only for whoever built on
 * a clean checkout.
 */

import { resolveWeatherParams, WEATHER_PARAMS, type WeatherParamKey, type WeatherSeedRef } from "./model";

/**
 * Bump on any change to `field.ts`, to a seed's constants, or to the encoder arguments.
 *
 * Cached clips keyed at an older version are simply never asked for again; nothing has to clean them
 * up for correctness, and a cache sweep removes them the same way it removes anything else there.
 */
export const WEATHER_BAKE_VERSION = 2;

export type WeatherBakeIdentity = {
    ref: WeatherSeedRef;
    width: number;
    height: number;
    fps: number;
    frames: number;
};

/**
 * The canonical description a key is computed from.
 *
 * Built from the RESOLVED parameters rather than the author's partial record, so two rows that mean
 * the same thing — one stating a value that happens to equal the default, one leaving it out — hash
 * alike and share a clip. Keys are emitted in a fixed order because object key order is not a
 * guarantee worth relying on for something a cache depends on.
 */
export function weatherBakeDescriptor(identity: WeatherBakeIdentity): string {
    const params = resolveWeatherParams(identity.ref);
    const ordered = (Object.keys(WEATHER_PARAMS) as WeatherParamKey[])
        .sort()
        .map(key => `${key}=${round(params[key])}`)
        .join(",");
    return [
        `v${WEATHER_BAKE_VERSION}`,
        identity.ref.seed,
        `${identity.width}x${identity.height}`,
        `${identity.frames}@${identity.fps}`,
        ordered,
    ].join("|");
}

/**
 * What a seed and its parameters are, independent of the size they will be rendered at.
 *
 * The compiler holds one overlay per stage name and has to answer "is this row asking for the same
 * weather as the row that made it?" — a question about the seed, not about the picture's dimensions,
 * which the compiler does not even know. Sharing {@link weatherBakeDescriptor}'s rounding is what
 * keeps the two answers from ever disagreeing.
 */
export function weatherRefIdentity(ref: WeatherSeedRef): string {
    const params = resolveWeatherParams(ref);
    const ordered = (Object.keys(WEATHER_PARAMS) as WeatherParamKey[])
        .sort()
        .map(key => `${key}=${round(params[key])}`)
        .join(",");
    return `${ref.seed}|${ordered}`;
}

/** Four decimals: the renderer cannot resolve a finer difference, and a float tail is not identity. */
function round(value: number): number {
    return Math.round(value * 10000) / 10000;
}

/**
 * A filesystem-safe name for the descriptor.
 *
 * FNV-1a over two lanes rather than one: a single 32-bit lane collides at a rate that is fine for a
 * hash table and not fine for a cache whose entries are *pictures*, where a collision would silently
 * serve snow to a project that asked for rain. Two lanes put it out of reach for anything a project
 * could plausibly hold, and this is a cache key rather than a security boundary.
 */
export function weatherBakeKey(identity: WeatherBakeIdentity): string {
    const text = weatherBakeDescriptor(identity);
    let a = 2166136261;
    let b = 0x811c9dc5 ^ 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        a = Math.imul(a ^ code, 16777619);
        b = Math.imul(b ^ (code + i), 2246822519);
    }
    const lane = (n: number) => (n >>> 0).toString(36).padStart(7, "0");
    return `${identity.ref.seed}-${lane(a)}${lane(b)}`;
}
