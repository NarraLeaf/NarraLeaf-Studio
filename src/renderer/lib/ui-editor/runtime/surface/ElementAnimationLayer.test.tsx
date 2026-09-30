// @vitest-environment jsdom
/**
 * The two things an element's animation has to get right in the DOM: it is still there while it
 * leaves, and a parent that waits for its children is still there while *they* leave.
 *
 * The second one is the whole point of the chain, and it is not something the timing plan can prove
 * on its own - the plan says when each animation starts, but what keeps the subtree mounted long
 * enough to play is nested presence.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import type { ElementAnimationTiming } from "@/lib/ui-editor/runtime/surfaceAnimationPlan";
import { ElementAnimationLayer, ElementAnimationPresence } from "./ElementAnimationLayer";

beforeAll(() => {
    ensureAnimationFramePolyfill();
});

afterEach(cleanup);

function timing(
    partial: Partial<Omit<ElementAnimationTiming, "settings">> & { settings?: Partial<UIPageAnimationSettings> },
): ElementAnimationTiming {
    return {
        enterOriginMs: 0,
        enterStartMs: 0,
        enterDurationMs: 0,
        exitOriginMs: 0,
        exitStartMs: 0,
        exitDurationMs: 0,
        selfAnimated: true,
        subtreeAnimated: true,
        ...partial,
        settings: { ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS, ...partial.settings },
    };
}

const FADES_OUT = timing({
    settings: { exit: "fade", exitDurationSeconds: 0.12 },
    exitDurationMs: 120,
});

describe("element presence", () => {
    it("keeps a hidden element in the DOM until its exit has played", async () => {
        const view = render(
            <ElementAnimationPresence timing={FADES_OUT} visible>
                <ElementAnimationLayer key="node" timing={FADES_OUT} reducedMotion={false}>
                    <span>content</span>
                </ElementAnimationLayer>
            </ElementAnimationPresence>,
        );

        expect(view.queryByText("content")).not.toBeNull();

        view.rerender(
            <ElementAnimationPresence timing={FADES_OUT} visible={false}>
                <ElementAnimationLayer key="node" timing={FADES_OUT} reducedMotion={false}>
                    <span>content</span>
                </ElementAnimationLayer>
            </ElementAnimationPresence>,
        );

        // Still on screen: this is the exit, not the removal.
        expect(view.queryByText("content")).not.toBeNull();
        await waitFor(() => expect(view.queryByText("content")).toBeNull());
    });

    it("holds a subtree open while a nested element is still leaving", async () => {
        const slowChild = timing({
            settings: { exit: "fade", exitDurationSeconds: 0.25 },
            exitDurationMs: 250,
        });
        const tree = (visible: boolean) => (
            <ElementAnimationPresence timing={FADES_OUT} visible={visible}>
                <ElementAnimationLayer key="parent" timing={FADES_OUT} reducedMotion={false}>
                    <ElementAnimationPresence timing={slowChild} visible>
                        <ElementAnimationLayer key="child" timing={slowChild} reducedMotion={false}>
                            <span>child</span>
                        </ElementAnimationLayer>
                    </ElementAnimationPresence>
                </ElementAnimationLayer>
            </ElementAnimationPresence>
        );

        const view = render(tree(true));
        expect(view.queryByText("child")).not.toBeNull();

        view.rerender(tree(false));
        // The parent's own exit is shorter than the child's; the child must not be cut off.
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(view.queryByText("child")).not.toBeNull();
        await waitFor(() => expect(view.queryByText("child")).toBeNull(), { timeout: 2000 });
    });

    it("removes an element with nothing to play without waiting for a frame", async () => {
        const still = timing({ selfAnimated: false, subtreeAnimated: true });
        const tree = (visible: boolean) => (
            <AnimatePresence>
                <ElementAnimationPresence key="p" timing={still} visible={visible}>
                    <span key="node">content</span>
                </ElementAnimationPresence>
            </AnimatePresence>
        );

        const view = render(tree(true));
        view.rerender(tree(false));

        await waitFor(() => expect(view.queryByText("content")).toBeNull());
    });

    /**
     * A page re-renders while it leaves - a write lands, it stops taking input - and every element on
     * it hands its presence a new child. A `propagate` presence whose parent is leaving counts no child
     * as present, so it kept the old one and added the new one under the same key, and React mounted a
     * second copy of the subtree for each of those renders.
     */
    it("mounts nothing new while the page it is on is leaving", async () => {
        const errors: string[] = [];
        const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args.map(String).join(" "));
        });
        let mounts = 0;
        function Content() {
            useEffect(() => {
                mounts += 1;
            }, []);
            return <span>content</span>;
        }
        let rerenderPage: (() => void) | null = null;
        function Page() {
            const [, setTick] = useState(0);
            rerenderPage = () => setTick(tick => tick + 1);
            return (
                <ElementAnimationPresence timing={FADES_OUT} visible>
                    <ElementAnimationLayer key="node" timing={FADES_OUT} reducedMotion={false}>
                        <Content />
                    </ElementAnimationLayer>
                </ElementAnimationPresence>
            );
        }
        const tree = (shown: boolean) => <AnimatePresence>{shown ? <Page key="page" /> : null}</AnimatePresence>;

        try {
            const view = render(tree(true));
            expect(mounts).toBe(1);

            view.rerender(tree(false));
            for (let i = 0; i < 3; i++) {
                act(() => rerenderPage?.());
            }

            expect(view.getAllByText("content")).toHaveLength(1);
            expect(mounts).toBe(1);
            expect(errors.filter(line => line.includes("same key"))).toEqual([]);
            // Held, not stuck: the page still finishes leaving.
            await waitFor(() => expect(view.queryByText("content")).toBeNull());
        } finally {
            spy.mockRestore();
        }
    });
});
