/*
 * What a save may tell the stage to load.
 *
 * A save is a file on the player's disk, so anything in it may have been written by someone other
 * than the game. The engine used to apply an image's saved source and every saved transform value as
 * they stood - `file:` and `javascript:` included, and `url(...)` inside a `maskImage` or `filter`.
 * This walks a save before it reaches the engine and takes out what points somewhere a save may not
 * send the stage. The same check lives in the engine from 1.5.1 (`Utils.isSafeRestoredURL`); this
 * copy is what protects games built against an engine without it.
 */

const UNSAFE_SCHEMES: ReadonlySet<string> = new Set(["javascript", "vbscript", "file", "filesystem"]);

/** Whether a URL read back from a save may be handed to the stage. Relative paths pass. */
export function isSafeRestoredUrl(url: string): boolean {
    // Browsers ignore control characters and spaces when they read a scheme.
    // eslint-disable-next-line no-control-regex
    const compact = url.replace(/[\u0000- ]/g, "");
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
    if (!match) {
        return true;
    }
    const scheme = match[1].toLowerCase();
    if (scheme === "data") {
        return /^data:image\//i.test(compact);
    }
    return !UNSAFE_SCHEMES.has(scheme);
}

/**
 * Whether a CSS value read back from a save is safe to apply. Every `url(...)` inside it has to pass
 * {@link isSafeRestoredUrl}; a value with a CSS escape is refused, because an escape can spell `url(`
 * or a scheme where a plain search does not see it.
 */
export function isSafeRestoredCssValue(value: string): boolean {
    if (value.includes("\\")) {
        return false;
    }
    for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        if (!isSafeRestoredUrl(match[2])) {
            return false;
        }
    }
    if (/image-set\s*\(/i.test(value)) {
        for (const match of value.matchAll(/(['"])(.*?)\1/g)) {
            if (!isSafeRestoredUrl(match[2])) {
                return false;
            }
        }
    }
    return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsafeImageSource(source: unknown): boolean {
    if (typeof source === "string") {
        return !isSafeRestoredUrl(source);
    }
    if (isRecord(source) && typeof source.src === "string") {
        return !isSafeRestoredUrl(source.src);
    }
    return false;
}

/** Cleans one core state's `elementStates` in place; answers how many things were taken out. */
function sanitizeCoreState(core: unknown): number {
    if (!isRecord(core) || !Array.isArray(core.elementStates)) {
        return 0;
    }
    let removed = 0;
    core.elementStates = core.elementStates.filter(entry => {
        const data = isRecord(entry) ? entry.data : undefined;
        if (!isRecord(data)) {
            return true;
        }
        // An element the save does not name is restored to what the script wrote, so dropping the
        // entry is how an unsafe source falls back to the authored one.
        if (isRecord(data.state) && isUnsafeImageSource(data.state.currentSrc)) {
            removed += 1;
            return false;
        }
        if (isRecord(data.transformState)) {
            for (const [key, value] of Object.entries(data.transformState)) {
                if (typeof value === "string" && !isSafeRestoredCssValue(value)) {
                    delete data.transformState[key];
                    removed += 1;
                }
            }
        }
        return true;
    });
    return removed;
}

/**
 * A copy of `saved` with every unsafe image source and transform value taken out - in the game state
 * and in each backlog entry's snapshot, which a jump back in the history restores the same way.
 * `removed` counts what was taken out; a save the game wrote itself comes back unchanged with 0.
 */
export function sanitizeRestoredSave<T>(saved: T): { save: T; removed: number } {
    if (!isRecord(saved) || !isRecord(saved.game)) {
        return { save: saved, removed: 0 };
    }
    const copy = structuredClone(saved) as Record<string, unknown> & { game: Record<string, unknown> };
    let removed = sanitizeCoreState(copy.game);
    if (Array.isArray(copy.game.history)) {
        for (const entry of copy.game.history) {
            if (isRecord(entry)) {
                removed += sanitizeCoreState(entry.snapshot);
            }
        }
    }
    return { save: copy as T, removed };
}
