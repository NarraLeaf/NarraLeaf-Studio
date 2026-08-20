/**
 * The `scene:` unit class, end to end: extracted from a story document, written into an exchange
 * file, read back out of one, applied to a locale library, and finally resolved for a player.
 *
 * A round trip rather than four unit tests because the failure this guards against is a unit class
 * that only half exists - extracted into the panel's counts but dropped by the exporter, or exported
 * and then refused on import as "matches nothing in the project". Each of those looks fine from
 * whichever end you are standing at.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@shared/types/story";
import {
    resolveLocalizedSceneName,
    resolveLocalizedStoredText,
    sceneTranslationUnitId,
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
    extractSceneTranslationRows,
    type TranslatableUnitContext,
} from "./localizationModel";

const ROOT = join("D:/projects", "my-game");
const LOCALE = "zh-CN";

const CONFIG: LocalizationConfiguration = {
    sourceLocale: "en",
    locales: [
        { code: "en", displayName: "English" },
        { code: LOCALE, displayName: "简体中文" },
    ],
};

/** The skeleton's three scenes, which is where this defect was seen. */
function storyDocument(): StoryDocument {
    const scene = (id: string, name: string) => ({
        id,
        name,
        runtimeName: name.toLowerCase().replace(/\W+/g, "_"),
        rootBlockIds: [],
        blocks: {},
    });
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Skeleton",
        chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["s-corridor", "s-clubroom", "s-last"] }],
        scenes: {
            "s-corridor": scene("s-corridor", "The corridor"),
            "s-clubroom": scene("s-clubroom", "The clubroom"),
            "s-last": scene("s-last", "Last light"),
        },
    };
}

const TRANSLATIONS: Record<string, string> = {
    "scene:s-corridor": "走廊",
    "scene:s-clubroom": "社团活动室",
    "scene:s-last": "最后的光",
};

async function createService(): Promise<{ service: LocalizationService; files: Map<string, string> }> {
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
    return { service, files };
}

/** What the panel collects for these rows: the unit, its source text, and the story it lives in. */
function sceneUnits(document: StoryDocument): TranslatableUnitContext[] {
    return extractSceneTranslationRows(document).map(row => ({
        unitId: row.unitId,
        sourceText: row.sourceText,
        context: document.name,
    }));
}

describe("scene name translation units", () => {
    it("survives extract → export → import → export, and lands in the locale library", async () => {
        const document = storyDocument();
        const units = sceneUnits(document);
        const { service } = await createService();
        await service.loadDocument(LOCALE);

        // Export: every scene is a row, carrying its name as the source column.
        const exported = buildTranslationExchangeRows(units, service.getDocumentIfLoaded(LOCALE), "all");
        expect(exported.map(row => row.unitId)).toEqual([
            "scene:s-corridor",
            "scene:s-clubroom",
            "scene:s-last",
        ]);
        expect(exported.every(row => row.target === "" && row.status === "")).toBe(true);

        const csv = serializeTranslationExchange("csv", {
            sourceLocale: CONFIG.sourceLocale,
            targetLocale: LOCALE,
            rows: exported,
        });
        const parsed = parseTranslationExchange("csv", csv);
        expect(parsed.errors).toEqual([]);
        expect(parsed.rows.map(row => row.unitId)).toEqual(exported.map(row => row.unitId));
        expect(parsed.rows.map(row => row.source)).toEqual([
            "The corridor",
            "The clubroom",
            "Last light",
        ]);

        // The translator's pass, then back through the same format so the targets travel too.
        const translated = serializeTranslationExchange("csv", {
            sourceLocale: CONFIG.sourceLocale,
            targetLocale: LOCALE,
            rows: parsed.rows.map(row => ({ ...row, target: TRANSLATIONS[row.unitId] ?? "" })),
        });
        const returned = parseTranslationExchange("csv", translated);

        const summary = service.applyImportedRows(
            LOCALE,
            returned.rows,
            new Map(units.map(unit => [unit.unitId, unit.sourceText])),
        );
        // The half worth naming: `unknown` is what a unit id the project does not recognise scores,
        // which is exactly how a half-wired unit class fails.
        expect(summary).toEqual({ applied: 3, unchanged: 0, unknown: 0, skippedEmpty: 0 });

        const stored = service.getDocumentIfLoaded(LOCALE);
        expect(stored?.units["scene:s-corridor"]).toMatchObject({ target: "走廊", status: "translated" });
        expect(computeLocalizationProgress(units, stored)).toMatchObject({ total: 3, completed: 3, untranslated: 0 });

        // And out again: a second export carries the translations back to whoever asks for one.
        const reExported = buildTranslationExchangeRows(units, stored, "all");
        expect(reExported.map(row => row.target)).toEqual(["走廊", "社团活动室", "最后的光"]);
        expect(buildTranslationExchangeRows(units, stored, "pending")).toEqual([]);
    });

    it("renders a scene reference in the player's language, and a literal as itself", () => {
        const bundle: GameLocalizationBundle = {
            sourceLocale: "en",
            locales: CONFIG.locales,
            tables: { [LOCALE]: { ...TRANSLATIONS } },
            scenes: { "s-corridor": "The corridor", "s-clubroom": "The clubroom", "s-last": "Last light" },
        };

        expect(resolveLocalizedSceneName(bundle, LOCALE, "s-corridor")).toBe("走廊");
        // Source language: no table entry by construction, so the scene's own name renders.
        expect(resolveLocalizedSceneName(bundle, "en", "s-corridor")).toBe("The corridor");
        expect(resolveLocalizedSceneName(bundle, LOCALE, "s-unknown")).toBeNull();

        expect(resolveLocalizedStoredText(bundle, LOCALE, sceneTranslationUnitId("s-clubroom"))).toBe("社团活动室");

        // A save written before scene references existed holds the name as a literal. It is not a
        // reference, it is not translated, and - the part that matters - it still renders.
        expect(resolveLocalizedStoredText(bundle, LOCALE, "The corridor")).toBe("The corridor");
        expect(resolveLocalizedStoredText(bundle, LOCALE, "")).toBe("");
        // A reference to a scene this build does not carry falls back to itself rather than to a
        // blank slot: something legible beats nothing.
        expect(resolveLocalizedStoredText(bundle, LOCALE, "scene:s-deleted")).toBe("scene:s-deleted");
    });
});
