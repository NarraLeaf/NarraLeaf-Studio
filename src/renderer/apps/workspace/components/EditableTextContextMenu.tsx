import { useCallback, useEffect, useMemo, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { ContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";

/** Where the menu opened, and what the field it opened on can offer. */
type EditableTarget = { x: number; y: number; canCut: boolean; canCopy: boolean };

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
  const [target, setTarget] = useState<EditableTarget | null>(null);

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
      setTarget({ x: event.clientX, y: event.clientY, canCut: selected, canCopy: selected });
    };
    globalThis.document.addEventListener("contextmenu", onContextMenu);
    return () => globalThis.document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  const close = useCallback(() => setTarget(null), []);

  const items = useMemo<ContextMenuDef>(() => {
    if (!target) {
      return [];
    }
    return [
      {
        id: "editable.cut",
        label: t("common.cut"),
        disabled: !target.canCut,
        onClick: () => getInterface().window.editCommand("cut")
      },
      {
        id: "editable.copy",
        label: t("common.copy"),
        disabled: !target.canCopy,
        onClick: () => getInterface().window.editCommand("copy")
      },
      {
        id: "editable.paste",
        label: t("common.paste"),
        onClick: () => getInterface().window.editCommand("paste")
      }
    ];
  }, [t, target]);

  if (!target) {
    return null;
  }

  return (
    <ContextMenu items={items} position={{ x: target.x, y: target.y }} onClose={close} visible />
  );
}
