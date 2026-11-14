// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import { useStoryDocument } from "./StoryScenePreviewFloatHost";

function workspace(loadStory: (id: string) => Promise<StoryDocument>) {
    const unsubscribe = vi.fn();
    const story = { loadStory, onDocumentChanged: () => unsubscribe };
    return { context: { services: { get: () => story } } as never, unsubscribe };
}

afterEach(cleanup);

describe("the preview's story document", () => {
    it("does not show the preceding project's story while a same-id story loads", async () => {
        const first = { id: "story-1", name: "First project" } as StoryDocument;
        const second = { id: "story-1", name: "Second project" } as StoryDocument;
        let finishSecond: (document: StoryDocument) => void = () => undefined;
        const a = workspace(async () => first);
        const b = workspace(() => new Promise(resolve => { finishSecond = resolve; }));
        const hook = renderHook(({ context }) => useStoryDocument(context, "story-1"), {
            initialProps: { context: a.context },
        });
        await waitFor(() => expect(hook.result.current?.name).toBe("First project"));

        hook.rerender({ context: b.context });
        expect(a.unsubscribe).toHaveBeenCalledOnce();
        expect(hook.result.current).toBeNull();

        await act(async () => finishSecond(second));
        expect(hook.result.current?.name).toBe("Second project");
    });

    it("ignores a load that finishes after its workspace was replaced", async () => {
        let finishFirst: (document: StoryDocument) => void = () => undefined;
        const a = workspace(() => new Promise(resolve => { finishFirst = resolve; }));
        const b = workspace(async () => ({ id: "story-1", name: "Current" }) as StoryDocument);
        const hook = renderHook(({ context }) => useStoryDocument(context, "story-1"), {
            initialProps: { context: a.context },
        });

        hook.rerender({ context: b.context });
        await waitFor(() => expect(hook.result.current?.name).toBe("Current"));
        await act(async () => finishFirst({ id: "story-1", name: "Previous" } as StoryDocument));
        expect(hook.result.current?.name).toBe("Current");
    });
});
