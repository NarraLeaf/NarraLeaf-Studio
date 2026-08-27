import { useCallback, useEffect, useMemo, useState } from "react";
import { useKeybindings } from "@/apps/workspace/hooks";
import { useWorkspace } from "../../context";
import { useFreezeGuard } from "../ui/freezeGuard";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { projectHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { resolveWorkspaceUndoScope } from "@/lib/workspace/services/history/workspaceUndoTarget";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { FocusArea, type FocusContext } from "@/lib/workspace/services/ui/types";

/**
 * Undo and redo for everything that is not inside an editor.
 *
 * Editors register their own `mod+z` (per tab, with a `whenEditorFocused` guard), and those keep
 * working exactly as before - this binding **stands down whenever an editor has focus**, which is
 * what the `when` below is for. `KeybindingService` dispatches the first matching binding in
 * registration order and the shell mounts before any tab, so without that guard this one would win
 * every time and take Ctrl+Z away from the story editor.
 *
 * What it adds is the case that had no owner at all: the author deletes a character in the left
 * panel and presses Ctrl+Z. Before, nothing was listening there - and the honest description of
 * "nothing happened" is worse than it sounds, because if focus had still been in a story tab the
 * keypress would have undone *a story edit* instead, which reads as undo doing the wrong thing.
 *
 * Which stack it acts on is `resolveWorkspaceUndoScope`'s answer, shared with the Edit menu so the
 * menu cannot name a different step from the one the keystroke would take. Usually that is the
 * project's - pressing Ctrl+Z in the assets panel must not rewrite a scene the author cannot see -
 * but not in the property inspector, whose edits go into the active editor's stack and belong to it.
 *
 * This used to call `projectHistoryScope()` directly, which is how the two answers drifted apart
 * without anyone noticing: the menu offered "Undo change background colour" while the keystroke
 * beside it reached an empty stack and did nothing.
 *
 * ⚠ **Inside a live session none of that applies and this sends an inverse instead.** Two things
 * would otherwise be wrong at once. The stacks here hold whole-document snapshots taken before
 * anybody else joined, so applying one would delete every edit the others have made since - the
 * catastrophe the session's own undo exists to avoid. And the freeze guard below would refuse the
 * keystroke outright, which is what it was observed doing on a real machine: an author who created a
 * character in a session and pressed Ctrl+Z got nothing at all, with no way to tell whether the
 * stack was empty or the press had been swallowed.
 *
 * Which document the inverse is about is not this binding's business. A session keeps one stack per
 * WINDOW - "my last operation", whatever panel it was made in - so undo means the same thing here as
 * it does in the story editor, which routes to the same place for the same reason.
 */
export function WorkspaceUndoKeybindings() {
    const { context } = useWorkspace();
    const freeze = useFreezeGuard();
    const history = useMemo(
        () => (context ? context.services.get<HistoryService>(Services.History) : null),
        [context],
    );
    const live = useMemo(
        () => (context ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context],
    );
    const [inSession, setInSession] = useState(false);

    useEffect(() => {
        if (!live) {
            setInSession(false);
            return;
        }
        const read = () => setInSession(live.getView().phase !== "idle");
        read();
        return live.onChanged(read);
    }, [live]);
    const [focus, setFocus] = useState<FocusContext | null>(null);

    useEffect(() => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        setFocus(uiService.focus.getFocus());
        return uiService.focus.onFocusChange(setFocus);
    }, [context]);

    const scopeId = useMemo(
        () => (history && focus ? resolveWorkspaceUndoScope(history, focus) : projectHistoryScope()),
        [focus, history],
    );

    const outsideAnEditor = useCallback(
        (next: FocusContext) => next.area !== FocusArea.Editor,
        [],
    );

    const keybindings = useMemo(
        () => [
            {
                id: "undo",
                key: "mod+z",
                description: "Undo the last project-level change",
                when: outsideAnEditor,
                // Deliberately outside `freeze.run` in a session: the freeze is the session's own,
                // and sending the inverse of one's own operation is the one write it exists to
                // allow. Everywhere else the guard still refuses, which is what a frozen project is.
                handler: inSession
                    ? () => {
                        live?.undo();
                    }
                    : freeze.run(() => {
                        history?.undo(scopeId);
                    }),
            },
            {
                id: "redo",
                key: "mod+shift+z",
                description: "Redo the last project-level change",
                when: outsideAnEditor,
                handler: inSession
                    ? () => {
                        live?.redo();
                    }
                    : freeze.run(() => {
                        history?.redo(scopeId);
                    }),
            },
        ],
        [freeze, history, inSession, live, outsideAnEditor, scopeId],
    );

    useKeybindings({ keybindings, idPrefix: "workspace-history", catalogPrefix: "workspace." });

    return null;
}
