import { describe, expect, it } from "vitest";
import {
  UI_DOCUMENT_SCHEMA_VERSION,
  type UIDocument,
  type UIElement
} from "@shared/types/ui-editor/document";
import { UIDocumentContentRevisions } from "./uiDocumentContentRevisions";

function element(
  id: string,
  parentId: string | null,
  childrenIds: string[] = [],
  overrides: Partial<UIElement> = {}
): UIElement {
  return {
    id,
    type: "nl.container",
    name: id,
    parentId,
    childrenIds,
    layout: { x: 0, y: 0, width: 100, height: 100, visible: true, opacity: 1 },
    ...overrides
  };
}

function documentWithTwoSurfaces(): UIDocument {
  return {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "ui-doc",
    name: "UI",
    surfaces: [
      {
        id: "surface-a",
        name: "A",
        host: "app",
        kind: "appSurface",
        designSize: { width: 1280, height: 720 },
        rootElementId: "root-a"
      },
      {
        id: "surface-b",
        name: "B",
        host: "app",
        kind: "appSurface",
        designSize: { width: 1280, height: 720 },
        rootElementId: "root-b"
      }
    ],
    components: [],
    elements: {
      "root-a": element("root-a", null, ["child-a"]),
      "child-a": element("child-a", "root-a"),
      "root-b": element("root-b", null, ["child-b"]),
      "child-b": element("child-b", "root-b")
    },
    meta: {}
  };
}

describe("UIDocumentContentRevisions", () => {
  it("bumps only the surface whose own content changed", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();

    const firstA = revisions.getSurfaceContentRevision(document, 1, "surface-a");
    const firstB = revisions.getSurfaceContentRevision(document, 1, "surface-b");

    document.elements["child-a"].layout.x = 40;
    const secondA = revisions.getSurfaceContentRevision(document, 2, "surface-a");
    const secondB = revisions.getSurfaceContentRevision(document, 2, "surface-b");

    expect(secondA).not.toBe(firstA);
    expect(secondB).toBe(firstB);
  });

  it("holds still when the document revision moves but the surface did not change", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();

    const first = revisions.getSurfaceContentRevision(document, 1, "surface-a");
    document.elements["child-b"].layout.x = 40;

    expect(revisions.getSurfaceContentRevision(document, 2, "surface-a")).toBe(first);
    expect(revisions.getSurfaceContentRevision(document, 3, "surface-a")).toBe(first);
  });

  it("notices a rename of the surface record itself", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();

    const first = revisions.getSurfaceContentRevision(document, 1, "surface-a");
    document.surfaces[0].name = "Renamed";

    expect(revisions.getSurfaceContentRevision(document, 2, "surface-a")).not.toBe(first);
  });

  // A Page component renders its target page inside the card, so an edit over there is visible here.
  it("follows a Page component to the page it renders", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();
    document.elements["child-a"] = element("child-a", "root-a", [], {
      type: "nl.frame",
      props: { targetSurfaceId: "surface-b", params: {}, navigationMode: "static" }
    });

    const first = revisions.getSurfaceContentRevision(document, 1, "surface-a");
    document.elements["child-b"].layout.x = 40;

    expect(revisions.getSurfaceContentRevision(document, 2, "surface-a")).not.toBe(first);
  });

  it("survives a Page component pointing back at its own page", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();
    document.elements["child-a"] = element("child-a", "root-a", [], {
      type: "nl.frame",
      props: { targetSurfaceId: "surface-a", params: {}, navigationMode: "static" }
    });

    expect(() => revisions.getSurfaceContentRevision(document, 1, "surface-a")).not.toThrow();
  });

  it("follows the component library only for surfaces that instance a component", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();
    document.components = [
      {
        id: "component-a",
        name: "Card",
        rootElementId: "component-root",
        elements: { "component-root": element("component-root", null) }
      }
    ];
    document.elements["child-a"] = element("child-a", "root-a", [], {
      extra: { componentLink: { componentId: "component-a", linked: true } }
    });

    const firstA = revisions.getSurfaceContentRevision(document, 1, "surface-a");
    const firstB = revisions.getSurfaceContentRevision(document, 1, "surface-b");

    document.components[0].elements["component-root"].layout.x = 40;

    expect(revisions.getSurfaceContentRevision(document, 2, "surface-a")).not.toBe(firstA);
    expect(revisions.getSurfaceContentRevision(document, 2, "surface-b")).toBe(firstB);
  });

  it("tracks components one by one", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();
    document.components = [
      {
        id: "component-a",
        name: "A",
        rootElementId: "a-root",
        elements: { "a-root": element("a-root", null) }
      },
      {
        id: "component-b",
        name: "B",
        rootElementId: "b-root",
        elements: { "b-root": element("b-root", null) }
      }
    ];

    const firstA = revisions.getComponentContentRevision(document, 1, "component-a");
    const firstB = revisions.getComponentContentRevision(document, 1, "component-b");

    document.components[0].name = "A renamed";

    expect(revisions.getComponentContentRevision(document, 2, "component-a")).not.toBe(firstA);
    expect(revisions.getComponentContentRevision(document, 2, "component-b")).toBe(firstB);
  });

  // A document that was replaced (loaded, or restored by version control) comes back on document
  // revision 0, which is a revision the cache has already answered for.
  it("moves past what a card remembers when the document is replaced under it", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();

    const before = revisions.getSurfaceContentRevision(document, 0, "surface-a");
    revisions.reset();
    document.elements["child-a"].layout.x = 40;

    const after = revisions.getSurfaceContentRevision(document, 0, "surface-a");
    expect(after).toBeGreaterThan(before);
  });

  it("does not restart counting at 1 after a reset", () => {
    const revisions = new UIDocumentContentRevisions();
    const document = documentWithTwoSurfaces();

    revisions.getSurfaceContentRevision(document, 0, "surface-a");
    document.elements["child-a"].layout.x = 40;
    const beforeReset = revisions.getSurfaceContentRevision(document, 1, "surface-a");
    revisions.reset();

    expect(revisions.getSurfaceContentRevision(document, 0, "surface-a")).toBeGreaterThanOrEqual(
      beforeReset
    );
  });
});
