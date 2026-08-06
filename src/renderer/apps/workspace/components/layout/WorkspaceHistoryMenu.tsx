import { useEffect, useMemo, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useRegistry } from "@/apps/workspace/registry";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { useFreezeGuard } from "../ui/freezeGuard";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import type { HistoryLabel } from "@/lib/workspace/services/history/historyModel";
import { resolveWorkspaceUndoScope } from "@/lib/workspace/services/history/workspaceUndoTarget";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import type { FocusContext } from "@/lib/workspace/services/ui/types";

/**
 * Undo and Redo in the application Edit menu.
 *
 * The menu items were Electron's `undo`/`redo` roles, which act on the DOM selection: they undo
 * inside a text field and do nothing whatever in the story, interface, blueprint and motion
 * editors - the four places an author actually edits. Registering them as `edit`-slot actions with
 * `menuRole` puts them on the same substitution path Cut/Copy/Paste already use, so the item runs
 * the workspace's history, while `useMenuActionHandler` still hands the command back to the DOM
 * role when the caret is in a text field.
 *
 * **macOS only in effect.** `buildMenuTemplate` returns an empty template off darwin, so there is
 * no application menu to substitute into on Windows or Linux. The registration is harmless there
 * (the action bar filters by `when`, and nothing renders an `edit` slot in-app); the keyboard path
 * on those platforms is `WorkspaceUndoKeybindings` plus each editor's own binding.
 *
 * The label is the point. `peekUndo()` names the step, so the item reads "Undo delete character
 * Hiyori" rather than a bare "Undo" that may or may not do anything.
 */
export function WorkspaceHistoryMenu() {
    const { context } = useWorkspace();
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const { registerActionGroup, unregisterActionGroup } = useRegistry();
    const history = useMemo(
        () => (context ? context.services.get<HistoryService>(Services.History) : null),
        [context],
    );

    const [focus, setFocus] = useState<FocusContext | null>(null);
    // Bumped whenever any stack moves, so the labels and the greying follow the stacks.
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        setFocus(uiService.focus.getFocus());
        return uiService.focus.onFocusChange(setFocus);
    }, [context]);

    useEffect(() => {
        if (!history) {
            return;
        }
        return history.on("changed", () => setRevision(current => current + 1));
    }, [history]);

    useEffect(() => {
        if (!history || !focus) {
            return;
        }
        const groupId = "narraleaf-studio:workspace-history";
        const scopeId = resolveWorkspaceUndoScope(history, focus);
        const name = (label: HistoryLabel | null) => (label ? t(label.key, label.params) : null);
        const undoStep = name(history.peekUndo(scopeId));
        const redoStep = name(history.peekRedo(scopeId));

        registerActionGroup({
            id: groupId,
            label: t("common.edit"),
            order: 10,
            menuSlot: "edit",
            actions: [
                {
                    id: `${groupId}-undo`,
                    label: undoStep
                        ? t("workspace.history.menu.undoNamed", { step: undoStep })
                        : t("menu.edit.undo"),
                    icon: <Undo2 className="w-4 h-4" />,
                    shortcut: "mod+z",
                    menuRole: "undo",
                    onClick: freeze.run(() => {
                        history.undo(scopeId);
                    }),
                    disabled: !history.canUndo(scopeId),
                    order: 0,
                },
                {
                    id: `${groupId}-redo`,
                    label: redoStep
                        ? t("workspace.history.menu.redoNamed", { step: redoStep })
                        : t("menu.edit.redo"),
                    icon: <Redo2 className="w-4 h-4" />,
                    shortcut: "mod+shift+z",
                    menuRole: "redo",
                    onClick: freeze.run(() => {
                        history.redo(scopeId);
                    }),
                    disabled: !history.canRedo(scopeId),
                    order: 1,
                },
            ],
        });

        return () => {
            unregisterActionGroup(groupId);
        };
    }, [focus, freeze, history, registerActionGroup, revision, t, unregisterActionGroup]);

    return null;
}
