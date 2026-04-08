import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { EventEmitter } from "../ui/EventEmitter";
import { Service } from "../Service";
import { IUIEditorStateService, InteractionOverride, Services, UIEditorStateEvents, WorkspaceContext } from "../services";
import { ProjectSettingsService } from "../ProjectSettingsService";
import { UIDocumentService } from "./UIDocumentService";
import { UIService } from "../core/UIService";
import { UIStore, SelectionState } from "../ui/UIStore";
import type { ViewportTransform } from "../../../ui-editor/geometry/types";
import type { UITool } from "../../../ui-editor/editor/types";

const VIEWPORT_SETTINGS_KEY = "uiEditor.viewport";

/** Editing-area cache: inspector appearance variant picker per widget element (project settings, not UIDocument). */
const APPEARANCE_INSPECTOR_VARIANT_CACHE_KEY = "uiEditor.editingArea.appearanceInspectorVariantByElementId";

const APPEARANCE_INSPECTOR_VARIANT_PERSIST_MS = 250;

export class UIEditorStateService extends Service<UIEditorStateService> implements IUIEditorStateService {
    private uiStore: UIStore | null = null;
    private documentService: UIDocumentService | null = null;
    private settingsService: ProjectSettingsService | null = null;
    private readonly events = new EventEmitter<UIEditorStateEvents>();
    private selection: SelectionState = { type: null, data: null };
    private tool: UITool = { kind: "select" };
    private viewport: ViewportTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    private interactionOverride: InteractionOverride | null = null;
    private selectionUnsubscribe?: () => void;
    private readonly appearanceInspectorVariantByElementId = new Map<string, string>();
    private appearanceInspectorVariantPersistTimer: ReturnType<typeof setTimeout> | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const uiService = ctx.services.get<UIService>(Services.UI);
        const uidocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
        const projectSettings = ctx.services.get<ProjectSettingsService>(Services.ProjectSettings);
        await depend([uiService, uidocumentService, projectSettings]);

        this.uiStore = uiService.getStore();
        this.documentService = uidocumentService;
        this.settingsService = projectSettings;
        this.selection = this.uiStore.getSelection();
        this.ensureInteractionOverrideValid(this.selection);
        this.selectionUnsubscribe = this.uiStore
            .getEvents()
            .on("selectionChanged", selection => {
                this.selection = selection;
                this.events.emit("selectionChanged", selection);
                this.ensureInteractionOverrideValid(selection);
            });

        const stored = this.settingsService.getSync<ViewportTransform>(VIEWPORT_SETTINGS_KEY);
        if (stored) {
            this.viewport = stored;
        }

        const variantCache = this.settingsService.getSync<Record<string, string>>(APPEARANCE_INSPECTOR_VARIANT_CACHE_KEY);
        if (variantCache && typeof variantCache === "object") {
            for (const [elementId, variantId] of Object.entries(variantCache)) {
                if (typeof elementId === "string" && elementId && typeof variantId === "string" && variantId) {
                    this.appearanceInspectorVariantByElementId.set(elementId, variantId);
                }
            }
        }
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.flushAppearanceInspectorVariantPersistence();
        this.setInteractionOverride(null);
        this.selectionUnsubscribe?.();
        this.events.clear();
    }

    public getTool(): UITool {
        return this.tool;
    }

    public setTool(tool: UITool): void {
        if (this.tool.kind === tool.kind) {
            if (tool.kind === "insert") {
                if (this.tool.kind === "insert" && this.tool.nodeType === tool.nodeType) {
                    return;
                }
            } else {
                return;
            }
        }
        this.tool = tool;
        this.events.emit("toolChanged", this.tool);
    }

    public getViewportTransform(): ViewportTransform {
        return this.viewport;
    }

    public updateViewport(transform: Partial<ViewportTransform>): ViewportTransform {
        this.viewport = this.normalizeViewport({ ...this.viewport, ...transform });
        this.persistViewport();
        this.events.emit("viewportChanged", this.viewport);
        return this.viewport;
    }

    public resetViewport(): ViewportTransform {
        this.viewport = { scale: 1, offsetX: 0, offsetY: 0 };
        this.persistViewport();
        this.events.emit("viewportChanged", this.viewport);
        return this.viewport;
    }

    public getSelection(): SelectionState {
        return this.selection;
    }

    public setSelection(selection: SelectionState): void {
        this.ensureUIStore().setSelection(selection);
    }

    public setUIElementSelection(selection: UIElementSelection): void {
        this.setSelection({ type: "element", data: selection });
    }

    public getInteractionOverride(): InteractionOverride | null {
        return this.interactionOverride;
    }

    public setInteractionOverride(next: InteractionOverride | null): void {
        if (this.areOverridesEqual(this.interactionOverride, next)) {
            return;
        }
        this.interactionOverride = next;
        this.events.emit("interactionOverrideChanged", this.interactionOverride);
    }

    public getDocument(): UIDocument {
        if (!this.documentService) {
            throw new Error("UI document service is not ready");
        }
        return this.documentService.getDocument();
    }

    public getSurface(surfaceId: string): UISurface | undefined {
        const document = this.documentService?.getDocument();
        return document?.surfaces.find(surface => surface.id === surfaceId);
    }

    public getAppearanceInspectorVariant(elementId: string): string | null {
        return this.appearanceInspectorVariantByElementId.get(elementId) ?? null;
    }

    public setAppearanceInspectorVariant(elementId: string, variantId: string): void {
        const prev = this.appearanceInspectorVariantByElementId.get(elementId);
        if (prev === variantId) {
            return;
        }
        this.appearanceInspectorVariantByElementId.set(elementId, variantId);
        this.events.emit("appearanceInspectorVariantChanged", { elementId });
        this.scheduleAppearanceInspectorVariantPersistence();
    }

    public on<K extends keyof UIEditorStateEvents>(event: K, handler: (data: UIEditorStateEvents[K]) => void): () => void {
        return this.events.on(event, handler);
    }

    private ensureUIStore(): UIStore {
        if (!this.uiStore) {
            throw new Error("UI store is not initialized");
        }
        return this.uiStore;
    }

    private normalizeViewport(transform: ViewportTransform): ViewportTransform {
        const scale = Math.max(0.1, Math.min(10, transform.scale));
        const offsetX = Number.isFinite(transform.offsetX) ? transform.offsetX : 0;
        const offsetY = Number.isFinite(transform.offsetY) ? transform.offsetY : 0;
        return { scale, offsetX, offsetY };
    }

    private persistViewport(): void {
        if (!this.settingsService) {
            return;
        }
        void this.settingsService.set(VIEWPORT_SETTINGS_KEY, this.viewport).catch(err => {
            console.warn("[UIEditorStateService] failed to persist viewport", err);
        });
    }

    private scheduleAppearanceInspectorVariantPersistence(): void {
        if (!this.settingsService) {
            return;
        }
        if (this.appearanceInspectorVariantPersistTimer) {
            clearTimeout(this.appearanceInspectorVariantPersistTimer);
        }
        this.appearanceInspectorVariantPersistTimer = setTimeout(() => {
            this.appearanceInspectorVariantPersistTimer = null;
            this.persistAppearanceInspectorVariantsNow();
        }, APPEARANCE_INSPECTOR_VARIANT_PERSIST_MS);
    }

    private persistAppearanceInspectorVariantsNow(): void {
        if (!this.settingsService) {
            return;
        }
        const record = Object.fromEntries(this.appearanceInspectorVariantByElementId);
        void this.settingsService.set(APPEARANCE_INSPECTOR_VARIANT_CACHE_KEY, record).catch(err => {
            console.warn("[UIEditorStateService] failed to persist appearance inspector variant cache", err);
        });
    }

    private flushAppearanceInspectorVariantPersistence(): void {
        if (this.appearanceInspectorVariantPersistTimer) {
            clearTimeout(this.appearanceInspectorVariantPersistTimer);
            this.appearanceInspectorVariantPersistTimer = null;
        }
        if (this.appearanceInspectorVariantByElementId.size > 0 && this.settingsService) {
            this.persistAppearanceInspectorVariantsNow();
        }
    }

    private ensureInteractionOverrideValid(selection: SelectionState): void {
        if (!this.interactionOverride) {
            return;
        }
        if (selection.type !== "element" || !selection.data) {
            this.setInteractionOverride(null);
            return;
        }
        const elementSelection = selection.data;
        if (
            !elementSelection.elementIds.includes(this.interactionOverride.elementId) ||
            elementSelection.surfaceId !== this.interactionOverride.surfaceId
        ) {
            this.setInteractionOverride(null);
        }
    }

    private areOverridesEqual(a: InteractionOverride | null, b: InteractionOverride | null): boolean {
        if (a === b) {
            return true;
        }
        if (!a || !b) {
            return false;
        }
        if (a.kind !== b.kind || a.surfaceId !== b.surfaceId || a.elementId !== b.elementId) {
            return false;
        }
        if (a.kind === "imageCrop" && b.kind === "imageCrop") {
            return a.source === b.source;
        }
        return a.kind === "textEdit" && b.kind === "textEdit";
    }
}
