import React, { useState, useEffect, useRef, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// Menu item types
export interface ContextMenuItemDef {
    id: string;
    label: string;
    icon?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    submenu?: ContextMenuItemDef[];
    separator?: never;
}

export interface ContextMenuSeparatorDef {
    separator: true;
    id: string;
}

export type ContextMenuDef = (ContextMenuItemDef | ContextMenuSeparatorDef)[];

// ContextMenu Props
export interface ContextMenuProps {
    /** Menu items */
    items: ContextMenuDef;
    /** Position of the menu */
    position: { x: number; y: number };
    /** Callback when menu is closed */
    onClose: () => void;
    /** Whether the menu is visible */
    visible?: boolean;
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
}: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null);

    // Adjust position to keep menu on screen
    useEffect(() => {
        if (!menuRef.current || !visible) return;

        const rect = menuRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let { x, y } = position;

        // Adjust horizontal position
        if (x + rect.width > viewportWidth) {
            x = viewportWidth - rect.width - 8;
        }
        if (x < 0) {
            x = 8;
        }

        // Adjust vertical position
        if (y + rect.height > viewportHeight) {
            y = viewportHeight - rect.height - 8;
        }
        if (y < 0) {
            y = 8;
        }

        setAdjustedPosition({ x, y });
    }, [position, visible]);

    // Close on click outside
    useEffect(() => {
        if (!visible) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        // Delay to prevent immediate closure from the opening click
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [visible, onClose]);

    // Keyboard navigation
    useEffect(() => {
        if (!visible) return;

        const enabledItems = items.filter(
            item => !('separator' in item && item.separator) && !item.disabled
        );

        const handleKeyDown = (e: KeyboardEvent) => {
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

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-48 bg-[#1e1f22] border border-white/10 rounded-md shadow-lg py-1"
            style={{
                left: `${adjustedPosition.x}px`,
                top: `${adjustedPosition.y}px`,
            }}
        >
            {items.map((item, index) => {
                if ('separator' in item && item.separator) {
                    return <ContextMenuSeparator key={item.id} />;
                }

                const menuItem = item as ContextMenuItemDef;
                const isFocused = focusedIndex === items.filter(i => !('separator' in i && i.separator) && !i.disabled).indexOf(menuItem);
                const isOpen = openSubmenuIndex === index;

                return (
                    <ContextMenuItem
                        key={menuItem.id}
                        item={menuItem}
                        isFocused={isFocused}
                        onClose={onClose}
                        isSubmenuOpen={isOpen}
                        onSubmenuToggle={() => setOpenSubmenuIndex(isOpen ? null : index)}
                    />
                );
            })}
        </div>
    );
}

// ContextMenuItem component
interface ContextMenuItemProps {
    item: ContextMenuItemDef;
    isFocused: boolean;
    onClose: () => void;
    isSubmenuOpen: boolean;
    onSubmenuToggle: () => void;
}

function ContextMenuItem({
    item,
    isFocused,
    onClose,
    isSubmenuOpen,
    onSubmenuToggle,
}: ContextMenuItemProps) {
    const itemRef = useRef<HTMLDivElement>(null);
    const [submenuPosition, setSubmenuPosition] = useState({ x: 0, y: 0 });

    const hasSubmenu = item.submenu && item.submenu.length > 0;

    // Calculate submenu position
    useEffect(() => {
        if (isSubmenuOpen && itemRef.current) {
            const rect = itemRef.current.getBoundingClientRect();
            setSubmenuPosition({
                x: rect.right,
                y: rect.top,
            });
        }
    }, [isSubmenuOpen]);

    const handleClick = () => {
        if (item.disabled) return;

        if (hasSubmenu) {
            onSubmenuToggle();
        } else {
            item.onClick?.();
            onClose();
        }
    };

    const handleMouseEnter = () => {
        if (hasSubmenu && !item.disabled) {
            onSubmenuToggle();
        }
    };

    return (
        <>
            <div
                ref={itemRef}
                className={`
                    px-3 py-1.5 flex items-center gap-2 text-sm cursor-default
                    transition-colors duration-150
                    ${item.disabled
                        ? 'opacity-50 cursor-not-allowed'
                        : isFocused
                        ? 'bg-blue-500/20 text-white'
                        : 'text-gray-300 hover:bg-white/10 hover:text-white'
                    }
                `}
                onClick={handleClick}
                onMouseEnter={handleMouseEnter}
            >
                {/* Icon */}
                {item.icon && (
                    <span className="w-4 h-4 flex-shrink-0">
                        {item.icon}
                    </span>
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
                />
            )}
        </>
    );
}

// ContextMenuSeparator component
export function ContextMenuSeparator() {
    return <div className="my-1 border-t border-white/10" />;
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

