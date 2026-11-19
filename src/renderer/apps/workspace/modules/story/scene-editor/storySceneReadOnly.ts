import { createContext, useContext } from "react";
import { storyDocumentSpec } from "@shared/documents/specs";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useTranslation } from "@/lib/i18n";
import type { KeybindingDefinition } from "@/apps/workspace/hooks";
import type { StoryRowActions } from "./storyRowActions";

/**
 * What a frozen workspace leaves working in the scene editor's rows, and what it switches off.
 *
 * Measured with a real mouse click on a frozen workspace before this existed: clicking a row's text
 * opened its `contenteditable`, typing worked, and the text was silently discarded on thaw. Typing
 * into a row is the most ordinary thing an author does here, which makes it the most likely way for
 * someone to lose keystrokes they believed they had.
 *
 * Both tables below name what **keeps working**, never what is switched off, for the reason
 * `components/ui/freezeActionPolicy` gives: the ways to mutate a scene grow with every command that
 * gets added, and an entry nobody remembered to list would default to writable inside a frozen
 * project. Getting the allow-list wrong greys out something harmless; getting an opt-out wrong loses
 * an author's work.
 *
 * Two entries are deliberately in the allow-list even though they can lead to a write, because they
 * are also the only way to READ what a row contains. `openInspector` and the Enter binding are gated
 * one level down instead, in the controller, so that they still open the inspector and no longer open
 * the line editor or an insert slot.
 *
 * **Whether the workspace is frozen *for this scene* is a narrower question than it used to be.**
 * One freeze - a live session - leaves a single story document writable and refuses the rest, so the
 * editor names the document it writes ({@link storyDocumentFreezeScope}) and the freeze guard
 * answers from `freezeAllowsWrite` about that path. Nothing in the tables below changes: they still
 * say what a frozen scene leaves working, for whichever freezes do apply to it.
 */
const READ_ONLY_STORY_ROW_ACTIONS: ReadonlySet<keyof StoryRowActions> = new Set<keyof StoryRowActions>([
    // Selection, in all the shapes a row offers it.
    "select",
    "mouseDown",
    "mouseEnter",
    // The menu itself is gated row by row through `freeze.menuRow()`, so opening it shows the author
    // what exists and what is unavailable - which is the point of disabled-not-hidden.
    "contextMenu",
    // Folding a container and its staging lens are view state. They live in `PanelStateService`, which
    // `shared/vcs/serviceStores` classifies as Studio state and keeps out of the repository entirely.
    "toggleCollapsed",
    // Caret bookkeeping for vertical arrow navigation; touches nothing but the goal column.
    "goalColumnInvalidated",
    // Reading a row's fields is the entire point of a frozen workspace. The write branches inside
    // `activateBlockForInspectorOrOp` (re-open an invalid line, add a line to a container) are refused
    // by the controller.
    "openInspector",
    // Panel visibility, and nothing else. Reading a row's fields on a frozen workspace is worth
    // nothing if the rail holding them is collapsed and the gesture that opens it has been switched
    // off.
    "revealInspectorPanel",
    // Dev Mode from a row. Not a project-data write; running a frozen version is a separate concern and is
    // gated in the main process, not here.
    "playFromRow",
]);

/** Whether this row action writes nothing, and so keeps working while frozen. */
export function isStoryRowActionReadOnlySafe(action: keyof StoryRowActions): boolean {
    return READ_ONLY_STORY_ROW_ACTIONS.has(action);
}

/**
 * A row action surface with every editing action replaced by a no-op.
 *
 * Returns the input by identity when writable. That matters more here than usual: `StoryRowActions`
 * travels through context and is deliberately built once and never rebuilt, because a context value
 * that changes identity re-renders every row and undoes the `memo` that keeps typing cheap. Wrapping
 * it costs exactly one such re-render per freeze transition, and none in between.
 */
export function toReadOnlyStoryRowActions(actions: StoryRowActions, frozen: boolean): StoryRowActions {
    if (!frozen) {
        return actions;
    }
    const readOnly = {} as Record<string, unknown>;
    for (const key of Object.keys(actions) as Array<keyof StoryRowActions>) {
        readOnly[key] = isStoryRowActionReadOnlySafe(key) ? actions[key] : () => undefined;
    }
    return readOnly as StoryRowActions;
}

/**
 * The scene editor keybindings a frozen workspace keeps: find, navigation, selection, and the two
 * that close things.
 *
 * `edit-active` (Enter) is in the list because it is also how the inspector opens for reading; the
 * controller refuses its line-editor branch. Everything absent here - delete, backspace, undo, redo,
 * insert, indent/outdent, duplicate, move row - edits the scene.
 */
const READ_ONLY_STORY_KEYBINDING_IDS: ReadonlySet<string> = new Set([
    "find",
    "close-inspector",
    "edit-active",
    "select-all",
    "move-selection-down",
    "move-selection-up",
    "extend-selection-down",
    "extend-selection-up",
    "select-first",
    "select-last",
    "select-first-mod",
    "select-last-mod",
    "page-down",
    "page-up",
]);

/** Whether this keybinding writes nothing, and so keeps working while frozen. */
export function isStoryKeybindingReadOnlySafe(id: string): boolean {
    return READ_ONLY_STORY_KEYBINDING_IDS.has(id);
}

/**
 * Whether a row's text may be opened for editing at all. **Two enforcement points, deliberately**,
 * because gating one of them was measured in the running app to be not enough.
 *
 * 1. The state transition. A plain press-and-release on a row's own text does NOT go through
 *    `StoryRowActions.startTextEdit` - the row hands the gesture to the browser so the native
 *    selection carries in as the caret, and the controller's window `mouseup`
 *    (`finishTextSelectGesture`) sets text mode directly. Making the row action a no-op therefore did
 *    nothing at all for the ordinary click.
 * 2. The DOM. `RichTextInput` renders `contentEditable` unconditionally, so once the field is mounted
 *    the browser owns the caret and the keystrokes and asks Studio nothing. Measured on a frozen
 *    workspace: clicking a row put a caret in it and typing appeared on screen, to be discarded on
 *    thaw - the exact loss this pass exists to prevent.
 *
 * Both call this, so there is one answer rather than two that can drift.
 */
export function isRowTextEditable(frozen: boolean): boolean {
    return !frozen;
}

/**
 * Which file this editor's writes land in, as the project-relative path the freeze policy takes.
 *
 * Derived from the document spec rather than assembled here, for the reason `writeFreeze` gives for
 * naming its derived libraries by kind: a path spelled a second time is a path that falls behind the
 * one `StoryService` actually saves to, and this one is compared against the set a live session
 * declares writable. If the two ever disagree the editor offers an edit the write boundary refuses.
 *
 * `undefined` for a tab with no story - the answer the freeze guard reads as "I cannot say which
 * document this is", which is the conservative one.
 */
export function storyDocumentFreezeScope(storyId: string | undefined): string | undefined {
    return storyId ? storyDocumentSpec.pathFor({ storyId }) : undefined;
}

/**
 * The scope above, for the row components that are too deep in the tree to be handed it.
 *
 * A context rather than a prop threaded through the row tree, but deliberately NOT something
 * `useFreezeGuard` reads on its own: each control still has to ask for it, because the rows hold
 * controls that write beyond this document - the nametag picker's "Create character" rung, see
 * {@link useCreateCharacterFreeze} - and those must keep the conservative answer. Opting in one call
 * site at a time is what keeps that honest.
 *
 * Empty by default, so a row rendered outside a scene editor is frozen by any freeze at all.
 */
const StoryDocumentScopeContext = createContext<string | undefined>(undefined);

export const StoryDocumentScopeProvider = StoryDocumentScopeContext.Provider;

/** The story document the surrounding scene editor writes, or undefined outside one. */
export function useStoryDocumentScope(): string | undefined {
    return useContext(StoryDocumentScopeContext);
}

/** Whether the editor may still make a cast member out of a name, and what to say when it may not. */
export type StoryCreateCharacterFreeze = {
    unavailable: boolean;
    /** Hover text for the control this switches off; undefined while it is live. */
    reason: string | undefined;
};

/**
 * The one thing an author does to a speaker here that is not a write to this story document.
 *
 * Turning a typed name into a character creates a character document and only then rebinds the rows
 * that used the name, so the story half is the second half of it. A freeze that leaves this document
 * writable still refuses the first half - which is why the offer has to come off rather than be
 * left to fail at the write boundary, where the author would get a notice about a file they never
 * thought they were editing.
 *
 * `unavailable` comes from the UNSCOPED guard and from nothing else. A control that writes past the
 * story document names no document, so it is switched off by any freeze at all - the conservative
 * answer, and here also the exactly right one.
 *
 * **The scoped guard decides which sentence the author reads, never whether the control is live.** A
 * freeze that covers this document as well has already switched the whole editor off, and the
 * workspace's own single string is what every other greyed control in it is showing; a freeze that
 * spares the document has left the author writing this scene with one control missing, and that is
 * the case worth a sentence of its own.
 */
export function useCreateCharacterFreeze(): StoryCreateCharacterFreeze {
    const { t } = useTranslation();
    const beyondThisDocument = useFreezeGuard();
    const thisDocument = useFreezeGuard(useStoryDocumentScope());
    if (!beyondThisDocument.frozen) {
        return { unavailable: false, reason: undefined };
    }
    return {
        unavailable: true,
        reason: thisDocument.frozen
            ? beyondThisDocument.reason
            : t("story.rows.createCharacterUnavailable"),
    };
}

/**
 * The same bindings with the editing handlers made inert.
 *
 * The `run` shape from `components/ui/freezeGuard`: a keybinding has no control to grey out, so the
 * author is not told here - the write boundary announces the refusal through `SaveStatusService` the
 * moment anything tries to save, and a toast per blocked keystroke would bury that one useful
 * message. The bindings stay REGISTERED rather than being filtered out, so the shortcut catalogue is
 * unchanged and Mod+Z does not fall through to some other editor's undo.
 */
export function toReadOnlyStoryKeybindings(
    keybindings: KeybindingDefinition[],
    frozen: boolean,
): KeybindingDefinition[] {
    if (!frozen) {
        return keybindings;
    }
    return keybindings.map(binding =>
        isStoryKeybindingReadOnlySafe(binding.id)
            ? binding
            : { ...binding, handler: () => undefined },
    );
}
