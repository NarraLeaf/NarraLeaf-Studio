import { describe, expect, it, vi } from "vitest";
import {
  UI_DOCUMENT_SCHEMA_VERSION,
  type UIDocument,
  type UIElement,
  type UILayout
} from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
  computeUiEditorAlignPatches,
  getUiEditorAlignAvailability,
  uiEditorAlign,
  type UiEditorAlignOp
} from "./uiEditorAlign";

type Box = { x: number; y: number; width: number; height: number };

function element(
  id: string,
  type: string,
  parentId: string | null,
  layout: Box,
  childrenIds: string[] = [],
  extra?: Record<string, unknown>
): UIElement {
  return { id, type, parentId, childrenIds, layout, extra };
}

/**
 * root(800x600)
 *   a  (10,10,100,50)
 *   b  (200,80,60,40)
 *   c  (400,300,120,90)
 *   panel (300,400,200,100)
 *     inner (20,10,40,20)
 */
function makeDocument(): UIDocument {
  return {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
      {
        id: "surface",
        name: "Surface",
        host: "app",
        kind: "appSurface",
        designSize: { width: 800, height: 600 },
        rootElementId: "root"
      }
    ],
    elements: {
      root: element("root", "nl.root", null, { x: 0, y: 0, width: 800, height: 600 }, [
        "a",
        "b",
        "c",
        "panel"
      ]),
      a: element("a", "nl.text", "root", { x: 10, y: 10, width: 100, height: 50 }),
      b: element("b", "nl.text", "root", { x: 200, y: 80, width: 60, height: 40 }),
      c: element("c", "nl.text", "root", { x: 400, y: 300, width: 120, height: 90 }),
      panel: element("panel", "nl.container", "root", { x: 300, y: 400, width: 200, height: 100 }, [
        "inner"
      ]),
      inner: element("inner", "nl.text", "panel", { x: 20, y: 10, width: 40, height: 20 })
    }
  };
}

function selection(ids: string[], surfaceId = "surface"): UIElementSelection {
  return { editor: "ui", surfaceId, elementIds: ids, primaryId: ids[ids.length - 1] };
}

function patches(doc: UIDocument, ids: string[], op: UiEditorAlignOp) {
  return computeUiEditorAlignPatches(doc, "surface", selection(ids), op);
}

/** Applies the patches the way `updateElementLayouts` would, so a second press can be measured. */
function apply(doc: UIDocument, result: Record<string, Partial<UILayout>>): void {
  for (const [id, patch] of Object.entries(result)) {
    const el = doc.elements[id];
    el.layout = {
      ...el.layout,
      ...patch,
      x: Math.round(((patch.x ?? el.layout.x) as number) * 100) / 100,
      y: Math.round(((patch.y ?? el.layout.y) as number) * 100) / 100
    };
  }
}

describe("UI editor align, bounding box anchor", () => {
  // a, b, c span x 10..520 and y 10..390.
  it("aligns to the left edge of the selection box", () => {
    expect(patches(makeDocument(), ["a", "b", "c"], "left")).toEqual({
      b: { x: 10 },
      c: { x: 10 }
    });
  });

  it("centres horizontally inside the selection box", () => {
    // box.left 10, box.width 510 -> centre 265.
    expect(patches(makeDocument(), ["a", "b", "c"], "horizontalCenter")).toEqual({
      a: { x: 215 },
      b: { x: 235 },
      c: { x: 205 }
    });
  });

  it("aligns to the right edge of the selection box", () => {
    expect(patches(makeDocument(), ["a", "b", "c"], "right")).toEqual({
      a: { x: 420 },
      b: { x: 460 }
    });
  });

  it("aligns to the top edge of the selection box", () => {
    expect(patches(makeDocument(), ["a", "b", "c"], "top")).toEqual({
      b: { y: 10 },
      c: { y: 10 }
    });
  });

  it("centres vertically inside the selection box", () => {
    // box.top 10, box.height 380 -> centre 200.
    expect(patches(makeDocument(), ["a", "b", "c"], "verticalCenter")).toEqual({
      a: { y: 175 },
      b: { y: 180 },
      c: { y: 155 }
    });
  });

  it("aligns to the bottom edge of the selection box", () => {
    expect(patches(makeDocument(), ["a", "b", "c"], "bottom")).toEqual({
      a: { y: 340 },
      b: { y: 350 }
    });
  });

  it("does not use the first selected id as the anchor", () => {
    // Selecting the same three in any order must land on the same box edge, because the canvas
    // rewrites `elementIds` in DOM hit order on every marquee.
    const forwards = patches(makeDocument(), ["a", "b", "c"], "left");
    const backwards = patches(makeDocument(), ["c", "b", "a"], "left");
    expect(backwards).toEqual(forwards);
  });
});

describe("UI editor align, surface space across parents", () => {
  it("lines a nested element up with a top-level one on screen", () => {
    // `inner` sits at surface x 320 (panel 300 + 20); aligning it left with `a` (surface x 10)
    // puts its visual edge at 10, which is local x 10 - 300 = -290 inside the panel.
    const result = patches(makeDocument(), ["a", "inner"], "left");
    expect(result).toEqual({ inner: { x: -290 } });
  });
});

describe("UI editor align, single selection", () => {
  it("centres a top-level element inside the surface frame", () => {
    expect(patches(makeDocument(), ["a"], "horizontalCenter")).toEqual({ a: { x: 350 } });
    expect(patches(makeDocument(), ["a"], "verticalCenter")).toEqual({ a: { y: 275 } });
  });

  it("centres a nested element inside its own container, not the surface", () => {
    // panel is 200x100; inner is 40x20 -> local 80,40.
    expect(patches(makeDocument(), ["inner"], "horizontalCenter")).toEqual({ inner: { x: 80 } });
    expect(patches(makeDocument(), ["inner"], "verticalCenter")).toEqual({ inner: { y: 40 } });
  });

  it("aligns a nested element to its container's edges", () => {
    expect(patches(makeDocument(), ["inner"], "left")).toEqual({ inner: { x: 0 } });
    expect(patches(makeDocument(), ["inner"], "right")).toEqual({ inner: { x: 160 } });
    expect(patches(makeDocument(), ["inner"], "bottom")).toEqual({ inner: { y: 80 } });
  });

  it("has nothing to distribute", () => {
    expect(patches(makeDocument(), ["inner"], "distributeHorizontal")).toEqual({});
  });
});

describe("UI editor distribute", () => {
  it("needs three elements", () => {
    expect(patches(makeDocument(), ["a", "b"], "distributeHorizontal")).toEqual({});
    expect(patches(makeDocument(), ["a", "b"], "distributeVertical")).toEqual({});
  });

  it("equalises the gaps between three boxes, leaving the extremes put", () => {
    // Span 10..520 = 510, occupied 100+60+120 = 280, so each of the two gaps is 115.
    // b starts at 10+100+115 = 225.
    expect(patches(makeDocument(), ["a", "b", "c"], "distributeHorizontal")).toEqual({
      b: { x: 225 }
    });
  });

  it("equalises unequal gaps across four boxes", () => {
    const doc = makeDocument();
    doc.elements.a.layout = { x: 0, y: 0, width: 20, height: 10 };
    doc.elements.b.layout = { x: 30, y: 0, width: 40, height: 10 };
    doc.elements.c.layout = { x: 200, y: 0, width: 20, height: 10 };
    doc.elements.panel.layout = { x: 300, y: 0, width: 20, height: 10 };
    // Span 0..320 = 320, occupied 100, three gaps of 220/3.
    const result = computeUiEditorAlignPatches(
      doc,
      "surface",
      selection(["a", "b", "c", "panel"]),
      "distributeHorizontal"
    );
    expect(Object.keys(result).sort()).toEqual(["b", "c"]);
    expect(result.b.x).toBeCloseTo(20 + 220 / 3, 6);
    expect(result.c.x).toBeCloseTo(20 + 220 / 3 + 40 + 220 / 3, 6);
  });

  it("orders by position, not by selection order", () => {
    const doc = makeDocument();
    doc.elements.a.layout = { x: 0, y: 0, width: 20, height: 10 };
    doc.elements.b.layout = { x: 500, y: 0, width: 20, height: 10 };
    doc.elements.c.layout = { x: 100, y: 0, width: 20, height: 10 };
    // c is the middle one by position even though it is selected last.
    // Span 0..520, occupied 60, two gaps of 230 -> c starts at 20 + 230.
    const result = computeUiEditorAlignPatches(
      doc,
      "surface",
      selection(["a", "b", "c"]),
      "distributeHorizontal"
    );
    expect(Object.keys(result)).toEqual(["c"]);
    expect(result.c.x).toBeCloseTo(250, 6);
  });

  it("distributes vertically on the y axis", () => {
    const doc = makeDocument();
    doc.elements.a.layout = { x: 0, y: 0, width: 10, height: 20 };
    doc.elements.b.layout = { x: 0, y: 30, width: 10, height: 40 };
    doc.elements.c.layout = { x: 0, y: 200, width: 10, height: 20 };
    // Span 0..220 = 220, occupied 80, two gaps of 70. b starts at 20+70 = 90.
    const result = computeUiEditorAlignPatches(
      doc,
      "surface",
      selection(["a", "b", "c"]),
      "distributeVertical"
    );
    expect(result).toEqual({ b: { y: 90 } });
  });
});

describe("UI editor align, negative extents", () => {
  it("reads the visual edge from a negative width and writes the anchor back", () => {
    const doc = makeDocument();
    // Visual box is x 100..200: anchor 200 with width -100.
    doc.elements.b.layout = { x: 200, y: 80, width: -100, height: 40 };
    // Selection box is now x 10..520 (a at 10, c at 400..520).
    const result = computeUiEditorAlignPatches(doc, "surface", selection(["a", "b", "c"]), "left");
    // Visual left must land on 10, so the anchor goes to 10 - min(0, -100) = 110.
    expect(result.b).toEqual({ x: 110 });
    expect(result.c).toEqual({ x: 10 });
  });

  it("measures a negative-height box by its absolute extent", () => {
    const doc = makeDocument();
    doc.elements.b.layout = { x: 200, y: 120, width: 60, height: -40 };
    // b's visual box is y 80..120, unchanged from the baseline, so bottom alignment matches it.
    const result = computeUiEditorAlignPatches(
      doc,
      "surface",
      selection(["a", "b", "c"]),
      "bottom"
    );
    expect(result.b).toEqual({ y: 390 });
  });
});

describe("UI editor align, excluded elements", () => {
  it("skips a flow-layout child, whose x and y are zeroed on every write", () => {
    const doc = makeDocument();
    doc.elements.panel.props = { layoutKind: "stack" };
    const result = computeUiEditorAlignPatches(
      doc,
      "surface",
      selection(["a", "b", "inner"]),
      "left"
    );
    expect(result).toEqual({ b: { x: 10 } });
  });

  it("skips slider track and handle slots", () => {
    const doc = makeDocument();
    doc.elements.panel = element(
      "panel",
      "nl.slider",
      "root",
      { x: 300, y: 400, width: 200, height: 100 },
      ["inner"]
    );
    doc.elements.inner = element(
      "inner",
      "nl.container",
      "panel",
      { x: 20, y: 10, width: 40, height: 20 },
      [],
      { sliderSlot: "handle" }
    );
    const result = computeUiEditorAlignPatches(
      doc,
      "surface",
      selection(["a", "b", "inner"]),
      "left"
    );
    expect(result).toEqual({ b: { x: 10 } });
  });

  it("skips switch track and thumb slots", () => {
    const doc = makeDocument();
    doc.elements.panel = element(
      "panel",
      "nl.switch",
      "root",
      { x: 300, y: 400, width: 52, height: 28 },
      ["inner"]
    );
    doc.elements.inner = element(
      "inner",
      "nl.container",
      "panel",
      { x: 3, y: 3, width: 22, height: 22 },
      [],
      { switchSlot: "thumb" }
    );
    const result = computeUiEditorAlignPatches(
      doc,
      "surface",
      selection(["a", "b", "inner"]),
      "left"
    );
    expect(result).toEqual({ b: { x: 10 } });
  });

  it("still aligns a switch child that carries no slot", () => {
    // Guards the pair of conditions: the exclusion is "a switch part", not "anything under a
    // switch". Without the `switchSlot` check the case above would pass for the wrong reason.
    const doc = makeDocument();
    doc.elements.panel = element(
      "panel",
      "nl.switch",
      "root",
      { x: 300, y: 400, width: 52, height: 28 },
      ["inner"]
    );
    doc.elements.inner = element("inner", "nl.container", "panel", {
      x: 3,
      y: 3,
      width: 22,
      height: 22
    });
    const result = computeUiEditorAlignPatches(
      doc,
      "surface",
      selection(["a", "b", "inner"]),
      "left"
    );
    expect(result).toEqual({ b: { x: 10 }, inner: { x: -290 } });
  });

  it("skips the surface root", () => {
    expect(patches(makeDocument(), ["root"], "left")).toEqual({});
    // Root plus a child is empty rather than "align the child": the top-level-mover filter drops
    // anything whose ancestor is also selected, and then the root itself is not movable. Same
    // outcome as arrange, and select-all never puts the root in the selection to begin with.
    expect(patches(makeDocument(), ["root", "a"], "horizontalCenter")).toEqual({});
  });

  it("drops descendants when their ancestor is selected too", () => {
    // `inner` is inside `panel`, so only `panel` moves - the child rides along.
    const result = patches(makeDocument(), ["a", "panel", "inner"], "left");
    expect(result).toEqual({ panel: { x: 10 } });
  });
});

describe("UI editor align, idempotence and guards", () => {
  it("produces nothing on a second identical press", () => {
    const doc = makeDocument();
    const first = patches(doc, ["a", "b", "c"], "horizontalCenter");
    expect(Object.keys(first).length).toBeGreaterThan(0);
    apply(doc, first);
    expect(patches(doc, ["a", "b", "c"], "horizontalCenter")).toEqual({});
  });

  it("produces nothing when the distribution is already even", () => {
    const doc = makeDocument();
    const first = patches(doc, ["a", "b", "c"], "distributeHorizontal");
    apply(doc, first);
    expect(patches(doc, ["a", "b", "c"], "distributeHorizontal")).toEqual({});
  });

  it("ignores a selection that belongs to another surface", () => {
    const doc = makeDocument();
    expect(
      computeUiEditorAlignPatches(doc, "surface", selection(["a", "b", "c"], "other"), "left")
    ).toEqual({});
    expect(computeUiEditorAlignPatches(doc, "other", selection(["a", "b", "c"]), "left")).toEqual(
      {}
    );
  });

  it("ignores a null selection", () => {
    expect(computeUiEditorAlignPatches(makeDocument(), "surface", null, "left")).toEqual({});
  });
});

describe("getUiEditorAlignAvailability", () => {
  it("switches everything off without a selection", () => {
    expect(getUiEditorAlignAvailability(makeDocument(), "surface", null)).toEqual({
      left: false,
      horizontalCenter: false,
      right: false,
      top: false,
      verticalCenter: false,
      bottom: false,
      distributeHorizontal: false,
      distributeVertical: false
    });
  });

  it("offers alignment but not distribution for two elements", () => {
    const av = getUiEditorAlignAvailability(makeDocument(), "surface", selection(["a", "b"]));
    expect(av.left).toBe(true);
    expect(av.verticalCenter).toBe(true);
    expect(av.distributeHorizontal).toBe(false);
    expect(av.distributeVertical).toBe(false);
  });

  it("offers distribution for three", () => {
    const av = getUiEditorAlignAvailability(makeDocument(), "surface", selection(["a", "b", "c"]));
    expect(av.distributeHorizontal).toBe(true);
    expect(av.distributeVertical).toBe(true);
  });
});

describe("uiEditorAlign write path", () => {
  function harness(doc: UIDocument) {
    const updateElementLayouts = vi.fn();
    const documentService = {
      getDocument: () => doc,
      updateElementLayouts
    } as unknown as UIDocumentService;
    return { documentService, updateElementLayouts };
  }

  it("writes every moved element in one call", () => {
    const doc = makeDocument();
    const { documentService, updateElementLayouts } = harness(doc);

    expect(
      uiEditorAlign(documentService, "surface", selection(["a", "b", "c"]), "horizontalCenter")
    ).toBe(true);

    expect(updateElementLayouts).toHaveBeenCalledTimes(1);
    expect(updateElementLayouts).toHaveBeenCalledWith({
      a: { x: 215 },
      b: { x: 235 },
      c: { x: 205 }
    });
  });

  it("writes nothing when the selection is already aligned", () => {
    const doc = makeDocument();
    doc.elements.b.layout = { x: 10, y: 80, width: 60, height: 40 };
    doc.elements.c.layout = { x: 10, y: 300, width: 120, height: 90 };
    const { documentService, updateElementLayouts } = harness(doc);

    expect(uiEditorAlign(documentService, "surface", selection(["a", "b", "c"]), "left")).toBe(
      false
    );
    expect(updateElementLayouts).not.toHaveBeenCalled();
  });

  it("writes nothing for a selection on another surface", () => {
    const { documentService, updateElementLayouts } = harness(makeDocument());

    expect(
      uiEditorAlign(documentService, "surface", selection(["a", "b", "c"], "other"), "left")
    ).toBe(false);
    expect(updateElementLayouts).not.toHaveBeenCalled();
  });
});
