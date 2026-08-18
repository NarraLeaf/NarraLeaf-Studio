import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_FIT_PADDING,
  boundsOfMeasuredNodes,
  clampBlueprintZoom,
  computeBlueprintZoomViewport
} from "./blueprintZoom";

/** React Flow's own default range, which this canvas does not override. */
const RANGE = { min: 0.5, max: 2 };
/** Wide open, for the cases where the point is the mode's arithmetic rather than the clamp. */
const OPEN = { min: 0.01, max: 100 };

/** A graph sitting away from the origin, so a mode that forgot to centre is visible. */
const BOUNDS = { x: 200, y: 100, width: 800, height: 400 };
const CONTAINER = { width: 1000, height: 600 };

/** Where the middle of the graph lands on screen for a viewport. */
function boundsCentreOnScreen(viewport: { x: number; y: number; zoom: number }) {
  return {
    x: (BOUNDS.x + BOUNDS.width / 2) * viewport.zoom + viewport.x,
    y: (BOUNDS.y + BOUNDS.height / 2) * viewport.zoom + viewport.y
  };
}

describe("computeBlueprintZoomViewport", () => {
  it("shows the whole graph in contain, with the breathing room the canvas opens at", () => {
    const v = computeBlueprintZoomViewport({
      mode: "contain",
      bounds: BOUNDS,
      container: CONTAINER,
      range: OPEN
    })!;

    const padded = 1 + BLUEPRINT_FIT_PADDING;
    expect(v.zoom).toBeCloseTo(Math.min(1000 / (padded * 800), 600 / (padded * 400)), 5);
    // Everything inside, and the padding really is left over rather than spent.
    expect(BOUNDS.width * v.zoom).toBeLessThan(1000);
    expect(BOUNDS.height * v.zoom).toBeLessThan(600);
  });

  it("leaves no empty side in cover, and no padding either", () => {
    const v = computeBlueprintZoomViewport({
      mode: "cover",
      bounds: BOUNDS,
      container: CONTAINER,
      range: OPEN
    })!;

    expect(v.zoom).toBeCloseTo(Math.max(1000 / 800, 600 / 400), 5);
    // The axis that decided it fills exactly; padding would have stopped short of the edge.
    expect(BOUNDS.height * v.zoom).toBeCloseTo(600, 5);
    expect(BOUNDS.width * v.zoom).toBeGreaterThan(1000);
  });

  it("spans the pane horizontally in width, whatever that does to the height", () => {
    const v = computeBlueprintZoomViewport({
      mode: "width",
      bounds: BOUNDS,
      container: CONTAINER,
      range: OPEN
    })!;

    expect(v.zoom).toBeCloseTo(1000 / ((1 + BLUEPRINT_FIT_PADDING) * 800), 5);
  });

  it("draws one graph pixel per screen pixel in actual", () => {
    const v = computeBlueprintZoomViewport({
      mode: "actual",
      bounds: BOUNDS,
      container: CONTAINER,
      range: OPEN
    })!;

    expect(v.zoom).toBe(1);
  });

  it("centres the graph in every mode, wherever its nodes happen to sit", () => {
    for (const mode of ["contain", "cover", "width", "actual"] as const) {
      const v = computeBlueprintZoomViewport({
        mode,
        bounds: BOUNDS,
        container: CONTAINER,
        range: OPEN
      })!;
      const centre = boundsCentreOnScreen(v);
      expect(centre.x).toBeCloseTo(500, 5);
      expect(centre.y).toBeCloseTo(300, 5);
    }
  });

  it("never asks for a zoom the canvas would refuse", () => {
    // A graph far larger than the pane: contain wants to zoom well below React Flow's floor.
    const huge = computeBlueprintZoomViewport({
      mode: "contain",
      bounds: { x: 0, y: 0, width: 40000, height: 20000 },
      container: CONTAINER,
      range: RANGE
    })!;
    expect(huge.zoom).toBe(RANGE.min);
    // And a single small node: cover wants far more than the ceiling.
    const tiny = computeBlueprintZoomViewport({
      mode: "cover",
      bounds: { x: 0, y: 0, width: 40, height: 20 },
      container: CONTAINER,
      range: RANGE
    })!;
    expect(tiny.zoom).toBe(RANGE.max);
    // Clamped or not, it is still centred - a clamped fit must not also be parked off screen.
    expect((20000 * huge.zoom) / 2 + huge.y).toBeCloseTo(300, 5);
  });

  it("refuses an empty graph and a pane that has not been laid out", () => {
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    expect(
      computeBlueprintZoomViewport({
        mode: "contain",
        bounds: empty,
        container: CONTAINER,
        range: RANGE
      })
    ).toBeNull();
    expect(
      computeBlueprintZoomViewport({
        mode: "contain",
        bounds: BOUNDS,
        container: { width: 0, height: 0 },
        range: RANGE
      })
    ).toBeNull();
    expect(
      computeBlueprintZoomViewport({
        mode: "contain",
        bounds: { x: 0, y: 0, width: Number.NaN, height: 10 },
        container: CONTAINER,
        range: RANGE
      })
    ).toBeNull();
  });
});

describe("boundsOfMeasuredNodes", () => {
  /** The three nodes of a small graph, at the sizes the canvas renders them. */
  const NODES = [
    { x: 80, y: 120, width: 200, height: 78 },
    { x: 300, y: 40, width: 200, height: 137 },
    { x: 540, y: 120, width: 200, height: 132 }
  ];

  it("contains every node, sizes included", () => {
    // The size is the whole point: the span of the positions alone is 460x80, and a fit
    // computed from that overshoots by a factor of nearly one and a half.
    expect(boundsOfMeasuredNodes(NODES)).toEqual({ x: 80, y: 40, width: 660, height: 212 });
  });

  it("survives a node the canvas has not measured yet", () => {
    const bounds = boundsOfMeasuredNodes([...NODES, { x: 900, y: 0, width: 0, height: 0 }])!;
    expect(bounds.width).toBe(820);
    expect(bounds.y).toBe(0);
  });

  it("has nothing to say about a graph with no nodes", () => {
    expect(boundsOfMeasuredNodes([])).toBeNull();
    // A position that is not a number would poison min/max for every other node.
    expect(boundsOfMeasuredNodes([{ x: Number.NaN, y: 0, width: 10, height: 10 }])).toBeNull();
  });
});

describe("clampBlueprintZoom", () => {
  it("holds a zoom inside what the canvas accepts", () => {
    expect(clampBlueprintZoom(5, RANGE)).toBe(RANGE.max);
    expect(clampBlueprintZoom(0.1, RANGE)).toBe(RANGE.min);
    expect(clampBlueprintZoom(1.25, RANGE)).toBe(1.25);
    expect(clampBlueprintZoom(Number.NaN, RANGE)).toBe(RANGE.min);
  });
});
