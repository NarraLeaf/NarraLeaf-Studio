import React, { useEffect, useRef, useState } from "react";
import { Dialog } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import { HelpTrigger, requestContextHelp } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";

/**
 * Individual dialog component
 */
function DialogComponent({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
    const { t } = useTranslation();
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const defaultButtonRef = useRef<HTMLButtonElement | null>(null);
    const defaultButtonIndex = dialog.buttons?.findIndex(button => button.primary && !button.disabled && !button.danger) ?? -1;
    // A destructive button is never the fallback default: Enter on a dialog nobody read must not be
    // able to delete or overwrite anything.
    const fallbackButtonIndex = dialog.buttons?.findIndex(button => !button.disabled && !button.danger) ?? -1;
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
                data-help-topic={dialog.helpTopic}
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
                    // Answered here rather than by the global `F1` binding: `KeybindingService`
                    // drops every global key while a dialog is open, so a dialog that carries a
                    // topic would have a `?` the mouse can reach and no key that reaches it.
                    if (event.key === "F1" && dialog.helpTopic) {
                        event.preventDefault();
                        event.stopPropagation();
                        requestContextHelp();
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
                <div className="group/help flex items-center justify-between gap-1 px-6 py-4 border-b border-edge">
                    {/* `flex-1` so the `?` and the close button stay together on the right instead
                        of being spread apart, matching the header `Modal` draws. */}
                    <h2 className="min-w-0 flex-1 text-lg font-semibold text-fg">{dialog.title}</h2>
                    {dialog.helpTopic && <HelpTrigger topic={dialog.helpTopic} />}
                    {dialog.closable && (
                        <button
                            onClick={onClose}
                            className="p-1 rounded-md hover:bg-fill transition-colors"
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
                                    px-4 py-2 text-sm rounded-md transition-colors
                                    ${button.disabled
                                        ? "bg-fill text-fg-subtle cursor-not-allowed"
                                        : button.danger
                                            ? "bg-fill-subtle hover:bg-danger/20 text-danger border border-danger/40"
                                            : button.primary
                                                ? "bg-primary hover:bg-primary/80 text-on-primary font-medium"
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
