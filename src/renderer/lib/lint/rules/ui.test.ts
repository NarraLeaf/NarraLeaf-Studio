import { describe, expect, it } from "vitest";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
  BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
  BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
  BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
  BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
  BLUEPRINT_NODE_TYPE_LAYER_SHOW,
  BLUEPRINT_NODE_TYPE_PAGE_GO
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
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
  const found = UI_LINT_RULES.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`${id} is not registered`);
  }
  return found;
}

async function run(ruleId: LintRuleId, ctx: LintContext) {
  return await rule(ruleId).run(ctx, {});
}

function element(input: Partial<UIElement> & { id: string; type: string }): UIElement {
  return {
    parentId: null,
    childrenIds: [],
    layout: { x: 0, y: 0, width: 10, height: 10 },
    ...input
  };
}

/** A document whose pages each hold one element tree, keyed by page id. */
function uiDocument(input: {
  surfaces: {
    id: string;
    name: string;
    kind?: "appSurface" | "stageSurface";
    rootElementId: string;
  }[];
  elements: UIElement[];
  components?: UIDocument["components"];
}): UIDocument {
  return {
    surfaces: input.surfaces.map((surface) => ({ kind: "appSurface", ...surface })),
    elements: Object.fromEntries(input.elements.map((entry) => [entry.id, entry])),
    ...(input.components ? { components: input.components } : {})
  } as unknown as UIDocument;
}

/** One page called "Main Page" whose root holds the given children. */
function onePage(...children: UIElement[]): UIDocument {
  return uiDocument({
    surfaces: [{ id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root" }],
    elements: [
      element({ id: "root", type: "nl.root", childrenIds: children.map((child) => child.id) }),
      ...children
    ]
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
      program: { kind: "graph", graphs: { events: { main: { id: "main", graph } }, functions: {} } }
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
    const findings = await run(
      "ui/unlocalized-text",
      unlocalizedContext(onePage(textWidget({ text: "Start Game" })))
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "ui/unlocalized-text",
      messageKey: "lint.rule.uiUnlocalizedText.message",
      messageParams: { text: "Start Game" },
      location: {
        kind: "surface",
        surfaceId: MAIN_APP_SURFACE_ID,
        surfaceName: "Main Page",
        elementName: "Greeting"
      },
      target: { kind: "uiSurface", surfaceId: MAIN_APP_SURFACE_ID }
    });
  });

  it("says nothing in a single-language project", async () => {
    // The case that decides whether this rule survives contact with a real project: writing the
    // words on the widget is not a defect until there is a second language to write them in.
    const document = onePage(textWidget({ text: "Start Game" }));

    expect(
      await run("ui/unlocalized-text", createTestLintContext({ uiDocument: document }))
    ).toEqual([]);
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
        `${JSON.stringify(text)} was reported`
      ).toEqual([]);
    }
  });

  it("reads a button's label and a text field's placeholder, each by its own binding prop", async () => {
    const document = onePage(
      element({ id: "start", type: "nl.button", name: "Start", props: { label: "Play" } }),
      element({
        id: "name",
        type: "nl.textInput",
        name: "Name",
        props: { placeholder: "Your name" }
      }),
      // A text input has no implicit-unit flag on its props, so only its named key binds it.
      element({
        id: "bound",
        type: "nl.textInput",
        name: "Bound",
        props: { placeholder: "Your name", placeholderLocalizationKey: "form.name" }
      })
    );

    const findings = await run("ui/unlocalized-text", unlocalizedContext(document));

    expect(findings.map((finding) => finding.messageParams?.text)).toEqual(["Play", "Your name"]);
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
      { id: "settings", name: "Settings", kind: secondKind, rootElementId: "root-settings" }
    ],
    elements: [
      element({ id: "root-main", type: "nl.root" }),
      element({ id: "root-settings", type: "nl.root" })
    ]
  });
}

function pageGraph(nodeType: string, surfaceId: string): BlueprintGraphIr {
  return {
    nodes: {
      head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
      open: { id: "open", type: nodeType, params: { surfaceId } }
    },
    edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "open", port: "in" } }]
  };
}

describe("ui/page-unreachable", () => {
  it("reports a page nothing opens", async () => {
    const findings = await run(
      "ui/page-unreachable",
      createTestLintContext({ uiDocument: twoPages(), blueprintDocument: NO_GRAPHS })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "ui/page-unreachable",
      messageKey: "lint.rule.uiPageUnreachable.message",
      location: { kind: "surface", surfaceId: "settings", surfaceName: "Settings" },
      target: { kind: "uiSurface", surfaceId: "settings" }
    });
    // The entry page is entered by name and navigated to by nothing; reporting it is the mistake
    // this rule exists not to make.
    expect(findings.map((finding) => finding.location)).not.toContainEqual(
      expect.objectContaining({ surfaceId: MAIN_APP_SURFACE_ID })
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
        blueprintDocument: blueprintDocument({ globalMain: pageGraph(nodeType, "settings") })
      });

      expect(await run("ui/page-unreachable", ctx), `${nodeType} was not read as a way in`).toEqual(
        []
      );
    }
  });

  it("reads the page a node names, not the node's presence", async () => {
    // A `Go Page` with no page chosen opens nothing, so the page it does not name is still
    // unreachable - the check is on the value, the way `blueprint/reference-missing` reads one.
    const ctx = createTestLintContext({
      uiDocument: twoPages(),
      blueprintDocument: blueprintDocument({
        globalMain: pageGraph(BLUEPRINT_NODE_TYPE_PAGE_GO, "  ")
      })
    });

    expect((await run("ui/page-unreachable", ctx)).map((finding) => finding.location)).toEqual([
      expect.objectContaining({ surfaceId: "settings" })
    ]);
  });

  it("says nothing about a page a Page widget embeds", async () => {
    const document = uiDocument({
      surfaces: [
        { id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root-main" },
        { id: "settings", name: "Settings", rootElementId: "root-settings" }
      ],
      elements: [
        element({ id: "root-main", type: "nl.root", childrenIds: ["frame"] }),
        element({
          id: "frame",
          type: UI_FRAME_ELEMENT_TYPE,
          props: { targetSurfaceId: "settings" }
        }),
        element({ id: "root-settings", type: "nl.root" })
      ]
    });

    expect(
      await run(
        "ui/page-unreachable",
        createTestLintContext({ uiDocument: document, blueprintDocument: NO_GRAPHS })
      )
    ).toEqual([]);
  });

  it("says nothing about a Game UI", async () => {
    // A stage surface is mounted into its slot by the engine, so "who navigates here" is not a
    // question that can be asked about one.
    expect(
      await run(
        "ui/page-unreachable",
        createTestLintContext({
          uiDocument: twoPages("stageSurface"),
          blueprintDocument: NO_GRAPHS
        })
      )
    ).toEqual([]);
  });

  it("treats every id on a node it cannot read as a way in", async () => {
    // A plugin's node is not in this build's catalogue, so what its params mean is unavailable.
    // Over-counting costs a page this rule stays quiet about; under-counting costs a warning on
    // a page that works.
    const graph: BlueprintGraphIr = {
      nodes: {
        plugin: { id: "plugin", type: "some-plugin.open-page", params: { destination: "settings" } }
      }
    };

    expect(
      await run(
        "ui/page-unreachable",
        createTestLintContext({
          uiDocument: twoPages(),
          blueprintDocument: blueprintDocument({ globalMain: graph })
        })
      )
    ).toEqual([]);
  });

  it("says nothing when a document could not be read", async () => {
    // `null` is a failed read, not a project with no graphs - answering it would report every
    // page but the entry one off one unrelated failure.
    expect(
      await run("ui/page-unreachable", createTestLintContext({ uiDocument: twoPages() }))
    ).toEqual([]);
    expect(
      await run("ui/page-unreachable", createTestLintContext({ blueprintDocument: NO_GRAPHS }))
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ui/empty-behavior
// ---------------------------------------------------------------------------

const SURFACE_OWNER_KEY = `surfaceMain:${MAIN_APP_SURFACE_ID}`;

function button(overrides: Partial<UIElement> = {}): UIElement {
  return element({
    id: "start",
    type: "nl.button",
    name: "Start",
    props: { label: "Play" },
    ...overrides
  });
}

function headGraph(type: string, params: Record<string, unknown> = {}): BlueprintGraphIr {
  return { nodes: { head: { id: "head", type, params } } };
}

describe("ui/empty-behavior", () => {
  it("reports a button nobody ever wired", async () => {
    const findings = await run(
      "ui/empty-behavior",
      createTestLintContext({ uiDocument: onePage(button()), blueprintDocument: NO_GRAPHS })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "ui/empty-behavior",
      messageKey: "lint.rule.uiEmptyBehavior.message",
      location: {
        kind: "surface",
        surfaceId: MAIN_APP_SURFACE_ID,
        elementId: "start",
        elementName: "Start"
      },
      target: { kind: "uiSurface", surfaceId: MAIN_APP_SURFACE_ID }
    });
  });

  it("says nothing about a button whose own record binds the click", async () => {
    const wired = button({
      behavior: {
        events: { mouseClick: { kind: "blueprintEvent", blueprintId: "bp", eventId: "onClick" } }
      }
    });

    expect(
      await run(
        "ui/empty-behavior",
        createTestLintContext({ uiDocument: onePage(wired), blueprintDocument: NO_GRAPHS })
      )
    ).toEqual([]);
  });

  it("says nothing about a button whose own blueprint starts on a click", async () => {
    // The graph's name is not consulted - the dispatcher looks for a head node of a type the
    // slot allows, in any of the blueprint's event graphs.
    const ctx = createTestLintContext({
      uiDocument: onePage(button()),
      blueprintDocument: blueprintDocument({
        [`widgetMain:${MAIN_APP_SURFACE_ID}:start`]: headGraph(
          BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK
        )
      })
    });

    expect(await run("ui/empty-behavior", ctx)).toEqual([]);
  });

  it("says nothing about a button an On Element Click head names", async () => {
    // The widget carries no binding at all in this shape, which is exactly the case a rule that
    // read only `behavior` would report as unwired.
    const ctx = createTestLintContext({
      uiDocument: onePage(button()),
      blueprintDocument: blueprintDocument({
        [SURFACE_OWNER_KEY]: headGraph(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, {
          surfaceId: MAIN_APP_SURFACE_ID,
          elementId: "start",
          elementType: "nl.button"
        })
      })
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
        element({
          id: "panel",
          type: "nl.container",
          childrenIds: ["start"],
          behavior: {
            events: {
              mouseClick: { kind: "blueprintEvent", blueprintId: "bp", eventId: "onClick" }
            }
          }
        }),
        button()
      ]
    });

    expect(
      await run(
        "ui/empty-behavior",
        createTestLintContext({ uiDocument: document, blueprintDocument: NO_GRAPHS })
      )
    ).toEqual([]);
  });

  it("says nothing about a control in a list whose rows are handled", async () => {
    const document = uiDocument({
      surfaces: [{ id: MAIN_APP_SURFACE_ID, name: "Main Page", rootElementId: "root" }],
      elements: [
        element({ id: "root", type: "nl.root", childrenIds: ["slots"] }),
        element({ id: "slots", type: "nl.list", childrenIds: ["start"] }),
        button()
      ]
    });
    const ctx = createTestLintContext({
      uiDocument: document,
      blueprintDocument: blueprintDocument({
        [`widgetMain:${MAIN_APP_SURFACE_ID}:slots`]: headGraph(
          BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK
        )
      })
    });

    expect(await run("ui/empty-behavior", ctx)).toEqual([]);
  });

  it("says nothing about a button that takes no clicks", async () => {
    const disabled = button({ props: { label: "Play", interactionDisabled: true } });

    expect(
      await run(
        "ui/empty-behavior",
        createTestLintContext({ uiDocument: onePage(disabled), blueprintDocument: NO_GRAPHS })
      )
    ).toEqual([]);
  });

  it("reports any widget left holding a stripped binding, and only those", async () => {
    // `noop` is not a state an author picks: it is what a binding degrades to when the graph it
    // pointed at is deleted, so an image wearing one used to do something. An image with no
    // binding at all never did, and is not this rule's business.
    const stripped = element({
      id: "art",
      type: "nl.image",
      name: "Cover",
      behavior: { events: { mouseClick: { kind: "noop" } } }
    });
    const plain = element({ id: "bg", type: "nl.image", name: "Backdrop" });

    const findings = await run(
      "ui/empty-behavior",
      createTestLintContext({ uiDocument: onePage(stripped, plain), blueprintDocument: NO_GRAPHS })
    );

    expect(
      findings.map((finding) =>
        finding.location.kind === "surface" ? finding.location.elementId : null
      )
    ).toEqual(["art"]);
  });
});
