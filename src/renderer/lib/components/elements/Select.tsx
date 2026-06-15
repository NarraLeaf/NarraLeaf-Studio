import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "./Button";

export interface SelectOption {
    value: string | number;
    label: string;
    disabled?: boolean;
    icon?: React.ReactNode;
}

export type SelectMenuPlacement = "auto" | "above" | "below";

export interface SelectProps {
    options: SelectOption[];
    value?: string | number;
    onChange?: (value: string | number) => void;
    placeholder?: string;
    disabled?: boolean;
    size?: "sm" | "md" | "lg";
    variant?: "default" | "error" | "success";
    fullWidth?: boolean;
    className?: string;
    multiple?: boolean;
    /** Render the menu in a document.body portal (avoids overflow clipping from ancestors). */
    portalMenu?: boolean;
    /** Where to open the menu; "auto" picks based on viewport space when not portaled, or when portaled. */
    menuPlacement?: SelectMenuPlacement;
}

const sizeStyles = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-2 text-sm",
    lg: "px-4 py-2 text-base",
};

const variantStyles = {
    default: "border-white/20 hover:border-white/30 focus:border-[#40a8c4] focus:ring-1 focus:ring-[#40a8c4]/30 focus:shadow-lg focus:shadow-[#40a8c4]/10",
    error: "border-red-500/50 hover:border-red-400/70 focus:border-red-500 focus:ring-1 focus:ring-red-500/30 focus:shadow-lg focus:shadow-red-500/10",
    success: "border-green-500/50 hover:border-green-400/70 focus:border-green-500 focus:ring-1 focus:ring-green-500/30 focus:shadow-lg focus:shadow-green-500/10",
};

const SELECT_MENU_GAP_PX = 4;
/** Tailwind max-h-60 */
const SELECT_MENU_MAX_HEIGHT_PX = 240;

/**
 * Select dropdown component with VS Code-like styling
 */
export function Select({
    options,
    value,
    onChange,
    placeholder = "Please select...",
    disabled = false,
    size = "md",
    variant = "default",
    fullWidth = false,
    className = "",
    multiple = false,
    portalMenu = false,
    menuPlacement = "auto",
}: SelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const selectRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const [dropdownDirection, setDropdownDirection] = useState<"down" | "up">("down");
    const [portalMenuStyle, setPortalMenuStyle] = useState<React.CSSProperties>({});

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (selectRef.current?.contains(target)) {
                return;
            }
            // Portaled menu is outside the trigger subtree
            if (dropdownRef.current?.contains(target)) {
                return;
            }
            setIsOpen(false);
        };

        document.addEventListener("mousedown", handleClickOutside, true);
        return () => document.removeEventListener("mousedown", handleClickOutside, true);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setDropdownDirection("down");
            setPortalMenuStyle({});
        }
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen || portalMenu || menuPlacement !== "auto") {
            return;
        }

        const updateDirection = () => {
            if (!selectRef.current || !dropdownRef.current) return;
            const triggerRect = selectRef.current.getBoundingClientRect();
            const dropdownRect = dropdownRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - triggerRect.bottom;
            const spaceAbove = triggerRect.top;
            const shouldOpenUp =
                dropdownRect.height > spaceBelow && spaceAbove >= dropdownRect.height;
            setDropdownDirection(shouldOpenUp ? "up" : "down");
        };

        updateDirection();
        window.addEventListener("resize", updateDirection);
        window.addEventListener("scroll", updateDirection, true);
        return () => {
            window.removeEventListener("resize", updateDirection);
            window.removeEventListener("scroll", updateDirection, true);
        };
    }, [isOpen, portalMenu, menuPlacement, options.length, value]);

    useLayoutEffect(() => {
        if (!isOpen || !portalMenu) {
            return;
        }

        const positionPortalMenu = () => {
            const trigger = selectRef.current?.getBoundingClientRect();
            const menuEl = dropdownRef.current;
            if (!trigger || !menuEl) {
                return;
            }

            const menuHeight = menuEl.getBoundingClientRect().height;
            const spaceBelow = window.innerHeight - trigger.bottom - SELECT_MENU_GAP_PX;
            const spaceAbove = trigger.top - SELECT_MENU_GAP_PX;

            let openAbove: boolean;
            if (menuPlacement === "above") {
                openAbove = true;
            } else if (menuPlacement === "below") {
                openAbove = false;
            } else {
                openAbove =
                    menuHeight > spaceBelow && spaceAbove >= Math.min(menuHeight, spaceAbove);
            }

            const available = openAbove ? spaceAbove : spaceBelow;
            const maxHeight = Math.min(
                SELECT_MENU_MAX_HEIGHT_PX,
                Math.max(SELECT_MENU_GAP_PX * 2, available - SELECT_MENU_GAP_PX)
            );

            let top: number;
            if (openAbove) {
                const usedHeight = Math.min(menuHeight || maxHeight, maxHeight);
                top = trigger.top - usedHeight - SELECT_MENU_GAP_PX;
                top = Math.max(SELECT_MENU_GAP_PX, top);
            } else {
                top = trigger.bottom + SELECT_MENU_GAP_PX;
                const bottom = top + Math.min(menuHeight || maxHeight, maxHeight);
                if (bottom > window.innerHeight - SELECT_MENU_GAP_PX) {
                    top = Math.max(
                        SELECT_MENU_GAP_PX,
                        window.innerHeight - SELECT_MENU_GAP_PX - Math.min(menuHeight, maxHeight)
                    );
                }
            }

            setPortalMenuStyle({
                position: "fixed",
                left: trigger.left,
                width: trigger.width,
                top,
                maxHeight,
                zIndex: 100,
            });
        };

        positionPortalMenu();
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(positionPortalMenu);
        });
        window.addEventListener("resize", positionPortalMenu);
        window.addEventListener("scroll", positionPortalMenu, true);
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
            window.removeEventListener("resize", positionPortalMenu);
            window.removeEventListener("scroll", positionPortalMenu, true);
        };
    }, [isOpen, portalMenu, menuPlacement, options.length, value]);

    const selectedOption = options.find(option => option.value === value);
    const displayValue = selectedOption ? selectedOption.label : placeholder;

    const handleOptionClick = (option: SelectOption) => {
        if (option.disabled) return;

        if (multiple) {
            // Multiple selection logic would go here
            // For now, treating as single select
        }

        onChange?.(option.value);
        setIsOpen(false);
    };

    const openMenuDown =
        menuPlacement === "below"
            ? true
            : menuPlacement === "above"
              ? false
              : dropdownDirection === "down";

    const dropdownPanel = isOpen ? (
        <div
            ref={dropdownRef}
            className={
                portalMenu
                    ? "bg-[#1e1f22] border border-white/20 rounded-md shadow-lg overflow-y-auto"
                    : `absolute z-50 w-full left-0 bg-[#1e1f22] border border-white/20 rounded-md shadow-lg max-h-60 overflow-y-auto ${
                          openMenuDown ? "top-full mt-1" : "bottom-full mb-1"
                      }`
            }
            style={portalMenu ? portalMenuStyle : undefined}
        >
            {options.map((option) => (
                <button
                    key={option.value}
                    className={`
                                w-full flex items-center gap-2 px-3 py-2 text-left text-sm
                                transition-colors duration-150
                                ${option.disabled
                                    ? "text-gray-500 cursor-not-allowed"
                                    : "text-gray-200 hover:bg-white/10 cursor-default"
                                }
                                ${option.value === value ? "bg-white/10 text-white" : ""}
                            `}
                    onClick={() => handleOptionClick(option)}
                    disabled={option.disabled}
                >
                    {multiple && (
                        <div className="w-4 h-4 border border-white/30 rounded flex items-center justify-center">
                            {option.value === value && <Check className="w-3 h-3 text-[#40a8c4]" />}
                        </div>
                    )}
                    {option.icon && (
                        <div className="flex-shrink-0 text-gray-400">{option.icon}</div>
                    )}
                    <span className="truncate">{option.label}</span>
                </button>
            ))}
        </div>
    ) : null;

    return (
        <div ref={selectRef} className={`relative ${fullWidth ? "w-full min-w-0" : ""} ${className}`}>
            <Button
                variant="ghost"
                size={size}
                fullWidth={fullWidth}
                disabled={disabled}
                className={`
                    min-w-0 justify-between bg-white/5 hover:bg-white/10
                    ${variantStyles[variant]}
                    ${sizeStyles[size]}
                    ${isOpen ? "border-[#40a8c4] ring-2 ring-[#40a8c4]/20" : ""}
                `}
                onClick={() => !disabled && setIsOpen(!isOpen)}
            >
                <span
                    className={`min-w-0 flex-1 truncate text-left ${
                        selectedOption ? "text-gray-200" : "text-gray-400"
                    }`}
                >
                    {displayValue}
                </span>
                <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-150 ${
                        isOpen ? "rotate-180" : ""
                    }`}
                />
            </Button>

            {dropdownPanel &&
                (portalMenu ? createPortal(dropdownPanel, document.body) : dropdownPanel)}
        </div>
    );
}

/**
 * Combobox component with search functionality
 */
export function Combobox({
    options,
    value,
    onChange,
    placeholder = "Search or select...",
    disabled = false,
    size = "md",
    variant = "default",
    fullWidth = false,
    className = "",
    filterOptions = true,
}: SelectProps & {
    filterOptions?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [filteredOptions, setFilteredOptions] = useState(options);
    const selectRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const [dropdownDirection, setDropdownDirection] = useState<"down" | "up">("down");

    useEffect(() => {
        if (filterOptions) {
            setFilteredOptions(
                options.filter(option =>
                    option.label.toLowerCase().includes(searchTerm.toLowerCase())
                )
            );
        } else {
            setFilteredOptions(options);
        }
    }, [options, searchTerm, filterOptions]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside, true);
        return () => document.removeEventListener("mousedown", handleClickOutside, true);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setDropdownDirection("down");
        }
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen) return;

        const updateDirection = () => {
            if (!selectRef.current || !dropdownRef.current) return;
            const triggerRect = selectRef.current.getBoundingClientRect();
            const dropdownRect = dropdownRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - triggerRect.bottom;
            const spaceAbove = triggerRect.top;
            const shouldOpenUp =
                dropdownRect.height > spaceBelow && spaceAbove >= dropdownRect.height;
            setDropdownDirection(shouldOpenUp ? "up" : "down");
        };

        updateDirection();
        window.addEventListener("resize", updateDirection);
        window.addEventListener("scroll", updateDirection, true);
        return () => {
            window.removeEventListener("resize", updateDirection);
            window.removeEventListener("scroll", updateDirection, true);
        };
    }, [isOpen, filteredOptions.length, searchTerm, value]);

    const selectedOption = options.find(option => option.value === value);
    const displayValue = selectedOption ? selectedOption.label : "";

    const handleOptionClick = (option: SelectOption) => {
        if (option.disabled) return;
        onChange?.(option.value);
        setIsOpen(false);
        setSearchTerm("");
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        if (!isOpen) setIsOpen(true);
    };

    return (
        <div ref={selectRef} className={`relative ${fullWidth ? "w-full min-w-0" : ""} ${className}`}>
            <div className={`
                relative bg-white/5 border rounded-md
                ${variantStyles[variant]}
                ${sizeStyles[size]}
                ${isOpen ? "border-[#40a8c4] ring-1 ring-[#40a8c4]/30 shadow-lg shadow-[#40a8c4]/10" : ""}
            `}>
                <input
                    ref={inputRef}
                    type="text"
                    value={isOpen ? searchTerm : displayValue}
                    onChange={handleInputChange}
                    onFocus={() => !disabled && setIsOpen(true)}
                    placeholder={placeholder}
                    disabled={disabled}
                    className={`
                        w-full bg-transparent text-gray-200 placeholder-gray-400
                        focus:outline-none focus:ring-0
                        ${sizeStyles[size]}
                        ${displayValue ? "text-gray-200" : "text-gray-400"}
                    `}
                    style={{
                        outline: 'none',
                        boxShadow: 'none'
                    }}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <ChevronDown
                        className={`w-4 h-4 text-gray-400 transition-transform duration-150 ${
                            isOpen ? "rotate-180" : ""
                        }`}
                    />
                </div>
            </div>

            {isOpen && filteredOptions.length > 0 && (
                <div
                    ref={dropdownRef}
                    className={`absolute z-50 w-full left-0 bg-[#1e1f22] border border-white/20 rounded-md shadow-lg max-h-60 overflow-y-auto ${
                        dropdownDirection === "down" ? "top-full mt-1" : "bottom-full mb-1"
                    }`}
                >
                    {filteredOptions.map((option) => (
                        <button
                            key={option.value}
                            className={`
                                w-full flex items-center gap-2 px-3 py-2 text-left text-sm
                                transition-colors duration-150
                                ${option.disabled
                                    ? "text-gray-500 cursor-not-allowed"
                                    : "text-gray-200 hover:bg-white/10 cursor-default"
                                }
                                ${option.value === value ? "bg-white/10 text-white" : ""}
                            `}
                            onClick={() => handleOptionClick(option)}
                            disabled={option.disabled}
                        >
                            {option.icon && (
                                <div className="flex-shrink-0 text-gray-400">
                                    {option.icon}
                                </div>
                            )}
                            <span className="truncate">{option.label}</span>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && filteredOptions.length === 0 && (
                <div
                    ref={dropdownRef}
                    className={`absolute z-50 w-full left-0 bg-[#1e1f22] border border-white/20 rounded-md shadow-lg p-3 ${
                        dropdownDirection === "down" ? "top-full mt-1" : "bottom-full mb-1"
                    }`}
                >
                    <p className="text-sm text-gray-400">No matches found</p>
                </div>
            )}
        </div>
    );
}

/**
 * Option group for select components
 */
export function SelectGroup({
    label,
    children,
    className = "",
}: {
    label: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={className}>
            <div className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {label}
            </div>
            <div className="mb-1">
                {children}
            </div>
        </div>
    );
}
