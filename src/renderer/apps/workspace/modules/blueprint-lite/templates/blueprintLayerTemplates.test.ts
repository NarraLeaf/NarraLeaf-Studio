/**
 * What the layer templates promise: each builds on the owners it is written for and nowhere else, the
 * editor's own validator accepts what it builds, and what the project already answers is filled in
 * while the rest is left selected for the author.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    formatBlueprintKeyboardBinding,
} from "@shared/types/blueprint/graph";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { validateBlueprintDocumentGraphs } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { ownerRefToIndexKey } from "@services/ui-editor/blueprint/ownerKeys";
import { en } from "@shared/i18n/catalog/en";
import {
    BLUEPRINT_LAYER_TEMPLATES,
    type BlueprintLayerTemplateFacts,
    type BlueprintLayerTemplateId,
} from "./blueprintLayerTemplates";
import {
    buildBlueprintLayerTemplate,
    listBlueprintLayerTemplates,
    type BlueprintLayerTemplateTarget,
} from "./buildBlueprintLayerTemplate";
import { collectBlueprintLayerTemplateFacts } from "./blueprintLayerTemplateFacts";

registerCoreBlueprintNodes();

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return { id, type, parentId, childrenIds, layout: {} as UIElement["layout"] };
}

const ELEMENTS: Record<string, UIElement> = {
    "root-title": element("root-title", "nl.root", null, ["logo"]),
    logo: element("logo", "nl.image", "root-title"),
    "root-menu": element("root-menu", "nl.root", null, ["button", "list", "label"]),
    button: element("button", "nl.button", "root-menu"),
    list: element("list", "nl.list", "root-menu"),
    label: element("label", "nl.text", "root-menu"),
    "component-button": element("component-button", "nl.button", null),
};

const UI_DOCUMENT = {
    surfaces: [
        { id: "title", name: "Title", host: "app", kind: "appSurface", designSize: { width: 1, height: 1 }, rootElementId: "root-title" },
        { id: "menu", name: "Menu", host: "app", kind: "appSurface", designSize: { width: 1, height: 1 }, rootElementId: "root-menu" },
        { id: "confirm", name: "Confirm", host: "app", kind: "appSurface", designSize: { width: 1, height: 1 }, rootElementId: "root-menu" },
    ],
    elements: ELEMENTS,
} as unknown as Pick<UIDocument, "surfaces" | "elements">;

const OWNERS = {
    game: { kind: "globalMain" },
    page: { kind: "surfaceMain", surfaceId: "title" },
    button: { kind: "widgetMain", surfaceId: "menu", elementId: "button" },
    label: { kind: "widgetMain", surfaceId: "menu", elementId: "label" },
    list: { kind: "widgetMain", surfaceId: "menu", elementId: "list" },
    componentButton: { kind: "componentWidgetMain", componentId: "slot", elementId: "component-button" },
    value: { kind: "widgetValue", surfaceId: "menu", elementId: "label", propPath: "text" },
    story: { kind: "storyAction", blueprintId: "row" },
} satisfies Record<string, BlueprintOwnerRef>;

const FACTS: BlueprintLayerTemplateFacts = {
    pageContent: { surfaceId: "title", elementId: "logo" },
    confirmPage: "confirm",
    gameStart: { storyId: "story", sceneId: "opening" },
    text: key => `text:${key}`,
};

function target(owner: BlueprintOwnerRef, facts: BlueprintLayerTemplateFacts = FACTS): BlueprintLayerTemplateTarget {
    const elementId = "elementId" in owner ? owner.elementId : undefined;
    return {
        owner,
        widgetElementType: elementId ? ELEMENTS[elementId]?.type : undefined,
        uiElements: ELEMENTS,
        facts,
    };
}

function idsFor(owner: BlueprintOwnerRef): BlueprintLayerTemplateId[] {
    return listBlueprintLayerTemplates(target(owner)).map(template => template.id);
}

function counter() {
    let next = 0;
    return () => `n${(next += 1)}`;
}

function build(id: BlueprintLayerTemplateId, owner: BlueprintOwnerRef, facts: BlueprintLayerTemplateFacts = FACTS) {
    const template = BLUEPRINT_LAYER_TEMPLATES.find(item => item.id === id)!;
    const built = buildBlueprintLayerTemplate(template, target(owner, facts), counter());
    expect(built).not.toBeNull();
    return built!;
}

function nodesOfType(ir: BlueprintGraphIr, type: string) {
    return Object.values(ir.nodes ?? {}).filter(node => node.type === type);
}

const WIDGET_TEMPLATES: BlueprintLayerTemplateId[] = [
    "openPage",
    "startGame",
    "goBack",
    "overlayPage",
    "quitApp",
    "clickSound",
    "hoverSound",
    "hoverGrow",
];

describe("blueprint layer templates", () => {
    it("offers each owner the templates written for it, in order", () => {
        expect(idsFor(OWNERS.page)).toEqual(["splash", "pressAnyKey", "pageMusic", "escapeBack", "escapeMenu"]);
        expect(idsFor(OWNERS.game)).toEqual(["confirmClose", "fullscreenKey", "screenshotKey"]);
        expect(idsFor(OWNERS.button)).toEqual(WIDGET_TEMPLATES);
        expect(idsFor(OWNERS.label)).toEqual(WIDGET_TEMPLATES);
        expect(idsFor(OWNERS.componentButton)).toEqual(WIDGET_TEMPLATES);
    });

    it("offers closing confirmation only to a project that has a page to ask through", () => {
        const withoutPage = listBlueprintLayerTemplates(target(OWNERS.game, { ...FACTS, confirmPage: undefined }));
        expect(withoutPage.map(template => template.id)).toEqual(["fullscreenKey", "screenshotKey"]);
    });

    it("offers nothing a widget could not run", () => {
        // A list has no click and no hover, which is every widget template there is.
        expect(idsFor(OWNERS.list)).toEqual([]);
        expect(idsFor(OWNERS.value)).toEqual([]);
        expect(idsFor(OWNERS.story)).toEqual([]);
    });

    it("builds graphs the editor's validator accepts", () => {
        for (const owner of Object.values(OWNERS)) {
            for (const template of listBlueprintLayerTemplates(target(owner))) {
                const built = build(template.id, owner);
                const document: BlueprintDocument = {
                    schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                    blueprints: {
                        bp: {
                            id: "bp",
                            name: "Blueprint",
                            owner,
                            graphs: {
                                eventIds: ["layer"],
                                events: { layer: { id: "layer", name: template.id, graph: built.ir } },
                                functionIds: [],
                                functions: {},
                            },
                            members: { variables: {}, fields: {}, functions: {} },
                            bindings: {},
                        },
                    },
                    ownerRecords: { [ownerRefToIndexKey(owner)]: { blueprintId: "bp" } },
                };
                const elementId = "elementId" in owner ? owner.elementId : undefined;
                const errors = validateBlueprintDocumentGraphs(document, "bp", {
                    widgetElement: elementId ? ELEMENTS[elementId] : null,
                    widgetSurfaceId: "surfaceId" in owner ? owner.surfaceId : undefined,
                    uiDocument: { elements: ELEMENTS },
                    isComponentDefinitionGraph: owner.kind === "componentWidgetMain",
                }).filter(finding => finding.severity === "error");
                expect({ template: template.id, owner: owner.kind, errors }).toEqual({
                    template: template.id,
                    owner: owner.kind,
                    errors: [],
                });
            }
        }
    });

    it("fills in what the project answers and selects what it does not", () => {
        const filled = build("splash", OWNERS.page);
        const [content] = nodesOfType(filled.ir, BLUEPRINT_NODE_TYPE_ELEMENT_REF);
        expect(content?.params).toMatchObject({ surfaceId: "title", elementId: "logo", elementType: "nl.image" });
        expect(filled.pendingNodeIds).toHaveLength(1);
        expect(filled.ir.nodes?.[filled.pendingNodeIds[0]!]?.type).toBe("blueprint.page.go");

        const open = build("splash", OWNERS.page, { ...FACTS, pageContent: undefined });
        expect(open.pendingNodeIds.map(id => open.ir.nodes?.[id]?.type).sort()).toEqual([
            BLUEPRINT_NODE_TYPE_ELEMENT_REF,
            "blueprint.page.go",
        ]);

        const quit = build("quitApp", OWNERS.button);
        const [ask] = nodesOfType(quit.ir, BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        expect(ask?.params).toMatchObject({
            surfaceId: "confirm",
            message: "text:quitQuestion",
            button_1_label: "text:quitConfirm",
            button_2_label: "text:quitCancel",
        });
        expect(quit.pendingNodeIds).toEqual([]);

        const start = build("startGame", OWNERS.button, { ...FACTS, gameStart: undefined });
        expect(start.pendingNodeIds).toHaveLength(1);
    });

    it("gives every node an id of its own, and every edge a node at each end", () => {
        const template = BLUEPRINT_LAYER_TEMPLATES.find(item => item.id === "splash")!;
        let next = 0;
        const fresh = () => `fresh-${(next += 1)}`;
        const first = buildBlueprintLayerTemplate(template, target(OWNERS.page), fresh)!;
        const second = buildBlueprintLayerTemplate(template, target(OWNERS.page), fresh)!;
        const firstIds = Object.keys(first.ir.nodes ?? {});
        expect(firstIds.every(id => id.startsWith("fresh-"))).toBe(true);
        expect(firstIds.filter(id => id in (second.ir.nodes ?? {}))).toEqual([]);
        for (const edge of first.ir.edges ?? []) {
            expect(firstIds).toContain(edge.from.nodeId);
            expect(firstIds).toContain(edge.to.nodeId);
        }
    });

    it("binds keys the way the key picker writes them", () => {
        for (const owner of [OWNERS.game, OWNERS.page]) {
            for (const template of listBlueprintLayerTemplates(target(owner))) {
                for (const node of nodesOfType(build(template.id, owner).ir, BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)) {
                    const key = node.params?.key;
                    expect(typeof key).toBe("string");
                    expect(formatBlueprintKeyboardBinding(key)).toBe(key);
                }
            }
        }
    });

    it("has a title and a description for every template", () => {
        const strings = en.blueprint.layerTemplates as Record<string, unknown>;
        for (const template of BLUEPRINT_LAYER_TEMPLATES) {
            expect(strings[template.id]).toMatchObject({
                title: expect.any(String),
                description: expect.any(String),
            });
        }
    });
});

describe("what a project answers for a template", () => {
    function confirmGraph(...pages: string[]): BlueprintGraphIr {
        return {
            nodes: Object.fromEntries(pages.map((page, index) => [
                `ask-${index}`,
                { id: `ask-${index}`, type: BLUEPRINT_NODE_TYPE_LAYER_CONFIRM, params: { surfaceId: page } },
            ])),
            edges: [],
        };
    }

    function blueprintDocument(...graphs: BlueprintGraphIr[]): BlueprintDocument {
        return {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: Object.fromEntries(graphs.map((graph, index) => [`bp-${index}`, {
                id: `bp-${index}`,
                name: `Blueprint ${index}`,
                owner: { kind: "globalMain" },
                graphs: { eventIds: ["layer"], events: { layer: { id: "layer", graph } }, functionIds: [], functions: {} },
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
            }])),
            ownerRecords: {},
        };
    }

    function facts(overrides: Partial<Parameters<typeof collectBlueprintLayerTemplateFacts>[0]> = {}) {
        return collectBlueprintLayerTemplateFacts({
            owner: OWNERS.page,
            uiDocument: UI_DOCUMENT,
            blueprintDocument: blueprintDocument(),
            storyId: undefined,
            storyDocuments: {},
            text: key => key,
            ...overrides,
        });
    }

    it("names the page's content only when the page holds exactly one element", () => {
        expect(facts().pageContent).toEqual({ surfaceId: "title", elementId: "logo" });
        expect(facts({ owner: { kind: "surfaceMain", surfaceId: "menu" } }).pageContent).toBeUndefined();
        expect(facts({ owner: OWNERS.game }).pageContent).toBeUndefined();
    });

    it("names a confirmation page only when one is used more than any other", () => {
        expect(facts({ blueprintDocument: blueprintDocument(confirmGraph("confirm", "menu"), confirmGraph("confirm")) }).confirmPage)
            .toBe("confirm");
        expect(facts({ blueprintDocument: blueprintDocument(confirmGraph("confirm", "menu")) }).confirmPage).toBeUndefined();
        // A page the interface no longer has is not an answer, however often it is named.
        expect(facts({ blueprintDocument: blueprintDocument(confirmGraph("gone", "gone", "confirm")) }).confirmPage)
            .toBe("confirm");
    });

    it("starts the game where the default story opens", () => {
        const story = {
            id: "story",
            entrySceneId: "middle",
            chapters: [{ id: "chapter", name: "Chapter", sceneIds: ["first", "middle"] }],
            scenes: { first: { id: "first" }, middle: { id: "middle" } },
        } as unknown as StoryDocument;
        expect(facts({ storyId: "story", storyDocuments: { story } }).gameStart).toEqual({ storyId: "story", sceneId: "middle" });
        const noEntry = { ...story, entrySceneId: undefined } as StoryDocument;
        expect(facts({ storyId: "story", storyDocuments: { story: noEntry } }).gameStart)
            .toEqual({ storyId: "story", sceneId: "first" });
        expect(facts({ storyId: "story", storyDocuments: {} }).gameStart).toBeUndefined();
    });
});
