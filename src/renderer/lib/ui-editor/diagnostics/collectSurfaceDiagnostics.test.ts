import { describe, expect, it } from "vitest";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { collectSubtreeElements } from "./collectSubtreeElements";
import { collectSurfaceDiagnostics } from "./collectSurfaceDiagnostics";
import { collectScriptedElements } from "./scriptedElements";
import { sortSurfaceDiagnostics, summarizeDiagnostics, type UISurfaceDiagnostic } from "./types";

const surface: UISurface = {
    id: "page", name: "Page", host: "app", kind: "appSurface",
    designSize: { width: 500, height: 500 }, rootElementId: "root",
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return {
        id, type, name: id, parentId, childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 100, visible: true },
        props: {},
    };
}

function documentWith(elements: UIElement[], page: UISurface = surface): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION, id: "doc", name: "Doc", surfaces: [page],
        elements: Object.fromEntries(elements.map(el => [el.id, el])),
    } as UIDocument;
}

function blueprintsWithNamedElement(elementId: string, owned: boolean): BlueprintDocument {
    const owner = { kind: "surfaceMain", surfaceId: "page" } as const;
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        ownerRecords: owned ? { [encodeBlueprintOwnerKey(owner)]: { blueprintId: "bp" } } : {},
        blueprints: {
            bp: {
                id: "bp", name: "Page", owner,
                graphs: { events: { open: {
                    id: "open", name: "Open",
                    graph: { nodes: {
                        image: { id: "image", type: "blueprint.element.ref", params: { surfaceId: "page", elementId, elementType: "nl.image" } },
                    }, edges: [] },
                } }, functions: {} },
            },
        },
    } as unknown as BlueprintDocument;
}

describe("surface diagnostics", () => {
    it("reports a missing surface and ignores elements outside the surface subtree", () => {
        const root = element("root", "nl.root", null, ["image", "missing"]);
        const image = { ...element("image", "nl.image", "root"), props: { fillType: "image" } };
        const orphan = { ...element("orphan", "nl.image", null), props: { fillType: "image" } };
        const document = documentWith([root, image, orphan]);

        expect(collectSubtreeElements(document, "root").map(el => el.id)).toEqual(["root", "image"]);
        expect(collectSubtreeElements(document, "missing")).toEqual([]);
        expect(collectSurfaceDiagnostics(document, "missing")).toEqual([
            expect.objectContaining({ id: "surface:missing:missing", severity: "error", source: "layout" }),
        ]);
        expect(collectSurfaceDiagnostics(document, "page").map(d => d.id)).toEqual(["res:image:image"]);
    });

    it("uses only owned blueprints to recognise an image supplied at runtime", () => {
        const root = element("root", "nl.root", null, ["image"]);
        const image = { ...element("image", "nl.image", "root"), props: { fillType: "image" } };
        const document = documentWith([root, image]);
        const owned = blueprintsWithNamedElement("image", true);
        const unowned = blueprintsWithNamedElement("image", false);

        expect(collectScriptedElements(owned).named.has("image")).toBe(true);
        expect(collectScriptedElements(unowned).named.has("image")).toBe(false);
        expect(collectSurfaceDiagnostics(document, "page", { blueprintDocument: owned })).toEqual([]);
        expect(collectSurfaceDiagnostics(document, "page", { blueprintDocument: unowned }).map(d => d.id))
            .toEqual(["res:image:image"]);
    });

    it("looks up a component widget's owner using the component id", () => {
        const root = element("root", "nl.root", null, ["button"]);
        const button = { ...element("button", "nl.button", "root"), layout: { x: 0, y: 0, width: 10, height: 10, visible: false } };
        const document = documentWith([root, button]);
        const owner = { kind: "componentWidgetMain", componentId: "component", elementId: "button" } as const;
        const bp = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            ownerRecords: { [encodeBlueprintOwnerKey(owner)]: { blueprintId: "bp" } },
            blueprints: { bp: { id: "bp", name: "Button", owner, graphs: { events: { click: {
                id: "click", name: "Click",
                graph: { nodes: { head: { id: "head", type: "blueprint.event.head.mouseClick" } }, edges: [] },
            } }, functions: {} } } },
        } as unknown as BlueprintDocument;

        expect(collectSurfaceDiagnostics(document, "page", { blueprintDocument: bp })).toEqual([]);
        expect(collectSurfaceDiagnostics(document, "page", { blueprintDocument: bp, componentId: "component" }).map(d => d.id))
            .toEqual(["ix:hidden-events:button", "ix:small-hit:button"]);
    });

    it("sorts an invalid Game UI slot ahead of element warnings", () => {
        const stage = { ...surface, host: "player", kind: "stageSurface", mount: { kind: "slot", slotId: "invalid" } } as unknown as UISurface;
        const root = element("root", "nl.root", null, ["image"]);
        const image = { ...element("image", "nl.image", "root"), props: { fillType: "image" } };
        const findings = collectSurfaceDiagnostics(documentWith([root, image], stage), "page");

        expect(findings.map(d => [d.id, d.severity])).toEqual([
            ["game-ui:slot-invalid:page", "error"],
            ["res:image:image", "warning"],
        ]);
        expect(summarizeDiagnostics(findings)).toEqual({ errors: 1, warnings: 1 });

        const validStage = { ...stage, mount: { kind: "slot", slotId: "dialog" } } as UISurface;
        expect(collectSurfaceDiagnostics(documentWith([root, image], validStage), "page").map(d => d.id))
            .toEqual(["res:image:image"]);
    });

    it("adds the page blueprint's broken-binding summary to its findings", () => {
        const root = element("root", "nl.root", null);
        const bp = blueprintsWithNamedElement("image", true);
        const target = { kind: "widgetProp", surfaceId: "page", elementId: "image", propPath: "text" } as const;
        const source = { kind: "field", blueprintId: "bp", fieldId: "field" } as const;
        bp.blueprints.bp.bindings = {
            broken: { id: "broken", target, source, mode: "replace", status: "broken" },
            intact: { id: "intact", target, source, mode: "replace", status: "active" },
        };

        expect(collectSurfaceDiagnostics(documentWith([root]), "page", { blueprintDocument: bp }))
            .toEqual([expect.objectContaining({ id: "bp:broken:page", severity: "warning", source: "blueprint" })]);
    });

    it("sorts findings without mutating the caller's array and excludes info from counts", () => {
        const items: UISurfaceDiagnostic[] = [
            { id: "info", severity: "info", source: "layout", message: "info" },
            { id: "warning", severity: "warning", source: "resource", message: "warning" },
            { id: "error", severity: "error", source: "stage", message: "error" },
        ];
        expect(sortSurfaceDiagnostics(items).map(d => d.id)).toEqual(["error", "warning", "info"]);
        expect(items.map(d => d.id)).toEqual(["info", "warning", "error"]);
        expect(summarizeDiagnostics(items)).toEqual({ errors: 1, warnings: 1 });
    });
});
