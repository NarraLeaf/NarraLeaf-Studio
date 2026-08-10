import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import {
    applyPlannedMove,
    applyUngroupContainer,
    canUngroupContainer,
    filterToTopLevelMovers,
    normalizeFlowChildLayouts,
    planMoveElementsInSurface,
} from "./uiDocumentTreeMove";
import { COMPONENT_EDITOR_ROOT_EXTRA_KEY } from "@/lib/ui-editor/componentEditorRoot";

function element(
    id: string,
    type: string,
    parentId: string | null,
    childrenIds: string[] = [],
    patch: Partial<UIElement> = {},
): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 24, y: 36, width: 100, height: 50 },
        ...patch,
    };
}

function makeDocument(elements: Record<string, UIElement>): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 800, height: 600 },
                rootElementId: "root",
            },
        ],
        elements,
    };
}

describe("uiDocumentTreeMove flow layout normalization", () => {
    it("drops selected descendants when their ancestor is also selected", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["panel", "sibling"]),
            panel: element("panel", "nl.container", "root", ["child"]),
            child: element("child", "nl.text", "panel"),
            sibling: element("sibling", "nl.text", "root"),
        });

        expect(filterToTopLevelMovers(document, ["panel", "child", "sibling"])).toEqual(["panel", "sibling"]);
    });

    it("neutralizes direct flow-child coordinates without changing authored size or rotation", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["stack", "free"]),
            stack: element("stack", "nl.container", "root", ["flow"], {
                props: { layoutKind: "stack" },
            }),
            flow: element("flow", "nl.text", "stack", [], {
                layout: { x: 18, y: 22, width: 140, height: 32, rotation: 15 },
            }),
            free: element("free", "nl.container", "root", ["absolute"], {
                props: { layoutKind: "free" },
            }),
            absolute: element("absolute", "nl.text", "free", [], {
                layout: { x: 9, y: 11, width: 80, height: 20 },
            }),
        });

        expect(normalizeFlowChildLayouts(document)).toBe(true);

        expect(document.elements.flow.layout).toMatchObject({
            x: 0,
            y: 0,
            width: 140,
            height: 32,
            rotation: 15,
        });
        expect(document.elements.absolute.layout).toMatchObject({ x: 9, y: 11 });
    });

    it("keeps list scrollbar parts out of flow-child coordinate normalization", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["list"]),
            list: element("list", "nl.list", "root", ["item", "track"]),
            item: element("item", "nl.text", "list", [], {
                extra: { listSlot: "itemTemplate" },
                layout: { x: 40, y: 50, width: 100, height: 24 },
            }),
            track: element("track", "nl.container", "list", [], {
                extra: { listSlot: "scrollbarTrack" },
                layout: { x: 7, y: 8, width: 12, height: 100 },
            }),
        });

        normalizeFlowChildLayouts(document);

        expect(document.elements.item.layout).toMatchObject({ x: 0, y: 0 });
        expect(document.elements.track.layout).toMatchObject({ x: 7, y: 8 });
    });

    it("normalizes stale coordinates when reordering inside the same flow parent", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["stack"]),
            stack: element("stack", "nl.container", "root", ["a", "b"], {
                props: { layoutKind: "stack" },
            }),
            a: element("a", "nl.text", "stack", [], {
                layout: { x: 10, y: 20, width: 80, height: 20 },
            }),
            b: element("b", "nl.text", "stack", [], {
                layout: { x: 30, y: 40, width: 80, height: 20 },
            }),
        });

        applyPlannedMove(document, {
            movers: ["b"],
            targetParentId: "stack",
            beforeChildId: "a",
        });

        expect(document.elements.stack.childrenIds).toEqual(["b", "a"]);
        expect(document.elements.b.layout).toMatchObject({ x: 0, y: 0 });
    });
});

describe("uiDocumentTreeMove ungroup", () => {
    it("lifts children into the group's slot among its siblings, keeping their place on screen", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["before", "group", "after"]),
            before: element("before", "nl.text", "root"),
            group: element("group", "nl.container", "root", ["a", "b"], {
                layout: { x: 100, y: 50, width: 200, height: 200 },
            }),
            a: element("a", "nl.text", "group", [], { layout: { x: 10, y: 20, width: 80, height: 20 } }),
            b: element("b", "nl.image", "group", [], { layout: { x: 30, y: 40, width: 80, height: 20 } }),
            after: element("after", "nl.text", "root"),
        });

        expect(applyUngroupContainer(document, "surface", "group")).toEqual(["a", "b"]);
        expect(document.elements.root.childrenIds).toEqual(["before", "a", "b", "after"]);
        expect(document.elements.group).toBeUndefined();
        expect(document.elements.a.parentId).toBe("root");
        // The group sat at (100, 50), so its children land at their own offsets plus that.
        expect(document.elements.a.layout).toMatchObject({ x: 110, y: 70 });
        expect(document.elements.b.layout).toMatchObject({ x: 130, y: 90 });
    });

    it("removes an empty group outright", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["group"]),
            group: element("group", "nl.container", "root"),
        });

        expect(applyUngroupContainer(document, "surface", "group")).toEqual([]);
        expect(document.elements.root.childrenIds).toEqual([]);
        expect(document.elements.group).toBeUndefined();
    });

    it("dissolves nested groups whichever order they are handed over in", () => {
        const build = () =>
            makeDocument({
                root: element("root", "nl.root", null, ["outer"]),
                outer: element("outer", "nl.container", "root", ["inner", "loose"]),
                inner: element("inner", "nl.container", "outer", ["deep"]),
                deep: element("deep", "nl.text", "inner"),
                loose: element("loose", "nl.text", "outer"),
            });

        for (const order of [["outer", "inner"], ["inner", "outer"]]) {
            const document = build();
            for (const id of order) {
                applyUngroupContainer(document, "surface", id);
            }
            expect(document.elements.root.childrenIds).toEqual(["deep", "loose"]);
            expect(document.elements.outer).toBeUndefined();
            expect(document.elements.inner).toBeUndefined();
        }
    });

    it("refuses anything that is not a user's group", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["button", "linked", "componentRoot", "plain"]),
            button: element("button", "nl.button", "root", ["label"]),
            label: element("label", "nl.text", "button"),
            linked: element("linked", "nl.container", "root", [], {
                extra: { componentLink: { componentId: "c1", linked: true } },
            }),
            componentRoot: element("componentRoot", "nl.container", "root", [], {
                extra: { [COMPONENT_EDITOR_ROOT_EXTRA_KEY]: true },
            }),
            plain: element("plain", "nl.container", "root", []),
        });

        expect(canUngroupContainer(document, "surface", "root")).toBe(false);
        expect(canUngroupContainer(document, "surface", "button")).toBe(false);
        expect(canUngroupContainer(document, "surface", "linked")).toBe(false);
        expect(canUngroupContainer(document, "surface", "componentRoot")).toBe(false);
        expect(canUngroupContainer(document, "surface", "missing")).toBe(false);
        expect(canUngroupContainer(document, "surface", "plain")).toBe(true);
        expect(applyUngroupContainer(document, "surface", "button")).toBeNull();
        expect(document.elements.button.childrenIds).toEqual(["label"]);
    });

    it("keeps a non-empty group whose parent takes no user children", () => {
        // A slider owns its parts; lifting a group's children in would leave the slider holding
        // elements it was never built to place.
        const document = makeDocument({
            root: element("root", "nl.root", null, ["slider"]),
            slider: element("slider", "nl.slider", "root", ["group"]),
            group: element("group", "nl.container", "slider", ["knob"]),
            knob: element("knob", "nl.image", "group"),
        });

        expect(canUngroupContainer(document, "surface", "group")).toBe(false);
        expect(applyUngroupContainer(document, "surface", "group")).toBeNull();

        document.elements.group.childrenIds = [];
        expect(canUngroupContainer(document, "surface", "group")).toBe(true);
    });

    it("makes children lifted into a list its item templates", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["list"]),
            list: element("list", "nl.list", "root", ["group"]),
            group: element("group", "nl.container", "list", ["row"], {
                extra: { listSlot: "itemTemplate" },
            }),
            row: element("row", "nl.text", "group"),
        });

        expect(applyUngroupContainer(document, "surface", "group")).toEqual(["row"]);
        expect(document.elements.row.extra?.listSlot).toBe("itemTemplate");
    });
});

/**
 * A widget's own parts cannot be dragged out of it.
 *
 * The asymmetry is the point: moving something *into* a slider or switch was already refused
 * (`uiElementTypeAcceptsUserChildren`), so a part moved out could never be moved back by the same
 * gesture. The widget would render its fallback chrome while an orphan carrying a dead slot marker
 * sat elsewhere on the canvas - and a switch's part takes the `on` appearance variant with it, so
 * the authored travel and transition leave too.
 */
describe("uiDocumentTreeMove structural parts", () => {
    function sliderDocument() {
        return makeDocument({
            root: element("root", "nl.root", null, ["slider", "panel"]),
            slider: element("slider", "nl.slider", "root", ["track", "handle"]),
            track: element("track", "nl.container", "slider", [], { extra: { sliderSlot: "track" } }),
            handle: element("handle", "nl.container", "slider", [], { extra: { sliderSlot: "handle" } }),
            panel: element("panel", "nl.container", "root", []),
        });
    }

    function switchDocument() {
        return makeDocument({
            root: element("root", "nl.root", null, ["toggle", "panel"]),
            toggle: element("toggle", "nl.switch", "root", ["track", "thumb"]),
            track: element("track", "nl.container", "toggle", [], { extra: { switchSlot: "track" } }),
            thumb: element("thumb", "nl.container", "toggle", [], { extra: { switchSlot: "thumb" } }),
            panel: element("panel", "nl.container", "root", []),
        });
    }

    it("refuses to move a slider's track or handle out of the slider", () => {
        const document = sliderDocument();

        expect(planMoveElementsInSurface(document, "surface", ["track"], "panel", null))
            .toEqual({ ok: false, reason: "invalid_movers" });
        expect(planMoveElementsInSurface(document, "surface", ["handle"], "root", null))
            .toEqual({ ok: false, reason: "invalid_movers" });
    });

    it("refuses to move a switch's track or thumb out of the switch", () => {
        const document = switchDocument();

        expect(planMoveElementsInSurface(document, "surface", ["thumb"], "panel", null))
            .toEqual({ ok: false, reason: "invalid_movers" });
        expect(planMoveElementsInSurface(document, "surface", ["track"], "root", null))
            .toEqual({ ok: false, reason: "invalid_movers" });
    });

    it("moves the rest of a mixed selection and leaves the part where it is", () => {
        const document = switchDocument();
        // A second ordinary element so the move has something legitimate to carry.
        document.elements.stray = element("stray", "nl.text", "root");
        document.elements.root.childrenIds.push("stray");

        const planned = planMoveElementsInSurface(document, "surface", ["thumb", "stray"], "panel", null);

        expect(planned.ok).toBe(true);
        expect(planned.ok && planned.plan.movers).toEqual(["stray"]);
        expect(document.elements.thumb.parentId).toBe("toggle");
    });

    it("still lets an element with no slot marker out of a part-owning widget", () => {
        // The escape hatch: only a child that actually claims a slot is sealed in. Without this a
        // stray that somehow ended up under a slider would be stuck there with no way to recover it.
        const document = sliderDocument();
        document.elements.orphan = element("orphan", "nl.text", "slider");
        document.elements.slider.childrenIds.push("orphan");

        const planned = planMoveElementsInSurface(document, "surface", ["orphan"], "panel", null);

        expect(planned.ok).toBe(true);
        expect(planned.ok && planned.plan.movers).toEqual(["orphan"]);
    });

    it("leaves a list's item template movable, because a list can take it back", () => {
        // Deliberately not covered by the guard - `nl.list` accepts user children, so lifting a
        // template out is undone by the same drag that did it.
        const document = makeDocument({
            root: element("root", "nl.root", null, ["list", "panel"]),
            list: element("list", "nl.list", "root", ["tpl"]),
            tpl: element("tpl", "nl.container", "list", [], { extra: { listSlot: "itemTemplate" } }),
            panel: element("panel", "nl.container", "root", []),
        });

        const planned = planMoveElementsInSurface(document, "surface", ["tpl"], "panel", null);

        expect(planned.ok).toBe(true);
        expect(planned.ok && planned.plan.movers).toEqual(["tpl"]);
    });
});
