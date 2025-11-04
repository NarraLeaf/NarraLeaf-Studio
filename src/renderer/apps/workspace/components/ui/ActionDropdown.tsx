import React, { useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { ActionDefinition, ActionGroup } from "../../registry/types";

interface ActionDropdownProps {
    group: ActionGroup;
}

/**
 * Action dropdown component for grouped actions
 */
export function ActionDropdown({ group }: ActionDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const toggleDropdown = () => {
        setIsOpen(!isOpen);
    };

    const handleActionClick = (action: ActionDefinition) => {
        if (!action.disabled) {
            action.onClick();
            setIsOpen(false);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "Escape") {
            setIsOpen(false);
        }
    };

    const visibleActions = group.actions.filter((action) => action.visible !== false);

    if (visibleActions.length === 0) {
        return null;
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={toggleDropdown}
                onKeyDown={handleKeyDown}
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

                    {/* Dropdown menu */}
                    <div className="absolute top-full left-0 mt-1 z-20 min-w-48 bg-[#1a1a1a] border border-white/20 rounded-md shadow-lg py-1">
                        {visibleActions.map((action) => (
                            <button
                                key={action.id}
                                onClick={() => handleActionClick(action)}
                                disabled={action.disabled}
                                className={`
                                    w-full px-3 py-2 text-left text-sm transition-colors cursor-default
                                    ${action.disabled
                                        ? "text-gray-500 cursor-not-allowed"
                                        : "text-gray-300 hover:bg-white/10 hover:text-white"
                                    }
                                `}
                                title={action.tooltip || action.label}
                                aria-label={action.label}
                            >
                                <div className="flex items-center justify-between">
                                    <span>{action.label}</span>
                                    {action.badge && (
                                        <span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                                            {action.badge}
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
