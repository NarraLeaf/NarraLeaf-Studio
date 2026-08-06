import React, { useState, useEffect, useRef, ReactNode, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";

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
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
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
            document.addEventListener('mousedown', handleClickOutside, true);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside, true);
        };
    }, [visible, onClose]);

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
            if (enabledItems.length === 0) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    onClose();
                }
                return;
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
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [visible, focusedIndex, items, onClose]);

    if (!visible) return null;

    const enabledItems = items.filter(
        item => !('separator' in item && item.separator) && !item.disabled
    );

    const menuContent = (
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
    );

    if (typeof document === "undefined") {
        return menuContent;
    }

    return createPortal(menuContent, document.body);
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
                title={item.tooltip}
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
