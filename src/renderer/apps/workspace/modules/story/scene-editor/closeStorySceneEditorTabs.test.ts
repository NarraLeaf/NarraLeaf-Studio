import { describe, expect, it, vi } from "vitest";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { EditorLayout } from "../../../registry/types";
import { closeStorySceneEditorTabs } from "./closeStorySceneEditorTabs";
import { getStorySceneEditorTabId } from "./storySceneEditorTabId";

const STORY = "story-1";
const tabId = (sceneId: string) => getStorySceneEditorTabId(STORY, sceneId);

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
        const layout = group("g1", [tabId("scene-a"), tabId("scene-b"), "narraleaf-studio:dashboard"]);
        const { uiService, closed } = harness(layout);

        closeStorySceneEditorTabs(uiService, STORY, ["scene-a"]);

        expect(closed).toEqual([{ tabId: tabId("scene-a"), groupId: "g1" }]);
    });

    it("closes the same scene in every pane of a split", () => {
        const layout = {
            id: "root",
            first: group("g1", [tabId("scene-a")]),
            second: group("g2", [tabId("scene-a"), tabId("scene-b")]),
        } as unknown as EditorLayout;
        const { uiService, closed } = harness(layout);

        closeStorySceneEditorTabs(uiService, STORY, ["scene-a", "scene-b"]);

        // Closing only the focused pane's copy would leave the other showing a deleted scene.
        expect(closed).toEqual([
            { tabId: tabId("scene-a"), groupId: "g1" },
            { tabId: tabId("scene-a"), groupId: "g2" },
            { tabId: tabId("scene-b"), groupId: "g2" },
        ]);
    });

    it("ignores a scene of the same name in another story", () => {
        const layout = group("g1", [getStorySceneEditorTabId("story-2", "scene-a")]);
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
