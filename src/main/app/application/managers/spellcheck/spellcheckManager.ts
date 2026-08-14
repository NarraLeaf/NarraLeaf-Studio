import {
    resolveSpellcheckLanguage,
    SPELLCHECK_LANGUAGE_DEFAULT,
    type SpellcheckStatus,
} from "@shared/types/spellcheck";

/**
 * The part of an Electron `Session` this manager touches.
 *
 * Narrowed to the five members this touches, and injected rather than imported, so the manager can
 * be tested without an Electron runtime - the same split `confirmQuitDecision` makes for the same
 * reason. `App` passes `session.defaultSession`.
 */
export interface SpellcheckSession {
    readonly availableSpellCheckerLanguages: string[];
    setSpellCheckerEnabled(enabled: boolean): void;
    setSpellCheckerLanguages(languages: string[]): void;
    addWordToSpellCheckerDictionary(word: string): boolean;
    removeWordFromSpellCheckerDictionary(word: string): boolean;
}

/** How the manager reads the author's stored choice. `App`'s global state, in production. */
export type SpellcheckSettingReader = () => string | undefined;

const EMPTY_STATUS: SpellcheckStatus = {
    sourceLocale: "",
    setting: SPELLCHECK_LANGUAGE_DEFAULT,
    language: null,
    available: [],
};

/**
 * Chromium's spellchecker, told which language to check and which words this project spells on
 * purpose.
 *
 * Two things are worth knowing before changing anything here.
 *
 * **The custom dictionary is the session's, and the session outlives the project.** Chromium keeps
 * the words in a file in the Electron profile, so every word added stays there until it is taken
 * out again - which is why {@link configure} removes what the previous project put in before adding
 * this one's, and why {@link clear} exists at all. Without that, the cast of every project ever
 * opened on this computer would accumulate into one list, and none of it would be flagged anywhere.
 *
 * **There is one session for every window.** Studio opens one window per project, and they share
 * `defaultSession`, so with two projects open the session holds the later one's words. The cost is
 * one direction only - a name from the other project is *not* underlined - which is a quieter
 * failure than the alternative and cannot corrupt anything: the documents stay separate, and
 * whichever project is configured last is correct.
 */
export class SpellcheckManager {
    private readonly session: () => SpellcheckSession;
    private readonly readSetting: SpellcheckSettingReader;
    /** Exactly the words this manager put into the session, so it can take back only its own. */
    private applied: string[] = [];
    private status: SpellcheckStatus = EMPTY_STATUS;

    constructor(session: () => SpellcheckSession, readSetting: SpellcheckSettingReader) {
        this.session = session;
        this.readSetting = readSetting;
    }

    /**
     * Point the session at one project: its language, and its words.
     *
     * Idempotent, and cheap to call again - the workspace calls it on load, on every dictionary
     * edit, and whenever the setting changes, and re-applying the same list touches nothing.
     */
    public configure(input: { sourceLocale: string; words: readonly string[] }): SpellcheckStatus {
        const session = this.session();
        const setting = this.readSetting() || SPELLCHECK_LANGUAGE_DEFAULT;
        const available = this.availableLanguages(session);
        const language = resolveSpellcheckLanguage(setting, input.sourceLocale, available);

        this.applyLanguage(session, language);
        this.applyWords(session, input.words);

        this.status = {
            sourceLocale: input.sourceLocale,
            setting,
            language,
            available,
        };
        return this.status;
    }

    /**
     * Take this project's words back out and stop checking.
     *
     * Called when a workspace closes or switches project. The words go with it: they are the
     * project's, and leaving them behind would mean the next project silently accepts a cast it
     * has never heard of.
     */
    public clear(): void {
        const session = this.session();
        this.applyWords(session, []);
        this.applyLanguage(session, null);
        this.status = EMPTY_STATUS;
    }

    /**
     * What spellchecking is doing now.
     *
     * Read by the Settings window, which has no project and therefore no way to work this out for
     * itself. Before any project has configured anything it reports the empty state, whose
     * `sourceLocale` of `""` is what makes `projectLanguageHasNoDictionary` answer false - so the
     * settings row states nothing rather than guessing.
     */
    public getStatus(): SpellcheckStatus {
        return {
            ...this.status,
            // Always live: the settings row lists these, and the session knows them whether or not
            // a project has ever configured one.
            available: this.status.available.length > 0
                ? this.status.available
                : this.availableLanguages(this.session()),
        };
    }

    private availableLanguages(session: SpellcheckSession): string[] {
        try {
            return [...session.availableSpellCheckerLanguages];
        } catch {
            // macOS answers from the operating system's own list and some builds refuse the read
            // outright. An empty list resolves to "no language", which is the honest outcome: the
            // row says nothing is checked rather than claiming a dictionary that is not there.
            return [];
        }
    }

    private applyLanguage(session: SpellcheckSession, language: string | null): void {
        try {
            session.setSpellCheckerEnabled(language !== null);
            if (language !== null) {
                session.setSpellCheckerLanguages([language]);
            }
        } catch {
            // `setSpellCheckerLanguages` is a no-op on macOS, where the operating system picks the
            // language. Nothing here is worth failing a project open over.
        }
    }

    /** Reconcile the session with `words`: take out what this manager added and this project lacks. */
    private applyWords(session: SpellcheckSession, words: readonly string[]): void {
        const next = [...new Set(words)];
        const wanted = new Set(next);
        for (const word of this.applied) {
            if (!wanted.has(word)) {
                try {
                    session.removeWordFromSpellCheckerDictionary(word);
                } catch {
                    // A word the session will not give back is not worth failing a project switch
                    // over; the worst case is one stale word that is never flagged.
                }
            }
        }
        const had = new Set(this.applied);
        for (const word of next) {
            if (!had.has(word)) {
                try {
                    session.addWordToSpellCheckerDictionary(word);
                } catch {
                    // Same trade as above: the word is in the document either way, which is what
                    // travels with the project.
                }
            }
        }
        this.applied = next;
    }
}
