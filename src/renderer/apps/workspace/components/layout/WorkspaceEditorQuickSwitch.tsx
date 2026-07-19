import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import {
    buildEditorQuickSwitchOrder,
    collectEditorQuickSwitchCandidates,
    collectFocusedEditorQuickSwitchKeys,
    getEditorQuickSwitchKey,
    type EditorQuickSwitchCandidate,
} from "./editorQuickSwitchModel";
import { wrapIndex } from "./fuzzyListModel";
import { QuickSwitchOverlay, type QuickListRow } from "./QuickSwitchOverlay";
import type { EditorLayout } from "../../registry/types";
import { useTranslation } from "@/lib/i18n";

interface QuickSwitchState {
    open: boolean;
    candidates: EditorQuickSwitchCandidate[];
    selectedIndex: number;
    groupCount: number;
}

const CLOSED_STATE: QuickSwitchState = {
    open: false,
    candidates: [],
    selectedIndex: 0,
    groupCount: 0,
};

export function WorkspaceEditorQuickSwitch() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { editorLayout, setActiveEditorTab } = useRegistry();
    const [state, setState] = useState<QuickSwitchState>(CLOSED_STATE);
    const stateRef = useRef(state);
    const layoutRef = useRef<EditorLayout>(editorLayout);
    const mruKeysRef = useRef<string[]>([]);
    const activeKeyRef = useRef<string | null>(null);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        layoutRef.current = editorLayout;
        const { candidates } = collectEditorQuickSwitchCandidates(editorLayout);
        mruKeysRef.current = context
            ? context.services.get<UIService>(Services.UI).getStore().getEditorTabFocusHistoryKeys()
            : mruKeysRef.current;

        activeKeyRef.current =
            mruKeysRef.current[0] ??
            collectFocusedEditorQuickSwitchKeys(editorLayout)[0] ??
            candidates[0]?.key ??
            null;

        setState(previous => {
            if (!previous.open) {
                return previous;
            }

            const order = buildEditorQuickSwitchOrder(editorLayout, mruKeysRef.current, activeKeyRef.current);
            if (order.candidates.length < 2) {
                return CLOSED_STATE;
            }

            const selectedKey = previous.candidates[previous.selectedIndex]?.key;
            const selectedIndex = Math.max(
                0,
                order.candidates.findIndex(candidate => candidate.key === selectedKey)
            );

            return {
                open: true,
                candidates: order.candidates,
                selectedIndex,
                groupCount: order.groupCount,
            };
        });
    }, [context, editorLayout]);

    useEffect(() => {
        if (!context) {
            return;
        }

        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();

        const syncActiveFromLayout = () => {
            const layout = store.getEditorLayout();
            layoutRef.current = layout;
            const { candidates } = collectEditorQuickSwitchCandidates(layout);
            mruKeysRef.current = store.getEditorTabFocusHistoryKeys();
            activeKeyRef.current =
                mruKeysRef.current[0] ??
                collectFocusedEditorQuickSwitchKeys(layout)[0] ??
                candidates[0]?.key ??
                null;
        };

        const recordActiveTab = (tabId: string, groupId: string) => {
            const layout = store.getEditorLayout();
            layoutRef.current = layout;
            const key = getEditorQuickSwitchKey(groupId, tabId);
            mruKeysRef.current = store.getEditorTabFocusHistoryKeys();
            activeKeyRef.current = mruKeysRef.current[0] ?? key;
        };

        syncActiveFromLayout();

        const events = uiService.getEvents();
        const unsubActivated = events.on("editorTabActivatedInGroup", ({ tabId, groupId }) => {
            recordActiveTab(tabId, groupId);
        });
        const unsubOpened = events.on("editorTabOpenedInGroup", ({ tab, groupId, activated }) => {
            if (activated) {
                recordActiveTab(tab.id, groupId);
            }
        });
        const unsubClosed = events.on("editorTabClosedInGroup", syncActiveFromLayout);
        const unsubLayout = events.on("editorLayoutChanged", syncActiveFromLayout);

        return () => {
            unsubActivated();
            unsubOpened();
            unsubClosed();
            unsubLayout();
        };
    }, [context]);

    const closeSwitcher = useCallback(() => {
        setState(CLOSED_STATE);
    }, []);

    const commitCandidate = useCallback(
        (candidate: EditorQuickSwitchCandidate | undefined) => {
            closeSwitcher();
            if (!candidate) {
                return;
            }

            activeKeyRef.current = candidate.key;
            setActiveEditorTab(candidate.tabId, candidate.groupId);
        },
        [closeSwitcher, setActiveEditorTab]
    );

    const commitSelection = useCallback(() => {
        const current = stateRef.current;
        if (!current.open) {
            return;
        }
        commitCandidate(current.candidates[current.selectedIndex]);
    }, [commitCandidate]);

    const moveSelection = useCallback((direction: 1 | -1) => {
        const order = buildEditorQuickSwitchOrder(
            layoutRef.current,
            mruKeysRef.current,
            activeKeyRef.current
        );

        if (order.candidates.length < 2) {
            return;
        }

        setState(previous => {
            if (previous.open && previous.candidates.length > 0) {
                return {
                    ...previous,
                    selectedIndex: wrapIndex(previous.selectedIndex + direction, previous.candidates.length),
                };
            }

            const activeIndex = activeKeyRef.current
                ? order.candidates.findIndex(candidate => candidate.key === activeKeyRef.current)
                : -1;
            const selectedIndex = activeIndex >= 0
                ? wrapIndex(activeIndex + direction, order.candidates.length)
                : 0;

            return {
                open: true,
                candidates: order.candidates,
                selectedIndex,
                groupCount: order.groupCount,
            };
        });
    }, []);

    useKeybinding({
        id: "workspace-editor-quick-switch-next",
        // Deliberately ctrl, NOT mod: tab-switching is Ctrl+Tab on macOS too
        // (⌘+Tab belongs to the OS app switcher).
        key: "ctrl+tab",
        description: "Switch to previous editor tab",
        handler: () => moveSelection(1),
        allowInEditable: true,
    });

    useKeybinding({
        id: "workspace-editor-quick-switch-previous",
        key: "ctrl+shift+tab",
        description: "Switch to next editor tab",
        handler: () => moveSelection(-1),
        allowInEditable: true,
    });

    useEffect(() => {
        if (!state.open) {
            return;
        }

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key !== "Control") {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            commitSelection();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            closeSwitcher();
        };

        document.addEventListener("keyup", handleKeyUp, true);
        document.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("blur", closeSwitcher);

        return () => {
            document.removeEventListener("keyup", handleKeyUp, true);
            document.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("blur", closeSwitcher);
        };
    }, [closeSwitcher, commitSelection, state.open]);

    if (!state.open) {
        return null;
    }

    const showGroupId = state.groupCount > 1;
    const rows: QuickListRow[] = state.candidates.map(candidate => ({
        key: candidate.key,
        icon: candidate.tab.icon,
        title: String(candidate.tab.title),
        modified: candidate.tab.modified,
        trailing: showGroupId ? candidate.groupId : undefined,
    }));

    return (
        <QuickSwitchOverlay
            rows={rows}
            selectedIndex={state.selectedIndex}
            onCommit={index => commitCandidate(state.candidates[index])}
            ariaLabel={t("workspace.shell.editorTabsLabel")}
        />
    );
}
