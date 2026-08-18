import { describe, expect, it } from "vitest";
import { isHelpTopicId } from "@/lib/help";
import { STORY_VARIABLES_PANEL_ID } from "../story-variables/storyVariablesPanelId";
import { STORY_SNAPSHOT_PANEL_ID } from "../story-snapshots/storySnapshotPanelId";
import { STORY_ACTION_CREATOR_PANEL_ID } from "../story/scene-editor/storyActionCreatorEvents";
import { PANEL_HELP_TOPICS } from "./panelHelpTopics";

/**
 * The map is keyed by strings, which is the failure mode worth a test: a renamed or mistyped panel
 * id costs nothing at runtime and silently removes that panel's `F1`.
 *
 * Only the ids that live in their own small module are checked against the real constant. The panel
 * registry itself is not imported here - it pulls every panel component in with it, which in a node
 * test environment does not finish, and a help map is not the place to discover that.
 */

const PANEL_ID_CONSTANTS: Record<string, string> = {
  STORY_VARIABLES_PANEL_ID,
  STORY_SNAPSHOT_PANEL_ID,
  STORY_ACTION_CREATOR_PANEL_ID
};

describe("panel help topics", () => {
  it("maps every panel to a registered topic", () => {
    for (const [panelId, topicId] of Object.entries(PANEL_HELP_TOPICS)) {
      expect(isHelpTopicId(topicId), `${panelId} maps to unknown topic ${topicId}`).toBe(true);
    }
  });

  it("keeps the ids namespaced", () => {
    for (const panelId of Object.keys(PANEL_HELP_TOPICS)) {
      expect(panelId, "panel ids are namespaced").toMatch(/^narraleaf-studio:/);
    }
  });

  it("matches the panel ids that are exported as constants", () => {
    for (const [name, id] of Object.entries(PANEL_ID_CONSTANTS)) {
      expect(Object.keys(PANEL_HELP_TOPICS), `${name} (${id}) is no longer mapped`).toContain(id);
    }
  });
});
