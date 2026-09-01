import { Camera } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { StorySnapshotPanel } from "./StorySnapshotPanel";
import { STORY_SNAPSHOT_PANEL_ID, type StorySnapshotPanelPayload } from "./storySnapshotPanelId";

/**
 * Scene Snapshot panel (right dock).
 *
 * A static module rather than a registration owned by the story scene editor, for the same reason
 * the Variables panel is one: the rail icon came and went with the focused scene tab, so the panel
 * that manages snapshots could only be found by opening a scene and putting the cursor in it. The
 * panel is what an author uses to decide how a row start begins, and a control that is only visible
 * once the author is already editing a row is a control they have to be told about.
 *
 * The scene it shows is still story-contextual, and arrives as this panel's payload from the focused
 * scene tab (see `StorySceneEditorTab`). With no story focused it says so, which is the same shape
 * the Variables panel has.
 *
 * `order: 3` keeps it with Properties, Variables and Dictionary, the panels that are always on the
 * rail, rather than in the 10-12 block the story editor still registers and unregisters.
 * `defaultVisible` stays false: the win here is that the icon is always present, and flipping this
 * would rewrite the saved right-dock layout of every existing project.
 */
export const storySnapshotPanelModule: PanelModule<StorySnapshotPanelPayload> = {
    metadata: {
        id: STORY_SNAPSHOT_PANEL_ID,
        // Resolved lazily on read (module registration runs before i18n init).
        titleKey: "story.sceneEditor.snapshotsPanel",
        get title() {
            return translate("story.sceneEditor.snapshotsPanel");
        },
        icon: <Camera className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: false,
        order: 3,
    },
    component: StorySnapshotPanel,
};

export { StorySnapshotPanel } from "./StorySnapshotPanel";
export { STORY_SNAPSHOT_PANEL_ID, type StorySnapshotPanelPayload } from "./storySnapshotPanelId";
export { getSelectedSnapshotId, setSelectedSnapshotId } from "./storySnapshotSelection";
