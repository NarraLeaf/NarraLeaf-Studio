/**
 * The skeleton's sample game, left out part by part.
 *
 * The wizard and `project_create` let an author untick the skeleton's sample story, its cast and its
 * files, and the scaffold takes them back out of the new project (`@shared/project/templateParts`).
 * A project made that way has to be as finished as one made whole: no page, blueprint, translation
 * or asset group left naming something that went, and the lint panel saying nothing but that the one
 * scene left is empty - which it is, on purpose.
 *
 * Each project is laid out here the way the scaffold lays it out - the English content, the variant
 * for the author's language over it, the base translation that variant replaces taken away - in a
 * temporary directory, and trimmed through the same function the scaffold calls.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { LocalizationDocument, LocalizationKeysDocument } from "@shared/types/localization";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import {
    leaveOutTemplateParts,
    parseProjectTemplateParts,
    resolveLeftOutParts,
    type ProjectTemplatePartId,
    type TemplatePartFiles,
} from "@shared/project/templateParts";
import { hashSourceText } from "@shared/utils/localizationText";
import { createTestLintContext, LINT_RULES, runLintRules } from "@/lib/lint";
import { listStories, readStoryDocument } from "@/lib/story-cli/project";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(TEMPLATE, "template.json"), "utf-8")) as {
    parts: unknown;
    contentLocales: Record<string, { remove: string[] }>;
};
const PARTS = parseProjectTemplateParts(MANIFEST.parts);

const LANGUAGES = [
    { name: "English", variant: null, sourceLocale: "en", entryName: "Start" },
    { name: "Chinese", variant: "zh", sourceLocale: "zh", entryName: "开始" },
    { name: "Japanese", variant: "ja", sourceLocale: "ja", entryName: "開始" },
] as const;
type Language = (typeof LANGUAGES)[number];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nls-template-parts-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function copyTree(from: string, to: string): void {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) {
            copyTree(source, target);
        } else {
            fs.mkdirSync(to, { recursive: true });
            fs.copyFileSync(source, target);
        }
    }
}

function diskFiles(root: string): TemplatePartFiles {
    const walk = (relative: string): string[] => fs.readdirSync(path.join(root, relative), { withFileTypes: true })
        .flatMap(entry => {
            const child = relative ? `${relative}/${entry.name}` : entry.name;
            return entry.isDirectory() ? walk(child) : [child];
        });
    return {
        list: async () => walk(""),
        read: async relative => fs.readFileSync(path.join(root, relative), "utf-8"),
        write: async (relative, text) => fs.writeFileSync(path.join(root, relative), text, "utf-8"),
        remove: async relative => fs.rmSync(path.join(root, relative), { force: true }),
    };
}

let made = 0;

/** A project as the scaffold leaves it in this language, with `leaveOut` taken out. */
async function project(language: Language, leaveOut: ProjectTemplatePartId[]): Promise<string> {
    const root = path.join(scratch, String(made++));
    copyTree(path.join(TEMPLATE, "content"), root);
    if (language.variant) {
        copyTree(path.join(TEMPLATE, `content.${language.variant}`), root);
        for (const relative of MANIFEST.contentLocales[language.variant].remove) {
            fs.rmSync(path.join(root, relative), { force: true });
        }
    }
    await leaveOutTemplateParts(diskFiles(root), PARTS, resolveLeftOutParts(PARTS, leaveOut), language.variant ?? "");
    return root;
}

function readJson<T>(root: string, relative: string): T {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf-8")) as T;
}

function translationFiles(root: string): string[] {
    return fs.readdirSync(path.join(root, "editor/localization"))
        .filter(name => name.endsWith(".json") && name !== "keys.json");
}

async function lint(root: string, language: Language): Promise<string[]> {
    const documents = new Map(translationFiles(root).map(name => [
        name.slice(0, -".json".length),
        readJson<LocalizationDocument>(root, `editor/localization/${name}`),
    ]));
    const { keys } = readJson<LocalizationKeysDocument>(root, "editor/localization/keys.json");
    const context = createTestLintContext({
        uiDocument: readJson<UIDocument>(root, "editor/ui/uidoc.json"),
        blueprintDocument: migrateBlueprintDocumentToLatest(
            readJson<{ blueprintDocument: unknown }>(root, "editor/ui/uigraphs.json").blueprintDocument,
        ),
        stories: listStories(root).map(story => ({
            id: story.id,
            name: story.name,
            document: readStoryDocument(root, story.id).document,
        })),
        characters: readJson<{ characters: { profile: { id: string; name: string } }[] }>(root, "editor/services/character.json")
            .characters.map(({ profile }) => ({ id: profile.id, name: profile.name, assetIds: [] })),
        localization: {
            sourceLocale: language.sourceLocale,
            targetLocales: [language.sourceLocale, ...documents.keys()],
            documents,
        },
        localizationKeys: new Map(Object.entries(keys).map(([name, entry]) => [name, entry.sourceText])),
    });
    const report = await runLintRules(context, {
        rules: LINT_RULES.filter(rule => ["story", "ui", "localization"].includes(rule.category)),
    });
    return report.entries.map(entry => entry.ruleId);
}

type StoryFile = { entrySceneId: string; scenes: Record<string, { name: string; blocks: object; defaultBackgroundAssetId?: string }> };

function story(root: string): StoryFile {
    const index = readJson<{ stories: { documentPath: string }[] }>(root, "editor/story/index.json");
    return readJson<StoryFile>(root, index.stories[0].documentPath);
}

function assetRecords(root: string): { id: string; name: string; groupId?: string }[] {
    return fs.readdirSync(path.join(root, "assets"))
        .filter(name => /^assets\.metadata\..+\.json$/.test(name))
        .flatMap(name => Object.values(readJson<Record<string, { id: string; name: string; groupId?: string }>>(root, `assets/${name}`)));
}

function assetFiles(root: string): number {
    const dir = path.join(root, "assets/content");
    return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length : 0;
}

describe("the skeleton's parts", () => {
    it("are the sample story, its cast and its files, and the story cannot stay without the other two", () => {
        expect(PARTS.map(part => part.id)).toEqual(["story", "characters", "files"]);
        expect(resolveLeftOutParts(PARTS, ["characters"])).toEqual(["story", "characters"]);
        expect(resolveLeftOutParts(PARTS, ["files"])).toEqual(["story", "files"]);
        expect(resolveLeftOutParts(PARTS, ["story"])).toEqual(["story"]);
        expect(resolveLeftOutParts(PARTS, ["nonsense"])).toEqual([]);
    });
});

describe.each(LANGUAGES)("a project made from the skeleton in $name", language => {
    it("with nothing left out is the template unchanged", async () => {
        const root = await project(language, []);
        expect(Object.keys(story(root).scenes)).toHaveLength(3);
        expect(await lint(root, language)).toEqual([]);
    });

    it("with the whole sample left out keeps the screens and one empty scene that Start still begins at", async () => {
        const root = await project(language, ["story", "characters", "files"]);
        const doc = story(root);
        const scenes = Object.values(doc.scenes);
        expect(Object.keys(doc.scenes)).toEqual([doc.entrySceneId]);
        expect(scenes[0].name).toBe(language.entryName);
        expect(scenes[0].blocks).toEqual({});
        expect(scenes[0].defaultBackgroundAssetId).toBeUndefined();
        // The title's Start names the scene by id, which is why it is the one that stays.
        expect(fs.readFileSync(path.join(root, "editor/ui/uigraphs.json"), "utf-8")).toContain(doc.entrySceneId);

        expect(readJson<{ characters: unknown[] }>(root, "editor/services/character.json").characters).toEqual([]);
        const avatars = path.join(root, "resources/characters/avatars");
        expect(fs.existsSync(avatars) ? fs.readdirSync(avatars, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()) : []).toEqual([]);

        // What the screens use stays: the title's picture and the three interface sounds, and the
        // place a save slot shows. Nothing else does, and no file is left with no record.
        const assets = assetRecords(root);
        const interfaceText = fs.readFileSync(path.join(root, "editor/ui/uidoc.json"), "utf-8")
            + fs.readFileSync(path.join(root, "editor/ui/uigraphs.json"), "utf-8");
        expect(assets.length).toBeGreaterThan(0);
        expect(assets.every(asset => interfaceText.includes(asset.id))).toBe(true);
        expect(assetFiles(root)).toBe(assets.length);
        const variables = Object.keys(readJson<{ entries: object }>(root, "editor/variables.json").entries);
        expect(variables.length).toBeGreaterThan(0);
        expect(variables.every(id => interfaceText.includes(id))).toBe(true);

        // No asset group the trim emptied is left behind in the panel.
        const groupIds = new Set(fs.readdirSync(path.join(root, "assets"))
            .filter(name => /^assets\.groups\..+\.json$/.test(name))
            .flatMap(name => Object.keys(readJson<object>(root, `assets/${name}`))));
        expect([...groupIds].every(id => assets.some(asset => asset.groupId === id))).toBe(true);

        // Every translation is of something still there, and the emptied scene's is of its new name.
        for (const name of translationFiles(root)) {
            const { units } = readJson<LocalizationDocument>(root, `editor/localization/${name}`);
            const ids = Object.keys(units);
            expect(ids.filter(id => !id.startsWith("key:") && !id.startsWith("ui:"))).toEqual([`scene:${doc.entrySceneId}`]);
            expect(units[`scene:${doc.entrySceneId}`].sourceHash).toBe(hashSourceText(language.entryName));
        }

        expect(await lint(root, language)).toEqual(["story/empty-scene"]);
    });

    it.each([
        ["story"],
        ["characters"],
        ["files"],
        ["story", "files"],
    ] as ProjectTemplatePartId[][])("with %s left out passes the checks", async (...leaveOut) => {
        const root = await project(language, leaveOut);
        expect(await lint(root, language)).toEqual(["story/empty-scene"]);
    });

    it("keeps a kept character's sprite when only the files are left out", async () => {
        const root = await project(language, ["files"]);
        const cast = readJson<{ characters: object[] }>(root, "editor/services/character.json");
        expect(cast.characters.length).toBeGreaterThan(0);
        const castText = JSON.stringify(cast);
        expect(assetRecords(root).some(asset => castText.includes(asset.id))).toBe(true);
    });
});
