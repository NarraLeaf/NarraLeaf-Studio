import React, { useEffect } from "react";
import { X } from "lucide-react";
import { HelpTrigger, type HelpTopicId } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { CONTROL_HEIGHT_CLASS } from "./controlSize";
import { cn } from "../../utils/cn";

/**
 * Footer action buttons — same classes as DialogContainer (workspace input / info dialogs).
 *
 * On the shared `md` height, so a footer button matches the fields in the dialog
 * body rather than happening to come out the same because of its padding.
 */
export function dialogFooterButtonClass(options: {
    variant: "secondary" | "primary" | "danger";
    disabled?: boolean;
}): string {
    const base = `inline-flex items-center justify-center ${CONTROL_HEIGHT_CLASS.md} `
        + "px-4 py-1 text-sm rounded-md transition-colors cursor-default";
    if (options.disabled) {
        return `${base} bg-fill-strong text-fg-subtle cursor-not-allowed`;
    }
    if (options.variant === "primary") {
        return `${base} bg-primary hover:brightness-110 text-on-primary font-medium`;
    }
    if (options.variant === "danger") {
        return `${base} bg-danger hover:brightness-110 text-white font-medium`;
    }
    return `${base} bg-fill-subtle hover:bg-fill text-fg-muted`;
}

/**
 * Escape closes the dialog, for a dialog that is not a {@link Modal}.
 *
 * A handful of overlays are hand-built rather than wrapped in `Modal` because they position against
 * a trigger instead of centring - the asset picker and the thumbnail cropper - and each of them
 * silently lacked the one keystroke every dialog is expected to answer. This is the behaviour
 * `Modal` has always had, lifted out so there is one definition of it rather than a copy per
 * overlay.
 *
 * Deliberately on the bubble phase: anything nested that means to answer Escape itself - a menu that
 * would otherwise be orphaned above a closed dialog - keeps precedence by calling `stopPropagation`,
 * exactly as it would inside a `Modal`.
 */
export function useEscapeToClose(active: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!active) {
            return;
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [active, onClose]);
}

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    size?: "sm" | "md" | "lg" | "xl";
    closeOnOverlayClick?: boolean;
    closeOnEscape?: boolean;
    showCloseButton?: boolean;
    footer?: React.ReactNode;
    className?: string;
    /**
     * Tags the dialog for `F1` and puts a `?` beside its close button.
     *
     * Opt-in per dialog and left off by default: most dialogs ask one question that their own
     * words answer, and a `?` on every one of them is a glyph the author learns to ignore. Set it
     * where the dialog decides something the author cannot see from the controls in it.
     */
    helpTopic?: HelpTopicId;
}

const sizeStyles = {
    /** Align with DialogContainer default width (500px). */
    sm: "max-w-[500px]",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
};

/**
 * Modal shell aligned with workspace DialogContainer (layout, colors, motion).
 */
export function Modal({
    isOpen,
    onClose,
    title,
    children,
    size = "md",
    closeOnOverlayClick = true,
    closeOnEscape = true,
    showCloseButton = true,
    footer,
    className = "",
    helpTopic,
}: ModalProps) {
    const { t } = useTranslation();
    useEscapeToClose(isOpen && closeOnEscape, onClose);
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (closeOnOverlayClick && e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div className="nl-window-content-layer z-50 flex items-center justify-center p-4">
            {/* Backdrop. Full *window* (`fixed inset-0`), not just this layer: the layer starts
                below the titlebar, and the launcher's titlebar covers only the right column, so an
                `absolute inset-0` backdrop leaves the top 40px of its sidebar - logo included -
                undimmed. That strip is bare content on Windows, where the sidebar gets no macOS
                drag spacer, so the seam lands mid-logo. Everywhere else the window's own titlebar
                already fills the strip and paints above this at `z-[20000]`, so nothing changes
                there and its window controls stay bright and clickable. The panel keeps centering
                inside the layer, below the titlebar, so the titlebar never crosses it. */}
            <div
                className="bg-black/60 backdrop-blur-sm animate-fade-in fixed inset-0"
                onClick={handleOverlayClick}
            />

            {/* Modal panel */}
            <div
                className={cn(
                    "relative bg-surface-raised border border-edge rounded-lg shadow-2xl animate-scale-in",
                    sizeStyles[size], "w-full max-h-[90vh] overflow-hidden",
                    className,
                )}
                data-help-topic={helpTopic}
            >
                {/* Header */}
                {(title || showCloseButton) && (
                    <div className="group/help flex items-center justify-between gap-1 px-6 py-4 border-b border-edge">
                        {/* `flex-1` so the two trailing controls sit together on the right rather
                            than being spread apart by the close button's own `ml-auto`. */}
                        {title && <h2 className="min-w-0 flex-1 text-lg font-semibold text-fg">{title}</h2>}
                        {helpTopic && <HelpTrigger topic={helpTopic} />}
                        {showCloseButton && (
                            <button
                                type="button"
                                onClick={onClose}
                                className="p-1 rounded-md hover:bg-fill transition-colors ml-auto"
                                aria-label={t("dialogs.modal.close")}
                            >
                                <X className="w-5 h-5 text-fg-muted" strokeWidth={2} />
                            </button>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-140px)] text-fg">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-edge bg-surface-overlay">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Confirm dialog modal with preset actions
 */
export function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    cancelText,
    variant = "danger",
    isLoading = false,
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "primary" | "danger";
    isLoading?: boolean;
}) {
    const { t } = useTranslation();
    const resolvedTitle = title ?? t("dialogs.modal.confirmTitle");
    const resolvedConfirmText = confirmText ?? t("common.confirm");
    const resolvedCancelText = cancelText ?? t("common.cancel");
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={resolvedTitle}
            size="sm"
            footer={
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: isLoading })}
                        onClick={onClose}
                        disabled={isLoading}
                    >
                        {resolvedCancelText}
                    </button>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({
                            variant: variant === "danger" ? "danger" : "primary",
                            disabled: isLoading,
                        })}
                        onClick={onConfirm}
                        disabled={isLoading}
                    >
                        {resolvedConfirmText}
                    </button>
                </div>
            }
        >
            <p className="text-sm text-fg whitespace-pre-wrap">{message}</p>
        </Modal>
    );
}

/**
 * Alert modal for simple notifications
 */
export function AlertModal({
    isOpen,
    onClose,
    title,
    message,
    confirmText,
}: {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    message: string;
    confirmText?: string;
}) {
    const { t } = useTranslation();
    const resolvedTitle = title ?? t("dialogs.modal.alertTitle");
    const resolvedConfirmText = confirmText ?? t("common.ok");
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={resolvedTitle}
            size="sm"
            footer={
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary" })}
                    onClick={onClose}
                >
                    {resolvedConfirmText}
                </button>
            }
        >
            <p className="text-sm text-fg whitespace-pre-wrap">{message}</p>
        </Modal>
    );
}

/**
 * Modal header component for consistent styling
 */
export function ModalHeader({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={cn("flex items-center justify-between px-6 py-4 border-b border-edge", className)}>
            {children}
        </div>
    );
}

/**
 * Modal body component
 */
export function ModalBody({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={cn("px-6 py-4 text-fg", className)}>
            {children}
        </div>
    );
}

/**
 * Modal footer component
 */
export function ModalFooter({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={cn("flex items-center justify-end gap-2 px-6 py-4 border-t border-edge bg-surface-overlay", className)}>
            {children}
        </div>
    );
}
