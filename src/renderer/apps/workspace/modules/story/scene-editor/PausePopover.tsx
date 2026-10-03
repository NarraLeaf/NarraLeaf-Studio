import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";

const MODE_BTN = "h-7 px-2.5 text-xs transition-colors";

/**
 * The keys a popover over the story editor keeps from the editor's own keybindings.
 *
 * `KeybindingService` listens on `window` and stands aside only for editable targets, and the scene
 * editor's bindings stay live while focus is in one of its popovers (React carries the focus event
 * through the portal to the editor, which counts it as focused). So a key pressed on a button in a
 * popover also ran the row's binding: Enter opened the row - and its `preventDefault` stopped the
 * browser turning the key into a click - Tab indented it, Delete removed the selected rows and the
 * arrows moved the selection. Stopped here, not prevented: the browser's own handling of the key in
 * the popover is what is being kept.
 *
 * Escape is not among them. The floating layer already answers it, and a control that answers it
 * itself (`FLOATING_OWN_KEYS_ATTRIBUTE`) leaves the rest to the layer's bubble-phase listener on the
 * body, which this must not cut off. Chords pass through, so Mod+Z still undoes from in here.
 */
const POPOVER_KEYS = new Set([
    "Enter",
    " ",
    "Tab",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Delete",
    "Backspace",
]);

export function keepStoryKeysInPopover(event: ReactKeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
    }
    if (POPOVER_KEYS.has(event.key)) {
        event.stopPropagation();
    }
}

/**
 * Small config popover for an inline Pause, mirroring the NLR Pause interface: either
 * "click to proceed" (`new Pause()`) or "wait for" a fixed duration (`Pause.wait(ms)`).
 * `value` stays in milliseconds to match the stored run; the author reads and types seconds.
 *
 * Like every popover opened from a chip inside the row being edited, it takes the focus and keeps
 * Tab inside itself (`scope: "trap"`): the row editor's own Tab model keeps the keyboard within the
 * row, and a Tab that walked out of the popover would land past the field, commit the row and leave
 * it. Escape closes it and only it; the caller's close puts the caret back in the line.
 */
export function PausePopover(props: {
    anchor: { top: number; left: number; bottom: number };
    value: number | true;
    onChange: (pause: number | true) => void;
    onRemove: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const doc = useHostDocument();
    const isWait = props.value !== true;
    const ms = typeof props.value === "number" ? props.value : 300;
    const panelRef = useRef<HTMLDivElement | null>(null);
    useFloatingLayer({ open: true, onClose: props.onClose, panelRef, scope: "trap" });

    // Light dismiss: close on any pointerdown outside the panel, but let the event fall through to
    // whatever was clicked (toolbar button, editor text) so leaving the popover keeps edit focus.
    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            if (panelRef.current?.contains(event.target as Node)) {
                return;
            }
            props.onClose();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    }, [doc, props]);

    const view = doc.defaultView ?? window;
    const top = Math.min(props.anchor.bottom + 6, view.innerHeight - 140);
    const left = Math.min(props.anchor.left, view.innerWidth - 236);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-56 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={keepStoryKeysInPopover}
        >
                <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">{t("story.pause.title")}</div>
                <div className="mb-2 inline-flex overflow-hidden rounded-md border border-edge bg-surface">
                    <button
                        type="button"
                        // Opening on the mode that is set; a wait opens on its seconds field instead.
                        data-autofocus={!isWait ? "" : undefined}
                        className={[MODE_BTN, !isWait ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle"].join(" ")}
                        onClick={() => props.onChange(true)}
                    >
                        {t("story.pause.clickToProceed")}
                    </button>
                    <button
                        type="button"
                        className={[MODE_BTN, "border-l border-edge", isWait ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle"].join(" ")}
                        onClick={() => props.onChange(ms)}
                    >
                        {t("story.pause.waitFor")}
                    </button>
                </div>
                {isWait ? (
                    <div className="flex items-center gap-1.5">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatStorySecondsValue(ms)}
                            onFiniteNumber={seconds => props.onChange(Math.max(0, storySecondsToMs(seconds)))}
                            onEmpty={() => props.onChange(0)}
                            type="text"
                            inputMode="decimal"
                            autoFocus
                            popoverWhenNarrow={false}
                            className="w-24"
                        />
                        <span className="text-xs text-fg-muted">{t("story.pause.seconds")}</span>
                    </div>
                ) : (
                    <div className="text-2xs text-fg-subtle">{t("story.pause.clickHint")}</div>
                )}
                <button
                    type="button"
                    className="mt-2 flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-danger"
                    onClick={props.onRemove}
                >
                    <Trash2 className="h-3 w-3" />
                    {t("story.pause.remove")}
                </button>
        </div>,
        doc.body,
    );
}
