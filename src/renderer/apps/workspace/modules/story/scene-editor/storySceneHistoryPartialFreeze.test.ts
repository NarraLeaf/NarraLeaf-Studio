import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { storySceneHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { storyDocumentFreezeScope } from "./storySceneReadOnly";

/**
 * A scene-level undo while a partial freeze leaves the story document writable.
 *
 * A team project arms that freeze for as long as it is open: the stories its server holds stay
 * writable, everything else is read-only. The scene editor's undo applies a snapshot through
 * `StoryService.replaceScene`, and `HistoryService` refuses to step at all while any freeze is
 * armed - which is what covers the shell's own Undo and its Edit menu, neither of which goes
 * through the editor. It would be easy to assume a writable story keeps its undo; it does not.
 */

const STORY_ID = "chapter-one";
const SCENE_ID = "scene-1";
const LABEL = { key: "workspace.history.entry.storyEdit" as TranslationKey };

/** The freeze a team project arms: everything refused except this one story document. */
const partialFreeze = {
    projectPath: "D:/projects/my-game",
    reason: {
        kind: "live-session" as const,
        session: "team-documents",
        writable: [storyDocumentFreezeScope(STORY_ID)!],
    },
};

describe("a scene's undo stack under a partial freeze", () => {
    let history: HistoryService;
    /** Stands in for `restoreHistoryState`, whose one write is `replaceScene`. */
    let restore: ReturnType<typeof vi.fn>;
    const scopeId = storySceneHistoryScope(STORY_ID, SCENE_ID);

    beforeEach(() => {
        restore = vi.fn();
        history = new HistoryService();
        history.setContext({ project: {} as never, services: {} as never, commandLineRun: false });
        history.registerScope<{ scene: string }>({
            id: scopeId,
            label: { key: "workspace.history.scope.storyScene" },
            capture: () => ({ scene: "as it stands" }),
            apply: snapshot => restore(snapshot),
        });
    });

    afterEach(() => {
        thawProjectWrites();
    });

    it("refuses the shell's undo, which never asks the editor", () => {
        history.checkpoint(scopeId, { label: LABEL });
        // What `WorkspaceUndoKeybindings` and the Edit menu do: name the scope and step it.
        history.setActiveScope(scopeId);

        freezeProjectWrites(partialFreeze);

        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(false);
        expect(restore).not.toHaveBeenCalled();
    });

    it("restores again once the freeze is lifted", () => {
        history.checkpoint(scopeId, { label: LABEL });
        freezeProjectWrites(partialFreeze);
        expect(history.undo(scopeId)).toBe(false);

        thawProjectWrites();

        expect(history.undo(scopeId)).toBe(true);
        expect(restore).toHaveBeenCalledWith({ scene: "as it stands" });
    });
});
