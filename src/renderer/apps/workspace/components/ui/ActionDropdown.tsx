import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { ActionDefinition, ActionGroup, ActionMenuItem } from "../../registry/types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusContext } from "@/lib/workspace/services/ui";
import { cn } from "@/lib/utils/cn";
import {
    getActionGroupItems,
    getVisibleActionMenuItems,
    isActionMenuAction,
    isActionMenuSeparator,
} from "./actionMenuModel";
import { applyFreezeToActionMenuItems, isFreezeExemptActionGroup } from "./freezeActionPolicy";
import { MnemonicLabel, useMnemonicReveal, useTitleBarMenu } from "./titleBarMenus";
import { MenuShortcut } from "./MenuShortcut";
import { useWorkspaceFrozen } from "../../hooks/useWorkspaceFrozen";
import { useShortcutLabels, type ShortcutLabels } from "../../hooks/useShortcutLabels";
import { useTranslation } from "@/lib/i18n";

interface ActionDropdownProps {
    group: ActionGroup;
    /**
     * Draw the trigger as its icon alone, with no label and no chevron - the hamburger main menu,
     * whose one button stands for every group rather than naming one.
     */
    iconOnly?: boolean;
    /**
     * The items already carry whatever a frozen workspace does to them, so leave them alone.
     *
     * Set by the hamburger main menu, which holds several groups at once: the freeze is a decision
     * per group (see `./freezeActionPolicy`), and this dropdown - which knows only its own id -
     * would otherwise re-apply it to all of them, switching off the File and Help menus that keep a
     * frozen window escapable.
     */
    preFrozen?: boolean;
}

/**
 * Action dropdown component for grouped actions
 * Filters actions based on focus context and when conditions
 *
 * While the workspace is frozen the menu still OPENS and still lists everything - only its items are
 * disabled, and only for groups the exemption table does not name (see `./freezeActionPolicy`). A
 * menu that refused to open would hide what the freeze is doing, which is the opposite of the point.
 *
 * These are the menus of the title bar's menu bar, so they hold their open state in the bar rather
 * than each on its own (`./titleBarMenus`): one at a time, and the pointer walks between them once
 * one is open.
 */
export function ActionDropdown({ group, iconOnly = false, preFrozen = false }: ActionDropdownProps) {
    const { t } = useTranslation();
    const { workspace, context } = useWorkspace();
    const frozen = useWorkspaceFrozen();
    const frozenOut = frozen && !preFrozen && !isFreezeExemptActionGroup(group.id);
    const groupLabel = group.labelKey ? t(group.labelKey) : group.label;
    // The bar delivers keys to the open menu, so the handler has to exist before the hook that will
    // call it; it is handed over through a box that each render refreshes.
    const keyHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
    const {
        ref: dropdownRef,
        open: isOpen,
        setOpen: setIsOpen,
        toggle: toggleDropdown,
        triggerProps,
    } = useTitleBarMenu(group.id, {
        hotTrack: true,
        mnemonic: group.mnemonic,
        onKeyDown: event => keyHandlerRef.current(event),
    });
    const revealMnemonic = useMnemonicReveal();
    const shortcuts = useShortcutLabels();
    const [openPath, setOpenPath] = useState<number[]>([]); // path of opened submenus
    const [focusPath, setFocusPath] = useState<number[]>([]); // path of focused item
    const [focusContext, setFocusContext] = useState<FocusContext | null>(null);
    const rootMenuRef = useRef<HTMLDivElement>(null);
    const hoverOpenTimerRef = useRef<number | null>(null);
    const hoverCloseTimerRef = useRef<number | null>(null);

    // Subscribe to focus changes
    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        setFocusContext(uiService.focus.getFocus());

        return uiService.focus.onFocusChange((newContext) => {
            setFocusContext(newContext);
        });
    }, [context]);

    // Normalize items: prefer hierarchical `items`, fallback to flat `actions`.
    // The freeze is applied to COPIES here rather than to the registrations, which are shared
    // registry state that outlives a freeze - mutating them would leave the menu dead after a thaw.
    const rootItems: ActionMenuItem[] = useMemo(() => {
        return applyFreezeToActionMenuItems(
            getVisibleActionMenuItems(getActionGroupItems(group), focusContext),
            frozenOut,
        );
    }, [group, focusContext, frozenOut]);

    useEffect(() => {
        if (!isOpen) {
            setOpenPath([]);
            setFocusPath([]);
        } else {
            // initialize focus on first enabled item
            const idx = firstEnabledIndex(rootItems);
            setFocusPath(idx >= 0 ? [idx] : []);
            // focus the root menu container to receive keyboard events
            if (rootMenuRef.current) {
                rootMenuRef.current.focus();
            }
        }
    }, [isOpen, rootItems]);

    useEffect(() => {
        // Cleanup timers on unmount
        return () => {
            if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
            if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
        };
    }, []);

    const handleActionClick = (action: ActionDefinition) => {
        if (!workspace) {
            console.warn("[ActionDropdown] Unhandled action click: workspace is not initialized");
            return;
        }

        if (!action.disabled) {
            action.onClick(workspace);
            setIsOpen(false);
        }
    };

    /**
     * The keys this menu answers while it is open. What it declines - Escape at the top level, and
     * an arrow that would leave the menu sideways - falls through to the bar, which closes it or
     * walks to the next menu. That split is the whole reason this returns a verdict rather than
     * calling `preventDefault` itself.
     */
    const handleMenuKeyDown = (event: KeyboardEvent): boolean => {
        if (event.key === "Escape") {
            // One level of submenu at a time; the last Escape is the bar's to answer.
            if (openPath.length === 0) return false;
            setOpenPath(openPath.slice(0, -1));
            setFocusPath(focusPath.slice(0, -1));
            return true;
        }

        const { key } = event;
        if (!focusPath.length) return false;

        const level = focusPath.length - 1;
        const itemsAtLevel = getItemsAtPath(rootItems, focusPath.slice(0, -1), focusContext);
        const focusedIndex = focusPath[level];
        const focusedItem = itemsAtLevel[focusedIndex];
        const openSubmenu = (): boolean => {
            if (isActionMenuAction(focusedItem) || isActionMenuSeparator(focusedItem)) return false;
            const visible = getVisibleActionMenuItems(focusedItem.items, focusContext);
            if (visible.length === 0) return false;
            setOpenPath(focusPath);
            const first = firstEnabledIndex(visible);
            if (first !== -1) setFocusPath([...focusPath, first]);
            return true;
        };

        if (key === "ArrowDown" || key === "Down") {
            const next = nextEnabledIndex(itemsAtLevel, focusedIndex);
            if (next !== -1) setFocusPath(replaceIndex(focusPath, level, next));
            return true;
        }
        if (key === "ArrowUp" || key === "Up") {
            const prev = prevEnabledIndex(itemsAtLevel, focusedIndex);
            if (prev !== -1) setFocusPath(replaceIndex(focusPath, level, prev));
            return true;
        }
        if (key === "ArrowRight" || key === "Right") {
            // A row with nothing to open is the end of this menu: the bar takes the key.
            return openSubmenu();
        }
        if (key === "ArrowLeft" || key === "Left") {
            if (openPath.length === 0) return false;
            setOpenPath(openPath.slice(0, -1));
            setFocusPath(focusPath.slice(0, -1));
            return true;
        }
        if (key === "Enter" || key === " ") {
            if (isActionMenuAction(focusedItem) && !focusedItem.disabled) {
                handleActionClick(focusedItem);
                return true;
            }
            return openSubmenu();
        }
        return false;
    };

    useEffect(() => {
        keyHandlerRef.current = handleMenuKeyDown;
    });

    if (rootItems.length === 0) {
        return null;
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={toggleDropdown}
                {...triggerProps}
                onKeyDown={(e) => {
                    if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !isOpen) {
                        setIsOpen(true);
                        e.preventDefault();
                    }
                }}
                className={cn(
                    iconOnly ? "h-8 w-8 justify-center" : "h-8 px-2",
                    "rounded-md flex items-center gap-2 text-sm transition-colors cursor-default",
                    // The open menu keeps the pressed fill after the pointer has left the button for
                    // the panel below it - and while the pointer is walking the bar, it is the only
                    // thing naming which menu the panel belongs to.
                    isOpen ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                )}
                data-tip={String(groupLabel)}
                aria-label={String(groupLabel)}
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                {group.icon && <span className="w-4 h-4">{group.icon}</span>}
                {!iconOnly && (
                    <>
                        <span>
                            <MnemonicLabel
                                label={String(groupLabel)}
                                mnemonic={group.mnemonic}
                                reveal={revealMnemonic}
                            />
                        </span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </>
                )}
            </button>

            {isOpen && (
                <>
                    {/* Backdrop. Dismissal itself belongs to the bar, which watches for a pointer
                        landing outside this menu; what this adds is that a click meant to put the
                        menu away does not also press whatever it landed on. It reaches only the
                        content below the title bar, which is why the bar's own watch is what closes
                        the menu when the click lands on a sibling or on the title bar itself. */}
                    <div
                        className="nl-window-content-layer z-10"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Root menu. Keys arrive from the bar rather than from this element: an open
                        menu answers the keyboard whether or not it managed to keep focus, which a
                        menu opened by the pointer or by Alt has no reason to have. It still takes
                        focus below, so the reading order follows what is on screen. */}
                    <div
                        ref={rootMenuRef}
                        className="absolute top-full left-0 mt-1 z-20 min-w-64 bg-surface-overlay border border-edge-strong rounded-md shadow-lg py-1"
                        role="menu"
                        aria-label={groupLabel}
                        tabIndex={0}
                    >
                        <MenuLevel
                            level={0}
                            items={rootItems}
                            openPath={openPath}
                            focusPath={focusPath}
                            setOpenPath={setOpenPath}
                            setFocusPath={setFocusPath}
                            onActionClick={handleActionClick}
                            hoverOpenTimerRef={hoverOpenTimerRef}
                            hoverCloseTimerRef={hoverCloseTimerRef}
                            focusContext={focusContext}
                            shortcuts={shortcuts}
                            disabledTitle={frozenOut ? t("workspace.shell.freeze.unavailable") : undefined}
                        />
                    </div>
                </>
            )}
        </div>
    );
}

function firstEnabledIndex(items: ActionMenuItem[]): number {
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (isActionMenuSeparator(it)) continue;
        if (isActionMenuAction(it)) {
            if (!it.disabled) return i;
        } else {
            return i; // submenu focusable
        }
    }
    return -1;
}

function nextEnabledIndex(items: ActionMenuItem[], from: number): number {
    const n = items.length;
    for (let i = 1; i <= n; i++) {
        const idx = (from + i) % n;
        const it = items[idx];
        if (isActionMenuSeparator(it)) continue;
        if (isActionMenuAction(it)) {
            if (!it.disabled) return idx;
        } else {
            return idx; // submenu is focusable
        }
    }
    return -1;
}

function prevEnabledIndex(items: ActionMenuItem[], from: number): number {
    const n = items.length;
    for (let i = 1; i <= n; i++) {
        const idx = (from - i + n) % n;
        const it = items[idx];
        if (isActionMenuSeparator(it)) continue;
        if (isActionMenuAction(it)) {
            if (!it.disabled) return idx;
        } else {
            return idx;
        }
    }
    return -1;
}

function replaceIndex(path: number[], level: number, value: number): number[] {
    const next = path.slice();
    next[level] = value;
    return next;
}

function getItemsAtPath(root: ActionMenuItem[], parentPath: number[], focusContext: FocusContext | null = null): ActionMenuItem[] {
    let items: ActionMenuItem[] = root;
    for (const idx of parentPath) {
        const node = items[idx];
        if (!node || isActionMenuAction(node) || isActionMenuSeparator(node)) return [];
        // node is assured to be submenu here
        items = getVisibleActionMenuItems((node as any).items, focusContext);
    }
    return items;
}

interface MenuLevelProps {
    level: number;
    items: ActionMenuItem[];
    openPath: number[];
    focusPath: number[];
    setOpenPath: (p: number[]) => void;
    setFocusPath: (p: number[]) => void;
    onActionClick: (a: ActionDefinition) => void;
    hoverOpenTimerRef: React.MutableRefObject<number | null>;
    hoverCloseTimerRef: React.MutableRefObject<number | null>;
    focusContext: FocusContext | null;
    /** Resolves the chord printed at the right of a row; see `useShortcutLabels`. */
    shortcuts: ShortcutLabels;
    /**
     * Hover text for the items this menu has turned off wholesale - the frozen workspace's reason.
     * Set only when the freeze is the cause, so a row disabled by its own registration is not given
     * an explanation that would be wrong.
     *
     * A submenu may override it for its own rows (`ActionSubmenu.disabledReason`), which is how the
     * hamburger main menu holds several groups at once and still answers for each of them.
     */
    disabledTitle?: string;
}

function MenuLevel(props: MenuLevelProps) {
    const { t } = useTranslation();
    const { level, items, openPath, focusPath, setOpenPath, setFocusPath, onActionClick, hoverOpenTimerRef, hoverCloseTimerRef, focusContext, shortcuts, disabledTitle } = props;
    const parentPath = focusPath.slice(0, level);
    const focusedIndex = focusPath[level] ?? -1;

    return (
        <div className="relative">
            <div role="menu" aria-level={level + 1}>
                {items.map((item, index) => {
                    if (isActionMenuSeparator(item)) {
                        return (
                            <div key={`sep-${index}`} className="h-px bg-fill-strong my-1 mx-2" />
                        );
                    }
                    const isFocused = focusedIndex === index;
                    const isSubmenu = !isActionMenuAction(item);
                    const isOpened = openPath[level] === index && openPath.length === level + 1;
                    const isDisabled = isActionMenuAction(item)
                        ? !!item.disabled
                        : getVisibleActionMenuItems(item.items, focusContext).length === 0;
                    // What an author would press instead of opening this menu - the rebinding they
                    // made included, which is why it is resolved rather than read off the item.
                    const shortcut = isActionMenuAction(item) ? shortcuts.forMenuItem(item) : undefined;

                    const onMouseEnter = () => {
                        if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
                        if (isSubmenu) {
                            if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
                            hoverOpenTimerRef.current = window.setTimeout(() => {
                                const visible = getVisibleActionMenuItems(item.items, focusContext);
                                if (visible.length > 0) {
                                    setOpenPath([...parentPath, index]);
                                    // do not change focus unless keyboard navigates
                                }
                            }, 150);
                        } else {
                            setOpenPath(parentPath); // keep only parents open
                        }
                        // update focus to hovered item directly
                        setFocusPath([...parentPath, index]);
                    };

                    const onMouseLeave = () => {
                        if (isSubmenu) {
                            if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
                            hoverCloseTimerRef.current = window.setTimeout(() => {
                                // close only if not focused via keyboard
                                setOpenPath(parentPath);
                            }, 250);
                        }
                    };

                    return (
                        <div key={item.id}
                            className={`w-full px-3 py-2 text-sm flex items-center justify-between cursor-default ${
                                isDisabled ? "text-fg-subtle cursor-not-allowed" : isFocused ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"
                            }`}
                            role="menuitem"
                            data-tip={isDisabled ? disabledTitle : undefined}
                            aria-disabled={isDisabled || undefined}
                            aria-haspopup={isSubmenu || undefined}
                            aria-expanded={isSubmenu ? isOpened : undefined}
                            tabIndex={-1}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            onClick={() => {
                                if (isDisabled) return;
                                if (isActionMenuAction(item)) {
                                    onActionClick(item);
                                } else {
                                    const visible = getVisibleActionMenuItems(item.items, focusContext);
                                    if (visible.length > 0) {
                                        setOpenPath([...parentPath, index]);
                                        const first = firstEnabledIndex(visible);
                                        if (first !== -1) setFocusPath([...parentPath, index, first]);
                                    }
                                }
                            }}
                        >
                            <span className="flex items-center gap-2">
                                {isActionMenuAction(item) ? null : (item.icon ? <span className="w-4 h-4">{item.icon}</span> : null)}
                                {/* A toggle keeps its checkmark column even while unchecked, so
                                    the labels in a group of toggles stay on one line. */}
                                {isActionMenuAction(item) && item.checked !== undefined ? (
                                    <span className="w-3 flex-none">
                                        {item.checked ? <Check className="w-3 h-3" /> : null}
                                    </span>
                                ) : null}
                                <span>{String(item.labelKey ? t(item.labelKey) : item.label)}</span>
                            </span>
                            {/* Right side: shortcut + badge/chevron */}
                            <span className="flex items-center gap-2">
                                <MenuShortcut of={shortcut} />
                                {isActionMenuAction(item) ? (
                                    item.badge ? (
                                        <span className="bg-danger text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{item.badge}</span>
                                    ) : null
                                ) : (
                                    <ChevronRight className="w-3 h-3 opacity-80" />
                                )}
                            </span>
                            {!isActionMenuAction(item) && isOpened && (
                                <div className="absolute top-0 left-full ml-1 z-20 min-w-56 bg-surface-overlay border border-edge-strong rounded-md shadow-lg py-1">
                                    <MenuLevel
                                        level={level + 1}
                                        items={getVisibleActionMenuItems(item.items, focusContext)}
                                        openPath={openPath}
                                        focusPath={focusPath}
                                        setOpenPath={setOpenPath}
                                        setFocusPath={setFocusPath}
                                        onActionClick={onActionClick}
                                        hoverOpenTimerRef={hoverOpenTimerRef}
                                        hoverCloseTimerRef={hoverCloseTimerRef}
                                        focusContext={focusContext}
                                        shortcuts={shortcuts}
                                        disabledTitle={item.disabledReason ?? disabledTitle}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
