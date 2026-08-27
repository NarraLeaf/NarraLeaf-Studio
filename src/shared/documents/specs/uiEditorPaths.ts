import { UI_DOCUMENT_PATH } from "./uiDocument";
import { VARIABLE_REGISTRY_DOCUMENT_PATH } from "./variables";
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

/**
 * The blueprint member tree's three, which are the two above plus the project's variable registry.
 *
 * The member tree is one panel over two documents: declaring an event layer writes the blueprint,
 * and declaring a variable writes `editor/variables.json`. `isFreezeBlocking` is blocked unless
 * EVERY path in a list is allowed, which is the question this panel has to ask - offering the
 * variable rows while that registry is refused would be a control that looks available and quietly
 * discards what it is given.
 */
export const BLUEPRINT_MEMBER_TREE_PATHS: readonly string[] = [
    UI_DOCUMENT_PATH,
    UI_GRAPHS_DOCUMENT_PATH,
    VARIABLE_REGISTRY_DOCUMENT_PATH,
];
