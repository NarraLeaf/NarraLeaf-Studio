import { useEffect, useRef, useCallback } from "react";
import { useRegistry } from "../registry";
import {
    PanelModule,
    EditorModule,
    ModuleRegistration,
    ModuleAction,
    ModuleActionGroup,
    ModuleKeybinding,
} from "./types";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";

/**
 * Hook to register a panel module
 * Automatically registers the panel and its associated actions/keybindings
 * Cleans up on unmount
 * 
 * @param module - The panel module to register
 * @returns Module registration object with unregister function
 */
export function usePanelModule(module: PanelModule): ModuleRegistration {
    const { registerPanel, unregisterPanel } = useRegistry();
    const { context } = useWorkspace();
    const cleanupRef = useRef<(() => void)[]>([]);

    useEffect(() => {
        const cleanup: (() => void)[] = [];

        // Call onLoad if provided
        if (module.onLoad) {
            module.onLoad();
        }

        // Register the panel
        registerPanel({
            id: module.metadata.id,
            title: module.metadata.title,
            icon: module.metadata.icon!,
            position: module.metadata.position,
            component: module.component as any,
            defaultVisible: module.metadata.defaultVisible,
            order: module.metadata.order,
            badge: module.metadata.badge,
        });
        cleanup.push(() => unregisterPanel(module.metadata.id));

        // Register global actions (if any)
        if (module.actions && context) {
            const uiService = context.services.get<UIService>(Services.UI);
            module.actions.forEach((action) => {
                uiService.actionBar.register(action);
                cleanup.push(() => uiService.actionBar.unregister(action.id));
            });
        }

        // Register global action groups (if any)
        if (module.actionGroups && context) {
            const uiService = context.services.get<UIService>(Services.UI);
            module.actionGroups.forEach((group) => {
                uiService.actionBar.registerGroup({
                    id: group.id,
                    label: group.label,
                    icon: group.icon,
                    actions: group.actions,
                    order: group.order,
                });
                cleanup.push(() => uiService.actionBar.unregisterGroup(group.id));
            });
        }

        // Register keybindings (if any)
        if (module.keybindings && context) {
            const uiService = context.services.get<UIService>(Services.UI);
            module.keybindings.forEach((keybinding) => {
                uiService.keybindings.register({
                    id: keybinding.id,
                    key: keybinding.key,
                    description: keybinding.description,
                    handler: keybinding.handler,
                    when: keybinding.when,
                });
                cleanup.push(() => uiService.keybindings.unregister(keybinding.id));
            });
        }

        cleanupRef.current = cleanup;

        // Cleanup on unmount
        return () => {
            cleanup.forEach((fn) => fn());
            if (module.onUnload) {
                module.onUnload();
            }
        };
    }, [module, registerPanel, unregisterPanel, context]);

    const unregister = useCallback(() => {
        cleanupRef.current.forEach((fn) => fn());
        cleanupRef.current = [];
        if (module.onUnload) {
            module.onUnload();
        }
    }, [module]);

    return {
        id: module.metadata.id,
        unregister,
    };
}

/**
 * Hook to register an editor module
 * Automatically registers the editor type
 * Cleans up on unmount
 * 
 * @param module - The editor module to register
 * @returns Module registration object with unregister function
 */
export function useEditorModule(module: EditorModule): ModuleRegistration {
    const { context } = useWorkspace();
    const cleanupRef = useRef<(() => void)[]>([]);

    useEffect(() => {
        const cleanup: (() => void)[] = [];

        // Call onLoad if provided
        if (module.onLoad) {
            module.onLoad();
        }

        // Register global actions (if any)
        if (module.actions && context) {
            const uiService = context.services.get<UIService>(Services.UI);
            module.actions.forEach((action) => {
                uiService.actionBar.register(action);
                cleanup.push(() => uiService.actionBar.unregister(action.id));
            });
        }

        // Register global action groups (if any)
        if (module.actionGroups && context) {
            const uiService = context.services.get<UIService>(Services.UI);
            module.actionGroups.forEach((group) => {
                uiService.actionBar.registerGroup({
                    id: group.id,
                    label: group.label,
                    icon: group.icon,
                    actions: group.actions,
                    order: group.order,
                });
                cleanup.push(() => uiService.actionBar.unregisterGroup(group.id));
            });
        }

        // Register keybindings (if any)
        if (module.keybindings && context) {
            const uiService = context.services.get<UIService>(Services.UI);
            module.keybindings.forEach((keybinding) => {
                uiService.keybindings.register({
                    id: keybinding.id,
                    key: keybinding.key,
                    description: keybinding.description,
                    handler: keybinding.handler,
                    when: keybinding.when,
                });
                cleanup.push(() => uiService.keybindings.unregister(keybinding.id));
            });
        }

        cleanupRef.current = cleanup;

        // Cleanup on unmount
        return () => {
            cleanup.forEach((fn) => fn());
            if (module.onUnload) {
                module.onUnload();
            }
        };
    }, [module, context]);

    const unregister = useCallback(() => {
        cleanupRef.current.forEach((fn) => fn());
        cleanupRef.current = [];
        if (module.onUnload) {
            module.onUnload();
        }
    }, [module]);

    return {
        id: module.metadata.id,
        unregister,
    };
}

/**
 * Hook to open an editor tab
 * Helper function to open editor tabs with proper typing
 * 
 * @returns Function to open editor tabs
 */
export function useOpenEditor() {
    const { openEditorTab } = useRegistry();

    return useCallback(
        <TPayload = any>(module: EditorModule<TPayload>, payload?: TPayload, groupId?: string) => {
            openEditorTab(
                {
                    id: module.metadata.id,
                    title: module.metadata.title,
                    icon: module.metadata.icon,
                    component: module.component as any,
                    closable: module.metadata.closable,
                    modified: module.metadata.modified,
                    badge: module.metadata.badge,
                },
                groupId
            );
        },
        [openEditorTab]
    );
}

/**
 * Hook to register actions that are only active in a specific context
 * Useful for registering actions within a panel/editor component
 * 
 * @param actions - Actions to register
 * @param when - Optional condition for when actions should be active
 */
export function useRegisterActions(actions: ModuleAction[], when?: () => boolean) {
    const { context } = useWorkspace();

    useEffect(() => {
        if (!context) return;

        // Check condition
        if (when && !when()) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const cleanup: (() => void)[] = [];

        actions.forEach((action) => {
            uiService.actionBar.register(action);
            cleanup.push(() => uiService.actionBar.unregister(action.id));
        });

        return () => {
            cleanup.forEach((fn) => fn());
        };
    }, [actions, when, context]);
}

/**
 * Hook to register keybindings that are only active in a specific context
 * Useful for registering keybindings within a panel/editor component
 * 
 * @param keybindings - Keybindings to register
 * @param when - Optional condition for when keybindings should be active
 */
export function useRegisterKeybindings(keybindings: ModuleKeybinding[], when?: () => boolean) {
    const { context } = useWorkspace();

    useEffect(() => {
        if (!context) return;

        // Check condition
        if (when && !when()) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const cleanup: (() => void)[] = [];

        keybindings.forEach((keybinding) => {
            uiService.keybindings.register({
                id: keybinding.id,
                key: keybinding.key,
                description: keybinding.description,
                handler: keybinding.handler,
                when: keybinding.when,
            });
            cleanup.push(() => uiService.keybindings.unregister(keybinding.id));
        });

        return () => {
            cleanup.forEach((fn) => fn());
        };
    }, [keybindings, when, context]);
}

