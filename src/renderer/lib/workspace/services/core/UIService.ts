import { IUIService, WorkspaceContext } from "../services";
import { Service } from "../Service";
import { UIStore } from "../ui/UIStore";
import { NotificationService } from "../ui/NotificationService";
import { ActionBarService } from "../ui/ActionBarService";
import { PanelService } from "../ui/PanelService";
import { EditorService } from "../ui/EditorService";
import { DialogService } from "../ui/DialogService";
import { StatusBarService } from "../ui/StatusBarService";
import { FocusManager } from "../ui/FocusManager";
import { KeybindingService } from "../ui/KeybindingService";
import { EventEmitter } from "../ui/EventEmitter";
import { UIStateEvents } from "../ui/UIStore";
import { AssetsService } from "./AssetsService";
import { Asset } from "../assets/types";
import { Services } from "../services";

/**
 * UI Service
 * Central hub for all UI-related functionality
 * Provides sub-services for different UI aspects:
 * - notifications: VSCode-style notifications
 * - actionBar: Top action bar items
 * - panels: Sidebar and bottom panels
 * - editor: Editor tab management
 * - dialogs: Modal dialogs and inputs
 * - statusBar: Status bar items
 * - focus: Focus management
 * - keybindings: Keyboard shortcuts
 */
export class UIService extends Service<UIService> implements IUIService {
    private store: UIStore;
    private _notifications: NotificationService;
    private _actionBar: ActionBarService;
    private _panels: PanelService;
    private _editor: EditorService;
    private _dialogs: DialogService;
    private _statusBar: StatusBarService;
    private _focus: FocusManager;
    private _keybindings: KeybindingService;

    constructor() {
        super();
        this.store = new UIStore();
        this._notifications = new NotificationService(this.store);
        this._actionBar = new ActionBarService(this.store);
        this._panels = new PanelService(this.store);
        this._editor = new EditorService(this.store);
        this._dialogs = new DialogService(this.store);
        this._statusBar = new StatusBarService(this.store);
        this._focus = new FocusManager();
        this._keybindings = new KeybindingService(this._focus);
    }

    protected init(ctx: WorkspaceContext): Promise<void> | void {
        // Start keybinding service
        this._keybindings.start();

        try {
            const assetsService = ctx.services.get<AssetsService>(Services.Assets);
            assetsService.getEvents().on("deleted", (asset: Asset) => {
                // Clear selection if the deleted asset is selected
                const selection = this.store.getSelection();
                if (selection.type === "asset" && (selection.data as Asset).id === asset.id) {
                    this.store.setSelection({ type: null, data: null });
                }

                // Helper to traverse editor layout and gather {tab, groupId}
                const collectTabs = (
                    layout: any,
                    acc: Array<{ tab: any; groupId: string }>
                ) => {
                    if ("tabs" in layout) {
                        // EditorGroup
                        (layout.tabs as any[]).forEach((t) => acc.push({ tab: t, groupId: layout.id }));
                    } else {
                        collectTabs(layout.first, acc);
                        collectTabs(layout.second, acc);
                    }
                };

                const allTabs: Array<{ tab: any; groupId: string }> = [];
                collectTabs(this.store.getEditorLayout(), allTabs);

                allTabs.forEach(({ tab, groupId }) => {
                    const related =
                        tab.id === `image-preview:${asset.id}` ||
                        (tab.payload && typeof tab.payload === "object" && "asset" in tab.payload && tab.payload.asset?.id === asset.id);
                    if (related) {
                        this.store.closeEditorTabInGroup(tab.id, groupId);
                    }
                });
            });
        } catch (err) {
            console.warn("UIService: failed to attach asset deletion listener", err);
        }
    }

    /**
     * Get the UI store (for internal use by hooks)
     */
    public getStore(): UIStore {
        return this.store;
    }

    /**
     * Get event emitter for UI state changes
     */
    public getEvents(): EventEmitter<UIStateEvents> {
        return this.store.getEvents();
    }

    // === Sub-services ===

    /**
     * Notification service
     * Usage: services.get<UIService>(Services.UI).notifications.info("Hello!")
     */
    public get notifications(): NotificationService {
        return this._notifications;
    }

    /**
     * Action bar service
     * Usage: services.get<UIService>(Services.UI).actionBar.register({...})
     */
    public get actionBar(): ActionBarService {
        return this._actionBar;
    }

    /**
     * Panel service
     * Usage: services.get<UIService>(Services.UI).panels.register({...})
     */
    public get panels(): PanelService {
        return this._panels;
    }

    /**
     * Editor service
     * Usage: services.get<UIService>(Services.UI).editor.open({...})
     */
    public get editor(): EditorService {
        return this._editor;
    }

    /**
     * Dialog service
     * Usage: services.get<UIService>(Services.UI).dialogs.confirm("Are you sure?")
     */
    public get dialogs(): DialogService {
        return this._dialogs;
    }

    /**
     * Status bar service
     * Usage: services.get<UIService>(Services.UI).statusBar.create({...})
     */
    public get statusBar(): StatusBarService {
        return this._statusBar;
    }

    /**
     * Focus manager
     * Usage: services.get<UIService>(Services.UI).focus.setFocus(...)
     */
    public get focus(): FocusManager {
        return this._focus;
    }

    /**
     * Keybinding service
     * Usage: services.get<UIService>(Services.UI).keybindings.register({...})
     */
    public get keybindings(): KeybindingService {
        return this._keybindings;
    }

    // === Legacy API (for backward compatibility) ===

    /**
     * Show a confirmation dialog
     */
    public async showConfirm(message: string, detail?: string): Promise<boolean> {
        return this._dialogs.confirm(message, detail);
    }

    /**
     * Show an alert dialog
     */
    public async showAlert(message: string, detail?: string): Promise<void> {
        return this._dialogs.alert(message, detail);
    }

    /**
     * Show a notification
     */
    public showNotification(message: string, type: "info" | "success" | "warning" | "error" = "info"): void {
        switch (type) {
            case "info":
                this._notifications.info(message);
                break;
            case "success":
                this._notifications.success(message);
                break;
            case "warning":
                this._notifications.warning(message);
                break;
            case "error":
                this._notifications.error(message);
                break;
        }
    }

    /**
     * Show an error message
     */
    public showError(error: Error | string): void {
        const message = typeof error === "string" ? error : error.message;
        this._notifications.error(message);
        console.error(error);
    }

    /**
     * Clean up
     */
    public override dispose(_ctx: WorkspaceContext): void {
        this._keybindings.stop();
        this._keybindings.clear();
        this.store.clear();
    }
}
