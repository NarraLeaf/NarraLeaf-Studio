import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
    isActionMenuSubmenu,
    isRowOnOpenPath,
} from "./actionMenuModel";
import { applyFreezeToActionMenuItems, isFreezeExemptActionGroup } from "./freezeActionPolicy";
import { MnemonicLabel, useMnemonicReveal, useTitleBarMenu } from "./titleBarMenus";
import { MenuShortcut } from "./MenuShortcut";
import { useWorkspaceFreezeReason } from "../../hooks/useWorkspaceFrozen";
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
    const freeze = useWorkspaceFreezeReason();
    const frozenOut = freeze !== null && !preFrozen && !isFreezeExemptActionGroup(group.id);
    const groupLabel = group.labelKey ? t(group.labelKey) : group.label;
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
            freeze,
        );
    }, [group, focusContext, frozenOut, freeze]);

    /**
     * Accelerators this menu answers to on behalf of rows that are themselves menus.
     *
     * Empty for every menu on the bar, whose rows are commands. The hamburger is what this is for:
     * its rows are the groups that used to have buttons, and an author who has always pressed Alt+F
     * should not have to learn that the letter moved when the bar was collapsed.
     */
    const innerMnemonics = useMemo(
        () => rootItems.flatMap(item => (isActionMenuSubmenu(item) && item.mnemonic ? [item.mnemonic] : [])),
        [rootItems],
    );
    // Which of them was pressed, parked until the effect below can act on it - that is what decides
    // where the menu opens, and it runs after the bar has switched the open menu over to this one.
    //
    // The letter is a ref and the count beside it is state, and it has to be both ways round. A
    // second accelerator arriving while this menu is ALREADY open changes nothing the bar holds -
    // same member, still open - so without something of its own to change, the effect would never
    // run again and Alt+E after Alt+F would sit on the File menu. Consuming the letter then clears
    // the ref alone, which costs no render: clearing state instead would re-run the effect with
    // nothing pending and throw the focus back to the first row.
    const pendingMnemonicRef = useRef<string | null>(null);
    const [mnemonicRequests, setMnemonicRequests] = useState(0);
    // Whether this open has already been placed on a row. The rows are rebuilt whenever anything
    // registers - the history menu re-registers on every undo and every focus change - and placing
    // the menu again on that would throw the focus back to the first row while the pointer is three
    // rows down inside a submenu, taking the submenu with it.
    const placedRef = useRef(false);
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
        innerMnemonics,
        onInnerMnemonic: mnemonic => {
            pendingMnemonicRef.current = mnemonic;
            setMnemonicRequests(count => count + 1);
        },
        onKeyDown: event => keyHandlerRef.current(event),
    });
    const revealMnemonic = useMnemonicReveal();
    const shortcuts = useShortcutLabels();

    useEffect(() => {
        if (!isOpen) {
            setOpenPath([]);
            setFocusPath([]);
            placedRef.current = false;
            // The letter is left where it is on purpose. The bar reports it and opens this menu in
            // the same task, so a letter can only ever be waiting for the open that is already on
            // its way - and clearing it here would drop it on the closed render if those two
            // updates were ever to land separately.
            return;
        }
        const requested = pendingMnemonicRef.current;
        pendingMnemonicRef.current = null;
        // Opened by the accelerator of a menu this one is holding: land inside that menu, which is
        // where pressing its own button used to land. Anything else opens on its first row - once.
        const index = requested === null ? -1 : indexOfMnemonic(rootItems, requested);
        if (index >= 0) {
            const item = rootItems[index];
            const inner = isActionMenuSubmenu(item) ? getVisibleActionMenuItems(item.items, focusContext) : [];
            const first = firstEnabledIndex(inner);
            setOpenPath([index]);
            setFocusPath(first >= 0 ? [index, first] : [index]);
        } else if (!placedRef.current) {
            // initialize focus on first enabled item
            const idx = firstEnabledIndex(rootItems);
            setFocusPath(idx >= 0 ? [idx] : []);
        } else {
            // Already placed, and this run is only the rows being rebuilt underneath. Where the
            // author is in the menu is theirs, not this effect's, until the menu closes.
            return;
        }
        placedRef.current = true;
        // focus the root menu container to receive keyboard events
        if (rootMenuRef.current) {
            rootMenuRef.current.focus();
        }
    }, [isOpen, rootItems, focusContext, mnemonicRequests]);

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
                    "rounded-md flex items-center gap-2 text-sm transition-colors cursor-default",
                    iconOnly ? "h-8 w-8 justify-center" : "h-8 px-2",
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
                            path={ROOT_PATH}
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

/**
 * The row whose accelerator is this letter, or -1.
 *
 * Compared case-insensitively for the same reason the bar matches on the physical key: the letter is
 * declared as it is drawn, and what arrives depends on the layout that happens to be active.
 */
function indexOfMnemonic(items: ActionMenuItem[], mnemonic: string): number {
    const letter = mnemonic.toUpperCase();
    return items.findIndex(item => isActionMenuSubmenu(item) && item.mnemonic?.toUpperCase() === letter);
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
    /**
     * The rows this panel hangs from, top down: `[]` for the menu itself, `[2]` for the panel the
     * third row opened, and so on.
     *
     * Handed down rather than read off `focusPath`, which is where it used to come from. The focus
     * follows the pointer, so crossing the rows between a submenu's own row and the submenu moved it
     * - and the submenu's rows, asking the focus where they lived, answered with whichever row had
     * just been crossed. They then closed themselves on behalf of that row. Where a panel hangs from
     * is a fact about the panel; only the caller that rendered it knows it.
     */
    path: number[];
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

/** The menu itself hangs from no row. Held as a constant so it is the same array every render. */
const ROOT_PATH: number[] = [];

/** How long the pointer rests on a row that opens a menu before it opens. */
const HOVER_OPEN_DELAY_MS = 150;

/** Room left between a menu and the edge of the window, matching the context menu's. */
const VIEWPORT_PADDING = 8;

/**
 * A submenu, beside the row that opens it and inside the window.
 *
 * Positioned against the row (which is `relative`) rather than against the panel the row sits in:
 * anchored to the panel, every submenu opened from a menu appeared at the top of it, however far
 * down its own row was. That is the placement itself being wrong, and it made the reach into a
 * submenu a long diagonal back up across every row in between - each of which would close it.
 *
 * It stays a child of the row on purpose. `mouseleave` does not fire when the pointer moves onto a
 * descendant, so the panel is part of the row as far as the hover is concerned, and the dropdown's
 * "a pointer landed outside" watch already counts it as inside.
 *
 * What CSS cannot do is keep it on screen, so the offsets are measured: a panel whose rows run past
 * the bottom of the window is lifted until they do not, and one with no room to its right opens to
 * the left of the row instead. Measured in a layout effect, before the frame is painted, so the
 * panel is never seen in the place it was going to be.
 */
function SubmenuPanel({ children }: { children: React.ReactNode }) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<{ shiftY: number; toLeft: boolean }>({ shiftY: 0, toLeft: false });

    useLayoutEffect(() => {
        const panel = panelRef.current;
        const row = panel?.parentElement;
        if (!panel || !row) return;

        // Measured from where the panel would sit with no adjustment at all, so the answer does not
        // depend on the answer this effect gave last time.
        const rowRect = row.getBoundingClientRect();
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const spaceRight = viewportWidth - rowRect.right - VIEWPORT_PADDING;
        const spaceLeft = rowRect.left - VIEWPORT_PADDING;
        const toLeft = spaceRight < width && spaceLeft >= width;

        const overflowBottom = rowRect.top + height - (viewportHeight - VIEWPORT_PADDING);
        // Never lifted past the top of the window: a menu that runs off both ends is scrolled to
        // from the keyboard, and pushing its first row out of sight would lose more than it saves.
        const shiftY = overflowBottom > 0 ? -Math.min(overflowBottom, rowRect.top - VIEWPORT_PADDING) : 0;

        setPlacement(previous => (
            previous.shiftY === shiftY && previous.toLeft === toLeft ? previous : { shiftY, toLeft }
        ));
    }, [children]);

    return (
        <div
            ref={panelRef}
            className={cn(
                "absolute top-0 z-20 min-w-56 bg-surface-overlay border border-edge-strong rounded-md shadow-lg py-1",
                placement.toLeft ? "right-full mr-1" : "left-full ml-1",
            )}
            style={placement.shiftY === 0 ? undefined : { transform: `translateY(${placement.shiftY}px)` }}
        >
            {children}
        </div>
    );
}

/**
 * How long an open submenu survives the pointer being somewhere else.
 *
 * The reach into a submenu is a diagonal across the rows below its own, and across the gap between
 * the two panels; every one of those is "somewhere else" for a moment, and a menu that gives up on
 * the first of them is taken away mid-reach. Windows waits about this long before a menu bar acts
 * on a hover at all, which is the same judgement about the same gesture.
 *
 * It costs nothing when the author means to move on: a row that opens a menu of its own clears this
 * and opens after {@link HOVER_OPEN_DELAY_MS} instead, and a click acts at once either way.
 */
const HOVER_CLOSE_DELAY_MS = 400;

function MenuLevel(props: MenuLevelProps) {
    const { t } = useTranslation();
    const revealMnemonic = useMnemonicReveal();
    const { path, items, openPath, focusPath, setOpenPath, setFocusPath, onActionClick, hoverOpenTimerRef, hoverCloseTimerRef, focusContext, shortcuts, disabledTitle } = props;
    const parentPath = path;
    const level = path.length;
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
                    const isOpened = isRowOnOpenPath(openPath, level, index);
                    const isDisabled = isActionMenuAction(item)
                        ? !!item.disabled
                        : getVisibleActionMenuItems(item.items, focusContext).length === 0;
                    // What an author would press instead of opening this menu - the rebinding they
                    // made included, which is why it is resolved rather than read off the item.
                    const shortcut = isActionMenuAction(item) ? shortcuts.forMenuItem(item) : undefined;

                    const onMouseEnter = () => {
                        if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
                        if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
                        if (isSubmenu) {
                            hoverOpenTimerRef.current = window.setTimeout(() => {
                                const visible = getVisibleActionMenuItems(item.items, focusContext);
                                if (visible.length > 0) {
                                    setOpenPath([...parentPath, index]);
                                    // do not change focus unless keyboard navigates
                                }
                            }, HOVER_OPEN_DELAY_MS);
                        } else {
                            // Keep only parents open - but not this instant. Crossing the rows
                            // between a submenu's own row and the submenu is how a pointer gets
                            // there, and closing on the first one it passes over takes the menu away
                            // mid-reach. Whatever it lands on clears this timer on the way in.
                            hoverCloseTimerRef.current = window.setTimeout(() => {
                                setOpenPath(parentPath);
                            }, HOVER_CLOSE_DELAY_MS);
                        }
                        // update focus to hovered item directly
                        setFocusPath([...parentPath, index]);
                    };

                    const onMouseLeave = () => {
                        if (isSubmenu) {
                            // The open this row asked for dies with the pointer leaving it. Left to
                            // run, a row merely crossed on the way somewhere else opens its own menu
                            // a moment later and takes away the one being reached for - which is
                            // exactly as often as the timer happens to win the race, and no more.
                            if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
                            if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
                            hoverCloseTimerRef.current = window.setTimeout(() => {
                                // close only if not focused via keyboard
                                setOpenPath(parentPath);
                            }, HOVER_CLOSE_DELAY_MS);
                        }
                    };

                    return (
                        <div key={item.id}
                            // `relative`, so the submenu below anchors to THIS row rather than to
                            // the panel around it - a menu opens beside the row it belongs to.
                            className={`relative w-full px-3 py-2 text-sm flex items-center justify-between cursor-default ${
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
                                {/* A row that is itself a menu can carry the accelerator that menu
                                    had as a button on the bar - the hamburger's rows do. The hint
                                    belongs on the row because that is where the menu now is. */}
                                <span>
                                    <MnemonicLabel
                                        label={String(item.labelKey ? t(item.labelKey) : item.label)}
                                        mnemonic={isActionMenuSubmenu(item) ? item.mnemonic : undefined}
                                        reveal={revealMnemonic}
                                    />
                                </span>
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
                                <SubmenuPanel>
                                    <MenuLevel
                                        path={[...path, index]}
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
                                </SubmenuPanel>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
