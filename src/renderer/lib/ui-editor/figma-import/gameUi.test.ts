import { describe, expect, it } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIElement, UIStageSurface } from "@shared/types/ui-editor/document";
import type { Blueprint } from "@shared/types/blueprint/document";
import { assertValidBlueprintDocument } from "@/lib/workspace/services/ui-editor/blueprint/documentValidation";
import { convertFigmaFrames, detectFrameTarget, gameUiPartsOf } from "./convertFigmaFrames";
import { FIGMA_EXPORT_FORMAT, type FigmaExportFile, type FigmaExportNode, type FigmaMatrix } from "./figmaExportFormat";
import { dialogPartOfName, gameUiSlotOfName, quickMenuActionOfName, quickMenuPageOfName } from "./gameUiRoles";
import { checkFrame } from "./gameUiChecklist";

const T = (x: number, y: number): FigmaMatrix => [[1, 0, x], [0, 1, y]];
const solid = (r: number, g: number, b: number) => ({ type: "SOLID" as const, color: { r, g, b, a: 1 }, opacity: 1 });

let counter = 0;
function node(partial: Partial<FigmaExportNode> & Pick<FigmaExportNode, "name" | "kind">): FigmaExportNode {
    counter += 1;
    return {
        id: `n${counter}`,
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

function text(name: string, characters: string, x: number, y: number, width = 300, height = 40): FigmaExportNode {
    return node({
        name,
        kind: "text",
        figmaType: "TEXT",
        width,
        height,
        transform: T(x, y),
        fills: [solid(1, 1, 1)],
        text: {
            characters,
            fontFamily: "",
            fontStyle: "Regular",
            fontWeight: 400,
            fontSize: 24,
            lineHeight: { unit: "AUTO", value: 0 },
            letterSpacing: { unit: "PIXELS", value: 0 },
            align: "LEFT",
            verticalAlign: "TOP",
            autoResize: "NONE",
            textCase: "ORIGINAL",
            mixed: false,
        },
    });
}

const rect = (name: string, x: number, y: number, width: number, height: number, color = solid(0.1, 0.1, 0.2)) =>
    node({ name, kind: "shape", transform: T(x, y), width, height, fills: [color] });

const raster = (name: string, x: number, y: number, width: number, height: number, imageRef: string) =>
    node({ name, kind: "raster", figmaType: "IMAGE", transform: T(x, y), width, height, raster: { imageRef, reason: "layer" } });

const group = (name: string, x: number, y: number, width: number, height: number, children: FigmaExportNode[]) =>
    node({ name, kind: "group", figmaType: "GROUP", transform: T(x, y), width, height, children });

function file(frame: FigmaExportNode, images: string[] = []): FigmaExportFile {
    return {
        format: FIGMA_EXPORT_FORMAT,
        version: 1,
        source: { fileName: "Game screen", pageName: "" },
        frames: [frame],
        images: Object.fromEntries(images.map(key => [key, { mime: "image/png", data: "AA==" }])),
    };
}

const frameOf = (name: string, children: FigmaExportNode[]) =>
    node({ name, kind: "frame", figmaType: "FRAME", width: 1920, height: 1080, fills: [solid(0, 0, 0)], children });

/** A mock of the running game: background, sprite, dialogue band with a quick menu on it, choices. */
function gameScreen(): FigmaExportNode {
    return frameOf("Game screen", [
        raster("Background", 0, 0, 1920, 1080, "bg"),
        raster("Sprite", 700, 100, 500, 900, "sprite"),
        group("对话框", 0, 760, 1920, 320, [
            rect("Band", 0, 760, 1920, 320),
            group("名字框", 300, 780, 320, 50, [rect("Plate", 300, 780, 320, 50), text("名字", "Narra", 320, 785, 280, 40)]),
            text("台词", "This is a sample line of dialogue.", 300, 850, 1300, 160),
            rect("头像", 80, 800, 200, 200),
            group("快捷菜单", 1300, 1030, 400, 40, [
                group("Auto", 1300, 1030, 96, 40, [
                    raster("normal", 1300, 1030, 96, 40, "auto-normal"),
                    raster("hover", 1300, 1030, 96, 40, "auto-hover"),
                    raster("on", 1300, 1030, 96, 40, "auto-on"),
                ]),
                text("Save", "Save", 1410, 1030, 80, 40),
                text("Config", "Config", 1500, 1030, 80, 40),
            ]),
        ]),
        group("选项", 560, 300, 800, 300, [
            rect("Shade", 560, 300, 800, 300),
            group("Option A", 600, 320, 720, 70, [rect("Plate", 600, 320, 720, 70), text("Text", "Go to the library", 620, 335, 680, 40)]),
            group("Option B", 600, 410, 720, 70, [rect("Plate", 600, 410, 720, 70), text("Text", "Stay in the room", 620, 425, 680, 40)]),
        ]),
    ]);
}

const IMAGES = ["bg", "sprite", "auto-normal", "auto-hover", "auto-on"];

function convert(frame: FigmaExportNode, pageTargets = {}) {
    return convertFigmaFrames(file(frame, IMAGES), { targetSize: { width: 1920, height: 1080 }, pageTargets });
}

function elementsOf(result: ReturnType<typeof convert>, surface: UIStageSurface): UIElement[] {
    const out: UIElement[] = [];
    const walk = (id: string) => {
        const element = result.document.elements[id];
        out.push(element);
        element.childrenIds.forEach(walk);
    };
    walk(surface.rootElementId);
    return out;
}

function stage(result: ReturnType<typeof convert>, slot: string): UIStageSurface {
    const found = result.document.surfaces.find(surface => surface.kind === "stageSurface" && surface.mount.slotId === slot);
    if (!found) throw new Error(`no ${slot} surface`);
    return found as UIStageSurface;
}

const named = (elements: UIElement[], name: string): UIElement => {
    const found = elements.find(element => element.name === name);
    if (!found) throw new Error(`no element named ${name}`);
    return found;
};

const blueprintsOf = (result: ReturnType<typeof convert>): Blueprint[] => Object.values(result.blueprints?.blueprints ?? {});

const nodesOf = (blueprint: Blueprint, eventId: string) => Object.values(blueprint.graphs.events[eventId]?.graph?.nodes ?? {});

describe("game UI roles", () => {
    it("reads slots off names in three languages, never off the end of a longer name", () => {
        expect(gameUiSlotOfName("对话框")).toBe("dialog");
        expect(gameUiSlotOfName("Dialogue box")).toBe("dialog");
        expect(gameUiSlotOfName("メッセージウィンドウ")).toBe("dialog");
        expect(gameUiSlotOfName("Quick menu")).toBe("onStage");
        expect(gameUiSlotOfName("选项")).toBe("choice");
        expect(gameUiSlotOfName("通知")).toBe("notification");
        expect(gameUiSlotOfName("设置选项")).toBeNull();
        expect(gameUiSlotOfName("Background")).toBeNull();
    });

    it("reads dialogue parts and quick menu jobs", () => {
        expect(dialogPartOfName("台词")).toBe("sentence");
        expect(dialogPartOfName("Speaker name")).toBe("name");
        expect(dialogPartOfName("角色名字")).toBe("name");
        expect(dialogPartOfName("Avatar")).toBe("avatar");
        expect(quickMenuActionOfName("btn_auto")).toBe("auto");
        expect(quickMenuActionOfName("快进")).toBe("skip");
        expect(quickMenuActionOfName("履歴")).toBe("log");
        expect(quickMenuPageOfName("Settings")).toBe("config");
        expect(quickMenuPageOfName("加载")).toBe("load");
        expect(quickMenuPageOfName("记录")).toBe("log");
        expect(quickMenuPageOfName("Auto")).toBeNull();
    });
});

describe("game-screen frames", () => {
    it("finds the parts, the quick menu drawn on the band included, and guesses Game UI for such a frame", () => {
        const frame = gameScreen();
        expect(gameUiPartsOf(frame).map(part => part.slot)).toEqual(["dialog", "onStage", "choice"]);
        expect(detectFrameTarget(frame)).toBe("gameUi");
        expect(detectFrameTarget(frameOf("Title", [rect("Panel", 0, 0, 100, 100)]))).toBe("page");
    });

    it("makes one Game UI per slot and leaves the background and sprites out", () => {
        const result = convert(gameScreen(), { save: "page-save" });
        expect(result.document.surfaces.map(surface => surface.kind)).toEqual(["stageSurface", "stageSurface", "stageSurface"]);
        expect(result.gameUi.map(entry => entry.slot)).toEqual(["dialog", "onStage", "choice"]);
        expect(result.imageRefs).not.toContain("bg");
        expect(result.imageRefs).not.toContain("sprite");
        const skipped = result.notes.find(note => note.code === "gameUiArtSkipped");
        expect(skipped?.examples).toEqual(["Background", "Sprite"]);
        expect(() => assertValidBlueprintDocument(result.blueprints!)).not.toThrow();
    });

    it("wires the dialogue box: the line, the name and its plate, the avatar, and the box's own replies", () => {
        const result = convert(gameScreen());
        const dialog = stage(result, "dialog");
        const elements = elementsOf(result, dialog);
        expect(elements.some(element => element.name === "快捷菜单")).toBe(false);

        const box = named(elements, "对话框");
        expect(box.layout).toMatchObject({ x: 0, y: 760, width: 1920, height: 320 });
        const line = named(elements, "台词");
        expect(line.type).toBe("nl.dialog.sentence");
        expect(line.props?.text).toBe("This is a sample line of dialogue.");
        expect(line.layout).toMatchObject({ x: 300, y: 90 });

        const name = named(elements, "名字");
        const binding = name.valueBindings?.text as { kind: string; blueprintId: string };
        expect(binding.kind).toBe("blueprintValue");
        const blueprints = blueprintsOf(result);
        const nametag = result.blueprints!.blueprints[binding.blueprintId];
        expect(nametag.owner).toEqual({ kind: "widgetValue", surfaceId: dialog.id, elementId: name.id, propPath: "text" });

        const plate = blueprints.find(entry => entry.name === "Name plate")!;
        expect(plate.owner).toEqual({ kind: "widgetMain", surfaceId: dialog.id, elementId: box.id });
        const refs = nodesOf(plate, "namePlate").filter(entry => entry.type === "blueprint.element.ref");
        expect(refs.map(entry => entry.params?.elementId)).toEqual([named(elements, "名字框").id, named(elements, "名字框").id]);

        const avatar = named(elements, "头像");
        expect(avatar.type).toBe("nl.image");
        expect(blueprints.some(entry => entry.name === "Avatar" && entry.owner.kind === "widgetMain" && entry.owner.elementId === avatar.id)).toBe(true);

        const surfaceMain = blueprints.find(entry => entry.owner.kind === "surfaceMain" && entry.owner.surfaceId === dialog.id)!;
        expect(surfaceMain.graphs.eventIds).toEqual(["advance", "hide"]);
        expect(dialog.actions).toEqual([{ actionId: "advance" }, { actionId: "hide" }]);
        expect(Object.keys(result.document.actions ?? {})).toEqual(["advance", "hide"]);
        expect(result.gameUi.find(entry => entry.slot === "dialog")?.wired).toBe(3);
    });

    it("opens the Log from the box when the project has a Log page", () => {
        const result = convert(gameScreen(), { log: "page-log" });
        const dialog = stage(result, "dialog");
        expect(dialog.actions?.map(entry => entry.actionId)).toEqual(["advance", "hide", "backlog"]);
        const surfaceMain = blueprintsOf(result).find(entry => entry.owner.kind === "surfaceMain" && entry.owner.surfaceId === dialog.id)!;
        const open = nodesOf(surfaceMain, "backlog").find(entry => entry.type === "blueprint.page.go");
        expect(open?.params).toEqual({ surfaceId: "page-log" });
    });

    it("wires the quick menu by name and lights Auto with its on look", () => {
        const result = convert(gameScreen(), { save: "page-save" });
        const menu = stage(result, "onStage");
        const elements = elementsOf(result, menu);
        const auto = named(elements, "Auto");
        expect(auto.type).toBe("nl.button");
        const variants = (auto.props?.appearance as AppearanceModel).variants.map(variant => variant.id);
        expect(variants).toContain("selected");

        const blueprints = blueprintsOf(result);
        const toggle = blueprints.find(entry => entry.name === "Auto")!;
        const types = nodesOf(toggle, "auto").map(entry => entry.type);
        expect(types).toContain("blueprint.game.setAutoForward");
        expect(types).toContain("blueprint.element.displayable.setVariant");
        expect(blueprints.some(entry => entry.owner.kind === "surfaceMain" && entry.owner.surfaceId === menu.id)).toBe(true);

        const save = blueprints.find(entry => entry.name === "Save")!;
        expect(save.owner).toMatchObject({ kind: "widgetMain", elementId: named(elements, "Save").id });
        expect(nodesOf(save, "open").find(entry => entry.type === "blueprint.page.go")?.params)
            .toEqual({ surfaceId: "page-save" });
        const missing = result.notes.find(note => note.code === "quickMenuPageMissing");
        expect(missing?.examples).toEqual(["Config"]);
    });

    it("turns the drawn options into a choice list whose row is the first option", () => {
        const result = convert(gameScreen());
        const choice = stage(result, "choice");
        const elements = elementsOf(result, choice);
        const list = elements.find(element => element.type === "nl.choice.list")!;
        expect(list.layout).toMatchObject({ x: 40, y: 20, width: 720 });
        const props = list.props as { itemGap: number; items: { text: string }[]; itemStructId: string };
        expect(props.itemGap).toBe(20);
        expect(props.items.map(item => item.text)).toEqual(["Go to the library", "Stay in the room"]);
        expect(props.itemStructId).toBe("nl.choiceItem");
        expect(list.childrenIds).toHaveLength(1);
        const row = result.document.elements[list.childrenIds[0]];
        expect(row.extra).toMatchObject({ listSlot: "itemTemplate" });
        expect(row.layout).toMatchObject({ x: 0, y: 0, width: 720, height: 70 });
        const words = elements.find(element => element.valueBindings?.text)!;
        expect(words.valueBindings?.text).toEqual({ kind: "listItemField", fieldId: "text" });
        expect(elements.some(element => element.name === "Option B")).toBe(false);
        expect(named(elements, "Shade").type).toBe("nl.container");
        expect(blueprintsOf(result).some(entry => entry.name === "Choice list" && entry.owner.kind === "widgetMain" && entry.owner.elementId === list.id)).toBe(true);
    });

    it("takes a frame named for a slot as that slot, without the frame's own fill", () => {
        const result = convert(frameOf("对话框", [rect("Band", 0, 760, 1920, 320), text("Line", "Hello.", 300, 850, 1300, 160)]));
        const dialog = stage(result, "dialog");
        const root = result.document.elements[dialog.rootElementId];
        expect(root.childrenIds.map(id => result.document.elements[id].name)).toEqual(["Band", "Line"]);
        expect(named(elementsOf(result, dialog), "Line").type).toBe("nl.dialog.sentence");
    });

    it("guesses the line and the name when neither is named, and says so", () => {
        const frame = frameOf("Screen", [
            group("Dialogue", 0, 760, 1920, 320, [
                rect("Band", 0, 760, 1920, 320),
                text("Narra", "Narra", 300, 780, 200, 40),
                text("This is a sample line.", "This is a sample line.", 300, 840, 1300, 160),
            ]),
        ]);
        const result = convert(frame);
        const elements = elementsOf(result, stage(result, "dialog"));
        expect(named(elements, "This is a sample line.").type).toBe("nl.dialog.sentence");
        expect((named(elements, "Narra").valueBindings?.text as { kind: string }).kind).toBe("blueprintValue");
        expect(result.notes.map(note => note.code)).toEqual(expect.arrayContaining(["dialogLineGuessed", "dialogNameGuessed"]));
        // The name sits straight in the box: there is no plate of its own to hide.
        expect(blueprintsOf(result).some(entry => entry.name === "Name plate")).toBe(false);
    });

    it("keeps the second group of a slot out and reports it", () => {
        const frame = frameOf("Screen", [
            group("选项", 0, 0, 400, 200, [text("A", "A", 0, 0)]),
            group("Choices", 0, 300, 400, 200, [text("B", "B", 0, 300)]),
        ]);
        const result = convert(frame);
        expect(result.gameUi).toHaveLength(1);
        expect(result.notes.find(note => note.code === "gameUiSlotTwice")?.examples).toEqual(["Choices"]);
    });

    it("imports a game-screen frame as a page when the author says so", () => {
        const frame = gameScreen();
        const asPage = convertFigmaFrames(file(frame, IMAGES), { targetSize: { width: 1920, height: 1080 }, frameTargets: { [frame.id]: "page" } });
        expect(asPage.document.surfaces.map(surface => surface.kind)).toEqual(["appSurface"]);
        expect(asPage.blueprints).toBeNull();
        expect(asPage.imageRefs).toContain("bg");
    });

    it("follows the plugin's marks over names, on layers Figma named", () => {
        const plate = group("Frame 3", 300, 780, 320, 50, [text("Narra", "Narra", 320, 785, 280, 40)]);
        const line = text("Name your cat", "Name your cat", 300, 850, 900, 60);
        const caption = text("Caption", "A long caption drawn larger than the line", 300, 950, 1300, 120);
        const auto = text("Text 4", "A", 1300, 1030, 60, 40);
        const frame = frameOf("Mock", [
            raster("Background", 0, 0, 1920, 1080, "bg"),
            { ...group("Bottom panel", 0, 760, 1920, 320, [plate, line, caption, { ...auto, role: "auto" }]), role: "dialog" },
        ]);
        (frame.children![1].children![1] as FigmaExportNode).role = "sentence";
        (frame.children![1].children![0].children![0] as FigmaExportNode).role = "name";
        const quick = group("Group 9", 1300, 1030, 200, 40, [{ ...auto, id: "auto-2", role: "auto" }]);
        quick.role = "onStage";
        frame.children!.push(quick);

        expect(gameUiPartsOf(frame).map(part => part.slot)).toEqual(["dialog", "onStage"]);
        const result = convert(frame);
        const elements = elementsOf(result, stage(result, "dialog"));
        // Marked as the line although smaller than the caption and named after words that read "name".
        expect(named(elements, "Name your cat").type).toBe("nl.dialog.sentence");
        expect((named(elements, "Narra").valueBindings?.text as { kind: string }).kind).toBe("blueprintValue");
        expect(result.notes.map(note => note.code)).not.toContain("dialogLineGuessed");
        expect(result.notes.map(note => note.code)).not.toContain("dialogNameGuessed");
        const toggles = blueprintsOf(result).filter(entry => entry.name === "Auto");
        expect(toggles).toHaveLength(1);
    });

    it("lists for the plugin what the import does with each part", () => {
        const frame = gameScreen();
        frame.children![2].children![2] = { ...frame.children![2].children![2], role: "sentence" };
        const checklist = checkFrame(frame);
        expect(checklist.leftOut.map(layer => layer.name)).toEqual(["Background", "Sprite"]);
        expect(checklist.parts.map(part => [part.slot, part.marked, part.duplicate])).toEqual([
            ["dialog", false, false],
            ["onStage", false, false],
            ["choice", false, false],
        ]);
        const [dialog, quick, choice] = checklist.parts;
        expect(dialog.entries.map(entry => [entry.kind, entry.status, "layer" in entry ? entry.layer?.name : null])).toEqual([
            ["sentence", "marked", "台词"],
            ["name", "named", "名字"],
            ["avatar", "named", "头像"],
        ]);
        expect(quick.entries).toEqual([
            expect.objectContaining({ kind: "button", action: "auto", lit: true }),
            expect.objectContaining({ kind: "button", action: "save", status: "named" }),
            expect.objectContaining({ kind: "button", action: "config" }),
        ]);
        expect(choice.entries).toEqual([{ kind: "rows", status: "named", count: 2, layer: { id: expect.any(String), name: "Option A" } }]);
    });

    it("tells the plugin what it had to guess and what is missing", () => {
        const frame = frameOf("Screen", [
            group("Dialog", 0, 760, 1920, 320, [
                text("Narra", "Narra", 300, 780, 200, 40),
                text("This is a sample line.", "This is a sample line.", 300, 840, 1300, 160),
                group("Face", 80, 800, 200, 200, [rect("Ring", 80, 800, 200, 200), text("Label", "Label", 80, 980, 200, 20)]),
            ]),
            group("Quick menu", 1300, 1030, 400, 40, [rect("Plate", 1300, 1030, 400, 40)]),
            group("Choices", 0, 0, 400, 200, [rect("Plate", 0, 0, 400, 200)]),
            group("选项", 0, 300, 400, 200, [text("B", "B", 0, 300)]),
        ]);
        const [dialog, quick, choice, second] = checkFrame(frame).parts;
        expect(dialog.entries).toEqual([
            { kind: "sentence", status: "guessed", layer: expect.objectContaining({ name: "This is a sample line." }) },
            { kind: "name", status: "guessed", layer: expect.objectContaining({ name: "Narra" }) },
            { kind: "avatar", status: "unusable", layer: expect.objectContaining({ name: "Face" }) },
        ]);
        expect(quick.entries).toEqual([{ kind: "noButtons", status: "missing" }]);
        expect(choice.entries).toEqual([{ kind: "rows", status: "missing", count: 0, layer: null }]);
        expect(second).toMatchObject({ slot: "choice", duplicate: true, entries: [] });
    });
});
