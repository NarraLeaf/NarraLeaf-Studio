import React, { useState, useEffect, useRef, ReactNode, useLayoutEffect, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { useFloatingLayer } from "../layout/floatingLayer";
import { ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";
import { useHostWindow } from "../layout/hostWindow";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";

/**
 * True inside a menu's own subtree, which is where its submenus render.
 *
 * Only a top-level menu takes part in the one-menu rule and the window-level dismissals below; a
 * submenu is part of the menu that opened it and closes through that menu's `onClose`.
 */
const InsideContextMenuContext = createContext(false);

/**
 * The top-level menus currently on screen, as their close functions.
 *
 * A right click is one gesture and gets one menu. Two used to open at the same point whenever a
 * surface that offers a menu sat inside another one that also offers a menu and the inner handler let
 * the event carry on: choosing a row closed only the menu on top, and the one underneath refused every
 * click that landed inside a menu, so it could only be dismissed by clicking somewhere else - which
 * reads as a menu that will not close. Each top-level menu that opens therefore closes whatever other
 * top-level menu is open. Nested handlers still stop the event themselves (see `useContextMenu`), so
 * the menu that opens is the innermost one; this is what keeps the count at one when they do not.
 */
const openTopLevelMenus = new Set<{ close: () => void }>();

/**
 * Marks the document while a top-level menu is open, for the title bar's drag region.
 *
 * A press on a drag region never reaches the page - the operating system takes it to move the
 * window - so the outside-click that closes a menu never happens there, and a menu stayed open over
 * an author clicking the title bar. While a menu is open the region stops being a drag region (see
 * `styles.css`), so that press is an ordinary click outside the menu and closes it, the way a press
 * anywhere outside a native menu does.
 */
const MENU_OPEN_ATTRIBUTE = "data-context-menu-open";

function syncMenuOpenAttribute(doc: Document, open: boolean): void {
    if (open) {
        doc.documentElement.setAttribute(MENU_OPEN_ATTRIBUTE, "");
    } else {
        doc.documentElement.removeAttribute(MENU_OPEN_ATTRIBUTE);
    }
}

// Menu item types
export interface ContextMenuItemDef {
    id: string;
    label: string;
    /** Leading icon; when the menu has `iconsEnabled`, the column is still reserved if this is omitted. */
    icon?: ReactNode;
    disabled?: boolean;
    /**
     * Hover text for the row. Added for the frozen-workspace pass: a greyed row used to carry no reason
     * at all, so the author saw half a menu switched off and nothing saying why. Putting it here rather
     * than in the label keeps a disabled menu a menu instead of a paragraph.
     */
    tooltip?: string;
    onClick?: () => void;
    submenu?: ContextMenuItemDef[];
    /**
     * When this item opens a submenu, sets `iconsEnabled` for that submenu only (not inherited from the parent menu).
     */
    submenuIconsEnabled?: boolean;
    separator?: never;
}

export interface ContextMenuSeparatorDef {
    separator: true;
    id: string;
}

export type ContextMenuDef = (ContextMenuItemDef | ContextMenuSeparatorDef)[];

// ContextMenu Props
export interface ContextMenuAnchorRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
}

export interface ContextMenuProps {
    /** Menu items */
    items: ContextMenuDef;
    /** Position of the menu */
    position: { x: number; y: number };
    /** Callback when menu is closed */
    onClose: () => void;
    /** Whether the menu is visible */
    visible?: boolean;
    /** Optional anchor bounds for aligning related menus */
    anchorRect?: ContextMenuAnchorRect;
    /**
     * When true, every row in this menu reserves a fixed leading slot for `item.icon` so labels align.
     * When false (default), an icon is only rendered if `item.icon` is set (legacy behavior).
     * Does not apply to nested submenus; those use `submenuIconsEnabled` on the item that owns the submenu.
     */
    iconsEnabled?: boolean;
}

/**
 * Context menu component
 * Shows a menu at the specified position
 */
export function ContextMenu({
    items,
    position,
    onClose,
    visible = true,
    anchorRect,
    iconsEnabled = false,
}: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const isSubmenu = useContext(InsideContextMenuContext);
    // A floating layer that leaves focus where it is: a right click in a text field opens this over
    // the field, and Cut, Copy and Paste act on whatever holds focus - so the field keeps it, as it
    // would under a native menu, and the keys are taken from it below instead. Being a layer is what
    // closes the menu when focus moves on (Tab out of the field) and when its kept-alive tab or panel
    // is put away, and what puts it on the stack Escape is decided against.
    useFloatingLayer({
        open: visible && !isSubmenu,
        onClose,
        panelRef: menuRef,
        initialFocus: false,
    });
    /** The window this menu is drawn in - the renderer's own, or a detached editor's. */
    const hostWindow = useHostWindow();
    const doc = hostWindow.document;
    // Read through a ref by the window-level listeners below, which are installed once per opening
    // and must not close over a callback the caller has since replaced.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // One top-level menu at a time; see `openTopLevelMenus`. A layout effect, so the menu it replaces
    // is gone in the same frame this one is first painted in.
    useLayoutEffect(() => {
        if (!visible || isSubmenu) return;
        const entry = { close: () => onCloseRef.current() };
        for (const other of [...openTopLevelMenus]) {
            openTopLevelMenus.delete(other);
            other.close();
        }
        openTopLevelMenus.add(entry);
        syncMenuOpenAttribute(doc, true);
        return () => {
            openTopLevelMenus.delete(entry);
            syncMenuOpenAttribute(doc, openTopLevelMenus.size > 0);
        };
    }, [doc, isSubmenu, visible]);

    // The ways a menu stops being what the author is looking at without a click anywhere: the window
    // losing focus (Alt+Tab, a click in another application - the title-bar menus close the same
    // way), the window changing size, and a wheel turned outside the menu. The menu is pinned to the
    // point it was opened at, so once the content under it has scrolled or the window has reflowed it
    // no longer points at what it is about; the scroll itself goes ahead. A wheel inside a menu scrolls
    // that menu, which is why it is excepted.
    useEffect(() => {
        if (!visible || isSubmenu) return;
        const close = () => onCloseRef.current();
        const onWheel = (event: WheelEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-context-menu="true"]')) return;
            close();
        };
        hostWindow.addEventListener("blur", close);
        hostWindow.addEventListener("resize", close);
        doc.addEventListener("wheel", onWheel, { capture: true, passive: true });
        return () => {
            hostWindow.removeEventListener("blur", close);
            hostWindow.removeEventListener("resize", close);
            doc.removeEventListener("wheel", onWheel, { capture: true });
        };
    }, [doc, hostWindow, isSubmenu, visible]);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    /**
     * The highlighted row, as an index into the *enabled* items. `-1` is "nothing highlighted", which is
     * how a menu opens: it used to open on 0, so the first row wore the highlight until the arrow keys
     * moved it — in a menu that marks its current value with a tick, that reads as a second, contradictory
     * selection. The pointer drives this too (see `onFocus` below), so hovering and arrowing are one state
     * rather than two highlights racing each other.
     */
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null);

    useLayoutEffect(() => {
        if (!visible) {
            setOpenSubmenuIndex(null);
            return;
        }

        setFocusedIndex(-1);
        setOpenSubmenuIndex(null);
        setAdjustedPosition(position);
    }, [visible, position.x, position.y]);

    // Adjust position to keep menu on screen
    useLayoutEffect(() => {
        if (!menuRef.current || !visible) return;

        const rect = menuRef.current.getBoundingClientRect();
        const viewportWidth = hostWindow.innerWidth;
        const viewportHeight = hostWindow.innerHeight;
        let { x, y } = position;
        const padding = 8;

        if (anchorRect) {
            const spaceRight = viewportWidth - anchorRect.right - padding;
            const spaceLeft = anchorRect.left - padding;
            const shouldOpenLeft = spaceRight < rect.width && spaceLeft >= rect.width;
            if (shouldOpenLeft) {
                x = anchorRect.left - rect.width;
            } else if (x + rect.width > viewportWidth - padding) {
                x = viewportWidth - rect.width - padding;
            }
        } else if (x + rect.width > viewportWidth - padding) {
            x = viewportWidth - rect.width - padding;
        }

        if (x < padding) {
            x = padding;
        }

        if (y + rect.height > viewportHeight - padding) {
            y = viewportHeight - rect.height - padding;
        }
        if (y < padding) {
            y = padding;
        }

        setAdjustedPosition(prev => (x !== prev.x || y !== prev.y ? { x, y } : prev));
    }, [position, visible, items, anchorRect]);

    // Close on click outside
    useEffect(() => {
        if (!visible) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            const inAnyMenu = (target as HTMLElement).closest?.('[data-context-menu="true"]');
            if (inAnyMenu) return;
            onClose();
        };

        // Delay to prevent immediate closure from the opening click
        const timer = setTimeout(() => {
            doc.addEventListener('mousedown', handleClickOutside, true);
        }, 0);

        return () => {
            clearTimeout(timer);
            doc.removeEventListener('mousedown', handleClickOutside, true);
        };
    }, [doc, visible, onClose]);

    // Keyboard navigation
    useEffect(() => {
        if (!visible) {
            setOpenSubmenuIndex(null);
            return;
        }

        const enabledItems = items.filter(
            item => !('separator' in item && item.separator) && !item.disabled
        );

        const handleKeyDown = (e: KeyboardEvent) => {
            if (isImeKeyEvent(e)) return;
            // Escape belongs to the top-level menu, and closes all of it.
            if (e.key === 'Escape') {
                if (isSubmenu) return;
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
            }
            // While a submenu is open the keys are its own; this level only takes ArrowLeft back.
            if (openSubmenuIndex !== null) {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenSubmenuIndex(null);
                }
                return;
            }
            if (enabledItems.length === 0) {
                return;
            }
            const handled = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(e.key);
            if (handled) {
                // Focus is still on whatever the menu was opened over, so without this the arrows
                // that walk the menu also move the caret in the field under it, and Enter submits it.
                e.stopPropagation();
            }

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setFocusedIndex(prev => (prev + 1) % enabledItems.length);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setFocusedIndex(prev => prev <= 0 ? enabledItems.length - 1 : prev - 1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    const currentItem = enabledItems[focusedIndex] as ContextMenuItemDef;
                    if (currentItem && currentItem.submenu && currentItem.submenu.length > 0) {
                        const itemIndex = items.indexOf(currentItem);
                        setOpenSubmenuIndex(itemIndex);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    setOpenSubmenuIndex(null);
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    const item = enabledItems[focusedIndex] as ContextMenuItemDef;
                    if (item) {
                        if (item.submenu && item.submenu.length > 0) {
                            const itemIndex = items.indexOf(item);
                            setOpenSubmenuIndex(itemIndex);
                        } else {
                            item.onClick?.();
                            onClose();
                        }
                    }
                    break;
            }
        };

        // Capture: ahead of the field that still holds focus, which would otherwise see every key first.
        doc.addEventListener('keydown', handleKeyDown, true);
        return () => doc.removeEventListener('keydown', handleKeyDown, true);
    }, [doc, visible, focusedIndex, items, onClose, isSubmenu, openSubmenuIndex]);

    if (!visible) return null;

    const enabledItems = items.filter(
        item => !('separator' in item && item.separator) && !item.disabled
    );

    const menuContent = (
        <InsideContextMenuContext.Provider value={true}>
        <div
            ref={menuRef}
            data-context-menu="true"
            className="fixed z-50 min-w-48 bg-surface-raised border border-edge rounded-md shadow-lg py-1"
            style={{
                left: `${adjustedPosition.x}px`,
                top: `${adjustedPosition.y}px`,
                maxHeight: "calc(100vh - 16px)",
                overflowY: "auto",
            }}
            onMouseDown={(e) => e.stopPropagation()}
            /* Leaving the menu drops the highlight, so it never lingers on a row the pointer has left. A
               row whose submenu is open is the exception: the pointer is on its way into that submenu, and
               the parent row has to stay lit to say where the submenu came from. */
            onMouseLeave={() => {
                if (openSubmenuIndex === null) setFocusedIndex(-1);
            }}
        >
            {items.map((item, index) => {
                if ('separator' in item && item.separator) {
                    return <ContextMenuSeparator key={item.id} />;
                }

                const menuItem = item as ContextMenuItemDef;
                const enabledIndex = enabledItems.indexOf(menuItem);
                const isFocused = enabledIndex !== -1 && focusedIndex === enabledIndex;
                const isOpen = openSubmenuIndex === index;

                return (
                    <ContextMenuItem
                        key={menuItem.id}
                        item={menuItem}
                        isFocused={isFocused}
                        onFocus={() => setFocusedIndex(enabledIndex)}
                        onClose={onClose}
                        isSubmenuOpen={isOpen}
                        onSubmenuOpen={() => setOpenSubmenuIndex(index)}
                        onSubmenuClose={() => setOpenSubmenuIndex(null)}
                        iconsEnabled={iconsEnabled}
                    />
                );
            })}
        </div>
        </InsideContextMenuContext.Provider>
    );

    if (typeof document === "undefined") {
        return menuContent;
    }

    // `doc.body`, not `document.body`: a menu raised inside a detached editor window belongs in
    // that window, and a portal into the opener's body would open it on the other screen.
    return createPortal(menuContent, doc.body);
}

// ContextMenuItem component
interface ContextMenuItemProps {
    item: ContextMenuItemDef;
    isFocused: boolean;
    /** Hovering a row moves the menu's highlight onto it, so pointer and keyboard share one focus. */
    onFocus: () => void;
    onClose: () => void;
    isSubmenuOpen: boolean;
    onSubmenuOpen: () => void;
    onSubmenuClose: () => void;
    iconsEnabled: boolean;
}

function ContextMenuItem({
    item,
    isFocused,
    onFocus,
    onClose,
    isSubmenuOpen,
    onSubmenuOpen,
    onSubmenuClose,
    iconsEnabled,
}: ContextMenuItemProps) {
    const itemRef = useRef<HTMLDivElement>(null);
    const [submenuPosition, setSubmenuPosition] = useState({ x: 0, y: 0 });
    const [submenuAnchor, setSubmenuAnchor] = useState<ContextMenuAnchorRect | null>(null);

    const hasSubmenu = item.submenu && item.submenu.length > 0;

    // Calculate submenu position
    useEffect(() => {
        if (isSubmenuOpen && itemRef.current) {
            const rect = itemRef.current.getBoundingClientRect();
            setSubmenuPosition({
                x: rect.right,
                y: rect.top,
            });
            setSubmenuAnchor({
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            });
        } else {
            setSubmenuAnchor(null);
        }
    }, [isSubmenuOpen]);

    const handleClick = () => {
        if (item.disabled) return;

        if (hasSubmenu) {
            if (isSubmenuOpen) {
                onSubmenuClose();
            } else {
                onSubmenuOpen();
            }
        } else {
            item.onClick?.();
            onClose();
        }
    };

    const handleMouseEnter = () => {
        onFocus();
        if (hasSubmenu && !item.disabled) {
            onSubmenuOpen();
        }
    };

    return (
        <>
            <div
                ref={itemRef}
                className={cn(
                    "px-3 py-1.5 flex items-center gap-2 text-sm cursor-default",
                    "transition-colors duration-150",
                    item.disabled
                        ? "opacity-50 cursor-not-allowed text-fg-muted"
                        : isFocused
                        // Highlight and hover are now one state, so they get one look — the neutral fill the
                        // rest of the app's menus use. The old accent-tinted highlight said "chosen", which a
                        // value menu already says with its tick, and the two claims contradicted each other.
                        ? "bg-fill text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg",
                )}
                data-tip={item.tooltip}
                onClick={handleClick}
                onMouseEnter={handleMouseEnter}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Icon column: optional slot; reserved when iconsEnabled */}
                {iconsEnabled ? (
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                        {item.icon ?? null}
                    </span>
                ) : (
                    item.icon ? (
                        <span className="h-4 w-4 flex-shrink-0">{item.icon}</span>
                    ) : null
                )}

                {/* Label */}
                <span className="flex-1">{item.label}</span>

                {/* Submenu indicator */}
                {hasSubmenu && (
                    <ChevronRight className="w-3 h-3 opacity-80" />
                )}
            </div>

            {/* Submenu */}
            {hasSubmenu && isSubmenuOpen && (
                <ContextMenu
                    items={item.submenu!}
                    position={submenuPosition}
                    onClose={onClose}
                    visible={isSubmenuOpen}
                    anchorRect={submenuAnchor ?? undefined}
                    iconsEnabled={item.submenuIconsEnabled ?? false}
                />
            )}
        </>
    );
}

// ContextMenuSeparator component
export function ContextMenuSeparator() {
    return <div className="my-1 border-t border-edge" />;
}

// Hook for managing context menu state
export function useContextMenu() {
    const [menuState, setMenuState] = useState<{
        visible: boolean;
        position: { x: number; y: number };
    }>({
        visible: false,
        position: { x: 0, y: 0 },
    });

    const showMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        // A right click answered here is not offered to the surfaces this one sits inside: the
        // innermost thing with a menu is the one the author pointed at, and an outer handler left
        // running would open a second menu on the same spot - or, sharing this hook's state, replace
        // this menu with its own. Only for the right click itself: a button that opens a menu on a
        // left click is still a click its row may need to hear.
        if (e.type === "contextmenu") {
            e.stopPropagation();
        }
        setMenuState({
            visible: true,
            position: { x: e.clientX, y: e.clientY },
        });
    };

    const hideMenu = () => {
        setMenuState(prev => ({ ...prev, visible: false }));
    };

    return {
        menuState,
        showMenu,
        hideMenu,
    };
}
