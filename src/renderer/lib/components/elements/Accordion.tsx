import React, { useState, useEffect, useRef, createContext, useContext, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// Accordion context for managing state
interface AccordionContextValue {
    openItems: Set<string>;
    toggleItem: (id: string) => void;
    focusedItemId: string | null;
    setFocusedItem: (id: string | null) => void;
    isActive: boolean; // Whether the accordion is currently focused/active
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordionContext() {
    const context = useContext(AccordionContext);
    if (!context) {
        throw new Error("Accordion components must be used within an Accordion");
    }
    return context;
}

// 新增：Nested toggle notification context
interface AccordionNestedContextValue {
    notifyNestedToggle: () => void;
}

const AccordionNestedContext = createContext<AccordionNestedContextValue | null>(null);

// Accordion Props
export interface AccordionProps {
    children: ReactNode;
    /** Default open item IDs */
    defaultOpen?: string[];
    /** Controlled open items */
    openItems?: string[];
    /** Callback when open items change */
    onOpenChange?: (openItems: string[]) => void;
    /** Callback when an item receives focus */
    onItemFocus?: (itemId: string | null) => void;
    /** Whether the accordion is active (responds to keyboard) */
    isActive?: boolean;
    /** Allow multiple items to be open */
    multiple?: boolean;
    className?: string;
}

/**
 * Accordion container component
 * Manages expansion/collapse state and focus state
 */
export function Accordion({
    children,
    defaultOpen = [],
    openItems: controlledOpenItems,
    onOpenChange,
    onItemFocus,
    isActive = true,
    multiple = true,
    className = "",
}: AccordionProps) {
    const [internalOpenItems, setInternalOpenItems] = useState<Set<string>>(
        new Set(defaultOpen)
    );
    const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Determine if we're in controlled mode
    const isControlled = controlledOpenItems !== undefined;
    const openItems = isControlled
        ? new Set(controlledOpenItems)
        : internalOpenItems;

    const toggleItem = (id: string) => {
        const newOpenItems = new Set(openItems);

        if (newOpenItems.has(id)) {
            newOpenItems.delete(id);
        } else {
            if (!multiple) {
                newOpenItems.clear();
            }
            newOpenItems.add(id);
        }

        if (isControlled) {
            onOpenChange?.(Array.from(newOpenItems));
        } else {
            setInternalOpenItems(newOpenItems);
        }
    };

    const handleSetFocusedItem = (id: string | null) => {
        setFocusedItemId(id);
        onItemFocus?.(id);
    };

    // Keyboard navigation
    useEffect(() => {
        if (!isActive || !containerRef.current) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Get all accordion items
            const items = containerRef.current?.querySelectorAll('[data-accordion-item]');
            if (!items || items.length === 0) return;

            const itemIds = Array.from(items).map(item => item.getAttribute('data-accordion-item')!);
            const currentIndex = focusedItemId ? itemIds.indexOf(focusedItemId) : -1;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    const nextIndex = (currentIndex + 1) % itemIds.length;
                    handleSetFocusedItem(itemIds[nextIndex]);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    const prevIndex = currentIndex <= 0 ? itemIds.length - 1 : currentIndex - 1;
                    handleSetFocusedItem(itemIds[prevIndex]);
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    if (focusedItemId) {
                        toggleItem(focusedItemId);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, focusedItemId, openItems, multiple]);

    return (
        <AccordionContext.Provider
            value={{
                openItems,
                toggleItem,
                focusedItemId,
                setFocusedItem: handleSetFocusedItem,
                isActive,
            }}
        >
            <div ref={containerRef} className={`${className}`}>
                {children}
            </div>
        </AccordionContext.Provider>
    );
}

// AccordionItem Props
export interface AccordionItemProps {
    id: string;
    /** Header content */
    title: ReactNode;
    /** Body content */
    children: ReactNode;
    /** Icon to show (defaults to ChevronRight) */
    icon?: ReactNode;
    /** Disable this item */
    disabled?: boolean;
    /** Whether this item can receive focus */
    focusable?: boolean;
    /** Additional className for the item */
    className?: string;
    /** Additional className for the header */
    headerClassName?: string;
    /** Additional className for the content */
    contentClassName?: string;
    /** Level for nested indentation */
    level?: number;
}

/**
 * Accordion item component
 * Individual collapsible section
 */
export function AccordionItem({
    id,
    title,
    children,
    icon,
    disabled = false,
    focusable = true,
    className = "",
    headerClassName = "",
    contentClassName = "",
    level = 0,
}: AccordionItemProps) {
    const context = useAccordionContext();
    const { openItems, toggleItem, focusedItemId, setFocusedItem } = context;
    const isActive = context.isActive ?? true;
    const isOpen = openItems.has(id);
    const isFocused = focusedItemId === id;
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState<number>(0);

    // Nested toggle notification
    const parentNestedContext = useContext(AccordionNestedContext);

    const notifyNestedToggle = () => {
        // Use rAF to measure after DOM updates for more accurate height
        requestAnimationFrame(() => {
            if (contentRef.current) {
                setContentHeight(contentRef.current.scrollHeight);
            }
            // Propagate notification to higher levels after own measurement
            parentNestedContext?.notifyNestedToggle();
        });
    };

    // Measure content height for animation
    useEffect(() => {
        if (contentRef.current) {
            setContentHeight(contentRef.current.scrollHeight);
        }
    }, [children, isOpen]);

    // Auto-update height when descendants resize (e.g., nested accordions toggled)
    useEffect(() => {
        const el = contentRef.current;
        if (!el) return;

        // Some environments may not support ResizeObserver; guard just in case
        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            setContentHeight(el.scrollHeight);
            // Notify ancestors because our height changed
            parentNestedContext?.notifyNestedToggle();
        });
        observer.observe(el);

        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Notify ancestors when this item's open state changes
    useEffect(() => {
        parentNestedContext?.notifyNestedToggle();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleClick = () => {
        if (disabled) return;
        toggleItem(id);
        if (focusable) {
            setFocusedItem(id);
        }
        // Inform ancestors to recompute height after toggle
        notifyNestedToggle();
    };

    const handleMouseEnter = () => {
        // Only set focus on mouse enter if accordion is not active and item is focusable
        // This prevents conflicts with parent components that manage their own focus
        if (!disabled && !isActive && focusable) {
            setFocusedItem(id);
        }
    };

    const indentation = level * 12; // 12px per level

    return (
        <AccordionNestedContext.Provider value={{ notifyNestedToggle }}>
            <div
                className={`border-b border-white/10 ${className}`}
                data-accordion-item={id}
            >
                {/* Header */}
                <button
                    onClick={handleClick}
                    onMouseEnter={handleMouseEnter}
                    disabled={disabled}
                    className={`
                    w-full flex items-center gap-2 px-3 py-2 text-left
                    transition-colors duration-200
                    ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-default hover:bg-white/10'}
                    ${isFocused && !disabled && focusable ? 'bg-primary/20' : ''}
                    ${headerClassName}
                `}
                    style={{ paddingLeft: `${12 + indentation}px` }}
                >
                    {/* Expand/collapse icon */}
                    <ChevronRight
                        className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'transform rotate-90' : ''
                            }`}
                    />

                    {/* Custom icon (optional) */}
                    {icon && <span className="w-4 h-4 flex-shrink-0">{icon}</span>}

                    {/* Title */}
                    <span className="flex-1 text-sm text-gray-300">{title}</span>
                </button>

                {/* Content */}
                <div
                    style={{
                        height: isOpen ? `${contentHeight}px` : '0px',
                        overflow: 'hidden',
                        transition: 'height 200ms ease-out',
                    }}
                >
                    <div ref={contentRef} className={contentClassName}>
                        {children}
                    </div>
                </div>
            </div>
        </AccordionNestedContext.Provider>
    );
}

// Nested accordion support
export interface NestedAccordionProps extends AccordionProps {
    parentLevel?: number;
}

/**
 * Nested accordion for creating hierarchical structures
 * Automatically inherits active state from parent
 */
export function NestedAccordion({
    parentLevel = 0,
    isActive: providedIsActive,
    ...props
}: NestedAccordionProps) {
    const parentContext = useContext(AccordionContext);
    const isActive = parentContext?.isActive ?? providedIsActive ?? true;

    return (
        <Accordion
            {...props}
            isActive={isActive}
        />
    );
}

