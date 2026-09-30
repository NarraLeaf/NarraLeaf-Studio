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
 * Two categories, run the way the lint panel runs them, because they are the two a context built
 * from the template's files can answer honestly: the story rules read the story, and the interface
 * rules read the interface and blueprint documents plus the language list. The rest read asset
 * bytes or the reference index a running Studio builds; `--lint` on a freshly created project is
 * the check for those.
 *
 * A zero is what a sweep that checks nothing also produces, so the same context is run once more
 * with the game's title no longer asking for its translation, and has to report exactly that.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { createTestLintContext, LINT_RULES, runLintRules } from "@/lib/lint";
import type { LintContext } from "@/lib/lint/context";
import { listStories, readStoryDocument } from "@/lib/story-cli/project";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");

/**
 * Each language the template ships, as the wizard lands it: the English content, with a variant's
 * files laid over it when the author writes in that language. `sourceLocale` is what the wizard
 * writes for an author reading Studio in that language.
 */
const LANGUAGES = [
    { name: "English", variant: null, sourceLocale: "en" },
    { name: "Chinese", variant: "content.zh", sourceLocale: "zh" },
    { name: "Japanese", variant: "content.ja", sourceLocale: "ja" },
] as const;

const CATEGORIES = new Set(["story", "ui"]);

/** The file a project made in this language ends up with: the variant's copy when it has one. */
function landed(variant: string | null, relative: string): string {
    const override = variant ? path.join(TEMPLATE, variant, relative) : null;
    return override && fs.existsSync(override) ? override : path.join(TEMPLATE, "content", relative);
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

/** The languages the project registers: its own, and one per translation file it received. */
function targetLocales(variant: string | null, sourceLocale: string): string[] {
    const dir = path.dirname(landed(variant, "editor/localization/keys.json"));
    const files = fs.readdirSync(dir).filter(name => name.endsWith(".json") && name !== "keys.json");
    return [sourceLocale, ...files.map(name => name.slice(0, -".json".length))];
}

function contextFor(language: (typeof LANGUAGES)[number]): LintContext {
    const storyDir = language.variant ? path.join(TEMPLATE, language.variant) : path.join(TEMPLATE, "content");
    return createTestLintContext({
        uiDocument: readJson<UIDocument>(landed(language.variant, "editor/ui/uidoc.json")),
        blueprintDocument: migrateBlueprintDocumentToLatest(
            readJson<{ blueprintDocument: unknown }>(landed(language.variant, "editor/ui/uigraphs.json")).blueprintDocument,
        ),
        stories: listStories(storyDir).map(story => ({
            id: story.id,
            name: story.name,
            document: readStoryDocument(storyDir, story.id).document,
        })),
        // The cast, so a row that brings a character on stage names somebody the project has.
        characters: readJson<{ characters: { profile: { id: string; name: string } }[] }>(
            landed(language.variant, "editor/services/character.json"),
        ).characters.map(({ profile }) => ({ id: profile.id, name: profile.name, assetIds: [] })),
        localization: {
            sourceLocale: language.sourceLocale,
            targetLocales: targetLocales(language.variant, language.sourceLocale),
            documents: new Map(),
        },
    });
}

async function sweep(context: LintContext): Promise<string[]> {
    const report = await runLintRules(context, {
        rules: LINT_RULES.filter(rule => CATEGORIES.has(rule.category)),
    });
    return report.entries.map(entry => `${entry.ruleId} ${JSON.stringify(entry.location)}`);
}

describe.each(LANGUAGES)("a project made from the starter template in $name", language => {
    it("has a second language, so the interface rules have something to say", () => {
        expect(targetLocales(language.variant, language.sourceLocale).length).toBeGreaterThan(1);
    });

    it("passes the story and interface checks with nothing to report", async () => {
        expect(await sweep(contextFor(language))).toEqual([]);
    });

    it("says so only because it can report: the game's title, left untranslatable, is found", async () => {
        const context = contextFor(language);
        const document = context.uiDocument!;
        const title = Object.values(document.elements).find(
            element => element.type === "nl.text" && element.props?.localizable === true,
        );
        expect(title).toBeDefined();
        delete (title!.props as Record<string, unknown>).localizable;
        const findings = await sweep(context);
        expect(findings.filter(finding => finding.startsWith("ui/unlocalized-text"))).toHaveLength(1);
    });
});
