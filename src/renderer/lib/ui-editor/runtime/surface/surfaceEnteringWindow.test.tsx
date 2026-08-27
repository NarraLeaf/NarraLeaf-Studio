// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import { resolvePageAnimationMotion } from "@/lib/ui-editor/runtime/pageAnimation";
import { SurfaceAnimationLayer } from "./SurfaceAnimationLayer";

afterEach(() => {
    cleanup();
});

/**
 * How long a surface reports itself as still entering.
 *
 * `Is Surface Entering` is true from the moment a layer mounts until its enter animation completes,
 * and `enterComplete` - measured here - is the signal that ends it. The window matters beyond the
 * node: anything using "still entering" as a guard against input that arrived with the page is
 * relying on it lasting longer than that input does.
 *
 * It is a wall-clock measurement of the real code path, so the numbers move with the machine. The
 * bounds are loose on purpose: what is being pinned is the order of magnitude, because that is what
 * the guard question turns on.
 */
async function measureEnterWindow(pageAnimation: Parameters<typeof resolvePageAnimationMotion>[0]["settings"]) {
    const pageMotion = resolvePageAnimationMotion({
        settings: pageAnimation,
        navigationDirection: "forward",
        reducedMotion: false,
    });
    let enteredAt: number | null = null;
    const startedAt = performance.now();
    render(
        <SurfaceAnimationLayer
            prepaintKey="entry"
            direction="forward"
            pageMotion={pageMotion}
            surfaceId="surface"
            onEnterComplete={() => {
                enteredAt ??= performance.now();
            }}
        >
            <div>content</div>
        </SurfaceAnimationLayer>,
    );
    await waitFor(() => expect(enteredAt).not.toBeNull(), { timeout: 4000 });
    return { elapsedMs: enteredAt! - startedAt, plannedEnterMs: pageMotion.enterDurationMs };
}

describe("how long a surface is still entering", () => {
    it("is one frame with the default page animation", async () => {
        // The default preset is `none`, so there is no animation to wait out: the window is the
        // hidden prepaint frame and nothing else. Measured at 2-38ms across five runs, typically 15.
        const { elapsedMs, plannedEnterMs } = await measureEnterWindow(DEFAULT_UI_PAGE_ANIMATION_SETTINGS);

        expect(plannedEnterMs).toBe(0);
        expect(elapsedMs).toBeLessThan(150);
    });

    it("is the animation's own length once the surface has one", async () => {
        // The longest a page-animation preset runs by default is 260ms, and the layer allows it 80ms
        // of slack past that plan. Measured at 272-307ms across five runs.
        //
        // Which is worth knowing about beyond the node: a wheel gesture is not one event. A precision
        // trackpad keeps sending them through its momentum tail for the better part of a second after
        // the fingers lift, so "the surface is still entering" outlasts an arriving page's animation
        // and does NOT outlast the scroll that opened it. It is a guard against input that arrived
        // with the page, not a cooldown - anything needing the latter has to measure the gesture.
        const { elapsedMs, plannedEnterMs } = await measureEnterWindow({
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "fade",
        });

        expect(plannedEnterMs).toBe(260);
        expect(elapsedMs).toBeGreaterThanOrEqual(260);
        expect(elapsedMs).toBeLessThan(600);
    });
});
