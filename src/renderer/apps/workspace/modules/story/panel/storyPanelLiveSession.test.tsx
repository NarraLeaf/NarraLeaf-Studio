// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import { story as en } from "@shared/i18n/catalog/en/story";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { Services } from "@/lib/workspace/services/services";
import { storyDocumentFreezeScope } from "../scene-editor/storySceneReadOnly";
import { StoryPanel } from "./StoryPanel";

/**
 * The story outline while a live session owns the story it is showing.
 *
 * The outline splits in two, and not along the line the freeze draws. Renaming a scene, choosing
 * the entry scene and reordering chapters are operations a session carries to everybody in the
 * room, so they keep working - that is the whole point of a freeze that leaves one document
 * writable. Creating and deleting a scene or a chapter are not in that vocabulary at all, so they
 * would be written into this machine's copy and into no other, and the copies would part company
 * with nothing on screen to say so.
 *
 * The Plus buttons are what this measures, because they are real `<button>`s and answer
 * `:disabled`. The context-menu rows take their state from the same guard object in the same render.
 */

const STORY_ID = "chapter-one";
const ANOTHER_STORY = "chapter-two";
const CHAPTER_ID = "chapter-a";
const SCENE_ID = "scene-1";

const IN_A_SESSION = en.live.editUnavailable;
const FROZEN = "Unavailable while the project is frozen. Unfreeze the project to use it.";
/**
 * The same string for the one freeze that has no unfreeze.
 *
 * A live session is left or closed, so the sentence above would name a control that is itself
 * unavailable. Which one a greyed control shows is the freeze's kind and nothing else - what it
 * may DO is still the write boundary's own predicate.
 */
const FROZEN_LIVE = "Unavailable during a live session. Leave the session to use it.";

const document = {
    id: STORY_ID,
    name: "My Game",
    entrySceneId: SCENE_ID,
    chapters: [{ id: CHAPTER_ID, name: "Chapter One", sceneIds: [SCENE_ID] }],
    scenes: { [SCENE_ID]: { id: SCENE_ID, name: "Rooftop", rootBlockIds: [], blocks: {} } },
} as unknown as StoryDocument;

let freeze: WorkspaceFreezeReason | null = null;
let ownedStoryId: string | null = null;

vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFreeze: () => freeze,
}));

const liveSessionService = {
    ownsStory: (storyId: string) => ownedStoryId !== null && ownedStoryId === storyId,
    onChanged: () => () => undefined,
};

const storyService = {
    listStories: () => [{ id: STORY_ID, name: "My Game" }],
    getDefaultStoryId: () => STORY_ID,
    onLibraryChanged: () => () => undefined,
    onDocumentChanged: () => () => undefined,
    loadStory: async () => document,
};

const workspace = {
    isInitialized: true,
    context: {
        services: {
            get: (id: unknown) => {
                if (id === Services.Live) return liveSessionService;
                if (id === Services.Story) return storyService;
                if (id === Services.PanelState) return { getPanelState: () => undefined, setPanelState: () => undefined };
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

// Both mount dialogs of their own and read the asset, character and blueprint tables to do it.
// Nothing here opens either flow; what matters about them is which guard their menu rows carry,
// and that is asserted through the rows themselves.
vi.mock("../script/useStoryScriptIo", () => ({
    useStoryScriptIo: () => ({ beginExport: vi.fn(), beginImport: vi.fn(), dialogs: null }),
}));
vi.mock("../narralang/useNarralangExport", () => ({
    useNarralangExport: () => ({ beginExport: vi.fn(), dialogs: null }),
}));

/**
 * The three `+` buttons the panel shows once a story is selected and its outline has loaded, in
 * document order: New story (the library, which no partial freeze spares), New chapter, and New
 * scene in this chapter.
 */
async function plusButtons(): Promise<HTMLButtonElement[]> {
    render(<StoryPanel panelId="story" />);
    await screen.findByText("Chapter One (1)");
    return [...window.document.querySelectorAll("svg.lucide-plus")]
        .map(icon => icon.closest("button") as HTMLButtonElement);
}

/**
 * One row of an open context menu, by the label the author reads.
 *
 * The menu portals itself into the body and its rows are `<div>`s rather than form controls, so a
 * greyed one is read through the tooltip it carries and the cursor it takes, not through
 * `:disabled`.
 */
async function menuRow(label: string): Promise<HTMLElement> {
    return (await screen.findByText(label)).parentElement as HTMLElement;
}

async function openChapterMenu(): Promise<void> {
    fireEvent.contextMenu(await screen.findByText("Chapter One (1)"));
    await waitFor(() => screen.getByText(en.panel.newSceneInChapter));
}

beforeEach(() => {
    freeze = null;
    ownedStoryId = null;
});

afterEach(cleanup);

describe("the outline while a session owns this story", () => {
    beforeEach(() => {
        ownedStoryId = STORY_ID;
        freeze = {
            kind: "live-session",
            session: "room-1",
            writable: [storyDocumentFreezeScope(STORY_ID)!],
        };
    });

    it("switches off New chapter and New scene, with the reason on them", async () => {
        const [newStory, newChapter, newScene] = await plusButtons();

        expect(newChapter.matches(":disabled")).toBe(true);
        expect(newChapter.getAttribute("data-tip")).toBe(IN_A_SESSION);
        expect(newScene.matches(":disabled")).toBe(true);
        expect(newScene.getAttribute("data-tip")).toBe(IN_A_SESSION);
        // The library above is a different document, which no partial freeze leaves writable, so it
        // shows the sentence every control a freeze switches off shows.
        expect(newStory.matches(":disabled")).toBe(true);
        expect(newStory.getAttribute("data-tip")).toBe(FROZEN_LIVE);
    });

    it("keeps a scene's rename and entry-scene rows live, because both travel", async () => {
        await plusButtons();
        fireEvent.contextMenu(await screen.findByText("Rooftop"));
        await waitFor(() => screen.getByText(en.panel.setEntryScene));

        expect((await menuRow("Rename")).getAttribute("data-tip")).toBeNull();
        // Delete does not, so it comes off in the same menu.
        expect((await menuRow("Delete")).getAttribute("data-tip")).toBe(IN_A_SESSION);
    });

    it("takes the chapter's own three rows off with the same reason", async () => {
        await plusButtons();
        await openChapterMenu();

        for (const label of [en.panel.newSceneInChapter, "Rename", "Delete"]) {
            expect((await menuRow(label)).getAttribute("data-tip"), label).toBe(IN_A_SESSION);
        }
    });
});

describe("the outline with a session on some other story", () => {
    it("leaves the whole outline alone", async () => {
        ownedStoryId = ANOTHER_STORY;
        const [, newChapter, newScene] = await plusButtons();

        expect(newChapter.matches(":disabled")).toBe(false);
        expect(newScene.matches(":disabled")).toBe(false);
        expect(newChapter.getAttribute("data-tip")).toBe(en.panel.newChapter);
    });
});

describe("the outline with no session at all", () => {
    it("is live when nothing is frozen", async () => {
        const [newStory, newChapter, newScene] = await plusButtons();

        expect(newStory.matches(":disabled")).toBe(false);
        expect(newChapter.matches(":disabled")).toBe(false);
        expect(newScene.matches(":disabled")).toBe(false);
    });

    it("is switched off by an ordinary freeze exactly as it was", async () => {
        freeze = { kind: "manual" };
        const [newStory, newChapter, newScene] = await plusButtons();

        for (const button of [newStory, newChapter, newScene]) {
            expect(button.matches(":disabled")).toBe(true);
            expect(button.getAttribute("data-tip")).toBe(FROZEN);
        }
    });
});
