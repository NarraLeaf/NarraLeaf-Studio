import React, { ReactNode } from "react";
import { UIStore } from "./UIStore";
import { FocusManager } from "./FocusManager";
import { FocusArea } from "./types";
import { Dialog, DialogButton, QuickPickItem, QuickPickOptions, InputBoxOptions } from "./types";

/**
 * Dialog Service
 * Manages dialogs, modals, and user input
 */
export class DialogService {
    private store: UIStore;
    private focusManager: FocusManager;
    private nextId = 1;
    private dialogResolvers: Map<string, (result: any) => void> = new Map();

    constructor(store: UIStore, focusManager: FocusManager) {
        this.store = store;
        this.focusManager = focusManager;
    }

    /**
     * Show a confirmation dialog
     */
    public async confirm(message: string, detail?: string): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            let settled = false;
            const safeResolve = (val: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(val);
                }
            };

            const id = this.createDialog({
                title: "Confirm",
                message,
                // content: detail ? <div className="text-sm text-gray-400">{detail}</div> : undefined
                content: React.createElement("div", { className: "text-sm text-gray-400" }, detail),
                buttons: [
                    {
                        label: "Cancel",
                        onClick: () => {
                            this.close(id);
                            safeResolve(false);
                        },
                    },
                    {
                        label: "OK",
                        primary: true,
                        onClick: () => {
                            safeResolve(true);
                            this.close(id);
                        },
                    },
                ],
                closable: true,
                onClose: () => safeResolve(false),
            });
        });
    }

    /**
     * Show an alert dialog
     */
    public async alert(message: string, detail?: string): Promise<void> {
        return new Promise<void>(resolve => {
            const id = this.createDialog({
                title: "Alert",
                message,
                content: React.createElement("div", { className: "text-sm text-gray-400" }, detail),
                buttons: [
                    {
                        label: "OK",
                        primary: true,
                        onClick: () => {
                            this.close(id);
                            resolve();
                        },
                    },
                ],
                closable: true,
                onClose: () => resolve(),
            });
        });
    }

    /**
     * Show a custom dialog
     */
    public show(options: {
        title: string;
        message?: string;
        content?: ReactNode;
        buttons?: DialogButton[];
        closable?: boolean;
        width?: string | number;
        height?: string | number;
        onClose?: () => void;
    }): string {
        return this.createDialog(options);
    }

    /**
     * Show a dialog and wait for result
     */
    public async showAndWait<T = any>(options: {
        title: string;
        message?: string;
        content?: ReactNode;
        buttons?: (DialogButton & { result?: T })[];
        closable?: boolean;
        width?: string | number;
        height?: string | number;
    }): Promise<T | undefined> {
        return new Promise<T | undefined>(resolve => {
            const id = this.createDialog({
                ...options,
                buttons: options.buttons?.map(btn => ({
                    ...btn,
                    onClick: async () => {
                        if (btn.onClick) {
                            await btn.onClick();
                        }
                        this.close(id);
                        resolve((btn as any).result);
                    },
                })),
                onClose: () => resolve(undefined),
            });
        });
    }

    /**
     * Show a quick pick dialog (like VSCode's quick pick)
     */
    public async showQuickPick<T = any>(
        items: QuickPickItem<T>[],
        options?: QuickPickOptions
    ): Promise<QuickPickItem<T> | QuickPickItem<T>[] | undefined> {
        // This would need a custom QuickPick component
        // For now, return a promise that will be resolved by the component
        return new Promise<QuickPickItem<T> | QuickPickItem<T>[] | undefined>(resolve => {
            const id = `quickpick-${this.nextId++}`;
            this.dialogResolvers.set(id, resolve);
            
            // Create a dialog with QuickPick component
            // The component will call resolveDialog when selection is made
            this.createDialog({
                title: options?.title ?? "Select an item",
                content: null, // QuickPick component would go here
                closable: true,
                width: 600,
                onClose: () => {
                    this.resolveDialog(id, undefined);
                },
            });
        });
    }

    /**
     * Show an input box dialog
     */
    public async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
        // This would need a custom InputBox component
        return new Promise<string | undefined>(resolve => {
            const id = `inputbox-${this.nextId++}`;
            this.dialogResolvers.set(id, resolve);
            
            // Create a dialog with InputBox component
            this.createDialog({
                title: options?.title ?? "Input",
                content: null, // InputBox component would go here
                closable: true,
                width: 500,
                onClose: () => {
                    this.resolveDialog(id, undefined);
                },
            });
        });
    }

    /**
     * Close a dialog
     */
    public close(id: string): void {
        this.store.closeDialog(id);
        // Clean up resolver if exists
        this.dialogResolvers.delete(id);

        // Restore previous focus from stack
        this.focusManager.restorePreviousFocus();
    }

    /**
     * Close all dialogs
     */
    public closeAll(): void {
        const dialogs = this.store.getDialogs();
        dialogs.forEach(d => this.close(d.id));
    }

    /**
     * Get all dialogs
     */
    public getAll(): Dialog[] {
        return this.store.getDialogs();
    }

    /**
     * Get active dialog
     */
    public getActive(): Dialog | undefined {
        const activeId = this.store.getActiveDialogId();
        if (!activeId) return undefined;
        return this.store.getDialogs().find(d => d.id === activeId);
    }

    /**
     * Resolve a dialog with a result (used by dialog components)
     */
    public resolveDialog<T = any>(id: string, result: T): void {
        const resolver = this.dialogResolvers.get(id);
        if (resolver) {
            resolver(result);
            this.dialogResolvers.delete(id);
        }
        this.close(id);
    }

    /**
     * Create a dialog (internal helper)
     */
    private createDialog(options: {
        title: string;
        message?: string;
        content?: ReactNode;
        buttons?: DialogButton[];
        closable?: boolean;
        width?: string | number;
        height?: string | number;
        onClose?: () => void;
    }): string {
        const id = `dialog-${this.nextId++}`;
        
        const dialog: Dialog = {
            id,
            title: options.title,
            message: options.message,
            content: options.content,
            buttons: options.buttons,
            closable: options.closable !== false,
            width: options.width,
            height: options.height,
            onClose: options.onClose,
        };

        this.store.openDialog(dialog);

        // Set focus to the new dialog
        this.focusManager.setFocus(FocusArea.Dialog, id);

        return id;
    }
}

