/**
 * What the template library promises: each template builds on the owners it is written for and
 * nowhere else, the editor's own validator accepts what it builds, what the project already answers
 * is filled in while the rest is left selected for the author, and every template is written in
 * every built-in language.
 *
 * The checks run over the whole library rather than template by template, so a template added later
 * is held to them without a line here changing.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    formatBlueprintKeyboardBinding,
} from "@shared/types/blueprint/graph";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { SUPPORTED_LOCALES } from "@shared/i18n/locales";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { validateBlueprintDocumentGraphs } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { ownerRefToIndexKey } from "@services/ui-editor/blueprint/ownerKeys";
import {
    BLUEPRINT_LAYER_TEMPLATES,
    BLUEPRINT_TEMPLATE_CATEGORIES,
    type BlueprintLayerTemplateFacts,
} from "./blueprintLayerTemplates";
import {
    buildBlueprintLayerTemplate,
    listBlueprintLayerTemplates,
    pickFeaturedBlueprintTemplates,
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
    "root-menu": element("root-menu", "nl.root", null, ["button", "list", "label", "slider", "switch", "box", "picture"]),
    button: element("button", "nl.button", "root-menu"),
    list: element("list", "nl.list", "root-menu"),
    label: element("label", "nl.text", "root-menu"),
    slider: element("slider", "nl.slider", "root-menu"),
    switch: element("switch", "nl.switch", "root-menu"),
    box: element("box", "nl.container", "root-menu"),
    picture: element("picture", "nl.image", "root-menu"),
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

/** One owner of every kind a template could be written for, and a widget of every common type. */
const OWNERS = {
    game: { kind: "globalMain" },
    page: { kind: "surfaceMain", surfaceId: "title" },
    button: { kind: "widgetMain", surfaceId: "menu", elementId: "button" },
    label: { kind: "widgetMain", surfaceId: "menu", elementId: "label" },
    list: { kind: "widgetMain", surfaceId: "menu", elementId: "list" },
    slider: { kind: "widgetMain", surfaceId: "menu", elementId: "slider" },
    switch: { kind: "widgetMain", surfaceId: "menu", elementId: "switch" },
    box: { kind: "widgetMain", surfaceId: "menu", elementId: "box" },
    picture: { kind: "widgetMain", surfaceId: "menu", elementId: "picture" },
    componentButton: { kind: "componentWidgetMain", componentId: "slot", elementId: "component-button" },
    value: { kind: "widgetValue", surfaceId: "menu", elementId: "label", propPath: "text" },
    story: { kind: "storyAction", blueprintId: "row" },
} satisfies Record<string, BlueprintOwnerRef>;

const FACTS: BlueprintLayerTemplateFacts = {
    pageContent: { surfaceId: "title", elementId: "logo" },
    confirmPage: "confirm",
    gameStart: { storyId: "story", sceneId: "opening" },
    locale: "en",
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

function idsFor(owner: BlueprintOwnerRef, facts: BlueprintLayerTemplateFacts = FACTS): string[] {
    return listBlueprintLayerTemplates(target(owner, facts)).map(template => template.id);
}

function featuredFor(owner: BlueprintOwnerRef): string[] {
    return pickFeaturedBlueprintTemplates(listBlueprintLayerTemplates(target(owner))).map(template => template.id);
}

function counter() {
    let next = 0;
    return () => `n${(next += 1)}`;
}

function build(id: string, owner: BlueprintOwnerRef, facts: BlueprintLayerTemplateFacts = FACTS) {
    const template = BLUEPRINT_LAYER_TEMPLATES.find(item => item.id === id)!;
    const built = buildBlueprintLayerTemplate(template, target(owner, facts), counter());
    expect(built).not.toBeNull();
    return built!;
}

function nodesOfType(ir: BlueprintGraphIr, type: string) {
    return Object.values(ir.nodes ?? {}).filter(node => node.type === type);
}

/** The editor validator's errors for one layer holding `ir` on `owner`. */
function validate(owner: BlueprintOwnerRef, name: string, ir: BlueprintGraphIr) {
    const document: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            bp: {
                id: "bp",
                name: "Blueprint",
                owner,
                graphs: {
                    eventIds: ["layer"],
                    events: { layer: { id: "layer", name, graph: ir } },
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
    return validateBlueprintDocumentGraphs(document, "bp", {
        widgetElement: elementId ? ELEMENTS[elementId] : null,
        widgetSurfaceId: "surfaceId" in owner ? owner.surfaceId : undefined,
        uiDocument: { elements: ELEMENTS },
        isComponentDefinitionGraph: owner.kind === "componentWidgetMain",
    }).filter(finding => finding.severity === "error");
}

describe("blueprint layer templates", () => {
    it("shows each kind of blueprint its commonest needs first", () => {
        expect(featuredFor(OWNERS.page)).toEqual(["splash", "pressAnyKey", "pageMusic", "escapeBack"]);
        expect(featuredFor(OWNERS.game).slice(0, 3)).toEqual(["confirmClose", "fullscreenKey", "screenshotKey"]);
        expect(featuredFor(OWNERS.button)).toEqual(["openPage", "goBack", "startGame", "quitApp"]);
        expect(featuredFor(OWNERS.componentButton)).toEqual(["openPage", "goBack", "startGame", "quitApp"]);
        // A widget with templates of its own shows those before the ones any clickable widget takes.
        expect(featuredFor(OWNERS.slider)).toEqual(["musicVolumeSlider", "sfxVolumeSlider", "textSpeedSlider", "masterVolumeSlider"]);
        expect(featuredFor(OWNERS.switch)).toEqual(["fullscreenSwitch", "skipReadTextSwitch", "muteWhenUnfocusedSwitch", "openPage"]);
        expect(featuredFor(OWNERS.label)).toEqual(["playtimeText", "clockText", "openPage", "goBack"]);
    });

    it("gives every template an id of its own and a shelf that exists", () => {
        const ids = BLUEPRINT_LAYER_TEMPLATES.map(template => template.id);
        expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
        const shelves = new Set<string>(BLUEPRINT_TEMPLATE_CATEGORIES.map(category => category.id));
        expect(BLUEPRINT_LAYER_TEMPLATES.filter(template => !shelves.has(template.category)).map(template => template.id))
            .toEqual([]);
    });

    it("offers every template somewhere", () => {
        // A template no owner here can take is either written against a node that has moved or for
        // a widget this test does not stand up - both worth knowing before an author does.
        const offered = new Set(Object.values(OWNERS).flatMap(owner => idsFor(owner)));
        expect(BLUEPRINT_LAYER_TEMPLATES.map(template => template.id).filter(id => !offered.has(id))).toEqual([]);
    });

    it("offers closing confirmation only to a project that has a page to ask through", () => {
        expect(idsFor(OWNERS.game)).toContain("confirmClose");
        expect(idsFor(OWNERS.game, { ...FACTS, confirmPage: undefined })).not.toContain("confirmClose");
    });

    it("offers nothing a widget could not run", () => {
        // A list has no click; a value binding and a story action take none of these layers.
        const onClick = BLUEPRINT_LAYER_TEMPLATES
            .filter(template => template.graph(FACTS).includes("blueprint.event.head.mouseClick"))
            .map(template => template.id);
        expect(onClick.length).toBeGreaterThan(0);
        expect(idsFor(OWNERS.list).filter(id => onClick.includes(id))).toEqual([]);
        expect(idsFor(OWNERS.value)).toEqual([]);
        expect(idsFor(OWNERS.story)).toEqual([]);
    });

    it("builds graphs the editor's validator accepts", () => {
        for (const owner of Object.values(OWNERS)) {
            for (const template of listBlueprintLayerTemplates(target(owner))) {
                const built = build(template.id, owner);
                expect({ template: template.id, owner: owner.kind, errors: validate(owner, template.id, built.ir) }).toEqual({
                    template: template.id,
                    owner: owner.kind,
                    errors: [],
                });
            }
        }
    });

    it("names only nodes its graph declares among the author's choices", () => {
        for (const template of BLUEPRINT_LAYER_TEMPLATES) {
            const graph = template.graph({ locale: "en" });
            for (const [node, keys] of Object.entries(template.choices ?? {})) {
                const declared = new RegExp(`^\\s*${node}:`, "m").test(graph);
                expect({ template: template.id, node, declared, keys: keys.length > 0 })
                    .toEqual({ template: template.id, node, declared: true, keys: true });
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

        const quit = build("quitApp", OWNERS.button, { ...FACTS, locale: "zh" });
        const [ask] = nodesOfType(quit.ir, BLUEPRINT_NODE_TYPE_LAYER_CONFIRM);
        expect(ask?.params).toMatchObject({
            surfaceId: "confirm",
            message: "确定要退出游戏吗？",
            button_1_label: "退出",
            button_2_label: "取消",
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
        for (const owner of Object.values(OWNERS)) {
            for (const template of listBlueprintLayerTemplates(target(owner))) {
                const ir = build(template.id, owner).ir;
                const keyHeads = [
                    ...nodesOfType(ir, BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN),
                    ...nodesOfType(ir, BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP),
                ];
                for (const node of keyHeads) {
                    const key = node.params?.key;
                    expect(typeof key).toBe("string");
                    expect({ template: template.id, key: formatBlueprintKeyboardBinding(key) }).toEqual({ template: template.id, key });
                }
            }
        }
    });

    it("is written in every built-in language, in the register of each", () => {
        for (const template of BLUEPRINT_LAYER_TEMPLATES) {
            for (const locale of SUPPORTED_LOCALES) {
                const text = template.text[locale];
                const where = `${template.id} (${locale})`;
                // A title is also the layer's name, so it is never a sentence.
                expect({ where, title: text.title.trim().length > 0 && !/[.。]$/.test(text.title) })
                    .toEqual({ where, title: true });
                expect({ where, description: text.description.trim().length > 0 }).toEqual({ where, description: true });
            }
            // English descriptions are sentences; Chinese and Japanese ones are phrases, as in the
            // rest of the interface.
            expect({ id: template.id, en: template.text.en.description.endsWith(".") }).toEqual({ id: template.id, en: true });
            expect({ id: template.id, zh: /[。.]$/.test(template.text.zh.description) }).toEqual({ id: template.id, zh: false });
            expect({ id: template.id, ja: /[。.]$/.test(template.text.ja.description) }).toEqual({ id: template.id, ja: false });
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
            locale: "en",
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
