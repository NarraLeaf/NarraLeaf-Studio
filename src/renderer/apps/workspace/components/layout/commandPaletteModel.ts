import type { ReactNode } from "react";
import type { TranslationKey } from "@shared/i18n";
import type { Workspace } from "@/lib/workspace/workspace";
import type { FocusContext, Keybinding } from "@/lib/workspace/services/ui/types";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { ActionDefinition, ActionGroup, ActionMenuItem, PanelDefinition } from "../../registry/types";
import {
    getActionGroupItems,
    getVisibleActionMenuItems,
    isActionMenuAction,
    isActionMenuSeparator,
    isActionVisible,
} from "../ui/actionMenuModel";

/**
 * A command registered directly on the CommandService — one that does not already exist as a
 * toolbar action or a keybinding. Most palette entries are *derived* from those two sources; this
 * is the escape hatch for standalone commands (plugins, one-off shell actions).
 */
export interface CommandRegistration {
    id: string;
    /** Literal title; ignored when {@link titleKey} resolves. */
    title?: string;
    titleKey?: TranslationKey;
    /** Grouping label shown dimmed after the title (e.g. "View"). */
    category?: string;
    categoryKey?: TranslationKey;
    /** Raw keybinding string for display only (e.g. "mod+shift+p"); formatted at render time. */
    keybinding?: string;
    icon?: ReactNode;
    run: (workspace: Workspace) => void | Promise<void>;
    when?: (context: FocusContext) => boolean;
    /** Lower sorts first among registered commands (default 0). */
    order?: number;
}

/** A normalized, runnable entry as shown in the command palette. */
export interface PaletteCommand {
    id: string;
    title: string;
    category?: string;
    /** Raw keybinding string; the UI renders it with `formatKeybinding`. */
    keybinding?: string;
    icon?: ReactNode;
    source: "registered" | "action" | "keybinding" | "panel";
    run: () => void | Promise<void>;
}

export interface PaletteCommandSources {
    registered: readonly CommandRegistration[];
    /** Standalone toolbar actions (registry `actions`). */
    actions: readonly ActionDefinition[];
    /** Grouped actions / menus (registry `actionGroups`) — the same set mirrored to the native menu. */
    actionGroups: readonly ActionGroup[];
    /** All keybindings currently registered on the KeybindingService. */
    keybindings: readonly Keybinding[];
    /** Registered sidebar/dock panels — turned into "open <panel>" navigation commands. */
    panels: readonly PanelDefinition[];
    /**
     * User keybinding overrides (id → binding). Applied so the palette shows what a chord
     * *actually* is after rebinding; action shortcuts register under `action:<id>`.
     */
    keybindingOverrides?: Readonly<Record<string, string>>;
    /** Opens a body panel by id (its dock reacts to the visibility change and switches to it). */
    openBodyPanel: (panelId: string) => void;
    /** Category label for the panel-navigation commands (e.g. "View"), already localized. */
    panelCategory?: string;
    /** Wrapper handed to action `onClick` callbacks. */
    workspace: Workspace;
    /** Current focus, used to drop context-gated actions/keybindings and to invoke handlers. */
    focusContext: FocusContext | null;
    /** Resolves an i18n key to the active locale's string (imperative `translate`). */
    translate: (key: TranslationKey) => string;
}

const FALLBACK_FOCUS: FocusContext = { area: FocusArea.None };

/**
 * Canonicalize a keybinding so the same chord written two ways ("mod+shift+p" / "shift+mod+p")
 * collapses to one key. Used only to detect when a keybinding merely restates a shortcut an action
 * already contributes, so the palette does not list the same chord twice.
 */
function canonicalBinding(binding: string): string {
    return binding
        .toLowerCase()
        .split("+")
        .map(part => part.trim())
        .filter(Boolean)
        .sort()
        .join("+");
}

function resolveLabel(
    labelKey: TranslationKey | undefined,
    label: string | undefined,
    translate: (key: TranslationKey) => string,
): string {
    if (labelKey) {
        return translate(labelKey);
    }
    return (label ?? "").trim();
}

/**
 * Merge every command source into a single, de-duplicated, runnable list for the palette.
 *
 * Precedence and de-duplication:
 *  - The list is built registered → standalone actions → grouped actions → keybindings. Fuzzy
 *    ranking reorders it once the user types; this is just the neutral order for an empty query.
 *  - An id is listed at most once (first source wins), so an action mirrored into a menu group is
 *    not doubled.
 *  - A keybinding whose chord an action already contributes is dropped: it is the same command
 *    reached a second way, not a new one. Keybindings without a `description` are internal (no
 *    user-facing name) and are skipped entirely.
 *  - Disabled actions and context-gated entries whose `when` fails for the current focus are
 *    omitted. An icon-only action (no label) falls back to its tooltip for a title.
 *  - Registered panels become "open <panel>" navigation commands, slotted after the actions.
 */
export function collectPaletteCommands(sources: PaletteCommandSources): PaletteCommand[] {
    const {
        registered,
        actions,
        actionGroups,
        keybindings,
        panels,
        openBodyPanel,
        panelCategory,
        keybindingOverrides = {},
        workspace,
        focusContext,
        translate,
    } = sources;

    const out: PaletteCommand[] = [];
    const seenIds = new Set<string>();
    const claimedBindings = new Set<string>();

    const claimBinding = (binding: string | undefined) => {
        if (binding) {
            claimedBindings.add(canonicalBinding(binding));
        }
    };

    // 1) Explicitly registered commands (sorted by declared order).
    [...registered]
        .filter(command => !command.when || command.when(focusContext ?? FALLBACK_FOCUS))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .forEach(command => {
            if (seenIds.has(command.id)) {
                return;
            }
            const title = resolveLabel(command.titleKey, command.title, translate);
            if (!title) {
                return;
            }
            const category = command.categoryKey
                ? translate(command.categoryKey)
                : command.category;
            seenIds.add(command.id);
            claimBinding(command.keybinding);
            out.push({
                id: command.id,
                title,
                category,
                keybinding: command.keybinding,
                icon: command.icon,
                source: "registered",
                run: () => command.run(workspace),
            });
        });

    const pushAction = (action: ActionDefinition, category: string | undefined) => {
        if (action.disabled || seenIds.has(action.id)) {
            return;
        }
        // Icon-only toolbar buttons (Dev Mode, Preview, Build…) carry a tooltip, not a label —
        // fall back to it so they are still reachable by name.
        const title =
            resolveLabel(action.labelKey, action.label, translate) ||
            resolveLabel(action.tooltipKey, action.tooltip, translate);
        if (!title) {
            return;
        }
        seenIds.add(action.id);
        // Action shortcuts auto-register on the keybinding service as `action:<id>`.
        const effectiveShortcut = keybindingOverrides[`action:${action.id}`] ?? action.shortcut;
        claimBinding(effectiveShortcut);
        out.push({
            id: action.id,
            title,
            category,
            keybinding: effectiveShortcut,
            icon: action.icon,
            source: "action",
            run: () => action.onClick(workspace),
        });
    };

    // 2) Standalone toolbar actions (those not living inside a group).
    actions
        .filter(action => !action.group && isActionVisible(action, focusContext))
        .forEach(action => pushAction(action, undefined));

    // 3) Grouped actions / menus. Flatten submenus; the group's label is the category.
    const walkItems = (items: ActionMenuItem[], category: string | undefined) => {
        for (const item of getVisibleActionMenuItems(items, focusContext)) {
            if (isActionMenuSeparator(item)) {
                continue;
            }
            if (isActionMenuAction(item)) {
                pushAction(item, category);
                continue;
            }
            // Submenu: keep the top-level group label as the category (submenu nesting is shallow).
            walkItems(item.items, category);
        }
    };
    actionGroups.forEach(group => {
        const category = group.labelKey ? translate(group.labelKey) : group.label;
        walkItems(getActionGroupItems(group), category);
    });

    // 4) Sidebar/dock panels → "open <panel>" navigation commands. Body panels open by flipping
    //    their visibility (the dock reacts and switches to them); rail-action panels run their
    //    action. Panels with neither a body nor an action have nothing to open, so are skipped.
    panels.forEach(panel => {
        if (!panel.component && !panel.railAction) {
            return;
        }
        const id = `panel:${panel.id}`;
        if (seenIds.has(id)) {
            return;
        }
        const title = panel.titleKey ? translate(panel.titleKey) : (panel.title ?? "").trim();
        if (!title) {
            return;
        }
        seenIds.add(id);
        out.push({
            id,
            title,
            category: panelCategory,
            icon: panel.icon,
            source: "panel",
            run: () => {
                if (panel.railAction) {
                    panel.railAction(workspace.getContext());
                    return;
                }
                openBodyPanel(panel.id);
            },
        });
    });

    // 5) Keybindings that name a user-facing command and are not already reachable via an action.
    keybindings.forEach(keybinding => {
        const description = keybinding.description?.trim();
        if (!description || seenIds.has(keybinding.id)) {
            return;
        }
        if (keybinding.when && !keybinding.when(focusContext ?? FALLBACK_FOCUS)) {
            return;
        }
        const effectiveKey = keybindingOverrides[keybinding.id] ?? keybinding.key;
        if (claimedBindings.has(canonicalBinding(effectiveKey))) {
            return;
        }
        seenIds.add(keybinding.id);
        claimBinding(effectiveKey);
        out.push({
            id: keybinding.id,
            title: description,
            keybinding: effectiveKey,
            source: "keybinding",
            run: () => keybinding.handler(focusContext ?? FALLBACK_FOCUS),
        });
    });

    return out;
}
