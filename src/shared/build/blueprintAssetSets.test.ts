import { describe, expect, it } from "vitest";
import type { AssetSet, AssetSetCandidate } from "../types/assetSet";
import type { BlueprintGraphIr } from "../types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "../types/blueprint/graph";
import type { GameLocalizationBundle } from "../types/localization";
import { collectReferencedIds } from "./variantPayload";
import { attachBlueprintAssetSetVariants, blueprintsNameUnresolvedSet } from "./blueprintAssetSets";
import { resolveStoredAssetSetValue } from "./blueprintAssetSlots";

/**
 * A blueprint's asset pins, stated as what a package must not be able to do: carry a set id into a
 * graph evaluator with no answer for it, or ship the art of an edition it did not build.
 */

const SET_ID = "11111111-1111-4111-8111-111111111111";
const EDITION_SET_ID = "22222222-2222-4222-8222-222222222222";
const EN = "aaaaaaaa-1111-4111-8111-111111111111";
const JA = "bbbbbbbb-1111-4111-8111-111111111111";
const MAIN = "cccccccc-1111-4111-8111-111111111111";
const DEMO = "dddddddd-1111-4111-8111-111111111111";

const SETS: AssetSet[] = [
    {
        id: SET_ID,
        name: "Badge",
        type: "image",
        filter: ["cg:badge"],
        axis: { kind: "locale", key: "locale", residency: "runtime", values: ["en", "ja"], fallback: "en" },
    },
    {
        id: EDITION_SET_ID,
        name: "Cover",
        type: "image",
        filter: ["cg:cover"],
        axis: { kind: "release", key: "release", residency: "build", values: ["release", "demo"], fallback: "release" },
    },
];

const CANDIDATES: AssetSetCandidate[] = [
    { id: EN, type: "image", tags: ["cg:badge", "locale:en"] },
    { id: JA, type: "image", tags: ["cg:badge", "locale:ja"] },
    { id: MAIN, type: "image", tags: ["cg:cover", "release:release"] },
    { id: DEMO, type: "image", tags: ["cg:cover", "release:demo"] },
];

const LOCALIZATION: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> = {
    sourceLocale: "en",
    locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "日本語" }],
};

function run(graph: BlueprintGraphIr, assetAxes?: Record<string, string>) {
    return attachBlueprintAssetSetVariants({
        graphs: [graph],
        sets: SETS,
        candidates: CANDIDATES,
        localization: LOCALIZATION,
        ...(assetAxes ? { assetAxes } : {}),
    });
}

describe("attachBlueprintAssetSetVariants", () => {
    it("answers a pin that stores the wrapped value, keeping the wrapper", () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                n1: { id: "n1", type: "nl.setImageAsset", params: { asset: { kind: "imageAsset", assetId: SET_ID } } },
            },
        };

        const result = run(graph);

        expect(result.problems).toEqual([]);
        expect(graph.nodes!.n1!.assetVariants).toEqual({ [SET_ID]: { en: EN, ja: JA } });
        expect(graph.nodes!.n1!.params!.asset).toEqual({ kind: "imageAsset", assetId: SET_ID });
        expect(result.referencedAssetIds).toEqual(new Set([EN, JA]));
    });

    it("answers the Image Asset literal's own stored key", () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                lit: { id: "lit", type: BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL, params: { asset: SET_ID } },
            },
        };
        run(graph);

        expect(graph.nodes!.lit!.assetVariants).toEqual({ [SET_ID]: { en: EN, ja: JA } });
    });

    /**
     * The whole reason the carrier is the storing node. A pin fed by a literal never sees a set at
     * all, so an answer written onto the consumer would be an answer nothing ever reads.
     */
    it("answers on the literal that feeds a pin, not on the node that consumes it", () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                lit: { id: "lit", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: SET_ID } },
                consumer: { id: "consumer", type: "nl.setImageAsset", params: {} },
            },
            edges: [{ from: { nodeId: "lit", port: "value" }, to: { nodeId: "consumer", port: "asset" } }],
        };
        run(graph);

        expect(graph.nodes!.lit!.assetVariants).toEqual({ [SET_ID]: { en: EN, ja: JA } });
        expect(graph.nodes!.consumer!.assetVariants).toBeUndefined();
    });

    it("answers the pre-rename key only while the modern one is unset", () => {
        const legacy: BlueprintGraphIr = {
            nodes: { n1: { id: "n1", type: "nl.setImageAsset", params: { assetId: SET_ID } } },
        };
        const migrated: BlueprintGraphIr = {
            nodes: { n1: { id: "n1", type: "nl.setImageAsset", params: { asset: EN, assetId: SET_ID } } },
        };

        run(legacy);
        run(migrated);

        expect(legacy.nodes!.n1!.assetVariants).toEqual({ [SET_ID]: { en: EN, ja: JA } });
        expect(migrated.nodes!.n1!.assetVariants).toBeUndefined();
    });

    /**
     * A typeface is registered under a CSS family derived from its id, so one id standing for two
     * files would leave a cached face describing the wrong bytes. Refused rather than half-supported:
     * the reference index declines to expand it too, so it reaches `assets/missing`.
     */
    it("does not answer for a typeface pin", () => {
        const graph: BlueprintGraphIr = {
            nodes: { n1: { id: "n1", type: "nl.setFont", params: { fontAssetId: SET_ID } } },
        };

        const result = run(graph);

        expect(graph.nodes!.n1!.assetVariants).toBeUndefined();
        expect(result.referencedAssetIds.size).toBe(0);
    });

    it("puts both languages' ids where the existing trimmer already looks", () => {
        const graph: BlueprintGraphIr = {
            nodes: { n1: { id: "n1", type: "nl.setImageAsset", params: { asset: SET_ID } } },
        };
        run(graph);

        expect(collectReferencedIds(graph, new Set([EN, JA]))).toEqual(new Set([EN, JA]));
    });

    describe("a build axis", () => {
        it("replaces the id in place and writes no map", () => {
            const graph: BlueprintGraphIr = {
                nodes: { n1: { id: "n1", type: "nl.setImageAsset", params: { asset: EDITION_SET_ID } } },
            };

            const result = run(graph, { release: "release" });

            expect(graph.nodes!.n1!.params!.asset).toBe(MAIN);
            expect(graph.nodes!.n1!.assetVariants).toBeUndefined();
            expect(result.collapsedBuildAxis).toBe(true);
        });

        it("leaves the other edition's id out of the payload entirely", () => {
            const graph: BlueprintGraphIr = {
                nodes: { n1: { id: "n1", type: "nl.setImageAsset", params: { asset: EDITION_SET_ID } } },
            };
            run(graph, { release: "release" });

            expect(JSON.stringify(graph)).not.toContain(DEMO);
            expect(JSON.stringify(graph)).not.toContain(EDITION_SET_ID);
        });

        it("refuses an edition that never said where it stands", () => {
            const graph: BlueprintGraphIr = {
                nodes: { n1: { id: "n1", type: "nl.setImageAsset", params: { asset: EDITION_SET_ID } } },
            };

            expect(run(graph).problems).toEqual([
                { kind: "axisUnset", setId: EDITION_SET_ID, setName: "Cover", axisKey: "release", slice: "a blueprint" },
            ]);
        });
    });
});

describe("blueprintsNameUnresolvedSet", () => {
    it("is true before the pass runs and false after it", () => {
        const graph: BlueprintGraphIr = {
            nodes: { n1: { id: "n1", type: "nl.setImageAsset", params: { asset: SET_ID } } },
        };

        expect(blueprintsNameUnresolvedSet([graph], new Set([SET_ID]))).toBe(true);
        run(graph);
        expect(blueprintsNameUnresolvedSet([graph], new Set([SET_ID]))).toBe(false);
    });
});

describe("resolveStoredAssetSetValue", () => {
    const node = { assetVariants: { [SET_ID]: { en: EN, ja: JA } } };

    it("answers the member the language names, keeping the stored shape", () => {
        expect(resolveStoredAssetSetValue(node, SET_ID, "ja", "en")).toBe(JA);
        expect(resolveStoredAssetSetValue(node, { kind: "imageAsset", assetId: SET_ID }, "ja", "en"))
            .toEqual({ kind: "imageAsset", assetId: JA });
    });

    it("hands back anything the node has no answer for", () => {
        expect(resolveStoredAssetSetValue(node, "some-other-id", "ja", "en")).toBe("some-other-id");
        expect(resolveStoredAssetSetValue(undefined, SET_ID, "ja", "en")).toBe(SET_ID);
        expect(resolveStoredAssetSetValue(node, 42, "ja", "en")).toBe(42);
    });

    /** Defence, not policy: a filled map covers every locale, so this means pack and project disagree. */
    it("falls back to the source language for a locale with no entry", () => {
        expect(resolveStoredAssetSetValue(node, SET_ID, "fr", "en")).toBe(EN);
    });
});
