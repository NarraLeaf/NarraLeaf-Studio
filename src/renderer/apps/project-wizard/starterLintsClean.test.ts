/**
 * A project made from the starter template passes its own interface and story checks, in each of
 * the three languages the template is written in.
 *
 * The template is the first project an author opens, and the lint panel is one of the first things
 * they see in it. It used to open on twenty-six warnings about work nobody had done yet - words on a
 * page no player could reach, three scenes each fading to the picture already on screen, placeholder
 * words in list rows that the rows' own data replaces - which teaches, on the first morning, that a
 * warning is something to scroll past.
 *
 * Three categories, run the way the lint panel runs them, because they are the three a context built
 * from the template's files can answer honestly: the story rules read the story, the interface
 * rules read the interface and blueprint documents plus the language list, and the localization
 * rules read the translation files the template ships beside them - for the script's lines and for
 * the interface's own words alike. The rest read asset bytes or the reference index a running Studio
 * builds; `--lint` on a freshly created project is the check for those.
 *
 * A zero is what a sweep that checks nothing also produces, so the same context is run once more
 * with the game's title missing its translation, and has to report exactly that.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { LocalizationDocument, LocalizationKeysDocument } from "@shared/types/localization";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { createTestLintContext, LINT_RULES, runLintRules } from "@/lib/lint";
import type { LintContext } from "@/lib/lint/context";
import { listStories, readStoryDocument } from "@/lib/story-cli/project";

/**
 * The skeleton, and the copy of its screens without its sample game that a port starts from
 * (`scripts/gen-skeleton-port.mjs`). Taking the sample out must not leave a page, a blueprint or a
 * translation pointing at something that went with it.
 */
const TEMPLATES = ["skeleton", "skeleton-port"] as const;

/**
 * Each language a template ships, as the wizard lands it: the English content, with a variant's
 * files laid over it when the author writes in that language. `sourceLocale` is what the wizard
 * writes for an author reading Studio in that language.
 */
const LANGUAGES = TEMPLATES.flatMap(template => [
    { name: `${template} in English`, template, variant: null, sourceLocale: "en" },
    { name: `${template} in Chinese`, template, variant: "content.zh", sourceLocale: "zh" },
    { name: `${template} in Japanese`, template, variant: "content.ja", sourceLocale: "ja" },
] as const);

type Language = (typeof LANGUAGES)[number];

function templateDir(language: Language): string {
    return path.join(process.cwd(), "resources/templates", language.template);
}

const CATEGORIES = new Set(["story", "ui", "localization"]);

/** The file a project made in this language ends up with: the variant's copy when it has one. */
function landed(language: Language, relative: string): string {
    const override = language.variant ? path.join(templateDir(language), language.variant, relative) : null;
    return override && fs.existsSync(override) ? override : path.join(templateDir(language), "content", relative);
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

/** The translation files a project made in this language receives. */
function translationFiles(language: Language): string[] {
    const dir = path.dirname(landed(language, "editor/localization/keys.json"));
    return fs
        .readdirSync(dir)
        .filter(name => name.endsWith(".json") && name !== "keys.json")
        .map(name => path.join(dir, name));
}

/** The languages the project registers: its own, and one per translation file it received. */
function targetLocales(language: Language): string[] {
    return [language.sourceLocale, ...translationFiles(language).map(file => path.basename(file, ".json"))];
}

/** Each translation file, keyed by the language it is for. */
function translationDocuments(language: Language): Map<string, LocalizationDocument> {
    return new Map(
        translationFiles(language).map(file => [path.basename(file, ".json"), readJson<LocalizationDocument>(file)]),
    );
}

/** The named keys - the menu's own words - mapped to the words they say in the source language. */
function localizationKeys(language: Language): Map<string, string> {
    const { keys } = readJson<LocalizationKeysDocument>(landed(language, "editor/localization/keys.json"));
    return new Map(Object.entries(keys).map(([name, entry]) => [name, entry.sourceText]));
}

function contextFor(language: Language): LintContext {
    const storyDir = path.join(templateDir(language), language.variant ?? "content");
    return createTestLintContext({
        uiDocument: readJson<UIDocument>(landed(language, "editor/ui/uidoc.json")),
        blueprintDocument: migrateBlueprintDocumentToLatest(
            readJson<{ blueprintDocument: unknown }>(landed(language, "editor/ui/uigraphs.json")).blueprintDocument,
        ),
        stories: listStories(storyDir).map(story => ({
            id: story.id,
            name: story.name,
            document: readStoryDocument(storyDir, story.id).document,
        })),
        // The cast, so a row that brings a character on stage names somebody the project has.
        characters: readJson<{ characters: { profile: { id: string; name: string } }[] }>(
            landed(language, "editor/services/character.json"),
        ).characters.map(({ profile }) => ({ id: profile.id, name: profile.name, assetIds: [] })),
        localization: {
            sourceLocale: language.sourceLocale,
            targetLocales: targetLocales(language),
            documents: translationDocuments(language),
        },
        localizationKeys: localizationKeys(language),
    });
}

async function sweep(context: LintContext): Promise<string[]> {
    const report = await runLintRules(context, {
        rules: LINT_RULES.filter(rule => CATEGORIES.has(rule.category)),
    });
    return report.entries.map(entry => `${entry.ruleId} ${JSON.stringify(entry.location)}`);
}

describe.each(LANGUAGES)("a project made from the $name template", language => {
    it("has a second language, so the interface rules have something to say", () => {
        expect(targetLocales(language).length).toBeGreaterThan(1);
    });

    it("passes the story, interface and localization checks with nothing to report but what is left to write", async () => {
        // The port template's one scene is empty on purpose - it is where the ported story goes - and
        // saying so is the only thing the checks should have to say about it.
        const expected = language.template === "skeleton-port" ? ["story/empty-scene"] : [];
        expect((await sweep(contextFor(language))).map(finding => finding.split(" ")[0])).toEqual(expected);
    });

    it("says so only because it can report: the game's title, with its translation gone, is found", async () => {
        // The title is the one widget whose own words a player reads; since v13 they are translated
        // without anything on the widget asking for it.
        const context = contextFor(language);
        const [, document] = [...context.localization!.documents][0];
        const unitId = Object.keys(document.units).find(id => id.startsWith("ui:") && id.endsWith(".text"));
        expect(unitId).toBeDefined();
        delete document.units[unitId!];
        const findings = await sweep(context);
        expect(findings.filter(finding => finding.startsWith("localization/missing"))).toHaveLength(1);
    });

    it("says so only because it can report: a menu word whose translation is gone is found", async () => {
        const context = contextFor(language);
        const [locale, document] = [...context.localization!.documents][0];
        const unitId = Object.keys(document.units).find(id => id.startsWith("key:"));
        expect(unitId).toBeDefined();
        delete document.units[unitId!];
        const findings = await sweep(context);
        expect(findings.filter(finding => finding.startsWith("localization/missing"))).toHaveLength(1);
        expect(locale).not.toBe(language.sourceLocale);
    });
});
