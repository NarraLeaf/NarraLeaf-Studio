import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { characterAvatarAssetId } from "@shared/utils/characterAvatar";
import { devModeSavePreviewAssetId } from "@shared/types/devModeSave";
import {
    AssetResolutionLedger,
    classifyAssetFailure,
    describeAssetFieldFailure,
    describeAssetResolutionFailure,
    isAssetReferenceShaped,
    type AssetResolutionFailure,
    type AssetResolutionReport,
    type AssetResolutionSite,
} from "./assetResolution";

const GONE = "4b645b59-1723-4ac9-98ab-e6859b837bef";
const CASTLE = "93bad884-1f14-4ad2-85fb-c05d7b5ffef6";
const ASSET_NAMES = { [CASTLE]: "castle.png" };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const ART: AssetResolutionSite = {
    surfaceId: "surface-title",
    elementId: "element-art",
    ownerName: "Art",
    slot: "imageFill",
    instanceKey: "",
};

function failure(requested: string, stage: "resolve" | "load" = "resolve", site = ART): AssetResolutionFailure {
    return { site, requested, stage };
}

describe("what counts as an asset reference", () => {
    it("accepts the id shapes a slot can name and nothing else", () => {
        expect(isAssetReferenceShaped(GONE)).toBe(true);
        expect(isAssetReferenceShaped("a".repeat(64))).toBe(true);
        expect(isAssetReferenceShaped(characterAvatarAssetId("hero", "smile"))).toBe(true);
        expect(isAssetReferenceShaped(devModeSavePreviewAssetId("slot-1"))).toBe(true);

        // What a binding turns other values into on its way to a string property.
        expect(isAssetReferenceShaped("[object Object]")).toBe(false);
        expect(isAssetReferenceShaped("42")).toBe(false);
        expect(isAssetReferenceShaped("true")).toBe(false);
        expect(isAssetReferenceShaped("castle.png")).toBe(false);
    });
});

describe("classifyAssetFailure", () => {
    it("names an asset the project has as unreadable, whichever step failed", () => {
        expect(classifyAssetFailure(failure(CASTLE, "resolve"), ASSET_NAMES)).toEqual({
            kind: "unreadable",
            assetName: "castle.png",
        });
        expect(classifyAssetFailure(failure(CASTLE, "load"), ASSET_NAMES)).toEqual({
            kind: "unreadable",
            assetName: "castle.png",
        });
    });

    it("calls a well-formed id the project does not have missing", () => {
        expect(classifyAssetFailure(failure(GONE), ASSET_NAMES)).toEqual({ kind: "missing", assetName: null });
    });

    it("calls a value that is not shaped like a reference not an asset", () => {
        for (const value of ["[object Object]", "42", "hello"]) {
            expect(classifyAssetFailure(failure(value), ASSET_NAMES).kind).toBe("notAsset");
            // Even when it made it as far as a URL - a packaged game mints one for anything.
            expect(classifyAssetFailure(failure(value, "load"), undefined).kind).toBe("notAsset");
        }
    });

    it("does not call a failed load missing: a URL was produced, so the reference named something", () => {
        expect(classifyAssetFailure(failure(GONE, "load"), undefined)).toEqual({ kind: "unreadable", assetName: null });
    });

    it("treats a derived file (a baked avatar) as unreadable rather than as a deleted asset", () => {
        expect(classifyAssetFailure(failure(characterAvatarAssetId("hero", "smile")), ASSET_NAMES).kind)
            .toBe("unreadable");
    });
});

describe("describeAssetResolutionFailure", () => {
    const en = createTranslator("en").t;

    it("says which property on which element, and what kind of failure, in three distinct sentences", () => {
        const missing = describeAssetResolutionFailure(failure(GONE), ASSET_NAMES, en);
        const named = describeAssetResolutionFailure(failure(CASTLE), ASSET_NAMES, en);
        const unnamed = describeAssetResolutionFailure(failure(GONE, "load"), undefined, en);
        const notAsset = describeAssetResolutionFailure(failure("[object Object]"), ASSET_NAMES, en);

        expect(missing).toBe("“Image Fill” on “Art” refers to an asset that is no longer in this project.");
        expect(named).toBe("“Image Fill” on “Art” refers to “castle.png”, which could not be read.");
        expect(unnamed).toBe("“Image Fill” on “Art” refers to an asset that could not be read.");
        expect(notAsset).toBe("“Image Fill” on “Art” is set to a value that is not an asset.");
        expect(new Set([missing, named, unnamed, notAsset]).size).toBe(4);
    });

    it("names each slot by the inspector's label", () => {
        const clip = { ...ART, slot: "videoClip" as const, ownerName: "Intro" };
        const background = { surfaceId: "surface-title", ownerName: "Title", slot: "surfaceBackground" as const, instanceKey: "" };
        expect(describeAssetResolutionFailure(failure(GONE, "resolve", clip), undefined, en))
            .toBe("“Clip” on “Intro” refers to an asset that is no longer in this project.");
        expect(describeAssetResolutionFailure(failure(GONE, "resolve", background), undefined, en))
            .toBe("“Background Image” on “Title” refers to an asset that is no longer in this project.");
    });

    it("never prints the value asked for, in any language", () => {
        for (const locale of ["en", "zh", "ja"] as const) {
            const t = createTranslator(locale).t;
            for (const entry of [failure(GONE), failure(GONE, "load"), failure(CASTLE), failure("[object Object]")]) {
                const sentence = describeAssetResolutionFailure(entry, ASSET_NAMES, t);
                expect(sentence, `${locale}: ${sentence}`).not.toMatch(UUID);
                expect(sentence, `${locale}: ${sentence}`).not.toContain("[object Object]");
                // Every placeholder filled: a catalog entry missing a parameter would print its brace.
                expect(sentence, `${locale}: ${sentence}`).not.toMatch(/[{}]/);
                expect(sentence).toContain("Art");
            }
        }
    });
});

// The line under an image, background or font field in the inspector and the scene card. It used to
// interpolate the lookup's own error, which is `Asset not found: <uuid>`.
describe("describeAssetFieldFailure", () => {
    const en = createTranslator("en").t;

    it("says what became of the asset, in the same three kinds as the issue list", () => {
        expect(describeAssetFieldFailure(GONE, null, en)).toBe("This asset is no longer in this project.");
        expect(describeAssetFieldFailure(CASTLE, "castle.png", en)).toBe("“castle.png” could not be read.");
        expect(describeAssetFieldFailure("[object Object]", null, en)).toBe("This value is not an asset.");
        expect(describeAssetFieldFailure(characterAvatarAssetId("character-1", "happy"), null, en))
            .toBe("This asset could not be read.");
    });

    it("never prints the value asked for, in any language", () => {
        for (const locale of ["en", "zh", "ja"] as const) {
            const t = createTranslator(locale).t;
            const sentences = [
                describeAssetFieldFailure(GONE, null, t),
                describeAssetFieldFailure(CASTLE, "castle.png", t),
                describeAssetFieldFailure(CASTLE, null, t),
                describeAssetFieldFailure("[object Object]", null, t),
            ];
            for (const sentence of sentences) {
                expect(sentence, `${locale}: ${sentence}`).not.toMatch(UUID);
                expect(sentence, `${locale}: ${sentence}`).not.toContain("[object Object]");
                expect(sentence, `${locale}: ${sentence}`).not.toMatch(/app:\/\//);
                expect(sentence, `${locale}: ${sentence}`).not.toMatch(/[{}]/);
            }
            expect(sentences[1]).toContain("castle.png");
        }
    });
});

function outcome(drawing: string, site: AssetResolutionSite, status: "drawn" | "unused"): AssetResolutionReport;
function outcome(drawing: string, site: AssetResolutionSite, status: "failed", requested: string): AssetResolutionReport;
function outcome(
    drawing: string,
    site: AssetResolutionSite,
    status: "drawn" | "unused" | "failed",
    requested?: string,
): AssetResolutionReport {
    return {
        type: "outcome",
        drawing,
        site,
        outcome: status === "failed" ? { status, requested: requested!, stage: "resolve" } : { status },
    };
}

describe("AssetResolutionLedger", () => {
    it("holds one entry per failing drawing, however often it reports", () => {
        const ledger = new AssetResolutionLedger();
        expect(ledger.apply(outcome("d1", ART, "failed", GONE))).toBe(true);
        // The same thing again is not news.
        expect(ledger.apply(outcome("d1", ART, "failed", GONE))).toBe(false);
        expect(ledger.failures()).toHaveLength(1);
    });

    it("keeps a failure while any drawing of it is still failing, and drops it when the last one draws", () => {
        const ledger = new AssetResolutionLedger();
        const row1 = { ...ART, instanceKey: "row-1" };
        const row2 = { ...ART, instanceKey: "row-2" };
        ledger.apply(outcome("d1", row1, "failed", GONE));
        ledger.apply(outcome("d2", row2, "failed", GONE));
        expect(ledger.failures()).toHaveLength(2);

        expect(ledger.apply(outcome("d1", row1, "drawn"))).toBe(true);
        expect(ledger.failures().map(entry => entry.site.instanceKey)).toEqual(["row-2"]);

        expect(ledger.apply(outcome("d2", row2, "unused"))).toBe(true);
        expect(ledger.failures()).toEqual([]);
    });

    it("keeps a failure after its drawing goes away: leaving a page does not fix it", () => {
        const ledger = new AssetResolutionLedger();
        ledger.apply(outcome("d1", ART, "failed", GONE));
        expect(ledger.apply({ type: "released", drawing: "d1" })).toBe(false);
        expect(ledger.failures()).toHaveLength(1);
    });

    it("lets a later drawing of the same place replace what a released one left behind", () => {
        const ledger = new AssetResolutionLedger();
        ledger.apply(outcome("d1", ART, "failed", GONE));
        ledger.apply({ type: "released", drawing: "d1" });

        // The page is revisited, and the picture draws now.
        expect(ledger.apply(outcome("d2", ART, "drawn"))).toBe(true);
        expect(ledger.failures()).toEqual([]);
    });

    it("ends a failure whose drawing leaves after a newer drawing of the same place has answered", () => {
        // A page's exit and enter animations overlap: after a reload the new drawing of a picture
        // answers while the old, failed one is still on its way out. Found in Dev Mode, where the
        // issue outlived a picture that was plainly back on screen.
        const ledger = new AssetResolutionLedger();
        ledger.apply(outcome("old", ART, "failed", GONE));
        expect(ledger.apply(outcome("new", ART, "drawn"))).toBe(false);
        expect(ledger.failures()).toHaveLength(1);

        expect(ledger.apply({ type: "released", drawing: "old" })).toBe(true);
        expect(ledger.failures()).toEqual([]);
    });

    it("does not let one drawing's success clear another's failure while both are on screen", () => {
        const ledger = new AssetResolutionLedger();
        ledger.apply(outcome("page", ART, "failed", GONE));
        ledger.apply(outcome("layer", ART, "drawn"));
        expect(ledger.failures()).toHaveLength(1);
    });

    it("forgets a drawing that drew fine once it goes away", () => {
        const ledger = new AssetResolutionLedger();
        ledger.apply(outcome("d1", ART, "drawn"));
        expect(ledger.apply({ type: "released", drawing: "d1" })).toBe(false);
        // Nothing of it is left to supersede a later failure of the same place.
        ledger.apply(outcome("d2", ART, "failed", GONE));
        expect(ledger.failures()).toHaveLength(1);
    });

    it("forgets released failures on a new bundle and keeps the ones still on screen", () => {
        const ledger = new AssetResolutionLedger();
        const other = { ...ART, elementId: "element-other", ownerName: "Other" };
        ledger.apply(outcome("gone", ART, "failed", GONE));
        ledger.apply({ type: "released", drawing: "gone" });
        ledger.apply(outcome("here", other, "failed", GONE));

        ledger.forgetReleased();
        expect(ledger.failures().map(entry => entry.site.ownerName)).toEqual(["Other"]);
    });

    it("reports a rename as a change, so the sentence follows the element's new name", () => {
        const ledger = new AssetResolutionLedger();
        ledger.apply(outcome("d1", ART, "failed", GONE));
        expect(ledger.apply(outcome("d1", { ...ART, ownerName: "Backdrop" }, "failed", GONE))).toBe(true);
        expect(ledger.failures()[0]!.site.ownerName).toBe("Backdrop");
    });
});
