/**
 * Two writes to one widget, one after the other, and both are on screen afterwards.
 *
 * The shape of the defect: `Set Image Asset` then `Set Image Flip X` on one image, and the picture
 * went back to the one the author had picked; `Set Button Label` then `Set Button Pointer` on one
 * button, and the label went back to what the author typed. Each setter rebuilt the widget's props
 * from the authored record and wrote the whole bag back, so the second write carried the author's
 * value of everything the first had changed. Two nodes in a row, the second undoing the first, and
 * nothing reported.
 *
 * Every setter family the host API has is here, the ones that were broken and the ones that were
 * not, because the rule is the same for all of them: a write starts from what the drawing shows now.
 * Each is asserted on what the drawing paints - the authored record with the host's patches laid
 * over it the way a drawing lays them, then resolved through the same appearance resolver the
 * widget's renderer uses - and on what a graph reading the widget back is told.
 *
 * Comments in English per project convention.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_BUTTON_SET_POINTER,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_X,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
} from "@shared/types/blueprint/graph";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { buildUIListItemInstanceKey, type UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { buildUIWidgetAddress, readUIWidgetAddressElementId } from "@shared/types/ui-editor/widgetAddress";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import {
    resolveButtonVisualProps,
    resolveImageRectangleLike,
    resolveTextVisualProps,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { blueprintOf, createRowRuntime, graphOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import {
    createInitialButtonAppearance,
    createInitialImageAppearanceFromProps,
    createInitialTextAppearance,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { defaultButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";
import { defaultTextWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import { ScopeStoreBridge } from "./ScopeStoreBridge";
import {
    createDevModeBlueprintHostApi,
    mergeWidgetPatch,
    type DevModeWidgetRuntimePatch,
} from "./BlueprintHostApiBridge";

const PAGE = "page";
const AUTHORED_PICTURE = "authored-picture";

const PICTURE_STRUCT: UIStructDef = {
    id: "picture",
    fields: [
        { id: "f-name", key: "name", type: "string" },
        { id: "f-image", key: "image", type: "image" },
    ],
};

function imageProps(): Record<string, unknown> {
    const flat = { fillType: "image", imageFill: { mode: "cover" as const, assetId: AUTHORED_PICTURE } };
    return { ...flat, appearance: createInitialImageAppearanceFromProps(flat) };
}

function buttonProps(): Record<string, unknown> {
    return {
        ...defaultButtonWidgetProps,
        label: "Go",
        appearance: createInitialButtonAppearance(defaultButtonWidgetProps),
    };
}

/** A text as Studio makes one: its look held twice, as flat props and as the appearance's rows. */
function textProps(): Record<string, unknown> {
    const flat = { ...defaultTextWidgetProps, text: "Hello" };
    return { ...flat, appearance: createInitialTextAppearance(flat) };
}

type Spec = { type: string; parent: string | null; props?: Record<string, unknown>; template?: true };

function elementsOf(specs: Record<string, Spec>): Record<string, UIElement> {
    const out: Record<string, UIElement> = {};
    for (const [id, spec] of Object.entries(specs)) {
        out[id] = {
            id,
            type: spec.type,
            parentId: spec.parent,
            childrenIds: Object.entries(specs).filter(([, child]) => child.parent === id).map(([childId]) => childId),
            layout: { x: 0, y: 0, width: 40, height: 40 },
            ...(spec.props ? { props: spec.props } : {}),
            ...(spec.template ? { extra: { listSlot: "itemTemplate" } } : {}),
        };
    }
    return out;
}

/**
 * One of each widget a graph can write to, standing on the page, and a list whose rows each hold
 * an image and a button of their own.
 */
function createDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: PAGE, name: "Page", host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: "root" },
            { id: "page-b", name: "Page B", host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: "root-b" },
        ],
        structs: { [PICTURE_STRUCT.id]: PICTURE_STRUCT },
        elements: elementsOf({
            root: { type: "nl.root", parent: null },
            "root-b": { type: "nl.root", parent: null },
            picture: { type: "nl.image", parent: "root", props: imageProps() },
            go: { type: "nl.button", parent: "root", props: buttonProps() },
            caption: { type: "nl.text", parent: "root", props: textProps() },
            box: { type: "nl.container", parent: "root", props: { clipContent: false } },
            frame: {
                type: UI_FRAME_ELEMENT_TYPE,
                parent: "root",
                props: { targetSurfaceId: null, params: {}, navigationMode: "static" },
            },
            volume: { type: "nl.slider", parent: "root", props: { value: 20, min: 0, max: 100, step: 5 } },
            toggle: { type: "nl.switch", parent: "root", props: { checked: false } },
            name: { type: "nl.textInput", parent: "root", props: { value: "" } },
            grid: { type: "nl.list", parent: "root", props: { itemStructId: PICTURE_STRUCT.id } },
            tile: { type: "nl.container", parent: "grid", template: true },
            thumb: { type: "nl.image", parent: "tile", props: imageProps() },
            tag: { type: "nl.button", parent: "tile", props: buttonProps() },
        }),
    };
}

/**
 * A host API over one shared patch table, as a game builds it: every write is laid into the table
 * the drawings are painted from, by the one merge, and every read comes back out of it.
 */
function createPage(document = createDocument()) {
    const patches: Record<string, DevModeWidgetRuntimePatch> = {};
    const hostApi = createDevModeBlueprintHostApi({
        document,
        scope: new ScopeStoreBridge(),
        activeSurfaceId: PAGE,
        emit: () => undefined,
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: (address, patch) => {
            patches[address] = mergeWidgetPatch(patches[address], patch);
        },
        readWidgetPatches: () => patches,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
    });
    return { document, patches, hostApi };
}

/**
 * The element as the drawing at `address` paints it: the authored record with that drawing's patch
 * laid over it one key at a time, the way `SurfaceElementTree` lays it.
 */
function painted(page: ReturnType<typeof createPage>, address: string): UIElement {
    const record = page.document.elements[readUIWidgetAddressElementId(address)]!;
    const patch = page.patches[address];
    return patch?.props ? { ...record, props: { ...(record.props ?? {}), ...patch.props } } : record;
}

function appearanceOf(element: UIElement): AppearanceModel | undefined {
    return (element.props as { appearance?: AppearanceModel } | undefined)?.appearance;
}

/** The picture, fit, crop and flips an image's renderer would paint. */
function paintedImage(page: ReturnType<typeof createPage>, address: string) {
    const element = painted(page, address);
    const resolved = resolveImageRectangleLike(element, appearanceOf(element), {
        signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    });
    const props = element.props as { imageFlipX?: boolean; imageFlipY?: boolean };
    return {
        assetId: resolved.imageFill?.assetId ?? null,
        fitMode: resolved.imageFill?.mode ?? null,
        cropPlacement: resolved.imageFill?.cropPlacement ?? null,
        flipX: props.imageFlipX === true,
        flipY: props.imageFlipY === true,
    };
}

/** The label and resting pointer a button's renderer would paint. */
function paintedButton(page: ReturnType<typeof createPage>, address: string) {
    const element = painted(page, address);
    return {
        label: (element.props as { label?: string }).label,
        cursor: resolveButtonVisualProps(element, appearanceOf(element), {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        }).cursor,
    };
}

/** The words, colour and size a text's renderer would paint. */
function paintedText(page: ReturnType<typeof createPage>, address: string) {
    const element = painted(page, address);
    const resolved = resolveTextVisualProps(element, appearanceOf(element), {
        signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    });
    return { text: resolved.text, color: resolved.color, fontSize: resolved.fontSize };
}

const CROP = { leftPct: 10, topPct: 20, widthPct: 50, heightPct: 60 };

describe("a second write to an image keeps the first", () => {
    type Api = ReturnType<typeof createPage>["hostApi"];
    const steps: Record<string, (api: Api, address: string) => Promise<void>> = {
        "Set Image Asset": (api, address) =>
            api.widget.setImageProperties(address, { asset: { kind: "imageAsset", assetId: "picked" } }),
        "Set Image Flip X": (api, address) => api.widget.setImageProperties(address, { flipX: true }),
        "Set Image Flip Y": (api, address) => api.widget.setImageProperties(address, { flipY: true }),
        "Set Image Fit Mode": (api, address) => api.widget.setImageProperties(address, { fitMode: "contain" }),
        "Set Image Crop Rect": (api, address) =>
            api.widget.setImageProperties(address, { fitMode: "crop", cropRect: CROP }),
    };

    it.each([
        ["Set Image Asset", "Set Image Flip X"],
        ["Set Image Flip X", "Set Image Asset"],
        ["Set Image Asset", "Set Image Flip Y"],
        ["Set Image Asset", "Set Image Fit Mode"],
        ["Set Image Fit Mode", "Set Image Asset"],
        ["Set Image Asset", "Set Image Crop Rect"],
        ["Set Image Crop Rect", "Set Image Asset"],
    ])("%s then %s", async (first, second) => {
        const page = createPage();
        await steps[first]!(page.hostApi, "picture");
        await steps[second]!(page.hostApi, "picture");

        const expected = {
            assetId: "picked",
            ...(first === "Set Image Flip X" || second === "Set Image Flip X" ? { flipX: true } : {}),
            ...(second === "Set Image Flip Y" ? { flipY: true } : {}),
            ...(first === "Set Image Fit Mode" || second === "Set Image Fit Mode" ? { fitMode: "contain" } : {}),
            ...(first === "Set Image Crop Rect" || second === "Set Image Crop Rect"
                ? { fitMode: "crop", cropPlacement: CROP }
                : {}),
        };
        expect(paintedImage(page, "picture")).toMatchObject(expected);
        const read = page.hostApi.widget.getImageProperties("picture");
        expect(read.assetId).toBe("picked");
        expect(read.flipX).toBe(expected.flipX ?? false);
    });

    it("keeps every field of the fill through a run of writes to one field at a time", async () => {
        // The fill is one group of fields written whole: each write builds it from the fill the
        // drawing shows, so what one write set is still there when the next writes a neighbour.
        const page = createPage();
        await steps["Set Image Crop Rect"]!(page.hostApi, "picture");
        await steps["Set Image Asset"]!(page.hostApi, "picture");
        await steps["Set Image Flip X"]!(page.hostApi, "picture");
        await steps["Set Image Flip Y"]!(page.hostApi, "picture");

        expect(paintedImage(page, "picture")).toEqual({
            assetId: "picked",
            fitMode: "crop",
            cropPlacement: CROP,
            flipX: true,
            flipY: true,
        });
    });

    it("clears the picture a first write set when a second clears it", async () => {
        const page = createPage();
        await steps["Set Image Asset"]!(page.hostApi, "picture");
        await steps["Set Image Flip X"]!(page.hostApi, "picture");
        await page.hostApi.widget.setImageProperties("picture", { asset: null });

        expect(paintedImage(page, "picture")).toMatchObject({ assetId: null, flipX: true });
    });
});

describe("a second write to a button keeps the first", () => {
    it("Set Button Label then Set Button Pointer", async () => {
        const page = createPage();
        await page.hostApi.widget.setButtonProperties("go", { label: "Picked" });
        await page.hostApi.widget.setButtonProperties("go", { cursor: "crosshair" });

        expect(paintedButton(page, "go")).toEqual({ label: "Picked", cursor: "crosshair" });
        expect(page.hostApi.widget.getButtonProperties("go")).toEqual({ label: "Picked", cursor: "crosshair" });
    });

    it("Set Button Pointer then Set Button Label", async () => {
        const page = createPage();
        await page.hostApi.widget.setButtonProperties("go", { cursor: "crosshair" });
        await page.hostApi.widget.setButtonProperties("go", { label: "Picked" });

        expect(paintedButton(page, "go")).toEqual({ label: "Picked", cursor: "crosshair" });
    });

    it("a second pointer write replaces the first and keeps the label", async () => {
        const page = createPage();
        await page.hostApi.widget.setButtonProperties("go", { cursor: "crosshair" });
        await page.hostApi.widget.setButtonProperties("go", { label: "Picked" });
        await page.hostApi.widget.setButtonProperties("go", { cursor: "help" });

        expect(paintedButton(page, "go")).toEqual({ label: "Picked", cursor: "help" });
    });
});

describe("the other setter families keep a first write through a second", () => {
    it("text: Set Text, then Set Text Color, then Set Font Size", async () => {
        const page = createPage();
        await page.hostApi.widget.setTextProperties("caption", { text: "Changed" });
        await page.hostApi.widget.setTextProperties("caption", { color: "#ff0000" });
        await page.hostApi.widget.setTextProperties("caption", { fontSize: 40 });

        expect(page.hostApi.widget.getTextProperties("caption")).toMatchObject({
            text: "Changed",
            color: "#ff0000",
            fontSize: 40,
        });
        // On screen, not only in what a graph reads back: a text is painted from its appearance's
        // rows, and a colour that reached only the flat props was a colour nobody saw.
        expect(paintedText(page, "caption")).toEqual({ text: "Changed", color: "#ff0000", fontSize: 40 });
    });

    it("text: Set Font Size, then Set Text Color, keeps the size", async () => {
        const page = createPage();
        await page.hostApi.widget.setTextProperties("caption", { fontSize: 40 });
        await page.hostApi.widget.setTextProperties("caption", { color: "#ff0000" });

        expect(paintedText(page, "caption")).toEqual({ text: "Hello", color: "#ff0000", fontSize: 40 });
    });

    it("text: a changed colour leaves a hovered row the author wrote alone", async () => {
        const document = createDocument();
        const caption = document.elements.caption!;
        const appearance = (caption.props as { appearance: AppearanceModel }).appearance;
        const hovered = {
            ...appearance,
            variants: appearance.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.map(group =>
                    group.key === "color"
                        ? { ...group, rows: [...group.rows, { conditions: { hovered: true }, value: "#00ff00" }] }
                        : group,
                ),
            })),
        } as AppearanceModel;
        document.elements.caption = { ...caption, props: { ...caption.props, appearance: hovered } };
        const page = createPage(document);

        await page.hostApi.widget.setTextProperties("caption", { color: "#ff0000" });

        const element = painted(page, "caption");
        expect(resolveTextVisualProps(element, appearanceOf(element), {
            signals: { ...DEFAULT_SYSTEM_INTERACTION_SIGNALS, hovered: true },
        }).color).toBe("#00ff00");
        expect(paintedText(page, "caption").color).toBe("#ff0000");
    });

    it("container: Set Clip Content, then a move and a hide of the same drawing", async () => {
        const page = createPage();
        await page.hostApi.widget.setContainerProperties("box", { clipContent: true });
        await page.hostApi.widget.setDisplayableProperties("box", { x: 30 });
        await page.hostApi.widget.setVisible("box", false);

        expect(page.hostApi.widget.getContainerProperties("box").clipContent).toBe(true);
        expect(painted(page, "box").props).toMatchObject({ clipContent: true });
        expect(page.hostApi.widget.getDisplayableProperties("box")).toMatchObject({ position: { x: 30 }, visible: false });
    });

    it("frame: Set Frame Page then Set Params, and the other way round", async () => {
        const page = createPage();
        await page.hostApi.widget.setFrameProperties("frame", { targetSurfaceId: "page-b" });
        await page.hostApi.widget.setFrameProperties("frame", { params: { chapter: 2 } });
        expect(page.hostApi.widget.getFrameProperties("frame")).toEqual({ targetSurfaceId: "page-b", params: { chapter: 2 } });
        expect(painted(page, "frame").props).toMatchObject({ targetSurfaceId: "page-b", params: { chapter: 2 } });

        const other = createPage();
        await other.hostApi.widget.setFrameProperties("frame", { params: { chapter: 3 } });
        await other.hostApi.widget.setFrameProperties("frame", { targetSurfaceId: "page-b" });
        expect(other.hostApi.widget.getFrameProperties("frame")).toEqual({ targetSurfaceId: "page-b", params: { chapter: 3 } });
    });

    it("slider: a value, then a range", async () => {
        const page = createPage();
        await page.hostApi.widget.setSliderProperties("volume", { value: 40 });
        await page.hostApi.widget.setSliderProperties("volume", { max: 50 });

        expect(page.hostApi.widget.getSliderProperties("volume")).toMatchObject({ value: 40, max: 50 });
    });

    it("switch and text input: a value, then a write to the same drawing's visibility", async () => {
        const page = createPage();
        await page.hostApi.widget.setSwitchProperties("toggle", { checked: true });
        await page.hostApi.widget.setEnabled("toggle", false);
        await page.hostApi.widget.setTextInputProperties("name", { value: "Aoi" });
        await page.hostApi.widget.setVisible("name", false);

        expect(page.hostApi.widget.getSwitchProperties("toggle").checked).toBe(true);
        expect(page.hostApi.widget.getCommonProperties("toggle").enabled).toBe(false);
        expect(page.hostApi.widget.getTextInputProperties("name").value).toBe("Aoi");
        expect(page.hostApi.widget.getCommonProperties("name").visible).toBe(false);
    });

    it("list: items, then a selection", async () => {
        const page = createPage();
        await page.hostApi.widget.setListItems("grid", [{ name: "a" }, { name: "b" }]);
        await page.hostApi.widget.setListSelectedIndex("grid", 1);

        expect(page.hostApi.widget.getListProperties("grid")).toMatchObject({
            items: [{ name: "a" }, { name: "b" }],
            selectedIndex: 1,
        });
    });

    it("displayable: a position, a size and an opacity, one at a time", async () => {
        const page = createPage();
        await page.hostApi.widget.setDisplayableProperties("picture", { x: 12 });
        await page.hostApi.widget.setDisplayableProperties("picture", { width: 90 });
        await page.hostApi.widget.setDisplayableProperties("picture", { opacity: 0.5 });
        await page.hostApi.widget.setDisplayableProperties("picture", { offsetX: 4 });
        await page.hostApi.widget.setDisplayableProperties("picture", { offsetY: 6 });

        expect(page.hostApi.widget.getDisplayableProperties("picture")).toMatchObject({
            position: { x: 12 },
            size: { width: 90 },
            opacity: 0.5,
            offset: { x: 4, y: 6 },
        });
    });

    it("writes of different families to one image all stay on it", async () => {
        const page = createPage();
        await page.hostApi.widget.setImageProperties("picture", { asset: { kind: "imageAsset", assetId: "picked" } });
        await page.hostApi.widget.setDisplayableProperties("picture", { x: 12 });
        await page.hostApi.widget.setVisible("picture", false);
        await page.hostApi.widget.setImageProperties("picture", { flipX: true });
        await page.hostApi.widget.setEnabled("picture", false);

        expect(paintedImage(page, "picture")).toMatchObject({ assetId: "picked", flipX: true });
        expect(page.hostApi.widget.getDisplayableProperties("picture")).toMatchObject({ position: { x: 12 }, visible: false });
        expect(page.hostApi.widget.getCommonProperties("picture").enabled).toBe(false);
    });
});

describe("a write inside a list row composes with that row's drawing only", () => {
    const rowA = buildUIListItemInstanceKey(undefined, "grid", "a");
    const rowB = buildUIListItemInstanceKey(undefined, "grid", "b");
    const thumbA = buildUIWidgetAddress("thumb", rowA);
    const thumbB = buildUIWidgetAddress("thumb", rowB);
    const tagA = buildUIWidgetAddress("tag", rowA);
    const tagB = buildUIWidgetAddress("tag", rowB);

    it("keeps each row's first write through its second, whatever the other row does in between", async () => {
        const page = createPage();
        await page.hostApi.widget.setImageProperties(thumbA, { asset: { kind: "imageAsset", assetId: "picked-a" } });
        await page.hostApi.widget.setButtonProperties(tagA, { label: "Picked A" });
        await page.hostApi.widget.setImageProperties(thumbB, { asset: { kind: "imageAsset", assetId: "picked-b" } });
        await page.hostApi.widget.setImageProperties(thumbA, { flipX: true });
        await page.hostApi.widget.setButtonProperties(tagA, { cursor: "crosshair" });

        expect(paintedImage(page, thumbA)).toMatchObject({ assetId: "picked-a", flipX: true });
        expect(paintedButton(page, tagA)).toEqual({ label: "Picked A", cursor: "crosshair" });
        expect(paintedImage(page, thumbB)).toMatchObject({ assetId: "picked-b", flipX: false });
        expect(paintedButton(page, tagB)).toEqual({ label: "Go", cursor: "auto" });
    });

    it("builds a row's write from that row, not from another row or the template", async () => {
        // Row A and the template itself both hold a picture a graph set; row B never had one. A flip
        // in row B starts from row B's drawing, which still shows the author's picture - taking
        // either of the others as the base would paint a picture row B was never given.
        const page = createPage();
        await page.hostApi.widget.setImageProperties(thumbA, { asset: { kind: "imageAsset", assetId: "picked-a" } });
        await page.hostApi.widget.setImageProperties("thumb", { asset: { kind: "imageAsset", assetId: "template" } });
        await page.hostApi.widget.setButtonProperties(tagA, { label: "Picked A" });
        await page.hostApi.widget.setImageProperties(thumbB, { flipX: true });
        await page.hostApi.widget.setButtonProperties(tagB, { cursor: "crosshair" });

        expect(paintedImage(page, thumbB)).toMatchObject({ assetId: AUTHORED_PICTURE, flipX: true });
        expect(paintedButton(page, tagB)).toEqual({ label: "Go", cursor: "crosshair" });
        expect(paintedImage(page, thumbA)).toMatchObject({ assetId: "picked-a", flipX: false });
        expect(paintedImage(page, "thumb")).toMatchObject({ assetId: "template", flipX: false });
    });
});

describe("two nodes in a row, run by a pressed list row", () => {
    beforeAll(() => {
        registerCoreBlueprintNodes();
    });

    function ref(elementId: string, elementType: string) {
        return { type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: PAGE, elementId, elementType } };
    }

    /**
     * The grid's Item Click: the pressed row's image shows that row's picture, mirrored, and the
     * row's button says it was picked and takes a crosshair pointer.
     */
    const grid = blueprintOf("bp-grid", { kind: "widgetMain", surfaceId: PAGE, elementId: "grid" }, {
        pick: {
            graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK },
                    picture: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "f-image" } },
                    thumb: ref("thumb", "nl.image"),
                    thumb2: ref("thumb", "nl.image"),
                    tag: ref("tag", "nl.button"),
                    tag2: ref("tag", "nl.button"),
                    setAsset: { type: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET },
                    flip: { type: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_X, params: { flipX: true } },
                    label: { type: "blueprint.element.button.setLabel", params: { label: "Picked" } },
                    pointer: { type: BLUEPRINT_NODE_TYPE_ELEMENT_BUTTON_SET_POINTER, params: { cursor: "crosshair" } },
                },
                exec: ["head", "setAsset", "flip", "label", "pointer"],
                data: [
                    ["picture", "value", "setAsset", "asset"],
                    ["thumb", "element", "setAsset", "element"],
                    ["thumb2", "element", "flip", "element"],
                    ["tag", "element", "label", "element"],
                    ["tag2", "element", "pointer", "element"],
                ],
            }),
        },
    });

    function row(key: string, index: number): UIListItemScope {
        return {
            item: { name: key, image: { kind: "imageAsset", assetId: `asset-${key}` } },
            index,
            count: 3,
            key,
            struct: PICTURE_STRUCT,
            selected: false,
        };
    }

    it("leaves both writes of each pair on the pressed row's widgets, and nothing on the other rows", async () => {
        const page = createRowRuntime([grid], { document: createDocument() });
        try {
            for (const [key, index] of [["a", 0], ["b", 1]] as const) {
                await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index }, {
                    listItemScope: row(key, index),
                    instanceKey: buildUIListItemInstanceKey(undefined, "grid", key),
                });
            }
            expect(page.errors).toEqual([]);

            for (const key of ["a", "b"]) {
                const drawing = buildUIListItemInstanceKey(undefined, "grid", key);
                expect(page.hostApi.widget.getImageProperties(buildUIWidgetAddress("thumb", drawing))).toMatchObject({
                    assetId: `asset-${key}`,
                    flipX: true,
                });
                expect(page.hostApi.widget.getButtonProperties(buildUIWidgetAddress("tag", drawing))).toEqual({
                    label: "Picked",
                    cursor: "crosshair",
                });
            }
            const untouched = buildUIListItemInstanceKey(undefined, "grid", "c");
            expect(page.hostApi.widget.getImageProperties(buildUIWidgetAddress("thumb", untouched))).toMatchObject({
                assetId: AUTHORED_PICTURE,
                flipX: false,
            });
            expect(page.hostApi.widget.getButtonProperties(buildUIWidgetAddress("tag", untouched)).label).toBe("Go");
        } finally {
            page.release();
        }
    });
});
