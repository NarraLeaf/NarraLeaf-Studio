// @vitest-environment jsdom
/**
 * Exit-visibility contract for SurfaceAnimationLayer: content stays hidden
 * until prepaint completes, and a layer that is removed BEFORE its prepaint
 * ever completed must stay hidden for the whole exit — forcing it visible
 * would flash never-painted content posed at its enter-initial target.
 * A layer that had been shown keeps its content visible while exiting.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { AnimatePresence } from "motion/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PageAnimationMotion } from "@/lib/ui-editor/runtime/pageAnimation";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { SurfaceAnimationLayer, largeUnloadedImages } from "./SurfaceAnimationLayer";

beforeAll(() => {
    ensureAnimationFramePolyfill();
});

afterEach(cleanup);

const pageMotion: PageAnimationMotion = {
    initial: { opacity: 0, x: 48, y: 0, scale: 1, filter: "blur(0px)" },
    animate: {
        opacity: 1,
        x: 0,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
        transition: { type: "tween", duration: 0.2 },
    },
    exit: {
        opacity: 0,
        x: -48,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
        transition: { type: "tween", duration: 0.2 },
    },
    enterDurationMs: 200,
    exitDurationMs: 200,
    exitBlocking: false,
};

function ui(show: boolean) {
    return (
        <AnimatePresence>
            {show ? (
                <SurfaceAnimationLayer
                    key="layer"
                    prepaintKey="layer"
                    direction="forward"
                    pageMotion={pageMotion}
                    contentClassName="layer-content"
                >
                    <span>content</span>
                </SurfaceAnimationLayer>
            ) : null}
        </AnimatePresence>
    );
}

function contentOpacity(container: HTMLElement): string {
    const content = container.querySelector<HTMLElement>(".layer-content");
    if (!content) {
        throw new Error("content wrapper not found (layer already unmounted)");
    }
    return content.style.opacity;
}

describe("SurfaceAnimationLayer exit visibility", () => {
    it("keeps a layer hidden through its exit when it never finished prepaint", () => {
        const { container, rerender } = render(ui(true));
        // Prepaint is still pending on the first synchronous pass → content hidden.
        expect(contentOpacity(container)).toBe("0");

        // Remove the layer before prepaint ever completes; AnimatePresence keeps it
        // mounted for the exit animation.
        rerender(ui(false));
        expect(contentOpacity(container)).toBe("0");
    });

    it("keeps a layer visible through its exit when it had been shown", async () => {
        const { container, rerender } = render(ui(true));
        await waitFor(() => {
            expect(contentOpacity(container)).toBe("1");
        });

        rerender(ui(false));
        expect(contentOpacity(container)).toBe("1");
    });
});

describe("SurfaceAnimationLayer held back for its pictures", () => {
    it("does not show its backdrop colour bare while the prepaint is pending", async () => {
        const { container } = render(
            <AnimatePresence>
                <SurfaceAnimationLayer
                    key="layer"
                    prepaintKey="layer"
                    direction="forward"
                    pageMotion={pageMotion}
                    style={{ backgroundColor: "rgb(0, 0, 0)" }}
                    contentClassName="layer-content"
                >
                    <span>content</span>
                </SurfaceAnimationLayer>
            </AnimatePresence>,
        );
        const layer = container.querySelector<HTMLElement>("[data-ui-surface-prepaint]")!;
        expect(layer.getAttribute("data-ui-surface-prepaint")).toBe("pending");
        expect(layer.style.backgroundColor).toBe("transparent");
        await waitFor(() => expect(layer.getAttribute("data-ui-surface-prepaint")).toBe("ready"));
        expect(layer.style.backgroundColor).toBe("rgb(0, 0, 0)");
    });

    it("shows a translucent backdrop at once - a dimming layer - and holds back only its content", async () => {
        const { container } = render(
            <AnimatePresence>
                <SurfaceAnimationLayer
                    key="layer"
                    prepaintKey="layer"
                    direction="forward"
                    pageMotion={pageMotion}
                    style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
                    contentClassName="layer-content"
                >
                    <span>content</span>
                </SurfaceAnimationLayer>
            </AnimatePresence>,
        );
        const layer = container.querySelector<HTMLElement>("[data-ui-surface-prepaint]")!;
        expect(layer.getAttribute("data-ui-surface-prepaint")).toBe("pending");
        expect(layer.style.backgroundColor).toBe("rgba(0, 0, 0, 0.5)");
        expect(contentOpacity(container)).toBe("0");
        await waitFor(() => expect(contentOpacity(container)).toBe("1"));
    });

    it("takes the host's word for a colour it cannot measure", () => {
        // A page thinned over the running game is painted as a `color-mix()`; the host says whether the
        // colour it was authored with is opaque.
        const mixed = "color-mix(in srgb, #00000080 85%, transparent)";
        const layerFor = (hold: boolean) => {
            const { container } = render(
                <AnimatePresence>
                    <SurfaceAnimationLayer
                        key="layer"
                        prepaintKey={`layer-${hold}`}
                        direction="forward"
                        pageMotion={pageMotion}
                        style={{ backgroundColor: mixed, backgroundImage: "linear-gradient(red, red)" }}
                        holdBackgroundWhilePending={hold}
                    >
                        <span>content</span>
                    </SurfaceAnimationLayer>
                </AnimatePresence>,
            );
            return container.querySelector<HTMLElement>("[data-ui-surface-prepaint]")!;
        };
        const veil = layerFor(false);
        expect(veil.style.backgroundImage).toBe("linear-gradient(red, red)");
        const page = layerFor(true);
        expect(page.style.backgroundColor).toBe("transparent");
        expect(page.style.backgroundImage).toBe("none");
    });

    it("counts only pictures still loading that cover a large share of the layer", () => {
        const root = document.createElement("div");
        const rect = (left: number, top: number, width: number, height: number) =>
            () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
        root.getBoundingClientRect = rect(0, 0, 1920, 1080);
        const backdrop = document.createElement("img");
        backdrop.setAttribute("src", "app://fs/bg.png");
        backdrop.getBoundingClientRect = rect(0, 0, 1920, 1080);
        const icon = document.createElement("img");
        icon.setAttribute("src", "app://fs/icon.png");
        icon.getBoundingClientRect = rect(10, 10, 64, 64);
        const empty = document.createElement("img");
        empty.getBoundingClientRect = rect(0, 0, 1920, 1080);
        root.append(backdrop, icon, empty);
        // jsdom never loads, so `complete && naturalWidth > 0` is false for both pictures.
        expect(largeUnloadedImages(root)).toEqual([backdrop]);
        expect(largeUnloadedImages(null)).toEqual([]);
    });
});
