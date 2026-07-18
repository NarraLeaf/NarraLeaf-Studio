import { useEffect, useState, useSyncExternalStore } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { EditorLayout } from "../../registry/types";
import {
    getEditorHistory,
    subscribeEditorHistory,
} from "../../components/layout/editorHistoryRegistry";

function findTabTitle(layout: EditorLayout, tabId: string): string | null {
    if ("tabs" in layout) {
        const tab = layout.tabs.find(candidate => candidate.id === tabId);
        return tab ? String(tab.title) : null;
    }
    return findTabTitle(layout.first, tabId) ?? findTabTitle(layout.second, tabId);
}

/**
 * History panel: undo/redo for whichever editor is active, through the unified
 * EditorHistoryProvider contract — the panel never knows editor internals. Editors without a
 * registered provider show the empty state.
 */
export function HistoryPanel() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { editorLayout } = useRegistry();
    const [activeTabId, setActiveTabId] = useState<string | null>(null);

    // Track the editor tab that currently owns focus (falling back to the MRU head).
    useEffect(() => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();
        const sync = () => {
            const focus = uiService.focus.getFocus();
            if (focus.area === FocusArea.Editor && focus.targetId) {
                setActiveTabId(focus.targetId);
                return;
            }
            const mruHead = store.getEditorTabFocusHistoryKeys()[0];
            setActiveTabId(mruHead ? mruHead.slice(mruHead.indexOf(":") + 1) : null);
        };
        sync();
        const unsubs = [
            uiService.focus.onFocusChange(sync),
            uiService.getEvents().on("editorTabActivatedInGroup", sync),
            uiService.getEvents().on("editorTabClosedInGroup", sync),
        ];
        return () => unsubs.forEach(unsub => unsub());
    }, [context]);

    const history = useSyncExternalStore(subscribeEditorHistory, () => getEditorHistory(activeTabId));
    const title = activeTabId ? findTabTitle(editorLayout, activeTabId) : null;

    if (!history) {
        return (
            <div className="flex h-full items-center justify-center px-4 text-sm text-fg-subtle">
                {t("workspace.shell.history.empty")}
            </div>
        );
    }

    const buttonClass = (enabled: boolean) =>
        `flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-sm transition-colors ${
            enabled
                ? "bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg"
                : "cursor-default bg-fill-subtle/50 text-fg-subtle/60"
        }`;

    return (
        <div className="flex h-full flex-col gap-3 p-4">
            {title && (
                <div className="truncate text-xs text-fg-subtle">
                    {t("workspace.shell.history.activeEditor", { name: title })}
                </div>
            )}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => history.undo()}
                    disabled={!history.canUndo}
                    className={buttonClass(history.canUndo)}
                >
                    <Undo2 className="h-4 w-4" />
                    <span>{t("workspace.shell.history.undo")}</span>
                </button>
                <button
                    type="button"
                    onClick={() => history.redo()}
                    disabled={!history.canRedo}
                    className={buttonClass(history.canRedo)}
                >
                    <Redo2 className="h-4 w-4" />
                    <span>{t("workspace.shell.history.redo")}</span>
                </button>
            </div>
        </div>
    );
}
