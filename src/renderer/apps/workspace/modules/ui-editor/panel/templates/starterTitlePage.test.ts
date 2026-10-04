/**
 * The title page a project with no interface is offered, lifted out of the shipped starter template.
 *
 * Read off the shipped files in each language the template is written in, because the page is taken
 * from the template at the moment an author asks for it: whatever the template's title page has
 * become, this is what an author receives. These assertions are the contract that survives a redraw
 * of that page - Start begins the receiving project's story, Continue loads, nothing on it leads to
 * a screen that did not come along, and the page checks clean in a project that holds nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectBrandLinkReferences } from "@shared/brand/brandReferences";
import { BrandPalette } from "@shared/brand/brandRegistry";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { anchorElementId } from "@shared/blueprint/ownerShape";
import { BUILTIN_BRAND_COLORS, normalizeProjectBrandColors, type BrandColor } from "@shared/types/brand";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
    BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LATEST,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
} from "@shared/types/blueprint/graph";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { createTestLintContext, LINT_RULES, runLintRules } from "@/lib/lint";
import { collectBrokenBrandLinks } from "@/lib/lint/rules/brand";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { createEmptyStoryDocument } from "@/lib/workspace/services/story/storyModel";
import {
    brandColorsToAdopt,
    hasNoInterfaceYet,
    liftStarterTitlePage,
    type LiftedTitlePage,
    type StarterStartTarget,
} from "./starterTitlePage";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");

const LANGUAGES = [
    { name: "English", variant: null, sourceLocale: "en" },
    { name: "Chinese", variant: "content.zh", sourceLocale: "zh-CN" },
    { name: "Japanese", variant: "content.ja", sourceLocale: "ja" },
] as const;

/** The file a project made in this language ends up with: the variant's copy when it has one. */
function landed(variant: string | null, relative: string): string {
    const override = variant ? path.join(TEMPLATE, variant, relative) : null;
    return override && fs.existsSync(override) ? override : path.join(TEMPLATE, "content", relative);
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function readTemplate(variant: string | null) {
    return {
        document: readJson<UIDocument>(landed(variant, "editor/ui/uidoc.json")),
        blueprints: migrateBlueprintDocumentToLatest(
            readJson<{ blueprintDocument: unknown }>(landed(variant, "editor/ui/uigraphs.json")).blueprintDocument,
        ),
        palette: normalizeProjectBrandColors(readJson<{ colors: unknown }>(landed(variant, "editor/brand.json")).colors),
    };
}

/** A story the receiving project has: one chapter, one scene, the way New Story makes one. */
const story = createEmptyStoryDocument({
    id: "6b0f5a9e-2d4c-4e1a-9c3b-7f2e1d0a4b5c",
    name: "Story",
    now: "2026-10-03T00:00:00.000Z",
    generateId: (() => {
        let next = 0;
        return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
    })(),
});
const target: StarterStartTarget = { storyId: story.id, sceneId: story.entrySceneId! };

function graphsOf(blueprint: BlueprintDocument["blueprints"][string]): BlueprintGraphIr[] {
    return Object.values(blueprint.graphs.events ?? {}).flatMap(layer => (layer.graph ? [layer.graph] : []));
}

/** The kept element whose own blueprint holds a node of `type`, and that node. */
function controlRunning(lifted: LiftedTitlePage, type: string) {
    const blueprints = lifted.payload.graphs.blueprintDocument;
    for (const blueprint of Object.values(blueprints.blueprints)) {
        for (const graph of graphsOf(blueprint)) {
            const node = Object.values(graph.nodes ?? {}).find(candidate => candidate.type === type);
            const elementId = anchorElementId(blueprint.owner);
            if (node && elementId) {
                return { element: lifted.payload.document.elements[elementId], node };
            }
        }
    }
    return null;
}

describe.each(LANGUAGES)("the starter title page, in $name", language => {
    const lift = () => {
        const template = readTemplate(language.variant);
        const lifted = liftStarterTitlePage({ document: template.document, blueprints: template.blueprints, startTarget: target });
        expect(lifted).not.toBeNull();
        return { template, lifted: lifted! };
    };

    it("is the template's own title page, with its name and its settings", () => {
        const { template, lifted } = lift();
        const [page] = lifted.payload.document.surfaces;
        const shipped = template.document.surfaces.find(surface => surface.id === page.id)!;
        expect(page.kind).toBe("appSurface");
        expect(page.name).toBe(shipped.name);
        expect(page.settings).toEqual(shipped.settings);
    });

    it("starts the receiving project's story at its entry scene", () => {
        const { lifted } = lift();
        const start = controlRunning(lifted, BLUEPRINT_NODE_TYPE_GAME_START_STORY);
        expect(start?.element.type).toBe("nl.button");
        expect(start?.node.params).toMatchObject({ storyId: target.storyId, sceneId: target.sceneId });
    });

    it("continues from the latest save, as the template's own Continue does", () => {
        const { lifted } = lift();
        const latest = controlRunning(lifted, BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LATEST);
        const load = controlRunning(lifted, BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD);
        expect(latest?.element.type).toBe("nl.button");
        expect(load?.element.id).toBe(latest?.element.id);
    });

    it("keeps what Continue does on this page, and drops only the step that opened another one", () => {
        const { lifted } = lift();
        const latest = controlRunning(lifted, BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LATEST)!;
        const blueprint = Object.values(lifted.payload.graphs.blueprintDocument.blueprints)
            .find(candidate => anchorElementId(candidate.owner) === latest.element.id)!;
        const nodes = graphsOf(blueprint).flatMap(graph => Object.values(graph.nodes ?? {}));
        expect(nodes.some(node => node.type === BLUEPRINT_NODE_TYPE_PAGE_GO)).toBe(false);
        // The note described the graph before the cut, so it does not come.
        expect(nodes.some(node => node.type === BLUEPRINT_NODE_TYPE_FLOW_COMMENT)).toBe(false);
        const edges = graphsOf(blueprint).flatMap(graph => graph.edges ?? []);
        const load = nodes.find(node => node.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD)!;
        // The latest auto save's id still reaches the load.
        expect(edges.some(edge => edge.from.nodeId === latest.node.id && edge.to.nodeId === load.id && edge.to.port === "id")).toBe(true);
    });

    it("leaves behind every control that leads to a screen that did not come along", () => {
        const { template, lifted } = lift();
        const [page] = lifted.payload.document.surfaces;
        const otherPages = new Set(template.document.surfaces.map(surface => surface.id).filter(id => id !== page.id));
        const serialized = JSON.stringify(lifted.payload);
        for (const id of otherPages) {
            expect(serialized).not.toContain(id);
        }
        // What stays is the page itself, Start, Continue, and what draws the page.
        const buttons = Object.values(lifted.payload.document.elements).filter(element => element.type === "nl.button");
        expect(buttons).toHaveLength(2);
    });

    it("carries no plugin node and no plugin widget", () => {
        const { lifted } = lift();
        for (const blueprint of Object.values(lifted.payload.graphs.blueprintDocument.blueprints)) {
            for (const graph of graphsOf(blueprint)) {
                for (const node of Object.values(graph.nodes ?? {})) {
                    expect(blueprintNodeRegistry.isBuiltIn(node.type), node.type).toBe(true);
                }
            }
        }
        for (const element of Object.values(lifted.payload.document.elements)) {
            expect(element.type.startsWith("nl."), element.type).toBe(true);
        }
    });

    it("keeps its words on the widgets, in the project's language, translatable like typed text", () => {
        const { lifted } = lift();
        for (const element of Object.values(lifted.payload.document.elements)) {
            const props = (element.props ?? {}) as Record<string, unknown>;
            expect(props.localizationKey).toBeUndefined();
            if (element.type === "nl.button") {
                expect(String(props.label ?? "").trim()).not.toBe("");
            }
        }
    });

    it("names only files the template ships", () => {
        const { lifted } = lift();
        expect(lifted.assetIds.length).toBeGreaterThan(0);
        for (const assetId of lifted.assetIds) {
            expect(fs.existsSync(path.join(TEMPLATE, "content", "assets", "content", ...splitAssetStorageId(assetId))), assetId)
                .toBe(true);
        }
    });

    it("paints in a project with the default palette once the colours it names are taken", () => {
        const { template, lifted } = lift();
        const adopted = brandColorsToAdopt(
            lifted.brandColorIds,
            template.palette,
            id => BUILTIN_BRAND_COLORS.some(color => color.id === id),
        );
        const palette = new BrandPalette([...BUILTIN_BRAND_COLORS, ...adopted]);
        const references = collectBrandLinkReferences({ uidoc: lifted.payload.document });
        expect(references.length).toBeGreaterThan(0);
        expect(collectBrokenBrandLinks(references, palette)).toEqual([]);
        // And it would not have without them: the check above can fail.
        if (adopted.length > 0) {
            expect(collectBrokenBrandLinks(references, new BrandPalette(BUILTIN_BRAND_COLORS)).length).toBeGreaterThan(0);
        }
    });

    it("checks clean in a project that holds nothing but it and a story", async () => {
        const { lifted } = lift();
        const [page] = lifted.payload.document.surfaces;
        const context = createTestLintContext({
            uiDocument: { ...lifted.payload.document, entrySurfaceId: page.id },
            blueprintDocument: lifted.payload.graphs.blueprintDocument,
            stories: [{ id: story.id, name: story.name, document: story }],
            localization: { sourceLocale: language.sourceLocale, targetLocales: [language.sourceLocale], documents: new Map() },
        });
        const report = await runLintRules(context, {
            rules: LINT_RULES.filter(rule => rule.category === "ui" || rule.category === "blueprint" || rule.category === "variables"),
        });
        expect(report.entries.map(entry => `${entry.ruleId} ${JSON.stringify(entry.location)}`)).toEqual([]);
    });

    it("leaves the template's documents as it found them", () => {
        const template = readTemplate(language.variant);
        const before = JSON.stringify({ document: template.document, blueprints: template.blueprints });
        liftStarterTitlePage({ document: template.document, blueprints: template.blueprints, startTarget: target });
        expect(JSON.stringify({ document: template.document, blueprints: template.blueprints })).toBe(before);
    });
});

describe("brandColorsToAdopt", () => {
    const colors: BrandColor[] = [
        { id: "surface.sunken", name: "Page background", value: "#0A090D" },
        { id: "border.strong", name: "Selected border", value: "nlbrand:surface.raised/0.7" },
        { id: "surface.raised", name: "Panel", value: "#15171D" },
    ];

    it("takes what is missing and what a taken entry links to, in the template's order", () => {
        expect(brandColorsToAdopt(["border.strong", "primary"], colors, id => id === "primary").map(color => color.id))
            .toEqual(["border.strong", "surface.raised"]);
    });

    it("never replaces an entry the project already has", () => {
        expect(brandColorsToAdopt(["surface.sunken"], colors, () => true)).toEqual([]);
    });
});

describe("hasNoInterfaceYet", () => {
    const blank: UIDocument = {
        schemaVersion: 12,
        id: "doc",
        name: "UI Document",
        surfaces: [{ id: "page", name: "Main Page", host: "app", kind: "appSurface", designSize: { width: 1920, height: 1080 }, rootElementId: "root" }],
        components: [],
        elements: {
            root: { id: "root", type: "nl.root", name: "Root", parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 1920, height: 1080, visible: true, opacity: 1 } },
        },
        meta: {},
    } as UIDocument;

    it("holds for the page a blank project is created with", () => {
        expect(hasNoInterfaceYet(blank, null)).toBe(true);
    });

    it("stops holding once a page has an element, or logic", () => {
        const withChild = structuredClone(blank);
        withChild.elements.root.childrenIds = ["text"];
        expect(hasNoInterfaceYet(withChild, null)).toBe(false);

        const withLogic: BlueprintDocument = {
            schemaVersion: 14,
            ownerRecords: {},
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Main Page",
                    owner: { kind: "surfaceMain", surfaceId: "page" },
                    graphs: { events: { layer: { id: "layer", graph: { nodes: { n: { id: "n", type: "blueprint.event.head.init" } }, edges: [] } } }, functions: {}, macros: {} },
                },
            },
        } as unknown as BlueprintDocument;
        expect(hasNoInterfaceYet(blank, withLogic)).toBe(false);
    });
});

describe("a title page that places library components", () => {
    const pageId = "page-title";
    const otherPageId = "page-settings";
    const element = (id: string, type: string, parentId: string | null, childrenIds: string[] = [], extra?: Record<string, unknown>) => ({
        id,
        type,
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 10, height: 10, visible: true, opacity: 1 },
        props: {},
        ...(extra ? { extra } : {}),
    });
    const graphOf = (
        nodes: Record<string, { type: string; params?: Record<string, unknown> }>,
        edges: [string, string, string, string][],
    ) => ({
        events: {
            layer: {
                id: "layer",
                graph: {
                    nodes: Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { id, ...node }])),
                    edges: edges.map(([from, fromPort, to, toPort]) => ({ from: { nodeId: from, port: fromPort }, to: { nodeId: to, port: toPort } })),
                },
            },
        },
        eventIds: ["layer"],
        functions: {},
        macros: {},
    });
    const click = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK };
    const linkTo = (componentId: string) => ({ componentLink: { componentId, linked: true } });

    function template() {
        const document = {
            schemaVersion: 12,
            id: "doc",
            name: "UI Document",
            surfaces: [
                { id: pageId, name: "Title", host: "app", kind: "appSurface", designSize: { width: 100, height: 100 }, rootElementId: "root" },
                { id: otherPageId, name: "Settings", host: "app", kind: "appSurface", designSize: { width: 100, height: 100 }, rootElementId: "root2" },
            ],
            elements: {
                root: element("root", "nl.root", null, ["start", "continue", "logs", "leaves"]),
                start: element("start", "nl.button", "root"),
                continue: element("continue", "nl.button", "root"),
                logs: element("logs", "nl.container", "root", [], linkTo("comp-logs")),
                leaves: element("leaves", "nl.container", "root", [], linkTo("comp-leaves")),
                root2: element("root2", "nl.root", null),
            },
            components: [
                { id: "comp-logs", name: "Logs", rootElementId: "c1", elements: { c1: element("c1", "nl.button", null) } },
                { id: "comp-leaves", name: "Leaves", rootElementId: "c2", elements: { c2: element("c2", "nl.button", null) } },
                { id: "comp-unused", name: "Unused", rootElementId: "c3", elements: { c3: element("c3", "nl.button", null) } },
            ],
            meta: {},
        } as unknown as UIDocument;
        const blueprint = (id: string, owner: Record<string, string>, graphs: ReturnType<typeof graphOf>) => ({ id, name: id, owner, graphs });
        const blueprints = {
            schemaVersion: 14,
            blueprints: {
                bpStart: blueprint("bpStart", { kind: "widgetMain", surfaceId: pageId, elementId: "start" }, graphOf(
                    { h: click, s: { type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params: { storyId: "story-x", sceneId: "scene-x" } } },
                    [["h", "then", "s", "in"]],
                )),
                bpContinue: blueprint("bpContinue", { kind: "widgetMain", surfaceId: pageId, elementId: "continue" }, graphOf(
                    { h: click, l: { type: BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD } },
                    [["h", "then", "l", "in"]],
                )),
                bpLogs: blueprint("bpLogs", { kind: "componentWidgetMain", componentId: "comp-logs", elementId: "c1" }, graphOf(
                    { h: click, log: { type: BLUEPRINT_NODE_TYPE_LOG, params: { value: "hi" } } },
                    [["h", "then", "log", "in"]],
                )),
                bpLeaves: blueprint("bpLeaves", { kind: "componentWidgetMain", componentId: "comp-leaves", elementId: "c2" }, graphOf(
                    { h: click, go: { type: BLUEPRINT_NODE_TYPE_PAGE_GO, params: { surfaceId: otherPageId } } },
                    [["h", "then", "go", "in"]],
                )),
            },
            ownerRecords: {
                [encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: pageId, elementId: "start" })]: { blueprintId: "bpStart" },
                [encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: pageId, elementId: "continue" })]: { blueprintId: "bpContinue" },
                "componentWidgetMain:comp-logs:c1": { blueprintId: "bpLogs" },
                "componentWidgetMain:comp-leaves:c2": { blueprintId: "bpLeaves" },
            },
        } as unknown as BlueprintDocument;
        return { document, blueprints };
    }

    it("brings the definitions it places, with their blueprints, so no instance names a component the project lacks", () => {
        const lifted = liftStarterTitlePage({ ...template(), startTarget: target })!;
        expect((lifted.payload.document.components ?? []).map(component => component.id)).toEqual(["comp-logs"]);
        expect(lifted.payload.document.elements.logs).toBeDefined();
        expect(Object.values(lifted.payload.graphs.blueprintDocument.blueprints).map(blueprint => blueprint.id).sort())
            .toEqual(["bpContinue", "bpLogs", "bpStart"]);
        expect(lifted.payload.graphs.blueprintDocument.ownerRecords["componentWidgetMain:comp-logs:c1"]).toEqual({ blueprintId: "bpLogs" });
    });

    it("leaves behind a component whose logic only led to another page, and every instance of it", () => {
        const lifted = liftStarterTitlePage({ ...template(), startTarget: target })!;
        expect(lifted.payload.document.elements.leaves).toBeUndefined();
        expect(lifted.payload.document.elements.root.childrenIds).toEqual(["start", "continue", "logs"]);
        expect(JSON.stringify(lifted.payload)).not.toContain(otherPageId);
    });
});
