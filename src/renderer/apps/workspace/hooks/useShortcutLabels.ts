import { useCallback, useEffect, useMemo, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { formatKeybinding } from "@/lib/workspace/services/ui/KeybindingService";
import { resolveActionShortcut, resolveShortcut } from "@/lib/workspace/services/ui/keybindingCatalog";
import { isMacPlatform } from "@/lib/app/platform";
import { useWorkspace } from "../context";

export interface ShortcutLabels {
    /** The chord for a registered action, written the way this platform writes it. */
    forAction: (actionId: string, inline?: string) => string | undefined;
    /** The chord for a menu row: its named catalog entry when it has one, else its own. */
    forMenuItem: (item: { id: string; shortcut?: string; shortcutId?: string }) => string | undefined;
    /** The chord for a catalog entry, by its own id (`run:dev-mode`, `story.move-row-up`, …). */
    forBinding: (bindingId: string, inline?: string) => string | undefined;
}

/**
 * The chords to print beside menu rows.
 *
 * Menus name commands an author can also reach from the keyboard, and a menu that does not say so is
 * the reason the keyboard stays undiscovered. What it prints is the chord that would actually fire -
 * a rebinding included - which is why this reads the service's overrides rather than whatever a
 * registration happened to declare, and why it re-renders when the author changes one in Settings.
 *
 * Drawing only. Registering a key is a separate act with its own rules; see `resolveShortcut`.
 */
export function useShortcutLabels(): ShortcutLabels {
    const { context } = useWorkspace();
    const [overrides, setOverrides] = useState<Readonly<Record<string, string>>>({});

    useEffect(() => {
        if (!context) return;
        const keybindings = context.services.get<UIService>(Services.UI).keybindings;
        setOverrides(keybindings.getOverridesSnapshot());
        return keybindings.onOverridesChanged(() => setOverrides(keybindings.getOverridesSnapshot()));
    }, [context]);

    const isMac = isMacPlatform();
    const format = useCallback((key: string | undefined) => (
        key ? formatKeybinding(key, isMac) : undefined
    ), [isMac]);

    return useMemo(() => ({
        forAction: (actionId, inline) => format(resolveActionShortcut(actionId, overrides, inline)),
        forBinding: (bindingId, inline) => format(resolveShortcut(bindingId, overrides, inline)),
        forMenuItem: item => format(item.shortcutId
            ? resolveShortcut(item.shortcutId, overrides, item.shortcut)
            : resolveActionShortcut(item.id, overrides, item.shortcut)),
    }), [format, overrides]);
}
