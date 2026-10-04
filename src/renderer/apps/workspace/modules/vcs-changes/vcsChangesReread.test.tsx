// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { useDocumentDiff, type DocumentDiffRequest } from "@/lib/vcs/useDocumentDiff";
import { openVcsChangesTab } from "./openVcsChangesTab";
import type { VcsChangesPayload } from "./vcsChangesIds";

/**
 * Pressing "compare with the previous version" while the comparison is already open shows the
 * working tree as it is now.
 *
 * The working tree has one tab and the tab never reads on its own, so a second press used to bring
 * the open tab forward with the list it read the first time: an asset moved after that first press
 * was simply not in the index. Each press now carries a new `readRequest`, and the read is keyed on it.
 */

const vcs = vi.hoisted(() => ({
    diffWorkingTree: vi.fn(async () => ({ documents: [], pathCount: 0, complete: true, readFailure: null })),
    diffRevisions: vi.fn(async () => ({ documents: [], pathCount: 0, complete: true, readFailure: null })),
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: { services: { get: () => vcs } } }),
}));

function recordingContext(): { ctx: WorkspaceContext; opened: EditorTabDefinition<VcsChangesPayload>[] } {
    const opened: EditorTabDefinition<VcsChangesPayload>[] = [];
    const ui = { editor: { openOrUpdate: (tab: EditorTabDefinition<VcsChangesPayload>) => opened.push(tab) } };
    return { ctx: { services: { get: () => ui } } as unknown as WorkspaceContext, opened };
}

describe("opening the working-tree comparison", () => {
    it("asks for a fresh read on every press, in the one tab the working tree has", () => {
        const { ctx, opened } = recordingContext();

        openVcsChangesTab(ctx, { mode: "working-tree", headNumber: 2 });
        openVcsChangesTab(ctx, { mode: "working-tree", headNumber: 2 });

        expect(opened.map(tab => tab.id)).toEqual([opened[0].id, opened[0].id]);
        const [first, second] = opened.map(tab => tab.payload);
        expect(first?.mode === "working-tree" && first.readRequest).toBeGreaterThan(0);
        expect(second?.mode === "working-tree" && first?.mode === "working-tree" && second.readRequest! > first.readRequest!)
            .toBe(true);
    });

    it("leaves a revision pair as it was asked for", () => {
        const { ctx, opened } = recordingContext();
        const pair: VcsChangesPayload = { mode: "between", from: "a", to: "b", fromNumber: 1, toNumber: 2 };

        openVcsChangesTab(ctx, pair);

        expect(opened[0].payload).toEqual(pair);
    });
});

describe("reading the working tree", () => {
    it("reads once per request, and again when a new request arrives", async () => {
        vcs.diffWorkingTree.mockClear();
        const { rerender } = renderHook(
            ({ request }: { request: DocumentDiffRequest }) => useDocumentDiff(request, { enabled: true }),
            { initialProps: { request: { mode: "working-tree", readRequest: 1 } as DocumentDiffRequest } },
        );
        await waitFor(() => expect(vcs.diffWorkingTree).toHaveBeenCalledTimes(1));

        // The same request rendered again is not a poll.
        rerender({ request: { mode: "working-tree", readRequest: 1 } });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(vcs.diffWorkingTree).toHaveBeenCalledTimes(1);

        rerender({ request: { mode: "working-tree", readRequest: 2 } });
        await waitFor(() => expect(vcs.diffWorkingTree).toHaveBeenCalledTimes(2));
    });
});
