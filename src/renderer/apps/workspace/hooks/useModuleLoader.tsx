import { useEffect, useState } from "react";
import { useRegistry } from "../registry";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import {
    builtInPanels,
    builtInActions,
    builtInActionGroups,
    welcomeModule,
} from "../modules";

/**
 * Hook to load all built-in modules
 * Registers panels, editors, and global actions through UIService
 * All state changes are managed by UIStore as single source of truth
 * Registry context provides convenient React-based access to the same state
 */
export function useModuleLoader() {
    const { context } = useWorkspace();
    const { editorLayout, openEditorTab } = useRegistry();

    const [shownWelcomeTab, setShownWelcomeTab] = useState(false);

    // Register all panel modules
    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();
        const cleanup: (() => void)[] = [];

        // Register panels through UIStore (single source of truth)
        builtInPanels.forEach((panelModule) => {
            // Call onLoad if provided
            if (panelModule.onLoad) {
                panelModule.onLoad();
            }

            // Register the panel via UIStore
            store.registerPanel({
                id: panelModule.metadata.id,
                title: panelModule.metadata.title,
                icon: panelModule.metadata.icon!,
                position: panelModule.metadata.position,
                component: panelModule.component as any,
                defaultVisible: panelModule.metadata.defaultVisible,
                order: panelModule.metadata.order,
            });

            // Register panel's global actions via UIStore
            if (panelModule.actions) {
                panelModule.actions.forEach((action) => {
                    store.registerAction({
                        id: action.id,
                        label: action.label,
                        icon: action.icon,
                        tooltip: action.tooltip,
                        onClick: action.onClick,
                        order: action.order,
                        disabled: action.disabled,
                        visible: action.visible,
                        badge: action.badge,
                        when: action.when,
                    });
                });
            }

            // Register panel's action groups via UIStore
            if (panelModule.actionGroups) {
                panelModule.actionGroups.forEach((group) => {
                    store.registerActionGroup({
                        id: group.id,
                        label: group.label,
                        icon: group.icon,
                        actions: group.actions,
                        order: group.order,
                    });
                });
            }

            // Register panel's keybindings via UIService
            if (panelModule.keybindings) {
                panelModule.keybindings.forEach((keybinding) => {
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
        });

        // Register global actions via UIStore
        builtInActions.forEach((action) => {
            store.registerAction({
                id: action.id,
                label: action.label,
                icon: action.icon,
                tooltip: action.tooltip,
                onClick: action.onClick,
                order: action.order,
                disabled: action.disabled,
                visible: action.visible,
                badge: action.badge,
            });
        });

        // Register global action groups via UIStore
        builtInActionGroups.forEach((group) => {
            store.registerActionGroup({
                id: group.id,
                label: group.label,
                icon: group.icon,
                actions: group.actions,
                order: group.order,
            });
        });

        return () => {
            cleanup.forEach((fn) => fn());
            // Call onUnload for panels
            builtInPanels.forEach((panelModule) => {
                if (panelModule.onUnload) {
                    panelModule.onUnload();
                }
            });
        };
    }, [context]);

    // Open default editor (welcome tab) if no tabs are open
    // useEffect(() => {
    //     if ("tabs" in editorLayout && editorLayout.tabs.length === 0 && !shownWelcomeTab) {
    //         openEditorTab({
    //             id: welcomeModule.metadata.id,
    //             title: welcomeModule.metadata.title,
    //             icon: welcomeModule.metadata.icon,
    //             component: welcomeModule.component as any,
    //             closable: welcomeModule.metadata.closable,
    //             modified: welcomeModule.metadata.modified,
    //         });
    //         setShownWelcomeTab(true);
    //     }
    // }, [editorLayout, openEditorTab, shownWelcomeTab]);
}

