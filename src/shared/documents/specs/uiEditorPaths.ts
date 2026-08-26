import { UI_DOCUMENT_PATH } from "./uiDocument";
import { UI_GRAPHS_DOCUMENT_PATH } from "./uiGraphs";

/**
 * The two files the interface editor writes, as the project-relative paths the freeze policy takes.
 *
 * **Both, always.** They are one editing surface written to two documents: adding a widget to a
 * Surface writes `uidoc.json` and then reconciles a private blueprint for it in `uigraphs.json`, in
 * the same synchronous step. A control scoped to one of them would offer an edit whose other half
 * the write boundary refuses - and a live session carries them both or neither for the same reason.
 *
 * Here rather than beside the freeze guard because half the surfaces that need it live under
 * `lib/ui-editor`, which the game runtime compiles and which therefore cannot reach into the
 * workspace. A path spelled a second time is a path that falls behind the file the service saves to.
 */
export const INTERFACE_DOCUMENT_PATHS: readonly string[] = [UI_DOCUMENT_PATH, UI_GRAPHS_DOCUMENT_PATH];
