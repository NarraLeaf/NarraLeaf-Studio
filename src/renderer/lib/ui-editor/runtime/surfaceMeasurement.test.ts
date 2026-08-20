/**
 * @vitest-environment jsdom
 *
 * The measurement and its inverse, against a hand-built DOM.
 *
 * jsdom reports every box as zero, so the rects here are stubbed onto the nodes. That is fine for
 * what these tests are about: the arithmetic that turns viewport pixels into surface coordinates,
 * and the rules about which instance answers.
 */

import { beforeEach, describe, expect, it } from "vitest";

const DESIGN = { width: 1280, height: 720 };

function stubRect(node: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void {
    node.getBoundingClientRect = () =>
        ({
            ...rect,
            x: rect.left,
            y: rect.top,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
            toJSON: () => rect,
        }) as DOMRect;
}

/** A surface shell painted at half size, with one widget inside it. */
function buildSurface(input: {
    surfaceId: string;
    shell: { left: number; top: number; width: number; height: number };
    widgets: Array<{ elementId: string; left: number; top: number; width: number; height: number }>;
}): HTMLElement {
    const shell = document.createElement("div");
    shell.dataset.uiSurfaceId = input.surfaceId;
    stubRect(shell, input.shell);
    for (const widget of input.widgets) {
        const node = document.createElement("div");
        node.dataset.uiElementId = widget.elementId;
        stubRect(node, widget);
        shell.appendChild(node);
    }
    document.body.appendChild(shell);
    return shell;
}

const designSizeOf = () => DESIGN;

describe("measureElementSurfaceRect", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("reports the widget in surface coordinates, not viewport pixels", async () => {
        const { measureElementSurfaceRect } = await import("./surfaceMeasurement");
        // Shell painted at half scale and offset: 640x360 on screen for a 1280x720 design.
        buildSurface({
            surfaceId: "main",
            shell: { left: 30, top: 10, width: 640, height: 360 },
            widgets: [{ elementId: "confirm", left: 30 + 100, top: 10 + 50, width: 80, height: 20 }],
        });
        expect(measureElementSurfaceRect("confirm", designSizeOf)).toEqual({
            surfaceId: "main",
            rect: { x: 200, y: 100, width: 160, height: 40 },
        });
    });

    it("skips an instance with no area and answers with the first painted one", async () => {
        const { measureElementSurfaceRect } = await import("./surfaceMeasurement");
        buildSurface({
            surfaceId: "main",
            shell: { left: 0, top: 0, width: 1280, height: 720 },
            widgets: [
                { elementId: "row", left: 0, top: 0, width: 0, height: 0 },
                { elementId: "row", left: 10, top: 20, width: 30, height: 40 },
            ],
        });
        expect(measureElementSurfaceRect("row", designSizeOf)?.rect).toEqual({
            x: 10,
            y: 20,
            width: 30,
            height: 40,
        });
    });

    it("answers null for a widget that is not on screen", async () => {
        const { measureElementSurfaceRect } = await import("./surfaceMeasurement");
        buildSurface({ surfaceId: "main", shell: { left: 0, top: 0, width: 1280, height: 720 }, widgets: [] });
        expect(measureElementSurfaceRect("missing", designSizeOf)).toBeNull();
    });

    it("answers null when the surface has not been laid out", async () => {
        const { measureElementSurfaceRect } = await import("./surfaceMeasurement");
        buildSurface({
            surfaceId: "main",
            shell: { left: 0, top: 0, width: 0, height: 0 },
            widgets: [{ elementId: "confirm", left: 0, top: 0, width: 10, height: 10 }],
        });
        expect(measureElementSurfaceRect("confirm", designSizeOf)).toBeNull();
    });
});

describe("surfacePointToClientPoint", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("is the inverse of the measurement, so a widget's centre round-trips", async () => {
        const { measureElementSurfaceRect, surfacePointToClientPoint } = await import("./surfaceMeasurement");
        buildSurface({
            surfaceId: "main",
            shell: { left: 30, top: 10, width: 640, height: 360 },
            widgets: [{ elementId: "confirm", left: 30 + 100, top: 10 + 50, width: 80, height: 20 }],
        });
        const measured = measureElementSurfaceRect("confirm", designSizeOf)!;
        const centre = {
            x: measured.rect.x + measured.rect.width / 2,
            y: measured.rect.y + measured.rect.height / 2,
        };
        // The widget's own on-screen centre, arrived at from the other direction.
        expect(surfacePointToClientPoint("main", centre, designSizeOf)).toEqual({
            x: 30 + 100 + 80 / 2,
            y: 10 + 50 + 20 / 2,
        });
    });

    it("answers null for a surface that is not on screen", async () => {
        const { surfacePointToClientPoint } = await import("./surfaceMeasurement");
        expect(surfacePointToClientPoint("gone", { x: 1, y: 1 }, designSizeOf)).toBeNull();
    });
});
