/**
 * The language the game's document is in, kept on `<html lang>`.
 *
 * A browser reads that attribute before it draws a single glyph: it picks the Han forms a system
 * font falls back to (the same character is set differently in Japanese and in Simplified Chinese),
 * it decides how a line may be broken, and it is what a screen reader announces the page in. The
 * entry document can only state the language the project was written in - the web shell bakes that
 * one in, and the desktop shell's document is built once for every game there will ever be - so a
 * player reading a Japanese title in Simplified Chinese is served by neither.
 *
 * The game knows the answer: its language is published the moment it boots, and again whenever it
 * changes, by the same holder the default font stack is resolved through
 * (`@shared/typography/projectFonts`). This mirrors that holder onto the document.
 *
 * Only in the shipped game. Dev Mode draws the same game inside Studio's window, where the document
 * belongs to Studio and its language is the editor's, not the project's.
 *
 * An empty language is left alone rather than written as `lang=""`: a project with no localization
 * set up has published nothing, and the shell's own attribute is a better answer than "unknown".
 *
 * Comments in English per project convention.
 */

export interface DocumentLanguageHost {
    /** The language the game is being read in, or "" when the project has none. */
    getLanguage(): string;
    /** Called on every publish; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
    /** Put the tag on the document. */
    apply(language: string): void;
}

/**
 * A language tag the browser can act on. Anything else is authored text that reached the locale
 * field, and an unparseable attribute selects a worse font than no attribute does.
 */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Mirror the published language onto the document until the returned function is called.
 *
 * Applied once on install as well as on every publish: the game may already have booted by the time
 * this runs, and a listener alone would then never fire.
 */
export function installDocumentLanguage(host: DocumentLanguageHost): () => void {
    let applied: string | null = null;
    const publish = (): void => {
        const language = host.getLanguage().trim();
        if (!language || language === applied || !LANGUAGE_TAG.test(language)) {
            return;
        }
        applied = language;
        host.apply(language);
    };
    publish();
    return host.subscribe(publish);
}
