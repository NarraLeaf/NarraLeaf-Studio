import { describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    decodeBlueprintOwnerKey,
    decodeLegacyBlueprintOwnerKey,
    encodeBlueprintOwnerKey,
} from "./ownerKey";

/** One of every owner kind, so a kind added without a case here is visible as a gap. */
const EVERY_KIND: BlueprintOwnerRef[] = [
    { kind: "globalMain" },
    { kind: "surfaceMain", surfaceId: "9a048bdd-8d00-4505-9ab5-832af57ef182" },
    { kind: "widgetMain", surfaceId: "s-1", elementId: "e-1" },
    { kind: "widgetValue", surfaceId: "s-1", elementId: "e-1", propPath: "items.0.label" },
    { kind: "componentWidgetMain", componentId: "c-1", elementId: "e-1" },
    { kind: "sharedAsset", assetId: "a-1" },
    { kind: "storyAction", blueprintId: "b-1" },
];

/**
 * Ids that are not uuids, and the reason each one is here.
 *
 * The built-in surface is not a hypothetical: it is the id the factory skeleton ships and the one
 * that broke three decoders. The rest are the characters a format built on a separator has to
 * survive if the escaping is doing its job rather than looking as though it is.
 */
const AWKWARD = [
    "narraleaf-studio:main-surface",
    "already%3Aescaped",
    "with space",
    "with/slash",
    "with%percent",
    "ダイアログ",
];

describe("blueprint owner keys", () => {
    it.each(EVERY_KIND)("round-trips $kind", owner => {
        expect(decodeBlueprintOwnerKey(encodeBlueprintOwnerKey(owner))).toEqual(owner);
    });

    it.each(AWKWARD)("round-trips a surface id spelled %s", surfaceId => {
        const owner: BlueprintOwnerRef = { kind: "widgetMain", surfaceId, elementId: "e-1" };
        expect(decodeBlueprintOwnerKey(encodeBlueprintOwnerKey(owner))).toEqual(owner);
    });

    it("puts the separator out of reach of the parts", () => {
        // The property the whole format rests on: a key has exactly as many separators as its shape
        // says, whatever the ids contain. Every previous decoder was wrong because this was not true.
        const key = encodeBlueprintOwnerKey({
            kind: "widgetMain",
            surfaceId: "narraleaf-studio:main-surface",
            elementId: "0443cfc4-b06c-483b-a1a5-f56306351f08",
        });
        expect(key.split(":")).toHaveLength(3);
    });

    it("refuses a key with a part too many rather than reinterpreting it", () => {
        // The old decoders answered this one, and answered it differently from each other. A wrong
        // answer sends an author to a different widget; no answer sends them nowhere, which is the
        // honest outcome for a key nothing wrote.
        expect(decodeBlueprintOwnerKey("widgetMain:a:b:c")).toBeNull();
        expect(decodeBlueprintOwnerKey("globalMain:extra")).toBeNull();
        expect(decodeBlueprintOwnerKey("surfaceMain")).toBeNull();
        expect(decodeBlueprintOwnerKey("somethingElse:a")).toBeNull();
    });

    it("does not throw on a key that is not valid escaping", () => {
        // Reached from documents on disk and from search hits; a bad key must not take out the read.
        expect(() => decodeBlueprintOwnerKey("surfaceMain:%")).not.toThrow();
    });
});

describe("reading owner keys written before the parts were escaped", () => {
    it("reads the built-in surface's widgets, which is the case that was wrong", () => {
        // 182 records across twenty-eight authored projects have this shape. Left to right it is
        // indistinguishable from a four-part key; right to left it is not, because the element id is
        // a uuid and the built-in id is what precedes it.
        expect(decodeLegacyBlueprintOwnerKey(
            "widgetMain:narraleaf-studio:main-surface:0443cfc4-b06c-483b-a1a5-f56306351f08",
        )).toEqual({
            kind: "widgetMain",
            surfaceId: "narraleaf-studio:main-surface",
            elementId: "0443cfc4-b06c-483b-a1a5-f56306351f08",
        });
    });

    it("reads the ordinary uuid-only shapes unchanged", () => {
        expect(decodeLegacyBlueprintOwnerKey("widgetMain:s-1:e-1"))
            .toEqual({ kind: "widgetMain", surfaceId: "s-1", elementId: "e-1" });
        expect(decodeLegacyBlueprintOwnerKey("surfaceMain:narraleaf-studio:main-surface"))
            .toEqual({ kind: "surfaceMain", surfaceId: "narraleaf-studio:main-surface" });
        expect(decodeLegacyBlueprintOwnerKey("globalMain")).toEqual({ kind: "globalMain" });
    });

    it("reads a value key whose prop path was the one escaped part", () => {
        expect(decodeLegacyBlueprintOwnerKey("widgetValue:narraleaf-studio:main-surface:e-1:items.0%2Flabel"))
            .toEqual({
                kind: "widgetValue",
                surfaceId: "narraleaf-studio:main-surface",
                elementId: "e-1",
                propPath: "items.0/label",
            });
    });
});
