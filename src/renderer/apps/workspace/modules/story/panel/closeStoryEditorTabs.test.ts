import { describe, expect, it, vi } from "vitest";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { EditorLayout } from "../../../registry/types";
import { getSceneFlowTabId } from "../../story-flow/sceneFlowTabId";
import { getStorySceneEditorTabId } from "../scene-editor/storySceneEditorTabId";
import { closeStoryEditorTabs, closeStorySceneEditorTabs } from "./closeStoryEditorTabs";

const STORY = "story-1";
const OTHER = "story-2";
const sceneTab = (sceneId: string, storyId = STORY) => getStorySceneEditorTabId(storyId, sceneId);

function group(id: string, tabIds: string[]): EditorLayout {
    return { id, tabs: tabIds.map(tab => ({ id: tab })), focus: tabIds[0] } as unknown as EditorLayout;
}

function harness(layout: EditorLayout) {
    const closed: Array<{ tabId: string; groupId?: string }> = [];
    const uiService = {
        getStore: () => ({
            getEditorLayout: () => layout,
            closeEditorTabInGroup: (id: string, groupId?: string) => {
                closed.push({ tabId: id, groupId });
                return null;
            },
        }),
    } as unknown as UIService;
    return { uiService, closed };
}

describe("closeStorySceneEditorTabs", () => {
    it("closes the editors for the named scenes and leaves the rest alone", () => {
        const layout = group("g1", [sceneTab("scene-a"), sceneTab("scene-b"), "narraleaf-studio:dashboard"]);
        const { uiService, closed } = harness(layout);

        closeStorySceneEditorTabs(uiService, STORY, ["scene-a"]);

        expect(closed).toEqual([{ tabId: sceneTab("scene-a"), groupId: "g1" }]);
    });

    it("closes the same scene in every pane of a split", () => {
        const layout = {
            id: "root",
            first: group("g1", [sceneTab("scene-a")]),
            second: group("g2", [sceneTab("scene-a"), sceneTab("scene-b")]),
        } as unknown as EditorLayout;
        const { uiService, closed } = harness(layout);

        closeStorySceneEditorTabs(uiService, STORY, ["scene-a", "scene-b"]);

        // Closing only the focused pane's copy would leave the other showing a deleted scene.
        expect(closed).toEqual([
            { tabId: sceneTab("scene-a"), groupId: "g1" },
            { tabId: sceneTab("scene-a"), groupId: "g2" },
            { tabId: sceneTab("scene-b"), groupId: "g2" },
        ]);
    });

    it("ignores a scene of the same name in another story", () => {
        const layout = group("g1", [sceneTab("scene-a", OTHER)]);
        const { uiService, closed } = harness(layout);

        closeStorySceneEditorTabs(uiService, STORY, ["scene-a"]);

        expect(closed).toEqual([]);
    });

    it("does not read the layout at all for an empty chapter", () => {
        const getEditorLayout = vi.fn();
        const uiService = { getStore: () => ({ getEditorLayout }) } as unknown as UIService;

        closeStorySceneEditorTabs(uiService, STORY, []);

        expect(getEditorLayout).not.toHaveBeenCalled();
    });
});

describe("closeStoryEditorTabs", () => {
    it("closes every scene of the story and its flow map", () => {
        const layout = group("g1", [
            sceneTab("scene-a"),
            sceneTab("scene-b"),
            getSceneFlowTabId(STORY),
            "narraleaf-studio:dashboard",
        ]);
        const { uiService, closed } = harness(layout);

        closeStoryEditorTabs(uiService, STORY);

        expect(closed.map(c => c.tabId)).toEqual([
            sceneTab("scene-a"),
            sceneTab("scene-b"),
            getSceneFlowTabId(STORY),
        ]);
    });

    it("leaves another story's editors open", () => {
        const layout = group("g1", [sceneTab("scene-a", OTHER), getSceneFlowTabId(OTHER)]);
        const { uiService, closed } = harness(layout);

        closeStoryEditorTabs(uiService, STORY);

        expect(closed).toEqual([]);
    });

    it("reaches into every pane of a split", () => {
        const layout = {
            id: "root",
            first: group("g1", [sceneTab("scene-a")]),
            second: group("g2", [getSceneFlowTabId(STORY)]),
        } as unknown as EditorLayout;
        const { uiService, closed } = harness(layout);

        closeStoryEditorTabs(uiService, STORY);

        expect(closed).toEqual([
            { tabId: sceneTab("scene-a"), groupId: "g1" },
            { tabId: getSceneFlowTabId(STORY), groupId: "g2" },
        ]);
    });
});
