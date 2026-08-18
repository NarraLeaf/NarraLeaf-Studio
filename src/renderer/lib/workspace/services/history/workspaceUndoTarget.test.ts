import { describe, expect, it } from "vitest";
import { PROPERTIES_PANEL_ID } from "@/apps/workspace/modules/properties/propertiesPanelId";
import { FocusArea } from "../ui/types";
import type { HistoryService } from "./HistoryService";
import { projectHistoryScope } from "./historyScopes";
import { isEditorOwnedFocus, resolveWorkspaceUndoScope } from "./workspaceUndoTarget";

function historyWithActiveScope(scopeId: string | null): HistoryService {
  return { getActiveScopeId: () => scopeId } as unknown as HistoryService;
}

describe("resolveWorkspaceUndoScope", () => {
  it("takes the focused editor's scope when the author is in an editor", () => {
    const history = historyWithActiveScope("story-scene:s:1");
    expect(resolveWorkspaceUndoScope(history, { area: FocusArea.Editor, targetId: "tab" })).toBe(
      "story-scene:s:1"
    );
  });

  it("falls back to the project scope for an editor that has no history of its own", () => {
    const history = historyWithActiveScope(null);
    expect(resolveWorkspaceUndoScope(history, { area: FocusArea.Editor, targetId: "tab" })).toBe(
      projectHistoryScope()
    );
  });

  it.each([FocusArea.LeftPanel, FocusArea.RightPanel, FocusArea.BottomPanel, FocusArea.None])(
    "uses the project scope outside an editor (%s)",
    (area) => {
      // Deliberately NOT the active editor scope: undo pressed in the character panel must
      // not rewrite a scene the author cannot see, even though one is open behind it.
      const history = historyWithActiveScope("story-scene:s:1");
      expect(resolveWorkspaceUndoScope(history, { area })).toBe(projectHistoryScope());
    }
  );

  it("keeps the editor's scope while the author is in its property inspector", () => {
    // The inspector's edits go into this very stack, so Ctrl+Z pressed there has to reach it.
    // Routing to the project scope meant the author changed a page's background and then found
    // undo did nothing, without leaving the panel they had changed it in.
    const history = historyWithActiveScope("ui-surface:page-1");
    expect(
      resolveWorkspaceUndoScope(history, {
        area: FocusArea.RightPanel,
        targetId: PROPERTIES_PANEL_ID
      })
    ).toBe("ui-surface:page-1");
  });

  it("still leaves other right-side panels on the project scope", () => {
    const history = historyWithActiveScope("ui-surface:page-1");
    expect(
      resolveWorkspaceUndoScope(history, {
        area: FocusArea.RightPanel,
        targetId: "narraleaf-studio:some-other-panel"
      })
    ).toBe(projectHistoryScope());
  });
});

describe("isEditorOwnedFocus", () => {
  it("matches one named tab, so a split view does not answer for its neighbour", () => {
    expect(isEditorOwnedFocus({ area: FocusArea.Editor, targetId: "tab-a" }, "tab-a")).toBe(true);
    expect(isEditorOwnedFocus({ area: FocusArea.Editor, targetId: "tab-b" }, "tab-a")).toBe(false);
  });

  it("treats the inspector as owned by whichever editor is asking", () => {
    // No tab id can be checked here - the panel belongs to the active editor, not to a tab -
    // so this is what keeps an editor from disowning its stack when focus moves to the panel.
    const inspector = { area: FocusArea.RightPanel, targetId: PROPERTIES_PANEL_ID };
    expect(isEditorOwnedFocus(inspector, "tab-a")).toBe(true);
    expect(isEditorOwnedFocus(inspector)).toBe(true);
  });

  it("does not claim panels that edit something else", () => {
    expect(
      isEditorOwnedFocus({ area: FocusArea.LeftPanel, targetId: "narraleaf-studio:assets" })
    ).toBe(false);
    expect(isEditorOwnedFocus({ area: FocusArea.None })).toBe(false);
  });
});
