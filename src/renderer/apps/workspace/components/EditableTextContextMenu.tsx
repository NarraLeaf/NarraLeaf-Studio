import { useCallback, useEffect, useMemo, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { ContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { DictionaryService } from "@/lib/workspace/services/dictionary/DictionaryService";
import { useWorkspace } from "../context";
import { useFreezeGuard } from "./ui/freezeGuard";

/** Where the menu opened, and what the field it opened on can offer. */
type EditableTarget = {
    x: number;
    y: number;
    canCut: boolean;
    canCopy: boolean;
    /**
     * The words to offer the project dictionary, when the click landed on a selection in a line of
     * script. Absent everywhere else - a selection in a name field names an asset or a variable, and
     * teaching the project's vocabulary those would fill it with ids.
     */
    term?: string;
};

/** Run a dictionary lookup that has no document behind it in a recovery-mode workspace. */
function safely<T>(read: () => T, fallback: T): T {
    try {
        return read();
    } catch {
        return fallback;
    }
}

/** How long a selection may be and still be a term rather than a sentence. */
const MAX_TERM_LENGTH = 48;

/**
 * The selection as a term, or `null` when it is not one.
 *
 * Refused rather than trimmed when it spans an inline chip: a pause or a value is a unit of the
 * document with no spelling of its own, and what `toString()` reports across one is whatever the
 * chip happens to be drawn with.
 */
function selectionAsTerm(element: HTMLElement): string | null {
    if (!element.closest("[data-story-rich-text='true']")) {
        return null;
    }
    const selection = globalThis.window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null;
    }
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) {
        return null;
    }
    const fragment = range.cloneContents();
    if (fragment.querySelector("[data-pause], [data-interp], [data-event]")) {
        return null;
    }
    const term = (fragment.textContent ?? "").trim().replace(/\s+/g, " ");
    if (!term || term.length > MAX_TERM_LENGTH) {
        return null;
    }
    return term;
}

/** Whether a right click landed on something the author can type into. */
function editableTarget(node: EventTarget | null): HTMLElement | null {
    const element = node instanceof HTMLElement ? node : null;
    if (!element) {
        return null;
    }
    if (element instanceof HTMLTextAreaElement) {
        return element.readOnly || element.disabled ? null : element;
    }
    if (element instanceof HTMLInputElement) {
        // Only the kinds that hold text. A right click on a checkbox is not a text gesture.
        const textual = ["text", "search", "url", "tel", "email", "password", "number", ""];
        return element.readOnly || element.disabled || !textual.includes(element.type) ? null : element;
    }
    return element.closest<HTMLElement>("[contenteditable='true']");
}

/** Whether the field holding focus has a selection the editing rows can act on. */
function hasSelection(element: HTMLElement): boolean {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.selectionStart !== element.selectionEnd;
    }
    const selection = globalThis.window.getSelection();
    return Boolean(selection && !selection.isCollapsed && element.contains(selection.anchorNode));
}

/**
 * Cut, copy and paste for a right click on editable text.
 *
 * Electron draws no menu of its own, so without this a text field in Studio answers a right click
 * with nothing at all. It used to be fed by the main process — Chromium reported the click along
 * with its spellchecker's verdict on the word under the pointer, and the spelling rows and the
 * editing rows arrived together. Studio does its own checking now and the spelling half has moved
 * to a popover anchored to the word (`SpellSuggestionPopover`), which leaves this with only the
 * part that was never about spelling.
 *
 * Nothing crosses a process boundary to decide the rows any more: what can be cut or copied is a
 * question about the selection, which the renderer can see. Paste is always offered, because
 * whether the clipboard holds anything is not knowable here without reading it, and reading the
 * author's clipboard to grey out a row is not a trade worth making.
 *
 * The commands themselves still go through the window rather than `document.execCommand`, because
 * Chromium refuses a scripted paste.
 *
 * A surface that opens its own menu calls `preventDefault`, and is skipped here.
 */
export function EditableTextContextMenu(): React.ReactElement | null {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();
    const [target, setTarget] = useState<EditableTarget | null>(null);

    const dictionary = useMemo<DictionaryService | null>(() => {
        if (!context || !isInitialized) {
            return null;
        }
        try {
            return context.services.get<DictionaryService>(Services.Dictionary);
        } catch {
            // A recovery-mode workspace never started the service; the editing rows still work.
            return null;
        }
    }, [context, isInitialized]);

    useEffect(() => {
        const onContextMenu = (event: MouseEvent) => {
            if (event.defaultPrevented) {
                return;
            }
            const element = editableTarget(event.target);
            if (!element) {
                return;
            }
            event.preventDefault();
            const selected = hasSelection(element);
            setTarget({
                x: event.clientX,
                y: event.clientY,
                canCut: selected,
                canCopy: selected,
                term: selected ? selectionAsTerm(element) ?? undefined : undefined,
            });
        };
        globalThis.document.addEventListener("contextmenu", onContextMenu);
        return () => globalThis.document.removeEventListener("contextmenu", onContextMenu);
    }, []);

    const close = useCallback(() => setTarget(null), []);

    const items = useMemo<ContextMenuDef>(() => {
        if (!target) {
            return [];
        }
        const rows: ContextMenuDef = [
            {
                id: "editable.cut",
                label: t("common.cut"),
                disabled: !target.canCut,
                onClick: () => getInterface().window.editCommand("cut"),
            },
            {
                id: "editable.copy",
                label: t("common.copy"),
                disabled: !target.canCopy,
                onClick: () => getInterface().window.editCommand("copy"),
            },
            {
                id: "editable.paste",
                label: t("common.paste"),
                onClick: () => getInterface().window.editCommand("paste"),
            },
        ];
        // Only when there is something to add. A term the project already writes has nothing to
        // learn from this gesture, and a row that said so would be a row that never does anything.
        // The lookup is guarded because a recovery-mode workspace has the service without the
        // document behind it.
        const term = target.term;
        const unknown = Boolean(dictionary && term && safely(() => !dictionary.hasTerm(term), false));
        if (dictionary && term && unknown) {
            rows.push({
                id: "editable.addToDictionary",
                label: t("dictionary.addSelection", { term }),
                ...freeze.menuRow(),
                onClick: () => safely(() => dictionary.addTerm(term), false),
            });
        }
        return rows;
    }, [dictionary, freeze, t, target]);

    if (!target) {
        return null;
    }

    return (
        <ContextMenu
            items={items}
            position={{ x: target.x, y: target.y }}
            onClose={close}
            visible
        />
    );
}
