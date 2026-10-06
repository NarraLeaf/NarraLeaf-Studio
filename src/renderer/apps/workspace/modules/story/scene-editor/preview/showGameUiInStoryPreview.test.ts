import { describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { UIStore } from "@/lib/workspace/services/ui/UIStore";
import { FocusManager } from "@/lib/workspace/services/ui/FocusManager";
import { getStoryEditorViewState } from "../storyEditorSessionStore";
import { getStorySceneEditorTabId, type StorySceneEditorTabPayload } from "../storySceneEditorTabId";
import { getStoryPreviewHub } from "./storyPreviewHub";
import { trackStoryPreviewFloatOwner } from "./storyPreviewFloatTracking";
import { showGameUiInStoryPreview } from "./showGameUiInStoryPreview";

// The scene editor itself is not under test; a tab definition with its id and payload is enough.
vi.mock("../openStorySceneEditorTab", () => ({
    createStorySceneEditorTab: (payload: StorySceneEditorTabPayload, title: string): EditorTabDefinition => ({
        id: getStorySceneEditorTabId(payload.storyId, payload.sceneId),
        title,
        component: () => null,
        payload,
    }),
}));

/**
 * Opening the floating live preview on a Game UI from the UI editor: it keeps showing a scene editor's
 * scene at that editor's cursor, and only chooses the row - the cursor's own when it shows the Game
 * UI, the next one that does otherwise, and the first scene that has one when the scene on show has
 * none. Driven through a real `UIStore` and the hub's own focus tracking, so the scene the window
 * shows is decided the way it is in Studio.
 */

function row(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const say = (id: string) =>
    row(id, "nodeAction", { action: "dialogue", characterId: "c", text: { textId: `${id}-t`, value: "Hello.", role: "dialogue" } });
const command = (id: string) => row(id, "action", { action: "setVariable", target: { scope: "scene", variableId: "v" }, value: 1 });
const menu = (id: string, optionId: string) => row(id, "nodeAction", { action: "choice" }, null, [optionId]);
const option = (id: string, parentId: string) =>
    row(id, "nodeAction", { action: "choiceOption", text: { textId: `${id}-t`, value: id, role: "choiceText" } }, parentId);

function makeScene(id: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name: id,
        runtimeName: id,
        rootBlockIds: blocks.filter(block => block.parentId === null).map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

/** One story: a corridor of commands and lines, then a clubroom that ends in a menu. */
function story(): StoryDocument {
    const corridor = makeScene("corridor", [command("c0"), say("c1"), command("c2"), say("c3")]);
    const clubroom = makeScene("clubroom", [say("k1"), menu("k2", "k2a"), option("k2a", "k2")]);
    return {
        schemaVersion: 12,
        id: "story",
        name: "Story",
        entrySceneId: "corridor",
        chapters: [{ id: "ch", name: "One", sceneIds: ["corridor", "clubroom"] }],
        scenes: { corridor, clubroom },
    } as unknown as StoryDocument;
}

function fakePanelState(): PanelStateService {
    const store: Record<string, Record<string, unknown>> = {};
    return {
        getPanelState: (panelId: string) => store[panelId],
        setPanelState: (panelId: string, partial: Record<string, unknown>) => {
            store[panelId] = { ...(store[panelId] ?? {}), ...partial };
        },
    } as unknown as PanelStateService;
}

function setup(document: StoryDocument = story()) {
    const store = new UIStore();
    const focus = new FocusManager();
    const panelState = fakePanelState();
    const services: Record<string, unknown> = {
        [Services.UI]: { getStore: () => store },
        [Services.PanelState]: panelState,
        [Services.Story]: {
            listStories: () => [{ id: document.id, name: document.name }],
            getDefaultStoryId: () => document.id,
            loadStory: async () => document,
        },
    };
    const context = { services: { get: (id: string) => services[id] } } as unknown as WorkspaceContext;
    const hub = getStoryPreviewHub(context);
    trackStoryPreviewFloatOwner({ store, focus }, hub);
    // A UI editor is the tab in front; story tabs, when there are any, sit behind it.
    store.openEditorTabInGroup({ id: "ui-surface:dialogue", title: "Dialogue", component: () => null });
    const show = (slotId: "dialog" | "choice" | "notification") =>
        showGameUiInStoryPreview({ context, slotId, groupId: null, anchor: () => null });
    const openStoryTab = (sceneId: string, activate = true) =>
        store.openEditorTabInGroup(
            { id: getStorySceneEditorTabId("story", sceneId), title: sceneId, component: () => null, payload: { storyId: "story", sceneId } },
            undefined,
            activate,
        );
    return { store, hub, panelState, show, openStoryTab };
}

const CORRIDOR = getStorySceneEditorTabId("story", "corridor");
const CLUBROOM = getStorySceneEditorTabId("story", "clubroom");

describe("showGameUiInStoryPreview", () => {
    it("floats the preview over the scene it already shows when the cursor's row shows the Game UI", async () => {
        const { hub, show, openStoryTab } = setup();
        openStoryTab("corridor");
        hub.publishCursor("corridor", "c3");
        expect(await show("dialog")).toBe("shown");
        expect(hub.getCursor("corridor")).toBe("c3");
        expect(hub.getLayout()).toMatchObject({ open: true, mode: "float" });
        expect(hub.getTarget()).toBe(CORRIDOR);
    });

    it("steps the cursor to the next row that shows it", async () => {
        const { hub, panelState, show, openStoryTab } = setup();
        openStoryTab("corridor");
        hub.publishCursor("corridor", "c0");
        expect(await show("dialog")).toBe("shown");
        expect(hub.getCursor("corridor")).toBe("c1");
        // The tab is not mounted in this test, so the step is written where the editor reads it back.
        expect(getStoryEditorViewState(panelState, "corridor")?.activeBlockId).toBe("c1");
    });

    it("opens the first scene with such a row behind the editor in front, and shows that scene", async () => {
        const { store, hub, show, openStoryTab } = setup();
        openStoryTab("corridor", false);
        expect(hub.getTarget()).toBe(CORRIDOR);
        expect(await show("choice")).toBe("shown");
        expect(hub.getTarget()).toBe(CLUBROOM);
        expect(hub.getCursor("clubroom")).toBe("k2");
        // Opened, not brought forward: the UI editor stays in front.
        expect(store.getLastFocusedEditorTab()?.tabId).toBe("ui-surface:dialogue");
    });

    it("starts in the story's entry scene when no scene editor is open", async () => {
        const { hub, show } = setup();
        expect(await show("dialog")).toBe("shown");
        expect(hub.getTarget()).toBe(CORRIDOR);
        expect(hub.getCursor("corridor")).toBe("c1");
    });

    it("leaves the preview alone when no row shows the Game UI", async () => {
        const silent = story();
        silent.scenes = { corridor: makeScene("corridor", [command("c0")]) };
        silent.chapters = [{ id: "ch", name: "One", sceneIds: ["corridor"] }];
        const { hub, show } = setup(silent);
        expect(await show("dialog")).toBe("noRow");
        expect(await show("notification")).toBe("noRow");
        expect(hub.getLayout().open).toBe(false);
        expect(hub.getTarget()).toBeNull();
    });

    it("gives the window a place the first time and keeps the place the author gave it after", async () => {
        const { hub, openStoryTab, show } = setup();
        openStoryTab("corridor");
        await show("dialog");
        // No area is laid out here, so the window takes the margin from the origin.
        expect(hub.getLayout().float).not.toBeNull();
        hub.patchLayout({ float: { x: 10, y: 20, width: 300, height: 200 } });
        await show("dialog");
        expect(hub.getLayout().float).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    });
});
