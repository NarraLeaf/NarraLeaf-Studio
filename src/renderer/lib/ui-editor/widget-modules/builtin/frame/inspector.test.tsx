/**
 * The page picker of a Page widget, in the component editor and on a page.
 *
 * A page that would draw the widget inside itself is listed, marked and not selectable. For a widget
 * inside a component that includes the page the component is placed on - which the picker used to
 * offer as an ordinary choice, because its loop check walked pages and never looked inside a
 * placement, and in the component editor had no pages' elements to walk at all.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type {
    FieldDefinition,
    PropertyEditorSchema,
    SelectFieldDefinition,
    SelectOption,
} from "@/apps/workspace/modules/properties/framework/types";
import { translate } from "@/lib/i18n";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    createComponentDocumentServiceAdapter,
    getComponentEditorSurfaceId,
} from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import type { UIInspectorData } from "../../types";
import { createFrameInspector } from "./inspector";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = [], extra?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 100 }, ...extra };
}

function frame(id: string, parentId: string, targetSurfaceId: string | null): UIElement {
    return element(id, "nl.frame", parentId, [], { props: { targetSurfaceId, params: {}, navigationMode: "static" } });
}

function page(id: string, name: string, rootElementId: string) {
    return { id, name, host: "app" as const, kind: "appSurface" as const, designSize: { width: 640, height: 360 }, rootElementId };
}

/**
 * `Host` places the card; `Gallery` holds a Page widget of its own; `Credits` is neither. The card
 * holds the Page widget `window`, pointed wherever the test says.
 */
function project(windowTarget: string | null = null): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [page("host", "Host", "host-root"), page("gallery", "Gallery", "gallery-root"), page("credits", "Credits", "credits-root")],
        elements: {
            "host-root": element("host-root", "nl.root", null, ["slot"]),
            slot: element("slot", "nl.container", "host-root", [], { extra: { componentLink: { componentId: "card", linked: true } } }),
            "gallery-root": element("gallery-root", "nl.root", null, ["show"]),
            show: frame("show", "gallery-root", null),
            "credits-root": element("credits-root", "nl.root", null),
        },
        components: [
            {
                id: "card",
                name: "Card",
                rootElementId: "card-root",
                elements: {
                    "card-root": element("card-root", "nl.container", null, ["window"]),
                    window: frame("window", "card-root", windowTarget),
                },
            },
        ],
    };
}

/** The reads the inspector and the component editor's adapter make of the real service. */
function service(document: UIDocument): UIDocumentService {
    return {
        getDocument: () => document,
        getPageDocument: () => document,
        getRevision: () => 1,
        getComponent: (componentId: string) => document.components?.find(component => component.id === componentId),
    } as unknown as UIDocumentService;
}

function pageField(schema: PropertyEditorSchema<UIInspectorData>): SelectFieldDefinition<UIInspectorData> {
    const fields: FieldDefinition<UIInspectorData>[] = (schema.tabs ?? []).flatMap(tab => tab.fields);
    const found = fields.find(field => field.id === "frame.targetSurfaceId");
    if (!found) {
        throw new Error("the Page field is gone");
    }
    return found as SelectFieldDefinition<UIInspectorData>;
}

function pickerFor(data: UIInspectorData): SelectOption[] {
    const field = pageField(createFrameInspector({ element: data.element, documentService: data.documentService }));
    return typeof field.options === "function" ? field.options(data) : field.options;
}

/** Each page option as `label`, `label (disabled)`, and the reason beside it when there is one. */
function describePages(options: SelectOption[]): string[] {
    return options
        .filter(option => option.value !== options[0]!.value)
        .map(option => [option.label, option.disabled ? "(disabled)" : "", option.secondaryLabel ?? ""].filter(Boolean).join(" "));
}

const LEADS_BACK = translate("widgets.frame.leadsBackHere");

describe("the Page widget's page picker", () => {
    it("marks the page a component is placed on when the widget is inside that component", () => {
        const document = project();
        const adapter = createComponentDocumentServiceAdapter(service(document), "card");
        const view = adapter.getDocument();

        const options = pickerFor({
            element: view.elements.window!,
            elements: [view.elements.window!],
            documentService: adapter,
            surfaceId: getComponentEditorSurfaceId("card"),
        });

        expect(describePages(options)).toEqual([`Host (disabled) ${LEADS_BACK}`, "Gallery", "Credits"]);
        // The component editor's own surface is the definition, not a page, and is never offered.
        expect(options.map(option => option.value)).not.toContain(getComponentEditorSurfaceId("card"));
    });

    it("marks a page that reaches the component through a Page widget of its own", () => {
        const document = project();
        // Gallery now shows Host, which places the card: Gallery leads back to the card as well.
        (document.elements.show!.props as Record<string, unknown>).targetSurfaceId = "host";
        const adapter = createComponentDocumentServiceAdapter(service(document), "card");
        const view = adapter.getDocument();

        const options = pickerFor({
            element: view.elements.window!,
            elements: [view.elements.window!],
            documentService: adapter,
            surfaceId: getComponentEditorSurfaceId("card"),
        });

        expect(describePages(options)).toEqual([
            `Host (disabled) ${LEADS_BACK}`,
            `Gallery (disabled) ${LEADS_BACK}`,
            "Credits",
        ]);
    });

    it("marks a page on a page whose way back runs through a component", () => {
        // The card shows Gallery, and Host places the card: Gallery's own widget may not show Host.
        const document = project("gallery");

        const options = pickerFor({
            element: document.elements.show!,
            elements: [document.elements.show!],
            documentService: service(document),
            surfaceId: "gallery",
        });

        // Gallery itself is the page the widget is on, and is left out rather than marked.
        expect(describePages(options)).toEqual([`Host (disabled) ${LEADS_BACK}`, "Credits"]);
    });

    it("keeps a target that already leads back selectable, and says what is wrong with it", () => {
        const document = project("host");
        const adapter = createComponentDocumentServiceAdapter(service(document), "card");
        const view = adapter.getDocument();

        const options = pickerFor({
            element: view.elements.window!,
            elements: [view.elements.window!],
            documentService: adapter,
            surfaceId: getComponentEditorSurfaceId("card"),
        });

        expect(describePages(options)).toEqual([`Host ${LEADS_BACK}`, "Gallery", "Credits"]);
    });
});
