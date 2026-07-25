import { describe, expect, it } from "vitest";
import { flattenCatalog } from "../flatten";
import { en } from "./en";
import { zh } from "./zh";

/**
 * Catalog parity between the source locale and zh.
 *
 * `en` is the source of truth (see `./types.ts`) and a key zh omits falls back to
 * English at runtime, so a missing translation throws nothing, fails no test, and
 * looks fine in dev - it surfaces only as stray English in a zh-first UI, usually
 * after it ships. `satisfies LocaleNamespace<…>` catches a *stray* zh key but by
 * design permits a missing one, because locales are translated incrementally.
 * This test closes that side: every en key must be translated.
 *
 * The one legitimate divergence is plural forms. zh has no singular/plural
 * distinction, so it translates `.other` only and lets `.one` fall back. That
 * exception is encoded structurally - a `.one` leaf whose plural group also has an
 * `.other` leaf - rather than as a list of key names, so new plurals are covered
 * automatically, a leaf that merely happens to be named `one` is not exempt, and
 * every other kind of divergence still fails.
 */

const enKeys = new Set(flattenCatalog(en).keys());
const zhKeys = new Set(flattenCatalog(zh).keys());

/** `a.b.one` -> `a.b`; any other key -> null. */
function pluralBase(key: string): string | null {
    const base = key.replace(/\.one$/, "");
    return base === key ? null : base;
}

/**
 * Whether zh may omit this key: it is the `.one` form of a plural group. Requiring
 * the sibling `.other` keeps the exemption to real plurals - an enum value or flag
 * spelled `one` has no such sibling and stays required.
 */
function isEnglishOnlyPluralForm(key: string): boolean {
    const base = pluralBase(key);
    return base !== null && enKeys.has(`${base}.other`);
}

function list(keys: string[]): string {
    return keys.sort().join("\n  ");
}

describe("catalog parity", () => {
    it("translates every en key in zh, except English-only plural forms", () => {
        // Guards against a vacuous pass if the catalogs or `flatten` ever stop
        // producing keys - every assertion below would trivially hold.
        expect(enKeys.size).toBeGreaterThan(0);

        const missing = [...enKeys].filter((key) => !zhKeys.has(key) && !isEnglishOnlyPluralForm(key));

        expect(
            missing,
            `zh is missing ${missing.length} key(s) that en defines. Translate them in the matching\n` +
                `src/shared/i18n/catalog/zh/<namespace>.ts - or, if the key should not exist at all,\n` +
                `remove it from en:\n  ${list(missing)}\n`,
        ).toEqual([]);
    });

    it("defines every zh key in en", () => {
        const stray = [...zhKeys].filter((key) => !enKeys.has(key));

        expect(
            stray,
            `en is missing ${stray.length} key(s) that zh defines. en is the source of truth, so this is\n` +
                `a typo in zh or a key dropped from en without updating zh. Nothing reads these strings:\n` +
                `  ${list(stray)}\n`,
        ).toEqual([]);
    });
});
