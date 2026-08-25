// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import { Services } from "@/lib/workspace/services/services";
import { StoryPanel } from "./StoryPanel";

/**
 * Which chapters the outline shows expanded, across a switch from one story to another.
 *
 * A story the panel has not shown before opens with all of them expanded. The switch is where that
 * used to be lost: the document the panel holds is still the story being left until the new one
 * finishes loading, and the panel read that document's chapter ids as if they belonged to the story
 * being entered. They matched nothing in it, so the outline settled on the empty set - and, because
 * the panel writes its open sections back to the panel state, stayed collapsed from then on.
 */

const FIRST_STORY = "first";
const SECOND_STORY = "second";

function storyDocument(id: string, chapterId: string, sceneId: string, sceneName: string): StoryDocument {
    return {
        id,
        name: id,
        entrySceneId: sceneId,
        chapters: [{ id: chapterId, name: `${id} chapter`, sceneIds: [sceneId] }],
        scenes: { [sceneId]: { id: sceneId, name: sceneName, rootBlockIds: [], blocks: {} } },
    } as unknown as StoryDocument;
}

const documents: Record<string, StoryDocument> = {
    [FIRST_STORY]: storyDocument(FIRST_STORY, "first-chapter", "first-scene", "Rooftop"),
    [SECOND_STORY]: storyDocument(SECOND_STORY, "second-chapter", "second-scene", "Harbour"),
};

let savedPanelState: unknown;

vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFreeze: () => null,
}));

const storyService = {
    listStories: () => [
        { id: FIRST_STORY, name: "First story" },
        { id: SECOND_STORY, name: "Second story" },
    ],
    getDefaultStoryId: () => FIRST_STORY,
    onLibraryChanged: () => () => undefined,
    onDocumentChanged: () => () => undefined,
    loadStory: async (storyId: string) => documents[storyId],
};

const workspace = {
    isInitialized: true,
    context: {
        services: {
            get: (id: unknown) => {
                if (id === Services.Live) return { ownsStory: () => false, onChanged: () => () => undefined };
                if (id === Services.Story) return storyService;
                if (id === Services.PanelState) {
                    return {
                        getPanelState: () => savedPanelState,
                        setPanelState: (_panelId: string, state: unknown) => {
                            savedPanelState = state;
                        },
                    };
                }
                if (id === Services.UI) return { showError: vi.fn(), showNotification: vi.fn() };
                return null;
            },
        },
    },
};

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => workspace,
}));

vi.mock("@/apps/workspace/registry", () => ({
    useRegistry: () => ({ openEditorTab: vi.fn() }),
}));

vi.mock("../script/useStoryScriptIo", () => ({
    useStoryScriptIo: () => ({ beginExport: vi.fn(), beginImport: vi.fn(), dialogs: null }),
}));
vi.mock("../narralang/useNarralangExport", () => ({
    useNarralangExport: () => ({ beginExport: vi.fn(), dialogs: null }),
}));

/**
 * Whether a chapter heading shows itself expanded. The section body is in the document either way -
 * a closed one is a box of zero height - so the answer is the chevron, which is the same thing the
 * author reads.
 */
async function chapterIsExpanded(name: string): Promise<boolean> {
    const heading = await screen.findByText(name);
    const chevron = heading.closest("button")?.querySelector("svg.lucide-chevron-right");
    return (chevron as SVGElement | null)?.style.rotate === "90deg";
}

beforeEach(() => {
    savedPanelState = undefined;
});

afterEach(cleanup);

describe("the story outline's chapters", () => {
    it("opens a story with every chapter expanded", async () => {
        render(<StoryPanel panelId="story" />);

        expect(await chapterIsExpanded("first chapter (1)")).toBe(true);
    });

    it("keeps them expanded after switching to another story", async () => {
        render(<StoryPanel panelId="story" />);
        await screen.findByText("first chapter (1)");

        fireEvent.click(screen.getByText("Second story"));
        await waitFor(async () => {
            expect(await chapterIsExpanded("second chapter (1)")).toBe(true);
        });
    });

    it("does not write the switched-to story an empty set of open chapters", async () => {
        render(<StoryPanel panelId="story" />);
        await screen.findByText("first chapter (1)");

        fireEvent.click(screen.getByText("Second story"));
        await screen.findByText("second chapter (1)");

        await waitFor(() => {
            const state = savedPanelState as { chapterOpenItemsByStoryId?: Record<string, string[]> };
            expect(state?.chapterOpenItemsByStoryId?.[SECOND_STORY]).toEqual(["second-chapter"]);
        });
    });

    it("restores a story that was left with a chapter collapsed", async () => {
        savedPanelState = {
            selectedStoryId: FIRST_STORY,
            rootOpenItems: ["stories", "outline"],
            chapterOpenItemsByStoryId: { [SECOND_STORY]: ["second-chapter"], [FIRST_STORY]: [] },
        };
        render(<StoryPanel panelId="story" />);

        // The first story's stored list names no chapter, which is not a state worth restoring: an
        // outline with nothing under any heading is what the older switch bug left behind, and it is
        // indistinguishable from an author having shut every section by hand.
        expect(await chapterIsExpanded("first chapter (1)")).toBe(true);
    });
});
