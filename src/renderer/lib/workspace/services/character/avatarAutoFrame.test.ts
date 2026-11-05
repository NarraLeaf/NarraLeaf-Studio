import { describe, expect, it } from "vitest";
import { Character } from "./Character";
import { applyAutoFrames, planAutoFrame } from "./avatarAutoFrame";

const crop = { x: 0.3, y: 0.02, w: 0.4, h: 0.2 };

function preset(): Character {
    return Character.fromJSON({
        profile: {
            id: "c1",
            name: "Heroine",
            description: "",
            tags: [],
            attributes: {},
            nicknames: [],
            thumbnail: null,
            appearance: {
                kind: "preset",
                defaultPoseId: "p1",
                poses: [
                    { id: "p1", name: "Smiling", assetId: "a1" },
                    { id: "p2", name: "Angry", assetId: "a2", portrait: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
                    { id: "p3", name: "Drawn by hand", assetId: "a3" },
                    { id: "p4", name: "No art" },
                ],
                avatars: { p3: { overrideAssetId: "face" }, p1: { portrait: { x: 0.5, y: 0.5, w: 0.1, h: 0.05 } } },
            },
        },
    } as never);
}

function layered(): Character {
    return Character.fromJSON({
        profile: {
            id: "c2",
            name: "Rival",
            description: "",
            tags: [],
            attributes: {},
            nicknames: [],
            thumbnail: null,
            appearance: {
                kind: "layered",
                canvas: { width: 100, height: 200 },
                axes: [
                    { id: "face", name: "face", tags: [{ id: "t1", name: "calm" }, { id: "t2", name: "smile" }], defaultTagId: "t1" },
                ],
                layers: [
                    { id: "l-body", name: "body", assetId: "body" },
                    { id: "l-face", name: "face", axisId: "face", options: { t1: "face-calm", t2: "face-smile" } },
                ],
                avatarAxisIds: ["face"],
                avatars: {},
            },
        },
    } as never);
}

describe("planAutoFrame", () => {
    it("keeps framings, hand-drawn avatars and empty poses out of a default run", () => {
        const plan = planAutoFrame(preset(), false);
        expect(plan.map(item => [item.label, item.skip ?? "detect"])).toEqual([
            ["Smiling", "framed"],
            ["Angry", "framed"],
            ["Drawn by hand", "override"],
            ["No art", "empty"],
        ]);
    });

    it("looks again at framed differentials when told to overwrite, never at a hand-drawn one", () => {
        const plan = planAutoFrame(preset(), true);
        expect(plan.map(item => item.skip ?? "detect")).toEqual(["detect", "detect", "override", "empty"]);
        expect(plan[0].layers).toEqual(["a1"]);
    });

    it("plans one look per avatar tag, drawing the whole stack, named by tag", () => {
        const plan = planAutoFrame(layered(), false);
        expect(plan.map(item => item.label)).toEqual(["calm", "smile"]);
        expect(plan[1].layers).toEqual(["body", "face-smile"]);
        expect(plan.every(item => !item.skip)).toBe(true);
    });
});

describe("applyAutoFrames", () => {
    it("writes a preset framing on the pose and drops an entry framing that would outrank it", () => {
        const character = preset();
        const record = applyAutoFrames(character, new Map([["p1", { selection: { poseId: "p1" }, crop }]]));
        const appearance = record.profile.appearance as { poses: { id: string; portrait?: unknown }[]; avatars: Record<string, { portrait?: unknown }> };
        expect(appearance.poses.find(pose => pose.id === "p1")?.portrait).toEqual(crop);
        expect(appearance.avatars.p1).toBeUndefined();
        // The live character is untouched until the record is committed.
        expect(character.profile.appearance.getPose("p1")?.portrait).toBeUndefined();
        expect(character.profile.appearance.getAvatarPortrait("p1")).not.toBeNull();
    });

    it("writes a layered framing on the look's avatar entry, keeping its bake stamp", () => {
        const character = layered();
        character.profile.appearance.setAvatar("t2", { baked: "abcd1234" });
        const record = applyAutoFrames(character, new Map([["t2", { selection: { tags: { face: "t2" } }, crop }]]));
        const avatars = (record.profile.appearance as { avatars: Record<string, unknown> }).avatars;
        expect(avatars.t2).toEqual({ baked: "abcd1234", portrait: crop });
    });
});
