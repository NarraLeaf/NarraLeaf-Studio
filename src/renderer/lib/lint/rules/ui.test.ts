import { describe, expect, it } from "vitest";

import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIInputActionDef, UISurfaceActionEnablement } from "@shared/types/ui-editor/inputAction";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { widgetMainOwnerKey } from "../../workspace/services/ui-editor/blueprint/ownerKeys";
import { blueprintNodeRegistry } from "../../ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../../ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import type { LintContext, LintLocalizationContext } from "../context";
import { createTestLintContext } from "../testContext";
import type { LintRule, LintRuleId } from "../types";
import { UI_LINT_RULES } from "./ui";

/**
 * The `ui` category.
 *
 * Every rule here is written against a false-positive it must not produce, so each one is tested
 * from both ends: a document it has to report, and the working shapes it has to stay quiet about.
 * The quiet cases are the ones that earn their keep - `ui/page-unreachable` fires on nothing at all
 * when the entry page, the Game UIs, the layers and the embedded pages are handled, and a version
 * that missed any of them would look identical in the fire test and warn about a healthy project.
 */

function rule(id: LintRuleId): LintRule {
    const found = UI_LINT_RULES.find(candidate => candidate.id === id);
    if (!found) {
        throw new Error(`${id} is not registered`);
    }
    return found;
}

async function run(ruleId: LintRuleId, ctx: LintContext) {
    return await rule(ruleId).run(ctx, {});
}

function element(input: Partial<UIElement> & { id: string; type: string }): UIElement {
    return { parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 10, height: 10 }, ...input };
}

/** A document whose pages each hold one element tree, keyed by page id. */
function uiDocument(input: {
    surfaces: { id: string; name: string; kind?: "appSurface" | "stageSurface"; rootElementId: string }[];
    elements: UIElement[];
    components?: UIDocument["components"];
}): UIDocument {
    return {
        surfaces: input.surfaces.map(surface => ({ kind: "appSurface", ...surface })),
        elements: Object.fromEntries(input.elements.map(entry => [entry.id, entry])),
        ...(input.components ? { components: input.components } : {}),
    } as unknown as UIDocument;
}

/** One page called "Main Page" whose root holds the given children. */
function onePage(...children: UIElement[]): UIDocument {
    return uiDocument({
        surfaces: [{ id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root" }],
        elements: [element({ id: "root", type: "nl.root", childrenIds: children.map(child => child.id) }), ...children],
    });
}

/** Owner key -> the one graph that owner's blueprint holds. */
function blueprintDocument(owners: Record<string, BlueprintGraphIr>): BlueprintDocument {
    const ownerRecords: Record<string, unknown> = {};
    const blueprints: Record<string, unknown> = {};
    Object.entries(owners).forEach(([ownerKey, graph], index) => {
        const blueprintId = `bp${index}`;
        ownerRecords[ownerKey] = { activeBlueprintId: blueprintId, privateBlueprintIds: [blueprintId] };
        blueprints[blueprintId] = {
            id: blueprintId,
            name: ownerKey,
            program: { kind: "graph", graphs: { events: { main: { id: "main", graph } }, functions: {} } },
        };
    });
    return { ownerRecords, blueprints } as unknown as BlueprintDocument;
}

/** The empty-but-real document: read successfully, holds no graphs. */
const NO_GRAPHS = blueprintDocument({});

function localization(targetLocales: string[]): LintLocalizationContext {
    return { sourceLocale: "en", targetLocales, documents: new Map() };
}

// ---------------------------------------------------------------------------
// ui/unlocalized-text
// ---------------------------------------------------------------------------

/** A text widget carrying `text`, plus whatever binding props the case is about. */
function textWidget(props: Record<string, unknown>): UIElement {
    return element({ id: "label", type: "nl.text", name: "Greeting", props });
}

function unlocalizedContext(document: UIDocument, locales = ["zh"]): LintContext {
    return createTestLintContext({ uiDocument: document, localization: localization(locales) });
}

describe("ui/unlocalized-text", () => {
    it("reports a literal on a page of a project that has a second language", async () => {
        const findings = await run("ui/unlocalized-text", unlocalizedContext(onePage(textWidget({ text: "Start Game" }))));

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "ui/unlocalized-text",
            messageKey: "lint.rule.uiUnlocalizedText.message",
            messageParams: { text: "Start Game" },
            location: { kind: "surface", surfaceId: MAIN_APP_SURFACE_ID, surfaceName: "Main Page", elementName: "Greeting" },
            target: { kind: "uiSurface", surfaceId: MAIN_APP_SURFACE_ID },
        });
    });

    it("says nothing in a single-language project", async () => {
        // The case that decides whether this rule survives contact with a real project: writing the
        // words on the widget is not a defect until there is a second language to write them in.
        const document = onePage(textWidget({ text: "Start Game" }));

        expect(await run("ui/unlocalized-text", createTestLintContext({ uiDocument: document }))).toEqual([]);
        expect(await run("ui/unlocalized-text", unlocalizedContext(document, []))).toEqual([]);
        // A "target" list that names only the source locale is not a second language either.
        expect(await run("ui/unlocalized-text", unlocalizedContext(document, ["en"]))).toEqual([]);
    });

    it("says nothing about text that is bound either way", async () => {
        const byKey = onePage(textWidget({ text: "Start Game", localizationKey: "menu.start" }));
        const byImplicitUnit = onePage(textWidget({ text: "Start Game", localizable: true }));

        expect(await run("ui/unlocalized-text", unlocalizedContext(byKey))).toEqual([]);
        expect(await run("ui/unlocalized-text", unlocalizedContext(byImplicitUnit))).toEqual([]);
    });

    it("says nothing about strings with no words in them", async () => {
        for (const text of ["", "   ", "1,250", "12:30", "…", "→", "100%"]) {
            expect(
                await run("ui/unlocalized-text", unlocalizedContext(onePage(textWidget({ text })))),
                `${JSON.stringify(text)} was reported`,
            ).toEqual([]);
        }
    });

    it("reads a button's label and a text field's placeholder, each by its own binding prop", async () => {
        const document = onePage(
            element({ id: "start", type: "nl.button", name: "Start", props: { label: "Play" } }),
            element({ id: "name", type: "nl.textInput", name: "Name", props: { placeholder: "Your name" } }),
            // A text input has no implicit-unit flag on its props, so only its named key binds it.
            element({
                id: "bound",
                type: "nl.textInput",
                name: "Bound",
                props: { placeholder: "Your name", placeholderLocalizationKey: "form.name" },
            }),
        );

        const findings = await run("ui/unlocalized-text", unlocalizedContext(document));

        expect(findings.map(finding => finding.messageParams?.text)).toEqual(["Play", "Your name"]);
    });
});

// ---------------------------------------------------------------------------
// ui/page-unreachable
// ---------------------------------------------------------------------------

/** The main page plus one other page, neither holding anything. */
function twoPages(secondKind: "appSurface" | "stageSurface" = "appSurface"): UIDocument {
    return uiDocument({
        surfaces: [
            { id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root-main" },
            { id: "settings", name: "Settings", kind: secondKind, rootElementId: "root-settings" },
        ],
        elements: [element({ id: "root-main", type: "nl.root" }), element({ id: "root-settings", type: "nl.root" })],
    });
}

function pageGraph(nodeType: string, surfaceId: string): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
            open: { id: "open", type: nodeType, params: { surfaceId } },
        },
        edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "open", port: "in" } }],
    };
}

describe("ui/page-unreachable", () => {
    it("reports a page nothing opens", async () => {
        const findings = await run(
            "ui/page-unreachable",
            createTestLintContext({ uiDocument: twoPages(), blueprintDocument: NO_GRAPHS }),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "ui/page-unreachable",
            messageKey: "lint.rule.uiPageUnreachable.message",
            location: { kind: "surface", surfaceId: "settings", surfaceName: "Settings" },
            target: { kind: "uiSurface", surfaceId: "settings" },
        });
        // The entry page is entered by name and navigated to by nothing; reporting it is the mistake
        // this rule exists not to make.
        expect(findings.map(finding => finding.location)).not.toContainEqual(
            expect.objectContaining({ surfaceId: MAIN_APP_SURFACE_ID }),
        );
    });

    it("says nothing about a page some graph opens, whichever node opens it", async () => {
        // `Go Page` is not the only door: a layer and a confirm put a page on screen too, and a rule
        // that only knew the one node would warn about every page shown as a layer.
        registerCoreBlueprintNodes();
        for (const nodeType of [BLUEPRINT_NODE_TYPE_PAGE_GO, BLUEPRINT_NODE_TYPE_LAYER_SHOW]) {
            // Asserted so the case cannot pass through the fallback for nodes this build does not
            // know: these two are core nodes and must be read through their declared page param.
            expect(blueprintNodeRegistry.get(nodeType), `${nodeType} is not a core node`).toBeDefined();
            const ctx = createTestLintContext({
                uiDocument: twoPages(),
                blueprintDocument: blueprintDocument({ globalMain: pageGraph(nodeType, "settings") }),
            });

            expect(await run("ui/page-unreachable", ctx), `${nodeType} was not read as a way in`).toEqual([]);
        }
    });

    it("reads the page a node names, not the node's presence", async () => {
        // A `Go Page` with no page chosen opens nothing, so the page it does not name is still
        // unreachable - the check is on the value, the way `blueprint/reference-missing` reads one.
        const ctx = createTestLintContext({
            uiDocument: twoPages(),
            blueprintDocument: blueprintDocument({ globalMain: pageGraph(BLUEPRINT_NODE_TYPE_PAGE_GO, "  ") }),
        });

        expect((await run("ui/page-unreachable", ctx)).map(finding => finding.location)).toEqual([
            expect.objectContaining({ surfaceId: "settings" }),
        ]);
    });

    it("says nothing about a page a Page widget embeds", async () => {
        const document = uiDocument({
            surfaces: [
                { id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root-main" },
                { id: "settings", name: "Settings", rootElementId: "root-settings" },
            ],
            elements: [
                element({ id: "root-main", type: "nl.root", childrenIds: ["frame"] }),
                element({ id: "frame", type: UI_FRAME_ELEMENT_TYPE, props: { targetSurfaceId: "settings" } }),
                element({ id: "root-settings", type: "nl.root" }),
            ],
        });

        expect(
            await run("ui/page-unreachable", createTestLintContext({ uiDocument: document, blueprintDocument: NO_GRAPHS })),
        ).toEqual([]);
    });

    it("says nothing about a Game UI", async () => {
        // A stage surface is mounted into its slot by the engine, so "who navigates here" is not a
        // question that can be asked about one.
        expect(
            await run(
                "ui/page-unreachable",
                createTestLintContext({ uiDocument: twoPages("stageSurface"), blueprintDocument: NO_GRAPHS }),
            ),
        ).toEqual([]);
    });

    it("treats every id on a node it cannot read as a way in", async () => {
        // A plugin's node is not in this build's catalogue, so what its params mean is unavailable.
        // Over-counting costs a page this rule stays quiet about; under-counting costs a warning on
        // a page that works.
        const graph: BlueprintGraphIr = {
            nodes: { plugin: { id: "plugin", type: "some-plugin.open-page", params: { destination: "settings" } } },
        };

        expect(
            await run(
                "ui/page-unreachable",
                createTestLintContext({ uiDocument: twoPages(), blueprintDocument: blueprintDocument({ globalMain: graph }) }),
            ),
        ).toEqual([]);
    });

    it("says nothing when a document could not be read", async () => {
        // `null` is a failed read, not a project with no graphs - answering it would report every
        // page but the entry one off one unrelated failure.
        expect(await run("ui/page-unreachable", createTestLintContext({ uiDocument: twoPages() }))).toEqual([]);
        expect(await run("ui/page-unreachable", createTestLintContext({ blueprintDocument: NO_GRAPHS }))).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// ui/empty-behavior
// ---------------------------------------------------------------------------

/**
 * Owner keys spelled by the encoder, not by hand.
 *
 * The main surface's id contains the key separator, so a hand-built key for anything on it is the
 * one shape the format has always got wrong - and a fixture that spells its own keys is a second
 * encoder that drifts the moment the first one changes. These three cases silently reported every
 * wired button as unwired when it did.
 */
const SURFACE_OWNER_KEY = encodeBlueprintOwnerKey({ kind: "surfaceMain", surfaceId: MAIN_APP_SURFACE_ID });

function widgetKey(elementId: string): string {
    return encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: MAIN_APP_SURFACE_ID, elementId });
}

function button(overrides: Partial<UIElement> = {}): UIElement {
    return element({ id: "start", type: "nl.button", name: "Start", props: { label: "Play" }, ...overrides });
}

function headGraph(type: string, params: Record<string, unknown> = {}): BlueprintGraphIr {
    return { nodes: { head: { id: "head", type, params } } };
}

describe("ui/empty-behavior", () => {
    it("reports a button nobody ever wired", async () => {
        const findings = await run(
            "ui/empty-behavior",
            createTestLintContext({ uiDocument: onePage(button()), blueprintDocument: NO_GRAPHS }),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "ui/empty-behavior",
            messageKey: "lint.rule.uiEmptyBehavior.message",
            location: { kind: "surface", surfaceId: MAIN_APP_SURFACE_ID, elementId: "start", elementName: "Start" },
            target: { kind: "uiSurface", surfaceId: MAIN_APP_SURFACE_ID },
        });
    });

    it("says nothing about a button whose own blueprint starts on a click", async () => {
        // The graph's name is not consulted - the dispatcher looks for a head node of a type the
        // slot allows, in any of the blueprint's event graphs.
        const ctx = createTestLintContext({
            uiDocument: onePage(button()),
            blueprintDocument: blueprintDocument({
                [widgetKey("start")]: headGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
            }),
        });

        expect(await run("ui/empty-behavior", ctx)).toEqual([]);
    });

    it("says nothing about a button an On Element Click head names", async () => {
        // The widget's own blueprint is empty in this shape: the head that listens for it lives in
        // the page's blueprint, so a rule that looked only at the widget would report it as unwired.
        const ctx = createTestLintContext({
            uiDocument: onePage(button()),
            blueprintDocument: blueprintDocument({
                [SURFACE_OWNER_KEY]: headGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, {
                    surfaceId: MAIN_APP_SURFACE_ID,
                    elementId: "start",
                    elementType: "nl.button",
                }),
            }),
        });

        expect(await run("ui/empty-behavior", ctx)).toEqual([]);
    });

    it("says nothing about a button whose parent takes the click", async () => {
        // A pointer event nothing on the element listens for is handed to its parent, so a plain
        // button inside a wired container is a working button.
        const document = uiDocument({
            surfaces: [{ id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root" }],
            elements: [
                element({ id: "root", type: "nl.root", childrenIds: ["panel"] }),
                element({ id: "panel", type: "nl.container", childrenIds: ["start"] }),
                button(),
            ],
        });
        const ctx = createTestLintContext({
            uiDocument: document,
            blueprintDocument: blueprintDocument({
                [widgetKey("panel")]: headGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
            }),
        });

        expect(await run("ui/empty-behavior", ctx)).toEqual([]);
    });

    it("says nothing about a control in a list whose rows are handled", async () => {
        const document = uiDocument({
            surfaces: [{ id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root" }],
            elements: [
                element({ id: "root", type: "nl.root", childrenIds: ["slots"] }),
                element({ id: "slots", type: "nl.list", childrenIds: ["start"] }),
                button(),
            ],
        });
        const ctx = createTestLintContext({
            uiDocument: document,
            blueprintDocument: blueprintDocument({
                [widgetKey("slots")]: headGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK),
            }),
        });

        expect(await run("ui/empty-behavior", ctx)).toEqual([]);
    });

    it("says nothing about a button that takes no clicks", async () => {
        const disabled = button({ props: { label: "Play", interactionDisabled: true } });

        expect(
            await run("ui/empty-behavior", createTestLintContext({ uiDocument: onePage(disabled), blueprintDocument: NO_GRAPHS })),
        ).toEqual([]);
    });

    it("says nothing about scenery, which is most of a page", async () => {
        // Only a button is a candidate. An image or a container that runs nothing when pressed is
        // what almost every element on a page is, and reporting those would bury the one that matters.
        const art = element({ id: "art", type: "nl.image", name: "Cover" });
        const panel = element({ id: "panel", type: "nl.container", name: "Frame" });

        expect(
            await run(
                "ui/empty-behavior",
                createTestLintContext({ uiDocument: onePage(art, panel), blueprintDocument: NO_GRAPHS }),
            ),
        ).toEqual([]);
    });
});

describe("ui/component-missing", () => {
    /** A linked instance of `componentId`, as `getUIComponentLink` reads one. */
    function instance(id: string, componentId: string, name?: string) {
        return element({
            id,
            type: "nl.container",
            ...(name ? { name } : {}),
            extra: { componentLink: { componentId, linked: true } },
        });
    }

    /** A definition with the one field the rule looks at, plus what the type requires. */
    function definition(id: string, name: string) {
        return { id, name, rootElementId: `${id}-root`, elements: {} };
    }

    it("reports every instance whose component the project does not have", async () => {
        const document = onePage(instance("slot", "gone", "Save Slot"), instance("badge", "gone"));
        document.components = [definition("kept", "Kept")];

        const findings = await run("ui/component-missing", createTestLintContext({ uiDocument: document }));

        expect(findings.map(finding => (finding.location.kind === "surface" ? finding.location.elementId : null)))
            .toEqual(["slot", "badge"]);
        expect(findings[0].ruleId).toBe("ui/component-missing");
        expect(findings[0].messageKey).toBe("lint.rule.uiComponentMissing.message");
    });

    it("says nothing about an instance whose component is in the library", async () => {
        const document = onePage(instance("slot", "save-slot"));
        document.components = [definition("save-slot", "Save Slot")];

        expect(await run("ui/component-missing", createTestLintContext({ uiDocument: document }))).toEqual([]);
    });

    it("says nothing about an element that is not an instance at all", async () => {
        // An `extra.componentLink` that has been unlinked is not a link: `getUIComponentLink`
        // requires `linked: true`, and an unlinked copy holds its own elements.
        const unlinked = element({
            id: "detached",
            type: "nl.container",
            extra: { componentLink: { componentId: "gone", linked: false } },
        });

        expect(
            await run("ui/component-missing", createTestLintContext({ uiDocument: onePage(unlinked, element({ id: "plain", type: "nl.text" })) })),
        ).toEqual([]);
    });
});

describe("ui/frame-target-missing", () => {
    function frame(id: string, targetSurfaceId?: string) {
        return element({
            id,
            type: UI_FRAME_ELEMENT_TYPE,
            ...(targetSurfaceId ? { props: { targetSurfaceId } } : {}),
        });
    }

    it("reports a Page widget embedding a page the project does not have", async () => {
        const document = onePage(frame("embed", "gone"));

        const findings = await run("ui/frame-target-missing", createTestLintContext({ uiDocument: document }));

        expect(findings.map(finding => (finding.location.kind === "surface" ? finding.location.elementId : null)))
            .toEqual(["embed"]);
        expect(findings[0].messageKey).toBe("lint.rule.uiFrameTargetMissing.message");
    });

    it("says nothing about a frame embedding a page that exists", async () => {
        const document = uiDocument({
            surfaces: [
                { id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root" },
                { id: "settings", name: "Settings", rootElementId: "settings-root" },
            ],
            elements: [
                element({ id: "root", type: "nl.root", childrenIds: ["embed"] }),
                frame("embed", "settings"),
                element({ id: "settings-root", type: "nl.root" }),
            ],
        });

        expect(await run("ui/frame-target-missing", createTestLintContext({ uiDocument: document }))).toEqual([]);
    });

    it("says nothing about a frame with no page picked yet", async () => {
        // A frame the author has not finished placing is a page under construction, not a broken one.
        expect(
            await run("ui/frame-target-missing", createTestLintContext({ uiDocument: onePage(frame("embed")) })),
        ).toEqual([]);
    });
});

const LAYOUT = { x: 0, y: 0, width: 100, height: 100 };

describe("ui/list-item-field-missing", () => {
    const STRUCT = { id: "s1", fields: [{ id: "f-title", key: "title", type: "string" as const }] };

    function listPage(bindingFieldId: string, structId: string | null = STRUCT.id): UIDocument {
        return {
            schemaVersion: 11,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "page",
                    name: "Page",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 100, height: 100 },
                    rootElementId: "root",
                },
            ],
            structs: { [STRUCT.id]: STRUCT },
            elements: {
                root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["list"], layout: LAYOUT },
                list: {
                    id: "list",
                    type: "nl.list",
                    parentId: "root",
                    childrenIds: ["row"],
                    layout: LAYOUT,
                    props: { itemStructId: structId },
                },
                row: {
                    id: "row",
                    type: "nl.text",
                    parentId: "list",
                    childrenIds: [],
                    layout: LAYOUT,
                    extra: { listSlot: "itemTemplate" },
                    valueBindings: { text: { kind: "listItemField", fieldId: bindingFieldId } },
                },
            },
        } as unknown as UIDocument;
    }

    it("says nothing when the field is declared", async () => {
        const findings = await run(
            "ui/list-item-field-missing",
            createTestLintContext({ uiDocument: listPage("f-title") }),
        );
        expect(findings).toEqual([]);
    });

    it("reports a binding whose field the list no longer declares", async () => {
        const findings = await run(
            "ui/list-item-field-missing",
            createTestLintContext({ uiDocument: listPage("f-gone") }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]?.location).toMatchObject({ surfaceId: "page", elementId: "row" });
    });

    it("reports a binding on a list that declares no shape at all", async () => {
        const findings = await run(
            "ui/list-item-field-missing",
            createTestLintContext({ uiDocument: listPage("f-title", null) }),
        );
        expect(findings).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// ui/gesture-answered-twice
// ---------------------------------------------------------------------------

const ADVANCE: UIInputActionDef = {
    id: "advance",
    name: "Advance",
    bindings: [{ kind: "pointer", gesture: "click" }],
};

/** One page whose root holds `leaf`, with a vocabulary and the page's own answer to it. */
function actionPage(input: {
    leaf: UIElement;
    ancestor?: UIElement;
    actions?: Record<string, UIInputActionDef>;
    enablements?: UISurfaceActionEnablement[];
}): UIDocument {
    const { leaf, ancestor } = input;
    const branch = ancestor ? [{ ...ancestor, childrenIds: [leaf.id] }, leaf] : [leaf];
    return {
        surfaces: [
            {
                id: MAIN_APP_SURFACE_ID,
                name: "Main Page",
                kind: "appSurface",
                rootElementId: "root",
                actions: input.enablements ?? [{ actionId: "advance" }],
            },
        ],
        actions: input.actions ?? { advance: ADVANCE },
        elements: Object.fromEntries(
            [element({ id: "root", type: "nl.root", childrenIds: [branch[0]!.id] }), ...branch].map(entry => [
                entry.id,
                entry,
            ]),
        ),
    } as unknown as UIDocument;
}

/** A widget whose own blueprint answers one pointer slot. */
function widgetWithHead(input: { id: string; type: string; name?: string; head: string }): {
    element: UIElement;
    blueprints: BlueprintDocument;
} {
    return {
        element: element({ id: input.id, type: input.type, ...(input.name ? { name: input.name } : {}) }),
        blueprints: blueprintDocument({
            [widgetMainOwnerKey(MAIN_APP_SURFACE_ID, input.id)]: {
                nodes: { h: { id: "h", type: input.head } },
                edges: [],
            } as unknown as BlueprintGraphIr,
        }),
    };
}

describe("ui/gesture-answered-twice", () => {
    it("reports a hand-made hit target on a page that answers the same gesture", async () => {
        const hit = widgetWithHead({
            id: "hit",
            type: "nl.container",
            name: "Hit area",
            head: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
        });

        const findings = await run(
            "ui/gesture-answered-twice",
            createTestLintContext({ uiDocument: actionPage({ leaf: hit.element }), blueprintDocument: hit.blueprints }),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "ui/gesture-answered-twice",
            messageKey: "lint.rule.uiGestureAnsweredTwice.message",
            messageParams: { action: "Advance" },
            location: { kind: "surface", surfaceId: MAIN_APP_SURFACE_ID, elementName: "Hit area" },
            target: { kind: "uiSurface", surfaceId: MAIN_APP_SURFACE_ID },
        });
    });

    it("matches a wheel head against whichever direction the page is bound to", async () => {
        const wheel = widgetWithHead({
            id: "hit",
            type: "nl.container",
            head: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL,
        });
        // One head, four gestures: it is handed the deltas and decides the direction itself.
        for (const gesture of ["wheelUp", "wheelDown", "wheelLeft", "wheelRight"] as const) {
            const document = actionPage({
                leaf: wheel.element,
                actions: { backlog: { id: "backlog", name: "Backlog", bindings: [{ kind: "pointer", gesture }] } },
                enablements: [{ actionId: "backlog" }],
            });
            const findings = await run(
                "ui/gesture-answered-twice",
                createTestLintContext({ uiDocument: document, blueprintDocument: wheel.blueprints }),
            );
            expect(findings, `a wheel head should collide with ${gesture}`).toHaveLength(1);
        }
    });

    it("says nothing about a control the action already stands down over", async () => {
        // The half that works: `overControls: "skip"` reads the widget type, and a Button is a
        // control by type, so only one of the two ever runs.
        const button = widgetWithHead({ id: "hit", type: "nl.button", head: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK });

        expect(
            await run(
                "ui/gesture-answered-twice",
                createTestLintContext({
                    uiDocument: actionPage({ leaf: button.element }),
                    blueprintDocument: button.blueprints,
                }),
            ),
        ).toEqual([]);
    });

    it("says nothing about a widget inside a control", async () => {
        // The runtime asks the whole chain under the pointer, so a container in a list is covered
        // by the list. A rule that judged only the widget would report every row of every list.
        const inner = widgetWithHead({ id: "hit", type: "nl.container", head: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK });
        const document = actionPage({ leaf: inner.element, ancestor: element({ id: "rows", type: "nl.list" }) });

        expect(
            await run(
                "ui/gesture-answered-twice",
                createTestLintContext({ uiDocument: document, blueprintDocument: inner.blueprints }),
            ),
        ).toEqual([]);
    });

    it("says nothing when the two answer different gestures", async () => {
        const hit = widgetWithHead({ id: "hit", type: "nl.container", head: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK });
        // A key binding is not a gesture a pointer can collide with, and a wheel is not a click.
        for (const bindings of [
            [{ kind: "key" as const, key: "Escape" }],
            [{ kind: "pointer" as const, gesture: "wheelDown" as const }],
        ]) {
            const document = actionPage({
                leaf: hit.element,
                actions: { dismiss: { id: "dismiss", name: "Dismiss", bindings } },
                enablements: [{ actionId: "dismiss" }],
            });
            expect(
                await run(
                    "ui/gesture-answered-twice",
                    createTestLintContext({ uiDocument: document, blueprintDocument: hit.blueprints }),
                ),
            ).toEqual([]);
        }
    });

    it("says nothing about a page that answers nothing, or an action the project never defined", async () => {
        const hit = widgetWithHead({ id: "hit", type: "nl.container", head: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK });

        const noAnswers = actionPage({ leaf: hit.element, enablements: [] });
        expect(
            await run(
                "ui/gesture-answered-twice",
                createTestLintContext({ uiDocument: noAnswers, blueprintDocument: hit.blueprints }),
            ),
        ).toEqual([]);

        // What a surface pasted in from another project leaves behind: inert at run time, and the
        // dangling name is reported where the vocabulary is rather than piled on here.
        const orphan = actionPage({ leaf: hit.element, actions: {}, enablements: [{ actionId: "advance" }] });
        expect(
            await run(
                "ui/gesture-answered-twice",
                createTestLintContext({ uiDocument: orphan, blueprintDocument: hit.blueprints }),
            ),
        ).toEqual([]);
    });

    it("claims nothing about a blueprint it cannot read", async () => {
        // The polarity that matters: a script module's handlers are functions this sweep cannot
        // see, and crediting one with answering a click would report every widget carrying one.
        const scripted = {
            ownerRecords: {
                [widgetMainOwnerKey(MAIN_APP_SURFACE_ID, "hit")]: {
                    activeBlueprintId: "bpS",
                    privateBlueprintIds: ["bpS"],
                },
            },
            blueprints: { bpS: { id: "bpS", name: "Hit area", program: { kind: "script", source: "" } } },
        } as unknown as BlueprintDocument;

        expect(
            await run(
                "ui/gesture-answered-twice",
                createTestLintContext({
                    uiDocument: actionPage({ leaf: element({ id: "hit", type: "nl.container" }) }),
                    blueprintDocument: scripted,
                }),
            ),
        ).toEqual([]);
    });
});
