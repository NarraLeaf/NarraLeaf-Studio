import { describe, expect, it } from "vitest";
import type { PsdDocument, PsdLayerNode } from "@shared/types/psdImport";
import type { UIElement } from "@shared/types/ui-editor/document";
import { psdLayerKey } from "@shared/utils/psdLayerPlan";
import { convertFigmaFrames } from "./convertFigmaFrames";
import { buildImageDesignFile, type DesignPicture } from "./imageDesign";
import { buildPsdDesignFile, planPsdDesign, type PsdBakedPicture } from "./psdDesign";

function layer(
    path: string[],
    bounds: [number, number, number, number] | null,
    extra: Partial<PsdLayerNode> = {},
): PsdLayerNode {
    return {
        path,
        name: path[path.length - 1],
        blendMode: "normal",
        opacity: 1,
        hidden: false,
        clipping: false,
        ...(bounds ? { bounds: { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] } } : {}),
        ...extra,
    };
}

function group(path: string[], children: PsdLayerNode[], extra: Partial<PsdLayerNode> = {}): PsdLayerNode {
    return { ...layer(path, null, extra), children };
}

const document: PsdDocument = {
    width: 1280,
    height: 720,
    fileName: "Menu screen.psd",
    layers: [
        layer(["Background"], [0, 0, 1280, 720]),
        layer(["Shadow"], [100, 100, 500, 400], { blendMode: "multiply" }),
        group(["Menu"], [
            layer(["Menu", "Button bg"], [100, 300, 400, 360]),
            layer(["Menu", "Gloss"], [100, 300, 400, 330], { clipping: true }),
            layer(["Menu", "Label"], [150, 310, 350, 350], { styled: true }),
            layer(["Menu", "Draft"], [0, 0, 10, 10], { hidden: true }),
            layer(["Menu", "Orphan"], [0, 0, 10, 10], { clipping: true }),
        ], { opacity: 0.8 }),
        group(["Old"], [layer(["Old", "Thing"], [0, 0, 5, 5], { hidden: true })], { hidden: true }),
        layer(["Overlay"], [0, 0, 10, 10], { blendMode: "dissolve" }),
        group(["Fx"], [layer(["Fx", "Glow"], [0, 0, 20, 20], { blendMode: "screen" })]),
        layer(["Empty"], [5, 5, 5, 5]),
    ],
};

function byName(elements: Record<string, UIElement>, name: string): UIElement {
    const found = Object.values(elements).find(element => element.name === name);
    if (!found) throw new Error(`no element named ${name}`);
    return found;
}

describe("planPsdDesign", () => {
    const plan = planPsdDesign(document);
    const key = (path: string[]) => psdLayerKey({ path });

    it("flattens clipped layers and mergeable blends onto the layer they belong to", () => {
        const targets = Object.fromEntries(plan.targets.map(target => [target.path.join("/"), target]));
        expect(Object.keys(targets).sort()).toEqual(["Background", "Fx/Glow", "Menu/Button bg", "Menu/Label", "Overlay"]);
        expect(targets.Background.mergeFrom).toEqual([{ path: ["Shadow"] }]);
        expect(targets["Menu/Button bg"].mergeFrom).toEqual([{ path: ["Menu", "Gloss"], clip: true }]);
        expect(plan.crops[key(["Menu", "Label"])]).toEqual({ left: 150, top: 310, width: 200, height: 40 });
    });

    it("counts hidden layers once per hidden subtree and reports what it simplified", () => {
        expect(plan.skippedHidden).toBe(2);
        const notes = Object.fromEntries(plan.notes.map(note => [note.code, note]));
        expect(notes.blendMerged).toMatchObject({ count: 1, examples: ["Shadow"] });
        expect(notes.layerStyles).toMatchObject({ count: 1, examples: ["Label"] });
        expect(notes.clipBaseDropped).toMatchObject({ count: 1, examples: ["Orphan"] });
        expect(notes.blendMode).toMatchObject({ count: 2, examples: ["Overlay", "Glow"] });
    });

    it("keeps the PSD's groups, and builds a page with each layer where Photoshop drew it", () => {
        const pictures = new Map<string, PsdBakedPicture>();
        for (const target of plan.targets) {
            const k = psdLayerKey(target);
            if (k === key(["Fx", "Glow"])) continue; // a bake that did not come back
            pictures.set(k, { ...plan.crops[k], bytes: new Uint8Array([1]) });
        }
        const file = buildPsdDesignFile(document, plan, pictures);
        expect(file.frames[0]).toMatchObject({ name: "Menu screen", width: 1280, height: 720 });

        const result = convertFigmaFrames(file, { targetSize: { width: 1280, height: 720 } });
        const elements = result.document.elements;
        const menu = byName(elements, "Menu");
        expect(menu.type).toBe("nl.container");
        expect(menu.layout).toMatchObject({ x: 100, y: 300, width: 300, height: 60, opacity: 0.8 });
        expect(menu.childrenIds.map(id => elements[id].name)).toEqual(["Button bg", "Label"]);
        expect(byName(elements, "Label").layout).toMatchObject({ x: 50, y: 10, width: 200, height: 40 });
        expect(byName(elements, "Label").type).toBe("nl.image");
        // The group whose only layer did not come back is left out rather than arriving empty.
        expect(Object.values(elements).some(element => element.name === "Fx")).toBe(false);

        const codes = Object.fromEntries(result.notes.map(note => [note.code, note]));
        expect(codes.rasterized).toBeUndefined();
        expect(codes.hiddenSkipped?.count).toBe(2);
        expect(codes.missingImage).toMatchObject({ count: 1, examples: ["Glow"] });
        expect(codes.layerStyles?.examples).toEqual(["Label"]);
        expect(result.imageRefs).toHaveLength(4);
    });
});

describe("buildImageDesignFile", () => {
    const picture = (name: string, width: number, height: number, coverage: number): DesignPicture => ({
        name,
        mime: "image/png",
        bytes: new Uint8Array([1]),
        width,
        height,
        coverage,
    });

    it("takes the largest picture as the canvas, lines up same-size layers and centres cut-outs", () => {
        const file = buildImageDesignFile(
            [picture("Buttons", 1920, 1080, 0.1), picture("Icon", 64, 64, 0.8), picture("Background", 1920, 1080, 1)],
            "Title",
        );
        const frame = file.frames[0];
        expect(frame).toMatchObject({ name: "Title", width: 1920, height: 1080 });
        // Most opaque at the bottom.
        expect(frame.children!.map(child => child.name)).toEqual(["Background", "Icon", "Buttons"]);
        expect(frame.children![0].transform).toEqual([[1, 0, 0], [0, 1, 0]]);
        expect(frame.children![1].transform).toEqual([[1, 0, 928], [0, 1, 508]]);
        expect(file.notes).toEqual([{ code: "imageCentered", count: 1, examples: ["Icon"] }]);

        const result = convertFigmaFrames(file, { targetSize: { width: 1280, height: 720 } });
        const icon = byName(result.document.elements, "Icon");
        expect(icon.layout).toMatchObject({ width: 42.67, height: 42.67 });
        expect(result.notes.find(note => note.code === "rasterized")).toBeUndefined();
    });
});
