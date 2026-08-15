/**
 * Every value binding in the shipped starter template reads from the blueprint that answers for it.
 *
 * A binding and its blueprint are held together by an id and nothing else: the element records which
 * blueprint it reads, and the blueprint records the element and prop path it answers for. Both halves
 * have to agree, and nothing on the authoring path makes them agree - a page copied from another page
 * keeps the ids it was copied with.
 *
 * The reason this is worth its own sweep is that the obvious way to test a bound value cannot see the
 * mistake. Assertions written per page start from the element and ask which blueprint claims to own
 * it; that finds the right blueprint whatever the element stores, so an element reading some other
 * page's blueprint passes while showing nothing on screen. This goes the other way - from the id the
 * element really stores back to its owner - and over the whole document rather than one page, because
 * a copied id is not a thing that happens on only one surface.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";

function readTemplate(file: string): unknown {
    return JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "resources/templates/skeleton/content/editor/ui", file), "utf-8"),
    );
}

const document = readTemplate("uidoc.json") as UIDocument;
const blueprints = (readTemplate("uigraphs.json") as { blueprintDocument: BlueprintDocument }).blueprintDocument
    .blueprints;

/** One bound value, carrying enough of where it came from that a failure names something openable. */
type BoundValue = { scope: string; element: UIElement; propPath: string; blueprintId: string };

/**
 * Elements live in two places - the document's own map and each component's - and both may bind.
 * Component elements have no owner shape that could match today, which is the point of sweeping
 * them: a binding written there is unreachable, and this is what would say so.
 */
const scopes: { label: string; elements: Record<string, UIElement> }[] = [
    { label: "document", elements: document.elements },
    ...(document.components ?? []).map(component => ({
        label: `component ${component.name}`,
        elements: component.elements,
    })),
];

const boundValues: BoundValue[] = scopes.flatMap(scope =>
    Object.values(scope.elements).flatMap(element =>
        Object.entries(element.valueBindings ?? {}).map(([propPath, binding]) => ({
            scope: scope.label,
            element,
            propPath,
            blueprintId: binding.blueprintId,
        })),
    ),
);

const describeBound = (bound: BoundValue) =>
    `${bound.scope}: ${bound.element.type} ${bound.element.id} .${bound.propPath}`;

describe("value bindings in the starter template", () => {
    it("has bindings to sweep at all", () => {
        // A sweep over an empty list passes for free, which reads exactly like a sweep that works.
        expect(boundValues.length).toBeGreaterThan(0);
    });

    it("points each one at a blueprint owned by that element and that prop path", () => {
        const wrong = boundValues.flatMap(bound => {
            const blueprint: Blueprint | undefined = blueprints[bound.blueprintId];
            const owner = blueprint?.owner;
            if (
                owner?.kind === "widgetValue" &&
                owner.elementId === bound.element.id &&
                owner.propPath === bound.propPath
            ) {
                return [];
            }
            return [
                `${describeBound(bound)} reads ${bound.blueprintId}, which ${
                    blueprint ? `answers for ${JSON.stringify(owner)}` : "is not in the document"
                }`,
            ];
        });
        expect(wrong).toEqual([]);
    });

    it("leaves no value blueprint that nothing reads", () => {
        const read = new Set(boundValues.map(bound => bound.blueprintId));
        // The same mistake seen from the other side: rewiring an element to the wrong id strands the
        // blueprint drawn for it, which stays correct and unreachable and costs nothing to notice.
        const stranded = Object.values(blueprints)
            .filter(blueprint => blueprint.owner.kind === "widgetValue" && !read.has(blueprint.id))
            .map(blueprint => `${blueprint.id} answers for ${JSON.stringify(blueprint.owner)}`);
        expect(stranded).toEqual([]);
    });
});
