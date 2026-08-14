import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { EventEmitter } from "../ui/EventEmitter";
import { Service } from "../Service";
import { IUIEditorStateService, InteractionOverride, Services, UIEditorStateEvents, WorkspaceContext } from "../services";
import { GlobalSettingsService } from "../GlobalSettingsService";
import { UIDocumentService } from "./UIDocumentService";
import { UIService } from "../core/UIService";
import { UIStore, SelectionState } from "../ui/UIStore";
import type { ViewportTransform } from "../../../ui-editor/geometry/types";
import {
    SURFACE_ZOOM_MAX_SCALE,
    SURFACE_ZOOM_MIN_SCALE,
    areViewportTransformsEqual,
    type SurfaceViewportFit,
} from "../../../ui-editor/geometry/fitViewport";
import type { UITool } from "../../../ui-editor/editor/types";
import type { ActiveSnapGuides, SmartSnapDetailSettings } from "../../../ui-editor/snapping/types";
import { DEFAULT_SMART_SNAP_DETAIL_SETTINGS } from "../../../ui-editor/snapping/types";
import {
    isSafeAreaPresetId,
    isSurfacePreviewAspectPresetId,
} from "../../../ui-editor/preview/surfacePreviewFrames";

const VIEWPORT_SETTINGS_KEY = "uiEditor.viewport";

/** Persisted: smart snap / guides for UI Surface editor. */
const SMART_SNAP_ENABLED_KEY = "uiEditor.smartSnap.enabled";

/** Persisted: smart snap category toggles (element centers, edges, canvas). */
const SMART_SNAP_DETAIL_KEY = "uiEditor.smartSnap.detail";

/** Persisted: screen-ratio preview frame preset id for the surface canvas (null = off). Pure view state. */
const PREVIEW_ASPECT_KEY = "uiEditor.preview.aspect";

/** Persisted: safe-area preview frame device preset id for the surface canvas (null = off). Pure view state. */
const PREVIEW_SAFE_AREA_KEY = "uiEditor.preview.safeArea";

/** Editing-area cache: inspector appearance variant picker per widget element (global settings, not UIDocument). */
const APPEARANCE_INSPECTOR_VARIANT_CACHE_KEY = "uiEditor.editingArea.appearanceInspectorVariantByElementId";

/** Editing-area cache: compact border "sides" row expanded (per element). */
const APPEARANCE_BORDER_SIDES_EXPANDED_CACHE_KEY = "uiEditor.editingArea.appearanceBorderSidesExpandedByElementId";

/** Outline panel: keys are element ids with collapsed branches (editor-only global settings). */
const OUTLINE_COLLAPSED_BRANCHES_KEY = "uiEditor.outline.collapsedBranchesByElementId";

/** Outline panel chrome: whether the panel itself is collapsed. */
const OUTLINE_PANEL_COLLAPSED_KEY = "uiEditor.outline.panelCollapsed";

const APPEARANCE_INSPECTOR_UI_CACHE_PERSIST_MS = 250;

const OUTLINE_COLLAPSE_CACHE_PERSIST_MS = 250;

export class UIEditorStateService extends Service<UIEditorStateService> implements IUIEditorStateService {
    private uiStore: UIStore | null = null;
    private documentService: UIDocumentService | null = null;
    private settingsService: GlobalSettingsService | null = null;
    private readonly events = new EventEmitter<UIEditorStateEvents>();
    private selection: SelectionState = { type: null, data: null };
    private tool: UITool = { kind: "select" };
    private viewport: ViewportTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    /** Which interface {@link viewport} currently describes - it is one transform shared by every tab. */
    private viewportSurfaceId: string | null = null;
    /**
     * Set while {@link viewport} is a computed zoom - a fit mode rather than somewhere the author
     * zoomed or panned to by hand. `null` means the transform is theirs and nothing may revise it.
     */
    private viewportFit: SurfaceViewportFit | null = null;
    /** Hand-set transforms, so switching back to an interface returns to the view it was left at. */
    private readonly viewportBySurfaceId = new Map<string, ViewportTransform>();
    /** Fit modes, so switching back to an interface resumes the mode it was left following. */
    private readonly viewportFitBySurfaceId = new Map<string, SurfaceViewportFit>();
    private interactionOverride: InteractionOverride | null = null;
    private selectionUnsubscribe?: () => void;
    private readonly appearanceInspectorVariantByElementId = new Map<string, string>();
    /** Only stores `true` keys; missing id => collapsed. */
    private readonly appearanceBorderSidesExpandedByElementId = new Set<string>();
    private appearanceInspectorUiCachePersistTimer: ReturnType<typeof setTimeout> | null = null;
    /** Presence means the outline branch is collapsed. */
    private readonly outlineCollapsedBranchIds = new Set<string>();
    private outlinePanelCollapsed = false;
    private outlineCollapsePersistTimer: ReturnType<typeof setTimeout> | null = null;

    private smartSnapEnabled = true;
    private smartSnapDetail: SmartSnapDetailSettings = { ...DEFAULT_SMART_SNAP_DETAIL_SETTINGS };
    private snapGuides: ActiveSnapGuides | null = null;

    /** Pure view state: screen-ratio preview frame preset id, `null` = off. Never touches the UIDocument. */
    private previewAspectId: string | null = null;
    /** Pure view state: safe-area preview frame device preset id, `null` = off. Never touches the UIDocument. */
    private previewSafeAreaId: string | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const uiService = ctx.services.get<UIService>(Services.UI);
        const uidocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
        const globalSettings = ctx.services.get<GlobalSettingsService>(Services.GlobalSettings);
        await depend([uiService, uidocumentService, globalSettings]);

        this.uiStore = uiService.getStore();
        this.documentService = uidocumentService;
        this.settingsService = globalSettings;
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

        const expandedCache = this.settingsService.getSync<Record<string, boolean>>(
            APPEARANCE_BORDER_SIDES_EXPANDED_CACHE_KEY
        );
        if (expandedCache && typeof expandedCache === "object") {
            for (const [elementId, expanded] of Object.entries(expandedCache)) {
                if (typeof elementId === "string" && elementId && expanded === true) {
                    this.appearanceBorderSidesExpandedByElementId.add(elementId);
                }
            }
        }

        const outlineCollapsed = this.settingsService.getSync<Record<string, boolean>>(OUTLINE_COLLAPSED_BRANCHES_KEY);
        if (outlineCollapsed && typeof outlineCollapsed === "object") {
            for (const [elementId, collapsed] of Object.entries(outlineCollapsed)) {
                if (typeof elementId === "string" && elementId && collapsed === true) {
                    this.outlineCollapsedBranchIds.add(elementId);
                }
            }
        }

        const outlinePanelCollapsed = this.settingsService.getSync<boolean>(OUTLINE_PANEL_COLLAPSED_KEY);
        if (typeof outlinePanelCollapsed === "boolean") {
            this.outlinePanelCollapsed = outlinePanelCollapsed;
        }

        const snapStored = this.settingsService.getSync<boolean>(SMART_SNAP_ENABLED_KEY);
        if (typeof snapStored === "boolean") {
            this.smartSnapEnabled = snapStored;
        }

        const detailStored = this.settingsService.getSync<unknown>(SMART_SNAP_DETAIL_KEY);
        this.smartSnapDetail = normalizeSmartSnapDetailSettings(detailStored);

        // Validate against the known preset ids: a stale/garbage setting must fall back to "off"
        // rather than produce a broken frame on the canvas.
        const aspectStored = this.settingsService.getSync<unknown>(PREVIEW_ASPECT_KEY);
        this.previewAspectId = isSurfacePreviewAspectPresetId(aspectStored) ? aspectStored : null;

        const safeAreaStored = this.settingsService.getSync<unknown>(PREVIEW_SAFE_AREA_KEY);
        this.previewSafeAreaId =
            typeof safeAreaStored === "string" && isSafeAreaPresetId(safeAreaStored)
                ? safeAreaStored
                : null;
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.flushAppearanceInspectorUiCachePersistence();
        this.flushOutlineCollapsePersistence();
        this.setInteractionOverride(null);
        this.setSnapGuides(null);
        this.selectionUnsubscribe?.();
        this.events.clear();
    }

    public getTool(): UITool {
        return this.tool;
    }

    public setTool(tool: UITool): void {
        if (this.tool.kind === tool.kind) {
            if (tool.kind === "insert") {
                if (
                    this.tool.kind === "insert" &&
                    this.tool.nodeType === tool.nodeType &&
                    this.tool.componentId === tool.componentId
                ) {
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

    /**
     * A hand gesture: a wheel zoom, a pan, or a zoom the author typed. It ends whatever fit mode
     * was running, because from here on the author has said where they want to be looking and a
     * pane resize must not overrule that.
     */
    public updateViewport(transform: Partial<ViewportTransform>): ViewportTransform {
        this.viewport = this.normalizeViewport({ ...this.viewport, ...transform });
        this.viewportFit = null;
        if (this.viewportSurfaceId) {
            this.viewportBySurfaceId.set(this.viewportSurfaceId, this.viewport);
            this.viewportFitBySurfaceId.delete(this.viewportSurfaceId);
        }
        this.persistViewport();
        this.events.emit("viewportChanged", this.viewport);
        return this.viewport;
    }

    /** Which interface the current transform describes; `null` before any editor tab claimed it. */
    public getViewportSurfaceId(): string | null {
        return this.viewportSurfaceId;
    }

    /**
     * The fit mode the viewport is currently following, or `null` once the author has zoomed or
     * panned by hand. Only while it is set may the editor recompute the transform on its own, when
     * the pane resizes or the design size changes.
     */
    public getViewportFit(): SurfaceViewportFit | null {
        return this.viewportFit;
    }

    /**
     * Installs a computed zoom as the viewport for `surfaceId`.
     *
     * Separate from {@link updateViewport} because the two carry opposite intent: this one is a
     * mode being applied, and it stays live across resizes; that one is a place the author chose,
     * and nothing may move it.
     */
    public applyFittedViewport(
        surfaceId: string,
        transform: ViewportTransform,
        fit: SurfaceViewportFit,
    ): ViewportTransform {
        const next = this.normalizeViewport(transform);
        // A recompute that changes nothing must not emit: the editor recomputes on every document
        // revision, and an event per revision is a re-render per revision, which is a recompute per
        // re-render. Compared before assigning, so the identity the canvas holds stays stable too.
        if (
            this.viewportSurfaceId === surfaceId &&
            this.viewportFit?.mode === fit.mode &&
            this.viewportFit.chosen === fit.chosen &&
            areViewportTransformsEqual(this.viewport, next)
        ) {
            return this.viewport;
        }
        this.viewport = next;
        this.viewportSurfaceId = surfaceId;
        this.viewportFit = fit;
        this.viewportFitBySurfaceId.set(surfaceId, fit);
        // A mode supersedes whatever hand-set transform this interface was remembered at, so
        // switching back to it later does not restore a view the author has since replaced.
        this.viewportBySurfaceId.delete(surfaceId);
        this.persistViewport();
        this.events.emit("viewportChanged", this.viewport);
        return this.viewport;
    }

    /**
     * Hands the shared viewport to `surfaceId` when opening or re-showing its tab.
     *
     * One transform serves every surface editor tab, so switching tabs would otherwise show the
     * next interface through the last one's zoom.
     *
     * Returns `null` when this interface was left at a hand-set transform - it has been restored
     * and the caller has nothing to do. Otherwise returns the mode the caller must recompute for
     * the space it has now, which for an interface being opened for the first time is the plain
     * fit nobody asked for.
     */
    public adoptSurfaceViewport(surfaceId: string): SurfaceViewportFit | null {
        const remembered = this.viewportBySurfaceId.get(surfaceId);
        if (remembered) {
            this.viewportSurfaceId = surfaceId;
            this.viewportFit = null;
            if (!areViewportTransformsEqual(this.viewport, remembered)) {
                this.viewport = remembered;
                this.persistViewport();
                this.events.emit("viewportChanged", this.viewport);
            }
            return null;
        }
        const fit = this.viewportFitBySurfaceId.get(surfaceId) ?? { mode: "contain" as const, chosen: false };
        // Claimed before the recompute lands, so a second pass of the same effect does not read the
        // previous interface's id and adopt all over again.
        this.viewportSurfaceId = surfaceId;
        this.viewportFit = fit;
        return fit;
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
        const previous = this.interactionOverride;
        this.interactionOverride = next;
        this.events.emit("interactionOverrideChanged", { previous, next });
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
        this.scheduleAppearanceInspectorUiCachePersistence();
    }

    public getAppearanceBorderSidesExpanded(elementId: string): boolean {
        return this.appearanceBorderSidesExpandedByElementId.has(elementId);
    }

    public setAppearanceBorderSidesExpanded(elementId: string, expanded: boolean): void {
        const had = this.appearanceBorderSidesExpandedByElementId.has(elementId);
        if (expanded) {
            if (had) {
                return;
            }
            this.appearanceBorderSidesExpandedByElementId.add(elementId);
        } else {
            if (!had) {
                return;
            }
            this.appearanceBorderSidesExpandedByElementId.delete(elementId);
        }
        this.scheduleAppearanceInspectorUiCachePersistence();
    }

    public isOutlineBranchCollapsed(elementId: string): boolean {
        return this.outlineCollapsedBranchIds.has(elementId);
    }

    public setOutlineBranchCollapsed(elementId: string, collapsed: boolean): void {
        const had = this.outlineCollapsedBranchIds.has(elementId);
        if (collapsed) {
            if (had) {
                return;
            }
            this.outlineCollapsedBranchIds.add(elementId);
        } else {
            if (!had) {
                return;
            }
            this.outlineCollapsedBranchIds.delete(elementId);
        }
        this.events.emit("outlineExpansionChanged", null);
        this.scheduleOutlineCollapsePersistence();
    }

    public getOutlinePanelCollapsed(): boolean {
        return this.outlinePanelCollapsed;
    }

    public setOutlinePanelCollapsed(collapsed: boolean): void {
        if (this.outlinePanelCollapsed === collapsed) {
            return;
        }
        this.outlinePanelCollapsed = collapsed;
        this.events.emit("outlinePanelCollapsedChanged", collapsed);
        if (!this.settingsService) {
            return;
        }
        void this.settingsService.set(OUTLINE_PANEL_COLLAPSED_KEY, collapsed).catch(err => {
            console.warn("[UIEditorStateService] failed to persist outline panel state", err);
        });
    }

    public getSmartSnapEnabled(): boolean {
        return this.smartSnapEnabled;
    }

    public setSmartSnapEnabled(enabled: boolean): void {
        if (this.smartSnapEnabled === enabled) {
            return;
        }
        this.smartSnapEnabled = enabled;
        this.events.emit("smartSnapEnabledChanged", enabled);
        if (!enabled) {
            this.setSnapGuides(null);
        }
        if (!this.settingsService) {
            return;
        }
        void this.settingsService.set(SMART_SNAP_ENABLED_KEY, enabled).catch(err => {
            console.warn("[UIEditorStateService] failed to persist smart snap enabled", err);
        });
    }

    public getSmartSnapDetailSettings(): SmartSnapDetailSettings {
        return this.smartSnapDetail;
    }

    public patchSmartSnapDetailSettings(patch: Partial<SmartSnapDetailSettings>): void {
        const next: SmartSnapDetailSettings = { ...this.smartSnapDetail, ...patch };
        if (areSmartSnapDetailSettingsEqual(next, this.smartSnapDetail)) {
            return;
        }
        this.smartSnapDetail = next;
        this.events.emit("smartSnapDetailSettingsChanged", this.smartSnapDetail);
        if (!this.settingsService) {
            return;
        }
        void this.settingsService.set(SMART_SNAP_DETAIL_KEY, this.smartSnapDetail).catch(err => {
            console.warn("[UIEditorStateService] failed to persist smart snap detail settings", err);
        });
    }

    public getPreviewAspectId(): string | null {
        return this.previewAspectId;
    }

    /**
     * Pure view state — persisted in global settings only. Deliberately does NOT go through
     * `UIDocumentService`, so toggling a preview frame never dirties the project, never emits
     * `documentChanged` and never enters the undo stack.
     */
    public setPreviewAspectId(aspectId: string | null): void {
        if (this.previewAspectId === aspectId) {
            return;
        }
        this.previewAspectId = aspectId;
        this.events.emit("previewAspectChanged", aspectId);
        if (!this.settingsService) {
            return;
        }
        void this.settingsService.set(PREVIEW_ASPECT_KEY, aspectId).catch(err => {
            console.warn("[UIEditorStateService] failed to persist preview aspect", err);
        });
    }

    public getPreviewSafeAreaId(): string | null {
        return this.previewSafeAreaId;
    }

    /** Pure view state — see `setPreviewAspectId`. */
    public setPreviewSafeAreaId(safeAreaId: string | null): void {
        if (this.previewSafeAreaId === safeAreaId) {
            return;
        }
        this.previewSafeAreaId = safeAreaId;
        this.events.emit("previewSafeAreaChanged", safeAreaId);
        if (!this.settingsService) {
            return;
        }
        void this.settingsService.set(PREVIEW_SAFE_AREA_KEY, safeAreaId).catch(err => {
            console.warn("[UIEditorStateService] failed to persist preview safe area", err);
        });
    }

    public getSnapGuides(): ActiveSnapGuides | null {
        return this.snapGuides;
    }

    public setSnapGuides(guides: ActiveSnapGuides | null): void {
        if (guides === null && this.snapGuides === null) {
            return;
        }
        if (guides && this.snapGuides && this.areSnapGuidesEqual(guides, this.snapGuides)) {
            return;
        }
        this.snapGuides = guides;
        this.events.emit("snapGuidesChanged", guides);
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
        const scale = Math.max(SURFACE_ZOOM_MIN_SCALE, Math.min(SURFACE_ZOOM_MAX_SCALE, transform.scale));
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

    private scheduleAppearanceInspectorUiCachePersistence(): void {
        if (!this.settingsService) {
            return;
        }
        if (this.appearanceInspectorUiCachePersistTimer) {
            clearTimeout(this.appearanceInspectorUiCachePersistTimer);
        }
        this.appearanceInspectorUiCachePersistTimer = setTimeout(() => {
            this.appearanceInspectorUiCachePersistTimer = null;
            this.persistAppearanceInspectorUiCachesNow();
        }, APPEARANCE_INSPECTOR_UI_CACHE_PERSIST_MS);
    }

    private persistAppearanceInspectorUiCachesNow(): void {
        if (!this.settingsService) {
            return;
        }
        const variantRecord = Object.fromEntries(this.appearanceInspectorVariantByElementId);
        void this.settingsService.set(APPEARANCE_INSPECTOR_VARIANT_CACHE_KEY, variantRecord).catch(err => {
            console.warn("[UIEditorStateService] failed to persist appearance inspector variant cache", err);
        });

        const expandedRecord: Record<string, boolean> = {};
        for (const id of this.appearanceBorderSidesExpandedByElementId) {
            expandedRecord[id] = true;
        }
        void this.settingsService.set(APPEARANCE_BORDER_SIDES_EXPANDED_CACHE_KEY, expandedRecord).catch(err => {
            console.warn("[UIEditorStateService] failed to persist appearance border sides expanded cache", err);
        });
    }

    private flushAppearanceInspectorUiCachePersistence(): void {
        if (this.appearanceInspectorUiCachePersistTimer) {
            clearTimeout(this.appearanceInspectorUiCachePersistTimer);
            this.appearanceInspectorUiCachePersistTimer = null;
        }
        if (!this.settingsService) {
            return;
        }
        if (
            this.appearanceInspectorVariantByElementId.size > 0 ||
            this.appearanceBorderSidesExpandedByElementId.size > 0
        ) {
            this.persistAppearanceInspectorUiCachesNow();
        }
    }

    private scheduleOutlineCollapsePersistence(): void {
        if (!this.settingsService) {
            return;
        }
        if (this.outlineCollapsePersistTimer) {
            clearTimeout(this.outlineCollapsePersistTimer);
        }
        this.outlineCollapsePersistTimer = setTimeout(() => {
            this.outlineCollapsePersistTimer = null;
            this.persistOutlineCollapsedBranchesNow();
        }, OUTLINE_COLLAPSE_CACHE_PERSIST_MS);
    }

    private persistOutlineCollapsedBranchesNow(): void {
        if (!this.settingsService) {
            return;
        }
        const record: Record<string, boolean> = {};
        for (const id of this.outlineCollapsedBranchIds) {
            record[id] = true;
        }
        void this.settingsService.set(OUTLINE_COLLAPSED_BRANCHES_KEY, record).catch(err => {
            console.warn("[UIEditorStateService] failed to persist outline collapse state", err);
        });
    }

    private flushOutlineCollapsePersistence(): void {
        if (this.outlineCollapsePersistTimer) {
            clearTimeout(this.outlineCollapsePersistTimer);
            this.outlineCollapsePersistTimer = null;
        }
        if (!this.settingsService) {
            return;
        }
        this.persistOutlineCollapsedBranchesNow();
    }

    private areSnapGuidesEqual(a: ActiveSnapGuides, b: ActiveSnapGuides): boolean {
        if (a.surfaceId !== b.surfaceId) {
            return false;
        }
        if (a.vertical.length !== b.vertical.length || a.horizontal.length !== b.horizontal.length) {
            return false;
        }
        return (
            a.vertical.every(
                (v, i) => v.value === b.vertical[i].value && v.kind === b.vertical[i].kind,
            ) &&
            a.horizontal.every(
                (v, i) => v.value === b.horizontal[i].value && v.kind === b.horizontal[i].kind,
            )
        );
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

function normalizeSmartSnapDetailSettings(raw: unknown): SmartSnapDetailSettings {
    const d = DEFAULT_SMART_SNAP_DETAIL_SETTINGS;
    if (!raw || typeof raw !== "object") {
        return { ...d };
    }
    const o = raw as Record<string, unknown>;
    return {
        snapElementLayout: typeof o.snapElementLayout === "boolean" ? o.snapElementLayout : d.snapElementLayout,
        snapElementBorder: typeof o.snapElementBorder === "boolean" ? o.snapElementBorder : d.snapElementBorder,
        snapCanvasLayout: typeof o.snapCanvasLayout === "boolean" ? o.snapCanvasLayout : d.snapCanvasLayout,
    };
}

function areSmartSnapDetailSettingsEqual(a: SmartSnapDetailSettings, b: SmartSnapDetailSettings): boolean {
    return (
        a.snapElementLayout === b.snapElementLayout &&
        a.snapElementBorder === b.snapElementBorder &&
        a.snapCanvasLayout === b.snapCanvasLayout
    );
}
