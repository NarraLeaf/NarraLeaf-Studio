/**
 * A page's rail entry for the page it is on.
 *
 * The Save, Load and Config pages list themselves on their own rail, drawn as where the player is:
 * the bright label with the Active bar beside it. That entry used to be a button wired to `Go Page`
 * naming its own page, so pressing it put a second copy of the page on top of the first and Back
 * had to be pressed twice to leave. It is a text now - same place, same words, same look - and a
 * text is not something a player can press: no pointer, no hover or click sound, no blueprint.
 *
 * Swept rather than named: no blueprint on any page's elements may open the page it is on, which
 * is the defect itself, and holds for the pages without such an entry (Log) as well.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLUEPRINT_NODE_TYPE_PAGE_GO } from "@shared/types/blueprint/graph";
import { readUIInteractionSoundAssetId } from "@shared/types/ui-editor/interactionSounds";

type GraphNode = { id: string; type: string; params?: Record<string, unknown> };
type Graph = { nodes: Record<string, GraphNode> };
type Blueprint = {
    owner: { kind: string; surfaceId?: string; elementId?: string };
    graphs: { events: Record<string, { graph: Graph }> };
};
type Element = {
    id: string;
    name: string;
    type: string;
    parentId?: string | null;
    childrenIds?: string[];
    props?: Record<string, unknown>;
};
type Surface = { id: string; name: string; rootElementId: string };
type UIDoc = { surfaces: Surface[]; elements: Record<string, Element> };

const VARIANTS = ["content", "content.zh", "content.ja"] as const;

function readTemplate(variant: string, file: string): unknown {
    return JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "resources/templates/skeleton", variant, "editor/ui", file), "utf-8"),
    );
}

/** Every element of a surface, root included. */
function elementsOf(document: UIDoc, surface: Surface): Element[] {
    const out: Element[] = [];
    const walk = (id: string): void => {
        const element = document.elements[id];
        if (!element) {
            return;
        }
        out.push(element);
        for (const child of element.childrenIds ?? []) {
            walk(child);
        }
    };
    walk(surface.rootElementId);
    return out;
}

/** The pages whose rail lists the page itself, by the English name and the key its entry reads. */
const PAGES_WITH_OWN_ENTRY = [
    { page: "Save", key: "nav.save" },
    { page: "Load", key: "nav.load" },
    { page: "Config", key: "nav.config" },
];

describe.each(VARIANTS)("the starter's rails (%s)", variant => {
    const document = readTemplate(variant, "uidoc.json") as UIDoc;
    const english = readTemplate("content", "uidoc.json") as UIDoc;
    const blueprints = Object.values(
        (readTemplate(variant, "uigraphs.json") as { blueprintDocument: { blueprints: Record<string, Blueprint> } })
            .blueprintDocument.blueprints,
    );

    it.each(PAGES_WITH_OWN_ENTRY)("$page lists itself as a label, not as something to press", ({ page, key }) => {
        // Found through the English document, whose names are the ones the test is written in; the
        // ids are the same in every variant.
        const surfaceId = english.surfaces.find(surface => surface.name === page)!.id;
        const surface = document.surfaces.find(candidate => candidate.id === surfaceId)!;
        const entries = elementsOf(document, surface).filter(element => element.props?.localizationKey === key);
        expect(entries, `${page} has ${entries.length} elements reading ${key}`).toHaveLength(1);
        const entry = entries[0]!;
        expect(entry.type).toBe("nl.text");
        expect(document.elements[entry.parentId ?? ""]?.type, "the entry sits on the rail").toBe("nl.container");
        expect(readUIInteractionSoundAssetId(entry, "click")).toBeNull();
        expect(readUIInteractionSoundAssetId(entry, "hover")).toBeNull();
        const owned = blueprints.filter(
            blueprint => blueprint.owner.kind === "widgetMain" && blueprint.owner.elementId === entry.id,
        );
        expect(owned, `${page}'s own entry still has a blueprint`).toHaveLength(0);
    });

    it("has no element that opens the page it is on", () => {
        for (const surface of document.surfaces) {
            const ids = new Set(elementsOf(document, surface).map(element => element.id));
            for (const blueprint of blueprints) {
                if (blueprint.owner.kind !== "widgetMain" || !ids.has(blueprint.owner.elementId ?? "")) {
                    continue;
                }
                for (const layer of Object.values(blueprint.graphs.events)) {
                    for (const node of Object.values(layer.graph.nodes)) {
                        if (node.type === BLUEPRINT_NODE_TYPE_PAGE_GO) {
                            expect(node.params?.surfaceId, `${surface.name} opens itself`).not.toBe(surface.id);
                        }
                    }
                }
            }
        }
    });
});
