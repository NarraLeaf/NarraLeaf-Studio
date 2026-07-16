import React, { useEffect, useRef, useState } from "react";
import { Dialog } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import { useTranslation } from "@/lib/i18n";

/**
 * Individual dialog component
 */
function DialogComponent({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
    const { t } = useTranslation();
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const defaultButtonRef = useRef<HTMLButtonElement | null>(null);
    const defaultButtonIndex = dialog.buttons?.findIndex(button => button.primary && !button.disabled) ?? -1;
    const fallbackButtonIndex = dialog.buttons?.findIndex(button => !button.disabled) ?? -1;
    const focusButtonIndex = defaultButtonIndex >= 0 ? defaultButtonIndex : fallbackButtonIndex;

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            const activeElement = document.activeElement;
            if (
                activeElement instanceof HTMLElement &&
                dialogRef.current?.contains(activeElement) &&
                activeElement !== dialogRef.current
            ) {
                return;
            }

            (defaultButtonRef.current ?? dialogRef.current)?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [dialog.id]);

    const invokeDefaultButton = () => {
        const button = focusButtonIndex >= 0 ? dialog.buttons?.[focusButtonIndex] : undefined;
        if (!button || button.disabled) {
            return;
        }
        void button.onClick?.();
    };

    return (
        <div className="nl-window-content-layer z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
                onClick={dialog.closable ? onClose : undefined}
            />

            {/* Dialog */}
            <div
                ref={dialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                className="relative bg-surface-overlay border border-edge rounded-lg shadow-2xl max-h-[90vh] overflow-hidden animate-scale-in"
                style={{
                    width: dialog.width ?? 500,
                    height: dialog.height,
                }}
                onKeyDown={event => {
                    if (event.key === "Escape" && dialog.closable) {
                        event.preventDefault();
                        event.stopPropagation();
                        onClose();
                        return;
                    }
                    if (event.key !== "Enter") {
                        return;
                    }
                    const target = event.target instanceof Element ? event.target : null;
                    if (target?.closest("button") || isEditableKeyboardTarget(event.target)) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    invokeDefaultButton();
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
                    <h2 className="text-lg font-semibold text-fg">{dialog.title}</h2>
                    {dialog.closable && (
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-fill transition-colors"
                            aria-label={t("common.close")}
                        >
                            <svg className="w-5 h-5 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="px-6 py-4 overflow-y-auto" style={{ maxHeight: dialog.height ? `calc(${dialog.height}px - 140px)` : 'calc(90vh - 140px)' }}>
                    {dialog.message && (
                        <p className="text-sm text-fg whitespace-pre-wrap">{dialog.message}</p>
                    )}
                    {dialog.content && (
                        <div className="text-fg">{dialog.content}</div>
                    )}
                </div>

                {/* Footer with buttons */}
                {dialog.buttons && dialog.buttons.length > 0 && (
                    <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-edge bg-surface-overlay">
                        {dialog.buttons.map((button, index) => (
                            <button
                                key={index}
                                ref={index === focusButtonIndex ? defaultButtonRef : undefined}
                                onClick={async () => {
                                    if (button.onClick) {
                                        await button.onClick();
                                    }
                                }}
                                disabled={button.disabled}
                                className={`
                                    px-4 py-2 text-sm rounded transition-colors
                                    ${button.disabled
                                        ? "bg-fill text-fg-subtle cursor-not-allowed"
                                        : button.primary
                                            ? "bg-primary hover:bg-primary/80 text-white font-medium"
                                            : "bg-fill-subtle hover:bg-fill text-fg-muted"
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
