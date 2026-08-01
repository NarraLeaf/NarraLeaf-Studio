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
    it("says nothing about a preset character whose poses all have art", () => {
        const appearance = new CharacterAppearance(emptyAppearance("preset"));
        const pose = appearance.createPose("Idle")!;
        appearance.setPoseAsset(pose.id, "asset-1");
        expect(codes(appearance)).toEqual([]);
    });

    it("says nothing about a puppet, whose interior belongs to a runtime", () => {
        expect(codes(new CharacterAppearance(emptyAppearance("puppet")))).toEqual([]);
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

    it("measures against the declared canvas, and against the largest layer until one is declared", () => {
        const { appearance, layer, happy } = build();
        appearance.setLayerOption(layer.id, happy.id, "asset-1");
        const second = appearance.createLayer("Hat")!;
        appearance.setLayerAsset(second.id, "asset-2");

        const sizes = { [layer.id]: { width: 100, height: 200 }, [second.id]: { width: 64, height: 64 } };
        // No canvas declared: the biggest layer stands in, so only the hat is off-canvas.
        const undeclared = collectCharacterDiagnostics(appearance, sizes).filter(d => d.code === "offCanvas");
        expect(undeclared).toHaveLength(1);
        expect(undeclared[0].values).toMatchObject({ name: "Hat", size: "64×64", canvas: "100×200" });

        // And it stays that way when the stack is reordered - the reference is not positional.
        appearance.moveLayer(second.id, 0);
        const reordered = collectCharacterDiagnostics(appearance, sizes).filter(d => d.code === "offCanvas");
        expect(reordered.map(d => d.values.name)).toEqual(["Hat"]);

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

    it("reports two axes sharing a display name, which a story row cannot tell apart", () => {
        const { appearance, layer, happy } = build();
        appearance.setLayerOption(layer.id, happy.id, "asset-1");
        const second = appearance.createAxis("expression")!;
        const tag = appearance.createTag(second.id, "Neutral")!;
        const bound = appearance.createLayer("Mouth", second.id)!;
        appearance.setLayerOption(bound.id, tag.id, "asset-2");

        const found = collectCharacterDiagnostics(appearance).find(d => d.code === "duplicateAxis");
        expect(found).toMatchObject({ severity: "warning", target: { kind: "axis", id: second.id } });
    });

    it("reports an axis whose declared default tag is missing, which the getter papers over", () => {
        const { appearance, axis, layer, happy } = build();
        appearance.setLayerOption(layer.id, happy.id, "asset-1");
        expect(codes(appearance)).not.toContain("axisDefaultMissing");

        // Written by hand rather than through removeTag, which repairs the declaration itself - the
        // dangling id is what a hand-edited or migrated store can still carry.
        appearance.setAxisDefaultTag(axis.id, null);
        const found = collectCharacterDiagnostics(appearance).find(d => d.code === "axisDefaultMissing");
        expect(found).toMatchObject({ severity: "warning", values: { axis: "Expression", name: "Happy" } });
        // And it says which look it is talking about, so clicking it can show that look.
        expect(found?.target?.tags).toEqual({ [axis.id]: happy.id });
    });

    it("reports a look whose whole stack draws nothing, and stays quiet on an unstarted character", () => {
        const { appearance, axis, happy, angry, layer } = build();
        // Nothing assigned anywhere: every layer is already reported empty, and saying it again once
        // per combination would bury the findings that name a real hole.
        expect(codes(appearance)).not.toContain("combinationNoArt");

        appearance.setLayerOption(layer.id, happy.id, "asset-1");
        const found = collectCharacterDiagnostics(appearance).filter(d => d.code === "combinationNoArt");
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ severity: "error", values: { name: "Angry" } });
        expect(found[0].target).toMatchObject({ kind: "combination", tags: { [axis.id]: angry.id } });

        appearance.setLayerOption(layer.id, angry.id, "asset-2");
        expect(codes(appearance)).not.toContain("combinationNoArt");
    });

    it("names the look an empty layer can be checked in", () => {
        const { appearance, axis, happy, layer } = build();
        const other = appearance.createLayer("Body")!;
        appearance.setLayerAsset(other.id, "asset-1");
        const found = collectCharacterDiagnostics(appearance).find(d => d.code === "layerNoImage");
        expect(found?.target).toMatchObject({ kind: "layer", id: layer.id, tags: { [axis.id]: happy.id } });
    });

    it("reports a snapshot whose tags were deleted, which resolves to a different look in silence", () => {
        const { appearance, axis, happy, angry, layer } = build();
        appearance.setLayerOption(layer.id, happy.id, "asset-1");
        appearance.setLayerOption(layer.id, angry.id, "asset-2");
        appearance.createSnapshot("Furious", { [axis.id]: angry.id });
        expect(codes(appearance)).not.toContain("snapshotStale");

        appearance.removeTag(axis.id, angry.id);
        const found = collectCharacterDiagnostics(appearance).find(d => d.code === "snapshotStale");
        expect(found).toMatchObject({ severity: "warning", values: { name: "Furious" } });
    });
});

describe("preset characters", () => {
    it("reports a pose with no art, which is otherwise silent everywhere", () => {
        const appearance = new CharacterAppearance(emptyAppearance("preset"));
        const pose = appearance.createPose("Idle")!;
        const found = collectCharacterDiagnostics(appearance).find(d => d.code === "poseNoImage");
        expect(found).toMatchObject({ severity: "error", target: { kind: "pose", id: pose.id } });
    });

    it("reports a character with no poses at all, and says nothing else about it", () => {
        const appearance = new CharacterAppearance(emptyAppearance("preset"));
        expect(codes(appearance)).toEqual(["noPoses"]);
    });

    it("reports a default pose that was deleted, which the getter silently papers over", () => {
        const appearance = new CharacterAppearance(emptyAppearance("preset"));
        const first = appearance.createPose("Idle")!;
        const second = appearance.createPose("Angry")!;
        appearance.setPoseAsset(first.id, "asset-1");
        appearance.setPoseAsset(second.id, "asset-2");
        appearance.setDefaultPoseId(second.id);
        expect(codes(appearance)).not.toContain("defaultPoseMissing");

        // Written by hand rather than through removePose, which repairs the declaration itself -
        // the dangling id is what a hand-edited or migrated store can still carry.
        appearance.setDefaultPoseId("p-gone");
        const found = collectCharacterDiagnostics(appearance).find(d => d.code === "defaultPoseMissing");
        expect(found).toMatchObject({ severity: "warning", values: { name: "Idle" } });
    });

    it("reports two poses sharing a display name, which no picker can tell apart", () => {
        const appearance = new CharacterAppearance(emptyAppearance("preset"));
        const first = appearance.createPose("Idle")!;
        const second = appearance.createPose("idle")!;
        appearance.setPoseAsset(first.id, "asset-1");
        appearance.setPoseAsset(second.id, "asset-2");
        const found = collectCharacterDiagnostics(appearance).find(d => d.code === "duplicatePose");
        expect(found).toMatchObject({ severity: "warning", target: { kind: "pose", id: second.id } });
    });
});

describe("avatar bake volume", () => {
    /** N axes of `tagsPerAxis` tags each, every layer filled so nothing else is reported. */
    function withAxes(count: number, tagsPerAxis: number) {
        const appearance = new CharacterAppearance(emptyAppearance("layered"));
        for (let a = 0; a < count; a++) {
            const axis = appearance.createAxis(`Axis ${a}`)!;
            const layer = appearance.createLayer(`Layer ${a}`, axis.id)!;
            for (let tag = 0; tag < tagsPerAxis; tag++) {
                const created = appearance.createTag(axis.id, `Tag ${tag}`)!;
                appearance.setLayerOption(layer.id, created.id, `asset-${a}-${tag}`);
            }
        }
        return appearance;
    }

    it("says nothing while the bake is small", () => {
        // 2 x 4 = 8 avatars, which the axes on screen already make obvious.
        expect(codes(withAxes(2, 4))).not.toContain("avatarCombinations");
    });

    it("reports the count once it stops being obvious from the axes", () => {
        // 3 x 4 = 64 PNGs in the repository - a number the author should meet here, not in a diff.
        expect(codes(withAxes(3, 4))).toContain("avatarCombinations");
    });

    it("counts only the avatar axes, so narrowing them clears it", () => {
        const appearance = withAxes(3, 4);
        const [first] = appearance.getAxes();
        appearance.setAvatarAxisIds([first.id]);
        expect(codes(appearance)).not.toContain("avatarCombinations");
    });

    it("names the widest axis, which is the one worth narrowing", () => {
        const appearance = withAxes(3, 4);
        const [, , third] = appearance.getAxes();
        appearance.createTag(third.id, "Extra");
        const found = collectCharacterDiagnostics(appearance).find(d => d.code === "avatarCombinations");
        expect(found?.target).toEqual({ kind: "axis", id: third.id });
        expect(found?.values.count).toBe("80");
    });
});
