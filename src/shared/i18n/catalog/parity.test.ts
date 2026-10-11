import { describe, expect, it } from "vitest";
import { flattenCatalog } from "../flatten";
import { SOURCE_LOCALE } from "../locales";
import { CATALOGS } from "./index";
import { en } from "./en";

/**
 * Catalog parity between the source locale and every other built-in locale.
 *
 * `en` is the source of truth (see `./types.ts`) and a key a translation omits falls
 * back to English at runtime, so a missing translation throws nothing, fails no test,
 * and looks fine in dev - it surfaces only as stray English in a zh-first or ja-first
 * UI, usually after it ships. `satisfies LocaleNamespace<…>` catches a *stray* key but
 * by design permits a missing one, because locales are translated incrementally.
 * This test closes that side: every en key must be translated.
 *
 * Written against {@link CATALOGS} rather than against a hand-listed pair, so a locale
 * added to the registry is held to the same standard from its first commit - the state
 * a shipped built-in locale has to be in, whatever the incremental type allows during
 * the work.
 *
 * The one legitimate divergence is plural forms. Neither zh nor ja has a
 * singular/plural distinction, so they translate `.other` only and let `.one` fall
 * back. That exception is encoded structurally - a `.one` leaf whose plural group also
 * has an `.other` leaf - rather than as a list of key names, so new plurals are covered
 * automatically, a leaf that merely happens to be named `one` is not exempt, and every
 * other kind of divergence still fails.
 */

const enKeys = new Set(flattenCatalog(en).keys());

/** Every built-in locale that has to match the source, i.e. all of them but the source itself. */
const TRANSLATED_LOCALES = Object.keys(CATALOGS).filter((code) => code !== SOURCE_LOCALE);

/** `a.b.one` -> `a.b`; any other key -> null. */
function pluralBase(key: string): string | null {
    const base = key.replace(/\.one$/, "");
    return base === key ? null : base;
}

/**
 * Whether a translation may omit this key: it is the `.one` form of a plural group.
 * Requiring the sibling `.other` keeps the exemption to real plurals - an enum value or
 * flag spelled `one` has no such sibling and stays required.
 */
function isEnglishOnlyPluralForm(key: string): boolean {
    const base = pluralBase(key);
    return base !== null && enKeys.has(`${base}.other`);
}

function list(keys: string[]): string {
    return keys.sort().join("\n  ");
}

describe("catalog parity", () => {
    it("has a translated locale to check", () => {
        // Guards against a vacuous pass if the catalogs or `flatten` ever stop
        // producing keys, or the registry stops naming any locale but the source -
        // every assertion below would trivially hold.
        expect(enKeys.size).toBeGreaterThan(0);
        expect(TRANSLATED_LOCALES.length).toBeGreaterThan(0);
    });

    for (const locale of TRANSLATED_LOCALES) {
        const localeKeys = new Set(flattenCatalog(CATALOGS[locale as keyof typeof CATALOGS]).keys());

        it(`translates every en key in ${locale}, except English-only plural forms`, () => {
            const missing = [...enKeys].filter((key) => !localeKeys.has(key) && !isEnglishOnlyPluralForm(key));

            expect(
                missing,
                `${locale} is missing ${missing.length} key(s) that en defines. Translate them in the matching\n` +
                    `src/shared/i18n/catalog/${locale}/<namespace>.ts - or, if the key should not exist at all,\n` +
                    `remove it from en:\n  ${list(missing)}\n`,
            ).toEqual([]);
        });

        it(`defines every ${locale} key in en`, () => {
            const stray = [...localeKeys].filter((key) => !enKeys.has(key));

            expect(
                stray,
                `en is missing ${stray.length} key(s) that ${locale} defines. en is the source of truth, so this is\n` +
                    `a typo in ${locale} or a key dropped from en without updating ${locale}. Nothing reads these\n` +
                    `strings:\n  ${list(stray)}\n`,
            ).toEqual([]);
        });
    }
});

