import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "./Button";

export interface SelectOption {
    value: string | number;
    label: string;
    disabled?: boolean;
    icon?: React.ReactNode;
}

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

/**
 * Select dropdown component with VS Code-like styling
 */
export function Select({
    options,
    value,
    onChange,
    placeholder = "请选择...",
    disabled = false,
    size = "md",
    variant = "default",
    fullWidth = false,
    className = "",
    multiple = false,
}: SelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const selectRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

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

    return (
        <div ref={selectRef} className={`relative ${fullWidth ? "w-full" : ""} ${className}`}>
            <Button
                variant="ghost"
                size={size}
                fullWidth={fullWidth}
                disabled={disabled}
                className={`
                    justify-between bg-white/5 hover:bg-white/10
                    ${variantStyles[variant]}
                    ${sizeStyles[size]}
                    ${isOpen ? "border-[#40a8c4] ring-2 ring-[#40a8c4]/20" : ""}
                `}
                onClick={() => !disabled && setIsOpen(!isOpen)}
            >
                <span className={selectedOption ? "text-gray-200" : "text-gray-400"}>
                    {displayValue}
                </span>
                <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform duration-150 ${
                        isOpen ? "rotate-180" : ""
                    }`}
                />
            </Button>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-[#1e1f22] border border-white/20 rounded-md shadow-lg max-h-60 overflow-y-auto">
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
                                    {option.value === value && (
                                        <Check className="w-3 h-3 text-[#40a8c4]" />
                                    )}
                                </div>
                            )}
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
    placeholder = "搜索或选择...",
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

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

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
        <div ref={selectRef} className={`relative ${fullWidth ? "w-full" : ""} ${className}`}>
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
                <div className="absolute z-50 w-full mt-1 bg-[#1e1f22] border border-white/20 rounded-md shadow-lg max-h-60 overflow-y-auto">
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
                <div className="absolute z-50 w-full mt-1 bg-[#1e1f22] border border-white/20 rounded-md shadow-lg p-3">
                    <p className="text-sm text-gray-400">没有找到匹配项</p>
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
