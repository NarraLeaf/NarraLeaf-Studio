import React from "react";

export interface ItemProps {
    active?: boolean;
    icon?: React.ReactNode;
    text: string;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
}

/**
 * Individual sidebar navigation item for launcher
 * Private component for launcher app only
 */
export function Item({
    active,
    icon,
    text,
    onClick,
    disabled = false,
    className = "",
}: ItemProps) {
    return (
        <button
            className={`
                w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors
                ${disabled
                    ? "text-gray-500 cursor-not-allowed opacity-50"
                    : active
                        ? "bg-white/10 text-white cursor-default"
                        : "text-gray-300 hover:bg-white/10 hover:text-white cursor-default"
                }
                ${className}
            `}
            onClick={onClick}
            disabled={disabled}
        >
            {icon && (
                <span className="flex-shrink-0">
                    {icon}
                </span>
            )}
            <span className="truncate">{text}</span>
        </button>
    );
}
