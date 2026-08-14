import { describe, expect, it } from "vitest";
import {
    SURFACE_FIT_DOCKER_INSET_PX,
    SURFACE_FIT_EDGE_INSET_PX,
    SURFACE_FIT_MAX_SCALE,
    SURFACE_FIT_OUTLINE_PANEL_INSET_PX,
    SURFACE_FIT_OUTLINE_TOGGLE_INSET_PX,
    SURFACE_FIT_TOOLBAR_INSET_PX,
    areViewportTransformsEqual,
    computeFitViewportTransform,
    resolveSurfaceFitInsets,
} from "./fitViewport";

const DESKTOP_DESIGN = { width: 1920, height: 1080 };

describe("computeFitViewportTransform", () => {
    it("scales a full-size interface down until all of it is inside the pane", () => {
        // The case this whole path exists for: a 1920x1080 interface in a pane a fraction of that.
        // At the previous default - scale 1, offset 0 - everything past 960x540 was off screen.
        const transform = computeFitViewportTransform({
            container: { width: 960, height: 540 },
            designSize: DESKTOP_DESIGN,
        })!;

        expect(transform.scale).toBeCloseTo(0.5, 5);
        expect(transform.offsetX).toBe(0);
        expect(transform.offsetY).toBe(0);
    });

    it("centres the interface on the axis the fit left slack on", () => {
        // A 2:1 pane against a 16:9 interface: height decides the scale, width has room to spare.
        const transform = computeFitViewportTransform({
            container: { width: 2160, height: 1080 },
            designSize: DESKTOP_DESIGN,
        })!;

        expect(transform.scale).toBeCloseTo(1, 5);
        expect(transform.offsetX).toBe(120);
        expect(transform.offsetY).toBe(0);
    });

    it("keeps the fit clear of the chrome drawn over the canvas", () => {
        const insets = resolveSurfaceFitInsets({ outlineCollapsed: false });
        const transform = computeFitViewportTransform({
            container: { width: 1600, height: 900 },
            designSize: DESKTOP_DESIGN,
            insets,
        })!;

        const boxWidth = 1600 - SURFACE_FIT_OUTLINE_PANEL_INSET_PX - SURFACE_FIT_EDGE_INSET_PX;
        const boxHeight = 900 - SURFACE_FIT_TOOLBAR_INSET_PX - SURFACE_FIT_DOCKER_INSET_PX;
        expect(transform.scale).toBeCloseTo(Math.min(boxWidth / 1920, boxHeight / 1080), 5);
        // Left edge of the interface clears the outline panel; top edge clears the tool bar.
        expect(transform.offsetX).toBeGreaterThanOrEqual(SURFACE_FIT_OUTLINE_PANEL_INSET_PX);
        expect(transform.offsetY).toBeGreaterThanOrEqual(SURFACE_FIT_TOOLBAR_INSET_PX);
        // And the far edges stay inside the pane.
        expect(transform.offsetX + 1920 * transform.scale).toBeLessThanOrEqual(1600);
        expect(transform.offsetY + 1080 * transform.scale).toBeLessThanOrEqual(900);
    });

    it("gives the collapsed outline panel back the space it no longer occupies", () => {
        const collapsed = resolveSurfaceFitInsets({ outlineCollapsed: true });
        expect(collapsed.left).toBe(SURFACE_FIT_OUTLINE_TOGGLE_INSET_PX);

        const container = { width: 1600, height: 900 };
        const withPanel = computeFitViewportTransform({
            container,
            designSize: DESKTOP_DESIGN,
            insets: resolveSurfaceFitInsets({ outlineCollapsed: false }),
        })!;
        const withoutPanel = computeFitViewportTransform({
            container,
            designSize: DESKTOP_DESIGN,
            insets: collapsed,
        })!;

        expect(withoutPanel.scale).toBeGreaterThan(withPanel.scale);
    });

    it("drops the insets rather than fit into a box smaller than they leave", () => {
        // A pane narrower than the outline panel: subtracting the chrome leaves nothing to fit into,
        // and an interface drawn under the panel but readable beats one beside it and microscopic.
        const transform = computeFitViewportTransform({
            container: { width: 280, height: 200 },
            designSize: DESKTOP_DESIGN,
            insets: resolveSurfaceFitInsets({ outlineCollapsed: false }),
        })!;

        expect(transform.scale).toBeCloseTo(280 / 1920, 5);
        expect(transform.offsetX).toBe(0);
    });

    it("scales a small interface up, but not past the point where it stops being a preview", () => {
        const transform = computeFitViewportTransform({
            container: { width: 1600, height: 900 },
            designSize: { width: 200, height: 60 },
        })!;

        expect(transform.scale).toBe(SURFACE_FIT_MAX_SCALE);
        // Still centred at the ceiling, rather than parked in a corner.
        expect(transform.offsetX).toBe(Math.round((1600 - 200 * SURFACE_FIT_MAX_SCALE) / 2));
        expect(transform.offsetY).toBe(Math.round((900 - 60 * SURFACE_FIT_MAX_SCALE) / 2));
    });

    it("refuses to fit into a pane it cannot measure", () => {
        // A hidden tab measures 0x0. Fitting to that parks the canvas somewhere the author has to
        // hunt for once the tab is shown again, so there is no answer worth returning.
        expect(computeFitViewportTransform({ container: { width: 0, height: 0 }, designSize: DESKTOP_DESIGN })).toBeNull();
        expect(
            computeFitViewportTransform({ container: { width: 800, height: 600 }, designSize: { width: 0, height: 0 } }),
        ).toBeNull();
        expect(
            computeFitViewportTransform({
                container: { width: Number.NaN, height: 600 },
                designSize: DESKTOP_DESIGN,
            }),
        ).toBeNull();
    });
});

describe("areViewportTransformsEqual", () => {
    it("ignores differences the canvas cannot draw", () => {
        expect(
            areViewportTransformsEqual(
                { scale: 0.5, offsetX: 100, offsetY: 40 },
                { scale: 0.50000001, offsetX: 100.2, offsetY: 40 },
            ),
        ).toBe(true);
    });

    it("separates transforms a viewer would see apart", () => {
        expect(
            areViewportTransformsEqual({ scale: 0.5, offsetX: 100, offsetY: 40 }, { scale: 0.51, offsetX: 100, offsetY: 40 }),
        ).toBe(false);
        expect(
            areViewportTransformsEqual({ scale: 0.5, offsetX: 100, offsetY: 40 }, { scale: 0.5, offsetX: 108, offsetY: 40 }),
        ).toBe(false);
    });
});
