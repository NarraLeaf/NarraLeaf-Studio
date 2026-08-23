import { describe, expect, it } from "vitest";
import { docsUrl, studioDocsUrl } from "./docsSite";

/**
 * The rule these pin is the docs site's routing, which nothing in this repository can see: the site
 * hides its default locale, so English has no prefix and every other published language does. A
 * link built the other way round is a 404 that nothing here would notice.
 */
describe("documentation links", () => {
    it("puts a published non-default locale in front of the path and the default one nowhere", () => {
        expect(studioDocsUrl("en")).toBe("https://www.narraleaf.com/docs/studio");
        expect(studioDocsUrl("zh")).toBe("https://www.narraleaf.com/zh/docs/studio");
        expect(docsUrl("/docs/studio/story", "zh")).toBe("https://www.narraleaf.com/zh/docs/studio/story");
    });

    it("falls back to English for a locale the docs site does not publish", () => {
        // Studio's locale list is open - a plugin can register one (see shared/i18n/locales.ts) -
        // and prefixing an unpublished locale would link to nothing. Japanese is a locale Studio
        // ships and the site does not, so it is the case this actually has to get right.
        for (const locale of ["ja", "de", "zh-TW", "", "en-GB"]) {
            expect(studioDocsUrl(locale)).toBe("https://www.narraleaf.com/docs/studio");
        }
    });
});
