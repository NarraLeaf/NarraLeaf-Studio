import { IUIService, WorkspaceContext } from "../services";
import { Service } from "../Service";

/**
 * UI Service
 * Provides UI-related functionality like dialogs, notifications, etc.
 */
export class UIService extends Service<UIService> implements IUIService {
    protected init(_ctx: WorkspaceContext): Promise<void> | void {
        // No initialization needed for UI service
    }

    /**
     * Show a confirmation dialog
     */
    public async showConfirm(message: string, detail?: string): Promise<boolean> {
        // For now, use browser confirm
        // In the future, this can be replaced with a custom modal
        return confirm(`${message}${detail ? '\n\n' + detail : ''}`);
    }

    /**
     * Show an alert dialog
     */
    public async showAlert(message: string, detail?: string): Promise<void> {
        // For now, use browser alert
        // In the future, this can be replaced with a custom modal
        alert(`${message}${detail ? '\n\n' + detail : ''}`);
    }

    /**
     * Show a notification
     */
    public showNotification(message: string, type: "info" | "success" | "warning" | "error" = "info"): void {
        // For now, just log to console
        // In the future, this can show a toast notification
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    /**
     * Show an error message
     */
    public showError(error: Error | string): void {
        const message = typeof error === "string" ? error : error.message;
        this.showNotification(message, "error");
        console.error(error);
    }
}

