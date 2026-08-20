import { beforeAll, describe, expect, it } from "vitest";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { UI_SWITCH_ON_VARIANT_ID } from "@shared/types/ui-editor/switch";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { enteredVariantIdFor, findStateHost, stateScopedMoveTarget } from "./stateHost";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return {
        id,
        type,
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 10, height: 10, opacity: 1, visible: true },
        props: {},
    };
}

/** A switch with two parts on a surface, and the same shape again inside a component definition. */
function documentWithSwitch(): UIDocument {
    const surfaceElements: Record<string, UIElement> = {
        root: element("root", "nl.root", null, ["switch"]),
        switch: element("switch", "nl.switch", "root", ["track", "thumb"]),
        track: element("track", "nl.container", "switch"),
        thumb: element("thumb", "nl.container", "switch"),
        loose: element("loose", "nl.container", "root"),
    };
    return {
        version: 1,
        surfaces: [{ id: "s1", name: "s1", host: "app", kind: "appSurface", rootElementId: "root",
            designSize: { width: 100, height: 100 } }],
        elements: surfaceElements,
        components: [
            {
                id: "c1",
                name: "c1",
                rootElementId: "c-switch",
                elements: {
                    "c-switch": element("c-switch", "nl.switch", null, ["c-thumb"]),
                    "c-thumb": element("c-thumb", "nl.container", "c-switch"),
                },
            },
        ],
    } as unknown as UIDocument;
}

beforeAll(() => {
    // A stand-in rather than the real switch: what makes a widget a state host is that it declares
    // states, not which widget it is, and the real module drags a renderer and a whole registry in
    // behind it.
    widgetModuleRegistry.register({
        type: "nl.switch",
        displayName: "Switch",
        icon: (() => null) as unknown as UIWidgetModule["icon"],
        createDefaultElement: () => ({}),
        listEditorStates: () => [
            { id: null, name: "Off" },
            { id: UI_SWITCH_ON_VARIANT_ID, name: "On" },
        ],
        render: () => null,
    });
});

describe("findStateHost", () => {
    it("answers the nearest ancestor that declares states, never the element itself", () => {
        const document = documentWithSwitch();

        expect(findStateHost(document, "thumb")?.element.id).toBe("switch");
        // A widget declaring states hosts its subtree, not itself: its own bar comes from `listEditorStates`.
        expect(findStateHost(document, "switch")).toBeNull();
        expect(findStateHost(document, "loose")).toBeNull();
    });

    it("finds the host of an element that lives inside a component definition", () => {
        // A component's elements are not in `document.elements`. An ancestor walk that reads only
        // that table answers "no host" here, silently - which is how an earlier version of this rule
        // stopped working the moment an author opened a component.
        expect(findStateHost(documentWithSwitch(), "c-thumb")?.element.id).toBe("c-switch");
    });
});

describe("enteredVariantIdFor", () => {
    const document = documentWithSwitch();

    it("carries a state entered on an ancestor down to the element", () => {
        const entered = { surfaceId: "s1", elementId: "switch", variantId: UI_SWITCH_ON_VARIANT_ID };

        expect(enteredVariantIdFor(document, entered, "thumb")).toBe(UI_SWITCH_ON_VARIANT_ID);
        expect(enteredVariantIdFor(document, entered, "switch")).toBe(UI_SWITCH_ON_VARIANT_ID);
    });

    it("tells being out of scope apart from resting in the entered state", () => {
        const resting = { surfaceId: "s1", elementId: "switch", variantId: null };

        // Undefined means nothing above it was entered and its geometry is simply its own; null means
        // the author is looking at the state it rests in, which *is* its own geometry.
        expect(enteredVariantIdFor(document, resting, "thumb")).toBeNull();
        expect(enteredVariantIdFor(document, resting, "loose")).toBeUndefined();
        expect(enteredVariantIdFor(document, null, "thumb")).toBeUndefined();
    });
});

describe("stateScopedMoveTarget", () => {
    const document = documentWithSwitch();

    it("claims a move only inside a state host, and only away from the resting state", () => {
        const on = { surfaceId: "s1", elementId: "switch", variantId: UI_SWITCH_ON_VARIANT_ID };

        expect(stateScopedMoveTarget(document, on, "thumb")).toMatchObject({ variantId: UI_SWITCH_ON_VARIANT_ID });
        // The switch is nobody's part, so its own move is its own geometry.
        expect(stateScopedMoveTarget(document, on, "switch")).toBeNull();
        expect(stateScopedMoveTarget(document, { ...on, variantId: null }, "thumb")).toBeNull();
        expect(stateScopedMoveTarget(document, null, "thumb")).toBeNull();
    });

    it("refuses a state the host does not declare", () => {
        // A leftover variant from before the part adopted its host's states resolves to nothing
        // rather than becoming a third state only the panel knows about.
        const stray = { surfaceId: "s1", elementId: "switch", variantId: "v-stray" };

        expect(stateScopedMoveTarget(document, stray, "thumb")).toBeNull();
    });
});
