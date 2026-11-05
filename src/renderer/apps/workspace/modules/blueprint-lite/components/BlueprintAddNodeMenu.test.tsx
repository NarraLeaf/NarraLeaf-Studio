// @vitest-environment jsdom
/**
 * The add-node menu's highlight is what Enter adds, so only the author moving the pointer may move
 * it. A wheel over the open list scrolls rows under a pointer that stays put, and the row that slides
 * under it is reported as entered - which used to light it, so the node Enter would add changed while
 * the author was only scrolling to read the list. The grey hover tint follows the same rule, and the
 * highlight is not the same grey as a hover.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintNodeEditorCatalogEntry, BlueprintPaletteContext } from "@/lib/ui-editor/blueprint-nodes/types";
import { BlueprintAddNodeMenu } from "./BlueprintAddNodeMenu";

// Keys, not prose: what is asserted is which row is lit, not how a node is named.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));

// jsdom lays nothing out, so the window would mount no rows at all. Every row is mounted instead, at
// the offset the real window would give it - which rows are on screen is not what this file is about.
vi.mock("@tanstack/react-virtual", () => ({
    useVirtualizer: (options: { count: number; getItemKey: (index: number) => string | number }) => ({
        getTotalSize: () => options.count * 52,
        getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({
            index,
            key: options.getItemKey(index),
            start: index * 52,
        })),
        scrollToIndex: () => undefined,
    }),
}));

// The category row watches its own width for the fades at its edges; jsdom has no observer to lend.
vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
});

afterEach(cleanup);

const ENTRIES: BlueprintNodeEditorCatalogEntry[] = ["Add", "Subtract", "Multiply", "Divide", "Modulo"].map(name => ({
    type: `test.math.${name.toLowerCase()}`,
    displayName: name,
    category: "Math",
    keywords: [],
    isPure: true,
    graphKinds: ["event", "function"],
    pins: [],
}));

const catalog = { listPaletteEntries: () => ENTRIES } as unknown as IBlueprintNodeCatalogService;

function renderMenu() {
    const onPickEntry = vi.fn();
    const props = {
        nodeCatalog: catalog,
        paletteContext: {} as BlueprintPaletteContext,
        anchor: { x: 10, y: 10 },
        flowPosition: { x: 0, y: 0 },
        onClose: () => undefined,
        onPickEntry,
    };
    const view = render(<BlueprintAddNodeMenu {...props} open />);
    const row = (index: number) => document.body.querySelector(`[data-bp-add-node-idx="${index}"]`)!;
    const lit = () => document.body.querySelector("[aria-selected=\"true\"]")?.getAttribute("data-bp-add-node-idx") ?? null;
    const list = () => document.body.querySelector("#bp-add-node-list")!;
    const reopen = () => {
        view.rerender(<BlueprintAddNodeMenu {...props} open={false} />);
        view.rerender(<BlueprintAddNodeMenu {...props} open />);
    };
    return { row, lit, list, reopen, onPickEntry };
}

/** The tint on a row's frame: the highlight's, the hover's, or none. */
function frame(row: Element): string[] {
    return row.parentElement!.className.split(" ");
}

describe("hovering the blueprint add-node menu", () => {
    it("lights the row the pointer moves over", () => {
        const { row, lit } = renderMenu();
        fireEvent.mouseMove(row(1), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row(1), { clientX: 42, clientY: 31 });
        expect(lit()).toBe("1");
    });

    it("keeps what Enter adds when a wheel scrolls rows under a pointer at rest", () => {
        const { row, lit, list, onPickEntry } = renderMenu();
        fireEvent.mouseMove(row(0), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row(0), { clientX: 40, clientY: 32 });
        expect(lit()).toBe("0");

        // The wheel: the list scrolls, the rows move, the pointer does not.
        fireEvent.scroll(list());
        fireEvent.mouseEnter(row(3), { clientX: 40, clientY: 32 });
        fireEvent.mouseOver(row(3), { clientX: 40, clientY: 32 });
        fireEvent.mouseMove(row(3), { clientX: 40, clientY: 32 });
        expect(lit()).toBe("0");

        act(() => {
            fireEvent.keyDown(window, { key: "Enter" });
        });
        expect(onPickEntry).toHaveBeenCalledTimes(1);
        expect(onPickEntry.mock.calls[0][0]).toMatchObject({ displayName: "Add" });
    });

    it("lights nothing when the menu opens under a resting pointer, the second time as the first", () => {
        const { row, lit, reopen } = renderMenu();
        fireEvent.mouseMove(row(2), { clientX: 10, clientY: 10 });
        expect(lit()).toBeNull();

        fireEvent.mouseMove(row(2), { clientX: 12, clientY: 10 });
        expect(lit()).toBe("2");
        reopen();
        fireEvent.mouseMove(row(4), { clientX: 30, clientY: 60 });
        expect(lit()).toBeNull();
    });
});

describe("the tint on the blueprint add-node menu's rows", () => {
    it("draws the highlight in a colour of its own, not the hover's grey", () => {
        const { row } = renderMenu();
        fireEvent.mouseMove(row(1), { clientX: 40, clientY: 30 });
        fireEvent.mouseMove(row(1), { clientX: 42, clientY: 31 });
        expect(frame(row(1))).toContain("bg-primary/15");
        expect(frame(row(1))).not.toContain("bg-fill");
    });

    it("gives the hover tint only once the pointer has moved, and takes it away when rows move under it", () => {
        const { row, list } = renderMenu();
        fireEvent.mouseOver(row(2), { clientX: 10, clientY: 10 });
        fireEvent.mouseMove(row(2), { clientX: 10, clientY: 10 });
        expect(frame(row(3))).not.toContain("hover:bg-fill");

        fireEvent.mouseMove(row(2), { clientX: 12, clientY: 11 });
        expect(frame(row(3))).toContain("hover:bg-fill");

        fireEvent.scroll(list());
        expect(frame(row(3))).not.toContain("hover:bg-fill");
    });
});
