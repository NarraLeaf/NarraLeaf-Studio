import { describe, expect, it } from "vitest";
import { FocusArea } from "../ui/types";
import type { HistoryService } from "./HistoryService";
import { projectHistoryScope } from "./historyScopes";
import { resolveWorkspaceUndoScope } from "./workspaceUndoTarget";

function historyWithActiveScope(scopeId: string | null): HistoryService {
    return { getActiveScopeId: () => scopeId } as unknown as HistoryService;
}

describe("resolveWorkspaceUndoScope", () => {
    it("takes the focused editor's scope when the author is in an editor", () => {
        const history = historyWithActiveScope("story-scene:s:1");
        expect(resolveWorkspaceUndoScope(history, { area: FocusArea.Editor, targetId: "tab" }))
            .toBe("story-scene:s:1");
    });

    it("falls back to the project scope for an editor that has no history of its own", () => {
        const history = historyWithActiveScope(null);
        expect(resolveWorkspaceUndoScope(history, { area: FocusArea.Editor, targetId: "tab" }))
            .toBe(projectHistoryScope());
    });

    it.each([FocusArea.LeftPanel, FocusArea.RightPanel, FocusArea.BottomPanel, FocusArea.None])(
        "uses the project scope outside an editor (%s)",
        area => {
            // Deliberately NOT the active editor scope: undo pressed in the character panel must
            // not rewrite a scene the author cannot see, even though one is open behind it.
            const history = historyWithActiveScope("story-scene:s:1");
            expect(resolveWorkspaceUndoScope(history, { area })).toBe(projectHistoryScope());
        },
    );
});
