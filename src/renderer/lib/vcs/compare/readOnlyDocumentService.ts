import { getUIComponentLink, type UIComponentDefinition, type UIDocument } from "@shared/types/ui-editor/document";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

/**
 * A document service over a version that has already happened.
 *
 * The inspector is schema-driven and every schema takes a `UIDocumentService`: `getElementInspector`
 * asks a widget module for its fields, and those fields read the document through the service to
 * find a parent's size, a component's parameters, a bound blueprint. Handing them the LIVE service
 * while the element they are describing came out of an older version would draw one version's fields
 * over another version's document - so a comparison hands them this instead: one frozen document,
 * and nothing that can write.
 *
 * **Refusal is the enforcement, and it is not the affordance.** The greying out is done elsewhere
 * (`readOnlyInspection`, which the freeze guard consults, and which the whole property framework
 * already obeys). This is the layer under it, and it exists because the affordance alone cannot be
 * trusted here: the workspace write freeze is a module-level latch and cannot be scoped to a React
 * subtree, so a field whose renderer forgot to consult the guard would otherwise reach a real
 * service and write the author's project from a picture of the past. Every write throws instead.
 *
 * **Unknown members throw too, and that is the point of the proxy.** `UIDocumentService` has around
 * ninety public methods and gains more; a hand-written adapter would list the ones that existed the
 * day it was written and silently pass the next one through to nothing. Here the readers are
 * enumerated and everything else is a refusal, so a method added tomorrow is refused rather than
 * missing - the same "name what keeps working, never what is switched off" rule the freeze's context
 * menu exemption follows.
 */

/** Thrown by every mutator of a read-only document service. */
export class ReadOnlyDocumentError extends Error {
    public constructor(public readonly member: string) {
        super(`This document is a comparison and cannot be edited (${member})`);
        this.name = "ReadOnlyDocumentError";
    }
}

/**
 * The members a frozen document can honestly answer.
 *
 * Both revision counters answer a constant, which is what a document that cannot change is: the
 * panels that key a memo on them re-run when the SELECTION moves, which is the only thing that
 * changes what this service holds.
 */
function readers(document: UIDocument, context: WorkspaceContext | null): Record<string, unknown> {
    return {
        getDocument: (): UIDocument => document,
        getRevision: (): number => 0,
        getSurfaceContentRevision: (): number => 0,
        getComponentContentRevision: (): number => 0,
        isDirty: (): boolean => false,
        // A document that cannot change never notifies. Returning the unsubscribe an effect expects
        // rather than nothing, so a caller's cleanup is not a TypeError.
        onDocumentChanged: (): (() => void) => () => undefined,
        onDirtyChanged: (): (() => void) => () => undefined,
        getComponent: (componentId: string): UIComponentDefinition | undefined =>
            (document.components ?? []).find(component => component.id === componentId),
        getComponentUsageCount: (componentId: string): number => {
            let count = 0;
            for (const element of Object.values(document.elements)) {
                if (getUIComponentLink(element)?.componentId === componentId) {
                    count += 1;
                }
            }
            return count;
        },
        /**
         * The live workspace, because the fields that ask for it ask about the PROJECT rather than
         * about the document: which assets exist, what the project is called. A comparison has no
         * workspace of its own and inventing one would break every such field rather than answer it.
         *
         * A caveat the rail states for itself: an asset replaced since the older version was recorded
         * is resolved to today's file here. The canvases solve that with a per-version asset source;
         * a field that draws a thumbnail cannot, which is why the inspector says which version the
         * element is from rather than implying the whole panel is that version.
         */
        getContext: (): WorkspaceContext => {
            if (!context) {
                throw new ReadOnlyDocumentError("getContext");
            }
            return context;
        },
    };
}

/**
 * A `UIDocumentService` over one parsed document, whose every write throws.
 *
 * The cast at the end is the same one `createComponentDocumentServiceAdapter` makes, and for the
 * same reason: the inspector's contract is the service's public surface, not its class, and nothing
 * in the renderer can construct the real one without a workspace behind it.
 */
export function createReadOnlyDocumentService(
    document: UIDocument,
    context: WorkspaceContext | null,
): UIDocumentService {
    const table = readers(document, context);
    return new Proxy(table, {
        get(target, key) {
            if (typeof key !== "string") {
                // Symbols are how the language itself probes an object - `Symbol.toPrimitive`,
                // `Symbol.iterator`. A throwing function there turns a stray string coercion into a
                // crash, which is a worse answer than "this object has no such thing".
                return undefined;
            }
            if (key in target) {
                return target[key];
            }
            if (key === "then") {
                // Anything that awaits this object would otherwise call the refusal and reject.
                return undefined;
            }
            return (): never => {
                throw new ReadOnlyDocumentError(key);
            };
        },
        set(_target, key) {
            throw new ReadOnlyDocumentError(String(key));
        },
    }) as unknown as UIDocumentService;
}
