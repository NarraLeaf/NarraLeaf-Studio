import { useEffect, useState } from "react";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import { sameIdSet } from "./selectionHighlights";

const NONE: ReadonlySet<string> = new Set();

/**
 * The ids a rail table lights up for the workspace's selection, kept current.
 *
 * Read again on every selection change and on every document change - the second because the answer
 * can move under a selection that did not: unlinking an instance, or taking an action off the
 * interface, leaves the same element selected and must still put the row back to plain.
 *
 * The set keeps its identity while its contents do not change, so a table can treat a new set as
 * "the highlight moved" (and bring the row into view) without being re-triggered by every edit.
 *
 * `compute` must be a module-level function: it is not a dependency of the subscription.
 */
export function useSelectionHighlight(
    uiService: UIService | null,
    documentService: UIDocumentService | null,
    compute: (selection: SelectionState, document: UIDocument) => ReadonlySet<string>,
): ReadonlySet<string> {
    const [ids, setIds] = useState<ReadonlySet<string>>(NONE);

    useEffect(() => {
        if (!uiService || !documentService) {
            setIds(NONE);
            return undefined;
        }
        const refresh = () => {
            const next = compute(uiService.getStore().getSelection(), documentService.getDocument());
            setIds(current => (sameIdSet(current, next) ? current : next));
        };
        refresh();
        const offSelection = uiService.getEvents().on("selectionChanged", refresh);
        const offDocument = documentService.onDocumentChanged(refresh);
        return () => {
            offSelection();
            offDocument();
        };
        // `compute` is module-level by contract; see the doc comment.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentService, uiService]);

    return ids;
}
