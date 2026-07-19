import {
    UI_DOCUMENT_SCHEMA_VERSION,
    UIDocument,
    UISurface,
    UISurfaceId,
    UISurfaceKind,
    UIHost,
    UISurfaceDesignSize,
    UISurfaceSettings,
    UIStageSlotId,
    UIStageSurfaceMount,
    UIElement,
    UIElementId,
    UIElementValueBindingValueType,
    UIComponentDefinition,
    UIComponentId,
    UIBehaviorBinding,
    UISlotDefinition,
    UILayout,
    isUIFlowLayoutParentElement,
    uiElementTypeAcceptsChildren,
    getUIComponentLink,
    isLinkedUIComponentElement,
} from "@shared/types/ui-editor/document";
import { FsRejectErrorCode } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { translate } from "@/lib/i18n";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { roundUILayoutGeometryFields } from "@/lib/ui-editor/layout/roundLayoutGeometry";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IUIDocumentService, Services, WorkspaceContext } from "../services";
import { LocalBlueprintService } from "./LocalBlueprintService";
import { UIEditorHistoryService, cloneUIHistoryDocument } from "./UIEditorHistoryService";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";
import {
    applyPlannedMove,
    collectSubtreeElementIds,
    filterToTopLevelMovers,
    layoutPatchForReparent,
    normalizeFlowChildLayout,
    normalizeFlowChildLayouts,
    planMoveElementsInSurface,
    type MoveUiElementsResult,
} from "./uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { isValidUIInsertParent } from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import {
    cloneWidgetMainBlueprintForPaste,
    cloneWidgetValueBlueprintForPaste,
    remapElementBehaviorBlueprintIds,
    remapElementValueBindingBlueprintIds,
} from "./blueprint/cloneBlueprintForPaste";
import { registerPrivateBlueprintAsActive } from "./blueprint/ownerRecords";
import {
    componentWidgetMainOwnerKey,
    surfaceMainOwnerKey,
    widgetMainOwnerKey,
    widgetValueOwnerKey,
} from "./blueprint/ownerKeys";
import type {
    Blueprint,
    BlueprintGraphIr,
    BlueprintGraphNode,
    BlueprintOwnerRef,
    BlueprintPrivateOwnerRecord,
} from "@shared/types/blueprint/document";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "@shared/types/blueprint/graph";
import {
    DEFAULT_APP_SURFACE_NAME,
    DEFAULT_UI_DOCUMENT_NAME,
    DEFAULT_UI_ROOT_NAME,
    DEFAULT_UI_SURFACE_SIZE,
    MAIN_APP_SURFACE_ID,
} from "@shared/constants/ui-editor";
import { isListLikeWidgetType, type UIListElementExtra } from "@shared/types/ui-editor/list";
import { getUISliderChildSlot, type UISliderElementExtra } from "@shared/types/ui-editor/slider";
import { normalizeUIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import {
    DEFAULT_UI_STAGE_SLOT_ID,
    normalizeUIStageSlotId,
} from "@shared/types/ui-editor/stageSlots";
import { defaultContainerWidgetProps, type ContainerWidgetProps } from "@shared/types/ui-editor/container";
import { defaultTextWidgetProps, type TextWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import { defaultListWidgetProps, type ListWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/list/types";
import {
    createInitialContainerAppearance,
    createInitialTextAppearance,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";

type UIDocumentServiceEvents = {
    documentChanged: UIDocument;
    dirtyChanged: boolean;
};

type CreateSurfaceInput = {
    kind: UISurfaceKind;
    name: string;
    host: UIHost;
    designSize?: UISurfaceDesignSize;
    settings?: UISurfaceSettings;
    stageMount?: UIStageSurfaceMount;
};

type UIDocumentMutationHistoryOptions =
    | {
          surfaceId: string;
          mergeKey?: string;
          mergeWindowMs?: number;
      }
    | false;

type UIDocumentMutationOptions = {
    history?: UIDocumentMutationHistoryOptions;
};

const COMPONENT_EDITOR_SURFACE_ID_PREFIX = "component-editor:";

function createDefaultPageSurfaceSettings(settings?: UISurfaceSettings): UISurfaceSettings {
    return {
        ...settings,
        pageAnimation: normalizeUIPageAnimationSettings(settings?.pageAnimation),
    };
}

const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = DEFAULT_UI_STAGE_SLOT_ID;
const COMPONENT_LINKED_LAYOUT_KEYS = new Set<keyof UILayout>(["x", "y", "width", "height", "rotation"]);
const DEFAULT_COMPONENT_SIZE: UISurfaceDesignSize = { width: 240, height: 120 };
const DIALOG_SENTENCE_WIDGET_TYPE = "nl.dialog.sentence";
const NOTIFICATION_LIST_WIDGET_TYPE = "nl.notification.list";
const CHOICE_LIST_WIDGET_TYPE = "nl.choice.list";
const NVL_LIST_WIDGET_TYPE = "nl.nvl.list";
const NVL_TEXTS_WIDGET_TYPE = "nl.nvl.texts";

type DialogStageTemplate = {
    elements: Record<UIElementId, UIElement>;
    interactionLayerId: UIElementId;
    panelId: UIElementId;
    stackId: UIElementId;
    nametagId: UIElementId;
    sentenceId: UIElementId;
};

type NotificationStageTemplate = {
    elements: Record<UIElementId, UIElement>;
    listId: UIElementId;
    itemContainerId: UIElementId;
    itemTextId: UIElementId;
};

type ChoiceStageTemplate = {
    elements: Record<UIElementId, UIElement>;
    listId: UIElementId;
    itemContainerId: UIElementId;
    itemTextId: UIElementId;
};

type NvlStageTemplate = {
    elements: Record<UIElementId, UIElement>;
    interactionLayerId: UIElementId;
    panelId: UIElementId;
    listId: UIElementId;
    nametagId: UIElementId;
    textsId: UIElementId;
};

/** One stage-slot creation template: authored elements plus post-insert blueprint seeding. */
type StageSlotTemplate = {
    elements: Record<UIElementId, UIElement>;
    configure: (surfaceId: UISurfaceId) => void;
};

function getComponentPreviewDesignSize(component: UIComponentDefinition): UISurfaceDesignSize {
    return {
        width: component.previewMeta?.width ?? DEFAULT_COMPONENT_SIZE.width,
        height: component.previewMeta?.height ?? DEFAULT_COMPONENT_SIZE.height,
    };
}

type LegacyUISurfaceKind = "appSurface" | "playerStageSurface" | "playerOverlaySurface";

type LegacyUISurface = {
    id: UISurfaceId;
    name: string;
    host: UIHost;
    kind: LegacyUISurfaceKind;
    designSize: UISurfaceDesignSize;
    rootElementId: UIElementId;
    settings?: {
        backgroundColor?: string;
        stageElementType?: UIStageSlotId;
    };
    route?: {
        id?: string;
    };
    slots?: Record<string, UISlotDefinition>;
};

type LegacyUIDocument = Omit<UIDocument, "surfaces" | "schemaVersion"> & {
    schemaVersion: 1;
    surfaces: LegacyUISurface[];
};

function cloneJson<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function createDuplicateName(baseName: string, existingNames: Set<string>): string {
    const base = translate("defaultDoc.pageCopy", { name: baseName.trim() || translate("defaultDoc.pageName") });
    if (!existingNames.has(base)) {
        return base;
    }
    let i = 2;
    while (existingNames.has(`${base} ${i}`)) {
        i += 1;
    }
    return `${base} ${i}`;
}

function isReferenceKey(key: string, suffix: string): boolean {
    return key === suffix || key.endsWith(suffix[0].toUpperCase() + suffix.slice(1));
}

type SurfaceDuplicateRemapContext = {
    oldSurfaceId: string;
    newSurfaceId: string;
    elementIdMap: Record<string, string>;
    blueprintIdMap: Record<string, string>;
};

function remapSurfaceDuplicateReferenceValue<T>(value: T, ctx: SurfaceDuplicateRemapContext, key?: string): T {
    if (typeof value === "string") {
        if (key && isReferenceKey(key, "surfaceId") && value === ctx.oldSurfaceId) {
            return ctx.newSurfaceId as T;
        }
        if (key && isReferenceKey(key, "elementId") && ctx.elementIdMap[value]) {
            return ctx.elementIdMap[value] as T;
        }
        if (key && isReferenceKey(key, "blueprintId") && ctx.blueprintIdMap[value]) {
            return ctx.blueprintIdMap[value] as T;
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(item => remapSurfaceDuplicateReferenceValue(item, ctx)) as T;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            out[childKey] = remapSurfaceDuplicateReferenceValue(childValue, ctx, childKey);
        }
        return out as T;
    }
    return value;
}

function remapDuplicatedBlueprintOwner(owner: BlueprintOwnerRef, ctx: SurfaceDuplicateRemapContext): BlueprintOwnerRef | null {
    if (owner.kind === "surfaceMain" && owner.surfaceId === ctx.oldSurfaceId) {
        return { kind: "surfaceMain", surfaceId: ctx.newSurfaceId };
    }
    if (owner.kind === "widgetMain" && owner.surfaceId === ctx.oldSurfaceId) {
        const newElementId = ctx.elementIdMap[owner.elementId];
        return newElementId ? { kind: "widgetMain", surfaceId: ctx.newSurfaceId, elementId: newElementId } : null;
    }
    if (owner.kind === "widgetValue" && owner.surfaceId === ctx.oldSurfaceId) {
        const newElementId = ctx.elementIdMap[owner.elementId];
        return newElementId
            ? { kind: "widgetValue", surfaceId: ctx.newSurfaceId, elementId: newElementId, propPath: owner.propPath }
            : null;
    }
    return null;
}

function cloneBlueprintForSurfaceDuplicate(
    source: Blueprint,
    newBlueprintId: string,
    ctx: SurfaceDuplicateRemapContext,
): Blueprint | null {
    const owner = remapDuplicatedBlueprintOwner(source.owner, ctx);
    if (!owner) {
        return null;
    }
    const cloned = remapSurfaceDuplicateReferenceValue(cloneJson(source), ctx);
    cloned.id = newBlueprintId;
    cloned.owner = owner;
    return cloned;
}

function createContainerTemplateProps(overrides: Partial<ContainerWidgetProps>): ContainerWidgetProps {
    const props: ContainerWidgetProps = {
        ...cloneJson(defaultContainerWidgetProps),
        ...overrides,
    };
    props.appearance = createInitialContainerAppearance(props);
    return props;
}

function createTextTemplateProps(overrides: Partial<TextWidgetProps>): TextWidgetProps {
    const props: TextWidgetProps = {
        ...cloneJson(defaultTextWidgetProps),
        ...overrides,
    };
    props.appearance = createInitialTextAppearance(props);
    return props;
}

function createListTemplateProps(overrides: Partial<ListWidgetProps>): ListWidgetProps {
    const props: ListWidgetProps = {
        ...cloneJson(defaultListWidgetProps),
        ...overrides,
    };
    if (overrides.scrollbar) {
        props.scrollbar = {
            ...cloneJson(defaultListWidgetProps.scrollbar),
            ...overrides.scrollbar,
        };
    }
    return props;
}

function ensureElementSerializedAppearance(element: UIElement): boolean {
    if (element.type === "nl.container") {
        const props: ContainerWidgetProps = {
            ...cloneJson(defaultContainerWidgetProps),
            ...(element.props ?? {}),
        };
        if (isUsableAppearanceModel(props.appearance)) {
            return false;
        }
        props.appearance = createInitialContainerAppearance(props);
        element.props = props;
        return true;
    }
    const isTextLike =
        element.type === "nl.text" ||
        element.type === DIALOG_SENTENCE_WIDGET_TYPE ||
        element.type === NVL_TEXTS_WIDGET_TYPE;
    if (isTextLike) {
        const props: TextWidgetProps = {
            ...cloneJson(defaultTextWidgetProps),
            ...(element.props ?? {}),
        };
        if (isUsableAppearanceModel(props.appearance)) {
            return false;
        }
        props.appearance = createInitialTextAppearance(props);
        element.props = props;
        return true;
    }
    return false;
}

function sanitizeComponentName(name: string | undefined, fallback: string): string {
    const trimmed = String(name ?? "").trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

function stripElementForComponentDefinition(element: UIElement): UIElement {
    const next = cloneJson(element);
    if (next.extra?.componentLink) {
        const { componentLink: _componentLink, ...rest } = next.extra;
        next.extra = Object.keys(rest).length > 0 ? rest : undefined;
    }
    delete next.behavior;
    delete next.valueBindings;
    return next;
}

function collectComponentSubtreeElementIds(elements: Record<string, UIElement>, rootElementId: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (elementId: string) => {
        if (seen.has(elementId)) {
            return;
        }
        const element = elements[elementId];
        if (!element) {
            return;
        }
        seen.add(elementId);
        out.push(elementId);
        element.childrenIds.forEach(walk);
    };
    walk(rootElementId);
    return out;
}

function calculateElementsBounds(elements: UIElement[]): UISurfaceDesignSize & { x: number; y: number } {
    if (elements.length === 0) {
        return { x: 0, y: 0, ...DEFAULT_COMPONENT_SIZE };
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const element of elements) {
        const x0 = Math.min(element.layout.x, element.layout.x + element.layout.width);
        const y0 = Math.min(element.layout.y, element.layout.y + element.layout.height);
        const x1 = Math.max(element.layout.x, element.layout.x + element.layout.width);
        const y1 = Math.max(element.layout.y, element.layout.y + element.layout.height);
        minX = Math.min(minX, x0);
        minY = Math.min(minY, y0);
        maxX = Math.max(maxX, x1);
        maxY = Math.max(maxY, y1);
    }
    return {
        x: Number.isFinite(minX) ? minX : 0,
        y: Number.isFinite(minY) ? minY : 0,
        width: Math.max(1, Number.isFinite(maxX - minX) ? maxX - minX : DEFAULT_COMPONENT_SIZE.width),
        height: Math.max(1, Number.isFinite(maxY - minY) ? maxY - minY : DEFAULT_COMPONENT_SIZE.height),
    };
}

export class UIDocumentService extends Service<UIDocumentService> implements IUIDocumentService {
    private document: UIDocument | null = null;
    private readonly events = new EventEmitter<UIDocumentServiceEvents>();
    private revision = 0;
    private lastSavedRevision = 0;
    private dirty = false;
    private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly autoSaveDelay = 800;
    private afterMutateHook: (() => void) | null = null;
    private historySuppressionDepth = 0;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);

        await this.ensureDocumentDir();
        await this.load();
    }

    public getDocument(): UIDocument {
        if (!this.document) {
            throw new RendererError("UI document not initialized");
        }
        return this.document;
    }

    public async load(): Promise<UIDocument> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const documentPath = this.getDocumentPath();
        const exists = await fs.isFileExists(documentPath);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access UI document path");
        }

        if (!exists.data) {
            const created = this.createEmptyDocument();
            await this.save(created);
            this.document = created;
            return created;
        }

        const result = await fs.readJSON<UIDocument>(documentPath);
        if (!result.ok) {
            if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
                const created = this.createEmptyDocument();
                await this.save(created);
                this.document = created;
                return created;
            }
            throw new RendererError(result.error.message);
        }

        const loadedSnapshot = JSON.stringify(result.data);
        const migrated = this.migrateIfNeeded(result.data);
        this.document = migrated;
        const schemaChanged = result.data.schemaVersion !== migrated.schemaVersion;
        const normalizedChanged = loadedSnapshot !== JSON.stringify(migrated);
        const mainSurfaceChanged = this.ensureMainSurface(this.document);
        const flowLayoutsChanged = normalizeFlowChildLayouts(this.document);
        const needsSave = schemaChanged || normalizedChanged || mainSurfaceChanged || flowLayoutsChanged;
        if (needsSave) {
            await this.save(this.document);
            this.revision = 0;
            this.lastSavedRevision = 0;
            this.setDirty(false);
            return this.document;
        }
        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("documentChanged", this.document);
        return migrated;
    }

    public async save(document: UIDocument): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        await this.ensureDocumentDir();
        const documentPath = this.getDocumentPath();
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        const updated: UIDocument = {
            ...document,
            meta: {
                ...document.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        const data = JSON.stringify(updated, null, 2);
        const result = await fs.write(documentPath, data, "utf-8");
        if (!result.ok) {
            throw new RendererError(result.error.message);
        }
        this.document = updated;
        this.lastSavedRevision = this.revision;
        this.setDirty(false);
        this.events.emit("documentChanged", this.document);
    }

    public onDocumentChanged(handler: (doc: UIDocument) => void): () => void {
        return this.events.on("documentChanged", handler);
    }

    public onDirtyChanged(handler: (dirty: boolean) => void): () => void {
        return this.events.on("dirtyChanged", handler);
    }

    public setAfterMutateHook(hook: (() => void) | null): void {
        this.afterMutateHook = hook;
    }

    public restoreDocumentFromHistory(
        document: UIDocument,
        options: { skipAfterMutateHook?: boolean } = {},
    ): void {
        const next = cloneUIHistoryDocument(document);
        normalizeFlowChildLayouts(next);
        this.document = next;
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", this.document);
        if (!options.skipAfterMutateHook) {
            this.afterMutateHook?.();
        }
    }

    public runSurfaceHistoryTransaction(surfaceId: string, action: () => void): void {
        const historyService = this.getHistoryService();
        if (!historyService) {
            action();
            return;
        }
        const beforeHistory = historyService.captureSnapshot(surfaceId);
        this.historySuppressionDepth += 1;
        try {
            action();
        } finally {
            this.historySuppressionDepth -= 1;
        }
        historyService.record({
            surfaceId,
            before: beforeHistory,
            after: historyService.captureSnapshot(surfaceId),
        });
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public getRevision(): number {
        return this.revision;
    }

    public updateElementLayout(
        elementId: string,
        layoutPatch: Partial<UILayout>,
        options: { skipHistory?: boolean } = {},
    ): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const patchKeys = Object.keys(layoutPatch).sort();
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            const effectivePatch = isLinkedUIComponentElement(element)
                ? this.filterLinkedComponentLayoutPatch(layoutPatch)
                : layoutPatch;
            if (Object.keys(effectivePatch).length === 0) {
                return;
            }
            element.layout = roundUILayoutGeometryFields({
                ...element.layout,
                ...effectivePatch,
            });
            normalizeFlowChildLayout(document, element);
        }, {
            history: !options.skipHistory && surfaceId
                ? {
                      surfaceId,
                      mergeKey: `layout:${elementId}:${patchKeys.join(",")}`,
                  }
                : false,
        });
    }

    public updateElementLayouts(layoutPatches: Record<string, Partial<UILayout>>): void {
        const elementIds = Object.keys(layoutPatches);
        if (elementIds.length === 0) {
            return;
        }
        const surfaceId = this.getCommonSurfaceIdForElements(elementIds);
        this.mutateDocument(document => {
            elementIds.forEach(elementId => {
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                const patch = isLinkedUIComponentElement(element)
                    ? this.filterLinkedComponentLayoutPatch(layoutPatches[elementId])
                    : layoutPatches[elementId];
                if (Object.keys(patch).length === 0) {
                    return;
                }
                element.layout = roundUILayoutGeometryFields({
                    ...element.layout,
                    ...patch,
                });
                normalizeFlowChildLayout(document, element);
            });
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public updateElementProps(elementId: string, propsPatch: Record<string, unknown>): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            if (isLinkedUIComponentElement(element)) {
                return;
            }
            element.props = {
                ...(element.props ?? {}),
                ...propsPatch,
            };
            normalizeFlowChildLayout(document, element);
            if (isUIFlowLayoutParentElement(element)) {
                normalizeFlowChildLayouts(document, element.childrenIds);
            }
        }, {
            history: surfaceId
                ? {
                      surfaceId,
                      mergeKey: `props:${elementId}:${Object.keys(propsPatch).sort().join(",")}`,
                  }
                : false,
        });
    }

    public ensureElementBlueprintValueBinding(
        elementId: string,
        propPath: string,
        input: { valueType: UIElementValueBindingValueType; displayName?: string; literalValue?: unknown },
    ): { blueprintId: string } {
        const surfaceId = this.getElementSurfaceId(elementId);
        if (!surfaceId) {
            throw new RendererError(`Element ${elementId} does not belong to a surface`);
        }
        if (isLinkedUIComponentElement(this.getDocument().elements[elementId])) {
            throw new RendererError("Linked component instances cannot edit Blueprint Value bindings");
        }
        const historyService = this.getHistoryService();
        const beforeHistory = historyService ? historyService.captureSnapshot(surfaceId) : null;
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const blueprintId = localBp.ensureWidgetValueBlueprint({
            surfaceId,
            elementId,
            propPath,
            valueType: input.valueType,
            displayName: input.displayName,
            literalValue: input.literalValue,
        });
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            element.valueBindings = {
                ...(element.valueBindings ?? {}),
                [propPath]: {
                    kind: "blueprintValue",
                    blueprintId,
                    valueType: input.valueType,
                },
            };
        }, { history: false });
        if (historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }
        return { blueprintId };
    }

    public clearElementBlueprintValueBinding(elementId: string, propPath: string): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        if (!surfaceId) {
            return;
        }
        if (isLinkedUIComponentElement(this.getDocument().elements[elementId])) {
            return;
        }
        const historyService = this.getHistoryService();
        const beforeHistory = historyService ? historyService.captureSnapshot(surfaceId) : null;
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        localBp.removeWidgetValueBlueprint(surfaceId, elementId, propPath);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element?.valueBindings) {
                return;
            }
            delete element.valueBindings[propPath];
            if (Object.keys(element.valueBindings).length === 0) {
                delete element.valueBindings;
            }
        }, { history: false });
        if (historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }
    }

    public updateElementExtra(elementId: string, extraPatch: Record<string, unknown>): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            if (isLinkedUIComponentElement(element)) {
                return;
            }
            element.extra = {
                ...(element.extra ?? {}),
                ...extraPatch,
            };
            normalizeFlowChildLayout(document, element);
        }, {
            history: surfaceId
                ? {
                      surfaceId,
                      mergeKey: `extra:${elementId}:${Object.keys(extraPatch).sort().join(",")}`,
                  }
                : false,
        });
    }

    public reorderChildren(parentId: string, orderedChildIds: string[]): void {
        const surfaceId = this.getElementSurfaceId(parentId);
        this.mutateDocument(document => {
            const parent = document.elements[parentId];
            if (!parent || isLinkedUIComponentElement(parent)) {
                return;
            }
            parent.childrenIds = [...orderedChildIds];
            normalizeFlowChildLayouts(document, orderedChildIds);
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public moveElementsInSurface(
        surfaceId: string,
        elementIds: string[],
        targetParentId: string,
        beforeChildId: string | null,
    ): MoveUiElementsResult {
        const document = this.getDocument();
        if (isLinkedUIComponentElement(document.elements[targetParentId])) {
            return { ok: false, reason: "invalid_target" };
        }
        const planned = planMoveElementsInSurface(document, surfaceId, elementIds, targetParentId, beforeChildId);
        if (!planned.ok) {
            return planned;
        }
        this.mutateDocument(doc => {
            applyPlannedMove(doc, planned.plan);
            const targetParent = doc.elements[targetParentId];
            if (isListLikeWidgetType(targetParent?.type)) {
                for (const elementId of elementIds) {
                    const moved = doc.elements[elementId];
                    const slot = moved?.extra?.listSlot;
                    if (
                        moved &&
                        slot !== "itemTemplate" &&
                        slot !== "scrollbarTrack" &&
                        slot !== "scrollbarThumb"
                    ) {
                        moved.extra = {
                            ...(moved.extra ?? {}),
                            listSlot: "itemTemplate",
                        };
                    }
                }
            }
        }, {
            history: { surfaceId },
        });
        return { ok: true };
    }

    public renameElement(elementId: string, name: string): void {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const el = document.elements[elementId];
            if (!el || el.type === "nl.root" || isLinkedUIComponentElement(el)) {
                return;
            }
            el.name = trimmed;
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public deleteElements(elementIds: string[]): void {
        if (elementIds.length === 0) {
            return;
        }
        const surfaceId = this.getCommonSurfaceIdForElements(elementIds);
        this.mutateDocument(document => {
            const rootIds = new Set(document.surfaces.map(surface => surface.rootElementId));
            const toRemove = new Set<string>();

            const collect = (elementId: string) => {
                if (toRemove.has(elementId) || rootIds.has(elementId)) {
                    return;
                }
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                toRemove.add(elementId);
                element.childrenIds.forEach(childId => collect(childId));
            };

            elementIds.forEach(id => collect(id));

            if (toRemove.size === 0) {
                return;
            }

            for (const element of Object.values(document.elements)) {
                if (element.childrenIds.length > 0) {
                    element.childrenIds = element.childrenIds.filter(childId => !toRemove.has(childId));
                }
            }

            for (const id of toRemove) {
                delete document.elements[id];
            }
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    private mutateDocument(mutator: (document: UIDocument) => void, options: UIDocumentMutationOptions = {}): void {
        const historyService = this.getHistoryService();
        const historyOptions = options.history;
        const beforeHistory =
            historyService && historyOptions && this.historySuppressionDepth === 0
                ? historyService.captureSnapshot(historyOptions.surfaceId)
                : null;
        const document = this.getDocument();
        mutator(document);
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", document);
        this.afterMutateHook?.();
        if (historyService && historyOptions && beforeHistory && this.historySuppressionDepth === 0) {
            historyService.record({
                surfaceId: historyOptions.surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(historyOptions.surfaceId),
                mergeKey: historyOptions.mergeKey,
                mergeWindowMs: historyOptions.mergeWindowMs,
            });
        }
    }

    private scheduleAutoSave(): void {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            void this.save(this.getDocument()).catch(err => {
                console.warn("[UIDocumentService] auto-save failed", err);
            });
        }, this.autoSaveDelay);
    }

    private setDirty(value: boolean): void {
        if (this.dirty === value) {
            return;
        }
        this.dirty = value;
        this.events.emit("dirtyChanged", value);
    }

    private getHistoryService(): UIEditorHistoryService | null {
        try {
            return this.getContext().services.get<UIEditorHistoryService>(Services.UIEditorHistory);
        } catch {
            return null;
        }
    }

    private getElementSurfaceId(elementId: string): string | null {
        const document = this.getDocument();
        let currentId: string | null = elementId;
        while (currentId) {
            const element: UIElement | undefined = document.elements[currentId];
            if (!element) {
                return null;
            }
            if (element.parentId === null) {
                return document.surfaces.find(surface => surface.rootElementId === currentId)?.id ?? null;
            }
            currentId = element.parentId;
        }
        return null;
    }

    private getCommonSurfaceIdForElements(elementIds: string[]): string | null {
        let surfaceId: string | null = null;
        for (const elementId of elementIds) {
            const nextSurfaceId = this.getElementSurfaceId(elementId);
            if (!nextSurfaceId) {
                continue;
            }
            if (!surfaceId) {
                surfaceId = nextSurfaceId;
                continue;
            }
            if (surfaceId !== nextSurfaceId) {
                return null;
            }
        }
        return surfaceId;
    }

    private filterLinkedComponentLayoutPatch(layoutPatch: Partial<UILayout>): Partial<UILayout> {
        const out: Partial<UILayout> = {};
        for (const [key, value] of Object.entries(layoutPatch) as Array<[keyof UILayout, UILayout[keyof UILayout]]>) {
            if (COMPONENT_LINKED_LAYOUT_KEYS.has(key)) {
                (out as Record<string, unknown>)[key] = value;
            }
        }
        return out;
    }

    private migrateIfNeeded(document: UIDocument): UIDocument {
        if (document.schemaVersion > UI_DOCUMENT_SCHEMA_VERSION) {
            throw new RendererError("UI document schema is newer than this Studio version");
        }
        if (document.schemaVersion === UI_DOCUMENT_SCHEMA_VERSION) {
            return this.normalizeSpecialChildSlots(this.ensureComponentLibrary(document));
        }
        if (document.schemaVersion === 1) {
            return this.migrateFromLegacyDocument(document);
        }
        if (document.schemaVersion === 2) {
            return this.migrateFromV2Document(document);
        }
        if (document.schemaVersion === 3) {
            return this.migrateFromV3Document(document);
        }
        if (document.schemaVersion === 4) {
            return this.migrateFromV4Document(document);
        }
        if (document.schemaVersion === 5) {
            return this.migrateFromV5Document(document);
        }
        if (document.schemaVersion === 6) {
            return this.migrateFromV6Document(document);
        }
        if (document.schemaVersion === 7) {
            return this.migrateFromV7Document(document);
        }
        if (document.schemaVersion === 8) {
            return this.migrateFromV8Document(document);
        }
        if (document.schemaVersion === 9) {
            return this.migrateFromV9Document(document);
        }
        if (document.schemaVersion === 10) {
            return this.migrateFromV10Document(document);
        }
        throw new RendererError("UI document migration is not implemented");
    }

    private withComponentLibrary(document: UIDocument): UIDocument {
        return {
            ...document,
            components: Array.isArray((document as UIDocument & { components?: unknown }).components)
                ? (document as UIDocument & { components: UIComponentDefinition[] }).components
                : [],
        };
    }

    private ensureComponentLibrary(document: UIDocument): UIDocument {
        return this.withComponentLibrary(document);
    }

    private migrateFromLegacyDocument(document: UIDocument): UIDocument {
        const legacy = document as LegacyUIDocument;
        const migratedSurfaces = legacy.surfaces.map(surface => this.migrateLegacySurface(surface));
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            surfaces: migratedSurfaces,
        });
    }

    private migrateFromV2Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    private migrateFromV3Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    /** P5 hard cutover marker: documents authored on schema 4 (unified container model) bump to current. */
    private migrateFromV4Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    /** P6: list child slots distinguish item template children from authored scrollbar parts. */
    private migrateFromV5Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    /** P7: per-property Blueprint Value bindings live on UIElement.valueBindings. */
    private migrateFromV6Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    /** P8: slider widgets own authored track / handle container parts. */
    private migrateFromV7Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    /** P9: project-level UI component library. */
    private migrateFromV8Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    /** P10: Game UI stage slots are normalized and Dialog gets slot-private widgets. */
    private migrateFromV9Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    /** P11: `nvl` stage slot plus list-like Game UI slot widgets. */
    private migrateFromV10Document(document: UIDocument): UIDocument {
        return this.normalizeSpecialChildSlots({
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    private normalizeSpecialChildSlots(document: UIDocument): UIDocument {
        document = this.withComponentLibrary(document);
        for (const surface of document.surfaces) {
            if (surface.kind !== "stageSurface") {
                continue;
            }
            const rawMount = (surface as UISurface & { mount?: unknown }).mount;
            const rawMountRecord = rawMount && typeof rawMount === "object"
                ? rawMount as Record<string, unknown>
                : {};
            surface.mount = {
                kind: "slot",
                slotId: normalizeUIStageSlotId(rawMountRecord.slotId),
            };
            surface.settings = {
                backgroundColor: "transparent",
                ...(surface.settings ?? {}),
            };
        }
        for (const element of Object.values(document.elements)) {
            ensureElementSerializedAppearance(element);
            if (isListLikeWidgetType(element.type)) {
                const props = (element.props ?? {}) as Record<string, unknown>;
                const scrollbar = props.scrollbar && typeof props.scrollbar === "object"
                    ? props.scrollbar as Record<string, unknown>
                    : {};
                const trackElementId = typeof scrollbar.trackElementId === "string" ? scrollbar.trackElementId : null;
                const thumbElementId = typeof scrollbar.thumbElementId === "string" ? scrollbar.thumbElementId : null;
                for (const childId of element.childrenIds) {
                    const child = document.elements[childId];
                    if (!child) {
                        continue;
                    }
                    const slot = child.extra?.listSlot;
                    if (slot === "itemTemplate" || slot === "scrollbarTrack" || slot === "scrollbarThumb") {
                        continue;
                    }
                    child.extra = {
                        ...(child.extra ?? {}),
                        listSlot:
                            childId === trackElementId
                                ? "scrollbarTrack"
                                : childId === thumbElementId
                                  ? "scrollbarThumb"
                                  : "itemTemplate",
                    };
                }
                continue;
            }
            if (element.type === "nl.slider") {
                const props = (element.props ?? {}) as Record<string, unknown>;
                const trackElementId = typeof props.trackElementId === "string" ? props.trackElementId : null;
                const handleElementId = typeof props.handleElementId === "string" ? props.handleElementId : null;
                for (const childId of element.childrenIds) {
                    const child = document.elements[childId];
                    if (!child || getUISliderChildSlot(child.extra) != null) {
                        continue;
                    }
                    const sliderSlot =
                        childId === handleElementId
                            ? "handle"
                            : childId === trackElementId
                              ? "track"
                              : null;
                    if (!sliderSlot) {
                        continue;
                    }
                    child.extra = {
                        ...(child.extra ?? {}),
                        sliderSlot,
                    };
                }
            }
        }
        return document;
    }

    private migrateLegacySurface(surface: LegacyUISurface): UISurface {
        const settings = surface.settings
            ? { backgroundColor: surface.settings.backgroundColor }
            : undefined;

        if (surface.kind === "appSurface") {
            return {
                id: surface.id,
                name: surface.name,
                host: "app",
                kind: "appSurface",
                designSize: surface.designSize,
                rootElementId: surface.rootElementId,
                settings,
            };
        }

        const stageMount: UIStageSurfaceMount = {
            kind: "slot",
            slotId: normalizeUIStageSlotId(surface.settings?.stageElementType),
        };

        return {
            id: surface.id,
            name: surface.name,
            host: "player",
            kind: "stageSurface",
            designSize: surface.designSize,
            rootElementId: surface.rootElementId,
            settings: {
                backgroundColor: "transparent",
                ...(settings ?? {}),
            },
            mount: stageMount,
            slots: surface.slots,
        };
    }

    private createEmptyDocument(): UIDocument {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const designSize = this.getProjectDesignSize();
        const now = new Date().toISOString();
        const documentId = uuidService.generate();
        const rootElementId = uuidService.generate();

        const rootElement = this.createRootElement(rootElementId, designSize);

        const surface: UISurface = {
            id: MAIN_APP_SURFACE_ID,
            name: DEFAULT_APP_SURFACE_NAME,
            host: "app",
            kind: "appSurface",
            designSize: {
                width: designSize.width,
                height: designSize.height,
            },
            rootElementId,
            settings: createDefaultPageSurfaceSettings(),
        };

        const doc: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: documentId,
            name: DEFAULT_UI_DOCUMENT_NAME,
            surfaces: [surface],
            components: [],
            elements: {
                [rootElementId]: rootElement,
            },
            meta: {
                createdAt: now,
                updatedAt: now,
            },
        };
        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("documentChanged", doc);
        return doc;
    }

    public createSurface(input: CreateSurfaceInput): UISurface {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const designSize = input.designSize ?? this.getProjectDesignSize();
        const rootElementId = uuidService.generate();
        const surfaceId = uuidService.generate();

        const { kind, name, host, settings, stageMount } = input;
        const effectiveMount =
            kind === "stageSurface"
                ? {
                      kind: "slot" as const,
                      slotId: normalizeUIStageSlotId(stageMount?.slotId),
                  }
                : undefined;

        if (kind === "stageSurface" && host !== "player") {
            throw new RendererError("Game UI must be hosted by player");
        }
        if (kind === "appSurface" && host !== "app") {
            throw new RendererError("Pages must be hosted by app");
        }
        if (kind === "stageSurface") {
            const existing = this.getDocument().surfaces.find(surface =>
                surface.kind === "stageSurface" && surface.mount.slotId === effectiveMount?.slotId
            );
            if (existing) {
                return existing;
            }
        }

        const surface: UISurface =
            kind === "stageSurface"
                ? {
                      id: surfaceId,
                      name,
                      host: "player",
                      kind,
                      designSize,
                      rootElementId,
                      settings: {
                          backgroundColor: "transparent",
                          ...(settings ?? {}),
                      },
                      mount: effectiveMount ?? { kind: "slot", slotId: DEFAULT_STAGE_SLOT_ID },
                  }
                : {
                      id: surfaceId,
                      name,
                      host: "app",
                      kind,
                      designSize,
                      rootElementId,
                      settings: createDefaultPageSurfaceSettings(settings),
                  };

        const rootElement = this.createRootElement(rootElementId, designSize);
        const stageTemplate =
            kind === "stageSurface" && effectiveMount
                ? this.createStageSlotTemplate(effectiveMount.slotId, rootElement, designSize)
                : null;
        const templateElements = stageTemplate?.elements ?? {};

        this.mutateDocument(document => {
            document.elements[rootElementId] = rootElement;
            Object.assign(document.elements, templateElements);
            document.surfaces.push(surface);
        });
        stageTemplate?.configure(surface.id);

        return surface;
    }

    public deleteSurface(surfaceId: string): void {
        if (surfaceId === MAIN_APP_SURFACE_ID) {
            return;
        }
        this.mutateDocument(document => {
            const index = document.surfaces.findIndex(surface => surface.id === surfaceId);
            if (index === -1) {
                return;
            }
            const surface = document.surfaces[index];
            document.surfaces.splice(index, 1);

            const toRemove = new Set<string>();
            const collect = (elementId: string) => {
                if (toRemove.has(elementId)) {
                    return;
                }
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                toRemove.add(elementId);
                element.childrenIds.forEach(childId => collect(childId));
            };
            collect(surface.rootElementId);

            for (const element of Object.values(document.elements)) {
                if (element.childrenIds.length > 0) {
                    element.childrenIds = element.childrenIds.filter(childId => !toRemove.has(childId));
                }
            }

            for (const id of toRemove) {
                delete document.elements[id];
            }
        });
    }

    public renameSurface(surfaceId: string, name: string): void {
        const nextName = name.trim();
        if (!nextName) {
            return;
        }
        const currentSurface = this.getDocument().surfaces.find(surface => surface.id === surfaceId);
        if (!currentSurface || currentSurface.name === nextName) {
            return;
        }
        this.mutateDocument(document => {
            const surface = document.surfaces.find(next => next.id === surfaceId);
            if (!surface) {
                return;
            }
            surface.name = nextName;
        });
    }

    public updateSurface(surfaceId: string, updater: (surface: UISurface) => void): void {
        this.mutateDocument(document => {
            const surface = document.surfaces.find(next => next.id === surfaceId);
            if (!surface) {
                return;
            }
            const isMainSurface = surface.id === MAIN_APP_SURFACE_ID;
            updater(surface);
            if (isMainSurface) {
                surface.id = MAIN_APP_SURFACE_ID;
            }
        });
    }

    public duplicateSurface(surfaceId: string, name?: string): UISurface | null {
        const sourceDocument = this.getDocument();
        const sourceSurface = sourceDocument.surfaces.find(next => next.id === surfaceId);
        if (!sourceSurface || sourceSurface.kind !== "appSurface") {
            return null;
        }
        const sourceRootId = sourceSurface.rootElementId;
        if (!sourceDocument.elements[sourceRootId]) {
            return null;
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const newSurfaceId = uuidService.generate();
        const sourceElementIds = Array.from(collectSubtreeElementIds(sourceDocument, sourceRootId))
            .filter(elementId => Boolean(sourceDocument.elements[elementId]));
        const elementIdMap: Record<string, string> = {};
        for (const elementId of sourceElementIds) {
            elementIdMap[elementId] = uuidService.generate();
        }
        const newRootElementId = elementIdMap[sourceRootId];
        if (!newRootElementId) {
            return null;
        }

        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }

        const blueprintIdMap: Record<string, string> = {};
        const ownerRecordsToClone: Record<string, BlueprintPrivateOwnerRecord> = {};
        const sourceBlueprintDocument = localBp?.getBlueprintDocument();
        if (sourceBlueprintDocument) {
            for (const [ownerKey, ownerRecord] of Object.entries(sourceBlueprintDocument.ownerRecords)) {
                const firstBlueprint = ownerRecord.privateBlueprintIds
                    .map(blueprintId => sourceBlueprintDocument.blueprints[blueprintId])
                    .find((blueprint): blueprint is Blueprint => Boolean(blueprint));
                const owner = firstBlueprint?.owner;
                if (!owner || !remapDuplicatedBlueprintOwner(owner, {
                    oldSurfaceId: sourceSurface.id,
                    newSurfaceId,
                    elementIdMap,
                    blueprintIdMap: {},
                })) {
                    continue;
                }
                ownerRecordsToClone[ownerKey] = cloneJson(ownerRecord);
                for (const blueprintId of ownerRecord.privateBlueprintIds) {
                    if (sourceBlueprintDocument.blueprints[blueprintId] && !blueprintIdMap[blueprintId]) {
                        blueprintIdMap[blueprintId] = uuidService.generate();
                    }
                }
            }
        }

        const remapContext: SurfaceDuplicateRemapContext = {
            oldSurfaceId: sourceSurface.id,
            newSurfaceId,
            elementIdMap,
            blueprintIdMap,
        };
        const existingNames = new Set(sourceDocument.surfaces.map(surface => surface.name));
        const nextName = name?.trim() || createDuplicateName(sourceSurface.name, existingNames);
        const duplicatedSurface: UISurface = {
            ...cloneJson(sourceSurface),
            id: newSurfaceId,
            name: nextName,
            rootElementId: newRootElementId,
            settings: sourceSurface.settings
                ? remapSurfaceDuplicateReferenceValue(cloneJson(sourceSurface.settings), remapContext)
                : undefined,
        };

        localBp?.applyBlueprintMutation(bpDoc => {
            for (const sourceOwnerRecord of Object.values(ownerRecordsToClone)) {
                const clonedBlueprintIds = sourceOwnerRecord.privateBlueprintIds
                    .map(oldBlueprintId => blueprintIdMap[oldBlueprintId])
                    .filter((blueprintId): blueprintId is string => Boolean(blueprintId));
                const activeBlueprintId = blueprintIdMap[sourceOwnerRecord.activeBlueprintId];
                if (!activeBlueprintId || clonedBlueprintIds.length === 0) {
                    continue;
                }
                const firstSourceBlueprint = sourceOwnerRecord.privateBlueprintIds
                    .map(oldBlueprintId => sourceBlueprintDocument?.blueprints[oldBlueprintId])
                    .find((blueprint): blueprint is Blueprint => Boolean(blueprint));
                const newOwner = firstSourceBlueprint ? remapDuplicatedBlueprintOwner(firstSourceBlueprint.owner, remapContext) : null;
                if (!newOwner) {
                    continue;
                }
                let newOwnerKey: string;
                if (newOwner.kind === "surfaceMain") {
                    newOwnerKey = surfaceMainOwnerKey(newOwner.surfaceId);
                } else if (newOwner.kind === "widgetMain") {
                    newOwnerKey = widgetMainOwnerKey(newOwner.surfaceId, newOwner.elementId);
                } else if (newOwner.kind === "widgetValue") {
                    newOwnerKey = widgetValueOwnerKey(newOwner.surfaceId, newOwner.elementId, newOwner.propPath);
                } else {
                    continue;
                }
                for (const oldBlueprintId of sourceOwnerRecord.privateBlueprintIds) {
                    const sourceBlueprint = sourceBlueprintDocument?.blueprints[oldBlueprintId];
                    const newBlueprintId = blueprintIdMap[oldBlueprintId];
                    if (!sourceBlueprint || !newBlueprintId) {
                        continue;
                    }
                    const clonedBlueprint = cloneBlueprintForSurfaceDuplicate(sourceBlueprint, newBlueprintId, remapContext);
                    if (clonedBlueprint) {
                        bpDoc.blueprints[newBlueprintId] = clonedBlueprint;
                    }
                }
                bpDoc.ownerRecords[newOwnerKey] = {
                    ...cloneJson(sourceOwnerRecord),
                    activeBlueprintId,
                    privateBlueprintIds: clonedBlueprintIds,
                };
            }
        });

        const duplicatedElements: Record<string, UIElement> = {};
        for (const oldElementId of sourceElementIds) {
            const sourceElement = sourceDocument.elements[oldElementId];
            const newElementId = elementIdMap[oldElementId];
            if (!sourceElement || !newElementId) {
                continue;
            }
            const copy = cloneJson(sourceElement);
            copy.id = newElementId;
            copy.parentId = sourceElement.parentId ? elementIdMap[sourceElement.parentId] ?? null : null;
            copy.childrenIds = sourceElement.childrenIds
                .filter(childId => Boolean(elementIdMap[childId]))
                .map(childId => elementIdMap[childId]);
            copy.props = copy.props
                ? remapSurfaceDuplicateReferenceValue(copy.props, remapContext)
                : undefined;
            copy.style = copy.style
                ? remapSurfaceDuplicateReferenceValue(copy.style, remapContext)
                : undefined;
            copy.extra = copy.extra
                ? remapSurfaceDuplicateReferenceValue(copy.extra, remapContext)
                : undefined;
            if (copy.behavior?.events) {
                copy.behavior = {
                    ...copy.behavior,
                    events: remapElementBehaviorBlueprintIds(copy.behavior.events, blueprintIdMap),
                };
            }
            if (copy.valueBindings) {
                copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
            }
            duplicatedElements[newElementId] = copy;
        }

        this.mutateDocument(document => {
            Object.assign(document.elements, duplicatedElements);
            const sourceIndex = document.surfaces.findIndex(surface => surface.id === sourceSurface.id);
            if (sourceIndex >= 0) {
                document.surfaces.splice(sourceIndex + 1, 0, duplicatedSurface);
            } else {
                document.surfaces.push(duplicatedSurface);
            }
            normalizeFlowChildLayouts(document, Object.keys(duplicatedElements));
        });

        return duplicatedSurface;
    }

    public getComponent(componentId: string): UIComponentDefinition | undefined {
        return (this.getDocument().components ?? []).find(component => component.id === componentId);
    }

    public getComponentUsageCount(componentId: string): number {
        let count = 0;
        for (const element of Object.values(this.getDocument().elements)) {
            const link = getUIComponentLink(element);
            if (link?.componentId === componentId) {
                count += 1;
            }
        }
        return count;
    }

    public createEmptyComponent(name?: string): UIComponentDefinition {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const now = new Date().toISOString();
        const componentId = uuidService.generate();
        const rootElementId = uuidService.generate();
        const containerModule = widgetModuleRegistry.get("nl.container");
        const defaults = containerModule?.createDefaultElement() ?? {};
        const rootElement: UIElement = {
            id: rootElementId,
            type: "nl.container",
            name: translate("defaultDoc.rootName"),
            parentId: null,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: defaults.layout?.width ?? DEFAULT_COMPONENT_SIZE.width,
                height: defaults.layout?.height ?? DEFAULT_COMPONENT_SIZE.height,
                opacity: defaults.layout?.opacity ?? 1,
                visible: defaults.layout?.visible ?? true,
                rotation: defaults.layout?.rotation,
            }),
            props: defaults.props,
            style: defaults.style,
            extra: defaults.extra,
        };
        const component: UIComponentDefinition = {
            id: componentId,
            name: sanitizeComponentName(name, translate("defaultDoc.componentName")),
            rootElementId,
            elements: {
                [rootElementId]: rootElement,
            },
            previewMeta: {
                width: rootElement.layout.width,
                height: rootElement.layout.height,
            },
            createdAt: now,
            updatedAt: now,
        };
        this.mutateDocument(document => {
            document.components = [...(document.components ?? []), component];
        }, { history: false });
        return component;
    }

    public createComponentFromElements(surfaceId: string, elementIds: string[], name?: string): UIComponentDefinition | null {
        const document = this.getDocument();
        const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
        if (!effectiveRootId || elementIds.length === 0) {
            return null;
        }
        const allowed = collectSubtreeElementIds(document, effectiveRootId);
        const topLevelIds = filterToTopLevelMovers(document, elementIds)
            .filter(id => {
                const element = document.elements[id];
                return element && element.type !== "nl.root" && allowed.has(id);
            });
        if (topLevelIds.length === 0) {
            return null;
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const now = new Date().toISOString();
        const componentId = uuidService.generate();
        const elementIdMap: Record<string, string> = {};
        const componentElements: Record<string, UIElement> = {};
        const selectedTopElements = topLevelIds
            .map(id => document.elements[id])
            .filter((element): element is UIElement => Boolean(element));
        const bounds = calculateElementsBounds(selectedTopElements);

        const collectSourceIds = (rootId: string) => {
            for (const id of collectSubtreeElementIds(document, rootId)) {
                if (!allowed.has(id) || !document.elements[id]) {
                    continue;
                }
                elementIdMap[id] = elementIdMap[id] ?? uuidService.generate();
            }
        };
        topLevelIds.forEach(collectSourceIds);

        let rootElementId: string;
        if (topLevelIds.length === 1) {
            const sourceRootId = topLevelIds[0];
            rootElementId = elementIdMap[sourceRootId];
            for (const [oldId, newId] of Object.entries(elementIdMap)) {
                const source = document.elements[oldId];
                if (!source) {
                    continue;
                }
                const copy = stripElementForComponentDefinition(source);
                copy.id = newId;
                copy.parentId = oldId === sourceRootId
                    ? null
                    : source.parentId && elementIdMap[source.parentId]
                      ? elementIdMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => elementIdMap[childId]).map(childId => elementIdMap[childId]);
                if (oldId === sourceRootId) {
                    copy.layout = roundUILayoutGeometryFields({
                        ...copy.layout,
                        x: 0,
                        y: 0,
                    });
                }
                componentElements[newId] = copy;
            }
        } else {
            rootElementId = uuidService.generate();
            const rootDefaults = widgetModuleRegistry.get("nl.container")?.createDefaultElement() ?? {};
            const rootElement: UIElement = {
                id: rootElementId,
                type: "nl.container",
                name: translate("defaultDoc.rootName"),
                parentId: null,
                childrenIds: topLevelIds.map(id => elementIdMap[id]).filter(Boolean),
                layout: roundUILayoutGeometryFields({
                    x: 0,
                    y: 0,
                    width: bounds.width,
                    height: bounds.height,
                    opacity: 1,
                    visible: true,
                }),
                props: rootDefaults.props,
                style: rootDefaults.style,
                extra: rootDefaults.extra,
            };
            componentElements[rootElementId] = rootElement;
            for (const [oldId, newId] of Object.entries(elementIdMap)) {
                const source = document.elements[oldId];
                if (!source) {
                    continue;
                }
                const copy = stripElementForComponentDefinition(source);
                copy.id = newId;
                copy.parentId = topLevelIds.includes(oldId)
                    ? rootElementId
                    : source.parentId && elementIdMap[source.parentId]
                      ? elementIdMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => elementIdMap[childId]).map(childId => elementIdMap[childId]);
                if (topLevelIds.includes(oldId)) {
                    copy.layout = roundUILayoutGeometryFields({
                        ...copy.layout,
                        x: copy.layout.x - bounds.x,
                        y: copy.layout.y - bounds.y,
                    });
                }
                componentElements[newId] = copy;
            }
        }

        const root = componentElements[rootElementId];
        if (!root) {
            return null;
        }
        const component: UIComponentDefinition = {
            id: componentId,
            name: sanitizeComponentName(name, selectedTopElements.length === 1 ? (selectedTopElements[0].name ?? translate("defaultDoc.componentName")) : translate("defaultDoc.componentName")),
            rootElementId,
            elements: componentElements,
            previewMeta: {
                width: Math.max(1, Math.abs(root.layout.width)),
                height: Math.max(1, Math.abs(root.layout.height)),
            },
            createdAt: now,
            updatedAt: now,
        };

        this.mutateDocument(doc => {
            doc.components = [...(doc.components ?? []), component];
        }, { history: false });
        return component;
    }

    public renameComponent(componentId: string, name: string): void {
        const nextName = name.trim();
        if (!nextName) {
            return;
        }
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (!component) {
                return;
            }
            component.name = nextName;
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public deleteComponents(componentIds: string[]): void {
        const ids = new Set(componentIds);
        if (ids.size === 0) {
            return;
        }
        this.mutateDocument(document => {
            document.components = (document.components ?? []).filter(component => !ids.has(component.id));
        }, { history: false });
    }

    public duplicateComponent(componentId: string): UIComponentDefinition | null {
        const source = this.getComponent(componentId);
        if (!source) {
            return null;
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const now = new Date().toISOString();
        const newComponentId = uuidService.generate();
        const idMap: Record<string, string> = {};
        for (const elementId of Object.keys(source.elements)) {
            idMap[elementId] = uuidService.generate();
        }
        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }
        const blueprintIdMap: Record<string, string> = {};
        if (localBp) {
            for (const oldElementId of Object.keys(source.elements)) {
                const oldBpId = localBp.getComponentWidgetMainBlueprintId(source.id, oldElementId);
                if (oldBpId) {
                    blueprintIdMap[oldBpId] = uuidService.generate();
                }
            }
        }
        const elements: Record<string, UIElement> = {};
        for (const [oldId, element] of Object.entries(source.elements)) {
            const copy = cloneJson(element);
            copy.id = idMap[oldId];
            copy.parentId = element.parentId ? idMap[element.parentId] ?? null : null;
            copy.childrenIds = element.childrenIds.filter(childId => idMap[childId]).map(childId => idMap[childId]);
            if (copy.behavior?.events) {
                const remapped = remapElementBehaviorBlueprintIds(copy.behavior.events, blueprintIdMap);
                copy.behavior = { ...copy.behavior, events: remapped };
            }
            if (copy.valueBindings) {
                copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
            }
            elements[copy.id] = copy;
        }
        const component: UIComponentDefinition = {
            ...cloneJson(source),
            id: newComponentId,
            name: `${source.name} Copy`,
            rootElementId: idMap[source.rootElementId],
            elements,
            createdAt: now,
            updatedAt: now,
        };
        this.mutateDocument(document => {
            document.components = [...(document.components ?? []), component];
        }, { history: false });
        localBp?.applyBlueprintMutation(bpDoc => {
            for (const [oldBpId, newBpId] of Object.entries(blueprintIdMap)) {
                const sourceBp = bpDoc.blueprints[oldBpId];
                const owner = sourceBp?.owner;
                if (!sourceBp || owner?.kind !== "componentWidgetMain" || owner.componentId !== source.id) {
                    continue;
                }
                const newElementId = idMap[owner.elementId];
                if (!newElementId) {
                    continue;
                }
                const cloned = cloneJson(sourceBp) as Blueprint;
                cloned.id = newBpId;
                cloned.owner = {
                    kind: "componentWidgetMain",
                    componentId: newComponentId,
                    elementId: newElementId,
                };
                if (cloned.bindings) {
                    for (const binding of Object.values(cloned.bindings)) {
                        if (binding.target.kind === "widgetProp") {
                            binding.target = {
                                ...binding.target,
                                surfaceId: `${COMPONENT_EDITOR_SURFACE_ID_PREFIX}${newComponentId}`,
                                elementId: idMap[binding.target.elementId] ?? binding.target.elementId,
                            };
                        }
                        if (binding.source.kind === "field" && binding.source.blueprintId === oldBpId) {
                            binding.source = { ...binding.source, blueprintId: newBpId };
                        }
                    }
                }
                bpDoc.blueprints[newBpId] = cloned;
                registerPrivateBlueprintAsActive(
                    bpDoc,
                    componentWidgetMainOwnerKey(newComponentId, newElementId),
                    newBpId,
                    cloned.frontend,
                );
            }
        });
        return component;
    }

    public updateComponentElementLayout(
        componentId: string,
        elementId: string,
        layoutPatch: Partial<UILayout>,
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.layout = roundUILayoutGeometryFields({
                ...element.layout,
                ...layoutPatch,
            });
            component.updatedAt = new Date().toISOString();
            if (component.rootElementId === elementId) {
                component.previewMeta = {
                    ...(component.previewMeta ?? {}),
                    width: Math.max(1, Math.abs(element.layout.width)),
                    height: Math.max(1, Math.abs(element.layout.height)),
                };
            }
        }, { history: false });
    }

    public updateComponentElementProps(
        componentId: string,
        elementId: string,
        propsPatch: Record<string, unknown>,
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.props = {
                ...(element.props ?? {}),
                ...propsPatch,
            };
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public updateComponentElementExtra(
        componentId: string,
        elementId: string,
        extraPatch: Record<string, unknown>,
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.extra = {
                ...(element.extra ?? {}),
                ...extraPatch,
            };
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public setComponentElementBlueprintEvent(
        componentId: string,
        elementId: string,
        eventName: string,
        ref: { blueprintId: string; eventId: string },
    ): void {
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const bpDoc = localBp.getBlueprintDocument();
        const bp = bpDoc.blueprints[ref.blueprintId];
        const slot = bp?.program.kind === "graph" ? bp.program.graphs.events?.[ref.eventId] : undefined;
        const defaultLayerName = `Layer ${ref.eventId.slice(0, 8)}`;
        localBp.ensureEventGraph(ref.blueprintId, ref.eventId, slot ? undefined : defaultLayerName);
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.behavior = element.behavior ?? {};
            element.behavior.events = element.behavior.events ?? {};
            element.behavior.events[eventName] = {
                kind: "blueprintEvent",
                blueprintId: ref.blueprintId,
                eventId: ref.eventId,
            };
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public clearComponentElementBlueprintEvent(componentId: string, elementId: string, eventName: string): void {
        const component = (this.getDocument().components ?? []).find(item => item.id === componentId);
        const current = component?.elements[elementId]?.behavior?.events?.[eventName];
        if (current?.kind === "blueprintEvent") {
            const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
            localBp.removeEventGraph(current.blueprintId, current.eventId);
        }
        this.mutateDocument(document => {
            const liveComponent = (document.components ?? []).find(item => item.id === componentId);
            const target = liveComponent?.elements[elementId];
            if (!liveComponent || !target?.behavior?.events?.[eventName]) {
                return;
            }
            const { [eventName]: _removed, ...rest } = target.behavior.events;
            target.behavior = {
                ...target.behavior,
                events: Object.keys(rest).length > 0 ? rest : undefined,
            };
            liveComponent.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public stripComponentBlueprintLayerBindings(componentId: string, blueprintId: string, layerEventId: string): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (!component) {
                return;
            }
            let componentChanged = false;
            for (const el of Object.values(component.elements)) {
                const events = el.behavior?.events;
                if (!events) {
                    continue;
                }
                let changed = false;
                const nextEvents = { ...events };
                for (const [eventName, binding] of Object.entries(nextEvents)) {
                    if (
                        binding.kind === "blueprintEvent" &&
                        binding.blueprintId === blueprintId &&
                        binding.eventId === layerEventId
                    ) {
                        nextEvents[eventName] = { kind: "noop" };
                        changed = true;
                    }
                }
                if (changed) {
                    el.behavior = { ...el.behavior, events: nextEvents };
                    componentChanged = true;
                }
            }
            if (componentChanged) {
                component.updatedAt = new Date().toISOString();
            }
        }, { history: false });
    }

    public renameComponentElement(componentId: string, elementId: string, name: string): void {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.name = trimmed;
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public reorderComponentChildren(componentId: string, parentId: string, orderedChildIds: string[]): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const parent = component?.elements[parentId];
            if (!component || !parent || !uiElementTypeAcceptsChildren(parent.type)) {
                return;
            }
            const allowed = new Set(parent.childrenIds);
            const ordered = orderedChildIds.filter(id => allowed.has(id));
            if (ordered.length !== parent.childrenIds.length) {
                return;
            }
            parent.childrenIds = ordered;
            normalizeFlowChildLayouts({ ...document, elements: component.elements }, ordered);
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public deleteComponentElements(componentId: string, elementIds: string[]): void {
        if (elementIds.length === 0) {
            return;
        }
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (!component) {
                return;
            }
            const rootId = component.rootElementId;
            const toRemove = new Set<string>();
            const collect = (elementId: string) => {
                if (elementId === rootId || toRemove.has(elementId)) {
                    return;
                }
                const element = component.elements[elementId];
                if (!element) {
                    return;
                }
                toRemove.add(elementId);
                element.childrenIds.forEach(collect);
            };
            elementIds.forEach(collect);
            if (toRemove.size === 0) {
                return;
            }
            for (const element of Object.values(component.elements)) {
                if (element.childrenIds.length > 0) {
                    element.childrenIds = element.childrenIds.filter(childId => !toRemove.has(childId));
                }
            }
            for (const id of toRemove) {
                delete component.elements[id];
            }
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public moveComponentElements(
        componentId: string,
        elementIds: string[],
        targetParentId: string,
        beforeChildId: string | null,
    ): MoveUiElementsResult {
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        const rootId = component?.rootElementId;
        if (!component || !rootId || elementIds.includes(rootId)) {
            return { ok: false, reason: "invalid_movers" };
        }
        const targetParent = component.elements[targetParentId];
        if (!targetParent || !uiElementTypeAcceptsChildren(targetParent.type)) {
            return { ok: false, reason: "invalid_target" };
        }
        const surfaceId = `component:${componentId}`;
        const virtualSurface: UISurface = {
            id: surfaceId,
            name: component.name,
            host: "app",
            kind: "appSurface",
            designSize: getComponentPreviewDesignSize(component),
            rootElementId: rootId,
        };
        const virtualDocument: UIDocument = {
            ...document,
            surfaces: [virtualSurface],
            elements: component.elements,
        };
        const planned = planMoveElementsInSurface(virtualDocument, surfaceId, elementIds, targetParentId, beforeChildId);
        if (!planned.ok) {
            return planned;
        }
        this.mutateDocument(doc => {
            const liveComponent = (doc.components ?? []).find(item => item.id === componentId);
            if (!liveComponent) {
                return;
            }
            const liveVirtualSurface: UISurface = {
                id: surfaceId,
                name: liveComponent.name,
                host: "app",
                kind: "appSurface",
                designSize: getComponentPreviewDesignSize(liveComponent),
                rootElementId: liveComponent.rootElementId,
            };
            const liveVirtualDocument: UIDocument = {
                ...doc,
                surfaces: [liveVirtualSurface],
                elements: liveComponent.elements,
            };
            applyPlannedMove(liveVirtualDocument, planned.plan);
            normalizeFlowChildLayouts(liveVirtualDocument, elementIds);
            liveComponent.updatedAt = new Date().toISOString();
        }, { history: false });
        return { ok: true };
    }

    public createComponentElement(
        componentId: string,
        parentId: string,
        type: string,
        layoutPatch: Partial<UILayout> = {},
    ): UIElement | null {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const definition = widgetModuleRegistry.get(type);
        if (!definition) {
            throw new RendererError(`Unknown element type: ${type}`);
        }
        let created: UIElement | null = null;
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const parent = component?.elements[parentId];
            if (!component || !parent || !uiElementTypeAcceptsChildren(parent.type)) {
                return;
            }
            const elementId = uuidService.generate();
            const defaults = definition.createDefaultElement();
            const element: UIElement = {
                id: elementId,
                type: definition.type,
                name: defaults.name ?? definition.displayName,
                parentId,
                childrenIds: [],
                layout: roundUILayoutGeometryFields({
                    x: defaults.layout?.x ?? 0,
                    y: defaults.layout?.y ?? 0,
                    width: defaults.layout?.width ?? 100,
                    height: defaults.layout?.height ?? 100,
                    opacity: defaults.layout?.opacity ?? 1,
                    visible: defaults.layout?.visible ?? true,
                    rotation: defaults.layout?.rotation,
                    ...layoutPatch,
                }),
                props: defaults.props,
                style: defaults.style,
                extra: defaults.extra,
            };
            const defaultChildrenResult = definition.createDefaultChildElements?.({
                element,
                generateId: () => uuidService.generate(),
            });
            const defaultChildren = defaultChildrenResult?.children ?? [];
            const elementWithChildren: UIElement = {
                ...element,
                ...(defaultChildrenResult?.elementPatch ?? {}),
                id: element.id,
                type: element.type,
                parentId: element.parentId,
                childrenIds: defaultChildren.length > 0 ? defaultChildren.map(child => child.id) : element.childrenIds,
                layout: {
                    ...element.layout,
                    ...(defaultChildrenResult?.elementPatch?.layout ?? {}),
                },
                props: {
                    ...(element.props ?? {}),
                    ...(defaultChildrenResult?.elementPatch?.props ?? {}),
                },
                style: defaultChildrenResult?.elementPatch?.style ?? element.style,
                behavior: undefined,
                valueBindings: undefined,
                extra: defaultChildrenResult?.elementPatch?.extra ?? element.extra,
            };
            component.elements[elementId] = elementWithChildren;
            for (const child of defaultChildren) {
                component.elements[child.id] = {
                    ...child,
                    parentId: elementId,
                    behavior: undefined,
                    valueBindings: undefined,
                };
            }
            parent.childrenIds = [...parent.childrenIds, elementId];
            normalizeFlowChildLayouts({ ...document, elements: component.elements }, [
                elementId,
                ...defaultChildren.map(child => child.id),
            ]);
            component.updatedAt = new Date().toISOString();
            created = cloneJson(elementWithChildren);
        }, { history: false });
        return created;
    }

    public pasteComponentClipboardPayload(
        componentId: string,
        targetParentId: string,
        beforeChildId: string | null,
        payload: UIEditorClipboardPayload,
    ): { ok: true; newRootIds: string[] } | { ok: false; reason: "invalid_clipboard" | "invalid_target" } {
        if (payload.v !== 1 || payload.topLevelElementIds.length === 0 || Object.keys(payload.elements).length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        const target = component?.elements[targetParentId];
        if (!component || !target || !uiElementTypeAcceptsChildren(target.type)) {
            return { ok: false, reason: "invalid_target" };
        }
        if (beforeChildId != null) {
            const before = component.elements[beforeChildId];
            if (!before || before.parentId !== targetParentId) {
                return { ok: false, reason: "invalid_target" };
            }
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const elementIdMap: Record<string, string> = {};
        for (const oldId of Object.keys(payload.elements)) {
            elementIdMap[oldId] = uuidService.generate();
        }
        const newRootIds = payload.topLevelElementIds
            .map(oldId => elementIdMap[oldId])
            .filter((id): id is string => Boolean(id));
        if (newRootIds.length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }

        this.mutateDocument(doc => {
            const liveComponent = (doc.components ?? []).find(item => item.id === componentId);
            const liveParent = liveComponent?.elements[targetParentId];
            if (!liveComponent || !liveParent) {
                return;
            }
            for (const [oldId, source] of Object.entries(payload.elements)) {
                const newId = elementIdMap[oldId];
                if (!newId) {
                    continue;
                }
                const copy = stripElementForComponentDefinition(source);
                copy.id = newId;
                copy.parentId = payload.topLevelElementIds.includes(oldId)
                    ? targetParentId
                    : source.parentId && elementIdMap[source.parentId]
                      ? elementIdMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => elementIdMap[childId]).map(childId => elementIdMap[childId]);
                liveComponent.elements[newId] = copy;
            }
            const insertAt = beforeChildId ? liveParent.childrenIds.indexOf(beforeChildId) : -1;
            const withoutMoved = liveParent.childrenIds.filter(id => !newRootIds.includes(id));
            liveParent.childrenIds = insertAt >= 0
                ? [...withoutMoved.slice(0, insertAt), ...newRootIds, ...withoutMoved.slice(insertAt)]
                : [...withoutMoved, ...newRootIds];
            normalizeFlowChildLayouts({ ...doc, elements: liveComponent.elements }, newRootIds);
            liveComponent.updatedAt = new Date().toISOString();
        }, { history: false });
        return { ok: true, newRootIds };
    }

    public createComponentInstance(parentId: string, componentId: string, layoutPatch: Partial<UILayout> = {}): UIElement {
        const surfaceId = this.getElementSurfaceId(parentId);
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        if (!component) {
            throw new RendererError(`Component ${componentId} not found`);
        }
        const root = component.elements[component.rootElementId];
        if (!root) {
            throw new RendererError(`Component ${component.name} root is missing`);
        }
        const parent = document.elements[parentId];
        if (!parent) {
            throw new RendererError("Parent element not found");
        }
        if (isLinkedUIComponentElement(parent)) {
            throw new RendererError("Cannot insert children into a linked component instance");
        }
        if (!uiElementTypeAcceptsChildren(parent.type)) {
            throw new RendererError(`Parent type ${parent.type} cannot have child elements`);
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const elementId = uuidService.generate();
        const element: UIElement = {
            id: elementId,
            type: root.type,
            name: component.name,
            parentId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: root.layout.x,
                y: root.layout.y,
                width: root.layout.width,
                height: root.layout.height,
                opacity: 1,
                visible: true,
                rotation: root.layout.rotation,
                ...layoutPatch,
            }),
            extra: {
                componentLink: {
                    componentId,
                    linked: true,
                },
            },
        };
        this.mutateDocument(doc => {
            doc.elements[elementId] = element;
            const parentElement = doc.elements[parentId];
            if (parentElement) {
                parentElement.childrenIds = [...parentElement.childrenIds, elementId];
            }
            normalizeFlowChildLayout(doc, element);
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
        return element;
    }

    public unlinkComponentInstance(elementId: string): string[] {
        const document = this.getDocument();
        const surfaceId = this.getElementSurfaceId(elementId);
        const instance = document.elements[elementId];
        const link = getUIComponentLink(instance);
        if (!instance || !link) {
            return [];
        }
        const component = (document.components ?? []).find(item => item.id === link.componentId);
        const sourceRoot = component?.elements[component.rootElementId];
        if (!component || !sourceRoot) {
            return [];
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const idMap: Record<string, string> = {
            [sourceRoot.id]: instance.id,
        };
        const sourceElementIds = collectComponentSubtreeElementIds(component.elements, sourceRoot.id);
        for (const id of sourceElementIds) {
            idMap[id] = idMap[id] ?? uuidService.generate();
        }
        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }
        const blueprintIdMap: Record<string, string> = {};
        if (localBp) {
            for (const sourceElementId of sourceElementIds) {
                const oldBpId = localBp.getComponentWidgetMainBlueprintId(component.id, sourceElementId);
                if (oldBpId) {
                    blueprintIdMap[oldBpId] = uuidService.generate();
                }
            }
        }
        const materializedIds = Object.values(idMap);
        const pageBehavior = cloneJson(instance.behavior);
        this.mutateDocument(doc => {
            const liveInstance = doc.elements[elementId];
            if (!liveInstance) {
                return;
            }
            const liveComponent = (doc.components ?? []).find(item => item.id === link.componentId);
            const liveRoot = liveComponent?.elements[liveComponent.rootElementId];
            if (!liveComponent || !liveRoot) {
                return;
            }
            for (const [oldId, source] of Object.entries(liveComponent.elements)) {
                if (!idMap[oldId]) {
                    continue;
                }
                const copy = cloneJson(source);
                copy.id = idMap[oldId];
                copy.parentId = oldId === liveRoot.id
                    ? liveInstance.parentId
                    : source.parentId && idMap[source.parentId]
                      ? idMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => idMap[childId]).map(childId => idMap[childId]);
                if (copy.behavior?.events) {
                    const remapped = remapElementBehaviorBlueprintIds(copy.behavior.events, blueprintIdMap);
                    copy.behavior = { ...copy.behavior, events: remapped };
                }
                if (copy.valueBindings) {
                    copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
                }
                if (oldId === liveRoot.id) {
                    copy.layout = {
                        ...copy.layout,
                        ...liveInstance.layout,
                    };
                    copy.name = liveInstance.name;
                    copy.behavior = pageBehavior;
                    if (copy.extra?.componentLink) {
                        const { componentLink: _removed, ...rest } = copy.extra;
                        copy.extra = Object.keys(rest).length > 0 ? rest : undefined;
                    }
                }
                doc.elements[copy.id] = copy;
            }
            normalizeFlowChildLayouts(doc, materializedIds);
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
        if (surfaceId && localBp) {
            localBp.applyBlueprintMutation(bpDoc => {
                for (const [oldBpId, newBpId] of Object.entries(blueprintIdMap)) {
                    const sourceBp = bpDoc.blueprints[oldBpId];
                    const owner = sourceBp?.owner;
                    if (!sourceBp || owner?.kind !== "componentWidgetMain" || owner.componentId !== component.id) {
                        continue;
                    }
                    const newElementId = idMap[owner.elementId];
                    if (!newElementId) {
                        continue;
                    }
                    const cloned: Blueprint = cloneWidgetMainBlueprintForPaste({
                        source: sourceBp,
                        newBlueprintId: newBpId,
                        surfaceId,
                        newOwnerElementId: newElementId,
                        elementIdMap: idMap,
                        oldBlueprintId: oldBpId,
                        newBlueprintIdForSourceRemap: newBpId,
                    });
                    bpDoc.blueprints[newBpId] = cloned;
                    registerPrivateBlueprintAsActive(
                        bpDoc,
                        widgetMainOwnerKey(surfaceId, newElementId),
                        newBpId,
                        cloned.frontend,
                    );
                }
            });
        }
        return materializedIds;
    }

    public createElement(parentId: string, type: string, layoutPatch: Partial<UILayout> = {}): UIElement {
        const surfaceId = this.getElementSurfaceId(parentId);
        const definition = widgetModuleRegistry.get(type);
        if (!definition) {
            throw new RendererError(`Unknown element type: ${type}`);
        }
        const document = this.getDocument();
        const parent = document.elements[parentId];
        if (!parent) {
            throw new RendererError("Parent element not found");
        }
        if (isLinkedUIComponentElement(parent)) {
            throw new RendererError("Cannot insert children into a linked component instance");
        }
        if (!uiElementTypeAcceptsChildren(parent.type)) {
            throw new RendererError(`Parent type ${parent.type} cannot have child elements`);
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const elementId = uuidService.generate();

        const defaultElement = definition.createDefaultElement();
        const baseLayout: UILayout = {
            x: defaultElement.layout?.x ?? 0,
            y: defaultElement.layout?.y ?? 0,
            width: defaultElement.layout?.width ?? 100,
            height: defaultElement.layout?.height ?? 100,
            visible: defaultElement.layout?.visible ?? true,
            opacity: defaultElement.layout?.opacity ?? 1,
            rotation: defaultElement.layout?.rotation,
        };
        const layout: UILayout = roundUILayoutGeometryFields({ ...baseLayout, ...layoutPatch });

        const element: UIElement = {
            id: elementId,
            type: definition.type,
            name: defaultElement.name ?? definition.displayName,
            parentId,
            childrenIds: [],
            layout,
            props: defaultElement.props,
            style: defaultElement.style,
            behavior: defaultElement.behavior,
            extra:
                isListLikeWidgetType(parent.type)
                    ? ({
                          ...(defaultElement.extra ?? {}),
                          listSlot: "itemTemplate",
                      } satisfies UIListElementExtra)
                    : parent.type === "nl.slider"
                      ? ({
                            ...(defaultElement.extra ?? {}),
                            sliderSlot: getUISliderChildSlot(defaultElement.extra) ?? "track",
                        } satisfies UISliderElementExtra)
                    : defaultElement.extra,
        };
        const defaultChildrenResult = definition.createDefaultChildElements?.({
            element,
            generateId: () => uuidService.generate(),
        });
        const defaultChildren = defaultChildrenResult?.children ?? [];
        const elementWithChildren: UIElement = {
            ...element,
            ...(defaultChildrenResult?.elementPatch ?? {}),
            id: element.id,
            type: element.type,
            parentId: element.parentId,
            childrenIds: defaultChildren.length > 0 ? defaultChildren.map(child => child.id) : element.childrenIds,
            layout: {
                ...element.layout,
                ...(defaultChildrenResult?.elementPatch?.layout ?? {}),
            },
            props: {
                ...(element.props ?? {}),
                ...(defaultChildrenResult?.elementPatch?.props ?? {}),
            },
            style: defaultChildrenResult?.elementPatch?.style ?? element.style,
            behavior: defaultChildrenResult?.elementPatch?.behavior ?? element.behavior,
            extra: defaultChildrenResult?.elementPatch?.extra ?? element.extra,
        };

        this.mutateDocument(documentData => {
            documentData.elements[elementId] = elementWithChildren;
            for (const child of defaultChildren) {
                documentData.elements[child.id] = {
                    ...child,
                    parentId: elementId,
                };
            }
            const parentElement = documentData.elements[parentId];
            if (parentElement) {
                parentElement.childrenIds = [...parentElement.childrenIds, elementId];
            }
            normalizeFlowChildLayouts(documentData, [
                elementId,
                ...defaultChildren.map(child => child.id),
            ]);
        }, {
            history: surfaceId ? { surfaceId } : false,
        });

        return elementWithChildren;
    }

    public pasteClipboardPayload(
        surfaceId: string,
        targetParentId: string,
        beforeChildId: string | null,
        payload: UIEditorClipboardPayload,
    ): { ok: true; newRootIds: string[] } | { ok: false; reason: "invalid_clipboard" | "invalid_target" } {
        if (payload.v !== 1 || payload.topLevelElementIds.length === 0 || Object.keys(payload.elements).length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }

        const document = this.getDocument();
        const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
        if (!effectiveRootId) {
            return { ok: false, reason: "invalid_target" };
        }
        const allowed = collectSubtreeElementIds(document, effectiveRootId);
        const target = document.elements[targetParentId];
        if (!target || !allowed.has(targetParentId) || !isValidUIInsertParent(target) || isLinkedUIComponentElement(target)) {
            return { ok: false, reason: "invalid_target" };
        }
        if (beforeChildId != null) {
            const beforeEl = document.elements[beforeChildId];
            if (!beforeEl || beforeEl.parentId !== targetParentId) {
                return { ok: false, reason: "invalid_target" };
            }
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const historyService = this.getHistoryService();
        const beforeHistory = historyService?.captureSnapshot(surfaceId) ?? null;

        const elementIdMap: Record<string, string> = {};
        for (const oldId of Object.keys(payload.elements)) {
            elementIdMap[oldId] = uuidService.generate();
        }

        const blueprintIdMap: Record<string, string> = {};
        for (const oldBpId of Object.keys(payload.widgetMainBlueprints)) {
            blueprintIdMap[oldBpId] = uuidService.generate();
        }
        for (const oldBpId of Object.keys(payload.widgetValueBlueprints ?? {})) {
            blueprintIdMap[oldBpId] = uuidService.generate();
        }

        const newRootIds: string[] = [];

        this.mutateDocument(doc => {
            const parentEl = doc.elements[targetParentId];
            if (!parentEl) {
                return;
            }

            for (const oldId of Object.keys(payload.elements)) {
                const oldEl = payload.elements[oldId];
                const newId = elementIdMap[oldId];
                const isTop = payload.topLevelElementIds.includes(oldId);
                const copy = JSON.parse(JSON.stringify(oldEl)) as UIElement;
                copy.id = newId;
                if (isTop) {
                    copy.parentId = targetParentId;
                } else if (oldEl.parentId && payload.elements[oldEl.parentId]) {
                    copy.parentId = elementIdMap[oldEl.parentId];
                } else {
                    copy.parentId = null;
                }
                copy.childrenIds = oldEl.childrenIds
                    .filter(cid => payload.elements[cid])
                    .map(cid => elementIdMap[cid]);

                if (copy.behavior?.events) {
                    const remapped = remapElementBehaviorBlueprintIds(copy.behavior.events, blueprintIdMap);
                    copy.behavior = { ...copy.behavior, events: remapped };
                }
                if (copy.valueBindings) {
                    copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
                }
                if (isTop && isListLikeWidgetType(parentEl.type)) {
                    const slot = copy.extra?.listSlot;
                    if (slot !== "itemTemplate" && slot !== "scrollbarTrack" && slot !== "scrollbarThumb") {
                        copy.extra = {
                            ...(copy.extra ?? {}),
                            listSlot: "itemTemplate",
                        };
                    }
                }

                if (isTop) {
                    const mergeLookup = (id: string) => doc.elements[id] ?? payload.elements[id];
                    const patch = layoutPatchForReparent(doc, oldEl, targetParentId, mergeLookup);
                    let layout = { ...copy.layout, ...patch };
                    const sameParentAsSource = oldEl.parentId === targetParentId;
                    if (!isUIFlowLayoutParentElement(parentEl) && sameParentAsSource) {
                        layout = {
                            ...layout,
                            x: (layout.x ?? 0) + 16,
                            y: (layout.y ?? 0) + 16,
                        };
                    }
                    copy.layout = roundUILayoutGeometryFields(layout);
                } else {
                    copy.layout = roundUILayoutGeometryFields({ ...copy.layout });
                }

                doc.elements[newId] = copy;
            }

            newRootIds.length = 0;
            for (const oldRoot of payload.topLevelElementIds) {
                const mapped = elementIdMap[oldRoot];
                if (mapped) {
                    newRootIds.push(mapped);
                }
            }

            let children = [...parentEl.childrenIds];
            children = children.filter(cid => !newRootIds.includes(cid));
            let insertAt = children.length;
            if (beforeChildId != null) {
                const idx = children.indexOf(beforeChildId);
                insertAt = idx === -1 ? children.length : idx;
            }
            children.splice(insertAt, 0, ...newRootIds);
            parentEl.childrenIds = children;
            normalizeFlowChildLayouts(doc, Object.values(elementIdMap));
        }, { history: false });

        localBp.applyBlueprintMutation(bpDoc => {
            for (const [oldBpId, sourceBp] of Object.entries(payload.widgetMainBlueprints)) {
                const newBpId = blueprintIdMap[oldBpId];
                if (!newBpId) {
                    continue;
                }
                const owner = sourceBp.owner;
                if (owner.kind !== "widgetMain" || owner.surfaceId !== payload.sourceSurfaceId) {
                    continue;
                }
                const newElementId = elementIdMap[owner.elementId];
                if (!newElementId || !payload.elements[owner.elementId]) {
                    continue;
                }
                const cloned: Blueprint = cloneWidgetMainBlueprintForPaste({
                    source: sourceBp,
                    newBlueprintId: newBpId,
                    surfaceId,
                    newOwnerElementId: newElementId,
                    elementIdMap,
                    oldBlueprintId: oldBpId,
                    newBlueprintIdForSourceRemap: newBpId,
                });
                bpDoc.blueprints[newBpId] = cloned;
                registerPrivateBlueprintAsActive(
                    bpDoc,
                    widgetMainOwnerKey(surfaceId, newElementId),
                    newBpId,
                    cloned.frontend,
                );
            }
            for (const [oldBpId, sourceBp] of Object.entries(payload.widgetValueBlueprints ?? {})) {
                const newBpId = blueprintIdMap[oldBpId];
                if (!newBpId) {
                    continue;
                }
                const owner = sourceBp.owner;
                if (owner.kind !== "widgetValue" || owner.surfaceId !== payload.sourceSurfaceId) {
                    continue;
                }
                const newElementId = elementIdMap[owner.elementId];
                if (!newElementId || !payload.elements[owner.elementId]) {
                    continue;
                }
                const cloned: Blueprint = cloneWidgetValueBlueprintForPaste({
                    source: sourceBp,
                    newBlueprintId: newBpId,
                    surfaceId,
                    newOwnerElementId: newElementId,
                    propPath: owner.propPath,
                });
                bpDoc.blueprints[newBpId] = cloned;
                registerPrivateBlueprintAsActive(
                    bpDoc,
                    widgetValueOwnerKey(surfaceId, newElementId, owner.propPath),
                    newBpId,
                    cloned.frontend,
                );
            }
        });

        if (historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }

        return { ok: true, newRootIds };
    }

    public setElementBlueprintEvent(
        elementId: string,
        eventName: string,
        ref: { blueprintId: string; eventId: string },
    ): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const historyService = surfaceId ? this.getHistoryService() : null;
        const beforeHistory = surfaceId && historyService ? historyService.captureSnapshot(surfaceId) : null;
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const bpDoc = localBp.getBlueprintDocument();
        const bp = bpDoc.blueprints[ref.blueprintId];
        const slot =
            bp?.program.kind === "graph" ? bp.program.graphs.events?.[ref.eventId] : undefined;
        const defaultLayerName = `Layer ${ref.eventId.slice(0, 8)}`;
        localBp.ensureEventGraph(
            ref.blueprintId,
            ref.eventId,
            slot ? undefined : defaultLayerName,
        );
        this.mutateDocument(document => {
            const el = document.elements[elementId];
            if (!el) {
                return;
            }
            el.behavior = el.behavior ?? {};
            el.behavior.events = el.behavior.events ?? {};
            const binding: UIBehaviorBinding = {
                kind: "blueprintEvent",
                blueprintId: ref.blueprintId,
                eventId: ref.eventId,
            };
            el.behavior.events[eventName] = binding;
        }, { history: false });
        if (surfaceId && historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }
    }

    public clearElementBlueprintEvent(elementId: string, eventName: string): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const historyService = surfaceId ? this.getHistoryService() : null;
        const beforeHistory = surfaceId && historyService ? historyService.captureSnapshot(surfaceId) : null;
        const el = this.getDocument().elements[elementId];
        const cur = el?.behavior?.events?.[eventName];
        if (cur?.kind === "blueprintEvent") {
            const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
            localBp.removeEventGraph(cur.blueprintId, cur.eventId);
        }
        this.mutateDocument(document => {
            const target = document.elements[elementId];
            if (!target?.behavior?.events?.[eventName]) {
                return;
            }
            const { [eventName]: _removed, ...rest } = target.behavior.events;
            target.behavior = {
                ...target.behavior,
                events: Object.keys(rest).length > 0 ? rest : undefined,
            };
        }, { history: false });
        if (surfaceId && historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }
    }

    public stripBlueprintLayerBindings(surfaceId: string, blueprintId: string, layerEventId: string): void {
        this.mutateDocument(document => {
            const rootId = resolveSurfaceRootElementId(document, surfaceId);
            if (!rootId) {
                return;
            }
            const ids = collectSubtreeElementIds(document, rootId);
            for (const elId of ids) {
                const el = document.elements[elId];
                if (!el) {
                    continue;
                }
                const events = el.behavior?.events;
                if (!events) {
                    continue;
                }
                let changed = false;
                const nextEvents = { ...events };
                for (const [eventName, binding] of Object.entries(nextEvents)) {
                    if (
                        binding.kind === "blueprintEvent" &&
                        binding.blueprintId === blueprintId &&
                        binding.eventId === layerEventId
                    ) {
                        nextEvents[eventName] = { kind: "noop" };
                        changed = true;
                    }
                }
                if (changed) {
                    el.behavior = { ...el.behavior, events: nextEvents };
                }
            }
        }, { history: false });
    }

    private getProjectDesignSize(): UISurfaceDesignSize {
        const projectService = this.getContext().services.get<ProjectService>(Services.Project);
        const projectConfig = projectService.getProjectConfig();
        return projectConfig.metadata?.resolution ?? DEFAULT_UI_SURFACE_SIZE;
    }

    private createRootElement(rootElementId: UIElementId, designSize: UISurfaceDesignSize): UIElement {
        return {
            id: rootElementId,
            type: "nl.root",
            name: DEFAULT_UI_ROOT_NAME,
            parentId: null,
            childrenIds: [],
            layout: {
                x: 0,
                y: 0,
                width: designSize.width,
                height: designSize.height,
                visible: true,
                opacity: 1,
            },
        };
    }

    private createDialogStageTemplate(rootElement: UIElement, designSize: UISurfaceDesignSize): DialogStageTemplate {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const interactionLayerId = uuidService.generate();
        const panelId = uuidService.generate();
        const stackId = uuidService.generate();
        const nametagId = uuidService.generate();
        const sentenceId = uuidService.generate();
        const panelWidth = Math.round(designSize.width * 0.86);
        const panelHeight = Math.max(180, Math.round(designSize.height * 0.24));
        const panelX = Math.round((designSize.width - panelWidth) / 2);
        const panelY = Math.max(0, designSize.height - panelHeight - Math.round(designSize.height * 0.04));

        rootElement.childrenIds = [interactionLayerId, panelId];

        const interactionLayer: UIElement = {
            id: interactionLayerId,
            type: "nl.container",
            name: translate("defaultDoc.dialog.interactionLayer"),
            parentId: rootElement.id,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: designSize.width,
                height: designSize.height,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "free",
                backgroundColor: "transparent",
                fillVisible: false,
                fillOpacity: 0,
                strokeVisible: false,
                borderWidth: 0,
                stackPaddingTop: 0,
                stackPaddingRight: 0,
                stackPaddingBottom: 0,
                stackPaddingLeft: 0,
                clipContent: false,
            }),
        };

        const panel: UIElement = {
            id: panelId,
            type: "nl.container",
            name: translate("defaultDoc.dialog.panel"),
            parentId: rootElement.id,
            childrenIds: [stackId],
            layout: roundUILayoutGeometryFields({
                x: panelX,
                y: panelY,
                width: panelWidth,
                height: panelHeight,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "free",
                backgroundColor: "#0b0d12",
                fillOpacity: 0.78,
                borderRadius: 8,
                borderRadiusTL: 8,
                borderRadiusTR: 8,
                borderRadiusBL: 8,
                borderRadiusBR: 8,
                borderColor: "#f8fafc",
                borderWidth: 1,
                strokeOpacity: 0.18,
                clipContent: true,
            }),
        };

        const stack: UIElement = {
            id: stackId,
            type: "nl.container",
            name: translate("defaultDoc.dialog.content"),
            parentId: panelId,
            childrenIds: [nametagId, sentenceId],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: panelWidth,
                height: panelHeight,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "stack",
                stackDirection: "vertical",
                stackGap: 10,
                stackPaddingTop: 22,
                stackPaddingRight: 28,
                stackPaddingBottom: 22,
                stackPaddingLeft: 28,
                backgroundColor: "transparent",
                fillVisible: false,
                strokeVisible: false,
                borderWidth: 0,
                clipContent: false,
            }),
        };

        const nametag: UIElement = {
            id: nametagId,
            type: "nl.text",
            name: translate("defaultDoc.dialog.nametag"),
            parentId: stackId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: 320,
                height: 34,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.speaker"),
                fontSize: 22,
                color: "#f8d37a",
                fontWeight: "600",
                lineHeight: 1.2,
                textVerticalAlign: "center",
            }),
        };

        const sentence: UIElement = {
            id: sentenceId,
            type: DIALOG_SENTENCE_WIDGET_TYPE,
            name: translate("defaultDoc.dialog.sentence"),
            parentId: stackId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: Math.max(1, panelWidth - 56),
                height: Math.max(96, panelHeight - 88),
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.dialog.sentenceText"),
                fontSize: 24,
                color: "#f8fafc",
                lineHeight: 1.45,
            }),
        };

        return {
            elements: {
                [interactionLayer.id]: interactionLayer,
                [panel.id]: panel,
                [stack.id]: stack,
                [nametag.id]: nametag,
                [sentence.id]: sentence,
            },
            interactionLayerId,
            panelId,
            stackId,
            nametagId,
            sentenceId,
        };
    }

    private getOptionalLocalBlueprintService(): LocalBlueprintService | null {
        try {
            return this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            return null;
        }
    }

    private createDialogContentNextGraph(
        surfaceId: UISurfaceId,
        targets: {
            interactionLayerId: UIElementId;
            panelId: UIElementId;
            nametagId: UIElementId;
            sentenceId: UIElementId;
        },
    ): BlueprintGraphIr {
        const contentClickHeadId = "dialog.next.contentMouseClick";
        const spaceHeadId = "dialog.next.spaceKeyUp";
        const nextId = "dialog.next";
        const elementClickTargets = [
            {
                nodeId: "dialog.next.interactionLayerElementClick",
                elementId: targets.interactionLayerId,
                elementType: "nl.container",
                y: 210,
            },
            {
                nodeId: "dialog.next.panelElementClick",
                elementId: targets.panelId,
                elementType: "nl.container",
                y: 380,
            },
            {
                nodeId: "dialog.next.nametagElementClick",
                elementId: targets.nametagId,
                elementType: "nl.text",
                y: 550,
            },
            {
                nodeId: "dialog.next.sentenceElementClick",
                elementId: targets.sentenceId,
                elementType: DIALOG_SENTENCE_WIDGET_TYPE,
                y: 720,
            },
        ] as const;
        const nodes: Record<string, BlueprintGraphNode> = {
            [contentClickHeadId]: {
                id: contentClickHeadId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
                params: {},
                meta: { editorLayout: { x: 80, y: 40 } },
            },
            [spaceHeadId]: {
                id: spaceHeadId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
                params: {
                    [BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME]: " ",
                },
                meta: { editorLayout: { x: 80, y: 890 } },
            },
            [nextId]: {
                id: nextId,
                type: BLUEPRINT_NODE_TYPE_GAME_NEXT,
                params: {},
                meta: { editorLayout: { x: 560, y: 465 } },
            },
        };
        const edges: NonNullable<BlueprintGraphIr["edges"]> = [
            {
                from: { nodeId: contentClickHeadId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            },
            {
                from: { nodeId: spaceHeadId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            },
        ];
        for (const target of elementClickTargets) {
            nodes[target.nodeId] = {
                id: target.nodeId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                params: {
                    surfaceId,
                    elementId: target.elementId,
                    elementType: target.elementType,
                },
                meta: { editorLayout: { x: 80, y: target.y } },
            };
            edges.push({
                from: { nodeId: target.nodeId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            });
        }
        return {
            nodes,
            edges,
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    private createNametagUpdateGraph(): BlueprintGraphIr {
        const initHeadId = "nametag.update.init";
        const flushHeadId = "nametag.update.flush";
        const conditionNametagId = "nametag.update.get.condition";
        const textNametagId = "nametag.update.get.text";
        const notNullId = "nametag.update.notNull";
        const ifId = "nametag.update.if";
        const showId = "nametag.update.show";
        const setTextId = "nametag.update.setText";
        const hideId = "nametag.update.hide";
        return {
            nodes: {
                [initHeadId]: {
                    id: initHeadId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 60 } },
                } satisfies BlueprintGraphNode,
                [flushHeadId]: {
                    id: flushHeadId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 190 } },
                } satisfies BlueprintGraphNode,
                [conditionNametagId]: {
                    id: conditionNametagId,
                    type: BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
                    params: {},
                    meta: { editorLayout: { x: 300, y: 220 } },
                } satisfies BlueprintGraphNode,
                [textNametagId]: {
                    id: textNametagId,
                    type: BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
                    params: {},
                    meta: { editorLayout: { x: 1030, y: 150 } },
                } satisfies BlueprintGraphNode,
                [notNullId]: {
                    id: notNullId,
                    type: BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
                    params: {},
                    meta: { editorLayout: { x: 540, y: 260 } },
                } satisfies BlueprintGraphNode,
                [ifId]: {
                    id: ifId,
                    type: BLUEPRINT_NODE_TYPE_FLOW_IF,
                    params: {},
                    meta: { editorLayout: { x: 780, y: 125 } },
                } satisfies BlueprintGraphNode,
                [showId]: {
                    id: showId,
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                    params: { property: "opacity", value: 100 },
                    meta: { editorLayout: { x: 1030, y: 70 } },
                } satisfies BlueprintGraphNode,
                [setTextId]: {
                    id: setTextId,
                    type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
                    params: {},
                    meta: { editorLayout: { x: 1270, y: 70 } },
                } satisfies BlueprintGraphNode,
                [hideId]: {
                    id: hideId,
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                    params: { property: "opacity", value: 0 },
                    meta: { editorLayout: { x: 1030, y: 220 } },
                } satisfies BlueprintGraphNode,
            },
            edges: [
                {
                    from: { nodeId: initHeadId, port: "then" },
                    to: { nodeId: ifId, port: "in" },
                },
                {
                    from: { nodeId: flushHeadId, port: "then" },
                    to: { nodeId: ifId, port: "in" },
                },
                {
                    from: { nodeId: conditionNametagId, port: "nametag" },
                    to: { nodeId: notNullId, port: "value" },
                },
                {
                    from: { nodeId: notNullId, port: "result" },
                    to: { nodeId: ifId, port: "condition" },
                },
                {
                    from: { nodeId: ifId, port: "true" },
                    to: { nodeId: showId, port: "in" },
                },
                {
                    from: { nodeId: showId, port: "next" },
                    to: { nodeId: setTextId, port: "in" },
                },
                {
                    from: { nodeId: textNametagId, port: "nametag" },
                    to: { nodeId: setTextId, port: "text" },
                },
                {
                    from: { nodeId: ifId, port: "false" },
                    to: { nodeId: hideId, port: "in" },
                },
            ],
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    private configureDefaultDialogBlueprints(surfaceId: UISurfaceId, template: DialogStageTemplate): void {
        const localBp = this.getOptionalLocalBlueprintService();
        if (!localBp) {
            return;
        }

        const contentBlueprintId = localBp.ensureWidgetMain(
            surfaceId,
            template.stackId,
            translate("defaultDoc.dialog.content"),
            "nl.container",
        );
        const dialogNextEventId = "dialogNext";
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[contentBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                [dialogNextEventId]: {
                    id: dialogNextEventId,
                    name: translate("defaultDoc.dialog.nextEvent"),
                    graph: this.createDialogContentNextGraph(surfaceId, {
                        interactionLayerId: template.interactionLayerId,
                        panelId: template.panelId,
                        nametagId: template.nametagId,
                        sentenceId: template.sentenceId,
                    }),
                },
            };
        });

        const nametagBlueprintId = localBp.ensureWidgetMain(surfaceId, template.nametagId, translate("defaultDoc.dialog.nametag"), "nl.text");
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[nametagBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                nametagUpdate: {
                    id: "nametagUpdate",
                    name: translate("defaultDoc.dialog.updateNametagEvent"),
                    graph: this.createNametagUpdateGraph(),
                },
            };
        });
    }

    /** Resolves the default creation template (elements + blueprint seeding) for a Game UI slot. */
    private createStageSlotTemplate(
        slotId: UIStageSlotId,
        rootElement: UIElement,
        designSize: UISurfaceDesignSize,
    ): StageSlotTemplate | null {
        switch (slotId) {
            case "dialog": {
                const template = this.createDialogStageTemplate(rootElement, designSize);
                return {
                    elements: template.elements,
                    configure: surfaceId => this.configureDefaultDialogBlueprints(surfaceId, template),
                };
            }
            case "notification": {
                const template = this.createNotificationStageTemplate(rootElement, designSize);
                return {
                    elements: template.elements,
                    configure: () => this.configureDefaultNotificationBlueprints(template),
                };
            }
            case "choice": {
                const template = this.createChoiceStageTemplate(rootElement, designSize);
                return {
                    elements: template.elements,
                    configure: surfaceId => this.configureDefaultChoiceBlueprints(surfaceId, template),
                };
            }
            case "nvl": {
                const template = this.createNvlStageTemplate(rootElement, designSize);
                return {
                    elements: template.elements,
                    configure: surfaceId => this.configureDefaultNvlBlueprints(surfaceId, template),
                };
            }
            case "onStage":
                // On-Stage stays a bare transparent click-through root.
                return null;
        }
    }

    private createNotificationStageTemplate(
        rootElement: UIElement,
        designSize: UISurfaceDesignSize,
    ): NotificationStageTemplate {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const listId = uuidService.generate();
        const itemContainerId = uuidService.generate();
        const itemTextId = uuidService.generate();
        const listWidth = Math.round(designSize.width * 0.28);
        const listHeight = Math.round(designSize.height * 0.5);
        const itemWidth = Math.min(420, listWidth);

        rootElement.childrenIds = [listId];

        const list: UIElement = {
            id: listId,
            type: NOTIFICATION_LIST_WIDGET_TYPE,
            name: translate("defaultDoc.notification.list"),
            parentId: rootElement.id,
            childrenIds: [itemContainerId],
            layout: roundUILayoutGeometryFields({
                x: 24,
                y: 24,
                width: listWidth,
                height: listHeight,
                opacity: 1,
                visible: true,
            }),
            props: createListTemplateProps({
                itemKeyPath: "id",
                itemGap: 12,
                previewItems: [
                    { id: "preview-1", message: translate("defaultDoc.notification.messageText") },
                    { id: "preview-2", message: translate("defaultDoc.notification.anotherMessage") },
                ],
                scrollbar: {
                    ...cloneJson(defaultListWidgetProps.scrollbar),
                    enabled: false,
                    visibility: "hidden",
                },
            }),
        };

        const itemContainer: UIElement = {
            id: itemContainerId,
            type: "nl.container",
            name: translate("defaultDoc.notification.item"),
            parentId: listId,
            childrenIds: [itemTextId],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: itemWidth,
                height: 56,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "stack",
                stackDirection: "vertical",
                stackGap: 0,
                stackPaddingTop: 12,
                stackPaddingRight: 20,
                stackPaddingBottom: 12,
                stackPaddingLeft: 20,
                backgroundColor: "#0b0d12",
                fillOpacity: 0.72,
                borderRadius: 999,
                borderRadiusTL: 999,
                borderRadiusTR: 999,
                borderRadiusBL: 999,
                borderRadiusBR: 999,
                strokeVisible: false,
                borderWidth: 0,
                clipContent: true,
            }),
            extra: { listSlot: "itemTemplate" },
        };

        const itemText: UIElement = {
            id: itemTextId,
            type: "nl.text",
            name: translate("defaultDoc.notification.message"),
            parentId: itemContainerId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: Math.max(1, itemWidth - 40),
                height: 32,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.notification.messageText"),
                fontSize: 20,
                color: "#f8fafc",
                lineHeight: 1.3,
                textVerticalAlign: "center",
            }),
        };

        return {
            elements: {
                [list.id]: list,
                [itemContainer.id]: itemContainer,
                [itemText.id]: itemText,
            },
            listId,
            itemContainerId,
            itemTextId,
        };
    }

    private createChoiceStageTemplate(
        rootElement: UIElement,
        designSize: UISurfaceDesignSize,
    ): ChoiceStageTemplate {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const listId = uuidService.generate();
        const itemContainerId = uuidService.generate();
        const itemTextId = uuidService.generate();
        const listWidth = Math.round(designSize.width * 0.5);
        const listHeight = Math.round(designSize.height * 0.6);
        const listX = Math.round((designSize.width - listWidth) / 2);
        const listY = Math.round((designSize.height - listHeight) / 2);

        rootElement.childrenIds = [listId];

        const list: UIElement = {
            id: listId,
            type: CHOICE_LIST_WIDGET_TYPE,
            name: translate("defaultDoc.choice.list"),
            parentId: rootElement.id,
            childrenIds: [itemContainerId],
            layout: roundUILayoutGeometryFields({
                x: listX,
                y: listY,
                width: listWidth,
                height: listHeight,
                opacity: 1,
                visible: true,
            }),
            props: createListTemplateProps({
                itemKeyPath: "index",
                itemGap: 16,
                previewItems: [
                    { text: translate("defaultDoc.choice.previewA"), index: 0, disabled: false },
                    { text: translate("defaultDoc.choice.previewB"), index: 1, disabled: false },
                    { text: translate("defaultDoc.choice.previewC"), index: 2, disabled: true },
                ],
                scrollbar: {
                    ...cloneJson(defaultListWidgetProps.scrollbar),
                    enabled: false,
                    visibility: "hidden",
                },
            }),
        };

        const itemContainer: UIElement = {
            id: itemContainerId,
            type: "nl.container",
            name: translate("defaultDoc.choice.item"),
            parentId: listId,
            childrenIds: [itemTextId],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: listWidth,
                height: 64,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "stack",
                stackDirection: "vertical",
                stackGap: 0,
                stackPaddingTop: 14,
                stackPaddingRight: 24,
                stackPaddingBottom: 14,
                stackPaddingLeft: 24,
                backgroundColor: "#f8fafc",
                fillOpacity: 0.92,
                borderRadius: 8,
                borderRadiusTL: 8,
                borderRadiusTR: 8,
                borderRadiusBL: 8,
                borderRadiusBR: 8,
                strokeVisible: false,
                borderWidth: 0,
                clipContent: true,
            }),
            extra: { listSlot: "itemTemplate" },
        };

        const itemText: UIElement = {
            id: itemTextId,
            type: "nl.text",
            name: translate("defaultDoc.choice.text"),
            parentId: itemContainerId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: Math.max(1, listWidth - 48),
                height: 36,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.choice.itemText"),
                fontSize: 24,
                color: "#0b0d12",
                lineHeight: 1.3,
                textAlign: "center",
                textVerticalAlign: "center",
            }),
        };

        return {
            elements: {
                [list.id]: list,
                [itemContainer.id]: itemContainer,
                [itemText.id]: itemText,
            },
            listId,
            itemContainerId,
            itemTextId,
        };
    }

    private createNvlStageTemplate(
        rootElement: UIElement,
        designSize: UISurfaceDesignSize,
    ): NvlStageTemplate {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const interactionLayerId = uuidService.generate();
        const panelId = uuidService.generate();
        const listId = uuidService.generate();
        const nametagId = uuidService.generate();
        const textsId = uuidService.generate();
        const panelWidth = Math.round(designSize.width * 0.86);
        const panelHeight = Math.round(designSize.height * 0.88);
        const panelX = Math.round((designSize.width - panelWidth) / 2);
        const panelY = Math.round(designSize.height * 0.06);
        const listInset = 32;
        const listWidth = Math.max(1, panelWidth - listInset * 2);
        const listHeight = Math.max(1, panelHeight - listInset * 2);

        rootElement.childrenIds = [interactionLayerId, panelId];

        const interactionLayer: UIElement = {
            id: interactionLayerId,
            type: "nl.container",
            name: translate("defaultDoc.nvl.interactionLayer"),
            parentId: rootElement.id,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: designSize.width,
                height: designSize.height,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "free",
                backgroundColor: "transparent",
                fillVisible: false,
                fillOpacity: 0,
                strokeVisible: false,
                borderWidth: 0,
                stackPaddingTop: 0,
                stackPaddingRight: 0,
                stackPaddingBottom: 0,
                stackPaddingLeft: 0,
                clipContent: false,
            }),
        };

        const panel: UIElement = {
            id: panelId,
            type: "nl.container",
            name: translate("defaultDoc.nvl.panel"),
            parentId: rootElement.id,
            childrenIds: [listId],
            layout: roundUILayoutGeometryFields({
                x: panelX,
                y: panelY,
                width: panelWidth,
                height: panelHeight,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "free",
                backgroundColor: "#0b0d12",
                fillOpacity: 0.82,
                borderRadius: 12,
                borderRadiusTL: 12,
                borderRadiusTR: 12,
                borderRadiusBL: 12,
                borderRadiusBR: 12,
                strokeVisible: false,
                borderWidth: 0,
                clipContent: true,
            }),
        };

        const list: UIElement = {
            id: listId,
            type: NVL_LIST_WIDGET_TYPE,
            name: translate("defaultDoc.nvl.list"),
            parentId: panelId,
            childrenIds: [nametagId, textsId],
            layout: roundUILayoutGeometryFields({
                x: listInset,
                y: listInset,
                width: listWidth,
                height: listHeight,
                opacity: 1,
                visible: true,
            }),
            props: createListTemplateProps({
                itemKeyPath: "index",
                itemGap: 18,
                templateDirection: "vertical",
                templateGap: 6,
                previewItems: [
                    { nametag: translate("defaultDoc.speaker"), index: 0, isActive: false },
                    { nametag: "", index: 1, isActive: true },
                ],
            }),
        };

        const nametag: UIElement = {
            id: nametagId,
            type: "nl.text",
            name: translate("defaultDoc.nvl.nametag"),
            parentId: listId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: 320,
                height: 30,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.speaker"),
                fontSize: 20,
                color: "#f8d37a",
                fontWeight: "600",
                lineHeight: 1.2,
                textVerticalAlign: "center",
            }),
            extra: { listSlot: "itemTemplate" },
        };

        const texts: UIElement = {
            id: textsId,
            type: NVL_TEXTS_WIDGET_TYPE,
            name: translate("defaultDoc.nvl.texts"),
            parentId: listId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: Math.max(1, listWidth - 8),
                height: 64,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.nvl.entryText"),
                fontSize: 22,
                color: "#f8fafc",
                lineHeight: 1.5,
            }),
            extra: { listSlot: "itemTemplate" },
        };

        return {
            elements: {
                [interactionLayer.id]: interactionLayer,
                [panel.id]: panel,
                [list.id]: list,
                [nametag.id]: nametag,
                [texts.id]: texts,
            },
            interactionLayerId,
            panelId,
            listId,
            nametagId,
            textsId,
        };
    }

    /** Value graph: `Init -> Return Value` fed by `Get List Item Props -> Get JSON Field(propsPath)`. */
    private createListItemPropsValueGraph(propsPath: string): BlueprintGraphIr {
        const headId = "listItemValue.init";
        const getPropsId = "listItemValue.getItemProps";
        const getFieldId = "listItemValue.getField";
        const returnId = "listItemValue.return";
        return {
            nodes: {
                [headId]: {
                    id: headId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 120 } },
                } satisfies BlueprintGraphNode,
                [getPropsId]: {
                    id: getPropsId,
                    type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
                    params: {},
                    meta: { editorLayout: { x: 300, y: 20 } },
                } satisfies BlueprintGraphNode,
                [getFieldId]: {
                    id: getFieldId,
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
                    params: { path: propsPath },
                    meta: { editorLayout: { x: 540, y: 30 } },
                } satisfies BlueprintGraphNode,
                [returnId]: {
                    id: returnId,
                    type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
                    params: {},
                    meta: { editorLayout: { x: 800, y: 120 } },
                } satisfies BlueprintGraphNode,
            },
            edges: [
                {
                    from: { nodeId: headId, port: "then" },
                    to: { nodeId: returnId, port: "in" },
                },
                {
                    from: { nodeId: getPropsId, port: "props" },
                    to: { nodeId: getFieldId, port: "json" },
                },
                {
                    from: { nodeId: getFieldId, port: "result" },
                    to: { nodeId: returnId, port: "value" },
                },
            ],
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    /**
     * Creates a Blueprint Value binding on a template text element whose init graph reads the
     * current list item props field instead of a literal.
     */
    private seedListItemTextValueBinding(
        elementId: UIElementId,
        propsPath: string,
        displayName: string,
        literalValue: string,
    ): void {
        const localBp = this.getOptionalLocalBlueprintService();
        if (!localBp) {
            return;
        }
        const { blueprintId } = this.ensureElementBlueprintValueBinding(elementId, "text", {
            valueType: "string",
            displayName,
            literalValue,
        });
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[blueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            const initEntry = blueprint.program.graphs.events?.init;
            if (!initEntry) {
                return;
            }
            initEntry.graph = this.createListItemPropsValueGraph(propsPath);
        });
    }

    /** Event graph: `Item Click(index) -> Select Choice(index)`. */
    private createChoiceSelectGraph(): BlueprintGraphIr {
        const itemClickHeadId = "choice.select.itemClick";
        const chooseId = "choice.select.choose";
        return {
            nodes: {
                [itemClickHeadId]: {
                    id: itemClickHeadId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 60 } },
                } satisfies BlueprintGraphNode,
                [chooseId]: {
                    id: chooseId,
                    type: BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
                    params: {},
                    meta: { editorLayout: { x: 560, y: 80 } },
                } satisfies BlueprintGraphNode,
            },
            edges: [
                {
                    from: { nodeId: itemClickHeadId, port: "then" },
                    to: { nodeId: chooseId, port: "in" },
                },
                {
                    from: { nodeId: itemClickHeadId, port: "index" },
                    to: { nodeId: chooseId, port: "index" },
                },
            ],
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    /**
     * Event graph mirroring the Dialog advancement wiring for the NVL slot. Hosted on the NVL
     * Panel (`nl.container`) because collection widgets like `nl.nvl.list` do not expose a
     * `Mouse Click` head; the panel's own Mouse Click plus Element Click on the interaction layer
     * and the list cover every click region.
     */
    private createNvlNextGraph(
        surfaceId: UISurfaceId,
        targets: {
            interactionLayerId: UIElementId;
        },
    ): BlueprintGraphIr {
        // The panel's own Mouse Click catches every click inside the panel via DOM bubbling
        // (children re-dispatch but never DOM-stopPropagation); the interaction layer Element Click
        // catches clicks in the full-screen area outside the panel.
        const panelClickHeadId = "nvl.next.panelMouseClick";
        const spaceHeadId = "nvl.next.spaceKeyUp";
        const nextId = "nvl.next";
        const elementClickTargets = [
            {
                nodeId: "nvl.next.interactionLayerElementClick",
                elementId: targets.interactionLayerId,
                elementType: "nl.container",
                y: 210,
            },
        ] as const;
        const nodes: Record<string, BlueprintGraphNode> = {
            [panelClickHeadId]: {
                id: panelClickHeadId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
                params: {},
                meta: { editorLayout: { x: 80, y: 40 } },
            },
            [spaceHeadId]: {
                id: spaceHeadId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
                params: {
                    [BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME]: " ",
                },
                meta: { editorLayout: { x: 80, y: 550 } },
            },
            [nextId]: {
                id: nextId,
                type: BLUEPRINT_NODE_TYPE_GAME_NEXT,
                params: {},
                meta: { editorLayout: { x: 560, y: 295 } },
            },
        };
        const edges: NonNullable<BlueprintGraphIr["edges"]> = [
            {
                from: { nodeId: panelClickHeadId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            },
            {
                from: { nodeId: spaceHeadId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            },
        ];
        for (const target of elementClickTargets) {
            nodes[target.nodeId] = {
                id: target.nodeId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                params: {
                    surfaceId,
                    elementId: target.elementId,
                    elementType: target.elementType,
                },
                meta: { editorLayout: { x: 80, y: target.y } },
            };
            edges.push({
                from: { nodeId: target.nodeId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            });
        }
        return {
            nodes,
            edges,
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    private configureDefaultNotificationBlueprints(template: NotificationStageTemplate): void {
        this.seedListItemTextValueBinding(
            template.itemTextId,
            "message",
            translate("defaultDoc.notification.message"),
            translate("defaultDoc.notification.messageText"),
        );
    }

    private configureDefaultChoiceBlueprints(surfaceId: UISurfaceId, template: ChoiceStageTemplate): void {
        const localBp = this.getOptionalLocalBlueprintService();
        if (!localBp) {
            return;
        }

        this.seedListItemTextValueBinding(template.itemTextId, "text", translate("defaultDoc.choice.text"), translate("defaultDoc.choice.itemText"));

        const listBlueprintId = localBp.ensureWidgetMain(
            surfaceId,
            template.listId,
            translate("defaultDoc.choice.list"),
            CHOICE_LIST_WIDGET_TYPE,
        );
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[listBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                choiceSelect: {
                    id: "choiceSelect",
                    name: translate("defaultDoc.choice.selectEvent"),
                    graph: this.createChoiceSelectGraph(),
                },
            };
        });
    }

    private configureDefaultNvlBlueprints(surfaceId: UISurfaceId, template: NvlStageTemplate): void {
        const localBp = this.getOptionalLocalBlueprintService();
        if (!localBp) {
            return;
        }

        this.seedListItemTextValueBinding(template.nametagId, "nametag", translate("defaultDoc.nvl.nametag"), translate("defaultDoc.speaker"));

        // Advancement graph hosted on the Panel (nl.container) - collection widgets like the NVL
        // List do not expose a Mouse Click head.
        const panelBlueprintId = localBp.ensureWidgetMain(
            surfaceId,
            template.panelId,
            translate("defaultDoc.nvl.panel"),
            "nl.container",
        );
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[panelBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                nvlNext: {
                    id: "nvlNext",
                    name: translate("defaultDoc.nvl.nextEvent"),
                    graph: this.createNvlNextGraph(surfaceId, {
                        interactionLayerId: template.interactionLayerId,
                    }),
                },
            };
        });
    }

    private ensureMainSurface(document: UIDocument): boolean {
        const designSize = this.getProjectDesignSize();
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const existingMain = document.surfaces.find(surface => surface.id === MAIN_APP_SURFACE_ID);
        let changed = false;
        if (existingMain) {
            if (!document.elements[existingMain.rootElementId]) {
                const rootElementId = uuidService.generate();
                existingMain.rootElementId = rootElementId;
                document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
                changed = true;
            }
            return changed;
        }

        const candidate = document.surfaces.find(surface => surface.kind === "appSurface");
        if (candidate) {
            candidate.id = MAIN_APP_SURFACE_ID;
            candidate.name = candidate.name || DEFAULT_APP_SURFACE_NAME;
            if (!document.elements[candidate.rootElementId]) {
                const rootElementId = uuidService.generate();
                candidate.rootElementId = rootElementId;
                document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
            }
            return true;
        }

        const rootElementId = uuidService.generate();
        const surface: UISurface = {
            id: MAIN_APP_SURFACE_ID,
            name: DEFAULT_APP_SURFACE_NAME,
            host: "app",
            kind: "appSurface",
            designSize: {
                width: designSize.width,
                height: designSize.height,
            },
            rootElementId,
            settings: createDefaultPageSurfaceSettings(),
        };

        document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
        document.surfaces.unshift(surface);
        return true;
    }

    private getDocumentPath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorUIDocument);
    }

    private async ensureDocumentDir(): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const dir = this.getContext().project.resolve(ProjectNameConvention.EditorUI);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access UI document directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create UI document directory");
            }
        }
    }
}
