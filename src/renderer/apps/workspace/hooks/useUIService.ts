import { useEffect, useState, useMemo } from "react";
import { useWorkspace } from "../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import {
    Notification,
    ActionBarItem,
    PanelDefinition,
    EditorTab,
    Dialog,
    StatusBarItem,
} from "@/lib/workspace/services/ui/types";
import {
    ActionDefinition,
    ActionGroup,
    EditorLayout,
    PanelPosition,
} from "@/apps/workspace/registry/types";

/**
 * Hook to access UI service
 */
export function useUIService(): UIService {
    const { context } = useWorkspace();
    if (!context) {
        throw new Error("useUIService called before workspace is initialized");
    }
    return useMemo(() => context.services.get<UIService>(Services.UI), [context]);
}

/**
 * Hook to access notifications
 */
export function useNotifications(): Notification[] {
    const uiService = useUIService();
    const [notifications, setNotifications] = useState<Notification[]>([]);

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setNotifications(store.getNotifications());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.notifications && mounted) {
                setNotifications(changes.notifications);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return notifications;
}

/**
 * Hook to access action bar items
 */
export function useActionBarItems(): ActionBarItem[] {
    const uiService = useUIService();
    const [items, setItems] = useState<ActionBarItem[]>([]);

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setItems(store.getActionBarItems());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.actionBarItems && mounted) {
                setItems(changes.actionBarItems);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return items;
}

/**
 * Hook to access panels
 */
export function usePanels(): PanelDefinition[] {
    const uiService = useUIService();
    const [panels, setPanels] = useState<PanelDefinition[]>([]);

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setPanels(store.getPanels());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.panels && mounted) {
                setPanels(changes.panels);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return panels;
}

/**
 * Hook to access panel visibility
 */
export function usePanelVisibility(): Record<string, boolean> {
    const uiService = useUIService();
    const [visibility, setVisibility] = useState<Record<string, boolean>>({});

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setVisibility(store.getPanelVisibility());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.panelVisibility && mounted) {
                setVisibility(changes.panelVisibility);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return visibility;
}

/**
 * Hook to access editor tabs
 */
export function useEditorTabs(): EditorTab[] {
    const uiService = useUIService();
    const [tabs, setTabs] = useState<EditorTab[]>([]);

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setTabs(store.getEditorTabs());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.editorTabs && mounted) {
                setTabs(changes.editorTabs);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return tabs;
}

/**
 * Hook to access active editor tab
 */
export function useActiveEditorTab(): { tab: EditorTab | null; tabId: string | null } {
    const uiService = useUIService();
    const [result, setResult] = useState<{ tab: EditorTab | null; tabId: string | null }>({
        tab: null,
        tabId: null,
    });

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        const tabId = store.getActiveEditorTabId();
        const tab = tabId ? store.getEditorTabs().find(t => t.id === tabId) ?? null : null;
        setResult({ tab, tabId });

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if ((changes.editorTabs || changes.activeEditorTabId !== undefined) && mounted) {
                const store = uiService.getStore();
                const tabId = store.getActiveEditorTabId();
                const tab = tabId ? store.getEditorTabs().find(t => t.id === tabId) ?? null : null;
                setResult({ tab, tabId });
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return result;
}

/**
 * Hook to access dialogs
 */
export function useDialogs(): Dialog[] {
    const uiService = useUIService();
    const [dialogs, setDialogs] = useState<Dialog[]>([]);

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setDialogs(store.getDialogs());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.dialogs && mounted) {
                setDialogs(changes.dialogs);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return dialogs;
}

/**
 * Hook to access status bar items
 */
export function useStatusBarItems(): StatusBarItem[] {
    const uiService = useUIService();
    const [items, setItems] = useState<StatusBarItem[]>([]);

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setItems(store.getStatusBarItems());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.statusBarItems && mounted) {
                setItems(changes.statusBarItems);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return items;
}

/**
 * Hook to access actions from UIStore
 */
export function useActions(): ActionDefinition[] {
    const uiService = useUIService();
    const [actions, setActions] = useState<ActionDefinition[]>([]);

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setActions(store.getActions());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.actions && mounted) {
                setActions(changes.actions);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return actions;
}

/**
 * Hook to access action groups from UIStore
 */
export function useActionGroups(): ActionGroup[] {
    const uiService = useUIService();
    const [groups, setGroups] = useState<ActionGroup[]>([]);

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setGroups(store.getActionGroups());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.actionGroups && mounted) {
                setGroups(changes.actionGroups);
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []); // Remove uiService from deps since it's memoized and should be stable

    return groups;
}

/**
 * Hook to access editor layout from UIStore
 */
export function useEditorLayout(): Readonly<EditorLayout> {
    const uiService = useUIService();
    const [layout, setLayout] = useState<Readonly<EditorLayout>>(() => {
        const store = uiService.getStore();
        return store.getEditorLayout();
    });

    useEffect(() => {
        let mounted = true;

        const store = uiService.getStore();
        setLayout(store.getEditorLayout());

        const unsubscribe = uiService.getEvents().on("stateChanged", (changes) => {
            if (changes.editorLayout && mounted) {
                setLayout(store.getEditorLayout());
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return layout;
}

/**
 * Hook to access panels by position from UIStore
 */
export function usePanelsByPosition(position: PanelPosition): PanelDefinition[] {
    const panels = usePanels();
    return panels.filter(p => p.position === position);
}

