import { describe, expect, it } from "vitest";
import { CharacterAppearance, emptyAppearance } from "./CharacterAppearance";
import { collectCharacterDiagnostics, type LayerSize } from "./characterDiagnostics";

/** A layered character with one axis of two tags and one layer bound to it. */
function build() {
    const appearance = new CharacterAppearance(emptyAppearance("layered"));
    const axis = appearance.createAxis("Expression")!;
    const happy = appearance.createTag(axis.id, "Happy")!;
    const angry = appearance.createTag(axis.id, "Angry")!;
    const layer = appearance.createLayer("Brows", axis.id)!;
    return { appearance, axis, happy, angry, layer };
}

function codes(appearance: CharacterAppearance, sizes: Record<string, LayerSize> = {}) {
    return collectCharacterDiagnostics(appearance, sizes).map(d => d.code);
}

describe("collectCharacterDiagnostics", () => {
    it("says nothing about a preset character", () => {
        const appearance = new CharacterAppearance(emptyAppearance("preset"));
        appearance.createPose("Idle");
        expect(codes(appearance)).toEqual([]);
    });

    it("leaves a scoped layer alone but reports one that draws nothing at all", () => {
        const { appearance, layer, happy } = build();
        // Nothing set yet: every tag is null, which is a layer the author has not finished.
        expect(codes(appearance)).toContain("layerNoImage");

        // One tag filled is the scoped-layer idiom ("only the casual outfit has a jacket").
        appearance.setLayerOption(layer.id, happy.id, "asset-1");
        expect(codes(appearance)).not.toContain("layerNoImage");
    });

    it("reports a constant layer with no image, which the compiler would silently drop", () => {
        const appearance = new CharacterAppearance(emptyAppearance("layered"));
        appearance.createLayer("Body");
        expect(codes(appearance)).toEqual(["constantNoImage"]);
    });

    it("reports an axis with no tags and an axis that drives no layer", () => {
        const appearance = new CharacterAppearance(emptyAppearance("layered"));
        const empty = appearance.createAxis("Outfit")!;
        expect(codes(appearance)).toContain("axisNoTags");

        appearance.createTag(empty.id, "Uniform");
        expect(codes(appearance)).toContain("axisUnused");
    });

    it("measures against the declared canvas, and against the bottom layer until one is declared", () => {
        const { appearance, layer, happy } = build();
        appearance.setLayerOption(layer.id, happy.id, "asset-1");
        const second = appearance.createLayer("Hat")!;
        appearance.setLayerAsset(second.id, "asset-2");

        const sizes = { [layer.id]: { width: 100, height: 200 }, [second.id]: { width: 64, height: 64 } };
        // No canvas declared: the bottom layer is the reference, so only the hat is off-canvas.
        const undeclared = collectCharacterDiagnostics(appearance, sizes).filter(d => d.code === "offCanvas");
        expect(undeclared).toHaveLength(1);
        expect(undeclared[0].values).toMatchObject({ name: "Hat", size: "64×64", canvas: "100×200" });

        // Declaring a canvas neither layer matches puts both of them in the list.
        appearance.setCanvas({ width: 800, height: 1200 });
        expect(collectCharacterDiagnostics(appearance, sizes).filter(d => d.code === "offCanvas")).toHaveLength(2);
    });

    it("reports two tags of one axis sharing a display name", () => {
        const { appearance, axis, angry, layer, happy } = build();
        appearance.setLayerOption(layer.id, happy.id, "asset-1");
        expect(codes(appearance)).not.toContain("duplicateTag");

        appearance.rename(angry, "happy");
        const duplicate = collectCharacterDiagnostics(appearance).find(d => d.code === "duplicateTag");
        expect(duplicate).toMatchObject({ severity: "warning", target: { kind: "axis", id: axis.id } });
    });
});
