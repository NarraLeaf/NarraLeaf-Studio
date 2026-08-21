import { afterEach, describe, expect, it } from "vitest";
import { setActiveProjectFonts } from "@shared/typography/projectFonts";
import type { FontCoverage } from "@shared/typography/fontCoverage";
import type { LocalizationDocument } from "@shared/types/localization";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { AssetType } from "../../workspace/services/assets/assetTypes";
import type { LintAssetEntry, LintContext } from "../context";
import { createTestLintContext } from "../testContext";
import type { LintFinding, LintRuleId } from "../types";
import { dialogueBlock, sceneOf, storyEntryOf, textSegment } from "./text/testFixtures";
import { TYPOGRAPHY_LINT_RULES } from "./typography";

/**
 * `typography/glyph-coverage` and `typography/locale-no-font`.
 *
 * Both rules read the project's stack from the module-level store that three hosts publish into, the
 * way `brand/broken-link` reads the active palette - so every case here publishes one and the
 * teardown clears it, or the next test would be checked against this one's fonts.
 */

function runRule(id: LintRuleId, ctx: LintContext): Promise<LintFinding[]> {
    const rule = TYPOGRAPHY_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    return Promise.resolve(rule.run(ctx, rule.options
        ? Object.fromEntries(Object.entries(rule.options).map(([key, spec]) => [key, spec.default]))
        : {}));
}

/** A library entry, so a message about a font can name it. */
function fontAsset(id: string, name: string): LintAssetEntry {
    return { id, type: AssetType.Font, name, ext: "ttf", meta: {}, tags: [] };
}

/** A font that draws exactly these code points and nothing else. */
function drawing(...codePoints: number[]): FontCoverage {
    const ranges = [...codePoints].sort((a, b) => a - b).map(point => [point, point] as const);
    return { ranges, count: ranges.length, codePages: [] };
}

const LATIN = drawing(...Array.from({ length: 0x5f }, (_, i) => 0x20 + i));
const KANA = drawing(0x3053, 0x3093, 0x306b, 0x3061, 0x306f);

/** A context whose one scene holds one spoken line. */
function contextSaying(text: string, overrides: Partial<LintContext> = {}): LintContext {
    return createTestLintContext({
        stories: [storyEntryOf("s1", "Story", [
            sceneOf("sc1", "Scene", [dialogueBlock("b1", textSegment("t1", text, "dialogue"))]),
        ])],
        ...overrides,
    });
}

/** An io whose font probe answers from a table, and refuses anything not in it. */
function ioWith(
    coverage: Record<string, FontCoverage | "unreadable" | "collection">,
): Partial<LintContext["io"]> {
    return {
        probeFontCoverage: async assetId => {
            const found = coverage[assetId];
            if (found === "unreadable") {
                return { ok: false, reason: "malformed" };
            }
            if (found === "collection") {
                return { ok: false, reason: "unloadable-container" };
            }
            return found
                ? { ok: true, coverage: found }
                // What a built-in system stack and a deleted asset both answer.
                : { ok: false, reason: "not-a-font" };
        },
    };
}

afterEach(() => {
    setActiveProjectFonts([]);
});

describe("typography/glyph-coverage", () => {
    it("says nothing when the project has declared no fonts", async () => {
        // Text set in the host's own typeface: what it covers is not ours to assert, and this is
        // what keeps every project written before the feature from lighting up.
        const ctx = contextSaying("こんにちは", { io: ioWith({}) as LintContext["io"] });
        expect(await runRule("typography/glyph-coverage", ctx)).toEqual([]);
    });

    it("reports a character the project's fonts cannot draw", async () => {
        setActiveProjectFonts([{ assetId: "latin" }]);
        const ctx = contextSaying("Hi こ", { io: ioWith({ latin: LATIN }) as LintContext["io"] });

        const findings = await runRule("typography/glyph-coverage", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0]!.messageKey).toBe("lint.rule.typographyGlyphCoverage.message");
        expect(findings[0]!.messageParams).toEqual({ character: "こ", count: 1 });
        expect(findings[0]!.location).toMatchObject({ kind: "story", storyId: "s1", blockId: "b1" });
    });

    it("says nothing when some font on the stack has the character", async () => {
        setActiveProjectFonts([{ assetId: "latin" }, { assetId: "kana" }]);
        const ctx = contextSaying("Hi こ", { io: ioWith({ latin: LATIN, kana: KANA }) as LintContext["io"] });
        expect(await runRule("typography/glyph-coverage", ctx)).toEqual([]);
    });

    /**
     * One finding per character, not per line. A Latin face asked to set a Japanese script is
     * missing the same characters on every line of the game, and a report of thousands of identical
     * findings is one nobody reads.
     */
    it("counts a character's appearances rather than repeating it", async () => {
        setActiveProjectFonts([{ assetId: "latin" }]);
        const ctx = createTestLintContext({
            stories: [storyEntryOf("s1", "Story", [
                sceneOf("sc1", "Scene", [
                    dialogueBlock("b1", textSegment("t1", "こ", "dialogue")),
                    dialogueBlock("b2", textSegment("t2", "こ", "dialogue")),
                ]),
            ])],
            io: ioWith({ latin: LATIN }) as LintContext["io"],
        });

        const findings = await runRule("typography/glyph-coverage", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0]!.messageParams).toMatchObject({ character: "こ", count: 2 });
        // The first appearance, which is where an author would go to see it.
        expect(findings[0]!.location).toMatchObject({ blockId: "b1" });
    });

    it("passes over the characters no typeface is expected to carry", async () => {
        setActiveProjectFonts([{ assetId: "latin" }]);
        // A zero-width joiner, a private-use code point and an emoji - none of them a defect.
        const ctx = contextSaying("Hi‍\u{1f600}", { io: ioWith({ latin: LATIN }) as LintContext["io"] });
        expect(await runRule("typography/glyph-coverage", ctx)).toEqual([]);
    });

    /**
     * A built-in system stack resolves to whatever the player's machine has, which is exactly what a
     * shipped game must not depend on. It contributes no coverage and does not silence the rule.
     */
    it("does not let a built-in system stack stand in for coverage", async () => {
        setActiveProjectFonts([{ assetId: "builtin:font:sans-serif" }]);
        const ctx = contextSaying("こ", { io: ioWith({}) as LintContext["io"] });

        const findings = await runRule("typography/glyph-coverage", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0]!.messageParams).toMatchObject({ character: "こ" });
    });

    /** The character might be in exactly that font, so nothing below can be trusted - and it says so. */
    it("reports a font it could not read instead of checking without it", async () => {
        setActiveProjectFonts([{ assetId: "broken" }]);
        const ctx = contextSaying("こ", {
            assets: [fontAsset("broken", "Wrecked Serif")],
            io: ioWith({ broken: "unreadable" }) as LintContext["io"],
        });

        const findings = await runRule("typography/glyph-coverage", ctx);

        expect(findings).toEqual([{
            ruleId: "typography/glyph-coverage",
            messageKey: "lint.rule.typographyGlyphCoverage.messageUnreadable",
            // The library's name, not the asset id: these findings are filed under the project, so
            // the locator column prints nothing and this is all the author gets to identify it by.
            messageParams: { font: "Wrecked Serif" },
            location: { kind: "project" },
        }]);
    });

    /**
     * The opposite of the unreadable case. A collection parses and is known to render nothing, so
     * the useful sentence is that the file cannot be used - said once - and the rest of the check is
     * more accurate without it rather than untrustworthy.
     */
    it("reports a font collection once and keeps checking without it", async () => {
        setActiveProjectFonts([{ assetId: "collection" }, { assetId: "latin" }]);
        const ctx = contextSaying("Hi こ", {
            assets: [fontAsset("collection", "MS Gothic.ttc")],
            io: ioWith({ collection: "collection", latin: LATIN }) as LintContext["io"],
        });

        const findings = await runRule("typography/glyph-coverage", ctx);

        expect(findings).toHaveLength(2);
        expect(findings[0]).toEqual({
            ruleId: "typography/glyph-coverage",
            messageKey: "lint.rule.typographyGlyphCoverage.messageUnloadable",
            messageParams: { font: "MS Gothic.ttc" },
            location: { kind: "project" },
        });
        // The Latin face still answers for the rest, so the kana is still reported.
        expect(findings[1]!.messageParams).toMatchObject({ character: "こ" });
    });

    it("states the cap rather than truncating in silence", async () => {
        setActiveProjectFonts([{ assetId: "latin" }]);
        const many = Array.from({ length: 25 }, (_, i) => String.fromCodePoint(0x3041 + i)).join("");
        const ctx = contextSaying(many, { io: ioWith({ latin: LATIN }) as LintContext["io"] });

        const findings = await runRule("typography/glyph-coverage", ctx);

        expect(findings).toHaveLength(21);
        expect(findings.at(-1)).toMatchObject({
            messageKey: "lint.rule.typographyGlyphCoverage.messageMore",
            messageParams: { count: 5 },
        });
    });
});

describe("typography/glyph-coverage / languages", () => {
    const LOCALIZATION = (units: Record<string, string>): LintContext["localization"] => ({
        sourceLocale: "en",
        targetLocales: ["ja"],
        documents: new Map<string, LocalizationDocument>([["ja", {
            schemaVersion: 1,
            locale: "ja",
            units: Object.fromEntries(
                Object.entries(units).map(([id, target]) => [id, { target, sourceHash: "", status: "translated" as const }]),
            ),
        }]]),
    });

    /**
     * The whole point of the model: one list, and each language resolves the rungs that serve it. The
     * Japanese face is restricted to `ja`, so English is checked without it and Japanese with it.
     */
    it("checks each language against the rungs that serve it", async () => {
        setActiveProjectFonts([{ assetId: "kana", locales: ["ja"] }, { assetId: "latin" }]);
        const ctx = contextSaying("Hi", {
            localization: LOCALIZATION({ t1: "こんにちは" }),
            io: ioWith({ latin: LATIN, kana: KANA }) as LintContext["io"],
        });

        expect(await runRule("typography/glyph-coverage", ctx)).toEqual([]);
    });

    it("names the language a character is missing in", async () => {
        // The Japanese face is gone from the stack, so the translated line has nothing to draw with.
        setActiveProjectFonts([{ assetId: "latin" }]);
        const ctx = contextSaying("Hi", {
            localization: LOCALIZATION({ t1: "こ" }),
            io: ioWith({ latin: LATIN }) as LintContext["io"],
        });

        const findings = await runRule("typography/glyph-coverage", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0]!.messageKey).toBe("lint.rule.typographyGlyphCoverage.messageInLanguage");
        expect(findings[0]!.messageParams).toMatchObject({ character: "こ", language: "ja" });
    });

    /**
     * A half-translated project renders its source text in every language it has not reached yet, so
     * checking a target locale against only the lines that were translated would pass a project whose
     * untranslated half cannot be drawn.
     */
    it("checks a target language against the source text of what is untranslated", async () => {
        setActiveProjectFonts([{ assetId: "kana", locales: ["ja"] }]);
        const ctx = contextSaying("Hi", {
            localization: LOCALIZATION({}),
            io: ioWith({ kana: KANA }) as LintContext["io"],
        });

        const findings = await runRule("typography/glyph-coverage", ctx);

        // "H" and "i" in `ja`, which the kana face has not got; `en` has no rung at all and is
        // `locale-no-font`'s finding rather than this one's.
        expect(findings.map(finding => finding.messageParams?.character)).toEqual(["H", "i"]);
        expect(findings.every(finding => finding.messageParams?.language === "ja")).toBe(true);
    });

    /** A widget that named its own face keeps it in every language; a restriction is about defaults. */
    it("puts a widget's own font in front of the language's stack", async () => {
        setActiveProjectFonts([{ assetId: "latin" }]);
        const uiDocument = {
            surfaces: [{ id: "s1", name: "Main Menu", rootElementId: "root" }],
            elements: {
                root: { id: "root", type: "nl.root", childrenIds: ["label"] },
                label: {
                    id: "label",
                    type: "nl.text",
                    name: "Greeting",
                    childrenIds: [],
                    props: { text: "こ", fontAssetId: "kana" },
                },
            },
        } as unknown as UIDocument;
        const ctx = createTestLintContext({
            uiDocument,
            io: ioWith({ latin: LATIN, kana: KANA }) as LintContext["io"],
        });

        expect(await runRule("typography/glyph-coverage", ctx)).toEqual([]);
    });
});

describe("typography/locale-no-font", () => {
    const withLanguages = (io: Partial<LintContext["io"]> = {}): LintContext => createTestLintContext({
        localization: {
            sourceLocale: "en",
            targetLocales: ["ja"],
            documents: new Map(),
        },
        io: io as LintContext["io"],
    });

    it("says nothing while every rung serves every language", async () => {
        setActiveProjectFonts([{ assetId: "latin" }]);
        expect(await runRule("typography/locale-no-font", withLanguages())).toEqual([]);
    });

    /**
     * Reachable only through a restriction, and easy to reach: pin two fonts to two languages, add a
     * third language, and it is set in the host's typeface while everything else is set in the
     * author's.
     */
    it("reports a language every rung was restricted away from", async () => {
        setActiveProjectFonts([{ assetId: "kana", locales: ["ja"] }]);

        const findings = await runRule("typography/locale-no-font", withLanguages());

        expect(findings).toEqual([{
            ruleId: "typography/locale-no-font",
            messageKey: "lint.rule.typographyLocaleNoFont.message",
            messageParams: { language: "en" },
            location: { kind: "project" },
        }]);
    });

    it("says nothing about a project that declared no fonts at all", async () => {
        expect(await runRule("typography/locale-no-font", withLanguages())).toEqual([]);
    });

    it("says nothing about a project with no languages", async () => {
        setActiveProjectFonts([{ assetId: "kana", locales: ["ja"] }]);
        expect(await runRule("typography/locale-no-font", createTestLintContext())).toEqual([]);
    });
});
