import { describe, expect, it } from "vitest";
import { CharacterAppearance } from "./CharacterAppearance";

describe("sequence pose ownership", () => {
    it("persists all frames and releases them when returning to a static pose", () => {
        const appearance = new CharacterAppearance({
            kind: "preset",
            poses: [{ id: "idle", name: "Idle", assetId: "old" }],
            defaultPoseId: "idle",
        });
        const released: string[] = [];
        appearance.setOnAssetChange(old => {
            if (old) released.push(old);
        });
        appearance.setPoseSequence("idle", { frameAssetIds: ["a", "b", "c"], fps: 12, loop: true });
        expect(appearance.listAssetIds()).toEqual(["a", "b", "c"]);
        const saved = appearance.toJSON();
        const restored = new CharacterAppearance(saved);
        expect(restored.getPose("idle")?.sequence?.frameAssetIds).toEqual(["a", "b", "c"]);
        appearance.setPoseAsset("idle", "a");
        expect(appearance.listAssetIds()).toEqual(["a"]);
        expect(appearance.getPose("idle")?.sequence).toBeUndefined();
        expect(released).toEqual(["old", "b", "c"]);
    });

    it("clones sequence state and releases every frame on pose deletion", () => {
        const appearance = new CharacterAppearance({
            kind: "preset",
            poses: [
                {
                    id: "idle",
                    name: "Idle",
                    assetId: "a",
                    sequence: { frameAssetIds: ["a", "b"], fps: 12, loop: true },
                },
            ],
            defaultPoseId: "idle",
        });
        const saved = appearance.toJSON();
        if (saved.kind === "preset") saved.poses[0].sequence!.frameAssetIds.reverse();
        expect(appearance.getPose("idle")?.sequence?.frameAssetIds).toEqual(["a", "b"]);
        const released: string[] = [];
        appearance.setOnAssetChange(old => {
            if (old) released.push(old);
        });
        appearance.removePose("idle");
        expect(released).toEqual(["a", "b"]);
        expect(appearance.listAssetIds()).toEqual([]);
    });
});
