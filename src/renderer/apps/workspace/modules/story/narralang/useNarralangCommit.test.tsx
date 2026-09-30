// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import { Services } from "@/lib/workspace/services/services";
import type { StoryCommandContext } from "../scene-editor/storyCommandValues";
import { useNarralangCommit } from "./useNarralangCommit";

/**
 * Writing the script buffer back while a live session owns the story.
 *
 * The commit's one write is `StoryService.replaceScene`, which replaces a whole scene at once - and
 * a session's vocabulary has no operation for that, so the rewrite would land in this machine's
 * document and in nobody else's. The next effect the host broadcast about the scene would then find
 * two different scenes, and the divergence guard would put this window out of the room.
 *
 * The view is already read-only with the reason on it. This is the second enforcement point, and it
 * is the one worth a test: a commit fires from a debounce timer and from a blur handler, and either
 * can be in flight at the moment a session opens.
 *
 * Everything the commit does *after* the refusal is stubbed - the printer, the reconciler and the
 * lookups all read a real project - so what is measured here is the decision and not the pipeline.
 */

const THIS_STORY = "chapter-one";
const ANOTHER_STORY = "chapter-two";
const SCENE_ID = "scene-1";

let ownedStoryId: string | null = null;

const replaceScene = vi.fn();
const checkpoint = vi.fn();
const breakMerge = vi.fn();

const workspace = {
    context: {
        services: {
            get: (id: unknown) => {
                if (id === Services.Live) {
                    return { ownsStory: (storyId: string) => ownedStoryId === storyId };
                }
                if (id === Services.Story) {
                    return { replaceScene };
                }
                if (id === Services.History) {
                    return { checkpoint, breakMerge };
                }
                return null;
            },
        },
    },
    isInitialized: true,
};

vi.mock("../../../context", () => ({
    useWorkspace: () => workspace,
}));

// The printer answers "this scene can be said as a script", which is the gate the commit checks
// before it reconciles anything.
vi.mock("@/lib/story/narralang/narralangPrinter", () => ({
    printNarralangScene: () => ({ text: "", issues: [] }),
}));

vi.mock("@/lib/story/narralang/narralangReconcile", () => ({
    reconcileNarralangScene: () => ({
        ok: true,
        rootBlockIds: ["block-1"],
        blocks: { "block-1": { id: "block-1" } },
        sceneName: null,
    }),
}));

vi.mock("./narralangLookups", () => ({
    narralangLookups: () => ({}),
    narralangReferences: () => ({ lookups: {}, parseLookups: {} }),
}));
vi.mock("../scene-editor/storyCommandResolution", () => ({ expressionScope: () => ({}) }));
vi.mock("./narralangEdit", () => ({
    NARRALANG_HISTORY_MERGE_WINDOW_MS: 1000,
    narralangHistoryMergeKey: (sceneId: string) => `narralang:${sceneId}`,
    // The buffer always says something the scene does not, so nothing is refused as "unchanged".
    narralangSceneMoved: () => true,
}));

const scene = { id: SCENE_ID, name: "Rooftop", rootBlockIds: [], blocks: {} } as unknown as StoryScene;
const document = { id: THIS_STORY, name: "Story", scenes: { [SCENE_ID]: scene } } as unknown as StoryDocument;
const commandContext = {} as StoryCommandContext;

function commitOnce() {
    const { result } = renderHook(() => useNarralangCommit(scene, document, commandContext, true));
    return result.current.commit("十時 · 屋上");
}

beforeEach(() => {
    ownedStoryId = null;
    replaceScene.mockClear();
    checkpoint.mockClear();
});

afterEach(cleanup);

describe("a NarraLang commit", () => {
    it("writes the scene back when no session owns the story", () => {
        expect(commitOnce().kind).toBe("committed");
        expect(replaceScene).toHaveBeenCalledTimes(1);
    });

    it("goes nowhere while a session owns this story", () => {
        ownedStoryId = THIS_STORY;

        expect(commitOnce().kind).toBe("unavailable");
        expect(replaceScene).not.toHaveBeenCalled();
        // Not even an undo entry: a checkpoint in front of a write that never happens is a step the
        // author would find on the stack with nothing behind it.
        expect(checkpoint).not.toHaveBeenCalled();
    });

    it("is left alone by a session on a different story", () => {
        ownedStoryId = ANOTHER_STORY;

        expect(commitOnce().kind).toBe("committed");
        expect(replaceScene).toHaveBeenCalledTimes(1);
    });
});
