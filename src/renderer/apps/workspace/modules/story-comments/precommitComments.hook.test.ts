// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryCommentThread } from "@shared/types/storyComments";

const workspace = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/apps/workspace/context", () => ({ useOptionalWorkspace: () => workspace.value }));

import { useOpenThreadsInChanges } from "./precommitComments";

const paths = ["editor/story/stories/s1/storydoc.json"];
const thread = (id: string, resolved = false) =>
    ({ id, storyId: "s1", resolved, comments: [] }) as unknown as StoryCommentThread;

function makeService() {
    let threads: StoryCommentThread[] = [];
    let revision = 0;
    const listeners = new Set<() => void>();
    return {
        listThreads: () => threads,
        getRevision: () => revision,
        onChanged: (notify: () => void) => {
            listeners.add(notify);
            return () => { listeners.delete(notify); };
        },
        replace: (next: StoryCommentThread[]) => {
            threads = next;
            revision += 1;
            for (const notify of listeners) notify();
        },
    };
}

afterEach(() => {
    cleanup();
    workspace.value = null;
});

describe("open comment threads before a commit", () => {
    it("includes a thread written between rendering and subscribing", () => {
        const service = makeService();
        workspace.value = { context: { services: { get: () => service } } };
        function View() {
            const threads = useOpenThreadsInChanges(paths);
            useLayoutEffect(() => { service.replace([thread("a")]); }, []);
            return createElement("output", { "data-testid": "threads" }, threads.map(item => item.id).join(","));
        }

        render(createElement(View));
        expect(screen.getByTestId("threads").textContent).toBe("a");
    });

    it("updates when the service reloads or resolves a thread", () => {
        const service = makeService();
        workspace.value = { context: { services: { get: () => service } } };
        function View() {
            const threads = useOpenThreadsInChanges(paths);
            return createElement("output", { "data-testid": "threads" }, threads.map(item => item.id).join(","));
        }

        render(createElement(View));
        act(() => service.replace([thread("a")]));
        expect(screen.getByTestId("threads").textContent).toBe("a");
        act(() => service.replace([thread("a", true)]));
        expect(screen.getByTestId("threads").textContent).toBe("");
    });
});
