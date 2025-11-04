import React from "react";
import { useRegistry } from "../../registry";

/**
 * Action bar component
 * Displays dynamically registered actions in the top-left area
 */
export function ActionBar() {
    const { actions } = useRegistry();

    // Filter visible actions
    const visibleActions = actions.filter((action) => action.visible !== false);

    if (visibleActions.length === 0) {
        return <div className="flex items-center gap-1" />;
    }

    return (
        <div className="flex items-center gap-1">
            {visibleActions.map((action) => (
                <button
                    key={action.id}
                    onClick={action.onClick}
                    disabled={action.disabled}
                    className={`
                        h-8 px-3 rounded-md flex items-center gap-2 text-sm transition-colors cursor-default
                        ${
                            action.disabled
                                ? "text-gray-500 cursor-not-allowed"
                                : "text-gray-300 hover:bg-white/10 hover:text-white"
                        }
                    `}
                    title={action.tooltip || action.label}
                    aria-label={action.label}
                >
                    {action.icon && <span className="w-4 h-4">{action.icon}</span>}
                    <span>{action.label}</span>
                </button>
            ))}
        </div>
    );
}

