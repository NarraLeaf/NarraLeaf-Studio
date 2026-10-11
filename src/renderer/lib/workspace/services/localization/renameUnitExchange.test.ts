/**
 * The `rename:` unit class, end to end: the words a `/rename` row gives a character, extracted from a
 * story document, written into an exchange file, read back out of one, applied to a locale library,
 * and resolved for a player from the name the engine recorded.
 *
 * A round trip for the reason `endingUnitExchange.test.ts` is one: a unit class that only half exists
 * - listed by the table but dropped by the exporter, or exported and then refused on import as
 * "matches nothing in the project" - looks fine from whichever end you are standing at.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { STORY_DOCUMENT_SCHEMA_VERSION, listStoryRenames, type StoryBlock, type StoryDocument } from "@shared/types/story";
import {
    parseRenameTranslationUnitId,
    renameTranslationUnitId,
    resolveLocalizedSpeakerName,
    type GameLocalizationBundle,
    type LocalizationConfiguration,
} from "@shared/types/localization";
import {
    parseTranslationExchange,
    serializeTranslationExchange,
} from "@shared/utils/localizationExchange";
import { Services, type WorkspaceContext } from "../services";
import { LocalizationService } from "./LocalizationService";
import {
    buildTranslationExchangeRows,
    computeLocalizationProgress,
    extractRenameTranslationRows,
    type TranslatableUnitContext,
} from "./localizationModel";

const ROOT = join("D:/projects", "my-game");
const LOCALE = "en";

const CONFIG: LocalizationConfiguration = {
    sourceLocale: "zh-CN",
    locales: [
        { code: "zh-CN", displayName: "简体中文" },
        { code: LOCALE, displayName: "English" },
    ],
};

const CHARACTERS = [
    { id: "char-aoi", name: "Aoi" },
    { id: "char-narra", name: "Narra" },
];

function renameBlock(id: string, characterId: string, displayName: string, disabled = false): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "character", operation: "setName", characterId, displayName },
        ...(disabled ? { disabled: true } : {}),
    } as StoryBlock;
}

/**
 * Two scenes of `/rename` rows: a description, a placeholder, a blank one, one back to the character's
 * own name, one to another character's name, and a disabled one.
 */
function storyDocument(): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Skeleton",
        chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["s-club", "s-roof"] }],
        scenes: {
            "s-club": {
                id: "s-club",
                name: "社团活动室",
                runtimeName: "club",
                rootBlockIds: ["veil", "blank", "back"],
                blocks: {
                    veil: renameBlock("veil", "char-aoi", "神秘少女"),
                    blank: renameBlock("blank", "char-aoi", " "),
                    back: renameBlock("back", "char-aoi", "Aoi"),
                },
            },
            "s-roof": {
                id: "s-roof",
                name: "屋顶",
                runtimeName: "roof",
                rootBlockIds: ["mask", "posing", "cut"],
                blocks: {
                    mask: renameBlock("mask", "char-narra", "？？？"),
                    posing: renameBlock("posing", "char-narra", "Aoi"),
                    cut: renameBlock("cut", "char-narra", "删掉的名字", true),
                },
            },
        },
    } as unknown as StoryDocument;
}

const TRANSLATIONS: Record<string, string> = {
    "rename:veil": "Mysterious girl",
    "rename:mask": "???",
};

async function createService(): Promise<LocalizationService> {
    const files = new Map<string, string>();
    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            write: async (path: string, data: string) => {
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async () => ok(undefined),
        },
        [Services.Project]: {
            getLocalizationConfiguration: () => CONFIG,
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    const service = new LocalizationService();
    await service.initialize(ctx, async () => undefined);
    return service;
}

/** What the panel collects for these rows: the unit, its words, and the scene the row is in. */
function renameUnits(document: StoryDocument): TranslatableUnitContext[] {
    return extractRenameTranslationRows(document, CHARACTERS).map(row => ({
        unitId: row.unitId,
        sourceText: row.sourceText,
        context: row.sceneName,
    }));
}

/** A bundle as the build assembles it: every shipped `/rename` row's words, in story order. */
function bundleWith(tables: GameLocalizationBundle["tables"], extraLocales: GameLocalizationBundle["locales"] = []): GameLocalizationBundle {
    const renames: Record<string, string> = {};
    for (const rename of listStoryRenames(storyDocument())) {
        if (rename.name.trim()) {
            renames[rename.renameId] = rename.name;
        }
    }
    return {
        sourceLocale: "zh-CN",
        locales: [...CONFIG.locales, ...extraLocales],
        tables,
        renames,
    };
}

describe("/rename translation units", () => {
    it("lists the words a /rename row gives, in story order, keyed by their rows", () => {
        expect(extractRenameTranslationRows(storyDocument(), CHARACTERS)).toEqual([
            {
                unitId: "rename:veil",
                renameId: "veil",
                storyId: "story-1",
                sceneId: "s-club",
                sceneName: "社团活动室",
                characterId: "char-aoi",
                sourceText: "神秘少女",
            },
            {
                unitId: "rename:mask",
                renameId: "mask",
                storyId: "story-1",
                sceneId: "s-roof",
                sceneName: "屋顶",
                characterId: "char-narra",
                sourceText: "？？？",
            },
        ]);
        expect(parseRenameTranslationUnitId(renameTranslationUnitId("veil"))).toBe("veil");
        expect(parseRenameTranslationUnitId("ending:veil")).toBeNull();
        expect(parseRenameTranslationUnitId("rename:")).toBeNull();
    });

    it("offers no unit for words that are a character's name, whoever is renamed to them", () => {
        const ids = extractRenameTranslationRows(storyDocument(), CHARACTERS).map(row => row.renameId);
        // `back` returns Aoi to her own name; `posing` gives Narra Aoi's. Both read as Aoi's name.
        expect(ids).not.toContain("back");
        expect(ids).not.toContain("posing");
        // A project whose cast no longer has an "Aoi" offers those words for translation like any other.
        expect(extractRenameTranslationRows(storyDocument(), []).map(row => row.renameId)).toEqual([
            "veil",
            "back",
            "mask",
            "posing",
        ]);
    });

    it("survives extract → export → import → export, and lands in the locale library", async () => {
        const document = storyDocument();
        const units = renameUnits(document);
        const service = await createService();
        await service.loadDocument(LOCALE);

        const exported = buildTranslationExchangeRows(units, service.getDocumentIfLoaded(LOCALE), "all");
        expect(exported.map(row => [row.unitId, row.source, row.context])).toEqual([
            ["rename:veil", "神秘少女", "社团活动室"],
            ["rename:mask", "？？？", "屋顶"],
        ]);

        const csv = serializeTranslationExchange("csv", {
            sourceLocale: CONFIG.sourceLocale,
            targetLocale: LOCALE,
            rows: exported.map(row => ({ ...row, target: TRANSLATIONS[row.unitId] ?? "" })),
        });
        const returned = parseTranslationExchange("csv", csv);
        expect(returned.problems).toEqual([]);

        const summary = service.applyImportedRows(
            LOCALE,
            returned.rows,
            new Map(units.map(unit => [unit.unitId, unit.sourceText])),
        );
        expect(summary).toEqual({ applied: 2, unchanged: 0, unknown: 0, skippedEmpty: 0 });

        const stored = service.getDocumentIfLoaded(LOCALE);
        expect(stored?.units["rename:veil"]).toMatchObject({ target: "Mysterious girl", status: "translated" });
        expect(computeLocalizationProgress(units, stored)).toMatchObject({ total: 2, completed: 2, untranslated: 0 });
        expect(buildTranslationExchangeRows(units, stored, "pending")).toEqual([]);
    });

    it("hands the player the words in the game's language, falling back as a line does", () => {
        const bundle = bundleWith(
            { [LOCALE]: { ...TRANSLATIONS, "char:char-aoi": "Aoi-EN" } },
            [{ code: "en-GB", displayName: "English (UK)", fallback: "en" }, { code: "ja", displayName: "日本語" }],
        );
        expect(resolveLocalizedSpeakerName(bundle, LOCALE, CHARACTERS, "神秘少女")).toBe("Mysterious girl");
        // A language with no translation of its own reads its fallback's, as its lines do.
        expect(resolveLocalizedSpeakerName(bundle, "en-GB", CHARACTERS, "神秘少女")).toBe("Mysterious girl");
        // A language with none at all, and the source language, read the words the row is written with.
        expect(resolveLocalizedSpeakerName(bundle, "ja", CHARACTERS, "神秘少女")).toBe("神秘少女");
        expect(resolveLocalizedSpeakerName(bundle, "zh-CN", CHARACTERS, "神秘少女")).toBe("神秘少女");
        // Renamed back to a character's name, it is that character's name: its own translation.
        expect(resolveLocalizedSpeakerName(bundle, LOCALE, CHARACTERS, "Aoi")).toBe("Aoi-EN");
        // Words no row gives - a one-off speaker, or words a row was rewritten away from - as recorded.
        expect(resolveLocalizedSpeakerName(bundle, LOCALE, CHARACTERS, "路人")).toBe("路人");
    });

    it("reads rows that give the same words through the first translation along the language chain", () => {
        const bundle: GameLocalizationBundle = {
            ...bundleWith({}),
            locales: [...CONFIG.locales, { code: "en-GB", displayName: "English (UK)", fallback: "en" }],
            renames: { first: "？？？", second: "？？？" },
            tables: {
                en: { "rename:first": "???", "rename:second": "Who?" },
                "en-GB": { "rename:second": "Who, then?" },
            },
        };
        // The language itself before its fallback, whichever row the translation is filed under...
        expect(resolveLocalizedSpeakerName(bundle, "en-GB", CHARACTERS, "？？？")).toBe("Who, then?");
        // ...and within one language, the row that comes first in the story.
        expect(resolveLocalizedSpeakerName(bundle, LOCALE, CHARACTERS, "？？？")).toBe("???");
    });
});
