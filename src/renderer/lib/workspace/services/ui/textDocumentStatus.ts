import type { TextEncodingId } from "@shared/types/textEncoding";
// Type-only, so nothing from the editor's module graph (and therefore nothing from monaco) is
// pulled into workspace startup by a service that only needs the vocabulary.
import type { LineEnding } from "@/apps/workspace/modules/assets/editors/text/textEditableFiles";

/**
 * What one open text document tells the status bar about itself, and what the status bar may ask it
 * to do.
 *
 * **Host-internal.** Nothing here is exported from `src/renderer/plugin`, and it must stay that way:
 * `narraleaf-studio@0.4.0` is published, and a plugin that could reach into another tab's caret is a
 * surface nobody designed. Plugin contributions to the text editor go through
 * `TextEditorContributionService`, which is a different thing entirely.
 */

/** Where the caret is and how much is selected, in the terms the status bar prints. */
export interface TextDocumentSelection {
    line: number;
    column: number;
    /** Characters covered by the selection. Zero when there is a caret and no selection. */
    characters: number;
    /**
     * How many non-empty ranges those characters are spread across, for the multi-cursor readout.
     * Zero when nothing is selected, one for an ordinary drag.
     */
    ranges: number;
}

/** The values one text tab publishes. Updated in place as the author works. */
export interface TextDocumentStatus {
    tabId: string;
    fileName: string;
    encoding: TextEncodingId;
    lineEnding: LineEnding;
    /**
     * The decode produced replacement characters, so the bytes are not in this encoding and the tab
     * is refusing to autosave over them. The encoding cell reads this and tints itself.
     */
    lossy: boolean;
    selection: TextDocumentSelection;
}

/**
 * What the status bar may do to the document it is reporting on.
 *
 * Implemented by the tab rather than by the service: reopening swaps the monaco model, saving needs
 * the buffer, and setting the line ending has to go through `ITextModel.setEOL` before it can be
 * written. None of that can be done from outside the component that owns the editor, so the service
 * carries the calls instead of the state.
 */
export interface TextDocumentCommands {
    reopenWith(encoding: TextEncodingId): void;
    saveWith(encoding: TextEncodingId): void;
    setLineEnding(ending: LineEnding): void;
}

export interface TextDocumentEntry {
    status: TextDocumentStatus;
    commands: TextDocumentCommands;
}
