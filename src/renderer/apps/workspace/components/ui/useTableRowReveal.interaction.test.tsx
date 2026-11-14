// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVEAL_PATIENCE_MS, useTableRowReveal, type TableRowRevealRequest } from "./useTableRowReveal";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("useTableRowReveal", () => {
    it("replaces a pending request before processing rows that arrive with a newer request", () => {
        const scrollToIndex = vi.fn();
        const showAll = vi.fn();
        const { rerender, result } = renderHook(
            ({ request, rows }: { request: TableRowRevealRequest; rows: string[] }) => useTableRowReveal({
                request,
                indexOf: id => rows.indexOf(id),
                inTable: id => rows.includes(id),
                showAll,
                scrollToIndex,
            }),
            { initialProps: { request: { unitId: "first", token: 1 }, rows: [] as string[] } },
        );

        rerender({ request: { unitId: "second", token: 2 }, rows: ["first", "second"] });

        expect(scrollToIndex).toHaveBeenCalledTimes(1);
        expect(scrollToIndex).toHaveBeenCalledWith(1);
        expect(result.current.markedUnitId).toBe("second");
        expect(showAll).not.toHaveBeenCalled();
    });

    it("does not clear filters for an older request when a new request arrives", () => {
        const scrollToIndex = vi.fn();
        const showAll = vi.fn();
        const { rerender } = renderHook(
            ({ request, firstIsInTable }: { request: TableRowRevealRequest; firstIsInTable: boolean }) => useTableRowReveal({
                request,
                indexOf: id => id === "second" ? 3 : -1,
                inTable: id => id === "second" || firstIsInTable,
                showAll,
                scrollToIndex,
            }),
            { initialProps: { request: { unitId: "first", token: 1 }, firstIsInTable: false } },
        );

        rerender({ request: { unitId: "second", token: 2 }, firstIsInTable: true });

        expect(showAll).not.toHaveBeenCalled();
        expect(scrollToIndex).toHaveBeenCalledOnce();
        expect(scrollToIndex).toHaveBeenCalledWith(3);
    });

    it("keeps a request while the row loads even if the payload is cleared", () => {
        const scrollToIndex = vi.fn();
        const { rerender, result } = renderHook(
            ({ request, rows }: { request: TableRowRevealRequest | undefined; rows: string[] }) => useTableRowReveal({
                request,
                indexOf: id => rows.indexOf(id),
                inTable: id => rows.includes(id),
                showAll: () => {},
                scrollToIndex,
            }),
            { initialProps: { request: { unitId: "row", token: 1 } as TableRowRevealRequest | undefined, rows: [] as string[] } },
        );

        rerender({ request: undefined, rows: ["row"] });

        expect(scrollToIndex).toHaveBeenCalledOnce();
        expect(scrollToIndex).toHaveBeenCalledWith(0);
        expect(result.current.markedUnitId).toBe("row");
    });

    it("stops waiting for a row that never arrives", () => {
        vi.useFakeTimers();
        const scrollToIndex = vi.fn();
        const { rerender } = renderHook(
            ({ rows }: { rows: string[] }) => useTableRowReveal({
                request: { unitId: "row", token: 1 },
                indexOf: id => rows.indexOf(id),
                inTable: id => rows.includes(id),
                showAll: () => {},
                scrollToIndex,
            }),
            { initialProps: { rows: [] as string[] } },
        );

        act(() => { vi.advanceTimersByTime(REVEAL_PATIENCE_MS); });
        rerender({ rows: ["row"] });
        expect(scrollToIndex).not.toHaveBeenCalled();
    });
});
