import { describe, expect, it } from "vitest";
import type { AssetSet, AssetSetCandidate } from "../types/assetSet";
import type { GameLocalizationBundle } from "../types/localization";
import { resolveStoryAssetVariant, type StoryDocument } from "../types/story";
import { collectReferencedIds } from "./variantPayload";
import {
    collectMaterializedVariantIds,
    materializeStoryAssetSets,
    storyNamesUnresolvedSet,
} from "./assetSetMaterialization";

/**
 * The materialisation pass, stated as what a package must not be able to do: ship one language a
 * blank stage, ship a language's bytes without the row that needs them, or carry a set id into a
 * runtime that cannot resolve one.
 */

const SET_ID = "11111111-1111-4111-8111-111111111111";
const EN = "aaaaaaaa-1111-4111-8111-111111111111";
const JA = "bbbbbbbb-1111-4111-8111-111111111111";
const ZH = "cccccccc-1111-4111-8111-111111111111";

function localeSet(overrides: Partial<AssetSet> = {}): AssetSet {
    return {
        id: SET_ID,
        name: "Title art",
        type: "image",
        filter: ["cg:title"],
        axes: [{ key: "locale", residency: "runtime", values: ["en", "ja"] }],
        ...overrides,
    };
}

function library(entries: Array<[string, string[]]>): AssetSetCandidate[] {
    return entries.map(([id, tags]) => ({ id, type: "image", tags }));
}

const FULL_LIBRARY = library([
    [EN, ["cg:title", "locale:en"]],
    [JA, ["cg:title", "locale:ja"]],
]);

function localization(overrides: Partial<GameLocalizationBundle> = {}): Pick<GameLocalizationBundle, "sourceLocale" | "locales"> {
    return {
        sourceLocale: "en",
        locales: [
            { code: "en", displayName: "English" },
            { code: "ja", displayName: "日本語" },
        ],
        ...overrides,
    };
}

/** One story, one scene, one row whose background names `assetId`. */
function storyNaming(assetId: string): Record<string, StoryDocument> {
    return {
        s1: {
            id: "s1",
            name: "Chapter 1",
            schemaVersion: 7,
            scenes: {
                sc1: {
                    id: "sc1",
                    name: "Opening",
                    blockOrder: ["b1"],
                    blocks: {
                        b1: {
                            id: "b1",
                            kind: "action",
                            parentId: null,
                            childrenIds: [],
                            payload: { action: "setBackground", assetId },
                        },
                    },
                },
            },
        } as unknown as StoryDocument,
    };
}

function run(input: {
    assetId?: string;
    sets?: AssetSet[];
    candidates?: AssetSetCandidate[];
    localization?: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
}) {
    return materializeStoryAssetSets({
        documents: storyNaming(input.assetId ?? SET_ID),
        sets: input.sets ?? [localeSet()],
        candidates: input.candidates ?? FULL_LIBRARY,
        // `in` rather than a default, so a test can say "this project has no languages" by passing
        // undefined explicitly and still be told apart from a test that did not say.
        localization: "localization" in input ? input.localization : localization(),
    });
}

function variantsOf(result: ReturnType<typeof run>) {
    return (result.documents.s1.scenes.sc1.blocks.b1 as { assetVariants?: Record<string, Record<string, string>> })
        .assetVariants;
}

describe("materializeStoryAssetSets", () => {
    it("writes every locale's member into the row that names the set", () => {
        const result = run({});

        expect(variantsOf(result)).toEqual({ [SET_ID]: { en: EN, ja: JA } });
        expect(result.problems).toEqual([]);
    });

    it("leaves the set id in the payload, so an unmigrated reader fails loudly", () => {
        const result = run({});
        const payload = result.documents.s1.scenes.sc1.blocks.b1.payload as { assetId?: string };

        expect(payload.assetId).toBe(SET_ID);
    });

    it("leaves a row naming an ordinary asset untouched", () => {
        const result = run({ assetId: EN });

        expect(variantsOf(result)).toBeUndefined();
        expect(result.problems).toEqual([]);
    });

    it("does not mutate the documents it was handed", () => {
        const documents = storyNaming(SET_ID);
        materializeStoryAssetSets({
            documents,
            sets: [localeSet()],
            candidates: FULL_LIBRARY,
            localization: localization(),
        });

        expect((documents.s1.scenes.sc1.blocks.b1 as { assetVariants?: unknown }).assetVariants).toBeUndefined();
    });

    describe("filling", () => {
        it("walks the project's declared fallback before the source locale", () => {
            const result = run({
                sets: [localeSet({ axes: [{ key: "locale", residency: "runtime", values: ["en", "ja", "zh-CN"] }] })],
                candidates: library([
                    [EN, ["cg:title", "locale:en"]],
                    [JA, ["cg:title", "locale:ja"]],
                ]),
                localization: localization({
                    locales: [
                        { code: "en", displayName: "English" },
                        { code: "ja", displayName: "日本語" },
                        // zh-CN has no picture of its own and falls back to Japanese, not to English.
                        { code: "zh-CN", displayName: "简体中文", fallback: "ja" },
                    ],
                }),
            });

            expect(variantsOf(result)?.[SET_ID]).toEqual({ en: EN, ja: JA, "zh-CN": JA });
        });

        it("lands on the source locale's member past the end of the chain", () => {
            const result = run({
                candidates: library([[EN, ["cg:title", "locale:en"]]]),
                localization: localization({
                    locales: [
                        { code: "en", displayName: "English" },
                        { code: "ja", displayName: "日本語" },
                    ],
                }),
            });

            expect(variantsOf(result)?.[SET_ID]).toEqual({ en: EN, ja: EN });
        });

        it("refuses a set with nothing to fall back to, naming the language to import for", () => {
            const result = run({ candidates: library([[JA, ["cg:title", "locale:ja"]]]) });

            expect(result.problems).toEqual([{
                kind: "unfilled",
                setId: SET_ID,
                setName: "Title art",
                locale: "en",
                storyId: "s1",
                sceneId: "sc1",
                blockId: "b1",
            }]);
            expect(variantsOf(result)).toBeUndefined();
        });

        /**
         * Ambiguity is a different answer from absence and must not take the fallback: two files
         * claiming Japanese would otherwise ship the English picture to Japanese players, while the
         * author is looking at the two Japanese files they just imported.
         */
        it("refuses an ambiguous coordinate instead of falling back past it", () => {
            const result = run({
                candidates: library([
                    [EN, ["cg:title", "locale:en"]],
                    [JA, ["cg:title", "locale:ja"]],
                    [ZH, ["cg:title", "locale:ja"]],
                ]),
            });

            expect(result.problems).toMatchObject([{ kind: "ambiguous", locale: "ja" }]);
            expect(variantsOf(result)).toBeUndefined();
        });
    });

    describe("what this build refuses to guess at", () => {
        it("refuses a build-time axis rather than collapsing it", () => {
            const result = run({
                sets: [localeSet({ axes: [{ key: "locale", residency: "build", values: ["en", "ja"] }] })],
            });

            expect(result.problems).toMatchObject([{ kind: "unsupported", reason: "buildAxis" }]);
        });

        it("refuses a second axis, which needs a derived key rather than an inline map", () => {
            const result = run({
                sets: [localeSet({
                    axes: [
                        { key: "locale", residency: "runtime", values: ["en"] },
                        { key: "mood", residency: "runtime", values: ["happy"] },
                    ],
                })],
            });

            expect(result.problems).toMatchObject([{ kind: "unsupported", reason: "multipleAxes" }]);
        });

        it("refuses a set reference in a project that has no languages", () => {
            const result = run({ localization: undefined });

            expect(result.problems).toMatchObject([{ kind: "unfilled", locale: "" }]);
        });
    });

    describe("the guarantees the caller checks", () => {
        it("reports a story still naming a set the pass could not fill", () => {
            const unfilled = run({ candidates: library([[JA, ["cg:title", "locale:ja"]]]) });

            expect(storyNamesUnresolvedSet(unfilled.documents, new Set([SET_ID]))).toBe(true);
            expect(storyNamesUnresolvedSet(run({}).documents, new Set([SET_ID]))).toBe(false);
        });

        it("names every member it wrote, so the caller can prove the bytes shipped", () => {
            const result = run({});

            expect(result.materializedAssetIds).toEqual(new Set([EN, JA]));
            expect(collectMaterializedVariantIds(result.documents)).toEqual(new Set([EN, JA]));
        });

        /**
         * The reason the map is written into the row. The trimmer copies whatever id it finds in the
         * serialized bundle, so a map inside the row keeps both languages' bytes with no change to
         * the trimmer at all - and a side table would not have.
         */
        it("puts both languages' ids where the existing trimmer already looks", () => {
            const result = run({});
            const carried = collectReferencedIds(result.documents, new Set([EN, JA]));

            expect(carried).toEqual(new Set([EN, JA]));
        });
    });
});

describe("resolveStoryAssetVariant", () => {
    const variants = { [SET_ID]: { en: EN, ja: JA } };

    it("answers the member the active locale names", () => {
        expect(resolveStoryAssetVariant(variants, SET_ID, "ja", "en")).toBe(JA);
    });

    it("answers nothing for an id that names no set, which is every ordinary asset", () => {
        expect(resolveStoryAssetVariant(variants, EN, "ja", "en")).toBeNull();
        expect(resolveStoryAssetVariant(undefined, SET_ID, "ja", "en")).toBeNull();
    });

    it("falls back to the source locale rather than leaving the stage empty", () => {
        expect(resolveStoryAssetVariant(variants, SET_ID, "de", "en")).toBe(EN);
        expect(resolveStoryAssetVariant(variants, SET_ID, "de", "de")).toBeNull();
    });
});
