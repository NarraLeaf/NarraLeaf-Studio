import { describe, expect, it } from "vitest";
import type { AssetSet, AssetSetCandidate } from "../types/assetSet";
import type { GameLocalizationBundle } from "../types/localization";
import type { UIDocument, UIElement, UISurface } from "../types/ui-editor/document";
import { collectReferencedIds } from "./variantPayload";
import { attachUiAssetSetVariants, uiNamesUnresolvedSet } from "./uiAssetSets";

/**
 * The interface's materialisation pass, stated as what a package must not be able to do: show one
 * language a widget with no picture, withhold an edition's art and ship it anyway, or carry a set id
 * into a runtime that cannot resolve one.
 */

const SET_ID = "11111111-1111-4111-8111-111111111111";
const EDITION_SET_ID = "22222222-2222-4222-8222-222222222222";
const EN = "aaaaaaaa-1111-4111-8111-111111111111";
const JA = "bbbbbbbb-1111-4111-8111-111111111111";
const MAIN = "cccccccc-1111-4111-8111-111111111111";
const DEMO = "dddddddd-1111-4111-8111-111111111111";

function localeSet(overrides: Partial<AssetSet> = {}): AssetSet {
    return {
        id: SET_ID,
        name: "Title art",
        type: "image",
        filter: ["cg:title"],
        axis: { kind: "locale", key: "locale", residency: "runtime", values: ["en", "ja"], fallback: "en" },
        ...overrides,
    };
}

function editionSet(overrides: Partial<AssetSet> = {}): AssetSet {
    return {
        id: EDITION_SET_ID,
        name: "Cover",
        type: "image",
        filter: ["cg:cover"],
        axis: { kind: "release", key: "release", residency: "build", values: ["release", "demo"], fallback: "release" },
        ...overrides,
    };
}

const CANDIDATES: AssetSetCandidate[] = [
    { id: EN, type: "image", tags: ["cg:title", "locale:en"] },
    { id: JA, type: "image", tags: ["cg:title", "locale:ja"] },
    { id: MAIN, type: "image", tags: ["cg:cover", "release:release"] },
    { id: DEMO, type: "image", tags: ["cg:cover", "release:demo"] },
];

const LOCALIZATION: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> = {
    sourceLocale: "en",
    locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "日本語" }],
};

function element(id: string, props: Record<string, unknown>): UIElement {
    return { id, type: "nl.container", parentId: null, childrenIds: [], layout: {} as UIElement["layout"], props };
}

function document(overrides: Partial<UIDocument> = {}): UIDocument {
    return {
        schemaVersion: 11,
        id: "doc",
        name: "UI",
        surfaces: [],
        elements: {},
        ...overrides,
    };
}

function run(input: { document: UIDocument; sets?: AssetSet[]; assetAxes?: Record<string, string> }) {
    return attachUiAssetSetVariants({
        document: input.document,
        sets: input.sets ?? [localeSet(), editionSet()],
        candidates: CANDIDATES,
        localization: LOCALIZATION,
        ...(input.assetAxes ? { assetAxes: input.assetAxes } : {}),
    });
}

describe("attachUiAssetSetVariants", () => {
    describe("a runtime axis", () => {
        it("answers for every language the project has, on the element that asked", () => {
            const fill = element("el1", { fillType: "image", imageFill: { assetId: SET_ID, mode: "cover" } });
            const doc = document({ elements: { el1: fill } });

            const result = run({ document: doc });

            expect(result.problems).toEqual([]);
            expect(fill.assetVariants).toEqual({ [SET_ID]: { en: EN, ja: JA } });
            expect(result.referencedAssetIds).toEqual(new Set([EN, JA]));
        });

        /**
         * The prop keeps the question. A widget whose map went missing then fails at the resolver
         * rather than silently drawing whichever language the build happened to run in.
         */
        it("leaves the set id in the prop", () => {
            const fill = element("el1", { imageFill: { assetId: SET_ID } });
            run({ document: document({ elements: { el1: fill } }) });

            expect((fill.props?.imageFill as { assetId: string }).assetId).toBe(SET_ID);
        });

        it("finds a fill nested under a scrollbar, not only a flat one", () => {
            const nested = element("el1", { scrollbar: { thumb: { imageFill: { assetId: SET_ID } } } });
            run({ document: document({ elements: { el1: nested } }) });

            expect(nested.assetVariants).toEqual({ [SET_ID]: { en: EN, ja: JA } });
        });

        it("answers for a widget inside a reusable component, which is a second element pool", () => {
            const inner = element("c1", { imageFill: { assetId: SET_ID } });
            run({
                document: document({
                    components: [{ id: "comp", name: "Slot", rootElementId: "c1", elements: { c1: inner } }],
                }),
            });

            expect(inner.assetVariants).toEqual({ [SET_ID]: { en: EN, ja: JA } });
        });

        it("answers a Surface's own background on that Surface's settings", () => {
            const surface: UISurface = {
                id: "s1",
                name: "Title",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1920, height: 1080 },
                rootElementId: "root",
                settings: { backgroundImage: { assetId: SET_ID, fillMode: "cover" } },
            };
            run({ document: document({ surfaces: [surface] }) });

            expect(surface.settings?.assetVariants).toEqual({ [SET_ID]: { en: EN, ja: JA } });
        });

        /**
         * The reason the answer is written into the record and not into a table beside it: the
         * trimmer decides what to copy by scanning the serialized payload for ids, so a map inside
         * the element it belongs to keeps every language's bytes with no change to the trimmer.
         */
        it("puts both languages' ids where the existing trimmer already looks", () => {
            const fill = element("el1", { imageFill: { assetId: SET_ID } });
            const doc = document({ elements: { el1: fill } });
            run({ document: doc });

            expect(collectReferencedIds({ ui: doc }, new Set([EN, JA]))).toEqual(new Set([EN, JA]));
        });
    });

    describe("a build axis", () => {
        it("replaces the id and writes no map at all", () => {
            const fill = element("el1", { imageFill: { assetId: EDITION_SET_ID } });
            const result = run({
                document: document({ elements: { el1: fill } }),
                assetAxes: { release: "release" },
            });

            expect((fill.props?.imageFill as { assetId: string }).assetId).toBe(MAIN);
            expect(fill.assetVariants).toBeUndefined();
            expect(result.collapsedBuildAxis).toBe(true);
        });

        /** The safety property: the edition that was not built leaves no trace for a byte scan. */
        it("leaves the other edition's id out of the payload entirely", () => {
            const fill = element("el1", { imageFill: { assetId: EDITION_SET_ID } });
            const doc = document({ elements: { el1: fill } });
            run({ document: doc, assetAxes: { release: "release" } });

            expect(JSON.stringify(doc)).not.toContain(DEMO);
            expect(JSON.stringify(doc)).not.toContain(EDITION_SET_ID);
        });

        it("refuses an edition that never said where it stands", () => {
            const fill = element("el1", { imageFill: { assetId: EDITION_SET_ID } });
            const result = run({ document: document({ elements: { el1: fill } }) });

            expect(result.problems).toEqual([
                { kind: "axisUnset", setId: EDITION_SET_ID, setName: "Cover", axisKey: "release", slice: "the interface" },
            ]);
            expect(fill.assetVariants).toBeUndefined();
        });
    });

    /**
     * A typeface is registered under a CSS family name derived from its asset id, so one id
     * standing for two files would leave a cached face describing the wrong bytes. Until that is
     * settled, a set in a font slot has to reach the build as an unresolved reference - which is
     * what refuses it - rather than be resolved into a package the runtime cannot read back.
     */
    it("does not answer for a typeface slot", () => {
        const text = element("el1", { fontAssetId: SET_ID });
        const result = run({ document: document({ elements: { el1: text } }) });

        expect(text.assetVariants).toBeUndefined();
        expect(result.problems).toEqual([]);
        expect(result.referencedAssetIds.size).toBe(0);
    });

    it("reports one problem per set however many widgets name it", () => {
        const doc = document({
            elements: {
                a: element("a", { imageFill: { assetId: EDITION_SET_ID } }),
                b: element("b", { imageFill: { assetId: EDITION_SET_ID } }),
            },
        });

        expect(run({ document: doc }).problems).toHaveLength(1);
    });
});

describe("uiNamesUnresolvedSet", () => {
    it("is false once every reference has its answer", () => {
        const doc = document({ elements: { el1: element("el1", { imageFill: { assetId: SET_ID } }) } });
        run({ document: doc });

        expect(uiNamesUnresolvedSet(doc, new Set([SET_ID]))).toBe(false);
    });

    it("is true for a reference the pass could not fill", () => {
        const doc = document({ elements: { el1: element("el1", { imageFill: { assetId: SET_ID } }) } });

        expect(uiNamesUnresolvedSet(doc, new Set([SET_ID]))).toBe(true);
    });

    /**
     * It answers about the slots that may hold a set, which is what makes it usable as "did the
     * pass finish": a typeface slot is not one, and the refusal for that case is the reference
     * index reporting a set id there as a reference to a file the project does not have.
     */
    it("says nothing about a typeface slot, which this pass never claimed", () => {
        const doc = document({ elements: { el1: element("el1", { fontAssetId: SET_ID }) } });
        run({ document: doc });

        expect(uiNamesUnresolvedSet(doc, new Set([SET_ID]))).toBe(false);
    });
});
