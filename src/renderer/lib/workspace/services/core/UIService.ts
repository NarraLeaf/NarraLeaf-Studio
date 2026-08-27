import { IUIService, WorkspaceContext } from "../services";
import { Service } from "../Service";
import { UIStore } from "../ui/UIStore";
import { NotificationService } from "../ui/NotificationService";
import { ServiceAssetsService } from "./ServiceAssetsService";
import { ActionBarService } from "../ui/ActionBarService";
import { PanelService } from "../ui/PanelService";
import { EditorService } from "../ui/EditorService";
import { DialogService } from "../ui/DialogService";
import { StatusBarService } from "../ui/StatusBarService";
import { TextEditorContributionService } from "../ui/TextEditorContributionService";
import { TextDocumentStatusService } from "../ui/TextDocumentStatusService";
import { FocusManager } from "../ui/FocusManager";
import {
    KeybindingService,
    KEYBINDING_OVERRIDES_SETTINGS_KEY,
    sanitizeKeybindingOverrides,
} from "../ui/KeybindingService";
import { EventEmitter } from "../ui/EventEmitter";
import { UIStateEvents } from "../ui/UIStore";
import { AssetsService } from "./AssetsService";
import { Asset } from "../assets/types";
import { Services } from "../services";
import { GlobalSettingsService } from "../GlobalSettingsService";
import { getInterface } from "@/lib/app/bridge";
import type { AppEventToken } from "@shared/types/app";
import { syncEditorTabTitle } from "../ui/editorTabTitle";
import { NotificationType, type NotificationAction } from "../ui/types";

/** The tone `showNotification` takes -> the notification type the store records. */
const NOTIFICATION_TYPE_BY_TONE: Record<"info" | "success" | "warning" | "error", NotificationType> = {
    info: NotificationType.Info,
    success: NotificationType.Success,
    warning: NotificationType.Warning,
    error: NotificationType.Error,
};

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
 * - textEditor: Plugin contributions to the built-in text editor
 * - textDocumentStatus: What the open text tabs report to the status bar
 */
export class UIService extends Service<UIService> implements IUIService {
    private store: UIStore;
    /** Unsubscribers for AssetsService listeners registered in init */
    private assetEventsUnsubs: (() => void)[] = [];
    /** Cross-window sync for keybinding overrides (the Settings window shares the store). */
    private keybindingOverridesToken: AppEventToken | null = null;
    private _notifications: NotificationService;
    private _actionBar: ActionBarService;
    private _panels: PanelService;
    private _editor: EditorService;
    private _dialogs: DialogService;
    private _statusBar: StatusBarService;
    private _textEditor: TextEditorContributionService;
    private _textDocumentStatus: TextDocumentStatusService;
    private _focus: FocusManager;
    private _keybindings: KeybindingService;

    constructor() {
        super();
        this.store = new UIStore();
        this._focus = new FocusManager();
        this._notifications = new NotificationService(this.store);
        this._actionBar = new ActionBarService(this.store);
        this._panels = new PanelService(this.store);
        this._editor = new EditorService(this.store);
        this._dialogs = new DialogService(this.store, this._focus);
        this._statusBar = new StatusBarService(this.store);
        this._textEditor = new TextEditorContributionService(this.store);
        this._textDocumentStatus = new TextDocumentStatusService();
        this._keybindings = new KeybindingService(this._focus, this.store);
        this.store.setKeybindingService(this._keybindings);
    }

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        const globalSettings = ctx.services.get<GlobalSettingsService>(Services.GlobalSettings);
        const serviceAssets = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
        await depend([assetsService, globalSettings, serviceAssets]);

        // User keybinding overrides: seed from global state, then follow cross-window writes.
        this._keybindings.setOverrides(
            sanitizeKeybindingOverrides(globalSettings.getSync(KEYBINDING_OVERRIDES_SETTINGS_KEY)),
        );
        this.keybindingOverridesToken?.cancel();
        this.keybindingOverridesToken = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === KEYBINDING_OVERRIDES_SETTINGS_KEY) {
                this._keybindings.setOverrides(sanitizeKeybindingOverrides(change.value));
            }
        }) ?? null;

        await this._notifications.startPersistence(serviceAssets);

        // Start keybinding service
        this._keybindings.start();

        try {
            for (const unsub of this.assetEventsUnsubs) {
                unsub();
            }
            this.assetEventsUnsubs = [];

            const unsubDeleted = assetsService.getEvents().on("deleted", (asset: Asset) => {
                // Clear selection if the deleted asset is selected
                const selection = this.store.getSelection();
                if (selection.type === "asset" && selection.data.id === asset.id) {
                    this.store.setSelection({ type: null, data: null });
                }

                for (const { tab, groupId } of this.collectAssetTabs(asset.id)) {
                    this.store.closeEditorTabInGroup(tab.id, groupId);
                }
            });

            const unsubUpdated = assetsService.getEvents().on("updated", (asset: Asset) => {
                // A preview tab's title is a snapshot of the name it was opened under, so a rename
                // has to be written back into the layout or the strip keeps the old one for the life
                // of the tab. Only the title: the payload holds the very record that was just
                // mutated, so its `name` is already the new one.
                for (const { tab } of this.collectAssetTabs(asset.id)) {
                    syncEditorTabTitle(this, tab.id, asset.name);
                }

                const selection = this.store.getSelection();
                if (selection.type !== "asset") {
                    return;
                }
                if (selection.data.id !== asset.id) {
                    return;
                }
                // Shallow clone so React consumers re-render after in-place metadata updates
                this.store.setSelection({ type: "asset", data: { ...asset } });
            });

            this.assetEventsUnsubs.push(unsubDeleted, unsubUpdated);
        } catch (err) {
            console.warn("UIService: failed to attach asset event listeners", err);
        }
    }

    /**
     * Every open editor tab that is *showing* one asset, with the group holding it.
     *
     * Matched on the payload rather than on the tab id: the id is minted per editor kind
     * (`…:image-preview-<id>`, `…:audio-preview-<id>`, the text editor's own), so an id pattern here
     * is one that stops matching the day a seventh preview editor is added - which is exactly what
     * had already happened to the `image-preview:<id>` test this replaced. That test had matched
     * nothing since preview tab ids were namespaced.
     */
    private collectAssetTabs(assetId: string): Array<{ tab: { id: string; payload?: unknown }; groupId: string }> {
        const found: Array<{ tab: { id: string; payload?: unknown }; groupId: string }> = [];
        const visit = (layout: any): void => {
            if (!layout) {
                return;
            }
            if ("tabs" in layout) {
                for (const tab of layout.tabs as Array<{ id: string; payload?: unknown }>) {
                    const payload = tab.payload as { asset?: { id?: string } } | undefined;
                    if (payload && typeof payload === "object" && payload.asset?.id === assetId) {
                        found.push({ tab, groupId: layout.id });
                    }
                }
                return;
            }
            visit(layout.first);
            visit(layout.second);
        };
        visit(this.store.getEditorLayout());
        return found;
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
     * Plugin contributions to the built-in text editor
     * Usage: services.get<UIService>(Services.UI).textEditor.registerPreview({...})
     *
     * Studio itself registers nothing here - this registry exists so a plugin can add the
     * Markdown grammar, preview and commands the built-in editor deliberately does not ship.
     */
    public get textEditor(): TextEditorContributionService {
        return this._textEditor;
    }

    /**
     * What the open text tabs are reporting about themselves, for the status bar.
     *
     * Host-internal and not part of any plugin surface; see {@link TextDocumentStatusService}.
     */
    public get textDocumentStatus(): TextDocumentStatusService {
        return this._textDocumentStatus;
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
     * Confirm an irreversible action. Cancel is the primary button and the keyboard default; the
     * destructive one is a danger-coloured secondary. See {@link DialogService.confirmDestructive}.
     */
    public async showDestructiveConfirm(message: string, detail: string | undefined, confirmLabel: string): Promise<boolean> {
        return this._dialogs.confirmDestructive(message, detail, confirmLabel);
    }

    /**
     * Show an alert dialog
     */
    public async showAlert(message: string, detail?: string): Promise<void> {
        return this._dialogs.alert(message, detail);
    }

    /**
     * Show a notification, and return its id.
     *
     * `actions` are buttons on the toast; `sticky` keeps it up until the reader dismisses it, which
     * is what an outcome nobody was watching for needs. Neither survives dismissal: the history the
     * notifications panel reads keeps the message and the detail and drops the callbacks, so the
     * message has to make sense on its own once the action is gone (see {@link NotificationService}).
     */
    public showNotification(
        message: string,
        type: "info" | "success" | "warning" | "error" = "info",
        options?: { detail?: string; actions?: NotificationAction[]; sticky?: boolean },
    ): string {
        return this._notifications.show({
            type: NOTIFICATION_TYPE_BY_TONE[type],
            message,
            detail: options?.detail,
            actions: options?.actions,
            ...(options?.sticky ? { timeout: 0 } : {}),
        });
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
        for (const unsub of this.assetEventsUnsubs) {
            unsub();
        }
        this.assetEventsUnsubs = [];
        this.keybindingOverridesToken?.cancel();
        this.keybindingOverridesToken = null;
        this._notifications.stopPersistence();
        this._keybindings.stop();
        this._keybindings.clear();
        this.store.clear();
    }
}
