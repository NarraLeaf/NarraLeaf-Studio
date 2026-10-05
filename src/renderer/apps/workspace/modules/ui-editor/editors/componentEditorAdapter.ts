import type {
    UIDocument,
    UIElement,
    UIElementValueBindingValueType,
    UILayout,
    UISurface,
} from "@shared/types/ui-editor/document";
import type { UIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { MoveUiElementsResult } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { COMPONENT_EDITOR_VIRTUAL_ROOT_PREFIX } from "@/lib/ui-editor/componentEditorRoot";
import {
    buildUIComponentEditorSurfaceId,
    readUIComponentEditorSurfaceComponentId,
} from "@shared/types/ui-editor/componentInstanceKey";

export const COMPONENT_TAB_PREFIX = "ui-editor:component:";

export const getComponentTabId = (componentId: string) => `${COMPONENT_TAB_PREFIX}${componentId}`;
// The editor surface id is spelled in shared, beside the definition's own surface id: element
// references saved under it are read back by the runtime (`normalizeUIElementRefSurfaceId`).
export const getComponentEditorSurfaceId = buildUIComponentEditorSurfaceId;
export const getComponentEditorRootId = (componentId: string) => `${COMPONENT_EDITOR_VIRTUAL_ROOT_PREFIX}${componentId}`;

export function parseComponentEditorSurfaceId(surfaceId: string | null | undefined): string | null {
    return readUIComponentEditorSurfaceComponentId(surfaceId);
}

function cloneElement(element: UIElement): UIElement {
    return {
        ...element,
        childrenIds: [...element.childrenIds],
        layout: { ...element.layout },
        props: element.props ? { ...element.props } : undefined,
        style: element.style ? { ...element.style } : undefined,
        valueBindings: element.valueBindings ? { ...element.valueBindings } : undefined,
        extra: element.extra ? { ...element.extra } : undefined,
    };
}

/**
 * The size the component editor's canvas is drawn at: the definition's own, which is its root's.
 *
 * The same measure every placement scales from (`buildUIComponentDocumentView`), so the frame the
 * author edits in is the box a placement draws, and what falls outside it here is what a placement
 * cuts off. The canvas used to take the project's page size instead, and a 456x348 save slot sat in
 * the corner of a 1920x1080 white page - which read as the component being a page, or as something
 * being broken.
 */
function resolveComponentEditorDesignSize(root: UIElement | undefined): UISurface["designSize"] {
    return {
        width: Math.max(1, Math.abs(root?.layout.width ?? 1)),
        height: Math.max(1, Math.abs(root?.layout.height ?? 1)),
    };
}

export class ComponentDocumentServiceAdapter {
    public readonly surfaceId: string;
    private readonly virtualRootId: string;
    /** The last document built, and the base document and revision it was built from. */
    private built: { base: UIDocument; revision: number; document: UIDocument } | null = null;

    public constructor(
        private readonly base: UIDocumentService,
        private readonly componentId: string,
    ) {
        this.surfaceId = getComponentEditorSurfaceId(componentId);
        this.virtualRootId = getComponentEditorRootId(componentId);
    }

    /**
     * The component shown as a document of its own: one surface, a virtual root, and the
     * component's elements.
     *
     * The same object until the base document changes, as the base service's own document is.
     * Built fresh on every read, the editor tab got a new surface on every render and everything it
     * keeps per surface ran again - its whole canvas was re-rendered on each selection change
     * anywhere in the workspace, while the tab was not even on screen. The base changes either in
     * place, which moves its revision, or by being replaced (loaded, saved, restored from history),
     * which changes the object; both are checked.
     */
    public getDocument(): UIDocument {
        const baseDocument = this.base.getDocument();
        const revision = this.base.getRevision();
        if (this.built && this.built.base === baseDocument && this.built.revision === revision) {
            return this.built.document;
        }
        const document = this.buildDocument(baseDocument);
        this.built = { base: baseDocument, revision, document };
        return document;
    }

    private buildDocument(baseDocument: UIDocument): UIDocument {
        const component = this.base.getComponent(this.componentId);
        if (!component) {
            return {
                ...baseDocument,
                surfaces: [],
                elements: {},
            };
        }

        const root = component.elements[component.rootElementId];
        const designSize = resolveComponentEditorDesignSize(root);
        const surface: UISurface = {
            id: this.surfaceId,
            name: component.name,
            host: "app",
            kind: "appSurface",
            designSize,
            rootElementId: this.virtualRootId,
            // A definition has no background of its own: a placement draws it over whatever page it
            // is put on. Left to the page default, the frame painted itself white.
            settings: { backgroundColor: "transparent" },
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
                // Under the made-up root, which is what makes it the frame everywhere in the editor
                // (`isComponentEditorRootElement`) - whatever it is called and whichever template or
                // language it came from.
                copy.parentId = this.virtualRootId;
                // At the frame's origin whatever position is stored, because that is where a
                // placement draws it: the root's own x and y are never read outside this editor.
                copy.layout.x = 0;
                copy.layout.y = 0;
            }
            elements[elementId] = copy;
        }
        return {
            ...baseDocument,
            // The project's pages stay listed beside the definition's own surface. Everything in this
            // editor that asks the document about a page by id - a Page widget's picker and the page
            // it draws on the canvas, its "open the page" button, what a paste says it could not
            // resolve - is asking about the project's pages, not about the definition. With the
            // definition's surface alone, a Page widget authored here could not be pointed at any
            // page, and one pasted in drew "Missing Page". The pages' elements are not carried: the
            // canvas draws a page from the project's own document (`pageDocument`), and this
            // document's elements are the definition's.
            surfaces: [surface, ...baseDocument.surfaces],
            elements,
        };
    }

    /**
     * The project's document rather than this editor's view of it.
     *
     * The view carries the definition's elements and none of the pages', so a question about where
     * a page leads - what it places, what its own Page widgets draw - has nothing to walk in it.
     */
    public getPageDocument(): UIDocument {
        return this.base.getDocument();
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

    public updateElementLayout(
        elementId: string,
        layoutPatch: Partial<UILayout>,
        options: { skipHistory?: boolean } = {},
    ): void {
        const patch = this.writableLayoutPatch(elementId, layoutPatch);
        if (patch) {
            this.base.updateComponentElementLayout(this.componentId, elementId, patch, options);
        }
    }

    /**
     * Every element's patch in one write, so one gesture is one undo step in the definition's history
     * - a drag of three elements, or a run of arrow-key nudges folded by `mergeKey`.
     */
    public updateElementLayouts(
        layoutPatches: Record<string, Partial<UILayout>>,
        options: { mergeKey?: string } = {},
    ): void {
        const writable: Record<string, Partial<UILayout>> = {};
        for (const [elementId, layoutPatch] of Object.entries(layoutPatches)) {
            const patch = this.writableLayoutPatch(elementId, layoutPatch);
            if (patch) {
                writable[elementId] = patch;
            }
        }
        if (Object.keys(writable).length > 0) {
            this.base.updateComponentElementLayouts(this.componentId, writable, options);
        }
    }

    /** What of a layout patch is stored for this element, or null when nothing is. */
    private writableLayoutPatch(elementId: string, layoutPatch: Partial<UILayout>): Partial<UILayout> | null {
        if (this.isVirtualRoot(elementId)) {
            return null;
        }
        if (!this.isComponentRoot(elementId)) {
            return layoutPatch;
        }
        // The root is drawn at the frame's origin (see `buildDocument`), so a position written to it
        // would change the stored definition and nothing anyone can see. Its size is the component's
        // size, and goes through.
        const { x: _x, y: _y, ...rest } = layoutPatch;
        return Object.keys(rest).length > 0 ? rest : null;
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

    public updateElementAnimation(
        elementId: string,
        animation: UIPageAnimationSettings | null,
        options: { mergeKey?: string } = {},
    ): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        this.base.updateComponentElementAnimation(this.componentId, elementId, animation, options);
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

    /**
     * The row-field binding, on a definition's element. The base service's own version looks the
     * element up in the document's table, which a definition's elements are not in.
     */
    public setElementListItemFieldBinding(elementId: string, propPath: string, fieldId: string | null): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        const id = fieldId?.trim();
        this.base.setComponentElementValueBinding(
            this.componentId,
            elementId,
            propPath,
            id ? { kind: "listItemField", fieldId: id } : null,
        );
    }

    /** Show one of this component's text parameters in an element's words, or (`null`) stop showing one. */
    public setElementComponentParamBinding(elementId: string, propPath: string, paramId: string | null): void {
        if (this.isVirtualRoot(elementId)) {
            return;
        }
        const id = paramId?.trim();
        this.base.setComponentElementValueBinding(
            this.componentId,
            elementId,
            propPath,
            id ? { kind: "componentParam", paramId: id } : null,
        );
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

    public groupElements(_surfaceId: string, elementIds: readonly string[]): string | null {
        const ids = elementIds.filter(id => !this.isVirtualRoot(id) && !this.isComponentRoot(id));
        return ids.length > 0 ? this.base.groupComponentElements(this.componentId, ids) : null;
    }

    public ungroupContainers(_surfaceId: string, containerIds: string[]): string[] {
        const ids = containerIds.filter(id => !this.isVirtualRoot(id) && !this.isComponentRoot(id));
        return ids.length > 0 ? this.base.ungroupComponentContainers(this.componentId, ids) : [];
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

    /**
     * Delegated rather than omitted. Nothing here can create a nested instance, so nothing inside a
     * component editor should have params to supply - but the inspector reaches this object through
     * a cast, so a missing method would be a TypeError rather than a no-op if an instance placed
     * before that restriction ever got selected. The base looks the element up in the document's own
     * table, which a component's elements are not in, so it does nothing.
     */
    public setComponentInstanceParam(elementId: string, paramId: string, value: string): void {
        this.base.setComponentInstanceParam(elementId, paramId, value);
    }

    /** Delegated for the reason {@link setComponentInstanceParam} is. */
    public setComponentInstanceParamKey(elementId: string, paramId: string, keyName: string | null): void {
        this.base.setComponentInstanceParamKey(elementId, paramId, keyName);
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

    /**
     * Everything `action` writes as one step in the definition's history: the drag commit (layouts
     * and image flips together), a widget inspector's compound edit.
     */
    public runSurfaceHistoryTransaction(_surfaceId: string, action: () => void): void {
        this.base.runSurfaceHistoryTransaction(this.surfaceId, action);
    }

    /**
     * The workspace behind the real document service.
     *
     * Delegated because the clipboard reads its project - the path a pasted payload is compared
     * against, the library a foreign paste imports into - off whichever document service the editor
     * hands it, and a component editor is the same project as the surfaces around it.
     */
    public getContext(): ReturnType<UIDocumentService["getContext"]> {
        return this.base.getContext();
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
