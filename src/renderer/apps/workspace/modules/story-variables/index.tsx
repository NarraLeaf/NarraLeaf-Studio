import { Variable } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { StoryVariablesPanel } from "./StoryVariablesPanel";
import { STORY_VARIABLES_PANEL_ID } from "./storyVariablesPanelId";

/**
 * Variables panel (right dock).
 *
 * A static module rather than a registration owned by the story scene editor, because two of its
 * three sections are PROJECT resources: saved and global variables live in the project registry
 * (`editor/variables.json`) and are authored from here, so they must be reachable without a story
 * open - which the old dynamic registration made impossible, since the rail icon itself came and
 * went with the focused scene tab.
 *
 * The scene section is the only story-contextual part, and it appears when a story scene tab
 * publishes itself as this panel's payload (see `StorySceneEditorTab`). Focusing a story therefore
 * adds a section; it no longer conjures the panel.
 *
 * `order: 1` puts it directly under Properties, so the two panels that are always on the rail stay
 * adjacent and the story editor's own transient panels (10-12) remain a contiguous block below
 * them. `defaultVisible` stays false: the win here is that the icon is always present, and flipping
 * this would rewrite the saved right-dock layout of every existing project.
 */
export const storyVariablesPanelModule: PanelModule = {
  metadata: {
    id: STORY_VARIABLES_PANEL_ID,
    // Resolved lazily on read (module registration runs before i18n init).
    titleKey: "placeholders.moduleTitles.variables",
    get title() {
      return translate("placeholders.moduleTitles.variables");
    },
    icon: <Variable className="w-4 h-4" />,
    position: PanelPosition.Right,
    defaultVisible: false,
    order: 1
  },
  component: StoryVariablesPanel
};

export { StoryVariablesPanel } from "./StoryVariablesPanel";
export { STORY_VARIABLES_PANEL_ID, type StoryVariablesPanelPayload } from "./storyVariablesPanelId";
