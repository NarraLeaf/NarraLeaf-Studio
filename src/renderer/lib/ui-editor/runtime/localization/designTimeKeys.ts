/**
 * The project's named translation keys as the editor window knows them, for text drawn outside a
 * game.
 *
 * A text or button whose source is a translation key shows that key's text in the game - the source
 * language's text, or its translation - and never its own `text` or `label`. The editor canvas mounts
 * no {@link GameLocalizationContext}, so without this it drew the element's own words instead: an
 * author edited what the canvas showed and the game went on showing something else. This holds the
 * key registry so the canvas can draw what the game draws in the project's source language.
 *
 * Module-level state for the reason `@shared/typography/projectFonts` keeps the font stack that way:
 * the readers are widget renderers deep inside every surface the editor draws, and the one writer is
 * the workspace's `LocalizationService`, which the runtime bundle does not carry. Dev Mode and the
 * shipped game never publish here; they read the bundle through the context instead.
 *
 * **Published only while the project has a source language** - the same condition under which a
 * build carries the keys at all (`loadGameLocalization`). A project without one ships no keys, so its
 * game shows each widget's own text, and the canvas must too.
 *
 * Comments in English per project convention.
 */

/** Key name → source-language text, or null when nothing is published. */
let keys: Readonly<Record<string, string>> | null = null;
let writer: ((name: string, sourceText: string) => void) | null = null;
const listeners = new Set<() => void>();

/** Publish the registry (null withdraws it). A publish with the same content notifies nobody. */
export function setDesignTimeLocalizationKeys(next: Readonly<Record<string, string>> | null): void {
    if (sameKeys(keys, next)) {
        return;
    }
    keys = next ? { ...next } : null;
    for (const listener of [...listeners]) {
        listener();
    }
}

/** The published registry, or null outside an editor window that holds one. */
export function getDesignTimeLocalizationKeys(): Readonly<Record<string, string>> | null {
    return keys;
}

export function subscribeDesignTimeLocalizationKeys(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * Register how a key's source text is written (null unregisters).
 *
 * The canvas edits a keyed text or button in place like any other, and that edit has to reach the
 * key rather than the element's dormant words - but the renderer that hosts the edit cannot import
 * the service that owns the registry.
 */
export function setDesignTimeLocalizationKeyWriter(next: ((name: string, sourceText: string) => void) | null): void {
    writer = next;
}

/**
 * The key a widget's words are drawn from on the canvas, or null when its own words are what show:
 * it has no key, or nothing is published (the project ships no keys, so its game shows the widget's
 * own words too).
 */
export function designTimeKeyOf(localizationKey: string | undefined): string | null {
    const key = localizationKey?.trim();
    return key && keys ? key : null;
}

/**
 * The words the canvas shows for a widget that may be read from a key, and what an in-place edit
 * starts from. A keyed widget shows its key's source text, as the game does; a key the registry does
 * not hold falls back to the widget's own words there too.
 */
export function designTimeTextOf(localizationKey: string | undefined, ownText: string): string {
    const key = designTimeKeyOf(localizationKey);
    return key ? keys?.[key] ?? ownText : ownText;
}

/** Write a key's source text through the registered writer. False when there is none. */
export function writeDesignTimeLocalizationKeySourceText(name: string, sourceText: string): boolean {
    if (!writer) {
        return false;
    }
    writer(name, sourceText);
    return true;
}

function sameKeys(
    a: Readonly<Record<string, string>> | null,
    b: Readonly<Record<string, string>> | null,
): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b) {
        return false;
    }
    const aNames = Object.keys(a);
    if (aNames.length !== Object.keys(b).length) {
        return false;
    }
    return aNames.every(name => Object.prototype.hasOwnProperty.call(b, name) && a[name] === b[name]);
}
