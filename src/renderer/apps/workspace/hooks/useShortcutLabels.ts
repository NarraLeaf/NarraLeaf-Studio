import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { formatKeybinding } from "@/lib/workspace/services/ui/KeybindingService";
import { resolveActionShortcut, resolveShortcut } from "@/lib/workspace/services/ui/keybindingCatalog";
import { getFixedInputEntry } from "@/lib/workspace/services/ui/fixedInputCatalog";
import type { ContextMenuDef, ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import { isMacPlatform } from "@/lib/app/platform";
import { useWorkspace } from "../context";

export interface ShortcutLabels {
    /** The chord for a registered action, written the way this platform writes it. */
    forAction: (actionId: string, inline?: string) => string | undefined;
    /** The chord for a menu row: its named catalog entry when it has one, else its own. */
    forMenuItem: (item: { id: string; shortcut?: string; shortcutId?: string }) => string | undefined;
    /** The chord for a catalog entry, by its own id (`run:dev-mode`, `story.move-row-up`, …). */
    forBinding: (bindingId: string, inline?: string) => string | undefined;
    /**
     * The key of a fixed-input entry (one that cannot be rebound, such as the blueprint canvas's
     * Delete), or undefined when the entry is a mouse gesture with no key.
     */
    forFixed: (fixedId: string) => string | undefined;
}

/**
 * Print chords on the rows of a context menu built elsewhere, by row id.
 *
 * `bindings` maps a row id to the catalog id of the command the row runs (`{ copy: "ui-editor.copy" }`);
 * submenus are walked too, so an Align submenu gets its chords from the same table. A mapping is the
 * whole change at a call site: menu builders stay unaware of keys, and a row with no mapping is left
 * as it was.
 */
export function withMenuShortcuts(
    items: ContextMenuDef,
    bindings: Readonly<Record<string, string>>,
    resolve: (bindingId: string) => string | undefined,
): ContextMenuDef {
    return items.map(item => {
        if ("separator" in item && item.separator) {
            return item;
        }
        const row = item as ContextMenuItemDef;
        const bindingId = bindings[row.id];
        const shortcut = bindingId ? resolve(bindingId) : undefined;
        const submenu = row.submenu ? withMenuShortcuts(row.submenu as ContextMenuDef, bindings, resolve) : undefined;
        if (!shortcut && submenu === undefined) {
            return row;
        }
        return {
            ...row,
            ...(shortcut ? { shortcut } : {}),
            ...(submenu ? { submenu: submenu as ContextMenuItemDef[] } : {}),
        };
    });
}

const NO_OVERRIDES: Readonly<Record<string, string>> = {};
const NO_SUBSCRIPTION = () => () => {};
const NO_REVISION = () => 0;

/**
 * The chords to print beside menu rows.
 *
 * Menus name commands an author can also reach from the keyboard, and a menu that does not say so is
 * the reason the keyboard stays undiscovered. What it prints is the chord that would actually fire -
 * a rebinding included - which is why this reads the service's overrides rather than whatever a
 * registration happened to declare, and why it re-renders when the author changes one in Settings.
 *
 * The overrides are read during render rather than copied into state after mount, so a component
 * that calls this renders once, not twice. That matters to the story editor, which calls it from
 * every row on screen and mounts rows as the list scrolls.
 *
 * Drawing only. Registering a key is a separate act with its own rules; see `resolveShortcut`.
 */
export function useShortcutLabels(): ShortcutLabels {
    const { context } = useWorkspace();
    const keybindings = context ? context.services.get<UIService>(Services.UI).keybindings : null;

    const subscribe = useCallback(
        (listener: () => void) => keybindings?.onOverridesChanged(listener) ?? (() => {}),
        [keybindings],
    );
    const revision = useSyncExternalStore(
        keybindings ? subscribe : NO_SUBSCRIPTION,
        keybindings ? () => keybindings.getOverridesRevision() : NO_REVISION,
    );
    const overrides = useMemo(
        () => keybindings?.getOverridesSnapshot() ?? NO_OVERRIDES,
        // `revision` is the change signal; the snapshot is a fresh copy on every call.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [keybindings, revision],
    );

    const isMac = isMacPlatform();
    const format = useCallback((key: string | undefined) => (
        key ? formatKeybinding(key, isMac) : undefined
    ), [isMac]);

    return useMemo(() => ({
        forAction: (actionId, inline) => format(resolveActionShortcut(actionId, overrides, inline)),
        forBinding: (bindingId, inline) => format(resolveShortcut(bindingId, overrides, inline)),
        forFixed: fixedId => {
            const input = getFixedInputEntry(fixedId)?.inputs.find(candidate => "key" in candidate);
            return input && "key" in input ? format(input.key) : undefined;
        },
        forMenuItem: item => format(item.shortcutId
            ? resolveShortcut(item.shortcutId, overrides, item.shortcut)
            : resolveActionShortcut(item.id, overrides, item.shortcut)),
    }), [format, overrides]);
}
