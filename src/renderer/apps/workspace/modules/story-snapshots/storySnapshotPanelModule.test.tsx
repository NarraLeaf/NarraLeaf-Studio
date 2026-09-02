// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PanelPosition } from "../../registry/types";
import { builtInPanels } from "../registry";
import { STORY_SNAPSHOT_PANEL_ID } from "./storySnapshotPanelId";

/**
 * Where the Scene Snapshot panel comes from.
 *
 * It used to be registered by the story scene editor tab, so the rail icon existed only while a
 * scene tab was open and focused - the panel that decides how a row start begins could not be found
 * before the author was already editing a row. It is a panel of the workspace now, registered at
 * startup like Properties, Variables and Dictionary, and this is the assertion that says so: if it
 * goes back to being registered by a tab, it leaves this list.
 */

describe("the Scene Snapshot panel module", () => {
    const module = builtInPanels.find(panel => panel.metadata.id === STORY_SNAPSHOT_PANEL_ID);

    it("is registered at workspace startup rather than by a story tab", () => {
        expect(module, `${STORY_SNAPSHOT_PANEL_ID} is not a built-in panel`).toBeDefined();
    });

    it("sits on the right rail, closed, with the panels that are always there", () => {
        expect(module?.metadata.position).toBe(PanelPosition.Right);
        // Flipping this would rewrite the saved right-dock layout of every existing project.
        expect(module?.metadata.defaultVisible).toBe(false);
        // Properties 0, Variables 1, Dictionary 2: the block that does not come and go.
        expect(module?.metadata.order).toBeLessThan(10);
    });
});
