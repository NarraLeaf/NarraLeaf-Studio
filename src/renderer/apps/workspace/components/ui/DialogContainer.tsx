import React, { useEffect, useState } from "react";
import { Dialog } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";

/**
 * Individual dialog component
 */
function DialogComponent({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
                onClick={dialog.closable ? onClose : undefined}
            />

            {/* Dialog */}
            <div
                className="relative bg-[#1e1e1e] border border-white/10 rounded-lg shadow-2xl max-h-[90vh] overflow-hidden animate-scale-in"
                style={{
                    width: dialog.width ?? 500,
                    height: dialog.height,
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                    <h2 className="text-lg font-semibold text-white">{dialog.title}</h2>
                    {dialog.closable && (
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-white/10 transition-colors"
                            aria-label="Close"
                        >
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="px-6 py-4 overflow-y-auto" style={{ maxHeight: dialog.height ? `calc(${dialog.height}px - 140px)` : 'calc(90vh - 140px)' }}>
                    {dialog.message && (
                        <p className="text-sm text-gray-200 whitespace-pre-wrap">{dialog.message}</p>
                    )}
                    {dialog.content && (
                        <div className="text-gray-200">{dialog.content}</div>
                    )}
                </div>

                {/* Footer with buttons */}
                {dialog.buttons && dialog.buttons.length > 0 && (
                    <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/10 bg-[#252525]">
                        {dialog.buttons.map((button, index) => (
                            <button
                                key={index}
                                onClick={async () => {
                                    if (button.onClick) {
                                        await button.onClick();
                                    }
                                }}
                                disabled={button.disabled}
                                className={`
                                    px-4 py-2 text-sm rounded transition-colors
                                    ${button.disabled
                                        ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                                        : button.primary
                                            ? "bg-blue-600 hover:bg-blue-700 text-white font-medium"
                                            : "bg-white/5 hover:bg-white/10 text-gray-300"
                                    }
                                `}
                            >
                                {button.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Dialog container
 * Displays all active dialogs (stacked)
 */
export function DialogContainer() {
    const { context } = useWorkspace();
    const [dialogs, setDialogs] = useState<Dialog[]>([]);

    useEffect(() => {
        if (!context) return;
        
        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();
        
        // Initial state
        setDialogs(store.getDialogs());

        // Subscribe to changes
        const events = uiService.getEvents();
        const unsubscribe = events.on("stateChanged", (changes) => {
            if (changes.dialogs) {
                setDialogs([...changes.dialogs]);
            }
        });

        return unsubscribe;
    }, [context]);

    if (dialogs.length === 0 || !context) {
        return null;
    }

    return (
        <>
            {dialogs.map(dialog => (
                <DialogComponent
                    key={dialog.id}
                    dialog={dialog}
                    onClose={() => {
                        const uiService = context.services.get<UIService>(Services.UI);
                        uiService.dialogs.close(dialog.id);
                    }}
                />
            ))}
        </>
    );
}

