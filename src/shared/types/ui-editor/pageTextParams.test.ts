import { describe, expect, it } from "vitest";
import type { UIDocument, UIElement, UISurface } from "./document";
import { UI_FRAME_ELEMENT_TYPE } from "./frame";
import {
    listUIPageParamTextElements,
    listUIPageTextValues,
    resolveUIPageTextParams,
    uiPageParamUnitId,
    uiTextPageParamOf,
} from "./pageTextParams";
import { listUIPageDefaultUnits, listUITextOwnUnits, mapCopiedUIPageDefaultUnits } from "./textUnitCopies";
import { uiTextSiteOf } from "./textSource";
import { uiTextSampleCauseOf } from "./textSample";

const CONFIRM: UISurface = {
    id: "confirm",
    name: "Confirm",
    host: "app",
    kind: "appSurface",
    designSize: { width: 800, height: 600 },
    rootElementId: "confirm-root",
    params: [
        { id: "message", name: "message", type: "text", defaultValue: "Are you sure?" },
        { id: "note", name: "note", type: "text" },
        { id: "count", name: "count", type: "number" },
    ],
};

function element(id: string, patch: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type: "nl.text",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        ...patch,
    } as UIElement;
}

function documentWith(extra: Record<string, UIElement> = {}): UIDocument {
    return {
        schemaVersion: 14,
        id: "doc",
        name: "doc",
        surfaces: [
            CONFIRM,
            { ...CONFIRM, id: "title", name: "Title", rootElementId: "title-root", params: [] },
        ],
        elements: {
            "confirm-root": element("confirm-root", { type: "nl.root", childrenIds: ["msg", "note-text"] }),
            msg: element("msg", {
                parentId: "confirm-root",
                props: { text: "Sample" },
                valueBindings: { text: { kind: "pageParam", paramId: "message" } },
            }),
            "note-text": element("note-text", {
                parentId: "confirm-root",
                props: { text: "" },
                valueBindings: { text: { kind: "pageParam", paramId: "note" } },
            }),
            "title-root": element("title-root", { type: "nl.root", childrenIds: ["embed"] }),
            embed: element("embed", {
                type: UI_FRAME_ELEMENT_TYPE,
                parentId: "title-root",
                props: { targetSurfaceId: "confirm", params: { message: "Leave the game?", count: 2 } },
            }),
            ...extra,
        },
    } as UIDocument;
}

describe("what a page's text parameters hold", () => {
    it("shows words given at the opening as given, and translates the default through the page's unit", () => {
        const texts = resolveUIPageTextParams(CONFIRM, { message: "Quit?" }, { opened: true });
        expect(texts.opened).toBe(true);
        expect(texts.values.message).toEqual({ origin: "placement", text: "Quit?", key: "", unitId: "" });
        expect(texts.values.note).toEqual({
            origin: "default",
            text: "",
            key: "",
            unitId: uiPageParamUnitId("confirm", "note"),
        });
        // Only text parameters: a number is read through a blueprint, not shown by a binding.
        expect(Object.keys(texts.values)).toEqual(["message", "note"]);
    });

    it("translates words a Page widget gives through the widget's own unit, named by the parameter's name", () => {
        const texts = resolveUIPageTextParams(CONFIRM, { message: "Quit?" }, { opened: true, giverId: "embed" });
        expect(texts.values.message?.unitId).toBe("ui:embed.param.message");
    });

    it("reads a page that declares nothing as giving nothing", () => {
        expect(resolveUIPageTextParams(null, {}, { opened: false })).toEqual({ opened: false, values: {} });
    });
});

describe("the readers' view of a page's text parameters", () => {
    it("knows which texts show a parameter, and their words are sample text", () => {
        const document = documentWith();
        const site = uiTextSiteOf("nl.text")!;
        expect(uiTextPageParamOf(document.elements.msg!, site)).toBe("message");
        expect(uiTextSampleCauseOf(document.elements.msg!, site)).toBe("pageParam");
        expect(listUIPageParamTextElements(document, "confirm", "message").map(item => item.id)).toEqual(["msg"]);
        expect(listUIPageParamTextElements(document, "title", "message")).toEqual([]);
    });

    it("lists a default with words under the text that shows it, and none for an empty one", () => {
        const document = documentWith();
        expect(listUIPageTextValues(document, document.elements.msg!).map(item => item.value)).toEqual([{
            origin: "default",
            text: "Are you sure?",
            key: "",
            unitId: "ui:confirm.param.message",
        }]);
        expect(listUIPageTextValues(document, document.elements["note-text"]!)).toEqual([]);
    });

    it("lists the words a Page widget gives a parameter its page shows, and nothing for one it does not show", () => {
        const document = documentWith();
        const values = listUIPageTextValues(document, document.elements.embed!);
        expect(values.map(item => [item.param.id, item.value.text, item.value.unitId])).toEqual([
            ["message", "Leave the game?", "ui:embed.param.message"],
        ]);
        expect(values[0]!.shownBy.map(item => item.id)).toEqual(["msg"]);
    });
});

describe("translations that follow a copy", () => {
    it("carries a Page widget's words and a page's defaults to the copy", () => {
        const document = documentWith();
        expect(listUITextOwnUnits({ embed: document.elements.embed! }).map(unit => unit.unitId))
            .toEqual(["ui:embed.param.message"]);
        expect(listUIPageDefaultUnits(CONFIRM)).toEqual(["ui:confirm.param.message", "ui:confirm.param.note"]);
        expect([...mapCopiedUIPageDefaultUnits([CONFIRM], { confirm: "copy" })]).toEqual([
            ["ui:confirm.param.message", "ui:copy.param.message"],
            ["ui:confirm.param.note", "ui:copy.param.note"],
        ]);
    });
});
