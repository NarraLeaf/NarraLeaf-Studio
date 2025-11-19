import React, { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

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
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
};

/**
 * Modal dialog component with VS Code-like styling
 * Provides overlay and backdrop blur effects
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
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-150"
                onClick={handleOverlayClick}
            />

            {/* Modal */}
            <div
                className={`
                    relative bg-[#1e1f22] border border-white/20 rounded-lg shadow-2xl
                    transition-all duration-150 transform
                    ${sizeStyles[size]} w-full mx-4 max-h-[90vh] overflow-hidden
                    ${className}
                `}
            >
                {/* Header */}
                {(title || showCloseButton) && (
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        {title && (
                            <h2 className="text-lg font-semibold text-gray-200">
                                {title}
                            </h2>
                        )}
                        {showCloseButton && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClose}
                                className="ml-auto"
                                aria-label="Close modal"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)]">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="flex items-center justify-end gap-2 p-4 border-t border-white/10 bg-white/5">
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
    title = "确认操作",
    message,
    confirmText = "确认",
    cancelText = "取消",
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
                    <Button variant="ghost" onClick={onClose} disabled={isLoading}>
                        {cancelText}
                    </Button>
                    <Button
                        variant={variant}
                        onClick={onConfirm}
                        disabled={isLoading}
                    >
                        {confirmText}
                    </Button>
                </div>
            }
        >
            <p className="text-sm text-gray-300">{message}</p>
        </Modal>
    );
}

/**
 * Alert modal for simple notifications
 */
export function AlertModal({
    isOpen,
    onClose,
    title = "提示",
    message,
    confirmText = "确定",
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
                <Button variant="primary" onClick={onClose} className="ml-auto">
                    {confirmText}
                </Button>
            }
        >
            <p className="text-sm text-gray-300">{message}</p>
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
        <div className={`flex items-center justify-between p-4 border-b border-white/10 ${className}`}>
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
        <div className={`p-4 ${className}`}>
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
        <div className={`flex items-center justify-end gap-2 p-4 border-t border-white/10 bg-white/5 ${className}`}>
            {children}
        </div>
    );
}
