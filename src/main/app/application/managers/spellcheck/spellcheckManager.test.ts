import { describe, expect, it } from "vitest";
import {
    SPELLCHECK_FOLLOW_PROJECT,
    SPELLCHECK_OFF,
} from "@shared/types/spellcheck";
import { SpellcheckManager, type SpellcheckSession } from "./spellcheckManager";

/**
 * The session end of the project dictionary.
 *
 * The case that matters is the project switch. Chromium's custom dictionary is a file in the
 * Electron profile, so a word added for one project stays there until something takes it back out -
 * and nothing else would. Left alone, every cast of every project ever opened on this computer would
 * pile up in one list, and the symptom is the absence of a symptom: names that should be flagged
 * simply never are, in projects that never heard of them.
 *
 * Nothing here runs Electron. `SpellcheckSession` is the five members the manager touches, which is
 * also why it is injected.
 */

/** The languages Electron reports. Real ones, including the pairs that make matching interesting. */
const AVAILABLE = ["cs", "de", "en-AU", "en-CA", "en-GB", "en-GB-oxendict", "en-US", "es", "fr", "ru"];

type Harness = {
    manager: SpellcheckManager;
    session: SpellcheckSession;
    /** Exactly what the session holds now, in the order it was added. */
    words: () => string[];
    languages: () => string[];
    enabled: () => boolean;
};

function createHarness(setting: string = SPELLCHECK_FOLLOW_PROJECT, available: string[] = AVAILABLE): Harness {
    const words = new Set<string>();
    let languages: string[] = [];
    let enabled = false;

    const session: SpellcheckSession = {
        availableSpellCheckerLanguages: available,
        setSpellCheckerEnabled: value => {
            enabled = value;
        },
        setSpellCheckerLanguages: value => {
            languages = [...value];
        },
        addWordToSpellCheckerDictionary: word => {
            words.add(word);
            return true;
        },
        removeWordFromSpellCheckerDictionary: word => words.delete(word),
    };

    return {
        manager: new SpellcheckManager(() => session, () => setting),
        session,
        words: () => [...words],
        languages: () => languages,
        enabled: () => enabled,
    };
}

describe("the words a project puts in the session", () => {
    it("loads this project's words", () => {
        const harness = createHarness();

        harness.manager.configure({ sourceLocale: "en-GB", words: ["Anyo", "Kamurocho"] });

        expect(harness.words()).toEqual(["Anyo", "Kamurocho"]);
    });

    it("takes the previous project's words out when the next one arrives", () => {
        const harness = createHarness();

        harness.manager.configure({ sourceLocale: "en-GB", words: ["Anyo", "Kamurocho"] });
        harness.manager.configure({ sourceLocale: "en-GB", words: ["Wilhelmina"] });

        // Not merged. A name from the closed project would be accepted here, in a project that has
        // never heard of it, and nothing anywhere would say why it stopped being flagged.
        expect(harness.words()).toEqual(["Wilhelmina"]);
    });

    it("keeps a word both projects share without removing and re-adding it", () => {
        const harness = createHarness();
        let removals = 0;
        const session = harness.session as { removeWordFromSpellCheckerDictionary: (word: string) => boolean };
        const original = session.removeWordFromSpellCheckerDictionary;
        session.removeWordFromSpellCheckerDictionary = word => {
            removals += 1;
            return original(word);
        };

        harness.manager.configure({ sourceLocale: "en-GB", words: ["Anyo", "shared"] });
        harness.manager.configure({ sourceLocale: "en-GB", words: ["shared", "Wilhelmina"] });

        expect(harness.words()).toEqual(["shared", "Wilhelmina"]);
        expect(removals).toBe(1);
    });

    it("empties the session when the project closes", () => {
        const harness = createHarness();

        harness.manager.configure({ sourceLocale: "en-GB", words: ["Anyo", "Kamurocho"] });
        harness.manager.clear();

        expect(harness.words()).toEqual([]);
        expect(harness.enabled()).toBe(false);
        expect(harness.manager.getStatus().language).toBeNull();
    });

    it("re-clearing is not an error and takes nothing else out", () => {
        const harness = createHarness();

        harness.manager.configure({ sourceLocale: "en-GB", words: ["Anyo"] });
        harness.manager.clear();
        harness.manager.clear();

        expect(harness.words()).toEqual([]);
    });
});

describe("the language the session is told to check", () => {
    it("takes the project's language when the author follows it", () => {
        const harness = createHarness();

        const status = harness.manager.configure({ sourceLocale: "en-GB", words: [] });

        expect(status.language).toBe("en-GB");
        expect(harness.languages()).toEqual(["en-GB"]);
        expect(harness.enabled()).toBe(true);
    });

    it("takes a regional dictionary for a language named without a region", () => {
        const harness = createHarness();

        // There is no bare `en` dictionary; the settings row is where an author who wants a
        // different regional English says so.
        expect(harness.manager.configure({ sourceLocale: "en", words: [] }).language).toBe("en-AU");
        // And a language that does have a bare entry gets it rather than a regional one.
        expect(harness.manager.configure({ sourceLocale: "de-AT", words: [] }).language).toBe("de");
    });

    it("checks nothing for a language Chromium has no dictionary for", () => {
        const harness = createHarness();

        // Chinese and Japanese have no spelling in the hunspell sense. This is the correct
        // behaviour, and the settings row states it rather than showing a live-looking control.
        const status = harness.manager.configure({ sourceLocale: "ja", words: ["主人公"] });

        expect(status.language).toBeNull();
        expect(harness.enabled()).toBe(false);
        // The words still go in. The dictionary is the project's term list first and a spellchecker
        // input second, and it is not gated on the language being checkable.
        expect(harness.words()).toEqual(["主人公"]);
    });

    it("checks nothing for a project that has not chosen a language", () => {
        const harness = createHarness();

        expect(harness.manager.configure({ sourceLocale: "", words: [] }).language).toBeNull();
    });

    it("honours a language the author named outright, whatever the project is written in", () => {
        const harness = createHarness("en-US");

        expect(harness.manager.configure({ sourceLocale: "ja", words: [] }).language).toBe("en-US");
    });

    it("checks nothing when the author turned it off", () => {
        const harness = createHarness(SPELLCHECK_OFF);

        const status = harness.manager.configure({ sourceLocale: "en-GB", words: ["Anyo"] });

        expect(status.language).toBeNull();
        expect(harness.enabled()).toBe(false);
        expect(harness.words()).toEqual(["Anyo"]);
    });
});

describe("what the Settings window is told", () => {
    it("lists the session's languages before any project has configured one", () => {
        const harness = createHarness();

        const status = harness.manager.getStatus();

        expect(status.available).toEqual(AVAILABLE);
        expect(status.sourceLocale).toBe("");
    });

    it("reports the project's language and the setting behind it", () => {
        const harness = createHarness();

        harness.manager.configure({ sourceLocale: "ja", words: [] });

        expect(harness.manager.getStatus()).toStrictEqual({
            sourceLocale: "ja",
            setting: SPELLCHECK_FOLLOW_PROJECT,
            language: null,
            available: AVAILABLE,
        });
    });
});
