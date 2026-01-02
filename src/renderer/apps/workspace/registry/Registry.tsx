import { createContext, useContext, ReactNode, useCallback } from "react";
import {
    PanelDefinition,
    PanelPosition,
    ActionDefinition,
    ActionGroup,
    EditorTabDefinition,
    EditorLayout,
    EditorGroup,
} from "./types";
import {
    useActions,
    useActionGroups,
    useEditorLayout,
    usePanels,
    usePanelVisibility,
    useUIService,
} from "../hooks/useUIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";

/**
 * Registry context provides convenient access to UI state and operations
 * All state is managed by UIStore through UIService
 */
interface RegistryContextValue {
    // Panel management
    panels: PanelDefinition[];
    registerPanel: <TPayload = any>(panel: PanelDefinition<TPayload>) => void;
    unregisterPanel: (id: string) => void;
    getPanelsByPosition: (position: PanelPosition) => PanelDefinition[];
    updatePanelPayload: <TPayload = any>(panelId: string, payload: TPayload) => void;

    // Action management
    actions: ActionDefinition[];
    actionGroups: ActionGroup[];
    registerAction: (action: ActionDefinition) => void;
    registerActionGroup: (group: ActionGroup) => void;
    unregisterAction: (id: string) => void;
    unregisterActionGroup: (id: string) => void;

    // Editor management
    editorLayout: EditorLayout;
    openEditorTab: <TPayload = any>(tab: EditorTabDefinition<TPayload>, groupId?: string) => void;
    closeEditorTab: (tabId: string, groupId?: string) => void;
    setActiveEditorTab: (tabId: string, groupId: string) => void;
    updateEditorTabPayload: <TPayload = any>(tabId: string, payload: TPayload, groupId?: string) => void;
    
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
 * Delegates to UIService for state management
 * This is now a lightweight wrapper that provides convenient hooks-based access
 */
export function RegistryProvider({ children }: RegistryProviderProps) {
    const uiService = useUIService();
    
    // Subscribe to state from UIStore via hooks
    const panels = usePanels();
    const actions = useActions();
    const actionGroups = useActionGroups();
    const editorLayout = useEditorLayout();
    const visiblePanels = usePanelVisibility();
    
    // Helper function to get panels by position
    const getPanelsByPosition = (position: PanelPosition): PanelDefinition[] => {
        return panels.filter((p) => p.position === position);
    };

    // Panel management - delegate to UIStore
    const registerPanel = useCallback(<TPayload = any>(panel: PanelDefinition<TPayload>) => {
        uiService.getStore().registerPanel(panel);
    }, [uiService]);

    const unregisterPanel = useCallback((id: string) => {
        uiService.getStore().unregisterPanel(id);
    }, [uiService]);

    const updatePanelPayload = useCallback(<TPayload = any>(panelId: string, payload: TPayload) => {
        uiService.getStore().updatePanelPayload(panelId, payload);
    }, [uiService]);

    // Action management - delegate to UIStore
    const registerAction = useCallback((action: ActionDefinition) => {
        uiService.getStore().registerAction(action);
    }, [uiService]);

    const registerActionGroup = useCallback((group: ActionGroup) => {
        uiService.getStore().registerActionGroup(group);
    }, [uiService]);

    const unregisterAction = useCallback((id: string) => {
        uiService.getStore().unregisterAction(id);
    }, [uiService]);

    const unregisterActionGroup = useCallback((id: string) => {
        uiService.getStore().unregisterActionGroup(id);
    }, [uiService]);

    // Helper to find group in layout
    const findGroup = useCallback((layout: EditorLayout, groupId?: string): EditorGroup | null => {
        if ("tabs" in layout) {
            return !groupId || layout.id === groupId ? layout : null;
        }
        return findGroup(layout.first, groupId) || findGroup(layout.second, groupId);
    }, []);

    // Editor management - delegate to UIStore
    const openEditorTab = useCallback(<TPayload = any>(tab: EditorTabDefinition<TPayload>, groupId?: string) => {
        uiService.getStore().openEditorTabInGroup(tab, groupId);
        // Update focus to the new tab
        uiService.focus.setFocus(FocusArea.Editor, tab.id);
    }, [uiService]);

    const closeEditorTab = useCallback((tabId: string, groupId?: string) => {
        const currentFocus = uiService.focus.getFocus();
        const store = uiService.getStore();
        
        // Close the tab
        store.closeEditorTabInGroup(tabId, groupId);
        
        // If focus was on the closed tab, update focus to new active tab
        if (currentFocus.area === FocusArea.Editor && currentFocus.targetId === tabId) {
            const layout = store.getEditorLayout();
            const group = findGroup(layout, groupId);
            if (group && group.focus) {
                // Update focus to the new active tab
                uiService.focus.setFocus(FocusArea.Editor, group.focus);
            } else {
                // No more tabs, clear focus
                uiService.focus.clearFocus();
            }
        }
    }, [uiService, findGroup]);

    const setActiveEditorTab = useCallback((tabId: string, groupId: string) => {
        uiService.getStore().setActiveEditorTabInGroup(tabId, groupId);
        // Update focus to the activated tab
        uiService.focus.setFocus(FocusArea.Editor, tabId);
    }, [uiService]);

    const updateEditorTabPayload = useCallback(<TPayload = any>(tabId: string, payload: TPayload, groupId?: string) => {
        uiService.getStore().updateEditorTabPayload(tabId, payload, groupId);
    }, [uiService]);

    // Panel visibility - delegate to UIStore
    const togglePanelVisibility = useCallback((panelId: string) => {
        uiService.getStore().togglePanelVisibility(panelId);
    }, [uiService]);

    const setPanelVisibility = useCallback((panelId: string, visible: boolean) => {
        uiService.getStore().setPanelVisibility(panelId, visible);
    }, [uiService]);

    return (
        <RegistryContext.Provider
            value={{
                panels,
                registerPanel,
                unregisterPanel,
                getPanelsByPosition,
                updatePanelPayload,
                actions,
                actionGroups,
                registerAction,
                registerActionGroup,
                unregisterAction,
                unregisterActionGroup,
                editorLayout,
                openEditorTab,
                closeEditorTab,
                setActiveEditorTab,
                updateEditorTabPayload,
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

