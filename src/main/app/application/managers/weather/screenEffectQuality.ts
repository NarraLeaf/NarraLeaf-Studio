import {
    SCREEN_EFFECT_QUALITY_DEFAULT,
    SCREEN_EFFECT_QUALITY_KEY,
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
