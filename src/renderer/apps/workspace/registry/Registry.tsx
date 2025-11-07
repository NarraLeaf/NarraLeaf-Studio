import { createContext, useContext, ReactNode } from "react";
import {
    PanelDefinition,
    PanelPosition,
    ActionDefinition,
    ActionGroup,
    EditorTabDefinition,
    EditorLayout,
} from "./types";
import {
    useActions,
    useActionGroups,
    useEditorLayout,
    usePanels,
    usePanelVisibility,
    useUIService,
} from "../hooks/useUIService";

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
    const registerPanel = <TPayload = any>(panel: PanelDefinition<TPayload>) => {
        uiService.getStore().registerPanel(panel);
    };

    const unregisterPanel = (id: string) => {
        uiService.getStore().unregisterPanel(id);
    };

    const updatePanelPayload = <TPayload = any>(panelId: string, payload: TPayload) => {
        uiService.getStore().updatePanelPayload(panelId, payload);
    };

    // Action management - delegate to UIStore
    const registerAction = (action: ActionDefinition) => {
        uiService.getStore().registerAction(action);
    };

    const registerActionGroup = (group: ActionGroup) => {
        uiService.getStore().registerActionGroup(group);
    };

    const unregisterAction = (id: string) => {
        uiService.getStore().unregisterAction(id);
    };

    const unregisterActionGroup = (id: string) => {
        uiService.getStore().unregisterActionGroup(id);
    };

    // Editor management - delegate to UIStore
    const openEditorTab = <TPayload = any>(tab: EditorTabDefinition<TPayload>, groupId?: string) => {
        uiService.getStore().openEditorTabInGroup(tab, groupId);
    };

    const closeEditorTab = (tabId: string, groupId?: string) => {
        uiService.getStore().closeEditorTabInGroup(tabId, groupId);
    };

    const setActiveEditorTab = (tabId: string, groupId: string) => {
        uiService.getStore().setActiveEditorTabInGroup(tabId, groupId);
    };

    const updateEditorTabPayload = <TPayload = any>(tabId: string, payload: TPayload, groupId?: string) => {
        uiService.getStore().updateEditorTabPayload(tabId, payload, groupId);
    };

    // Panel visibility - delegate to UIStore
    const togglePanelVisibility = (panelId: string) => {
        uiService.getStore().togglePanelVisibility(panelId);
    };

    const setPanelVisibility = (panelId: string, visible: boolean) => {
        uiService.getStore().setPanelVisibility(panelId, visible);
    };

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

