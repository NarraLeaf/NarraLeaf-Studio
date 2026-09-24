import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import {
    registerContributedWidgetSource,
    type ContributedWidgetDeclaration,
} from "@shared/types/ui-editor/contributedWidgets";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { resolvePasteTargetAfterSelection } from "@/lib/ui-editor/commands/uiEditorCommands";
import { resolveNearestInsertParentInSurface } from "./resolveInsertTargetParent";
import { aimAddAtElement, parentTakesAddedElements, resolveNewElementParent, settleAddTarget } from "./resolveAddTarget";

const METER = "probe.parts.meter";

function element(
    id: string,
    type: string,
    parentId: string | null,
    childrenIds: string[] = [],
    extra?: Record<string, unknown>,
): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 40 },
        ...(extra ? { extra } : {}),
    };
}

/**
 * One page with every kind of widget that holds only its own parts, between two ordinary elements so
 * "right after the widget" is distinguishable from "at the end".
 */
function page(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{
            id: "page",
            name: "Page",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1280, height: 720 },
            rootElementId: "root",
        }],
        elements: {
            root: element("root", "nl.root", null, ["before", "slider", "switch", "meter", "box", "after"]),
            before: element("before", "nl.text", "root"),
            slider: element("slider", "nl.slider", "root", ["track", "handle"]),
            track: element("track", "nl.container", "slider", [], { sliderSlot: "track" }),
            handle: element("handle", "nl.container", "slider", ["grip"], { sliderSlot: "handle" }),
            grip: element("grip", "nl.image", "handle"),
            switch: element("switch", "nl.switch", "root", ["switch-track", "thumb"]),
            "switch-track": element("switch-track", "nl.container", "switch", [], { switchSlot: "track" }),
            thumb: element("thumb", "nl.container", "switch", [], { switchSlot: "thumb" }),
            meter: element("meter", METER, "root", ["fill"]),
            fill: element("fill", "nl.container", "meter", [], { partSlot: "fill" }),
            box: element("box", "nl.container", "root"),
            after: element("after", "nl.text", "root"),
        },
    };
}

const label = element("label", "nl.text", null);
const copiedHandle = element("copied-handle", "nl.container", null, [], { sliderSlot: "handle" });
const copiedFill = element("copied-fill", "nl.container", null, [], { partSlot: "fill" });

function selection(id: string): UIElementSelection {
    return { editor: "ui", surfaceId: "page", elementIds: [id], primaryId: id };
}

/** Ctrl+V: aimed after the selection, then settled - what `uiEditorPasteAfterSelection` does. */
function pasteAfter(doc: UIDocument, selectedId: string, pasted: UIElement[]) {
    const aim = resolvePasteTargetAfterSelection(doc, "page", selection(selectedId));
    return aim ? settleAddTarget(doc, "page", aim, pasted) : null;
}

/** The context menu's Paste: aimed at the element under the pointer, then settled. */
function pasteOn(doc: UIDocument, hitId: string, pasted: UIElement[]) {
    const aim = aimAddAtElement(doc, "page", hitId, hitId);
    return aim ? settleAddTarget(doc, "page", aim, pasted) : null;
}

let removeSource: (() => void) | null = null;

beforeEach(() => {
    const meter: ContributedWidgetDeclaration = { type: METER, ownerPluginId: "probe.parts", partSlots: ["fill"] };
    removeSource = registerContributedWidgetSource({
        get: type => (type === METER ? meter : undefined),
        list: () => [meter],
    });
});

afterEach(() => {
    removeSource?.();
    removeSource = null;
});

describe("pasting while one of a widget's parts is selected", () => {
    it("puts an ordinary element right after the widget, in the widget's own parent", () => {
        const doc = page();
        expect(pasteAfter(doc, "handle", [label])).toEqual({ parentId: "root", beforeChildId: "switch" });
        expect(pasteAfter(doc, "track", [label])).toEqual({ parentId: "root", beforeChildId: "switch" });
        expect(pasteAfter(doc, "thumb", [label])).toEqual({ parentId: "root", beforeChildId: "meter" });
        expect(pasteAfter(doc, "fill", [label])).toEqual({ parentId: "root", beforeChildId: "box" });
    });

    it("does the same from the context menu, aimed at the part itself", () => {
        const doc = page();
        expect(pasteOn(doc, "handle", [label])).toEqual({ parentId: "root", beforeChildId: "switch" });
        expect(pasteOn(doc, "thumb", [label])).toEqual({ parentId: "root", beforeChildId: "meter" });
        expect(pasteOn(doc, "fill", [label])).toEqual({ parentId: "root", beforeChildId: "box" });
    });

    it("puts a copied part into its widget when the slot it fills is free", () => {
        const doc = page();
        doc.elements.slider.childrenIds = ["track"];
        delete doc.elements.handle;
        delete doc.elements.grip;
        expect(pasteAfter(doc, "track", [copiedHandle])).toEqual({ parentId: "slider", beforeChildId: null });
        expect(pasteOn(doc, "track", [copiedHandle])).toEqual({ parentId: "slider", beforeChildId: null });

        doc.elements.meter.childrenIds = [];
        delete doc.elements.fill;
        expect(settleAddTarget(doc, "page", { parentId: "meter", beforeChildId: null }, [copiedFill]))
            .toEqual({ parentId: "meter", beforeChildId: null });
    });

    it("puts a copied part beside its widget when that slot is already filled", () => {
        const doc = page();
        expect(pasteAfter(doc, "handle", [copiedHandle])).toEqual({ parentId: "root", beforeChildId: "switch" });
        expect(pasteAfter(doc, "fill", [copiedFill])).toEqual({ parentId: "root", beforeChildId: "box" });
        // A part of another widget fills no slot here.
        expect(pasteAfter(doc, "thumb", [copiedHandle])).toEqual({ parentId: "root", beforeChildId: "meter" });
    });
});

describe("inserting a new element while one of a widget's parts is selected", () => {
    it("puts it in the widget's own parent, where a paste made with that selection lands", () => {
        const doc = page();
        for (const part of ["handle", "track", "thumb", "fill"]) {
            expect(resolveNewElementParent(doc, "page", part)).toBe("root");
            expect(pasteAfter(doc, part, [label])?.parentId).toBe("root");
        }
    });

    it("puts it in the widget's own parent while the widget itself is selected", () => {
        const doc = page();
        expect(resolveNewElementParent(doc, "page", "slider")).toBe("root");
        expect(resolveNewElementParent(doc, "page", "switch")).toBe("root");
        expect(resolveNewElementParent(doc, "page", "meter")).toBe("root");
    });

    it("still goes into what an author put inside a part, and into an ordinary container", () => {
        const doc = page();
        // The grip is the author's own element, not a part: it is where they were working.
        expect(resolveNewElementParent(doc, "page", "grip")).toBe("handle");
        expect(resolveNewElementParent(doc, "page", "box")).toBe("box");
        expect(resolveNewElementParent(doc, "page", "before")).toBe("root");
        expect(resolveNewElementParent(doc, "page", null)).toBe("root");
    });

    it("goes into a part the outline's Insert Child names, which is the way in", () => {
        const doc = page();
        expect(resolveNearestInsertParentInSurface(doc, "page", "handle")).toBe("handle");
        expect(resolveNearestInsertParentInSurface(doc, "page", "thumb")).toBe("thumb");
        expect(resolveNearestInsertParentInSurface(doc, "page", "fill")).toBe("fill");
    });

    it("walks out of a linked component instance, which takes no new element at all", () => {
        const doc = page();
        doc.elements.box.extra = { componentLink: { componentId: "c", linked: true } };
        doc.elements.box.childrenIds = ["inner"];
        doc.elements.inner = element("inner", "nl.text", "box");
        expect(resolveNewElementParent(doc, "page", "box")).toBe("root");
        expect(resolveNewElementParent(doc, "page", "inner")).toBe("root");
    });
});

describe("what a paste does not change", () => {
    it("pastes into a part through what an author put inside it", () => {
        const doc = page();
        expect(pasteAfter(doc, "grip", [label])).toEqual({ parentId: "handle", beforeChildId: null });
        expect(pasteOn(doc, "grip", [label])).toEqual({ parentId: "handle", beforeChildId: null });
    });

    it("pastes into a part named as the parent, as Paste into Container does", () => {
        const doc = page();
        expect(settleAddTarget(doc, "page", { parentId: "handle", beforeChildId: null }, [label]))
            .toEqual({ parentId: "handle", beforeChildId: null });
    });

    it("pastes into a container from the context menu and after a selection with Ctrl+V", () => {
        const doc = page();
        expect(pasteOn(doc, "box", [label])).toEqual({ parentId: "box", beforeChildId: null });
        expect(pasteAfter(doc, "box", [label])).toEqual({ parentId: "root", beforeChildId: "after" });
        expect(pasteOn(doc, "before", [label])).toEqual({ parentId: "root", beforeChildId: null });
    });

    it("walks out of a linked component instance, whose inside belongs to its definition", () => {
        const doc = page();
        doc.elements.box.extra = { componentLink: { componentId: "c", linked: true } };
        doc.elements.box.childrenIds = ["inner"];
        doc.elements.inner = element("inner", "nl.text", "box");
        expect(pasteAfter(doc, "inner", [label])).toEqual({ parentId: "root", beforeChildId: "after" });
    });
});

describe("parentTakesAddedElements", () => {
    it("takes nothing into a widget with parts but its own parts, one to a slot", () => {
        const doc = page();
        expect(parentTakesAddedElements(doc, doc.elements.slider, [label])).toBe(false);
        expect(parentTakesAddedElements(doc, doc.elements.slider, [copiedHandle])).toBe(false);
        expect(parentTakesAddedElements(doc, doc.elements.slider, [])).toBe(false);

        doc.elements.slider.childrenIds = ["track"];
        expect(parentTakesAddedElements(doc, doc.elements.slider, [copiedHandle])).toBe(true);
        expect(parentTakesAddedElements(doc, doc.elements.slider, [copiedHandle, copiedHandle])).toBe(false);
        expect(parentTakesAddedElements(doc, doc.elements.slider, [copiedHandle, label])).toBe(false);
    });

    it("stops taking a plugin widget's parts as parts once its plugin is gone", () => {
        const doc = page();
        doc.elements.meter.childrenIds = [];
        expect(parentTakesAddedElements(doc, doc.elements.meter, [copiedFill])).toBe(true);
        removeSource?.();
        removeSource = null;
        expect(parentTakesAddedElements(doc, doc.elements.meter, [copiedFill])).toBe(false);
    });
});
