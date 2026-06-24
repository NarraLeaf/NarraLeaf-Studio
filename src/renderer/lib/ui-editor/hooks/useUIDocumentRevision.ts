import { useSyncExternalStore } from "react";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

/**
 * Subscribe to UI document mutations synchronously (same tick as mutateDocument).
 * Prefer this over {@link useDocumentVersion} when the subscriber must re-render in the same frame
 * as the mutation (e.g. resolving DOM nodes for the current selection).
 */
export function useUIDocumentRevision(documentService: UIDocumentService | null): number {
    return useSyncExternalStore(
        onStoreChange => documentService?.onDocumentChanged(() => onStoreChange()) ?? (() => undefined),
        () => documentService?.getRevision() ?? 0,
        () => 0,
    );
}
