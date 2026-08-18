import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { GameLocalizationBundle } from "@shared/types/localization";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";

/**
 * A materialised asset set, as the compiler sees it.
 *
 * The story arrives from assembly with the map already written into the row, so what is under test
 * here is only the last step: which member the active language picks, and that the URL the rest of
 * the compile uses - the one the preloader is then handed - is that member's.
 */

const SET_ID = "11111111-1111-4111-8111-111111111111";
const EN = "aaaaaaaa-1111-4111-8111-111111111111";
const JA = "bbbbbbbb-1111-4111-8111-111111111111";

function backgroundRow(assetId: string, variants?: Record<string, Record<string, string>>): StoryBlock {
    return {
        id: "bg",
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "setBackground", assetId },
        ...(variants ? { assetVariants: variants } : {}),
    } as StoryBlock;
}

function documentWith(block: StoryBlock): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene 1",
                runtimeName: "Scene 1",
                rootBlockIds: [block.id],
                blocks: { [block.id]: block },
            },
        },
    } as unknown as StoryDocument;
}

function localization(locale: string): GameLocalizationBundle & { getLocale: () => string } {
    return {
        sourceLocale: "en",
        locales: [
            { code: "en", displayName: "English" },
            { code: "ja", displayName: "日本語" },
        ],
        tables: {},
        getLocale: () => locale,
    };
}

/** Compiles the story and reports every asset id the resolver was asked for, in order. */
async function compileAndRecord(input: {
    document: StoryDocument;
    locale?: string;
}): Promise<{ requested: string[]; diagnostics: string[] }> {
    const requested: string[] = [];
    const result = await compileStudioStoryToNlr({
        document: input.document,
        sceneId: "scene-1",
        resolveAssetUrl: (assetId: string) => {
            requested.push(assetId);
            return `nlr://asset/${assetId}`;
        },
        ...(input.locale ? { localization: localization(input.locale) } : {}),
    });
    return {
        requested,
        diagnostics: result.diagnostics.map(entry => entry.message),
    };
}

describe("asset sets in the story compiler", () => {
    const variants = { [SET_ID]: { en: EN, ja: JA } };

    it("asks for the member the active language names, never for the set", async () => {
        const { requested } = await compileAndRecord({
            document: documentWith(backgroundRow(SET_ID, variants)),
            locale: "ja",
        });

        expect(requested).toContain(JA);
        expect(requested).not.toContain(SET_ID);
        expect(requested).not.toContain(EN);
    });

    it("picks the other member when the game runs in the other language", async () => {
        const { requested } = await compileAndRecord({
            document: documentWith(backgroundRow(SET_ID, variants)),
            locale: "en",
        });

        expect(requested).toContain(EN);
        expect(requested).not.toContain(JA);
    });

    /**
     * The ordering the preloader depends on. It is fed the URLs this compile produced, so a set
     * resolved any later would warm the wrong file - or none - and the player would see a frame of
     * blank stage while the right one loaded.
     */
    it("resolves before the URL, so what is warmed is what is shown", async () => {
        const { requested } = await compileAndRecord({
            document: documentWith(backgroundRow(SET_ID, variants)),
            locale: "ja",
        });

        // One request, for the member: the URL layer never sees a set id, so nothing downstream of
        // it - cache entry, preload registration - can be keyed on one.
        expect(requested).toEqual([JA]);
    });

    it("leaves an ordinary asset reference exactly as it was", async () => {
        const { requested, diagnostics } = await compileAndRecord({
            document: documentWith(backgroundRow(EN)),
            locale: "ja",
        });

        expect(requested).toEqual([EN]);
        expect(diagnostics).toEqual([]);
    });

    it("falls back to the source language rather than leaving the stage empty", async () => {
        const { requested } = await compileAndRecord({
            document: documentWith(backgroundRow(SET_ID, variants)),
            locale: "de",
        });

        expect(requested).toEqual([EN]);
    });

    /**
     * A materialised story compiled with no language to resolve it against is a host wiring fault,
     * not an authoring one. Drawing the scene beats a blank stage; the diagnostic is what keeps the
     * wrong language from being silent.
     */
    it("says so when it has to resolve a set with no language at all", async () => {
        const { requested, diagnostics } = await compileAndRecord({
            document: documentWith(backgroundRow(SET_ID, variants)),
        });

        expect(requested).toHaveLength(1);
        expect(diagnostics.join(" ")).toContain("without a language");
    });
});
