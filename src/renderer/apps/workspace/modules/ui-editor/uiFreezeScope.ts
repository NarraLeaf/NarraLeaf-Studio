import { INTERFACE_DOCUMENT_PATHS } from "@shared/documents/specs/uiEditorPaths";

/**
 * Which files the interface editor writes, as the project-relative paths the freeze policy takes.
 *
 * **Both, always, for every surface of the interface editor and of the blueprint canvas.** They are
 * one editing surface written to two files: adding a widget writes `uidoc.json` and then reconciles
 * a private blueprint for it in `uigraphs.json`, in the same synchronous step, so a control scoped to
 * one of them would offer an edit whose other half the boundary refuses. `isFreezeBlocking` requires
 * every path in a list to be allowed, which is exactly the question being asked.
 *
 * Through the document specs rather than spelled out here, for the reason `writeFreeze` gives: a path
 * written a second time is one that falls behind the file the service actually saves to.
 */
export function interfaceDocumentFreezeScope(): readonly string[] {
    return INTERFACE_DOCUMENT_PATHS;
}
