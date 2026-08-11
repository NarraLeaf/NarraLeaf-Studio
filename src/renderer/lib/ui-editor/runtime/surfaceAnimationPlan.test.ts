import { describe, expect, it } from "vitest";
import type { UIElement, UIElementId } from "@shared/types/ui-editor/document";
import {
    DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";
import { buildSurfaceAnimationPlan, getSurfaceAnimationTimings } from "./surfaceAnimationPlan";

function settings(partial: Partial<UIPageAnimationSettings>): UIPageAnimationSettings {
    return { ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS, ...partial };
}

function element(
    id: string,
    childrenIds: string[] = [],
    animation?: UIPageAnimationSettings,
    visible = true,
): UIElement {
    return {
        id,
        type: id === "root" ? "nl.root" : "nl.container",
        parentId: null,
        childrenIds,
        layout: { x: 0, y: 0, width: 10, height: 10, visible },
        ...(animation ? { animation } : {}),
    };
}

function table(...elements: UIElement[]): Record<UIElementId, UIElement> {
    return Object.fromEntries(elements.map(item => [item.id, item]));
}

const FADE_IN_OUT = settings({
    enter: "fade",
    exit: "fade",
    enterDurationSeconds: 0.2,
    exitDurationSeconds: 0.3,
});

describe("surface animation plan", () => {
    it("leaves a surface whose elements animate nothing empty", () => {
        const plan = buildSurfaceAnimationPlan({
            elements: table(element("root", ["a"]), element("a")),
            rootElementId: "root",
        });

        expect(plan.empty).toBe(true);
        expect(plan.exitTotalMs).toBe(0);
        expect(plan.elements.get("a")?.subtreeAnimated).toBe(false);
    });

    it("staggers direct children and reports the subtree as animated up the chain", () => {
        const plan = buildSurfaceAnimationPlan({
            elements: table(element("root", ["a", "b"]), element("a", [], FADE_IN_OUT), element("b", [], FADE_IN_OUT)),
            rootElementId: "root",
            rootSettings: settings({ childStaggerSeconds: 0.1 }),
        });

        expect(plan.elements.get("a")?.enterStartMs).toBe(0);
        expect(plan.elements.get("b")?.enterStartMs).toBe(100);
        expect(plan.elements.get("b")?.exitStartMs).toBe(100);
        // Nothing waits: the surface itself does not animate, and the last child is done at 100+300.
        expect(plan.exitTotalMs).toBe(400);
        expect(plan.childrenExitEndMs).toBe(400);
        expect(plan.root.subtreeAnimated).toBe(true);
        expect(plan.empty).toBe(false);
    });

    it("holds a waiting parent until its children have gone, and chains through nested parents", () => {
        const plan = buildSurfaceAnimationPlan({
            elements: table(
                element("root", ["box"]),
                element("box", ["leaf"], settings({ exit: "fade", exitDurationSeconds: 0.25 })),
                element("leaf", [], settings({ exit: "fade", exitDurationSeconds: 0.4 })),
            ),
            rootElementId: "root",
            rootSettings: settings({ exit: "fade", exitDurationSeconds: 0.5 }),
        });

        // leaf leaves first, then the box that waits for it, then the surface that waits for the box.
        expect(plan.elements.get("leaf")?.exitStartMs).toBe(0);
        expect(plan.elements.get("box")?.exitStartMs).toBe(400);
        expect(plan.root.exitStartMs).toBe(650);
        expect(plan.exitTotalMs).toBe(1150);
    });

    it("lets a parent leave alongside its children when it does not wait", () => {
        const plan = buildSurfaceAnimationPlan({
            elements: table(
                element("root", ["box"]),
                element(
                    "box",
                    ["leaf"],
                    settings({ exit: "fade", exitDurationSeconds: 0.25, exitWaitsForChildren: false }),
                ),
                element("leaf", [], settings({ exit: "fade", exitDurationSeconds: 0.4 })),
            ),
            rootElementId: "root",
            rootSettings: settings({ exitWaitsForChildren: false }),
        });

        expect(plan.elements.get("box")?.exitStartMs).toBe(0);
        // The subtree is still not done until the slowest thing in it is.
        expect(plan.exitTotalMs).toBe(400);
    });

    it("counts a delay only for the phase that has something to delay", () => {
        const plan = buildSurfaceAnimationPlan({
            elements: table(
                element("root", ["silent", "loud"]),
                element("silent", [], settings({ enterDelaySeconds: 2, exitDelaySeconds: 2 })),
                element("loud", [], settings({ exit: "fade", exitDurationSeconds: 0.1, exitDelaySeconds: 0.2 })),
            ),
            rootElementId: "root",
        });

        expect(plan.elements.get("silent")?.exitStartMs).toBe(0);
        expect(plan.elements.get("loud")?.exitStartMs).toBe(200);
        expect(plan.exitTotalMs).toBe(300);
    });

    it("plans an authored-hidden subtree without letting the Page wait for it", () => {
        const plan = buildSurfaceAnimationPlan({
            elements: table(
                element("root", ["hidden", "shown"]),
                element("hidden", [], settings({ exit: "fade", exitDurationSeconds: 5 }), false),
                element("shown", [], settings({ exit: "fade", exitDurationSeconds: 0.2 })),
            ),
            rootElementId: "root",
            rootSettings: settings({ childStaggerSeconds: 0.1 }),
        });

        // Ready for the blueprint that shows it...
        expect(plan.elements.get("hidden")?.exitDurationMs).toBe(5000);
        // ...but it takes no stagger slot and nothing waits on it.
        expect(plan.elements.get("shown")?.exitStartMs).toBe(0);
        expect(plan.exitTotalMs).toBe(200);
    });

    it("zeros everything under reduced motion", () => {
        const plan = buildSurfaceAnimationPlan({
            elements: table(element("root", ["a"]), element("a", [], FADE_IN_OUT)),
            rootElementId: "root",
            rootSettings: settings({ childStaggerSeconds: 0.5 }),
            reducedMotion: true,
        });

        expect(plan.empty).toBe(true);
        expect(plan.exitTotalMs).toBe(0);
        expect(plan.enterTotalMs).toBe(0);
    });
});

describe("surface animation timings", () => {
    const elements = table(
        element("root", ["a"]),
        element("a", [], settings({ enter: "fade", exit: "fade", enterDurationSeconds: 0.2, exitDurationSeconds: 0.3 })),
    );
    const surface = {
        rootElementId: "root",
        settings: { pageAnimation: settings({ exit: "fade", exitDurationSeconds: 0.1 }) },
    };

    it("counts the elements when it is given them", () => {
        const timings = getSurfaceAnimationTimings({ elements, surface });

        // The Page waits for its content, so its own 0.1s exit starts after the element's 0.3s.
        expect(timings.ownExitDelayMs).toBe(300);
        expect(timings.exitMs).toBe(400);
        expect(timings.enterMs).toBe(200);
        expect(timings.exitBlocking).toBe(true);
    });

    it("answers for the Surface alone when it is not", () => {
        const timings = getSurfaceAnimationTimings({ surface });

        expect(timings.plan).toBeNull();
        expect(timings.exitMs).toBe(100);
        expect(timings.ownExitDelayMs).toBe(0);
    });

    it("blocks nothing when the Page and its contents both stay put", () => {
        const timings = getSurfaceAnimationTimings({
            elements: table(element("root", ["a"]), element("a")),
            surface: { rootElementId: "root", settings: {} },
        });

        expect(timings.exitMs).toBe(0);
        expect(timings.exitBlocking).toBe(false);
    });
});
