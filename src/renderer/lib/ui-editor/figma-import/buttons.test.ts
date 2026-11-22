import { describe, expect, it } from "vitest";
import type { PsdDocument, PsdLayerNode } from "@shared/types/psdImport";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import { psdLayerKey } from "@shared/utils/psdLayerPlan";
import { buttonBaseName, buttonStateOfName } from "./buttonStates";
import { convertFigmaFrames } from "./convertFigmaFrames";
import { FIGMA_EXPORT_FORMAT, type FigmaExportFile, type FigmaExportNode, type FigmaMatrix } from "./figmaExportFormat";
import { buildImageDesignFile, type DesignPicture } from "./imageDesign";
import { buildPsdDesignFile, planPsdDesign, type PsdBakedPicture } from "./psdDesign";

const T = (x: number, y: number): FigmaMatrix => [[1, 0, x], [0, 1, y]];

function node(partial: Partial<FigmaExportNode> & Pick<FigmaExportNode, "id" | "name" | "kind">): FigmaExportNode {
    return {
        figmaType: "RECTANGLE",
        width: 200,
        height: 50,
        transform: T(0, 0),
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

const solid = (r: number, g: number, b: number) => ({ type: "SOLID" as const, color: { r, g, b, a: 1 }, opacity: 1 });

function text(id: string, characters: string, color = solid(1, 1, 1), x = 50, y = 10): FigmaExportNode {
    return node({
        id,
        name: "Label",
        kind: "text",
        figmaType: "TEXT",
        width: 100,
        height: 30,
        transform: T(x, y),
        fills: [color],
        text: {
            characters,
            fontFamily: "",
            fontStyle: "Regular",
            fontWeight: 400,
            fontSize: 20,
            lineHeight: { unit: "AUTO", value: 0 },
            letterSpacing: { unit: "PIXELS", value: 0 },
            align: "CENTER",
            verticalAlign: "CENTER",
            autoResize: "NONE",
            textCase: "ORIGINAL",
            mixed: false,
        },
    });
}

function page(children: FigmaExportNode[], images: FigmaExportFile["images"] = {}): FigmaExportFile {
    return {
        format: FIGMA_EXPORT_FORMAT,
        version: 1,
        source: { fileName: "Buttons", pageName: "" },
        frames: [node({ id: "f", name: "Page", kind: "frame", figmaType: "FRAME", width: 800, height: 600, children })],
        images,
    };
}

function byName(elements: Record<string, UIElement>, name: string): UIElement {
    const found = Object.values(elements).find(element => element.name === name);
    if (!found) throw new Error(`no element named ${name}`);
    return found;
}

function rows(element: UIElement, key: string) {
    const model = (element.props as { appearance: AppearanceModel }).appearance;
    const variant = model.variants.find(entry => entry.id === model.defaultVariantId)!;
    return variant.propertyGroups.find(group => group.key === key)?.rows ?? [];
}

describe("buttonStates", () => {
    it("reads a state word in any of the usual spellings, and only as a word", () => {
        expect(buttonStateOfName("normal")).toBe("default");
        expect(buttonStateOfName("btn_start_hover")).toBe("hover");
        expect(buttonStateOfName("Start-Pressed")).toBe("pressed");
        expect(buttonStateOfName("State=Disabled")).toBe("disabled");
        expect(buttonStateOfName("悬停")).toBe("hover");
        expect(buttonStateOfName("开始按下")).toBe("pressed");
        expect(buttonStateOfName("hovercraft")).toBeNull();
        expect(buttonStateOfName("Start")).toBeNull();
    });

    it("finds what the files of one button share", () => {
        expect(buttonBaseName("start_hover")).toBe("start");
        expect(buttonBaseName("Start-Pressed")).toBe("Start");
        expect(buttonBaseName("开始按下")).toBe("开始");
        expect(buttonBaseName("start")).toBe("start");
    });
});

describe("converting buttons", () => {
    it("makes a button of a group whose layers are named for states, with the text as its label", () => {
        const group = node({
            id: "g",
            name: "Start",
            kind: "group",
            figmaType: "GROUP",
            transform: T(100, 100),
            children: [
                node({ id: "n", name: "normal", kind: "shape", transform: T(100, 100), fills: [solid(0.25, 0.66, 0.77)], radii: [8, 8, 8, 8] }),
                node({ id: "h", name: "hover", kind: "shape", transform: T(100, 100), fills: [solid(0.4, 0.8, 0.9)], radii: [8, 8, 8, 8] }),
                node({ id: "p", name: "pressed", kind: "shape", transform: T(100, 100), fills: [solid(0.1, 0.4, 0.5)], radii: [8, 8, 8, 8] }),
                text("t", "开始游戏", solid(1, 1, 1), 150, 110),
            ],
        });
        const result = convertFigmaFrames(page([group]), { targetSize: { width: 800, height: 600 } });
        const button = byName(result.document.elements, "Start");
        expect(button.type).toBe("nl.button");
        expect(button.childrenIds).toEqual([]);
        expect(button.layout).toMatchObject({ x: 100, y: 100, width: 200, height: 50 });
        expect(button.props).toMatchObject({ label: "开始游戏", backgroundColor: "#40A8C4", borderRadius: 8, fontSize: 20, paddingX: 50 });
        expect(rows(button, "backgroundColor")).toEqual([
            { conditions: null, value: "#40A8C4" },
            { conditions: { hovered: true }, value: "#66CCE6" },
            { conditions: { active: true }, value: "#1A6680" },
        ]);
        // A state that changes nothing else adds no row for it.
        expect(rows(button, "borderRadius")).toHaveLength(1);
        expect(result.buttons).toBe(1);
    });

    it("makes a button of a component instance and its state variants, restyling the label per state", () => {
        const look = (id: string, color: ReturnType<typeof solid>, labelColor: ReturnType<typeof solid>) =>
            node({ id, name: id, kind: "frame", figmaType: "COMPONENT", fills: [color], children: [text(`${id}-t`, "Button", labelColor)] });
        const instance = node({
            id: "i",
            name: "Menu button",
            kind: "frame",
            figmaType: "INSTANCE",
            transform: T(10, 10),
            fills: [solid(0, 0, 0)],
            children: [text("i-t", "读取进度", solid(1, 1, 1), 60, 20)],
            variantValue: "Default",
            variants: [
                { value: "Hover", node: look("hover", solid(0.2, 0.2, 0.2), solid(1, 0.8, 0)) },
                { value: "Disabled", node: look("disabled", solid(0.5, 0.5, 0.5), solid(0.6, 0.6, 0.6)) },
                { value: "Selected", node: look("selected", solid(1, 0, 0), solid(1, 1, 1)) },
            ],
        });
        const result = convertFigmaFrames(page([instance]), { targetSize: { width: 800, height: 600 } });
        const button = byName(result.document.elements, "Menu button");
        expect(button.type).toBe("nl.button");
        expect(button.props).toMatchObject({ label: "读取进度", backgroundColor: "#000000" });
        expect(rows(button, "backgroundColor").map(row => row.conditions)).toEqual([null, { hovered: true }, { disabled: true }]);
        expect(rows(button, "color")).toEqual([
            { conditions: null, value: "#FFFFFF" },
            { conditions: { hovered: true }, value: "#FFCC00" },
            { conditions: { disabled: true }, value: "#999999" },
        ]);
    });

    it("leaves a group of states with other layers in it as it is, and says so", () => {
        const group = node({
            id: "g",
            name: "Fancy",
            kind: "group",
            figmaType: "GROUP",
            children: [
                node({ id: "n", name: "normal", kind: "shape" }),
                node({ id: "h", name: "hover", kind: "shape" }),
                node({ id: "x", name: "Sparkle", kind: "shape" }),
            ],
        });
        const result = convertFigmaFrames(page([group]), { targetSize: { width: 800, height: 600 } });
        expect(byName(result.document.elements, "Fancy").type).toBe("nl.container");
        expect(result.notes.find(note => note.code === "buttonNotRecognized")?.examples).toEqual(["Fancy"]);
        expect(result.buttons).toBe(0);
    });

    it("needs a default look and one other before it makes a button", () => {
        const group = node({
            id: "g",
            name: "Only hover",
            kind: "group",
            figmaType: "GROUP",
            children: [node({ id: "h", name: "hover", kind: "shape" }), node({ id: "p", name: "pressed", kind: "shape" })],
        });
        const result = convertFigmaFrames(page([group]), { targetSize: { width: 800, height: 600 } });
        expect(byName(result.document.elements, "Only hover").type).toBe("nl.container");
        expect(result.notes.find(note => note.code === "buttonNotRecognized")).toBeUndefined();
    });
});

describe("buttons from a PSD", () => {
    const layer = (path: string[], bounds: [number, number, number, number], extra: Partial<PsdLayerNode> = {}): PsdLayerNode => ({
        path,
        name: path[path.length - 1],
        blendMode: "normal",
        opacity: 1,
        hidden: false,
        clipping: false,
        bounds: { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] },
        ...extra,
    });
    const document: PsdDocument = {
        width: 800,
        height: 600,
        fileName: "menu.psd",
        layers: [
            {
                ...layer(["Start"], [0, 0, 0, 0]),
                bounds: undefined,
                children: [
                    layer(["Start", "normal"], [100, 100, 300, 150]),
                    layer(["Start", "hover"], [96, 96, 304, 154], { hidden: true }),
                    layer(["Start", "pressed"], [100, 102, 300, 152], { hidden: true }),
                    layer(["Start", "Label"], [140, 110, 260, 140]),
                ],
            },
        ],
    };

    it("bakes every state, hidden ones included, with the shared label on top and one rectangle for all", () => {
        const plan = planPsdDesign(document);
        expect(plan.skippedHidden).toBe(0);
        const targets = Object.fromEntries(plan.targets.map(target => [target.path.join("/"), target]));
        expect(Object.keys(targets).sort()).toEqual(["Start/hover", "Start/normal", "Start/pressed"]);
        expect(targets["Start/hover"].mergeFrom).toEqual([{ path: ["Start", "Label"] }]);
        const rect = { left: 96, top: 96, width: 208, height: 58 };
        for (const target of plan.targets) {
            expect(plan.crops[psdLayerKey(target)]).toEqual(rect);
        }

        const pictures = new Map<string, PsdBakedPicture>(
            plan.targets.map(target => [psdLayerKey(target), { ...rect, bytes: new Uint8Array([1]) }]),
        );
        const result = convertFigmaFrames(buildPsdDesignFile(document, plan, pictures), { targetSize: { width: 800, height: 600 } });
        const button = byName(result.document.elements, "Start");
        expect(button.type).toBe("nl.button");
        expect(button.layout).toMatchObject({ x: 96, y: 96, width: 208, height: 58 });
        const fills = rows(button, "imageFill");
        expect(fills.map(row => row.conditions)).toEqual([null, { hovered: true }, { active: true }]);
        expect(new Set(fills.map(row => (row.value as { assetId: string }).assetId)).size).toBe(3);
    });
});

describe("buttons from image files", () => {
    const picture = (name: string, state: "default" | "hover" | "pressed" | null, key = "start"): DesignPicture => ({
        name,
        mime: "image/png",
        bytes: new Uint8Array([1]),
        width: 200,
        height: 60,
        coverage: 0.05,
        left: 860,
        top: 700,
        sourceWidth: 1920,
        sourceHeight: 1080,
        ...(state ? { button: { key, state } } : {}),
    });

    it("puts the states of one button where they were drawn and makes them one button", () => {
        const background: DesignPicture = { ...picture("background", null), width: 1920, height: 1080, left: 0, top: 0, coverage: 1 };
        const file = buildImageDesignFile(
            [picture("start_hover", "hover"), background, picture("start", "default"), picture("start_pressed", "pressed")],
            "Title",
        );
        const result = convertFigmaFrames(file, { targetSize: { width: 1920, height: 1080 } });
        const button = byName(result.document.elements, "start");
        expect(button.type).toBe("nl.button");
        expect(button.layout).toMatchObject({ x: 860, y: 700, width: 200, height: 60 });
        expect(rows(button, "imageFill").map(row => row.conditions)).toEqual([null, { hovered: true }, { active: true }]);
        expect(result.buttons).toBe(1);
        // Canvas-size files line up; nothing was centred.
        expect(result.notes.find(note => note.code === "imageCentered")).toBeUndefined();
    });

    it("keeps a lone state file a plain picture", () => {
        const file = buildImageDesignFile([picture("start_hover", "hover")], "Title");
        const result = convertFigmaFrames(file, { targetSize: { width: 1920, height: 1080 } });
        expect(byName(result.document.elements, "start_hover").type).toBe("nl.image");
        expect(result.buttons).toBe(0);
    });
});

describe("the canvas for image files", () => {
    it("keeps a lone cut-out at its own size in the middle of a project-size page", () => {
        const icon: DesignPicture = { name: "panel", mime: "image/png", bytes: new Uint8Array([1]), width: 96, height: 96, coverage: 0.9 };
        const file = buildImageDesignFile([icon], "Panels", { width: 1920, height: 1080 });
        expect(file.frames[0]).toMatchObject({ width: 1920, height: 1080 });
        const result = convertFigmaFrames(file, { targetSize: { width: 1920, height: 1080 } });
        expect(byName(result.document.elements, "panel").layout).toMatchObject({ x: 912, y: 492, width: 96, height: 96 });
    });

    it("scales a screen drawn at another resolution to fill the page", () => {
        const screen: DesignPicture = { name: "mockup", mime: "image/png", bytes: new Uint8Array([1]), width: 1280, height: 720, coverage: 1 };
        const file = buildImageDesignFile([screen], "Screens", { width: 1920, height: 1080 });
        const result = convertFigmaFrames(file, { targetSize: { width: 1920, height: 1080 } });
        expect(byName(result.document.elements, "mockup").layout).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
    });
});
