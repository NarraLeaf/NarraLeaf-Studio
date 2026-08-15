import { describe, expect, it } from "vitest";
import {
    SURFACE_FIT_DOCKER_INSET_PX,
    SURFACE_FIT_EDGE_INSET_PX,
    SURFACE_FIT_MAX_SCALE,
    SURFACE_FIT_OUTLINE_PANEL_INSET_PX,
    SURFACE_FIT_OUTLINE_TOGGLE_INSET_PX,
    SURFACE_FIT_TOOLBAR_INSET_PX,
    SURFACE_ZOOM_MAX_SCALE,
    SURFACE_ZOOM_MIN_SCALE,
    areViewportTransformsEqual,
    computeFitViewportTransform,
    computeZoomedViewportTransform,
    formatZoomPercent,
    parseZoomPercent,
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

describe("fit modes", () => {
    // A pane wider than the interface's ratio: width has slack, height decides a contain fit.
    const CONTAINER = { width: 1200, height: 500 };

    it("shows all of the interface in contain, at the cost of an empty side", () => {
        const transform = computeFitViewportTransform({
            container: CONTAINER,
            designSize: DESKTOP_DESIGN,
            mode: "contain",
        })!;

        expect(transform.scale).toBeCloseTo(500 / 1080, 5);
        expect(1920 * transform.scale).toBeLessThanOrEqual(1200);
        expect(1080 * transform.scale).toBeCloseTo(500, 5);
    });

    it("leaves no empty side in cover, at the cost of an edge running past the pane", () => {
        const transform = computeFitViewportTransform({
            container: CONTAINER,
            designSize: DESKTOP_DESIGN,
            mode: "cover",
            maxScale: SURFACE_ZOOM_MAX_SCALE,
        })!;

        expect(transform.scale).toBeCloseTo(1200 / 1920, 5);
        // The axis that decided the scale fills exactly; the other one overflows, evenly.
        expect(1920 * transform.scale).toBeCloseTo(1200, 5);
        expect(1080 * transform.scale).toBeGreaterThan(500);
        expect(transform.offsetY).toBe(Math.round((500 - 1080 * transform.scale) / 2));
    });

    it("spans the pane horizontally in width, whatever that does to the height", () => {
        const tall = computeFitViewportTransform({
            container: { width: 1200, height: 2000 },
            designSize: DESKTOP_DESIGN,
            mode: "width",
            maxScale: SURFACE_ZOOM_MAX_SCALE,
        })!;

        expect(tall.scale).toBeCloseTo(1200 / 1920, 5);
        expect(tall.offsetX).toBe(0);
        // Vertically centred in the space left over, since width alone decided the scale.
        expect(tall.offsetY).toBe(Math.round((2000 - 1080 * tall.scale) / 2));
    });

    it("draws one interface pixel per screen pixel in actual, centred rather than at the origin", () => {
        const transform = computeFitViewportTransform({
            container: CONTAINER,
            designSize: DESKTOP_DESIGN,
            mode: "actual",
            maxScale: SURFACE_ZOOM_MAX_SCALE,
        })!;

        expect(transform.scale).toBe(1);
        // Bigger than the pane in both axes, so both offsets are negative and equal on each side.
        expect(transform.offsetX).toBe(Math.round((1200 - 1920) / 2));
        expect(transform.offsetY).toBe(Math.round((500 - 1080) / 2));
    });

    it("keeps the magnification ceiling off a mode the author picked", () => {
        const params = {
            container: { width: 1600, height: 900 },
            designSize: { width: 200, height: 60 },
            mode: "cover" as const,
        };
        // "Fill the editing area" that stopped at 2x and left a margin would be a broken promise.
        const chosen = computeFitViewportTransform({ ...params, maxScale: SURFACE_ZOOM_MAX_SCALE })!;
        const automatic = computeFitViewportTransform(params)!;

        // 900/60 = 15x would fill it, so the only thing still holding this back is the range the
        // viewport itself accepts - the preview ceiling is gone.
        expect(chosen.scale).toBe(SURFACE_ZOOM_MAX_SCALE);
        expect(automatic.scale).toBe(SURFACE_FIT_MAX_SCALE);
    });

    it("measures every mode against the same box, so switching modes moves nothing else", () => {
        const insets = resolveSurfaceFitInsets({ outlineCollapsed: false });
        const boxCentreX = SURFACE_FIT_OUTLINE_PANEL_INSET_PX
            + (1600 - SURFACE_FIT_OUTLINE_PANEL_INSET_PX - SURFACE_FIT_EDGE_INSET_PX) / 2;

        for (const mode of ["contain", "cover", "width", "actual"] as const) {
            const transform = computeFitViewportTransform({
                container: { width: 1600, height: 900 },
                designSize: DESKTOP_DESIGN,
                insets,
                mode,
                maxScale: SURFACE_ZOOM_MAX_SCALE,
            })!;
            expect(transform.offsetX + (1920 * transform.scale) / 2).toBeCloseTo(boxCentreX, 0);
        }
    });
});

describe("computeZoomedViewportTransform", () => {
    const CONTAINER = { width: 1000, height: 800 };

    it("keeps what the middle of the pane was showing", () => {
        const current = { scale: 0.5, offsetX: -100, offsetY: -50 };
        // What sits under the centre before: (500 + 100) / 0.5 = 1200, (400 + 50) / 0.5 = 900.
        const next = computeZoomedViewportTransform({ current, container: CONTAINER, nextScale: 1.5 })!;

        expect(next.scale).toBe(1.5);
        expect(500 - (1200 * next.scale + next.offsetX)).toBeCloseTo(0, 0);
        expect(400 - (900 * next.scale + next.offsetY)).toBeCloseTo(0, 0);
    });

    it("anchors on the free box, not the whole pane, so the chrome does not drag the view", () => {
        const current = { scale: 1, offsetX: 0, offsetY: 0 };
        const withInsets = computeZoomedViewportTransform({
            current,
            container: CONTAINER,
            insets: resolveSurfaceFitInsets({ outlineCollapsed: false }),
            nextScale: 2,
        })!;
        const withoutInsets = computeZoomedViewportTransform({ current, container: CONTAINER, nextScale: 2 })!;

        expect(withInsets.offsetX).not.toBe(withoutInsets.offsetX);
    });

    it("holds the zoom inside the range the viewport accepts", () => {
        const current = { scale: 1, offsetX: 0, offsetY: 0 };
        expect(computeZoomedViewportTransform({ current, container: CONTAINER, nextScale: 40 })!.scale)
            .toBe(SURFACE_ZOOM_MAX_SCALE);
        expect(computeZoomedViewportTransform({ current, container: CONTAINER, nextScale: 0.001 })!.scale)
            .toBe(SURFACE_ZOOM_MIN_SCALE);
    });

    it("refuses a pane it cannot measure, or a zoom that is not a number", () => {
        const current = { scale: 1, offsetX: 0, offsetY: 0 };
        expect(computeZoomedViewportTransform({ current, container: { width: 0, height: 0 }, nextScale: 2 })).toBeNull();
        expect(computeZoomedViewportTransform({ current, container: CONTAINER, nextScale: Number.NaN })).toBeNull();
    });
});

describe("parseZoomPercent", () => {
    it("reads what a percentage box realistically receives", () => {
        expect(parseZoomPercent("150")).toBeCloseTo(1.5, 5);
        expect(parseZoomPercent("150%")).toBeCloseTo(1.5, 5);
        expect(parseZoomPercent(" 1 50 ")).toBeCloseTo(1.5, 5);
        // Full-width percent sign, which is what a Chinese or Japanese IME produces.
        expect(parseZoomPercent("150％")).toBeCloseTo(1.5, 5);
        expect(parseZoomPercent("62.5")).toBeCloseTo(0.625, 5);
    });

    it("clamps a number out of range rather than refusing it", () => {
        expect(parseZoomPercent("5000")).toBe(SURFACE_ZOOM_MAX_SCALE);
        expect(parseZoomPercent("1")).toBe(SURFACE_ZOOM_MIN_SCALE);
    });

    it("returns nothing for what is not a number, so the box can keep the value it had", () => {
        expect(parseZoomPercent("")).toBeNull();
        expect(parseZoomPercent("   ")).toBeNull();
        expect(parseZoomPercent("big")).toBeNull();
        expect(parseZoomPercent("1.2.3")).toBeNull();
        expect(parseZoomPercent("-50")).toBeNull();
        expect(parseZoomPercent("0")).toBeNull();
    });
});

describe("formatZoomPercent", () => {
    it("is the number the tool bar shows, rounded the way the canvas is drawn", () => {
        expect(formatZoomPercent(0.363542)).toBe(36);
        expect(formatZoomPercent(1)).toBe(100);
        expect(formatZoomPercent(SURFACE_ZOOM_MAX_SCALE)).toBe(1000);
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
