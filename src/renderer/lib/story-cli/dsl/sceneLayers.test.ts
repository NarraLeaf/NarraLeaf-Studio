import { describe, expect, it } from "vitest";
import type { StoryScene } from "@shared/types/story";
import { applySceneLayerDirectives, printSceneLayers } from "./sceneLayers";

function scene(layers?: StoryScene["layers"]): StoryScene {
    return { id: "s", name: "Scene", runtimeName: "scene", rootBlockIds: [], blocks: {}, ...(layers ? { layers } : {}) };
}

const directives = (...lines: string[]) => lines.map((line, index) => ({ value: line, line: index + 2 }));

describe("#layer", () => {
    it("prints nothing for a scene with no layers of its own", () => {
        expect(printSceneLayers(scene())).toEqual([]);
    });

    it("prints the stack nearest first, with each share that is not all of the camera", () => {
        expect(printSceneLayers(scene([
            { kind: "custom", id: "fog", name: "fog", follow: 1.4 },
            { kind: "displayable" },
            { kind: "custom", id: "far", name: "far hills", follow: 0.3 },
            { kind: "background", follow: 0 },
        ]))).toEqual([
            "#layer fog follow=140%",
            "#layer displayableLayer",
            "#layer 'far hills' follow=30%",
            "#layer backgroundLayer follow=0%",
        ]);
    });

    it("reads back what it prints, keeping each layer's id", () => {
        const before = scene([{ kind: "custom", id: "fog", name: "fog", follow: 1.4 }, { kind: "displayable" }, { kind: "background" }]);
        const read = applySceneLayerDirectives(before, directives(...printSceneLayers(before).map(line => line.slice("#layer ".length))), () => "minted");
        expect(read.diagnostics).toEqual([]);
        expect(read.scene.layers).toEqual(before.layers);
    });

    it("makes a new layer for a name the scene does not have, and removes one the lines leave out", () => {
        const before = scene([{ kind: "custom", id: "fog", name: "fog" }, { kind: "displayable" }, { kind: "background" }]);
        const read = applySceneLayerDirectives(before, directives("displayableLayer", "mist follow=60%", "backgroundLayer"), () => "minted");
        expect(read.scene.layers).toEqual([
            { kind: "displayable" },
            { kind: "custom", id: "minted", name: "mist", follow: 0.6 },
            // Behind the mist, so no nearer than it.
            { kind: "background", follow: 0.6 },
        ]);
    });

    it("moves a share its place contradicts to its neighbour's, and says so", () => {
        const read = applySceneLayerDirectives(scene(), directives("leaves follow=30%", "displayableLayer", "backgroundLayer"), () => "minted");
        expect(read.scene.layers?.[0]).toEqual({ kind: "custom", id: "minted", name: "leaves" });
        expect(read.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["file.layer_follow_adjusted"]);
    });

    it("refuses two layers of one name, and leaves the scene as it was", () => {
        const before = scene();
        const read = applySceneLayerDirectives(before, directives("fog", "fog"), () => "minted");
        expect(read.scene).toBe(before);
        expect(read.diagnostics.map(diagnostic => diagnostic.severity)).toEqual(["error"]);
    });

    it("leaves the layers alone when the file states none", () => {
        const before = scene([{ kind: "custom", id: "fog", name: "fog" }, { kind: "displayable" }, { kind: "background" }]);
        expect(applySceneLayerDirectives(before, undefined, () => "minted").scene).toBe(before);
    });
});
