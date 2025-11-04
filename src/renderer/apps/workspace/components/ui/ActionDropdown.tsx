import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ActionDefinition, ActionGroup, ActionMenuItem } from "../../registry/types";

interface ActionDropdownProps {
    group: ActionGroup;
}

/**
 * Action dropdown component for grouped actions
 */
export function ActionDropdown({ group }: ActionDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [openPath, setOpenPath] = useState<number[]>([]); // path of opened submenus
    const [focusPath, setFocusPath] = useState<number[]>([]); // path of focused item
    const dropdownRef = useRef<HTMLDivElement>(null);
    const rootMenuRef = useRef<HTMLDivElement>(null);
    const hoverOpenTimerRef = useRef<number | null>(null);
    const hoverCloseTimerRef = useRef<number | null>(null);

    // Normalize items: prefer hierarchical `items`, fallback to flat `actions`
    const rootItems: ActionMenuItem[] = useMemo(() => {
        const items = (group.items ?? group.actions) as ActionMenuItem[];
        return (items || []).slice().filter((item) => {
            if (isAction(item)) {
                return item.visible !== false;
            }
            // submenu visible if it has any visible children
            return getVisibleItems(item.items).length > 0;
        }).sort(byOrder);
    }, [group]);

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

    const toggleDropdown = () => {
        setIsOpen((v) => !v);
    };

    const handleActionClick = (action: ActionDefinition) => {
        if (!action.disabled) {
            action.onClick();
            setIsOpen(false);
        }
    };

    const handleGlobalKeyDown = (event: React.KeyboardEvent) => {
        if (!isOpen) return;
        if (event.key === "Escape") {
            // Close current submenu or whole menu
            if (openPath.length > 0) {
                setOpenPath(openPath.slice(0, -1));
                setFocusPath(focusPath.slice(0, -1));
            } else {
                setIsOpen(false);
            }
            event.preventDefault();
            return;
        }

        const { key } = event;
        if (!focusPath.length) return;

        const level = focusPath.length - 1;
        const itemsAtLevel = getItemsAtPath(rootItems, focusPath.slice(0, -1));
        const focusedIndex = focusPath[level];
        const focusedItem = itemsAtLevel[focusedIndex];

        if (key === "ArrowDown" || key === "Down") {
            const next = nextEnabledIndex(itemsAtLevel, focusedIndex);
            if (next !== -1) setFocusPath(replaceIndex(focusPath, level, next));
            event.preventDefault();
        } else if (key === "ArrowUp" || key === "Up") {
            const prev = prevEnabledIndex(itemsAtLevel, focusedIndex);
            if (prev !== -1) setFocusPath(replaceIndex(focusPath, level, prev));
            event.preventDefault();
        } else if (key === "ArrowRight" || key === "Right") {
            if (!isAction(focusedItem)) {
                // open submenu and focus first item
                const visible = getVisibleItems(focusedItem.items);
                if (visible.length > 0) {
                    setOpenPath(focusPath);
                    const first = firstEnabledIndex(visible);
                    if (first !== -1) setFocusPath([...focusPath, first]);
                }
            }
            event.preventDefault();
        } else if (key === "ArrowLeft" || key === "Left") {
            if (openPath.length > 0) {
                setOpenPath(openPath.slice(0, -1));
                setFocusPath(focusPath.slice(0, -1));
            } else {
                setIsOpen(false);
            }
            event.preventDefault();
        } else if (key === "Enter" || key === " ") {
            if (isAction(focusedItem) && !focusedItem.disabled) {
                handleActionClick(focusedItem);
            } else if (!isAction(focusedItem)) {
                const visible = getVisibleItems(focusedItem.items);
                if (visible.length > 0) {
                    setOpenPath(focusPath);
                    const first = firstEnabledIndex(visible);
                    if (first !== -1) setFocusPath([...focusPath, first]);
                }
            }
            event.preventDefault();
        }
    };

    if (rootItems.length === 0) {
        return null;
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={toggleDropdown}
                onKeyDown={(e) => {
                    if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !isOpen) {
                        setIsOpen(true);
                        e.preventDefault();
                    }
                }}
                className="h-8 px-2 rounded-md flex items-center gap-2 text-sm transition-colors cursor-default text-gray-300 hover:bg-white/10 hover:text-white"
                title={group.label}
                aria-label={group.label}
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                {group.icon && <span className="w-4 h-4">{group.icon}</span>}
                <span>{group.label}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Root menu */}
                    <div
                        ref={rootMenuRef}
                        className="absolute top-full left-0 mt-1 z-20 min-w-48 bg-[#1a1a1a] border border-white/20 rounded-md shadow-lg py-1"
                        role="menu"
                        aria-label={group.label}
                        tabIndex={0}
                        onKeyDown={handleGlobalKeyDown}
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
                        />
                    </div>
                </>
            )}
        </div>
    );
}

function isAction(item: ActionMenuItem): item is ActionDefinition {
    return (item as ActionDefinition).onClick !== undefined;
}

function byOrder(a: { order?: number }, b: { order?: number }) {
    const ao = a.order ?? 0;
    const bo = b.order ?? 0;
    return ao - bo;
}

function getVisibleItems(items: ActionMenuItem[]): ActionMenuItem[] {
    return (items || []).filter((i) => {
        if (isAction(i)) return i.visible !== false;
        return getVisibleItems(i.items).length > 0;
    }).sort(byOrder);
}

function firstEnabledIndex(items: ActionMenuItem[]): number {
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (isAction(it)) {
            if (!it.disabled) return i;
        } else {
            return i; // submenu is focusable
        }
    }
    return -1;
}

function nextEnabledIndex(items: ActionMenuItem[], from: number): number {
    const n = items.length;
    for (let i = 1; i <= n; i++) {
        const idx = (from + i) % n;
        const it = items[idx];
        if (isAction(it)) {
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
        if (isAction(it)) {
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

function getItemsAtPath(root: ActionMenuItem[], parentPath: number[]): ActionMenuItem[] {
    let items = root;
    for (const idx of parentPath) {
        const node = items[idx];
        if (!node || isAction(node)) return [];
        items = getVisibleItems(node.items);
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
}

function MenuLevel(props: MenuLevelProps) {
    const { level, items, openPath, focusPath, setOpenPath, setFocusPath, onActionClick, hoverOpenTimerRef, hoverCloseTimerRef } = props;
    const parentPath = focusPath.slice(0, level);
    const focusedIndex = focusPath[level] ?? -1;

    return (
        <div className="relative">
            <div role="menu" aria-level={level + 1}>
                {items.map((item, index) => {
                    const isFocused = focusedIndex === index;
                    const isSubmenu = !isAction(item);
                    const isOpened = openPath[level] === index && openPath.length === level + 1;
                    const isDisabled = isAction(item) ? !!item.disabled : getVisibleItems(item.items).length === 0;

                    const onMouseEnter = () => {
                        if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
                        if (isSubmenu) {
                            if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
                            hoverOpenTimerRef.current = window.setTimeout(() => {
                                const visible = getVisibleItems(item.items);
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
                        <div key={(isAction(item) ? item.id : item.id)}
                            className={`w-full px-3 py-2 text-sm flex items-center justify-between cursor-default ${
                                isDisabled ? "text-gray-500 cursor-not-allowed" : isFocused ? "bg-white/10 text-white" : "text-gray-300 hover:bg-white/10 hover:text-white"
                            }`}
                            role="menuitem"
                            aria-disabled={isDisabled || undefined}
                            aria-haspopup={isSubmenu || undefined}
                            aria-expanded={isSubmenu ? isOpened : undefined}
                            tabIndex={-1}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            onClick={() => {
                                if (isDisabled) return;
                                if (isAction(item)) {
                                    onActionClick(item);
                                } else {
                                    const visible = getVisibleItems(item.items);
                                    if (visible.length > 0) {
                                        setOpenPath([...parentPath, index]);
                                        const first = firstEnabledIndex(visible);
                                        if (first !== -1) setFocusPath([...parentPath, index, first]);
                                    }
                                }
                            }}
                        >
                            <span className="flex items-center gap-2">
                                {isAction(item) ? null : (item.icon ? <span className="w-4 h-4">{item.icon}</span> : null)}
                                <span>{isAction(item) ? item.label : item.label}</span>
                            </span>
                            {isAction(item) ? (
                                item.badge ? (
                                    <span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{item.badge}</span>
                                ) : null
                            ) : (
                                <ChevronRight className="w-3 h-3 opacity-80" />
                            )}
                            {!isAction(item) && isOpened && (
                                <div className="absolute top-0 left-full ml-1 z-20 min-w-48 bg-[#1a1a1a] border border-white/20 rounded-md shadow-lg py-1">
                                    <MenuLevel
                                        level={level + 1}
                                        items={getVisibleItems(item.items)}
                                        openPath={openPath}
                                        focusPath={focusPath}
                                        setOpenPath={setOpenPath}
                                        setFocusPath={setFocusPath}
                                        onActionClick={onActionClick}
                                        hoverOpenTimerRef={hoverOpenTimerRef}
                                        hoverCloseTimerRef={hoverCloseTimerRef}
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
