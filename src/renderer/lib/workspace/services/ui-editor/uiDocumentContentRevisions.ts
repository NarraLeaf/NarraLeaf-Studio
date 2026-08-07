import type { UIComponentDefinition, UIComponentId, UIDocument, UISurfaceId } from "@shared/types/ui-editor/document";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE, getUIFrameWidgetProps } from "@shared/types/ui-editor/frame";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { collectSubtreeElementIds } from "./uiDocumentTreeMove";

/**
 * Per-surface / per-component change counters.
 *
 * The document revision says *something* changed; it says nothing about *what*. Every live preview
 * in the interface panel is a full element tree, so a single revision shared by the whole document
 * means moving one button in one page rebuilds the preview of every other page and every component
 * in the library. That cost is linear in project size, which is why a project grows sluggish as
 * surfaces are added rather than being slow from the start.
 *
 * A content revision is bumped only when the bytes a given preview actually reads have changed. It
 * is derived rather than declared: signatures are recomputed at most once per document revision and
 * compared, so no mutation path has to remember to announce which surface it touched (there are
 * dozens, and a forgotten one would show up as a preview that silently stops updating).
 *
 * "The bytes a preview reads" is wider than the surface's own subtree: a Page component renders its
 * target page inline, and a component instance renders the library definition, so both are followed.
 */
export class UIDocumentContentRevisions {
    private readonly surfaces = new Map<UISurfaceId, RevisionEntry>();
    private readonly components = new Map<UIComponentId, RevisionEntry>();
    private componentLibrary: { documentRevision: number; signature: string } | null = null;

    public getSurfaceContentRevision(document: UIDocument, documentRevision: number, surfaceId: UISurfaceId): number {
        return this.resolve(this.surfaces, surfaceId, documentRevision, () =>
            this.buildSurfaceSignature(document, documentRevision, surfaceId, new Set()),
        );
    }

    public getComponentContentRevision(
        document: UIDocument,
        documentRevision: number,
        componentId: UIComponentId,
    ): number {
        return this.resolve(this.components, componentId, documentRevision, () =>
            this.buildComponentSignature(document, documentRevision, componentId),
        );
    }

    /**
     * Invalidate every cached signature, for a document that was replaced rather than edited.
     *
     * The counters are deliberately kept rather than cleared. Clearing them restarts at 1, and a
     * preview that last saw 1 would decide it has nothing to redraw - a card left showing the
     * previous project's page. Keeping them means the next read recomputes and, if the content is
     * genuinely different, moves past whatever the card remembers.
     */
    public reset(): void {
        for (const entry of [...this.surfaces.values(), ...this.components.values()]) {
            entry.documentRevision = -1;
            entry.signature = INVALIDATED;
        }
        this.componentLibrary = null;
    }

    private resolve(
        cache: Map<string, RevisionEntry>,
        key: string,
        documentRevision: number,
        buildSignature: () => string,
    ): number {
        const entry = cache.get(key);
        if (entry && entry.documentRevision === documentRevision) {
            return entry.contentRevision;
        }
        const signature = buildSignature();
        if (entry) {
            entry.documentRevision = documentRevision;
            if (entry.signature !== signature) {
                entry.signature = signature;
                entry.contentRevision += 1;
            }
            return entry.contentRevision;
        }
        cache.set(key, { documentRevision, signature, contentRevision: 1 });
        return 1;
    }

    private buildSurfaceSignature(
        document: UIDocument,
        documentRevision: number,
        surfaceId: UISurfaceId,
        visited: Set<UISurfaceId>,
    ): string {
        if (visited.has(surfaceId)) {
            return "";
        }
        visited.add(surfaceId);
        const surface = document.surfaces.find(next => next.id === surfaceId);
        if (!surface) {
            return "";
        }
        const parts: string[] = [JSON.stringify(surface)];
        const rootElementId = resolveSurfaceRootElementId(document, surfaceId);
        if (!rootElementId) {
            return parts.join(SEPARATOR);
        }

        let readsComponentLibrary = false;
        const nestedSurfaceIds: UISurfaceId[] = [];
        for (const elementId of collectSubtreeElementIds(document, rootElementId)) {
            const element = document.elements[elementId];
            if (!element) {
                continue;
            }
            parts.push(JSON.stringify(element));
            if (getUIComponentLink(element)) {
                readsComponentLibrary = true;
            }
            if (element.type === UI_FRAME_ELEMENT_TYPE) {
                const targetSurfaceId = getUIFrameWidgetProps(element).targetSurfaceId;
                if (targetSurfaceId) {
                    nestedSurfaceIds.push(targetSurfaceId);
                }
            }
        }
        if (readsComponentLibrary) {
            parts.push(this.getComponentLibrarySignature(document, documentRevision));
        }
        for (const nestedSurfaceId of nestedSurfaceIds) {
            parts.push(this.buildSurfaceSignature(document, documentRevision, nestedSurfaceId, visited));
        }
        return parts.join(SEPARATOR);
    }

    private buildComponentSignature(
        document: UIDocument,
        documentRevision: number,
        componentId: UIComponentId,
    ): string {
        const component = (document.components ?? []).find(next => next.id === componentId);
        if (!component) {
            return "";
        }
        const own = JSON.stringify(component);
        return componentEmbedsAnotherComponent(component)
            ? `${own}${SEPARATOR}${this.getComponentLibrarySignature(document, documentRevision)}`
            : own;
    }

    private getComponentLibrarySignature(document: UIDocument, documentRevision: number): string {
        if (this.componentLibrary && this.componentLibrary.documentRevision === documentRevision) {
            return this.componentLibrary.signature;
        }
        const signature = JSON.stringify(document.components ?? []);
        this.componentLibrary = { documentRevision, signature };
        return signature;
    }
}

type RevisionEntry = {
    documentRevision: number;
    signature: string;
    contentRevision: number;
};

/** No signature can equal this: a real one is either empty or starts with `{`. */
const INVALIDATED = "invalidated";

/** JSON.stringify never emits a raw newline (it escapes them), so no part can span the join. */
const SEPARATOR = "\n";

function componentEmbedsAnotherComponent(component: UIComponentDefinition): boolean {
    return Object.values(component.elements).some(element => Boolean(getUIComponentLink(element)));
}
