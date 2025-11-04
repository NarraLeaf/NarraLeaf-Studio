import { createContext, useContext, useState, useCallback, ReactNode, FC } from "react";
import {
    PanelDefinition,
    PanelPosition,
    ActionDefinition,
    EditorTabDefinition,
    EditorLayout,
    EditorGroup,
} from "./types";

interface RegistryContextValue {
    // Panel management
    panels: PanelDefinition[];
    registerPanel: (panel: PanelDefinition) => void;
    unregisterPanel: (id: string) => void;
    getPanelsByPosition: (position: PanelPosition) => PanelDefinition[];

    // Action management
    actions: ActionDefinition[];
    registerAction: (action: ActionDefinition) => void;
    unregisterAction: (id: string) => void;

    // Editor management
    editorLayout: EditorLayout;
    openEditorTab: (tab: EditorTabDefinition, groupId?: string) => void;
    closeEditorTab: (tabId: string, groupId?: string) => void;
    setActiveEditorTab: (tabId: string, groupId: string) => void;
    
    // Panel visibility
    visiblePanels: Record<string, boolean>;
    togglePanelVisibility: (panelId: string) => void;
    setPanelVisibility: (panelId: string, visible: boolean) => void;
}

const RegistryContext = createContext<RegistryContextValue | null>(null);

interface RegistryProviderProps {
    children: ReactNode;
}

/**
 * Provider for workspace extension registry
 * Manages panels, actions, and editors
 */
export function RegistryProvider({ children }: RegistryProviderProps) {
    const [panels, setPanels] = useState<PanelDefinition[]>([]);
    const [actions, setActions] = useState<ActionDefinition[]>([]);
    const [visiblePanels, setVisiblePanels] = useState<Record<string, boolean>>({});

    // Initialize with a default editor group
    const [editorLayout, setEditorLayout] = useState<EditorLayout>({
        id: "main",
        tabs: [],
        activeTabId: null,
    });

    // Panel management
    const registerPanel = useCallback((panel: PanelDefinition) => {
        setPanels((prev) => {
            // Remove existing panel with same id
            const filtered = prev.filter((p) => p.id !== panel.id);
            // Add new panel and sort by order
            return [...filtered, panel].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        });

        // Set default visibility
        if (panel.defaultVisible !== false) {
            setVisiblePanels((prev) => ({ ...prev, [panel.id]: true }));
        }
    }, []);

    const unregisterPanel = useCallback((id: string) => {
        setPanels((prev) => prev.filter((p) => p.id !== id));
        setVisiblePanels((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }, []);

    const getPanelsByPosition = useCallback(
        (position: PanelPosition) => {
            return panels.filter((p) => p.position === position);
        },
        [panels]
    );

    // Action management
    const registerAction = useCallback((action: ActionDefinition) => {
        setActions((prev) => {
            const filtered = prev.filter((a) => a.id !== action.id);
            return [...filtered, action].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        });
    }, []);

    const unregisterAction = useCallback((id: string) => {
        setActions((prev) => prev.filter((a) => a.id !== id));
    }, []);

    // Editor management helpers
    const findGroup = useCallback(
        (layout: EditorLayout, groupId?: string): EditorGroup | null => {
            if ("tabs" in layout) {
                return !groupId || layout.id === groupId ? layout : null;
            }
            return findGroup(layout.first, groupId) || findGroup(layout.second, groupId);
        },
        []
    );

    const updateGroup = useCallback(
        (layout: EditorLayout, groupId: string, updater: (group: EditorGroup) => EditorGroup): EditorLayout => {
            if ("tabs" in layout) {
                return layout.id === groupId ? updater(layout) : layout;
            }
            return {
                ...layout,
                first: updateGroup(layout.first, groupId, updater),
                second: updateGroup(layout.second, groupId, updater),
            };
        },
        []
    );

    // Editor tab management
    const openEditorTab = useCallback(
        (tab: EditorTabDefinition, groupId?: string) => {
            setEditorLayout((prev) => {
                const targetGroup = findGroup(prev, groupId);
                const targetId = targetGroup?.id ?? (prev as EditorGroup).id;

                return updateGroup(prev, targetId, (group) => {
                    // Check if tab already exists
                    const existingIndex = group.tabs.findIndex((t) => t.id === tab.id);
                    if (existingIndex >= 0) {
                        // Just activate existing tab
                        return { ...group, activeTabId: tab.id };
                    }
                    // Add new tab
                    return {
                        ...group,
                        tabs: [...group.tabs, tab],
                        activeTabId: tab.id,
                    };
                });
            });
        },
        [findGroup, updateGroup]
    );

    const closeEditorTab = useCallback(
        (tabId: string, groupId?: string) => {
            setEditorLayout((prev) => {
                const targetGroup = findGroup(prev, groupId);
                const targetId = targetGroup?.id ?? (prev as EditorGroup).id;

                return updateGroup(prev, targetId, (group) => {
                    const tabs = group.tabs.filter((t) => t.id !== tabId);
                    let activeTabId = group.activeTabId;
                    
                    // If we closed the active tab, activate another
                    if (activeTabId === tabId) {
                        activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
                    }

                    return { ...group, tabs, activeTabId };
                });
            });
        },
        [findGroup, updateGroup]
    );

    const setActiveEditorTab = useCallback(
        (tabId: string, groupId: string) => {
            setEditorLayout((prev) => {
                return updateGroup(prev, groupId, (group) => ({
                    ...group,
                    activeTabId: tabId,
                }));
            });
        },
        [updateGroup]
    );

    // Panel visibility
    const togglePanelVisibility = useCallback((panelId: string) => {
        setVisiblePanels((prev) => ({
            ...prev,
            [panelId]: !prev[panelId],
        }));
    }, []);

    const setPanelVisibility = useCallback((panelId: string, visible: boolean) => {
        setVisiblePanels((prev) => ({
            ...prev,
            [panelId]: visible,
        }));
    }, []);

    return (
        <RegistryContext.Provider
            value={{
                panels,
                registerPanel,
                unregisterPanel,
                getPanelsByPosition,
                actions,
                registerAction,
                unregisterAction,
                editorLayout,
                openEditorTab,
                closeEditorTab,
                setActiveEditorTab,
                visiblePanels,
                togglePanelVisibility,
                setPanelVisibility,
            }}
        >
            {children}
        </RegistryContext.Provider>
    );
}

/**
 * Hook to access registry
 */
export function useRegistry() {
    const ctx = useContext(RegistryContext);
    if (!ctx) {
        throw new Error("useRegistry must be used within RegistryProvider");
    }
    return ctx;
}

