import { describe, expect, it } from "vitest";
import { buildReferenceIndex, extractLetterboxReferences, PROJECT_LETTERBOX_TARGET } from "./referenceModel";

const PICTURE = "6f0e8f7c-1d2b-4c3a-9e8f-7a6b5c4d3e2f";

/**
 * The letterbox picture lives in `.nlproj`, which no other slice walks. Without its own slice, a
 * picture drawn around every screen reads as unused and the project check offers it for deletion.
 */
describe("extractLetterboxReferences", () => {
    it("reports the picture as used, pointing at the setting that chose it", () => {
        const references = extractLetterboxReferences(
            { image: { assetId: PICTURE } },
            "Letterbox image",
        );
        expect(references).toEqual([{
            id: `projectSettings:letterbox:${PICTURE}`,
            assetId: PICTURE,
            kind: "projectSettings",
            label: "Letterbox image",
            field: "letterbox.image",
            target: { kind: "projectPage", page: "settings", part: "letterbox" },
        }]);
        expect(PROJECT_LETTERBOX_TARGET).toEqual(references[0].target);
        expect(buildReferenceIndex(references).get(PICTURE)).toHaveLength(1);
    });

    it("reports nothing without a picture", () => {
        expect(extractLetterboxReferences({ image: null }, "Letterbox image")).toEqual([]);
        expect(extractLetterboxReferences({ image: { assetId: "   " } }, "Letterbox image")).toEqual([]);
    });
});
