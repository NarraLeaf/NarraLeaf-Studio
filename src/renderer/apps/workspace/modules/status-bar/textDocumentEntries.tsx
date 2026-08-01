import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useWorkspace } from "../../context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { TEXT_ENCODING_IDS, textEncodingLabel } from "@shared/types/textEncoding";
import type { TextDocumentEntry } from "@/lib/workspace/services/ui/textDocumentStatus";
import { TEXT_EDITOR_TAB_PREFIX } from "../assets/editors/text/textEditorTabId";
import type { LineEnding } from "../assets/editors/text/textEditableFiles";
import { StatusEntry } from "./StatusEntry";

/**
 * The four cells that report on the text document the author is editing: its name, its encoding, its
 * line endings and the selection.
 *
 * They live in the workspace status bar rather than in a strip along the bottom of the tab, which is
 * where they started. The bar is already the place Studio puts "what is true right now", it is
 * already the width of the window, and a per-tab copy of it meant a text file was the only editor in
 * Studio with two status bars stacked on top of one another.
 *
 * All four render `null` unless the focused editor tab is a text editor, so they cost nothing in a
 * project with no plan files in it - the same contract every other built-in cell follows.
 */

const LINE_ENDINGS: readonly LineEnding[] = ["LF", "CRLF"];

/**
 * The document the status bar is reporting on: the record published by the **focused** editor tab,
 * or null when that tab is not a text editor.
 *
 * Resolved through `getEditorTabsByRecency()` and `editorLayoutChanged`, and emphatically **not**
 * through `useActiveEditorTab()`. That hook reads `UIStore.activeEditorTabId`, which the split-view
 * focus path (`setActiveEditorTabInGroup`) does not write - so in a split, focusing the other side
 * leaves it naming a tab the author walked away from, and these cells would go on describing a
 * document nobody is looking at.
 *
 * Unlike `WordCountEntry`, which keeps reporting the last scene it saw, this takes only the *first*
 * entry and gives up if it is not a text tab. A caret position and a selection count are statements
 * about the thing being typed into; carrying them across to a tab that has neither is a readout that
 * quietly lies.
 */
export function useActiveTextDocument(): TextDocumentEntry | null {
    const { context } = useWorkspace();
    const [doc, setDoc] = useState<TextDocumentEntry | null>(null);

    useEffect(() => {
        if (!context) {
            setDoc(null);
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        const statuses = uiService.textDocumentStatus;

        const resolve = () => {
            const [focused] = uiService.getStore().getEditorTabsByRecency();
            const entry = focused?.id.startsWith(TEXT_EDITOR_TAB_PREFIX)
                ? statuses.get(focused.id) ?? null
                : null;
            // Compared by identity, which is exactly right here: the service replaces the entry
            // object on every change and leaves it alone otherwise, so `===` *is* "did anything
            // move" and a caret that did not move cannot re-render four cells.
            setDoc(current => (current === entry ? current : entry));
        };

        resolve();
        const unsubscribeLayout = uiService.getEvents().on("editorLayoutChanged", resolve);
        const unsubscribeStatus = statuses.onChanged(resolve);
        return () => {
            unsubscribeLayout();
            unsubscribeStatus();
        };
    }, [context]);

    return doc;
}

/**
 * Which file is being edited, at the inboard end of the left cluster.
 *
 * The name alone, with no path and no icon: the tab above it already carries both, and this cell
 * exists so that the answer is in the same place whichever editor is open, not to restate the tab
 * strip.
 */
export function TextFileNameEntry() {
    const doc = useActiveTextDocument();
    if (!doc) {
        return null;
    }
    return (
        <StatusEntry title={doc.status.fileName}>
            <span className="max-w-[24ch] truncate">{doc.status.fileName}</span>
        </StatusEntry>
    );
}

/**
 * Where the caret is, and how much is selected.
 *
 * `Ln 12, Col 3` on its own; `Ln 12, Col 3 (24 selected)` while something is selected; and
 * `(24 selected in 3 ranges)` under a multi-cursor, because a bare number is otherwise
 * unattributable to anything the author can see on screen. The wording follows VS Code deliberately:
 * this is a readout people already know how to read, and a better one would only be slower.
 */
export function TextSelectionEntry() {
    const { t } = useTranslation();
    const doc = useActiveTextDocument();
    if (!doc) {
        return null;
    }
    const { line, column, characters, ranges } = doc.status.selection;
    const caret = t("assets.textEditor.caret", { line, column });
    const selected = characters === 0
        ? ""
        : ranges > 1
            ? ` ${t("assets.textEditor.selectedInRanges", { count: characters, ranges })}`
            : ` ${t("assets.textEditor.selected", { count: characters })}`;

    return (
        <StatusEntry title={t("assets.textEditor.selectionLabel")}>
            <span className="tabular-nums">{`${caret}${selected}`}</span>
        </StatusEntry>
    );
}

/**
 * The document's line endings, and the control that converts them.
 *
 * Converting is a write, so the rows are switched off on a frozen workspace and say why - the house
 * rule for everything a freeze takes away. The current ending is ticked rather than greyed out:
 * a disabled row would read as "this is not available", when what is true is "this is what you
 * already have".
 */
export function TextLineEndingEntry() {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const doc = useActiveTextDocument();
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const commands = doc?.commands;
    const current = doc?.status.lineEnding;
    const choose = useCallback(
        (ending: LineEnding) => {
            commands?.setLineEnding(ending);
        },
        [commands],
    );

    const menu = useMemo<ContextMenuDef>(
        () =>
            LINE_ENDINGS.map(ending => ({
                id: `line-ending-${ending}`,
                // The value, not a sentence: "LF" is what the cell says and what every other editor
                // calls it, so the menu is the two answers rather than a description of them.
                label: ending,
                icon: ending === current ? <Check className="h-3 w-3" /> : undefined,
                ...freeze.menuRow(),
                onClick: () => choose(ending),
            })),
        [choose, current, freeze],
    );

    if (!doc) {
        return null;
    }
    return (
        <>
            <StatusEntry
                onClick={showMenu}
                title={t("assets.textEditor.selectLineEnding")}
                ariaLabel={t("assets.textEditor.lineEndingLabel", { ending: doc.status.lineEnding })}
                dataAttributes={{ "data-text-editor-line-ending": doc.status.lineEnding }}
            >
                {doc.status.lineEnding}
            </StatusEntry>
            <ContextMenu
                items={menu}
                iconsEnabled
                position={menuState.position}
                onClose={hideMenu}
                visible={menuState.visible}
            />
        </>
    );
}

/**
 * The encoding the document was read in, and the two things an author can do about it.
 *
 * Tinted `text-danger` rather than captioned when the decode was lossy: that the value is wrong is a
 * fact about this value, and the fix is one click away inside this very control, so a sentence beside
 * it would say less. Reopening is inspection and stays live on a frozen workspace; saving under
 * another encoding is a write and does not.
 */
export function TextEncodingEntry() {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const doc = useActiveTextDocument();
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const commands = doc?.commands;
    const menu = useMemo<ContextMenuDef>(
        () => [
            {
                id: "reopen",
                label: t("assets.textEditor.reopenWithEncoding"),
                submenu: TEXT_ENCODING_IDS.map(id => ({
                    id: `reopen-${id}`,
                    label: textEncodingLabel(id),
                    onClick: () => commands?.reopenWith(id),
                })),
            },
            {
                id: "save",
                label: t("assets.textEditor.saveWithEncoding"),
                ...freeze.menuRow(),
                submenu: TEXT_ENCODING_IDS.map(id => ({
                    id: `save-${id}`,
                    label: textEncodingLabel(id),
                    ...freeze.menuRow(),
                    onClick: () => commands?.saveWith(id),
                })),
            },
        ],
        [commands, freeze, t],
    );

    if (!doc) {
        return null;
    }
    const { encoding, lossy } = doc.status;
    return (
        <>
            <StatusEntry
                onClick={showMenu}
                tone={lossy ? "text-danger" : undefined}
                title={t("assets.textEditor.selectEncoding")}
                // The cell's visible text is the value alone, which reads as a bare word to a screen
                // reader; the label says what the value is of.
                ariaLabel={t("assets.textEditor.encodingLabel", { encoding: textEncodingLabel(encoding) })}
                dataAttributes={{ "data-text-editor-encoding": encoding }}
            >
                {textEncodingLabel(encoding)}
            </StatusEntry>
            <ContextMenu items={menu} position={menuState.position} onClose={hideMenu} visible={menuState.visible} />
        </>
    );
}
