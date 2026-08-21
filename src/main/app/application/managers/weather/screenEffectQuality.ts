import {
    SCREEN_EFFECT_QUALITY_DEFAULT,
    SCREEN_EFFECT_QUALITY_KEY,
    SCREEN_EFFECT_THREADS_KEY,
    screenEffectThreadsOf,
} from "@shared/constants/screenEffects";
import { WEATHER_BAKE_QUALITIES, type WeatherBakeQuality } from "@shared/weather/model";

/** Just enough of the app to read a preference. Narrow so a test can hand in an object literal. */
export type ScreenEffectQualityHost = {
    globalState: { get(key: string): unknown };
};

/**
 * The tier Dev Mode bakes at, from the author's setting.
 *
 * **One reader, deliberately, and both Dev Mode callers go through it.** The pre-baker and the
 * compile that overtakes it have to arrive at the scheduler with the same tier or they are two
 * tasks: the speculative one keeps encoding for nobody while the author waits on a second bake of
 * the same clip. That failure is invisible - the weather still appears, just late - which is exactly
 * why the answer is computed in one place rather than read from the store twice.
 *
 * A stored value that is not a tier is treated as absent rather than trusted. Global state is a JSON
 * file an author can edit, and the value reaches an encoder argument; the cost of being strict here
 * is one comparison and the cost of not being is an ffmpeg that refuses to start.
 */
export function devModeScreenEffectQuality(app: ScreenEffectQualityHost): WeatherBakeQuality {
    const stored = app.globalState.get(SCREEN_EFFECT_QUALITY_KEY);
    return WEATHER_BAKE_QUALITIES.includes(stored as WeatherBakeQuality)
        ? stored as WeatherBakeQuality
        : SCREEN_EFFECT_QUALITY_DEFAULT;
}

/**
 * How many threads a bake may draw on, or `null` for "read the machine".
 *
 * Every bake asks - Dev Mode, preview and build alike - which is the difference between this and the
 * quality above: the quality decides what the file IS and so may only be relaxed for the copy nobody
 * ships, while this decides only how the machine is spent getting there.
 *
 * A stored value that is not one of the stops is treated as absent, for the same reason as above: it
 * reaches a thread count and a worker's argument list, and global state is a file on disk.
 */
export function screenEffectBakeThreads(app: ScreenEffectQualityHost): number | null {
    return screenEffectThreadsOf(app.globalState.get(SCREEN_EFFECT_THREADS_KEY));
}
