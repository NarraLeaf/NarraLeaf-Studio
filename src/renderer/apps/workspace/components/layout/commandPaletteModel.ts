import { createElement, type ReactNode } from "react";
import { Keyboard, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import type { WorkspaceFreezeKind } from "@shared/types/ipcEvents";
import type { Workspace } from "@/lib/workspace/workspace";
import type { FocusContext, Keybinding } from "@/lib/workspace/services/ui/types";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { getKeybindingCatalogEntry, resolveActionShortcut, resolveShortcut } from "@/lib/workspace/services/ui/keybindingCatalog";
import type { ActionDefinition, ActionGroup, ActionMenuItem, PanelDefinition } from "../../registry/types";
import {
    getActionGroupItems,
    getVisibleActionMenuItems,
    isActionMenuAction,
    isActionMenuSeparator,
    isActionVisible,
} from "../ui/actionMenuModel";
import { isActionFrozenOut, isFreezeExemptActionGroup } from "../ui/freezeActionPolicy";

/**
 * A command registered directly on the CommandService - one that does not already exist as a
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
    /**
     * Catalog id whose chord this row displays, when it is not the command's own id.
     *
     * A command whose id IS a catalog id needs nothing here - the chord resolves from the catalog
     * (and the user's rebind) automatically. This is for the case where several commands share one
     * shortcut: Stop Dev Mode, Stop Preview and Stop Test all point at `run:stop`, because one
     * chord stops whichever of them is running and the settings table should offer one row to
     * rebind, not three that read as conflicting with each other.
     */
    keybindingId?: string;
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
    /** Grouped actions / menus (registry `actionGroups`) - the same set mirrored to the native menu. */
    actionGroups: readonly ActionGroup[];
    /** All keybindings currently registered on the KeybindingService. */
    keybindings: readonly Keybinding[];
    /** Registered sidebar/dock panels - turned into "open <panel>" navigation commands. */
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
    /**
     * Why the workspace is frozen, or null when it is writable - which drops the actions a frozen
     * top bar disables.
     *
     * Not cosmetic. The top bar renders those buttons greyed with a reason, but the palette runs the
     * SAME registrations, so without this the Build icon is dead to the mouse and one Ctrl+P away
     * from running - and the point of disabling them is the side effects the write boundary cannot
     * catch (kicking off a build, calling out to a service, changing a global setting).
     *
     * The kind rather than a boolean because `freezeActionPolicy` is what decides, and it answers
     * differently for the one action that only starts something main owns; the palette must show the
     * same list the bar does.
     *
     * Omitted rather than listed-and-inert because that is already this list's convention for a
     * disabled action, and an un-runnable search result is noise; the top bar is where the greyed
     * control explains itself.
     */
    freeze?: WorkspaceFreezeKind | null;
}

const FALLBACK_FOCUS: FocusContext = { area: FocusArea.None };

/**
 * Every other source hands the palette ready-made JSX, but the keybinding catalog stores the icon
 * as a component so it stays a plain data table (no JSX in `lib/`, and the settings shortcut table
 * and cheat sheet can size it their own way). Sized to match the `w-4 h-4` the action and panel
 * registries use, since they share one icon column.
 */
function renderCatalogIcon(icon: LucideIcon): ReactNode {
    return createElement(icon, { className: "w-4 h-4" });
}

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
 *    omitted, as are the actions a frozen workspace turns off - the palette runs the same
 *    registrations the top bar does, so leaving them here would make a greyed button one Ctrl+P
 *    away from running. An icon-only action (no label) falls back to its tooltip for a title.
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
        freeze = null,
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
            // The chord comes from the catalog whenever one names this command, so a command that
            // has a shortcut shows it here rather than being listed twice - once as itself and once
            // as the keybinding below. Overrides win, for the reason they win everywhere else: the
            // palette must show the chord the author would actually press.
            const effectiveBinding = resolveShortcut(
                command.keybindingId ?? command.id,
                keybindingOverrides,
                command.keybinding,
            );
            seenIds.add(command.id);
            claimBinding(effectiveBinding);
            out.push({
                id: command.id,
                title,
                category,
                keybinding: effectiveBinding,
                icon: command.icon,
                source: "registered",
                run: () => command.run(workspace),
            });
        });

    const pushAction = (action: ActionDefinition, category: string | undefined, frozenOut = false) => {
        if (action.disabled || frozenOut || seenIds.has(action.id)) {
            return;
        }
        // Icon-only toolbar buttons (Dev Mode, Preview, Build…) carry a tooltip, not a label -
        // fall back to it so they are still reachable by name.
        const title =
            resolveLabel(action.labelKey, action.label, translate) ||
            resolveLabel(action.tooltipKey, action.tooltip, translate);
        if (!title) {
            return;
        }
        seenIds.add(action.id);
        // Action shortcuts auto-register on the keybinding service as `action:<id>`, so that is
        // also the id an override and a catalog entry for one are keyed by. Reading the catalog
        // here is what lets an action carry a *rebindable* default chord (Production Build's
        // F10 is one) without declaring `shortcut`, which would register a second binding that
        // no catalog entry governs.
        const effectiveShortcut = action.shortcutId
            ? resolveShortcut(action.shortcutId, keybindingOverrides, action.shortcut)
            : resolveActionShortcut(action.id, keybindingOverrides, action.shortcut);
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

    // 2) Standalone toolbar actions (those not living inside a group). They have no group label to
    //    borrow a category from, so they may declare one themselves.
    actions
        .filter(action => !action.group && isActionVisible(action, focusContext))
        .forEach(action =>
            pushAction(
                action,
                action.paletteCategoryKey ? translate(action.paletteCategoryKey) : undefined,
                isActionFrozenOut(action, freeze),
            ),
        );

    // 3) Grouped actions / menus. Flatten submenus; the group's label is the category.
    const walkItems = (items: ActionMenuItem[], category: string | undefined, frozenOut: boolean) => {
        for (const item of getVisibleActionMenuItems(items, focusContext)) {
            if (isActionMenuSeparator(item)) {
                continue;
            }
            if (isActionMenuAction(item)) {
                pushAction(item, category, frozenOut);
                continue;
            }
            // Submenu: keep the top-level group label as the category (submenu nesting is shallow).
            walkItems(item.items, category, frozenOut);
        }
    };
    actionGroups.forEach(group => {
        const category = group.labelKey ? translate(group.labelKey) : group.label;
        // Decided per GROUP, not per item: a menu entry does not carry the group it was declared in,
        // so asking `isActionFrozenOut` about it would read every File entry as unexempt.
        walkItems(getActionGroupItems(group), category, freeze !== null && !isFreezeExemptActionGroup(group.id));
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
        // A panel-navigation command can carry a chord too (⇧⌘F reveals the search panel), and it
        // is catalogued under this very id - so the same override → catalog resolution the other
        // two sources use applies here, and claiming it keeps the binding from being listed again
        // under its own name.
        const panelBinding = keybindingOverrides[id] ?? getKeybindingCatalogEntry(id)?.key;
        claimBinding(panelBinding);
        out.push({
            id,
            title,
            category: panelCategory,
            keybinding: panelBinding,
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
    //
    //    Everything user-facing resolves through the *catalog*, keyed by `catalogId`, exactly as
    //    KeybindingService.getEffectiveKey does. That matters twice over: registration ids are
    //    often per-tab (`story-scene-editor-<tabId>-undo`), so keying on `id` would miss the
    //    user's rebind and list one entry per open tab; and `description` is internal English
    //    metadata that predates the catalog, so using it as a title leaks untranslated strings
    //    into a localized palette. It survives only as the fallback for bindings with no catalog
    //    entry, which are the ones nobody has named yet.
    keybindings.forEach(keybinding => {
        const catalogId = keybinding.catalogId ?? keybinding.id;
        if (seenIds.has(catalogId)) {
            return;
        }
        if (keybinding.when && !keybinding.when(focusContext ?? FALLBACK_FOCUS)) {
            return;
        }
        const catalogEntry = getKeybindingCatalogEntry(catalogId);
        const title = catalogEntry ? translate(catalogEntry.labelKey) : keybinding.description?.trim();
        if (!title) {
            return;
        }
        const effectiveKey = keybindingOverrides[catalogId] ?? catalogEntry?.key ?? keybinding.key;
        if (claimedBindings.has(canonicalBinding(effectiveKey))) {
            return;
        }
        seenIds.add(catalogId);
        claimBinding(effectiveKey);
        out.push({
            id: catalogId,
            title,
            category: catalogEntry ? translate(catalogEntry.categoryKey) : undefined,
            keybinding: effectiveKey,
            // A binding with no catalog entry is one nobody has named yet (it is here on its
            // English `description` alone), so there is no glyph to look up - it gets the generic
            // "this is a shortcut" one rather than a hole in the column.
            icon: renderCatalogIcon(catalogEntry?.icon ?? Keyboard),
            source: "keybinding",
            run: () => keybinding.handler(focusContext ?? FALLBACK_FOCUS),
        });
    });

    return out;
}
