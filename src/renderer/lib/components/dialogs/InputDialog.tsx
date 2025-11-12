import React, { useCallback, useEffect, useState } from "react";
import { UIService } from "@/lib/workspace/services/ui";
import { Input } from "../elements/Input";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

export interface InputDialogOptions {
    title: string;
    placeholder?: string;
    initialValue?: string;
    description?: string;
    required?: boolean;
    validation?: (value: string) => string | null; // Returns error message or null if valid
    maxLength?: number;
    type?: "text" | "password" | "email" | "number";
    assetType?: AssetType; // For context-aware dialogs
    customButtons?: Array<{
        label: string;
        primary?: boolean;
        action: "ok" | "cancel" | "custom";
        onClick?: (value?: string | null) => void;
    }>;
}

interface InputDialogContentHandlers {
    submit: () => void;
    cancel: () => void;
    getValue: () => string;
}

interface InputDialogContentProps {
    options: InputDialogOptions;
    onSubmit: (value: string | null) => void;
    onCancel: () => void;
    registerHandlers: (handlers: InputDialogContentHandlers) => void;
}

const InputDialogContent: React.FC<InputDialogContentProps> = ({
    options,
    onSubmit,
    onCancel,
    registerHandlers,
}) => {
    const {
        placeholder = "",
        initialValue = "",
        description,
        required = false,
        validation,
        maxLength,
        type = "text",
    } = options;

    const [value, setValue] = useState(initialValue);
    const [validationError, setValidationError] = useState<string | null>(null);

    const validateValue = useCallback((rawValue: string, skipRequired: boolean) => {
        const trimmed = rawValue.trim();

        if (!skipRequired && required && !trimmed) {
            return "This field is required";
        }

        if (maxLength && rawValue.length > maxLength) {
            return `Maximum ${maxLength} characters allowed`;
        }

        if (validation) {
            return validation(trimmed);
        }

        return null;
    }, [required, maxLength, validation]);

    useEffect(() => {
        setValue(initialValue);
        setValidationError(validateValue(initialValue, true));
    }, [initialValue, validateValue]);

    const cancel = useCallback(() => {
        onCancel();
    }, [onCancel]);

    const commit = useCallback(() => {
        const error = validateValue(value, false);
        if (error) {
            setValidationError(error);
            return;
        }

        const trimmed = value.trim();
        onSubmit(trimmed || null);
    }, [validateValue, value, onSubmit]);

    useEffect(() => {
        registerHandlers({
            submit: commit,
            cancel,
            getValue: () => value,
        });
    }, [commit, cancel, registerHandlers, value]);

    const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setValue(event.target.value);
        if (validationError) {
            setValidationError(null);
        }
    }, [validationError]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            commit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
        }
    }, [commit, cancel]);

    return (
        <form
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                commit();
            }}
        >
            {description && (
                <div className="text-sm text-gray-300">{description}</div>
            )}

            <Input
                type={type}
                value={value}
                placeholder={placeholder}
                fullWidth
                autoFocus
                maxLength={maxLength}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                variant={validationError ? "error" : "default"}
            />

            {validationError && (
                <div className="text-sm text-red-400">{validationError}</div>
            )}
        </form>
    );
};

/**
 * Input dialog service for showing modal input dialogs
 * Highly configurable and reusable across the application
 */
export class InputDialog {
    private uiService: UIService;

    constructor(uiService: UIService) {
        this.uiService = uiService;
    }

    /**
     * Show an input dialog and return the user's input
     */
    async show(options: InputDialogOptions): Promise<string | null> {
        const { title, customButtons } = options;

        return new Promise<string | null>((resolve) => {
            let currentDialogId: string | null = null;
            let submitHandler: (() => void) | null = null;
            let cancelHandler: (() => void) | null = null;
            let valueGetter: (() => string) | null = null;

            let settled = false;
            const safeResolve = (val: string | null) => {
                if (!settled) {
                    settled = true;
                    resolve(val);
                }
            };

            const registerHandlers = (handlers: InputDialogContentHandlers) => {
                submitHandler = handlers.submit;
                cancelHandler = handlers.cancel;
                valueGetter = handlers.getValue;
            };

            const closeDialog = () => {
                if (currentDialogId) {
                    this.uiService.dialogs.close(currentDialogId);
                    currentDialogId = null;
                }
            };

            const handleSubmit = (value: string | null) => {
                safeResolve(value);
                closeDialog();
            };

            const handleCancel = () => {
                safeResolve(null);
                closeDialog();
            };

            const invokeSubmit = () => {
                if (submitHandler) {
                    submitHandler();
                }
            };

            const invokeCancel = () => {
                if (cancelHandler) {
                    cancelHandler();
                } else {
                    handleCancel();
                }
            };

            const buttons = customButtons
                ? customButtons.map(btn => ({
                    label: btn.label,
                    primary: btn.primary,
                    onClick: () => {
                        if (btn.action === "ok") {
                            invokeSubmit();
                        } else if (btn.action === "cancel") {
                            invokeCancel();
                        } else if (btn.onClick) {
                            btn.onClick(valueGetter ? valueGetter() : undefined);
                        }
                    },
                }))
                : [
                    {
                        label: "Cancel",
                        onClick: invokeCancel,
                    },
                    {
                        label: "OK",
                        primary: true,
                        onClick: invokeSubmit,
                    },
                ];

            currentDialogId = this.uiService.dialogs.show({
                title,
                content: (
                    <InputDialogContent
                        options={options}
                        onSubmit={handleSubmit}
                        onCancel={handleCancel}
                        registerHandlers={registerHandlers}
                    />
                ),
                buttons,
                closable: true,
                onClose: handleCancel,
            });
        });
    }

    /**
     * Convenience method for creating groups
     */
    async showCreateGroupDialog(assetType: AssetType, parentGroupId?: string): Promise<string | null> {
        const typeNames = {
            [AssetType.Image]: 'Image',
            [AssetType.Audio]: 'Audio',
            [AssetType.Video]: 'Video',
            [AssetType.JSON]: 'JSON',
            [AssetType.Font]: 'Font',
            [AssetType.Other]: 'Other'
        };

        return this.show({
            title: 'Create Group',
            description: `Please enter a name for the ${typeNames[assetType]} group`,
            placeholder: 'Enter group name...',
            required: true,
            maxLength: 50,
            validation: (value) => {
                if (!value.trim()) {
                    return 'Group name cannot be empty';
                }
                if (value.length < 2) {
                    return 'Group name must be at least 2 characters';
                }
                // Add more validation rules as needed
                return null;
            }
        });
    }

    /**
     * Convenience method for renaming items
     */
    async showRenameDialog(currentName: string, itemType: string = 'item'): Promise<string | null> {
        return this.show({
            title: `Rename ${itemType}`,
            description: `Please enter a new ${itemType} name`,
            placeholder: 'Enter new name...',
            initialValue: currentName,
            required: true,
            maxLength: 100,
            validation: (value) => {
                if (!value.trim()) {
                    return `${itemType} name cannot be empty`;
                }
                if (value.trim() === currentName) {
                    return 'New name cannot be the same as current name';
                }
                return null;
            }
        });
    }

    /**
     * Convenience method for password input
     */
    async showPasswordDialog(title: string, description?: string): Promise<string | null> {
        return this.show({
            title,
            description,
            placeholder: 'Enter password...',
            type: 'password',
            required: true
        });
    }

    /**
     * Convenience method for email input
     */
    async showEmailDialog(title: string, description?: string): Promise<string | null> {
        return this.show({
            title,
            description,
            placeholder: 'Enter email address...',
            type: 'email',
            required: true,
            validation: (value) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(value)) {
                    return 'Please enter a valid email address';
                }
                return null;
            }
        });
    }
}

/**
 * Factory function to create InputDialog instance
 */
export function createInputDialog(uiService: UIService): InputDialog {
    return new InputDialog(uiService);
}
