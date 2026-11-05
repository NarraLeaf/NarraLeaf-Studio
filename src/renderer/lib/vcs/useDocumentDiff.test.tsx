// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentDiff, type DocumentDiffResult } from "./useDocumentDiff";

const reads = vi.hoisted(() => [] as Array<{
    resolve(answer: DocumentDiffResult): void;
    reject(error: Error): void;
}>);
const service = vi.hoisted(() => ({
    diffRevisions: vi.fn(() => new Promise<DocumentDiffResult>((resolve, reject) => reads.push({ resolve, reject }))),
    diffWorkingTree: vi.fn(() => new Promise<DocumentDiffResult>((resolve, reject) => reads.push({ resolve, reject }))),
}));
vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: { services: { get: () => service } } }),
}));

const answer = (head: string): DocumentDiffResult => ({ documents: [], pathCount: 1, complete: true, readFailure: null, head });
beforeEach(() => { reads.length = 0; });

describe("comparison request lifetime", () => {
    it("keeps the latest working-tree request when an older answer arrives last", async () => {
        const { result, rerender } = renderHook(
            ({ readRequest }) => useDocumentDiff({ mode: "working-tree", readRequest }),
            { initialProps: { readRequest: 1 } },
        );
        await waitFor(() => expect(reads).toHaveLength(1));
        rerender({ readRequest: 2 });
        await waitFor(() => expect(reads).toHaveLength(2));
        await act(async () => { reads[1].resolve(answer("new")); });
        await act(async () => { reads[0].resolve(answer("old")); });
        expect(result.current.result?.head).toBe("new");
    });

    it("keeps a newer read loading when an older read fails", async () => {
        const { result, rerender } = renderHook(
            ({ from }) => useDocumentDiff({ mode: "between", from, to: "head" }),
            { initialProps: { from: "old" } },
        );
        await waitFor(() => expect(reads).toHaveLength(1));
        rerender({ from: "new" });
        await waitFor(() => expect(reads).toHaveLength(2));
        await act(async () => { reads[0].reject(new Error("old read failed")); });
        expect(result.current.loading).toBe(true);
        expect(result.current.error).toBeNull();
        await act(async () => { reads[1].resolve(answer("new")); });
        expect(result.current.result?.head).toBe("new");
    });

    it("drops the previous pair's rows as soon as another pair is requested", async () => {
        const { result, rerender } = renderHook(
            ({ from }) => useDocumentDiff({ mode: "between", from, to: "head" }),
            { initialProps: { from: "old" } },
        );
        await waitFor(() => expect(reads).toHaveLength(1));
        await act(async () => { reads[0].resolve(answer("old")); });
        rerender({ from: "new" });
        expect(result.current.result).toBeNull();
    });
});
