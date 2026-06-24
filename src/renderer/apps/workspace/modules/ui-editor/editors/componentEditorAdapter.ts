import type {
    UIDocument,
    UIElement,
    UIElementValueBindingValueType,
    UILayout,
    UISurface,
} from "@shared/types/ui-editor/document";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { MoveUiElementsResult } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { DEFAULT_UI_SURFACE_SIZE, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { COMPONENT_EDITOR_ROOT_EXTRA_KEY } from "@/lib/ui-editor/componentEditorRoot";

export const COMPONENT_TAB_PREFIX = "ui-editor:component:";
export const COMPONENT_EDITOR_SURFACE_PREFIX = "component-editor:";
const COMPONENT_EDITOR_ROOT_PREFIX = "component-editor-root:";

export const getComponentTabId = (componentId: string) => `${COMPONENT_TAB_PREFIX}${componentId}`;
export const getComponentEditorSurfaceId = (componentId: string) => `${COMPONENT_EDITOR_SURFACE_PREFIX}${componentId}`;
export const getComponentEditorRootId = (componentId: string) => `${COMPONENT_EDITOR_ROOT_PREFIX}${componentId}`;

export function parseComponentEditorSurfaceId(surfaceId: string | null | undefined): string | null {
    if (!surfaceId?.startsWith(COMPONENT_EDITOR_SURFACE_PREFIX)) {
        return null;
    }
    return surfaceId.slice(COMPONENT_EDITOR_SURFACE_PREFIX.length) || null;
}

function cloneElement(element: UIElement): UIElement {
    return {
        ...element,
        childrenIds: [...element.childrenIds],
        layout: { ...element.layout },
        props: element.props ? { ...element.props } : undefined,
        style: element.style ? { ...element.style } : undefined,
        behavior: element.behavior ? { ...element.behavior } : undefined,
        valueBindings: element.valueBindings ? { ...element.valueBindings } : undefined,
        extra: element.extra ? { ...element.extra } : undefined,
    };
}

function resolveDefaultComponentEditorDesignSize(baseDocument: UIDocument): UISurface["designSize"] {
    const appSurface =
        baseDocument.surfaces.find(surface => surface.id === MAIN_APP_SURFACE_ID) ??
        baseDocument.surfaces.find(surface => surface.kind === "appSurface") ??
        baseDocument.surfaces[0];
    return appSurface?.designSize ?? DEFAULT_UI_SURFACE_SIZE;
}

function isComponentEditorWrapperRoot(element: UIElement, componentRootId: string): boolean {
    return element.id === componentRootId && element.type === "nl.container" && (element.name ?? "").trim() === "Root";
}

export class ComponentDocumentServiceAdapter {
    public readonly surfaceId: string;
    private readonly virtualRootId: string;

    public constructor(
        private readonly base: UIDocumentService,
        private readonly componentId: string,
    ) {
        this.surfaceId = getComponentEditorSurfaceId(componentId);
        this.virtualRootId = getComponentEditorRootId(componentId);
    }

    public getDocument(): UIDocument {
        const baseDocument = this.base.getDocument();
        const component = this.base.getComponent(this.componentId);
        if (!component) {
            return {
                ...baseDocument,
                surfaces: [],
                elements: {},
            };
        }

        const root = component.elements[component.rootElementId];
        const designSize = resolveDefaultComponentEditorDesignSize(baseDocument);
        const surface: UISurface = {
            id: this.surfaceId,
            name: component.name,
            host: "app",
            kind: "appSurface",
            designSize,
            rootElementId: this.virtualRootId,
        };
        const virtualRoot: UIElement = {
            id: this.virtualRootId,
            type: "nl.root",
            name: component.name,
            parentId: null,
            childrenIds: root ? [component.rootElementId] : [],
            layout: {
                x: 0,
                y: 0,
                width: surface.designSize.width,
                height: surface.designSize.height,
                opacity: 1,
                visible: true,
            },
        };
        const elements: Record<string, UIElement> = {
            [this.virtualRootId]: virtualRoot,
        };
        for (const [elementId, element] of Object.entries(component.elements)) {
            const copy = cloneElement(element);
            if (elementId === component.rootElementId) {
                copy.parentId = this.virtualRootId;
                if (isComponentEditorWrapperRoot(element, component.rootElementId)) {
                    copy.extra = {
                        ...(copy.extra ?? {}),
                        [COMPONENT_EDITOR_ROOT_EXTRA_KEY]: true,
                    };
                }
            }
            elements[elementId] = copy;
        }
        return {
            ...baseDocument,
            surfaces: [surface],
            elements,
        };
    }

    public getRevision(): number {
        return this.base.getRevision();
    }

    public isDirty(): boolean {
        return this.base.isDirty();
    }

    public onDocumentChanged(handler: (doc: UIDocument) => void): () => void {
        return this.base.onDocumentChanged(() => handler(this.getDocument()));
    }

    public onDirtyChanged(handler: (dirty: boolean) => void): () => void {
        return this.base.onDirtyChanged(handler);
    }

    public getComponent(componentId: string) {
        return this.base.getComponent(componentId);
    }

    public updateElementLayout(elementId: string, layoutPatch: Partial<UILayout>): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        this.base.updateComponentElementLayout(this.componentId, elementId, layoutPatch);
    }

    public updateElementLayouts(layoutPatches: Record<string, Partial<UILayout>>): void {
        for (const [elementId, layoutPatch] of Object.entries(layoutPatches)) {
            this.updateElementLayout(elementId, layoutPatch);
        }
    }

    public updateElementProps(elementId: string, propsPatch: Record<string, unknown>): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        this.base.updateComponentElementProps(this.componentId, elementId, propsPatch);
    }

    public updateElementExtra(elementId: string, extraPatch: Record<string, unknown>): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        this.base.updateComponentElementExtra(this.componentId, elementId, extraPatch);
    }

    public renameElement(elementId: string, name: string): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        this.base.renameComponentElement(this.componentId, elementId, name);
    }

    public ensureElementBlueprintValueBinding(
        _elementId: string,
        _propPath: string,
        _input: { valueType: UIElementValueBindingValueType; displayName?: string; literalValue?: unknown },
    ): { blueprintId: string } {
        throw new Error("Component definition elements cannot use Blueprint Value bindings yet");
    }

    public clearElementBlueprintValueBinding(_elementId: string, _propPath: string): void {
        return;
    }

    public setElementBlueprintEvent(
        elementId: string,
        eventName: string,
        ref: { blueprintId: string; eventId: string },
    ): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        this.base.setComponentElementBlueprintEvent(this.componentId, elementId, eventName, ref);
    }

    public clearElementBlueprintEvent(elementId: string, eventName: string): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        this.base.clearComponentElementBlueprintEvent(this.componentId, elementId, eventName);
    }

    public stripBlueprintLayerBindings(_surfaceId: string, blueprintId: string, layerEventId: string): void {
        this.base.stripComponentBlueprintLayerBindings(this.componentId, blueprintId, layerEventId);
    }

    public reorderChildren(parentId: string, orderedChildIds: string[]): void {
        const actualParentId = this.mapParentId(parentId);
        if (!actualParentId) {
            return;
        }
        this.base.reorderComponentChildren(this.componentId, actualParentId, orderedChildIds);
    }

    public moveElementsInSurface(
        _surfaceId: string,
        elementIds: string[],
        targetParentId: string,
        beforeChildId: string | null,
    ): MoveUiElementsResult {
        const actualParentId = this.mapParentId(targetParentId);
        if (!actualParentId) {
            return { ok: false, reason: "invalid_target" };
        }
        const movers = elementIds.filter(id => !this.isVirtualRoot(id) && !this.isComponentRoot(id));
        if (movers.length === 0) {
            return { ok: false, reason: "invalid_movers" };
        }
        return this.base.moveComponentElements(this.componentId, movers, actualParentId, beforeChildId);
    }

    public deleteElements(elementIds: string[]): void {
        const ids = elementIds.filter(id => !this.isVirtualRoot(id) && !this.isComponentRoot(id));
        this.base.deleteComponentElements(this.componentId, ids);
    }

    public createElement(parentId: string, type: string, layoutPatch: Partial<UILayout> = {}): UIElement {
        const actualParentId = this.mapParentId(parentId);
        if (!actualParentId) {
            throw new Error("Cannot create an element at the component editor root");
        }
        const created = this.base.createComponentElement(this.componentId, actualParentId, type, layoutPatch);
        if (!created) {
            throw new Error("This component element cannot contain children");
        }
        return created;
    }

    public createComponentInstance(): UIElement {
        throw new Error("Nested linked components are disabled while editing a component definition");
    }

    public unlinkComponentInstance(_elementId: string): string[] {
        return [];
    }

    public createComponentFromElements(): null {
        return null;
    }

    public pasteClipboardPayload(
        _surfaceId: string,
        targetParentId: string,
        beforeChildId: string | null,
        payload: UIEditorClipboardPayload,
    ): { ok: true; newRootIds: string[] } | { ok: false; reason: "invalid_clipboard" | "invalid_target" } {
        const actualParentId = this.mapParentId(targetParentId);
        if (!actualParentId) {
            return { ok: false, reason: "invalid_target" };
        }
        return this.base.pasteComponentClipboardPayload(this.componentId, actualParentId, beforeChildId, payload);
    }

    public runSurfaceHistoryTransaction(_surfaceId: string, action: () => void): void {
        action();
    }

    private mapParentId(parentId: string): string | null {
        if (this.isVirtualRoot(parentId)) {
            return this.base.getComponent(this.componentId)?.rootElementId ?? null;
        }
        return parentId;
    }

    private isVirtualRoot(elementId: string): boolean {
        return elementId === this.virtualRootId;
    }

    private isComponentRoot(elementId: string): boolean {
        return this.base.getComponent(this.componentId)?.rootElementId === elementId;
    }
}

export function createComponentDocumentServiceAdapter(
    base: UIDocumentService,
    componentId: string,
): UIDocumentService {
    return new ComponentDocumentServiceAdapter(base, componentId) as unknown as UIDocumentService;
}
