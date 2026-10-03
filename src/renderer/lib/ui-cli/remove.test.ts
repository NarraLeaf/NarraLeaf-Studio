/**
 * `ui remove`: what it takes out of a project with a component definition, and what stops it.
 *
 * The cases are built by hand, one per thing that can still point at a definition, because the
 * shipped skeleton no longer holds a definition nothing uses - which is asserted at the bottom, against
 * the real thing, so a dead one cannot be shipped again without this file saying so.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
} from "@shared/types/ui-editor/document";
import { runCli } from "./cli";
import { planComponentRemoval, removeComponentDefinition } from "./remove";

const UNUSED = "c0ffee00-0000-4000-8000-000000000001";
const UNUSED_ROOT = "c0ffee00-0000-4000-8000-000000000011";
const UNUSED_LABEL = "c0ffee00-0000-4000-8000-000000000012";
const CARD = "c0ffee00-0000-4000-8000-000000000002";
const CARD_ROOT = "c0ffee00-0000-4000-8000-000000000021";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = [], extra?: Record<string, unknown>): UIElement {
    return { id, type, name: id.slice(-4), parentId, childrenIds, layout: { x: 0, y: 0, width: 10, height: 10 }, ...(extra ? { extra } : {}) };
}

function component(id: string, name: string, rootId: string, children: UIElement[] = []): UIComponentDefinition {
    const root = element(rootId, "nl.container", null, children.map(child => child.id));
    return { id, name, rootElementId: rootId, elements: Object.fromEntries([root, ...children].map(item => [item.id, item])) };
}

/** A page with one button, the definition under test (a container and a label), and a second definition. */
function makeDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{
            id: "page",
            name: "Title",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1920, height: 1080 },
            rootElementId: "page-root",
        }],
        elements: {
            "page-root": element("page-root", "nl.root", null, ["page-button"]),
            "page-button": element("page-button", "nl.button", "page-root"),
        },
        components: [
            component(UNUSED, "Old entry", UNUSED_ROOT, [element(UNUSED_LABEL, "nl.text", UNUSED_ROOT)]),
            component(CARD, "Card", CARD_ROOT),
        ],
    };
}

function blueprint(id: string, owner: Blueprint["owner"], nodes: Record<string, { id: string; type: string; params?: Record<string, unknown> }> = {}): Blueprint {
    const layers = Object.keys(nodes).length > 0 ? { layer: { id: "layer", graph: { nodes, edges: [] } } } : {};
    return {
        id,
        name: id,
        owner,
        graphs: { eventIds: Object.keys(layers), events: layers, functionIds: [], functions: {} },
        members: { variables: {}, fields: {}, functions: {} },
    } as Blueprint;
}

/** One empty blueprint per element of both definitions, each with its owner entry, and the page button's. */
function makeBlueprints(): BlueprintDocument {
    const owners: Blueprint["owner"][] = [
        { kind: "componentWidgetMain", componentId: UNUSED, elementId: UNUSED_ROOT },
        { kind: "componentWidgetMain", componentId: UNUSED, elementId: UNUSED_LABEL },
        { kind: "componentWidgetMain", componentId: CARD, elementId: CARD_ROOT },
        { kind: "widgetMain", surfaceId: "page", elementId: "page-button" },
    ];
    const document: BlueprintDocument = { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {} };
    owners.forEach((owner, index) => {
        const id = `bp-${index}`;
        document.blueprints[id] = blueprint(id, owner);
        document.ownerRecords[encodeBlueprintOwnerKey(owner)] = { blueprintId: id };
    });
    return document;
}

function plan(document: UIDocument, blueprints: BlueprintDocument, files: { path: string; text: string }[] = []) {
    const target = document.components!.find(item => item.id === UNUSED)!;
    return planComponentRemoval({ document, blueprints, component: target, files });
}

describe("planComponentRemoval", () => {
    it("takes an unused definition with its elements, its empty blueprints and their owner entries, and nothing else", () => {
        const document = makeDocument();
        const blueprints = makeBlueprints();
        const result = plan(document, blueprints);
        expect(result.refusals).toEqual([]);
        expect(result.elementCount).toBe(2);
        expect(result.blueprints.map(item => item.id).sort()).toEqual(["bp-0", "bp-1"]);
        expect(result.ownerKeys).toHaveLength(2);

        removeComponentDefinition(document, blueprints, result);
        expect(document.components!.map(item => item.id)).toEqual([CARD]);
        expect(Object.keys(blueprints.blueprints).sort()).toEqual(["bp-2", "bp-3"]);
        expect(Object.values(blueprints.ownerRecords).map(record => record.blueprintId).sort()).toEqual(["bp-2", "bp-3"]);
        expect(Object.keys(document.elements)).toEqual(["page-root", "page-button"]);
    });

    it("refuses a definition placed on a page, and says where", () => {
        const document = makeDocument();
        document.elements["page-root"].childrenIds.push("placed");
        document.elements.placed = element("placed", "nl.container", "page-root", [], {
            componentLink: { componentId: UNUSED, linked: true },
        });
        const result = plan(document, makeBlueprints());
        // Elements here are named after the last four characters of their ids.
        expect(result.refusals).toEqual(['It is placed on "Title" as root / aced.']);
    });

    it("refuses a definition placed inside another definition, and names that one", () => {
        const document = makeDocument();
        const card = document.components!.find(item => item.id === CARD)!;
        card.elements[CARD_ROOT].childrenIds.push("nested");
        card.elements.nested = element("nested", "nl.container", CARD_ROOT, [], {
            componentLink: { componentId: UNUSED, linked: true, params: {} },
        });
        const result = plan(document, makeBlueprints());
        expect(result.refusals).toHaveLength(1);
        expect(result.refusals[0]).toContain('inside the component "Card"');
    });

    it("refuses while one of its own blueprints holds work, and takes it once that is emptied", () => {
        const document = makeDocument();
        const blueprints = makeBlueprints();
        blueprints.blueprints["bp-1"] = blueprint("bp-1", blueprints.blueprints["bp-1"].owner, {
            log: { id: "log", type: "blueprint.debug.log" },
        });
        const refused = plan(document, blueprints);
        expect(refused.refusals).toEqual([
            'Its blueprint "bp-1" is not empty: it holds 1 node(s). Empty it with `blueprint apply`, or take it out with `blueprint remove`, first if that work is meant to go.',
        ]);

        blueprints.blueprints["bp-1"] = blueprint("bp-1", blueprints.blueprints["bp-1"].owner);
        expect(plan(document, blueprints).refusals).toEqual([]);
    });

    it("refuses while another blueprint points into it, and names the node", () => {
        const blueprints = makeBlueprints();
        blueprints.blueprints["bp-3"] = blueprint("bp-3", blueprints.blueprints["bp-3"].owner, {
            label: { id: "label", type: "blueprint.element.ref", params: { surfaceId: `component:${UNUSED}`, elementId: UNUSED_LABEL } },
        });
        expect(plan(makeDocument(), blueprints).refusals).toEqual(['The blueprint "bp-3" names it, in "label".']);
    });

    it("refuses while another file of the project names it", () => {
        const result = plan(makeDocument(), makeBlueprints(), [
            { path: "scripts/menu.ts", text: `const entry = "${UNUSED_LABEL}";` },
            { path: "editor/story/index.json", text: "{}" },
        ]);
        expect(result.refusals).toEqual(["scripts/menu.ts names it."]);
    });

    it("also collects an owner entry for one of its elements whose blueprint is already gone", () => {
        const blueprints = makeBlueprints();
        delete blueprints.blueprints["bp-1"];
        const result = plan(makeDocument(), blueprints);
        expect(result.refusals).toEqual([]);
        expect(result.blueprints.map(item => item.id)).toEqual(["bp-0"]);
        expect(result.ownerKeys).toHaveLength(2);
    });
});

describe("ui remove", () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    function makeProject(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-ui-cli-remove-"));
        dirs.push(dir);
        fs.mkdirSync(path.join(dir, "editor", "ui"), { recursive: true });
        fs.writeFileSync(path.join(dir, "editor", "ui", "uidoc.json"), JSON.stringify(makeDocument(), null, 2));
        fs.writeFileSync(path.join(dir, "editor", "ui", "uigraphs.json"), JSON.stringify({ blueprintDocument: makeBlueprints() }, null, 2));
        return dir;
    }

    function run(...argv: string[]): { code: number; out: string; err: string } {
        const out: string[] = [];
        const err: string[] = [];
        const code = runCli(argv, { out: text => out.push(text), err: text => err.push(text) });
        return { code, out: out.join("\n"), err: err.join("\n") };
    }

    const read = (dir: string, file: string) => JSON.parse(fs.readFileSync(path.join(dir, "editor", "ui", file), "utf8"));

    it("writes nothing without --write", () => {
        const dir = makeProject();
        const before = fs.readFileSync(path.join(dir, "editor", "ui", "uidoc.json"), "utf8");
        const result = run("remove", "--component", "Old entry", "--project", dir);
        expect(result.code).toBe(0);
        expect(result.out).toContain('Would remove the component "Old entry"');
        expect(fs.readFileSync(path.join(dir, "editor", "ui", "uidoc.json"), "utf8")).toBe(before);
    });

    it("takes the definition out of both documents with --write", () => {
        const dir = makeProject();
        const result = run("remove", "--component", UNUSED, "--project", dir, "--write");
        expect(result.code).toBe(0);
        expect(read(dir, "uidoc.json").components.map((item: { id: string }) => item.id)).toEqual([CARD]);
        expect(Object.keys(read(dir, "uigraphs.json").blueprintDocument.blueprints).sort()).toEqual(["bp-2", "bp-3"]);
    });

    it("stops on a refusal with the reasons, and writes nothing", () => {
        const dir = makeProject();
        fs.mkdirSync(path.join(dir, "scripts", ".narraleaf"), { recursive: true });
        // A generated declaration is Studio's, not the author's, and is not what stops a removal.
        fs.writeFileSync(path.join(dir, "scripts", ".narraleaf", "studio.d.ts"), `// ${UNUSED}`);
        fs.writeFileSync(path.join(dir, "scripts", "menu.ts"), `export const entry = "${UNUSED}";`);
        const before = fs.readFileSync(path.join(dir, "editor", "ui", "uigraphs.json"), "utf8");
        const result = run("remove", "--component", "Old entry", "--project", dir, "--write");
        expect(result.code).toBe(1);
        expect(result.err).toContain("ui.remove_refused  scripts/menu.ts names it.");
        expect(result.err).not.toContain(".narraleaf");
        expect(result.err).toContain("Nothing was written.");
        expect(fs.readFileSync(path.join(dir, "editor", "ui", "uigraphs.json"), "utf8")).toBe(before);
    });

    it("names a definition exactly, and lists the candidates when a name is shared", () => {
        const dir = makeProject();
        expect(run("remove", "--component", "Old", "--project", dir).code).toBe(2);
        const document = read(dir, "uidoc.json");
        document.components[1].name = "Old entry";
        fs.writeFileSync(path.join(dir, "editor", "ui", "uidoc.json"), JSON.stringify(document));
        const shared = run("remove", "--component", "Old entry", "--project", dir);
        expect(shared.code).toBe(2);
        expect(shared.err).toContain(UNUSED);
        expect(shared.err).toContain(CARD);
    });

    it("asks which definition when none is named", () => {
        expect(run("remove", "--project", makeProject()).code).toBe(2);
    });
});

describe("the shipped skeleton", () => {
    const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content/editor/ui");

    it("holds no component definition that nothing uses", () => {
        const document = JSON.parse(fs.readFileSync(path.join(SKELETON, "uidoc.json"), "utf8")) as UIDocument;
        const blueprints = JSON.parse(fs.readFileSync(path.join(SKELETON, "uigraphs.json"), "utf8"))
            .blueprintDocument as BlueprintDocument;
        // Every definition is placed somewhere or carries a graph of its own. One that does neither is
        // a library entry an author opening the template has to work out is dead - remove it with
        // `ui remove` rather than shipping it.
        const removable = (document.components ?? [])
            .filter(item => planComponentRemoval({ document, blueprints, component: item }).refusals.length === 0)
            .map(item => item.name);
        expect(removable).toEqual([]);
    });
});
