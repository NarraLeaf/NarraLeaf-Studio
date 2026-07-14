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
import { SurfaceAnimationLayer } from "./SurfaceAnimationLayer";

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
