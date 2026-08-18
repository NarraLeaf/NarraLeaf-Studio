import { describe, expect, it } from "vitest";
import {
  clampGraphNavZoom,
  FITTED_GRAPH_NAV,
  GRAPH_NAV_MAX_SCALE,
  GRAPH_NAV_MIN_SCALE,
  graphNavBox,
  graphNavPoint,
  graphNavZoomFactor,
  isFittedGraphNav,
  panGraphNav,
  zoomGraphNavAt,
  type GraphNav
} from "./graphCanvasNav";
import { graphNodeBox, sharedGraphViewport, type GraphNodeFacts } from "./graphDiffPlan";

/**
 * The arithmetic behind dragging and magnifying the blueprint canvas.
 *
 * All of it is here rather than in the component test next door, and deliberately: jsdom does no
 * layout, so a gesture cannot be felt in a test and nothing about how it feels is claimed in one.
 * What a test can hold is the algebra the gesture drives - that fit is identity, that the two
 * columns cannot come apart, that a wheel notch is bounded, and that a point on screen still names
 * the node under it once the view has moved.
 */

const NODES: readonly GraphNodeFacts[] = [
  { id: "n-a", type: "t", x: 0, y: 0 },
  { id: "n-b", type: "t", x: 600, y: 220 }
];

/** A column-sized frame, the way the canvas asks for one: half the pane, capped in height. */
const VIEWPORT = sharedGraphViewport([NODES], { width: 300, height: 200 });

describe("the view a fit produces", () => {
  it("is the identity, because the fitted picture is what fit already computed", () => {
    expect(isFittedGraphNav(FITTED_GRAPH_NAV)).toBe(true);

    const fitted = graphNodeBox(NODES[1]!, VIEWPORT);
    expect(graphNavBox(fitted, FITTED_GRAPH_NAV)).toEqual(fitted);
  });

  it("is not what a moved view reports, so the control can say whether there is anything to do", () => {
    expect(isFittedGraphNav(panGraphNav(FITTED_GRAPH_NAV, 1, 0))).toBe(false);
    expect(isFittedGraphNav({ zoom: 1.2, x: 0, y: 0 })).toBe(false);
  });
});

describe("panning", () => {
  it("moves the picture by the pointer's travel and leaves the scale alone", () => {
    const moved = panGraphNav({ zoom: 2, x: 10, y: -4 }, -30, 12);
    expect(moved).toEqual({ zoom: 2, x: -20, y: 8 });
  });

  it("ignores a delta that is not a number, rather than turning the view into NaN", () => {
    const nav: GraphNav = { zoom: 1.5, x: 3, y: 4 };
    expect(panGraphNav(nav, Number.NaN, 2)).toEqual(nav);
  });
});

describe("the band the zoom stays in", () => {
  /**
   * The bound is on the drawn scale, not on the multiplier: the same 8x is unremarkable on a
   * graph fitted at 0.06 and absurd on one fitted at 1.
   */
  it("is the fitted scale times the zoom, so it means the same thing at any fit", () => {
    expect(clampGraphNavZoom(1000, 0.2)).toBeCloseTo(GRAPH_NAV_MAX_SCALE / 0.2, 10);
    expect(clampGraphNavZoom(0.0001, 0.2)).toBeCloseTo(GRAPH_NAV_MIN_SCALE / 0.2, 10);
    expect(clampGraphNavZoom(1000, 1)).toBeCloseTo(GRAPH_NAV_MAX_SCALE, 10);
  });

  it("never pushes the fitted view itself out of reach", () => {
    // A graph so large that fitting it is already under the floor: zooming out below the whole
    // picture is refused, and the whole picture stays available.
    const tiny = 0.04;
    expect(clampGraphNavZoom(0.5, tiny)).toBe(1);
    expect(clampGraphNavZoom(1, tiny)).toBe(1);
    expect(clampGraphNavZoom(3, tiny)).toBe(3);
  });

  it("answers the fitted view for a zoom that is not a usable number", () => {
    expect(clampGraphNavZoom(Number.NaN, 0.5)).toBe(1);
    expect(clampGraphNavZoom(0, 0.5)).toBe(1);
    expect(clampGraphNavZoom(-2, 0.5)).toBe(1);
    expect(clampGraphNavZoom(2, 0)).toBe(2);
  });
});

describe("one wheel notch", () => {
  it("magnifies away from the author and shrinks towards them", () => {
    expect(graphNavZoomFactor(-100, 0, 360)).toBeGreaterThan(1);
    expect(graphNavZoomFactor(100, 0, 360)).toBeLessThan(1);
    expect(graphNavZoomFactor(0, 0, 360)).toBe(1);
  });

  it("is capped, so a coarse mouse cannot cross the whole band in one turn", () => {
    // Anything past the cap is the cap: a device reporting 100 per notch and one reporting
    // 4000 differ in how often they fire, not in what one turn does.
    expect(graphNavZoomFactor(-4000, 0, 360)).toBeCloseTo(graphNavZoomFactor(-100, 0, 360), 10);
    expect(graphNavZoomFactor(-100, 0, 360)).toBeLessThan(1.2);
  });

  it("reads a device that reports lines rather than pixels", () => {
    // deltaMode 1 is lines; two of them are a real distance, not two pixels.
    expect(graphNavZoomFactor(-2, 1, 360)).toBeGreaterThan(graphNavZoomFactor(-2, 0, 360));
  });
});

describe("zooming about a point", () => {
  it("leaves what is under the pointer where it is", () => {
    const nav: GraphNav = { zoom: 1.4, x: -60, y: 25 };
    const held = graphNavPoint(180, 90, nav);

    const zoomed = zoomGraphNavAt(nav, 1.6, 180, 90, VIEWPORT.scale);

    const after = graphNavBox({ left: held.x, top: held.y, width: 0, height: 0 }, zoomed);
    expect(after.left).toBeCloseTo(180, 10);
    expect(after.top).toBeCloseTo(90, 10);
  });

  it("still holds the anchor when the band refuses the zoom it was asked for", () => {
    const nav: GraphNav = { zoom: 1, x: 0, y: 0 };
    const zoomed = zoomGraphNavAt(nav, 10_000, 120, 40, VIEWPORT.scale);

    expect(zoomed.zoom).toBeCloseTo(GRAPH_NAV_MAX_SCALE / VIEWPORT.scale, 10);
    const held = graphNavPoint(120, 40, nav);
    const after = graphNavBox({ left: held.x, top: held.y, width: 0, height: 0 }, zoomed);
    expect(after.left).toBeCloseTo(120, 10);
    expect(after.top).toBeCloseTo(40, 10);
  });

  it("refuses a factor that is not a usable number", () => {
    const nav: GraphNav = { zoom: 1.4, x: -60, y: 25 };
    expect(zoomGraphNavAt(nav, Number.NaN, 10, 10, 0.5)).toEqual(nav);
    expect(zoomGraphNavAt(nav, 0, 10, 10, 0.5)).toEqual(nav);
  });
});

describe("the two columns", () => {
  /**
   * The whole reason the transform is held above both of them. A node at the same coordinates on
   * both sides is drawn at the same place on both sides at every stage of every gesture; if it
   * were not, "this node moved" would be a thing the canvas said about a node nobody touched.
   */
  it("draw a node that did not move in the same place, at every view", () => {
    const onBase: GraphNodeFacts = { id: "n-a", type: "t", x: 600, y: 220 };
    const onHead: GraphNodeFacts = { id: "n-a", type: "other", x: 600, y: 220 };

    const views: GraphNav[] = [
      FITTED_GRAPH_NAV,
      panGraphNav(FITTED_GRAPH_NAV, -140, 36),
      zoomGraphNavAt(panGraphNav(FITTED_GRAPH_NAV, -140, 36), 2.5, 90, 70, VIEWPORT.scale)
    ];

    for (const nav of views) {
      expect(graphNavBox(graphNodeBox(onBase, VIEWPORT), nav)).toEqual(
        graphNavBox(graphNodeBox(onHead, VIEWPORT), nav)
      );
    }
  });
});

describe("a point of the frame, in the graph's own coordinates", () => {
  /**
   * The two systems compose rather than compete: fit puts graph coordinates on screen, the view
   * moves that picture, and reading it back through both lands on the coordinates in the file.
   */
  it("names the node the pointer is over, after the view has been dragged and zoomed", () => {
    const nav = zoomGraphNavAt(panGraphNav(FITTED_GRAPH_NAV, -40, 12), 2, 120, 60, VIEWPORT.scale);
    const drawn = graphNavBox(graphNodeBox(NODES[1]!, VIEWPORT), nav);

    const fitted = graphNavPoint(drawn.left, drawn.top, nav);

    expect(VIEWPORT.x + fitted.x / VIEWPORT.scale).toBeCloseTo(NODES[1]!.x, 8);
    expect(VIEWPORT.y + fitted.y / VIEWPORT.scale).toBeCloseTo(NODES[1]!.y, 8);
  });
});
