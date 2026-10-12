import { describe, expect, it } from "vitest";
import type { StorySceneLayer } from "./document";
import {
    addSceneLayer,
    isDefaultSceneLayerStack,
    moveSceneLayer,
    normalizeSceneLayerStack,
    rebindSceneLayerIds,
    sceneLayerFollow,
    sceneLayerNameProblem,
    sceneLayersForMovedRows,
    sceneLayerZIndex,
    setSceneLayerFollow,
} from "./sceneLayers";

const custom = (id: string, follow?: number, name = id): StorySceneLayer => ({ kind: "custom", id, name, ...(follow === undefined ? {} : { follow }) });
const keys = (stack: readonly StorySceneLayer[]) => stack.map(layer => (layer.kind === "custom" ? layer.id : layer.kind));
const shares = (stack: readonly StorySceneLayer[]) => stack.map(sceneLayerFollow);

describe("normalizeSceneLayerStack", () => {
    it("answers the stack every scene starts with when nothing is stored", () => {
        const stack = normalizeSceneLayerStack(undefined);
        expect(keys(stack)).toEqual(["displayable", "background"]);
        expect(isDefaultSceneLayerStack(stack)).toBe(true);
    });

    it("puts back a missing built-in and moves the background behind the characters", () => {
        expect(keys(normalizeSceneLayerStack([custom("fog"), { kind: "background" }]))).toEqual(["fog", "displayable", "background"]);
        expect(keys(normalizeSceneLayerStack([{ kind: "background" }, custom("hills"), { kind: "displayable" }]))).toEqual(["hills", "displayable", "background"]);
    });

    it("keeps the order and moves a share that contradicts it to its neighbour's, counted out from the characters", () => {
        const stack = normalizeSceneLayerStack([custom("leaves", 0.3), { kind: "displayable" }, custom("hills", 1.4), { kind: "background", follow: 0.6 }]);
        expect(keys(stack)).toEqual(["leaves", "displayable", "hills", "background"]);
        expect(shares(stack)).toEqual([1, 1, 1, 0.6]);
    });

    it("drops a second layer with the same id and leaves a share of exactly one unstated", () => {
        const stack = normalizeSceneLayerStack([custom("a", 1), custom("a", 0.5), { kind: "displayable" }, { kind: "background" }]);
        expect(stack).toEqual([{ kind: "custom", id: "a", name: "a" }, { kind: "displayable" }, { kind: "background" }]);
    });

    it("is idempotent", () => {
        const once = normalizeSceneLayerStack([custom("fog", 1.6), { kind: "displayable" }, custom("street", 0.6), custom("hills", 0.25), { kind: "background", follow: 0 }]);
        expect(normalizeSceneLayerStack(once)).toEqual(once);
    });
});

describe("sceneLayerZIndex", () => {
    it("orders the engine's layers as the stack does, around the built-ins at 0 and -1", () => {
        const stack = normalizeSceneLayerStack([custom("near2"), custom("near1"), { kind: "displayable" }, custom("mid"), custom("far"), { kind: "background" }, custom("behind")]);
        const z = stack.map((_, index) => sceneLayerZIndex(stack, index));
        // Front to back is highest to lowest, with the built-ins where the engine keeps them.
        expect(z[2]).toBe(0);
        expect(z[5]).toBe(-1);
        for (let index = 1; index < z.length; index += 1) {
            expect(z[index]).toBeLessThan(z[index - 1]);
        }
    });
});

describe("setSceneLayerFollow", () => {
    const stack = normalizeSceneLayerStack([custom("fog", 1.4), { kind: "displayable" }, custom("street", 0.6), custom("hills", 0.3), { kind: "background", follow: 0 }]);

    it("moves a layer past a neighbour whose share it passes", () => {
        const next = setSceneLayerFollow(stack, keys(stack).indexOf("hills"), 0.8);
        expect(keys(next)).toEqual(["fog", "displayable", "hills", "street", "background"]);
        expect(sceneLayerFollow(next[2])).toBe(0.8);
    });

    it("keeps a layer that ties with another on the side it came from", () => {
        const next = setSceneLayerFollow(stack, keys(stack).indexOf("hills"), 0.6);
        expect(keys(next)).toEqual(["fog", "displayable", "street", "hills", "background"]);
    });

    it("leaves the characters' layer where it is and the background behind it", () => {
        expect(setSceneLayerFollow(stack, 1, 0.2)).toEqual(stack);
        const next = setSceneLayerFollow(stack, keys(stack).indexOf("background"), 1.5);
        // As near as the characters and no nearer: it passes the layers that follow less, and stays behind them.
        expect(keys(next)).toEqual(["fog", "displayable", "background", "street", "hills"]);
        expect(sceneLayerFollow(next[2])).toBe(1);
    });
});

describe("moveSceneLayer", () => {
    const stack = normalizeSceneLayerStack([custom("fog", 1.4), { kind: "displayable" }, custom("street", 0.6), custom("hills", 0.3), { kind: "background", follow: 0 }]);

    it("gives a moved layer the share its new place calls for, keeping its own where it still fits", () => {
        const front = moveSceneLayer(stack, keys(stack).indexOf("hills"), 0)!;
        expect(keys(front)).toEqual(["hills", "fog", "displayable", "street", "background"]);
        expect(sceneLayerFollow(front[0])).toBe(1.4);
        const between = moveSceneLayer(stack, keys(stack).indexOf("hills"), 2)!;
        expect(keys(between)).toEqual(["fog", "displayable", "hills", "street", "background"]);
        expect(sceneLayerFollow(between[2])).toBe(0.6);
    });

    it("refuses to move the characters' layer, or the background in front of it", () => {
        expect(moveSceneLayer(stack, 1, 3)).toBeNull();
        expect(moveSceneLayer(stack, keys(stack).indexOf("background"), 0)).toBeNull();
    });
});

describe("addSceneLayer", () => {
    it("puts a new layer just behind the characters, following the camera exactly", () => {
        const stack = addSceneLayer(normalizeSceneLayerStack([custom("fog", 1.4), { kind: "displayable" }, { kind: "background", follow: 0.5 }]), { id: "new", name: "new" });
        expect(keys(stack)).toEqual(["fog", "displayable", "new", "background"]);
        expect(sceneLayerFollow(stack[2])).toBe(1);
    });
});

describe("sceneLayerNameProblem", () => {
    const stack = normalizeSceneLayerStack([custom("fog", undefined, "Fog"), { kind: "displayable" }, { kind: "background" }]);

    it("refuses an empty name, a built-in's word, and another layer's name", () => {
        expect(sceneLayerNameProblem(stack, " ")).toBe("empty");
        expect(sceneLayerNameProblem(stack, "backgroundLayer")).toBe("reserved");
        expect(sceneLayerNameProblem(stack, "Fog")).toBe("taken");
        expect(sceneLayerNameProblem(stack, "Fog", "fog")).toBeNull();
        expect(sceneLayerNameProblem(stack, "hills")).toBeNull();
    });
});

describe("sceneLayersForMovedRows", () => {
    it("brings the layers moved rows name, and points rows at a layer the target already has by that name", () => {
        const source = { layers: [custom("fog", 1.4), { kind: "displayable" as const }, custom("hills", 0.3, "hills"), { kind: "background" as const }] };
        const target = { layers: [{ kind: "displayable" as const }, custom("hills-2", 0.5, "hills"), { kind: "background" as const }] };
        const rows = [
            { payload: { layer: { kind: "custom", sourceBlockId: "fog" } } },
            { payload: { target: { kind: "custom", sourceBlockId: "hills" } } },
        ];
        const carried = sceneLayersForMovedRows(source, target, rows);
        expect(keys(carried.layers)).toEqual(["fog", "displayable", "hills-2", "background"]);
        expect(sceneLayerFollow(carried.layers[0])).toBe(1.4);
        expect([...carried.rebind]).toEqual([["hills", "hills-2"]]);
        expect(rebindSceneLayerIds(rows[1], carried.rebind)).toEqual({ payload: { target: { kind: "custom", sourceBlockId: "hills-2" } } });
        expect(rebindSceneLayerIds(rows[0], carried.rebind)).toBe(rows[0]);
    });
});
