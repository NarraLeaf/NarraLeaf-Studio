import { describe, expect, it, vi } from "vitest";
import { CharacterAppearance, emptyAppearance } from "./CharacterAppearance";

describe("CharacterAppearance.addPoses", () => {
    it("adds every pose with its image in one change", () => {
        const onChange = vi.fn();
        const assets = vi.fn();
        const appearance = new CharacterAppearance(emptyAppearance("preset"), onChange);
        appearance.setOnAssetChange(assets);
        const made = appearance.addPoses([
            { name: "Smile", assetId: "a1" },
            { name: "  ", assetId: "a2" },
            { name: "Cry", assetId: "a3" },
        ]);
        expect(made.map(pose => pose.name)).toEqual(["Smile", "Cry"]);
        expect(appearance.getPoses().map(pose => pose.assetId)).toEqual(["a1", "a3"]);
        expect(appearance.getDefaultPoseId()).toBe(made[0].id);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(assets.mock.calls).toEqual([[null, "a1"], [null, "a3"]]);
    });

    it("keeps the existing default and writes nothing for an empty batch", () => {
        const onChange = vi.fn();
        const appearance = new CharacterAppearance(emptyAppearance("preset"), onChange);
        const first = appearance.createPose("Base");
        onChange.mockClear();
        expect(appearance.addPoses([])).toEqual([]);
        expect(onChange).not.toHaveBeenCalled();
        appearance.addPoses([{ name: "Smile", assetId: null }]);
        expect(appearance.getDefaultPoseId()).toBe(first?.id);
    });

    it("does nothing on a layered character", () => {
        const appearance = new CharacterAppearance(emptyAppearance("layered"));
        expect(appearance.addPoses([{ name: "Smile", assetId: "a1" }])).toEqual([]);
    });
});
