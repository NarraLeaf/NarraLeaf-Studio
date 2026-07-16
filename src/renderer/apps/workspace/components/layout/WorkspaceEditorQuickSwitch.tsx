import React, { useCallback, useEffect, useRef, useState } from "react";
import { Circle } from "lucide-react";
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

function wrapIndex(index: number, length: number): number {
    return ((index % length) + length) % length;
}

export function WorkspaceEditorQuickSwitch() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { editorLayout, setActiveEditorTab } = useRegistry();
    const [state, setState] = useState<QuickSwitchState>(CLOSED_STATE);
    const stateRef = useRef(state);
    const layoutRef = useRef<EditorLayout>(editorLayout);
    const mruKeysRef = useRef<string[]>([]);
    const activeKeyRef = useRef<string | null>(null);
    const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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

    useEffect(() => {
        if (!state.open) {
            return;
        }

        const key = state.candidates[state.selectedIndex]?.key;
        if (!key) {
            return;
        }

        rowRefs.current.get(key)?.scrollIntoView({ block: "nearest" });
    }, [state.open, state.selectedIndex, state.candidates]);

    if (!state.open) {
        return null;
    }

    return (
        <div className="nl-window-content-layer z-[45] flex items-start justify-center pt-[12vh] pointer-events-none">
            <div
                className="w-[min(560px,calc(100vw-32px))] max-h-[min(480px,70vh)] overflow-hidden rounded-md border border-edge bg-surface-raised/95 shadow-2xl backdrop-blur-sm pointer-events-auto"
                role="listbox"
                aria-label={t("workspace.shell.editorTabsLabel")}
            >
                <div className="max-h-[inherit] overflow-y-auto py-1">
                    {state.candidates.map((candidate, index) => {
                        const selected = index === state.selectedIndex;
                        const showGroupId = state.groupCount > 1;

                        return (
                            <button
                                key={candidate.key}
                                ref={(node) => {
                                    if (node) {
                                        rowRefs.current.set(candidate.key, node);
                                    } else {
                                        rowRefs.current.delete(candidate.key);
                                    }
                                }}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                data-editor-quick-switch-key={candidate.key}
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => commitCandidate(candidate)}
                                className={`flex h-10 w-full items-center gap-3 px-3 text-left transition-colors ${
                                    selected
                                        ? "bg-primary/20 text-fg"
                                        : "text-fg-muted hover:bg-fill-subtle hover:text-fg"
                                }`}
                            >
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted">
                                    {candidate.tab.icon}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm">
                                    {String(candidate.tab.title)}
                                </span>
                                {candidate.tab.modified && (
                                    <Circle className="h-2 w-2 shrink-0 fill-current text-primary" />
                                )}
                                {showGroupId && (
                                    <span className="shrink-0 text-xs text-fg-subtle">
                                        {candidate.groupId}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
