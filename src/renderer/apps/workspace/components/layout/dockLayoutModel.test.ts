import { describe, expect, it } from "vitest";
import {
    applyResize,
    DOCK_REGIONS,
    EDITOR_FLOOR,
    maxBottomHeight,
    maxSidebarWidth,
    RAIL_SELECTOR_WIDTH,
    residualEditorWidth,
    resolveDock,
    TITLE_BAR_HEIGHT,
    type DockEnv,
} from "./dockLayoutModel";
import { VERSION_RAIL_COLLAPSED_WIDTH, VERSION_RAIL_EXPANDED_WIDTH } from "./versionRailModel";

const env = (overrides: Partial<DockEnv> = {}): DockEnv => ({
    windowWidth: 1600,
    windowHeight: 900,
    leftVisible: true,
    rightVisible: true,
    versionRailWidth: 0,
    ...overrides,
});

describe("resolveDock", () => {
    it("returns the intended sizes unchanged when they fit", () => {
        const out = resolveDock({ left: 320, right: 320, bottom: 256 }, env());
        expect(out).toEqual({ left: 320, right: 320, bottom: 256 });
    });

    it("floors each region at its declared minimum", () => {
        const out = resolveDock({ left: 10, right: 10, bottom: 10 }, env());
        expect(out.left).toBe(DOCK_REGIONS.left.min);
        expect(out.right).toBe(DOCK_REGIONS.right.min);
        expect(out.bottom).toBe(DOCK_REGIONS.bottom.min);
    });

    it("protects the editor floor width when a sidebar is over-dragged (clamp policy)", () => {
        // Only the left sidebar visible on a narrow window.
        const e = env({ windowWidth: 1000, rightVisible: false });
        const out = resolveDock({ left: 100000, right: 320, bottom: 256 }, e);
        expect(residualEditorWidth(e, out)).toBeGreaterThanOrEqual(EDITOR_FLOOR.width);
    });

    it("lets the bottom panel cover the editor entirely (clip policy)", () => {
        const e = env({ windowHeight: 900 });
        const out = resolveDock({ left: 320, right: 320, bottom: 100000 }, e);
        // May consume the whole center column, leaving the editor 0px - only the title bar is reserved.
        expect(out.bottom).toBe(e.windowHeight - TITLE_BAR_HEIGHT);
        expect(out.bottom).toBeGreaterThan(600); // far past the old 600px / half-height cap
    });

    it("subtracts a visible right sidebar from the left sidebar's ceiling", () => {
        const e = env({ windowWidth: 1200 });
        const wide = resolveDock({ left: 100000, right: 300, bottom: 256 }, e);
        const narrow = resolveDock({ left: 100000, right: 500, bottom: 256 }, e);
        // A wider right sidebar leaves less room for the left one.
        expect(narrow.left).toBeLessThan(wide.left);
    });

    it("does not mutate intent: effective grows back when the window grows", () => {
        const intent = { left: 700, right: 320, bottom: 256 };
        const small = resolveDock(intent, env({ windowWidth: 900, rightVisible: false }));
        const large = resolveDock(intent, env({ windowWidth: 2400, rightVisible: false }));
        expect(small.left).toBeLessThan(700); // clamped down on the small window
        expect(large.left).toBe(700); // restored on the large window (intent never mutated)
    });
});

/**
 * The version rail's account. A new fixed column the solver does not know about is not a cosmetic
 * bug: the sidebars would size themselves as if the space were free, the editor would be pushed under
 * its floor, its CSS floor would overflow, the overflow would raise a scrollbar, the scrollbar would
 * shrink the container, and the re-clamp would loop (docs/plans/2026-07-28-002 §3, and it has
 * happened once). So the accounting is asserted here rather than eyeballed in a screenshot.
 */
describe("the version rail in the dock account", () => {
    const RAIL_WIDTHS = [0, VERSION_RAIL_COLLAPSED_WIDTH, VERSION_RAIL_EXPANDED_WIDTH];

    it("takes the rail out of a sidebar's ceiling, px for px", () => {
        const bare = env({ versionRailWidth: 0 });
        for (const versionRailWidth of RAIL_WIDTHS) {
            const withRail = env({ versionRailWidth });
            expect(maxSidebarWidth("left", withRail, 320)).toBe(maxSidebarWidth("left", bare, 320) - versionRailWidth);
            expect(maxSidebarWidth("right", withRail, 320)).toBe(maxSidebarWidth("right", bare, 320) - versionRailWidth);
        }
    });

    /**
     * The balance proof, and the strongest honest form of it: widen the window by exactly the rail's
     * width and the layout is INDISTINGUISHABLE from the same layout with no rail. Both sidebars, the
     * bottom panel and the editor's own width come out identical.
     *
     * That identity is what "the rail is in the account" means. It fails if the width is missed
     * (sidebars grow into space that is not theirs), and it fails if it is counted twice (the editor
     * loses width nobody took). An inequality against the floor cannot tell those apart, and would also
     * be measuring the pre-existing hole the next test documents rather than anything about the rail.
     */
    it("costs the editor exactly its own width and not one pixel more", () => {
        for (const windowWidth of [900, 1000, 1376, 1600, 1920, 2560]) {
            for (const versionRailWidth of RAIL_WIDTHS) {
                for (const intent of [
                    { left: 320, right: 320, bottom: 256 },
                    { left: 100000, right: 320, bottom: 256 },
                    { left: 320, right: 100000, bottom: 256 },
                    { left: 100000, right: 100000, bottom: 256 },
                    { left: 10, right: 10, bottom: 10 },
                ]) {
                    const bare = env({ windowWidth, versionRailWidth: 0 });
                    const withRail = env({ windowWidth: windowWidth + versionRailWidth, versionRailWidth });
                    const where = `rail ${versionRailWidth} at ${windowWidth} with ${JSON.stringify(intent)}`;
                    expect(resolveDock(intent, withRail), where).toEqual(resolveDock(intent, bare));
                    expect(residualEditorWidth(withRail, resolveDock(intent, withRail)), where)
                        .toBe(residualEditorWidth(bare, resolveDock(intent, bare)));
                }
            }
        }
    });

    it("keeps the editor at or above its floor at every rail width, in the cases the clamp policy covers", () => {
        // The width the floor needs is DERIVED, not guessed: everything fixed, plus both sidebars at
        // their defaults, plus the floor. Below it the pieces genuinely do not fit and the CSS floor
        // crops instead - the documented anti-deform guarantee. Guessing a number here is how the
        // earlier draft of this test ended up measuring the shortfall the next test pins.
        const snugFor = (versionRailWidth: number) =>
            2 * RAIL_SELECTOR_WIDTH + versionRailWidth
            + DOCK_REGIONS.left.default + DOCK_REGIONS.right.default + EDITOR_FLOOR.width;

        for (const versionRailWidth of RAIL_WIDTHS) {
            const snug = snugFor(versionRailWidth);
            for (const windowWidth of [snug, snug + 200, 1920, 2560, 3840]) {
                for (const e of [
                    env({ windowWidth, versionRailWidth }),
                    env({ windowWidth, versionRailWidth, rightVisible: false }),
                    env({ windowWidth, versionRailWidth, leftVisible: false }),
                ]) {
                    const bothVisible = e.leftVisible && e.rightVisible;
                    for (const intent of [
                        { left: DOCK_REGIONS.left.default, right: DOCK_REGIONS.right.default, bottom: 256 },
                        { left: 10, right: 10, bottom: 10 },
                        // Left over-dragged: its ceiling subtracts the right sidebar as well as the
                        // fixed columns, so it stops exactly at the floor.
                        { left: 100000, right: DOCK_REGIONS.right.min, bottom: 256 },
                        // Either sidebar over-dragged is safe as soon as the other is not on screen.
                        ...(bothVisible ? [] : [{ left: 100000, right: 100000, bottom: 256 }]),
                    ]) {
                        expect(
                            residualEditorWidth(e, resolveDock(intent, e)),
                            `rail ${versionRailWidth} at ${windowWidth} L${String(e.leftVisible)}R${String(e.rightVisible)} with ${JSON.stringify(intent)}`,
                        ).toBeGreaterThanOrEqual(EDITOR_FLOOR.width);
                    }
                }
            }
        }
    });

    it("pins the pre-existing shortfall from over-dragging the RIGHT sidebar, and that the rail does not widen it", () => {
        // `resolveDock` resolves right independently of left to break their mutual dependency, so
        // right's ceiling reserves the floor but NOT the left sidebar - and then left's width comes out
        // of the floor. Older than this column and unchanged by it: the editor is left with the same
        // 240px at every rail width, and the CSS floor is what stops the deformation.
        //
        // Pinned rather than fixed, because fixing it means changing how two sidebars share a squeeze,
        // which is a decision about the dock and not about version control. Recorded here so the next
        // reader does not mistake it for something the rail introduced.
        for (const intent of [
            { left: 100000, right: 100000, bottom: 256 },
            { left: DOCK_REGIONS.left.min, right: 100000, bottom: 256 },
        ]) {
            for (const versionRailWidth of RAIL_WIDTHS) {
                const e = env({ windowWidth: 1376 + versionRailWidth, versionRailWidth });
                expect(residualEditorWidth(e, resolveDock(intent, e))).toBe(DOCK_REGIONS.left.min);
            }
        }
    });

    it("gives the space back when the rail collapses (nothing mutates the stored intent)", () => {
        const intent = { left: 700, right: 320, bottom: 256 };
        const expanded = resolveDock(intent, env({ windowWidth: 1500, versionRailWidth: VERSION_RAIL_EXPANDED_WIDTH }));
        const collapsed = resolveDock(intent, env({ windowWidth: 1500, versionRailWidth: VERSION_RAIL_COLLAPSED_WIDTH }));
        expect(expanded.left).toBeLessThan(700);
        expect(collapsed.left).toBeGreaterThan(expanded.left);
    });

    it("stops a drag at the rail-aware ceiling", () => {
        const e = env({ windowWidth: 1500, rightVisible: false, versionRailWidth: VERSION_RAIL_EXPANDED_WIDTH });
        const { next } = applyResize("left", maxSidebarWidth("left", e, 0), 200, e, 0);
        expect(next).toBe(maxSidebarWidth("left", e, 0));
        expect(residualEditorWidth(e, resolveDock({ left: next, right: 320, bottom: 256 }, e)))
            .toBeGreaterThanOrEqual(EDITOR_FLOOR.width);
    });
});

describe("residualEditorWidth", () => {
    it("counts only the sidebars that are actually on screen", () => {
        const e = env({ windowWidth: 1600, rightVisible: false, versionRailWidth: VERSION_RAIL_COLLAPSED_WIDTH });
        // 1600 - (48*2 + 48) - 320 = 1136; the hidden right sidebar takes nothing.
        expect(residualEditorWidth(e, { left: 320, right: 320, bottom: 256 })).toBe(1136);
    });

    it("goes negative rather than lying when the minima no longer fit", () => {
        // The honest answer: at this width the CSS floor is what protects the editor, and a helper
        // that clamped to zero here would hide the condition the floor exists for.
        const e = env({ windowWidth: 600, versionRailWidth: VERSION_RAIL_EXPANDED_WIDTH });
        expect(residualEditorWidth(e, resolveDock({ left: 320, right: 320, bottom: 256 }, e))).toBeLessThan(0);
    });
});

describe("maxSidebarWidth / maxBottomHeight", () => {
    it("never returns below the region minimum, even on a tiny window", () => {
        const e = env({ windowWidth: 200, windowHeight: 100 });
        expect(maxSidebarWidth("left", e, 0)).toBe(DOCK_REGIONS.left.min);
        expect(maxBottomHeight(e)).toBe(DOCK_REGIONS.bottom.min);
    });
});

describe("applyResize", () => {
    it("grows the left sidebar as the pointer moves right (+delta)", () => {
        const { next } = applyResize("left", 320, 40, env(), 320);
        expect(next).toBe(360);
    });

    it("grows the right sidebar / bottom panel as the pointer moves left/up (-delta)", () => {
        expect(applyResize("right", 320, -40, env(), 320).next).toBe(360);
        expect(applyResize("bottom", 256, -40, env(), 0).next).toBe(296);
    });

    it("stalls at the minimum and reports a correction so the handle edge stays with the size", () => {
        // Drag left sidebar far below its min: size pins to min, correction cancels the unused delta.
        const { next, correction } = applyResize("left", DOCK_REGIONS.left.min, -200, env(), 320);
        expect(next).toBe(DOCK_REGIONS.left.min);
        // sign(+1) * actualDelta(0) - delta(-200) = 200 - feeds back the fully-unused pointer travel.
        expect(correction).toBe(200);
    });

    it("returns zero correction while the size tracks the pointer 1:1", () => {
        const { correction } = applyResize("left", 320, 40, env(), 320);
        expect(correction).toBe(0);
    });
});
