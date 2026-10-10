import { useMemo } from "react";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import {
    useKeybindings,
    whenFocused,
    type KeybindingDefinition,
} from "@/apps/workspace/hooks";
import { useTranslation } from "@/lib/i18n";

export interface UseKeyboardShortcutsParams {
    /** Whether the shortcuts should be enabled */
    isInitialized: boolean;
    /** Panel ID to scope the shortcuts to */
    panelId: string;
    /** The dock the panel sits in: its keys answer only while focus is there. */
    focusArea: FocusArea;
    /** Copy handler */
    onCopy: () => void;
    /** Cut handler */
    onCut: () => void;
    /** Paste handler */
    onPaste: () => void;
    /** Delete the selected assets or groups */
    onDelete: () => void;
    /** Callback to rename selected asset/group */
    onRename: () => void;
}

/**
 * The assets panel's keys, every one of them filed in the keybinding catalog (`assets.*`), so each
 * can be rebound in Settings and the chord shown in menus, the cheat sheet and the context menu is
 * the one that fires.
 *
 * The panel's Edit menu actions carry the same commands but print these chords through `shortcutId`
 * rather than registering keys of their own: an action's `shortcut` registers a binding no catalog
 * entry governs, which is how Ctrl+C here once ignored a rebind the Settings table had accepted.
 */
export function useKeyboardShortcuts({
    isInitialized,
    panelId,
    focusArea,
    onCopy,
    onCut,
    onPaste,
    onDelete,
    onRename,
}: UseKeyboardShortcutsParams) {
    const { t } = useTranslation();
    const keybindings = useMemo((): KeybindingDefinition[] => [
        {
            id: "copy",
            key: "mod+c",
            description: t("assets.shortcuts.copy"),
            handler: onCopy,
        },
        {
            id: "cut",
            key: "mod+x",
            description: t("assets.shortcuts.cut"),
            handler: onCut,
        },
        {
            id: "paste",
            key: "mod+v",
            description: t("assets.shortcuts.paste"),
            handler: onPaste,
        },
        {
            id: "delete",
            key: "delete",
            description: t("assets.shortcuts.delete"),
            handler: onDelete,
        },
        {
            id: "rename",
            key: "f2",
            description: t("assets.shortcuts.rename"),
            handler: onRename,
        },
    ], [onCopy, onCut, onPaste, onDelete, onRename, t]);

    useKeybindings({
        keybindings,
        enabled: isInitialized,
        when: whenFocused(focusArea, panelId),
        idPrefix: `assets-${panelId}`,
        catalogPrefix: "assets.",
    });
}
