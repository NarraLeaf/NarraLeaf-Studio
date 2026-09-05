import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { UIElement } from "@shared/types/ui-editor/document";
import { SurfaceStateStore } from "./SurfaceStateStore";
import { mergeElementWithBlueprintBindings } from "./BindingEvaluator";

/**
 * A widget the widgetProp merge is allowed to write to.
 *
 * Not `nl.text`: the four appearance-capable types take only a `variant` binding (see
 * `appearanceCapableWidgets`), which is its own case at the bottom of this file.
 */
function sliderElement(id: string, label: string): UIElement {
    return {
        id,
        type: "nl.slider",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 20 },
        props: { label },
    };
}

/**
 * A document holding one blueprint whose field reads surface state, and the bindings given.
 *
 * The graph index is empty because nothing here runs a graph: a widgetProp binding is answered from
 * a field's value source alone.
 */
function documentWith(bindings: BlueprintDocument["blueprints"][string]["bindings"]): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        ownerRecords: {},
        blueprints: {
            main: {
                id: "main",
                name: "Main",
                owner: { kind: "globalMain" },
                graphs: { events: {}, functions: {} },
                members: {
                    variables: {},
                    functions: {},
                    fields: {
                        title: { id: "title", name: "Title", valueSource: { kind: "surfaceState", key: "title" } },
                        subtitle: { id: "subtitle", name: "Subtitle", valueSource: { kind: "surfaceState", key: "subtitle" } },
                    },
                },
                bindings,
            },
        },
    };
}

function binding(id: string, elementId: string, propPath: string, fieldId: string) {
    return {
        id,
        target: { kind: "widgetProp" as const, surfaceId: "home", elementId, propPath },
        source: { kind: "field" as const, blueprintId: "main", fieldId },
        mode: "replace" as const,
    };
}

const noDebug = () => undefined;

describe("mergeElementWithBlueprintBindings", () => {
    it("hands back the very same element when nothing is bound to it", () => {
        // Not merely an equal one: the walk used to clone every element, its layout and its props on
        // every render pass whether or not a binding applied, which on a page of a few hundred
        // widgets is a few hundred clones a dozen times over per page change.
        const element = sliderElement("headline", "Authored");
        const state = new SurfaceStateStore("home");
        const document = documentWith({ b1: binding("b1", "someone-else", "label", "title") });

        const merged = mergeElementWithBlueprintBindings(element, "home", document, state, noDebug);

        expect(merged).toBe(element);
    });

    it("does not confuse two surfaces that share an element id", () => {
        const element = sliderElement("headline", "Authored");
        const state = new SurfaceStateStore("home");
        state.set("title", "Bound");
        const document = documentWith({ b1: binding("b1", "headline", "label", "title") });

        expect(mergeElementWithBlueprintBindings(element, "home", document, state, noDebug).props?.label)
            .toBe("Bound");
        expect(mergeElementWithBlueprintBindings(element, "config", document, state, noDebug))
            .toBe(element);
    });

    it("applies a bound prop without touching the authored element", () => {
        const element = sliderElement("headline", "Authored");
        const state = new SurfaceStateStore("home");
        state.set("title", "From state");
        const document = documentWith({ b1: binding("b1", "headline", "label", "title") });

        const merged = mergeElementWithBlueprintBindings(element, "home", document, state, noDebug);

        expect(merged).not.toBe(element);
        expect(merged.props?.label).toBe("From state");
        expect(element.props?.label).toBe("Authored");
    });

    it("keeps the last binding on a prop, in document order", () => {
        // Two bindings on one prop is a mistake an author can make, and which one wins has to stay
        // what it was: the order the document lists them in.
        const element = sliderElement("headline", "Authored");
        const state = new SurfaceStateStore("home");
        state.set("title", "First");
        state.set("subtitle", "Second");
        const document = documentWith({
            b1: binding("b1", "headline", "label", "title"),
            b2: binding("b2", "headline", "label", "subtitle"),
        });

        const merged = mergeElementWithBlueprintBindings(element, "home", document, state, noDebug);

        expect(merged.props?.label).toBe("Second");
    });

    it("reads a document it has already indexed, and sees state that has moved since", () => {
        // The index is cached against the document; the values are not, and must not be.
        const element = sliderElement("headline", "Authored");
        const state = new SurfaceStateStore("home");
        const document = documentWith({ b1: binding("b1", "headline", "label", "title") });

        state.set("title", "One");
        expect(mergeElementWithBlueprintBindings(element, "home", document, state, noDebug).props?.label)
            .toBe("One");
        state.set("title", "Two");
        expect(mergeElementWithBlueprintBindings(element, "home", document, state, noDebug).props?.label)
            .toBe("Two");
    });

    it("ignores a broken binding", () => {
        const element = sliderElement("headline", "Authored");
        const state = new SurfaceStateStore("home");
        state.set("title", "From state");
        const document = documentWith({
            b1: { ...binding("b1", "headline", "label", "title"), status: "broken" as const },
        });

        expect(mergeElementWithBlueprintBindings(element, "home", document, state, noDebug).props?.label)
            .toBe("Authored");
    });

    it("takes only a variant binding on an appearance-capable widget", () => {
        // The four types that carry the shared appearance model resolve their props through variants,
        // so a widgetProp write would be overlaid and lost. The element still comes back cloned - it
        // has a binding, it is just not one that applies.
        const element: UIElement = { ...sliderElement("headline", "Authored"), type: "nl.text" };
        const state = new SurfaceStateStore("home");
        state.set("title", "From state");
        const document = documentWith({ b1: binding("b1", "headline", "label", "title") });

        expect(mergeElementWithBlueprintBindings(element, "home", document, state, noDebug).props?.label)
            .toBe("Authored");
    });

    it("writes a layout field through its own path", () => {
        const element = sliderElement("headline", "Authored");
        const state = new SurfaceStateStore("home");
        state.set("title", false);
        const document = documentWith({ b1: binding("b1", "headline", "layout.visible", "title") });

        const merged = mergeElementWithBlueprintBindings(element, "home", document, state, noDebug);

        expect(merged.layout.visible).toBe(false);
        expect(element.layout.visible).toBeUndefined();
    });
});
