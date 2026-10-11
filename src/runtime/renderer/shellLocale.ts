import {
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    deviceLanguageTags,
    getRegisteredLocales,
    pickPreferredLocale,
    type LocaleCode,
} from "@shared/i18n";

/**
 * The language the game's own shell text is in: the crash screen, the screen a second tab of a web
 * export draws, the loading state's label, and whatever else the runtime says in its own voice rather
 * than the author's.
 *
 * The game's language. A player reading a Japanese game who meets the crash screen reads it in
 * Japanese, like every other word in the window. It is resolved the way the rest of Studio's words a
 * player reads are (`playerWords.ts`): the game's current language, the fallbacks the project declares
 * for it, its source language, and the first of those Studio has a catalogue for. The running game
 * hands each answer in through {@link followGameShellLocale}; this module reads neither the pack nor
 * the game's stored language itself.
 *
 * The screens that need the answer most are drawn by pages that never read either: the crash screen a
 * new renderer draws after the old one died, the loading state before the pack has arrived, a second
 * tab that is refused the session. So the answer is also recorded in the page's origin storage
 * (`localStorage`), which a page reads synchronously while it loads - with or without a preload, on
 * every shell. On the desktop shells that origin belongs to one game, because each game has a profile
 * of its own; on the web one origin may host several exports, so the record is filed under the page's
 * directory. The address, which carries the crash policy, would not do: it reaches a page that
 * replaces a dead one in the same window, and neither the next launch nor another tab.
 *
 * Before any game language is known - a first launch, a failure before the game said anything, a
 * project with no language set up - it is the machine's language, matched against the catalogues
 * Studio ships.
 *
 * The native dialogs the shell's main process raises are not drawn here and stay in the system's
 * language (`src/runtime/main/shellText.ts`).
 */

const STORAGE_KEY_PREFIX = "narraleaf.shellLanguage";

/** The machine's language, for a page that has no game language to go on. Fixed for the window. */
const machineLocale: LocaleCode = pickPreferredLocale(deviceLanguageTags(), SUPPORTED_LOCALES, DEFAULT_LOCALE);

/** Where the record lives: per page directory, so two exports on one web origin keep their own. */
function storageKey(): string {
    const pathname = typeof location === "undefined" ? "/" : location.pathname;
    const directory = pathname.slice(0, pathname.lastIndexOf("/") + 1) || "/";
    return `${STORAGE_KEY_PREFIX}:${directory}`;
}

/**
 * Only a language this bundle can draw counts. A record left by another build, or one naming a
 * catalogue only Studio's language packs carry, reads as no record.
 */
function isDrawable(locale: string | null | undefined): locale is LocaleCode {
    return typeof locale === "string" && getRegisteredLocales().includes(locale);
}

/** Origin storage can be absent, refused or full; every one of those is "nothing recorded". */
function readRecordedLocale(): LocaleCode | null {
    try {
        const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey());
        return isDrawable(stored) ? stored : null;
    } catch {
        return null;
    }
}

function recordLocale(locale: LocaleCode | null): void {
    try {
        if (typeof localStorage === "undefined") {
            return;
        }
        if (locale) {
            localStorage.setItem(storageKey(), locale);
        } else {
            localStorage.removeItem(storageKey());
        }
    } catch {
        // A shell that cannot keep the record still speaks the game's language for this page.
    }
}

/** Read once, while the page loads: whatever the last game on this origin was in, if anything. */
let gameLocale: LocaleCode | null = readRecordedLocale();
const listeners = new Set<() => void>();

/** The game's language as the shell speaks it, or the machine's while none is known. */
export function getShellLocale(): LocaleCode {
    return gameLocale ?? machineLocale;
}

/** Called whenever {@link getShellLocale} changes its answer; returns the unsubscribe. */
export function subscribeShellLocale(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * The game's language, resolved to a catalogue - or null for a game whose languages Studio has no
 * catalogue for, which the shell then speaks in the machine's language, as Studio's other words do.
 * Recorded for the pages that come after this one.
 */
export function setShellGameLocale(locale: LocaleCode | null): void {
    const next = isDrawable(locale) ? locale : null;
    if (next === gameLocale) {
        return;
    }
    gameLocale = next;
    recordLocale(next);
    // Copied: a listener may unsubscribe from inside its own callback.
    for (const listener of [...listeners]) {
        listener();
    }
}

export interface GameShellLocaleSource {
    /** The running game's language, resolved to a catalogue, or null when it resolves to none. */
    read(): LocaleCode | null;
    /** Called whenever the game publishes its language; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

/**
 * Follow the running game's language until the returned function is called.
 *
 * Nothing is read on install. This runs before the game exists, when the source can only answer
 * "none", and acting on that would throw away the language the last run recorded - which is the one
 * answer a page that crashes before the game says anything has.
 */
export function followGameShellLocale(source: GameShellLocaleSource): () => void {
    return source.subscribe(() => setShellGameLocale(source.read()));
}
