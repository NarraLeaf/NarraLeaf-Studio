import React, { useCallback, useEffect, useState } from "react";
import { UIService } from "@/lib/workspace/services/ui";
import { useTranslation, translate, i18nStore } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { Input } from "../elements/Input";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

/**
 * Resolve an item-type noun for interpolation into rename/create dialog titles.
 * Known nouns (`dialogs.noun.*`) are translated; anything else (e.g. a computed
 * surface label a caller passes) falls back to the raw string unchanged.
 */
function nounFor(itemType: string): string {
    const key = `dialogs.noun.${itemType}`;
    return i18nStore.getTranslator().has(key) ? translate(key as TranslationKey) : itemType;
}

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
    const { t } = useTranslation();
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
            return t("dialogs.input.required");
        }

        if (maxLength && rawValue.length > maxLength) {
            return t("dialogs.input.maxLength", { max: maxLength });
        }

        if (validation) {
            return validation(trimmed);
        }

        return null;
    }, [required, maxLength, validation, t]);

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
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            commit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
        } else if (event.ctrlKey || event.altKey || event.metaKey) {
            // Prevent global shortcuts from being triggered when typing in dialog input
            // Keep propagation stopped above
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
                <div className="text-sm text-fg-muted">{description}</div>
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
                <div className="text-sm text-danger">{validationError}</div>
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
                        label: translate("common.cancel"),
                        onClick: invokeCancel,
                    },
                    {
                        label: translate("common.ok"),
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
        const typeNouns: Record<AssetType, string> = {
            [AssetType.Image]: nounFor("image"),
            [AssetType.Audio]: nounFor("audio"),
            [AssetType.Video]: nounFor("video"),
            [AssetType.JSON]: nounFor("json"),
            [AssetType.Blueprint]: nounFor("blueprint"),
            [AssetType.Font]: nounFor("font"),
            [AssetType.Other]: nounFor("other"),
        };

        return this.show({
            title: translate("dialogs.createGroup.title"),
            description: translate("dialogs.createGroup.prompt", { type: typeNouns[assetType] }),
            placeholder: translate("dialogs.createGroup.placeholder"),
            required: true,
            maxLength: 100,
            validation: (value) => {
                if (!value.trim()) {
                    return translate("dialogs.createGroup.empty");
                }
                return null;
            }
        });
    }

    /**
     * Convenience method for renaming items
     */
    async showRenameDialog(currentName: string, itemType: string = 'item'): Promise<string | null> {
        const noun = nounFor(itemType);
        return this.show({
            title: translate("dialogs.rename.title", { type: noun }),
            description: translate("dialogs.rename.prompt", { type: noun }),
            placeholder: translate("dialogs.rename.placeholder"),
            initialValue: currentName,
            required: true,
            maxLength: 100,
            validation: (value) => {
                if (!value.trim()) {
                    return translate("dialogs.rename.empty", { type: noun });
                }
                if (value.trim() === currentName) {
                    return translate("dialogs.rename.sameName");
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
            placeholder: translate("dialogs.password.placeholder"),
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
            placeholder: translate("dialogs.email.placeholder"),
            type: 'email',
            required: true,
            validation: (value) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(value)) {
                    return translate("dialogs.email.invalid");
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
