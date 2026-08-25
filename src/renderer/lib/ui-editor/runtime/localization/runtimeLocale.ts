/**
 * The language the game is being played in, readable synchronously and without React.
 *
 * `GameLocalizationContext` is the reader for anything that renders; this is the reader for
 * everything that does not. The blueprint evaluator is the case that forced it: resolving a data pin
 * is a synchronous pure function called from inside graph execution, so it can reach neither a React
 * context nor the host API's `getLocale`, which is a promise.
 *
 * A module-level holder rather than another field threaded through `DataPinResolveRuntime`, for the
 * same reason `characterAvatarAssets` and `devModeSavePreviewAssets` are module-level: the fact is
 * one per running game, every reader wants the same one, and the alternative is a parameter added to
 * every call site that constructs a resolve runtime - each of which would then need its own way to
 * find the answer.
 *
 * Nothing sets it in the editor canvas, and that is correct: an authored document carries no
 * build-written answers to resolve, and a set id there is resolved against the live library instead.
 */

export type RuntimeLocaleSource = {
    /** The player's current language. Read fresh on every call - it changes without a remount. */
    getLocale: () => string;
    /** The language the project is authored in, which every fallback chain ends at. */
    sourceLocale: string;
};

let activeSource: RuntimeLocaleSource | null = null;

/**
 * Install the running game's language source. Returns the uninstaller.
 *
 * The uninstaller only clears what it installed: two games never run in one renderer, but a remount
 * can install a second source before the first one's cleanup runs, and clearing unconditionally
 * there would leave the live game with no answer.
 */
export function setRuntimeLocaleSource(source: RuntimeLocaleSource): () => void {
    activeSource = source;
    return () => {
        if (activeSource === source) {
            activeSource = null;
        }
    };
}

/** The current language and the source language, or blanks outside a running game. */
export function readRuntimeLocale(): { locale?: string; sourceLocale?: string } {
    if (!activeSource) {
        return {};
    }
    return { locale: activeSource.getLocale(), sourceLocale: activeSource.sourceLocale };
}
