/**
 * How much of the opening scene has to be warm before the game is shown.
 *
 * ## Why this is a project setting rather than a constant
 *
 * The engine fetches, decodes and holds every image a scene registers. A scene's registered set is
 * every pose of every character it shows and every background it cuts to, so on a real project the
 * opening scene alone is most of the library - measured on a 17-scene project: 103 images, 205 MB,
 * and about three seconds before anything appeared. Its first painted frame is one picture.
 *
 * `auto` waits for that one picture and keeps fetching the rest behind the game. That is the right
 * answer for every project we can measure, but it is a trade rather than a free win: an image that
 * the opening scene reaches before its fetch lands arrives a frame late instead of not at all, and
 * a project on slow storage may prefer to open late and never see that. `blocking` is that answer,
 * and it is what every build did before this setting existed.
 *
 * Comments in English per project convention.
 */

export const PRELOAD_BEHAVIORS = ["auto", "blocking"] as const;

export type PreloadBehavior = typeof PRELOAD_BEHAVIORS[number];

export type PreloadConfiguration = {
    behavior: PreloadBehavior;
};

export const DEFAULT_PRELOAD_BEHAVIOR: PreloadBehavior = "auto";

export const DEFAULT_PRELOAD_CONFIGURATION: PreloadConfiguration = {
    behavior: DEFAULT_PRELOAD_BEHAVIOR,
};

/**
 * Coerce a persisted value into a complete preload configuration.
 *
 * Dense like the dialogue and crash configurations next door: a project written before this existed
 * carries nothing, and every reader is entitled to an answer without repeating the fallback.
 */
export function normalizePreloadConfiguration(value: unknown): PreloadConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_PRELOAD_CONFIGURATION };
    }
    const behavior = (value as Record<string, unknown>).behavior;
    return {
        behavior: PRELOAD_BEHAVIORS.includes(behavior as PreloadBehavior)
            ? behavior as PreloadBehavior
            : DEFAULT_PRELOAD_BEHAVIOR,
    };
}

/**
 * Whether this behaviour holds the first painted frame for the whole opening scene.
 *
 * One translation point, so the two vocabularies stay separable: the setting is named for what an
 * author chooses, and this is named for what the warming does. It used to answer with the engine's
 * own `preloadGate`, which is what steered the engine while the engine still decided what to warm;
 * Studio now plans the warming itself (see `createStudioPreloadScheduler`) and this is the one
 * thing about that plan the author gets a say in.
 */
export function preloadGatesWholeScene(behavior: PreloadBehavior): boolean {
    return behavior === "blocking";
}
