import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { storySceneHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { storyDocumentFreezeScope } from "./storySceneReadOnly";

/**
 * A scene-level undo while a live session owns the story.
 *
 * The scene editor's undo applies a snapshot through `StoryService.replaceScene`, which is the one
 * thing that must never happen inside a session: it would put a whole scene back as one machine
 * remembers it, over a document the rest of the room has moved on from, and no operation would
 * carry a word of that anywhere.
 *
 * Three things stop it and they are independent, which is why this pins all three rather than the
 * one the editor happens to reach first:
 *
 *  1. The scene scope refuses to describe its state while a session owns the story, so nothing new
 *     is recorded (`useStorySceneEditorController.captureHistoryState`).
 *  2. Entering a session forgets the story's scene stacks outright, so the entries recorded
 *     *before* it began are not there to be applied afterwards either (`LiveSession.enter`).
 *  3. `HistoryService` refuses to step at all while any freeze is armed - and a session arms one -
 *     which is what covers the shell's own Undo and its Edit menu, neither of which goes through
 *     the editor.
 *
 * Point 3 is the one worth stating plainly: a session leaves this story document writable on
 * purpose, so it would be easy to assume the shell's Undo still works during one. It does not, and
 * that is what keeps a restore from reaching `replaceScene` by a route the editor never sees.
 */

const STORY_ID = "chapter-one";
const SCENE_ID = "scene-1";
const LABEL = { key: "workspace.history.entry.storyEdit" as TranslationKey };

/** The freeze a session arms: everything refused except this one story document. */
const liveSessionFreeze = {
    projectPath: "D:/projects/my-game",
    reason: {
        kind: "live-session" as const,
        session: "room-1",
        writable: [storyDocumentFreezeScope(STORY_ID)!],
    },
};

describe("a scene's undo stack while a session owns the story", () => {
    let history: HistoryService;
    /** Stands in for `restoreHistoryState`, whose one write is `replaceScene`. */
    let restore: ReturnType<typeof vi.fn>;
    let owned: boolean;
    const scopeId = storySceneHistoryScope(STORY_ID, SCENE_ID);

    beforeEach(() => {
        owned = false;
        restore = vi.fn();
        history = new HistoryService();
        history.setContext({ project: {} as never, services: {} as never });
        history.registerScope<{ scene: string }>({
            id: scopeId,
            label: { key: "workspace.history.scope.storyScene" },
            // The editor's own answer: a snapshot of a shared scene is a statement about a document
            // only this window ever had.
            capture: () => (owned ? null : { scene: "as it stands" }),
            apply: snapshot => restore(snapshot),
        });
    });

    afterEach(() => {
        thawProjectWrites();
    });

    it("records nothing new, and will not apply what was recorded before the session", () => {
        expect(history.checkpoint(scopeId, { label: LABEL })).toBe(true);

        owned = true;
        freezeProjectWrites(liveSessionFreeze);

        expect(history.checkpoint(scopeId, { label: LABEL })).toBe(false);
        // The entry from before the session is still on the stack here - a session clears it on the
        // way in, which is `LiveSession`'s own affair - and the freeze is what makes sure it cannot
        // be applied in the meantime.
        expect(history.undo(scopeId)).toBe(false);
        expect(restore).not.toHaveBeenCalled();
    });

    it("refuses the shell's undo too, which never asks the editor", () => {
        history.checkpoint(scopeId, { label: LABEL });
        // What `WorkspaceUndoKeybindings` and the Edit menu do: name the scope and step it. They
        // reach `replaceScene` without passing anything the story editor gates.
        history.setActiveScope(scopeId);

        owned = true;
        freezeProjectWrites(liveSessionFreeze);

        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(false);
        expect(restore).not.toHaveBeenCalled();
    });

    it("restores again once the session has ended", () => {
        history.checkpoint(scopeId, { label: LABEL });
        owned = true;
        freezeProjectWrites(liveSessionFreeze);
        expect(history.undo(scopeId)).toBe(false);

        owned = false;
        thawProjectWrites();

        expect(history.undo(scopeId)).toBe(true);
        expect(restore).toHaveBeenCalledWith({ scene: "as it stands" });
    });
});
