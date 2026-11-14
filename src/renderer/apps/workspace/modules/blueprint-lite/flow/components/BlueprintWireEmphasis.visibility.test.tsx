// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostVisibility } from "@/lib/components/layout";
import { BlueprintWireEmphasis, type BlueprintWireEmphasisHandle } from "./BlueprintWireEmphasis";

vi.mock("@/lib/tooltip", () => ({
    getTooltipDelay: () => 500,
    placeTooltip: () => ({ top: 10, left: 10 }),
    TOOLTIP_BUBBLE_CLASS: "tooltip",
}));

const wire = {
    edgeId: "wire",
    source: { nodeId: "a", pinId: "out", side: "output" as const },
    target: { nodeId: "b", pinId: "in", side: "input" as const },
    color: "#22d3ee",
    tip: "Connected to B",
    clientX: 50,
    clientY: 50,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("wire tooltip in a kept-alive editor", () => {
    it.each([0, 500])("clears a tooltip after %i ms when its editor is hidden", (elapsed) => {
        const ref = createRef<BlueprintWireEmphasisHandle>();
        const view = render(
            <HostVisibility visible>
                <BlueprintWireEmphasis ref={ref} canvasId="editor" />
            </HostVisibility>,
        );
        act(() => ref.current!.hoverWire(wire));
        act(() => vi.advanceTimersByTime(elapsed));
        if (elapsed) expect(screen.getByRole("tooltip").textContent).toBe("Connected to B");

        view.rerender(
            <HostVisibility visible={false}>
                <BlueprintWireEmphasis ref={ref} canvasId="editor" />
            </HostVisibility>,
        );
        act(() => vi.advanceTimersByTime(500));
        expect(screen.queryByRole("tooltip")).toBeNull();

        view.rerender(
            <HostVisibility visible>
                <BlueprintWireEmphasis ref={ref} canvasId="editor" />
            </HostVisibility>,
        );
        expect(screen.queryByRole("tooltip")).toBeNull();
        act(() => ref.current!.hoverWire(wire));
        act(() => vi.advanceTimersByTime(500));
        expect(screen.getByRole("tooltip").textContent).toBe("Connected to B");
    });
});
