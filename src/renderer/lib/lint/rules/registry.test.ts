import { describe, expect, it } from "vitest";
import { flattenCatalog } from "@shared/i18n/flatten";
import { en } from "@shared/i18n/catalog/en";
import { zh } from "@shared/i18n/catalog/zh";
import { LINT_CATEGORY_ORDER, deriveLintRuleSlug, type LintRuleId } from "../types";
import { LINT_RULES, LINT_RULES_BY_CATEGORY, getLintRule } from "./index";

/**
 * The registry's own guards.
 *
 * The i18n assertion is the one that earns its keep: a rule ships with a `slug` and the settings
 * panel renders `lint.rule.<slug>.title` for it, so a slug that has no matching catalogue entry is
 * a rule whose row in the settings list is blank - and nothing else in the build would notice.
 * Asserting against BOTH catalogues (not just en) means a rule cannot ship English-only either.
 */

/**
 * Every rule id, written out. The registry is checked against this literal rather than against its
 * own length, so adding a rule is a deliberate edit here as well - which is the point: a rule that
 * appears without anyone deciding it should is exactly what a lint registry must not allow.
 */
const EXPECTED_RULE_IDS: readonly LintRuleId[] = [
    "assets/unused",
    "assets/missing",
    "assets/unreadable",
    "assets/oversized",
    "portability/asset-name",
    "portability/case-collision",
    "portability/media-format",
    "network/fetch-disallowed",
    "network/fetch-not-allowlisted",
    "story/invalid-command",
    "story/goto-missing",
    "story/label-duplicate",
    "story/label-unused",
    "story/jump-missing",
    "story/empty-choice",
    "story/dead-end",
    "story/unreachable-scene",
    "story/empty-scene",
    "story/app-tag-unknown",
    "story/cut-point-orphan",
    "story/cut-point-unreachable",
    "blueprint/reference-missing",
    "blueprint/unreachable-node",
    "blueprint/empty-event",
    "blueprint/save-field-empty",
    "variables/undeclared",
    "variables/unused",
    "variables/name-collision",
    "variables/random-outside-assignment",
    "text/overlong",
    "text/empty",
    "localization/missing",
    "localization/stale",
    "localization/orphan",
    "voice/missing",
    "voice/stale",
    "voice/orphan",
    "brand/broken-link",
];

const EN_KEYS = flattenCatalog(en);
const ZH_KEYS = flattenCatalog(zh);

describe("lint rule registry", () => {
    it("contains exactly the planned rule set", () => {
        expect([...LINT_RULES].map(rule => rule.id).sort()).toEqual([...EXPECTED_RULE_IDS].sort());
        expect(LINT_RULES).toHaveLength(38);
    });

    it("gives every rule a unique id", () => {
        const ids = LINT_RULES.map(rule => rule.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("prefixes every rule id with its category", () => {
        for (const rule of LINT_RULES) {
            expect(rule.id.startsWith(`${rule.category}/`), `${rule.id} is not in category ${rule.category}`).toBe(true);
        }
    });

    it("derives every slug from its id", () => {
        for (const rule of LINT_RULES) {
            expect(rule.slug, `${rule.id} carries the wrong slug`).toBe(deriveLintRuleSlug(rule.id));
        }
    });

    it("resolves every rule through getLintRule", () => {
        for (const id of EXPECTED_RULE_IDS) {
            expect(getLintRule(id)?.id, `${id} is not resolvable`).toBe(id);
        }
    });

    for (const [locale, keys] of [["en", EN_KEYS], ["zh", ZH_KEYS]] as const) {
        it(`translates every rule's title, description and message in ${locale}`, () => {
            const missing: string[] = [];
            for (const rule of LINT_RULES) {
                for (const leaf of ["title", "description", "message"]) {
                    const key = `lint.rule.${rule.slug}.${leaf}`;
                    if (!keys.get(key)) {
                        missing.push(key);
                    }
                }
            }
            expect(
                missing,
                `${locale} is missing ${missing.length} lint rule string(s). A rule whose keys are absent\n` +
                    `renders as a blank row in Project -> Linting:\n  ${missing.join("\n  ")}\n`,
            ).toEqual([]);
        });
    }

    it("partitions the registry by category with nothing lost", () => {
        const partitioned = LINT_CATEGORY_ORDER.flatMap(category => LINT_RULES_BY_CATEGORY[category]);
        expect(partitioned).toHaveLength(LINT_RULES.length);
        expect(new Set(partitioned.map(rule => rule.id))).toEqual(new Set(LINT_RULES.map(rule => rule.id)));
        for (const category of LINT_CATEGORY_ORDER) {
            for (const rule of LINT_RULES_BY_CATEGORY[category]) {
                expect(rule.category).toBe(category);
            }
        }
    });

    it("declares option specs only where they are called for", () => {
        const withOptions = LINT_RULES.filter(rule => rule.options).map(rule => rule.id);
        expect(withOptions).toEqual(["assets/oversized", "text/overlong"]);
        expect(getLintRule("assets/oversized")?.options?.maxMegabytes)
            .toEqual({ kind: "number", default: 64, min: 1, max: 4096 });
        const overlong = getLintRule("text/overlong");
        expect(overlong?.options?.maxChars).toEqual({ kind: "number", default: 120, min: 1, max: 2000 });
        expect(overlong?.options?.countMode).toEqual({
            kind: "enum",
            default: "eastAsianWidth",
            values: ["eastAsianWidth", "codePoints"],
        });
    });
});
