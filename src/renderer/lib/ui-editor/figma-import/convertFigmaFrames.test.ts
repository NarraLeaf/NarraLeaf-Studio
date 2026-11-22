import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { createTranslator } from "@shared/i18n";
import { convertFigmaFrames, FIGMA_IMPORT_NOTE_CODES } from "./convertFigmaFrames";
import { FIGMA_EXPORT_FORMAT, parseFigmaExport, type FigmaExportFile, type FigmaExportNode, type FigmaMatrix } from "./figmaExportFormat";
import { figmaGradientToFill, invertMatrix, placeInParent } from "./figmaGeometry";

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 1, g: 1, b: 1, a: 1 };

function translate(x: number, y: number): FigmaMatrix {
    return [[1, 0, x], [0, 1, y]];
}

function rotateAbout(x: number, y: number, deg: number): FigmaMatrix {
    const r = (deg * Math.PI) / 180;
    return [[Math.cos(r), -Math.sin(r), x], [Math.sin(r), Math.cos(r), y]];
}

function node(partial: Partial<FigmaExportNode> & Pick<FigmaExportNode, "id" | "name" | "kind">): FigmaExportNode {
    return {
        figmaType: "RECTANGLE",
        width: 100,
        height: 100,
        transform: translate(0, 0),
        opacity: 1,
        fills: [],
        strokes: [],
        strokeWeight: 0,
        strokeAlign: "INSIDE",
        dashed: false,
        radii: [0, 0, 0, 0],
        effects: [],
        clipsContent: false,
        ...partial,
    };
}

function exportOf(frames: FigmaExportNode[], images: FigmaExportFile["images"] = {}): FigmaExportFile {
    return { format: FIGMA_EXPORT_FORMAT, version: 1, source: { fileName: "Design", pageName: "Page 1" }, frames, images };
}

function byName(elements: Record<string, UIElement>, name: string): UIElement {
    const found = Object.values(elements).find(element => element.name === name);
    if (!found) throw new Error(`no element named ${name}`);
    return found;
}

function baseRow(element: UIElement, key: string): unknown {
    const model = (element.props as { appearance: AppearanceModel }).appearance;
    const variant = model.variants.find(v => v.id === model.defaultVariantId)!;
    return variant.propertyGroups.find(group => group.key === key)?.rows.find(row => !row.conditions)?.value;
}

describe("figmaGeometry", () => {
    it("places a rotated child by its centre in the parent's space", () => {
        // A 100x50 box rotated 30deg clockwise about its own top-left at (200, 100).
        const placed = placeInParent({ transform: rotateAbout(200, 100, 30), width: 100, height: 50 }, translate(100, 50));
        expect(placed.rotation).toBeCloseTo(30);
        // Centre on the page is the top-left plus the rotated half-diagonal.
        const r = Math.PI / 6;
        const cx = 200 + 50 * Math.cos(r) - 25 * Math.sin(r);
        const cy = 100 + 50 * Math.sin(r) + 25 * Math.cos(r);
        expect(placed.x + 50).toBeCloseTo(cx - 100);
        expect(placed.y + 25).toBeCloseTo(cy - 50);
    });

    it("reads a top-to-bottom linear gradient as 180deg with stops edge to edge", () => {
        // Gradient space (0,0.5)->(1,0.5) lands on the node's top centre -> bottom centre.
        const inverse: FigmaMatrix = [[0, -1, 1], [1, 0, 0]];
        const fill = figmaGradientToFill(
            "GRADIENT_LINEAR",
            invertMatrix(inverse),
            [{ position: 0, color: WHITE }, { position: 1, color: BLACK }],
            1,
            200,
            100,
        );
        expect(fill.kind).toBe("linear");
        expect(fill.angle).toBeCloseTo(180);
        expect(fill.stops.map(stop => stop.offset)).toEqual([0, 1]);
        expect(fill.stops[0].color).toBe("#FFFFFF");
    });

    it("re-measures stops when the handles stop short of the box", () => {
        // Left to right, but only across the middle half.
        const inverse: FigmaMatrix = [[0.5, 0, 0.25], [0, 1, 0]];
        const fill = figmaGradientToFill(
            "GRADIENT_LINEAR",
            invertMatrix(inverse),
            [{ position: 0, color: WHITE }, { position: 1, color: BLACK }],
            1,
            100,
            100,
        );
        expect(fill.angle).toBeCloseTo(90);
        expect(fill.stops[0].offset).toBeCloseTo(0.25);
        expect(fill.stops[1].offset).toBeCloseTo(0.75);
    });
});

describe("parseFigmaExport", () => {
    it("refuses what is not an export, and an export from a newer plugin", () => {
        expect(parseFigmaExport("{")).toEqual({ ok: false, reason: "notJson" });
        expect(parseFigmaExport("{\"format\":\"other\"}")).toEqual({ ok: false, reason: "notExport" });
        expect(parseFigmaExport(JSON.stringify({ format: FIGMA_EXPORT_FORMAT, version: 99, frames: [{}] }))).toEqual({
            ok: false,
            reason: "tooNew",
        });
        expect(parseFigmaExport(JSON.stringify({ format: FIGMA_EXPORT_FORMAT, version: 1, frames: [] }))).toEqual({
            ok: false,
            reason: "noFrames",
        });
    });
});

describe("convertFigmaFrames", () => {
    const frame = node({
        id: "1:1",
        name: "Title screen",
        kind: "frame",
        figmaType: "FRAME",
        width: 1280,
        height: 720,
        transform: translate(5000, 3000),
        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.2, a: 1 }, opacity: 1 }],
        clipsContent: true,
        children: [
            node({
                id: "1:2",
                name: "Panel",
                kind: "shape",
                width: 400,
                height: 200,
                transform: translate(5100, 3100),
                fills: [{ type: "SOLID", color: WHITE, opacity: 0.5 }],
                strokes: [{ type: "SOLID", color: BLACK, opacity: 1 }],
                strokeWeight: 2,
                radii: [8, 8, 8, 8],
                effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0 }],
            }),
            node({
                id: "1:3",
                name: "Group",
                kind: "group",
                figmaType: "GROUP",
                width: 200,
                height: 100,
                transform: translate(5600, 3200),
                children: [
                    node({ id: "1:4", name: "Dot", kind: "shape", width: 20, height: 20, transform: translate(5650, 3250),
                        fills: [{ type: "SOLID", color: BLACK, opacity: 1 }] }),
                ],
            }),
            node({
                id: "1:5",
                name: "Heading",
                kind: "text",
                figmaType: "TEXT",
                width: 300,
                height: 40,
                transform: translate(5100, 3400),
                fills: [{ type: "SOLID", color: WHITE, opacity: 1 }],
                text: {
                    characters: "start",
                    fontFamily: "Inter",
                    fontStyle: "Bold Italic",
                    fontWeight: 700,
                    fontSize: 32,
                    lineHeight: { unit: "PIXELS", value: 40 },
                    letterSpacing: { unit: "PIXELS", value: 1 },
                    align: "CENTER",
                    verticalAlign: "CENTER",
                    autoResize: "WIDTH_AND_HEIGHT",
                    textCase: "UPPER",
                    mixed: false,
                },
            }),
            node({
                id: "1:6",
                name: "Menu",
                kind: "frame",
                figmaType: "FRAME",
                width: 200,
                height: 120,
                transform: translate(5900, 3400),
                autoLayout: {
                    direction: "VERTICAL",
                    gap: 10,
                    padding: { top: 4, right: 4, bottom: 4, left: 4 },
                    primaryAlign: "MIN",
                    counterAlign: "CENTER",
                    wrap: false,
                },
                children: [
                    node({ id: "1:7", name: "Item A", kind: "shape", width: 100, height: 30, transform: translate(5950, 3404) }),
                    node({ id: "1:8", name: "Item B", kind: "shape", width: 100, height: 30, transform: translate(5950, 3444) }),
                ],
            }),
            node({
                id: "1:9",
                name: "Key art",
                kind: "shape",
                width: 320,
                height: 180,
                transform: translate(5000, 3500),
                fills: [{ type: "IMAGE", imageRef: "img-1", scaleMode: "FILL", opacity: 1 }],
            }),
            node({
                id: "1:10",
                name: "Star",
                kind: "raster",
                figmaType: "STAR",
                width: 50,
                height: 50,
                transform: translate(5010, 3010),
                raster: { imageRef: "img-2", reason: "vector" },
            }),
        ],
    });
    const images = {
        "img-1": { mime: "image/png", data: "AAAA" },
        "img-2": { mime: "image/png", data: "BBBB" },
    };

    it("makes one page per frame, scaled to fit the project's resolution", () => {
        const result = convertFigmaFrames(exportOf([frame], images), { targetSize: { width: 1920, height: 1080 } });
        expect(result.document.surfaces).toHaveLength(1);
        const surface = result.document.surfaces[0];
        expect(surface.name).toBe("Title screen");
        expect(surface.designSize).toEqual({ width: 1920, height: 1080 });

        const root = result.document.elements[surface.rootElementId];
        expect(root.type).toBe("nl.root");
        const top = result.document.elements[root.childrenIds[0]];
        expect(top.type).toBe("nl.container");
        expect(top.layout).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
        expect(top.props).toMatchObject({ backgroundColor: "#1A1A33", clipContent: true, fillVisible: true });

        const panel = byName(result.document.elements, "Panel");
        expect(panel.layout).toMatchObject({ x: 150, y: 150, width: 600, height: 300 });
        expect(panel.props).toMatchObject({
            backgroundColor: "#FFFFFF",
            fillOpacity: 0.5,
            borderWidth: 3,
            borderRadius: 12,
            strokeVisible: true,
            strokeAlign: "inside",
        });
        // A container draws its fill and shadow from its appearance rows, so they must say the same.
        expect(baseRow(panel, "fillOpacity")).toBe(0.5);
        expect(baseRow(panel, "effectShadow")).toEqual({
            storage: "layer",
            layer: { offsetX: 0, offsetY: 6, blur: 12, spread: 0, color: "rgba(0, 0, 0, 0.25)" },
        });
    });

    it("measures a group's children from the group, not from the frame", () => {
        const result = convertFigmaFrames(exportOf([frame], images), { targetSize: { width: 1280, height: 720 } });
        const group = byName(result.document.elements, "Group");
        const dot = byName(result.document.elements, "Dot");
        expect(dot.parentId).toBe(group.id);
        expect(dot.layout).toMatchObject({ x: 50, y: 50 });
        expect(group.props).toMatchObject({ fillVisible: false, strokeVisible: false, clipContent: false });
    });

    it("turns text, auto layout, picture fills and drawn layers into their widgets", () => {
        const fonts: string[] = [];
        const result = convertFigmaFrames(exportOf([frame], images), {
            targetSize: { width: 1280, height: 720 },
            resolveFont: family => {
                fonts.push(family);
                return null;
            },
        });
        const elements = result.document.elements;

        const heading = byName(elements, "Heading");
        expect(heading.type).toBe("nl.text");
        expect(heading.props).toMatchObject({
            text: "START",
            fontSize: 32,
            fontWeight: "bold",
            fontStyle: "italic",
            textAlign: "center",
            textVerticalAlign: "center",
            lineHeight: 1.25,
            textWrapMode: "nowrap",
            fontAssetId: null,
            color: "#FFFFFF",
        });
        expect(fonts).toEqual(["Inter"]);

        const menu = byName(elements, "Menu");
        expect(menu.props).toMatchObject({
            layoutKind: "stack",
            stackDirection: "vertical",
            stackGap: 10,
            stackPaddingTop: 4,
            stackAlignItems: "center",
            stackJustifyContent: "start",
        });
        expect(menu.childrenIds.map(id => elements[id].name)).toEqual(["Item A", "Item B"]);

        const art = byName(elements, "Key art");
        expect(art.type).toBe("nl.image");
        expect(art.props).toMatchObject({ imageFill: { mode: "cover", assetId: "img-1" }, strokeVisible: false });

        const star = byName(elements, "Star");
        expect(star.type).toBe("nl.image");
        expect(star.props).toMatchObject({ imageFill: { mode: "stretch", assetId: "img-2" } });

        expect(result.imageRefs).toEqual(["img-1", "img-2"]);
        const codes = Object.fromEntries(result.notes.map(note => [note.code, note]));
        expect(codes.rasterized).toMatchObject({ count: 1, examples: ["Star"] });
        expect(codes.missingFont).toMatchObject({ examples: ["Inter"] });
        expect(codes.letterSpacing).toMatchObject({ count: 1 });
    });

    it("keeps the computed positions when a stack cannot say what the auto layout says", () => {
        const absoluteChild = {
            ...frame.children![3],
            children: [
                ...frame.children![3].children!,
                node({ id: "1:11", name: "Badge", kind: "shape", width: 10, height: 10, transform: translate(6090, 3400), absolute: true }),
            ],
        };
        const result = convertFigmaFrames(exportOf([{ ...frame, children: [absoluteChild] }]), {
            targetSize: { width: 1280, height: 720 },
        });
        const menu = byName(result.document.elements, "Menu");
        expect(menu.props).toMatchObject({ layoutKind: "free" });
        expect(byName(result.document.elements, "Item B").layout).toMatchObject({ x: 50, y: 44 });
        expect(result.notes.find(note => note.code === "autoLayoutFlattened")?.examples).toEqual(["Menu"]);
    });

    it("imports only the frames asked for, and says when a frame's shape differs from the project's", () => {
        const second = { ...frame, id: "2:1", name: "Square", width: 500, height: 500, children: [] };
        const result = convertFigmaFrames(exportOf([frame, second]), {
            frameIds: ["2:1"],
            targetSize: { width: 1920, height: 1080 },
        });
        expect(result.document.surfaces.map(surface => surface.name)).toEqual(["Square"]);
        const top = result.document.elements[result.document.elements[result.document.surfaces[0].rootElementId].childrenIds[0]];
        // Fitted, then centred.
        expect(top.layout).toMatchObject({ x: 420, y: 0, width: 1080, height: 1080 });
        expect(result.notes.find(note => note.code === "aspectMismatch")?.count).toBe(1);
    });

    it("reports a drawn layer whose picture is missing instead of placing an empty image", () => {
        const broken = { ...frame, children: [frame.children![5]] };
        const result = convertFigmaFrames(exportOf([broken]), { targetSize: { width: 1280, height: 720 } });
        expect(Object.values(result.document.elements).some(element => element.name === "Star")).toBe(false);
        expect(result.notes.find(note => note.code === "missingImage")?.examples).toEqual(["Star"]);
    });
});

describe("the import report's sentences", () => {
    it("exist in English for every note the converter can make", () => {
        // The dialog builds these keys from the code, which the type checker cannot follow.
        const en = createTranslator("en");
        for (const code of FIGMA_IMPORT_NOTE_CODES) {
            expect(en.has(`uiEditor.designImport.note.${code}.one`), code).toBe(true);
            expect(en.has(`uiEditor.designImport.note.${code}.other`), code).toBe(true);
        }
    });
});
