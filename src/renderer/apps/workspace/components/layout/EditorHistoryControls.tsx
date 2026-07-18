import { useSyncExternalStore } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getEditorHistory, subscribeEditorHistory } from "./editorHistoryRegistry";

/**
 * Undo/redo buttons for whichever editor owns `tabId` — rendered once in the tab strip, driven by
 * the unified history registry. Hidden entirely when the active editor registered no history.
 */
export function EditorHistoryControls({ tabId }: { tabId: string | null }) {
    const { t } = useTranslation();
    const history = useSyncExternalStore(
        subscribeEditorHistory,
        () => getEditorHistory(tabId),
    );

    if (!history) {
        return null;
    }

    const buttonClass = (enabled: boolean) =>
        `flex h-6 w-6 items-center justify-center rounded transition-colors ${
            enabled ? "text-fg-muted hover:bg-fill hover:text-fg" : "cursor-default text-fg-subtle/50"
        }`;

    return (
        <div className="flex shrink-0 items-center gap-0.5 px-1">
            <button
                type="button"
                onClick={() => history.undo()}
                disabled={!history.canUndo}
                title={t("workspace.shell.history.undo")}
                aria-label={t("workspace.shell.history.undo")}
                className={buttonClass(history.canUndo)}
            >
                <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
                type="button"
                onClick={() => history.redo()}
                disabled={!history.canRedo}
                title={t("workspace.shell.history.redo")}
                aria-label={t("workspace.shell.history.redo")}
                className={buttonClass(history.canRedo)}
            >
                <Redo2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
