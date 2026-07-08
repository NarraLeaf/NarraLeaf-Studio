import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../../utils/cn";

/** Footer action buttons — same classes as DialogContainer (workspace input / info dialogs). */
export function dialogFooterButtonClass(options: {
    variant: "secondary" | "primary" | "danger";
    disabled?: boolean;
}): string {
    const base = "px-4 py-2 text-sm rounded-md transition-colors";
    if (options.disabled) {
        return `${base} bg-fill-strong text-fg-subtle cursor-not-allowed`;
    }
    if (options.variant === "primary") {
        return `${base} bg-primary hover:brightness-110 text-white font-medium`;
    }
    if (options.variant === "danger") {
        return `${base} bg-danger hover:brightness-110 text-white font-medium`;
    }
    return `${base} bg-fill-subtle hover:bg-fill text-fg-muted`;
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
}: ModalProps) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (closeOnEscape && e.key === "Escape") {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener("keydown", handleEscape);
            document.body.style.overflow = "hidden";
        }

        return () => {
            document.removeEventListener("keydown", handleEscape);
            document.body.style.overflow = "unset";
        };
    }, [isOpen, closeOnEscape, onClose]);

    if (!isOpen) return null;

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (closeOnOverlayClick && e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div className="nl-window-content-layer z-50 flex items-center justify-center p-4">
            {/* Backdrop — match workspace DialogContainer */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
                onClick={handleOverlayClick}
            />

            {/* Modal panel */}
            <div
                className={cn(
                    "relative bg-surface-raised border border-edge rounded-lg shadow-2xl animate-scale-in",
                    sizeStyles[size], "w-full max-h-[90vh] overflow-hidden",
                    className,
                )}
            >
                {/* Header */}
                {(title || showCloseButton) && (
                    <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
                        {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
                        {showCloseButton && (
                            <button
                                type="button"
                                onClick={onClose}
                                className="p-1 rounded-md hover:bg-fill transition-colors ml-auto"
                                aria-label="Close modal"
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
    title = "Confirm action",
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
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
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            size="sm"
            footer={
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: isLoading })}
                        onClick={onClose}
                        disabled={isLoading}
                    >
                        {cancelText}
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
                        {confirmText}
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
    title = "Notice",
    message,
    confirmText = "OK",
}: {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    message: string;
    confirmText?: string;
}) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            size="sm"
            footer={
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary" })}
                    onClick={onClose}
                >
                    {confirmText}
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
