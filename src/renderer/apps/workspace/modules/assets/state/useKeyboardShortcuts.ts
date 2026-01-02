import { useMemo } from "react";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import {
    useKeybindings,
    whenFocused,
    type KeybindingDefinition,
} from "@/apps/workspace/hooks";

export interface UseKeyboardShortcutsParams {
    /** Whether the shortcuts should be enabled */
    isInitialized: boolean;
    /** Panel ID to scope the shortcuts to */
    panelId: string;
    /** Copy handler */
    onCopy: () => void;
    /** Cut handler */
    onCut: () => void;
    /** Paste handler */
    onPaste: () => void;
    /** Callback to rename selected asset/group */
    onRename: () => void;
    /** Whether to register clipboard shortcuts. Defaults to true. */
    registerClipboardShortcuts?: boolean;
}

/**
 * Hook to register keyboard shortcuts for the assets panel
 * Uses the new simplified keybinding system
 */
export function useKeyboardShortcuts({
    isInitialized,
    panelId,
    onCopy,
    onCut,
    onPaste,
    onRename,
    registerClipboardShortcuts = true,
}: UseKeyboardShortcutsParams) {
    // Build keybinding definitions based on options
    const keybindings = useMemo(() => {
        const bindings: KeybindingDefinition[] = [];

        if (registerClipboardShortcuts) {
            bindings.push(
                {
                    id: "copy",
                    key: "ctrl+c",
                    description: "Copy selected assets",
                    handler: onCopy,
                },
                {
                    id: "cut",
                    key: "ctrl+x",
                    description: "Cut selected assets",
                    handler: onCut,
                },
                {
                    id: "paste",
                    key: "ctrl+v",
                    description: "Paste assets",
                    handler: onPaste,
                }
            );
        }

        bindings.push({
            id: "rename",
            key: "f2",
            description: "Rename selected asset or group",
            handler: onRename,
        });

        return bindings;
    }, [registerClipboardShortcuts, onCopy, onCut, onPaste, onRename]);

    // Use the new keybindings hook with common condition
    useKeybindings({
        keybindings,
        enabled: isInitialized,
        when: whenFocused(FocusArea.LeftPanel, panelId),
        idPrefix: `assets-${panelId}`,
    });
}
