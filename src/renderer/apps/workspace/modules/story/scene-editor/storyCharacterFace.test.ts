import { describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";

// `Service` pulls the widget registry in at module scope; nothing here initializes a workspace.
vi.mock("@/lib/ui-editor/widget-modules/registryInstance", () => ({
    ensureWidgetModulesRegistered: vi.fn(async () => undefined),
}));

const { resolveCharacterFaceImage } = await import("./storyCharacterFace");

/**
 * A row's face is framed the way the game's dialog avatar for that look is.
 *
 * The tutorial's Narra: 默认 framed by hand, 微笑 drawn at the same size and framed by nothing. A row
 * naming no pose pictures her default look, and was framed by the automatic crop rather than by that
 * pose's framing; a 微笑 row is framed by 默认's, as its avatar is baked.
 */
describe("resolveCharacterFaceImage", () => {
    const face = { x: 0.455, y: 0.01, w: 0.38, h: 0.35 };
    const narra = Character.fromJSON({
        profile: {
            id: "narra",
            name: "Narra",
            description: "",
            tags: [],
            attributes: {},
            nicknames: [],
            thumbnail: null,
            appearance: {
                kind: "preset",
                defaultPoseId: "p1oh",
                poses: [
                    { id: "p1oh", name: "默认", assetId: "narra", portrait: face },
                    { id: "p17n", name: "微笑", assetId: "smile" },
                ],
            },
        },
    } as never);
    const lookup = (assetId: string) => ({ id: assetId }) as never;
    const sameSize = { narra: { width: 1600, height: 1586 }, smile: { width: 1600, height: 1586 } };

    it("frames a row naming no pose by the default pose's framing", () => {
        expect(resolveCharacterFaceImage(narra, undefined, undefined, lookup, {}).frame).toEqual(face);
    });

    it("frames a same-size pose with no framing of its own like the framed one", () => {
        expect(resolveCharacterFaceImage(narra, "p17n", undefined, lookup, sameSize).frame).toEqual(face);
        // Until the sizes are read, the automatic crop - as before.
        expect(resolveCharacterFaceImage(narra, "p17n", undefined, lookup, {}).frame).toBeUndefined();
    });
});
