import { describe, expect, it } from "vitest";
import {
  BRAND_REFERENCE_SEPARATOR,
  collectBrandLinkReferences,
  countBrandLinkReferences
} from "./brandReferences";

/**
 * The reference scan.
 *
 * Two properties matter more than any individual case here, and both have a test of their own:
 *
 *  - it finds a link **wherever** it is, because the alternative design (a list of props known to
 *    hold colours) is what this exists instead of - an under-count is what lets a delete take a
 *    colour out from under a widget nobody knew was using it;
 *  - it never throws on a broken document, because a document broken enough to break the scan is
 *    exactly the document the report is being run on.
 */

/** A surface, one named element, one unnamed one, and a component - the shapes `where` reads from. */
function sampleUiDocument(): unknown {
  return {
    schemaVersion: 11,
    id: "doc",
    name: "UI",
    surfaces: [
      {
        id: "s1",
        name: "Main Menu",
        host: "app",
        kind: "appSurface",
        rootElementId: "root",
        settings: { backgroundColor: "nlbrand:background" }
      }
    ],
    elements: {
      root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["start", "plain"] },
      start: {
        id: "start",
        type: "nl.button",
        name: "Start",
        parentId: "root",
        childrenIds: [],
        style: { backgroundColor: "nlbrand:button.primary", borderColor: "#123456" },
        props: { label: "Start", shadows: [{ color: "nlbrand:button.shadow/0.5" }] }
      },
      plain: {
        id: "plain",
        type: "nl.text",
        parentId: "root",
        childrenIds: [],
        style: { color: "nlbrand:text.muted" }
      }
    },
    components: [
      {
        id: "c1",
        name: "Badge",
        rootElementId: "badgeRoot",
        elements: {
          badgeRoot: {
            id: "badgeRoot",
            type: "nl.container",
            style: { backgroundColor: "nlbrand:primary" }
          }
        }
      }
    ]
  };
}

describe("collectBrandLinkReferences", () => {
  it("finds links nested anywhere under an element, not only on known props", () => {
    const refs = collectBrandLinkReferences({ uidoc: sampleUiDocument() });
    // Keyed by site, not by path: two elements can carry the same prop path.
    const byPath = new Map(
      refs.map((ref) => [
        `${ref.location.elementId ?? ref.location.surfaceId}:${ref.location.propPath}`,
        ref.id
      ])
    );

    expect(byPath.get("start:style.backgroundColor")).toBe("button.primary");
    // Inside an array, inside an object, on a prop nothing has been taught about.
    expect(byPath.get("start:props.shadows[0].color")).toBe("button.shadow");
    expect(byPath.get("s1:settings.backgroundColor")).toBe("background");
  });

  it("names the site by surface and element, and keeps the ids beside it", () => {
    const refs = collectBrandLinkReferences({ uidoc: sampleUiDocument() });
    const start = refs.find((ref) => ref.location.propPath === "style.backgroundColor");

    expect(start?.where).toBe(
      ["Main Menu", "Start", "style.backgroundColor"].join(BRAND_REFERENCE_SEPARATOR)
    );
    expect(start?.location).toEqual({
      surfaceId: "s1",
      elementId: "start",
      propPath: "style.backgroundColor"
    });
  });

  it("falls back to the element type when it was never named", () => {
    const refs = collectBrandLinkReferences({ uidoc: sampleUiDocument() });
    const plain = refs.find((ref) => ref.location.elementId === "plain");

    // `nl.text` rather than the uuid-shaped id: the layer list names an unnamed element the same
    // way, and a finding spelled as an id is one nobody can act on.
    expect(plain?.where).toBe(
      ["Main Menu", "nl.text", "style.color"].join(BRAND_REFERENCE_SEPARATOR)
    );
  });

  it("reads a component's own element table", () => {
    const refs = collectBrandLinkReferences({ uidoc: sampleUiDocument() });
    const badge = refs.find((ref) => ref.location.elementId === "badgeRoot");

    expect(badge?.id).toBe("primary");
    expect(badge?.where).toBe(
      ["Badge", "nl.container", "style.backgroundColor"].join(BRAND_REFERENCE_SEPARATOR)
    );
    // Not a surface, so nothing that would open a surface editor at it.
    expect(badge?.location.surfaceId).toBeUndefined();
  });

  it("says nothing about strings that are not links", () => {
    const refs = collectBrandLinkReferences({
      uidoc: {
        elements: {
          e1: {
            id: "e1",
            type: "nl.text",
            name: "nlbrand is not a link",
            style: {
              color: "#40A8C4",
              border: "rgba(0, 0, 0, 0.35)",
              other: "nlbrand:",
              // Starts with the scheme but is not in the grammar, so it is not a link -
              // and reporting it as one would name an id nothing could ever resolve.
              broken: "nlbrand:Primary",
              alpha: "nlbrand:primary/5"
            }
          }
        }
      }
    });

    expect(refs).toEqual([]);
  });

  it("reads characters as a list, a map, or the document around one", () => {
    const profile = { id: "ch1", name: "Narra", color: "nlbrand:primary" };
    const shapes: unknown[] = [[profile], { ch1: profile }, { characters: [profile] }];

    for (const shape of shapes) {
      const refs = collectBrandLinkReferences({ characters: shape });
      expect(refs).toEqual([
        {
          id: "primary",
          where: ["Narra", "color"].join(BRAND_REFERENCE_SEPARATOR),
          location: { characterId: "ch1", propPath: "color" }
        }
      ]);
    }
  });

  it("reads an absent input as no references", () => {
    expect(collectBrandLinkReferences({})).toEqual([]);
    expect(collectBrandLinkReferences({ uidoc: null, characters: undefined })).toEqual([]);
  });

  it("survives a document of the wrong shape entirely", () => {
    const nonsense: unknown[] = [
      "a string",
      42,
      [],
      [1, 2, 3],
      { surfaces: "not an array", elements: 7, components: {} },
      { surfaces: [null, 3, {}], elements: { e1: null, e2: "x" } }
    ];

    for (const uidoc of nonsense) {
      expect(() => collectBrandLinkReferences({ uidoc })).not.toThrow();
      expect(collectBrandLinkReferences({ uidoc })).toEqual([]);
    }
  });

  it("survives a document that references itself", () => {
    const element: Record<string, unknown> = {
      id: "e1",
      type: "nl.container",
      style: { backgroundColor: "nlbrand:primary" }
    };
    element.self = element;
    element.children = [element];

    const refs = collectBrandLinkReferences({ uidoc: { elements: { e1: element } } });

    expect(refs).toHaveLength(1);
    expect(refs[0]?.id).toBe("primary");
  });

  it("survives an element tree that loops through childrenIds", () => {
    const uidoc = {
      surfaces: [{ id: "s1", name: "Loop", rootElementId: "a" }],
      elements: {
        a: {
          id: "a",
          type: "nl.container",
          childrenIds: ["b"],
          style: { color: "nlbrand:primary" }
        },
        b: { id: "b", type: "nl.container", childrenIds: ["a"] }
      }
    };

    expect(collectBrandLinkReferences({ uidoc })).toHaveLength(1);
  });
});

describe("countBrandLinkReferences", () => {
  it("counts every site an id is used at", () => {
    const counts = countBrandLinkReferences(
      collectBrandLinkReferences({ uidoc: sampleUiDocument() })
    );

    expect(counts.get("button.primary")).toBe(1);
    expect(counts.get("primary")).toBe(1);
    // An id nothing points at is absent rather than zero, so a caller can ask `?? 0` and a
    // "0 places use this" branch cannot be reached by accident.
    expect(counts.has("secondary")).toBe(false);
  });

  it("counts nothing as nothing", () => {
    expect(countBrandLinkReferences([]).size).toBe(0);
  });
});
