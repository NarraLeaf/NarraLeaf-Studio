// @vitest-environment jsdom

/**
 * The wiring, not the rule.
 *
 * `documentLanguage.test` covers what the installer does with an answer; this covers where the
 * answer comes from and where it lands - the two halves `index.tsx` hands it, which no type can
 * check are the right ones. The publisher below is the very one `GameApp` writes the game's
 * language into, so a rename or a swapped seam fails here instead of shipping a document that
 * silently keeps saying English.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
    getActiveProjectLocale,
    setActiveProjectLocale,
    subscribeActiveProjectLocale,
} from "@shared/typography/projectFonts";
import { installDocumentLanguage } from "./documentLanguage";

function install(): () => void {
    return installDocumentLanguage({
        getLanguage: getActiveProjectLocale,
        subscribe: subscribeActiveProjectLocale,
        apply: language => {
            document.documentElement.lang = language;
        },
    });
}

afterEach(() => {
    setActiveProjectLocale("");
    document.documentElement.lang = "";
});

describe("the runtime's document language wiring", () => {
    it("puts the language the game publishes on the document", () => {
        const uninstall = install();
        setActiveProjectLocale("ja");
        expect(document.documentElement.lang).toBe("ja");
        uninstall();
    });

    it("follows a language change without being reinstalled", () => {
        const uninstall = install();
        setActiveProjectLocale("ja");
        setActiveProjectLocale("zh-CN");
        expect(document.documentElement.lang).toBe("zh-CN");
        uninstall();
    });

    it("leaves the shell's own attribute alone for a project with no language", () => {
        document.documentElement.lang = "en";
        const uninstall = install();
        expect(document.documentElement.lang).toBe("en");
        uninstall();
    });
});
