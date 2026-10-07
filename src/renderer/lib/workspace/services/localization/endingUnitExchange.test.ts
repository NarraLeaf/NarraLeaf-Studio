/**
 * The `ending:` unit class, end to end: extracted from a story document, written into an exchange
 * file, read back out of one, applied to a locale library, and resolved for a player.
 *
 * A round trip for the reason `sceneUnitExchange.test.ts` is one: a unit class that only half exists -
 * counted by the panel but dropped by the exporter, or exported and then refused on import as
 * "matches nothing in the project" - looks fine from whichever end you are standing at.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import {
    endingTranslationUnitId,
    parseEndingTranslationUnitId,
    resolveLocalizedEndingName,
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
    extractEndingTranslationRows,
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

function endingBlock(id: string, name: string, disabled = false): StoryBlock {
    return {
        id,
        kind: "control",
        parentId: null,
        childrenIds: [],
        payload: { control: "ending", name },
        ...(disabled ? { disabled: true } : {}),
    } as StoryBlock;
}

/** Two scenes, three ending rows: one named, one unnamed, one disabled. */
function storyDocument(): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Skeleton",
        chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["s-roof", "s-last"] }],
        scenes: {
            "s-roof": {
                id: "s-roof",
                name: "屋顶",
                runtimeName: "roof",
                rootBlockIds: ["bad", "blank"],
                blocks: { bad: endingBlock("bad", "坏结局"), blank: endingBlock("blank", "  ") },
            },
            "s-last": {
                id: "s-last",
                name: "最后的光",
                runtimeName: "last",
                rootBlockIds: ["true", "cut"],
                blocks: { true: endingBlock("true", "明天老时间"), cut: endingBlock("cut", "删掉的结局", true) },
            },
        },
    } as unknown as StoryDocument;
}

const TRANSLATIONS: Record<string, string> = {
    "ending:bad": "Bad End",
    "ending:true": "Same time tomorrow",
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

/** What the panel collects for these rows: the unit, its source text, and the scene it is reached in. */
function endingUnits(document: StoryDocument): TranslatableUnitContext[] {
    return extractEndingTranslationRows(document).map(row => ({
        unitId: row.unitId,
        sourceText: row.sourceText,
        context: row.sceneName,
    }));
}

describe("ending name translation units", () => {
    it("lists the named endings a build produces, in story order, keyed by their rows", () => {
        expect(extractEndingTranslationRows(storyDocument())).toEqual([
            { unitId: "ending:bad", endingId: "bad", storyId: "story-1", sceneId: "s-roof", sceneName: "屋顶", sourceText: "坏结局" },
            {
                unitId: "ending:true",
                endingId: "true",
                storyId: "story-1",
                sceneId: "s-last",
                sceneName: "最后的光",
                sourceText: "明天老时间",
            },
        ]);
        expect(parseEndingTranslationUnitId(endingTranslationUnitId("true"))).toBe("true");
        expect(parseEndingTranslationUnitId("scene:true")).toBeNull();
        expect(parseEndingTranslationUnitId("ending:")).toBeNull();
    });

    it("survives extract → export → import → export, and lands in the locale library", async () => {
        const document = storyDocument();
        const units = endingUnits(document);
        const service = await createService();
        await service.loadDocument(LOCALE);

        const exported = buildTranslationExchangeRows(units, service.getDocumentIfLoaded(LOCALE), "all");
        expect(exported.map(row => [row.unitId, row.source, row.context])).toEqual([
            ["ending:bad", "坏结局", "屋顶"],
            ["ending:true", "明天老时间", "最后的光"],
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
        expect(stored?.units["ending:true"]).toMatchObject({ target: "Same time tomorrow", status: "translated" });
        expect(computeLocalizationProgress(units, stored)).toMatchObject({ total: 2, completed: 2, untranslated: 0 });
        expect(buildTranslationExchangeRows(units, stored, "pending")).toEqual([]);
    });

    it("hands the player the name in the game's language, falling back as a line does", () => {
        const bundle: GameLocalizationBundle = {
            sourceLocale: "zh-CN",
            locales: [...CONFIG.locales, { code: "en-GB", displayName: "English (UK)", fallback: "en" }, { code: "ko", displayName: "한국어" }],
            tables: { [LOCALE]: { ...TRANSLATIONS } },
            endings: { bad: "坏结局", true: "明天老时间" },
        };
        expect(resolveLocalizedEndingName(bundle, LOCALE, "true", "明天老时间")).toBe("Same time tomorrow");
        // A language with no translation of its own reads its fallback's, as its lines do.
        expect(resolveLocalizedEndingName(bundle, "en-GB", "true", "明天老时间")).toBe("Same time tomorrow");
        // A language with none at all, and the source language, read the words the row is written with.
        expect(resolveLocalizedEndingName(bundle, "ko", "true", "明天老时间")).toBe("明天老时间");
        expect(resolveLocalizedEndingName(bundle, "zh-CN", "true", "明天老时间")).toBe("明天老时间");
    });
});
