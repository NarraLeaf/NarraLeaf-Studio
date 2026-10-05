import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { Input } from "@/lib/components/elements/Input";
import { useTranslation } from "@/lib/i18n";
import { FLOATING_OWN_KEYS_ATTRIBUTE, useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import { keepStoryKeysInPopover } from "./PausePopover";

/**
 * The reading typed over a run of text - furigana over kanji, pinyin or zhuyin over hanzi. Compiles
 * to NLR's `Word({ ruby })`, which is why one reading covers one run rather than one character: the
 * engine draws it centred over whatever the run spells.
 *
 * A draft, unlike {@link PausePopover}, which writes through on every change. A pause holds one
 * number and every intermediate value is a valid pause; a reading is a word, and applying each
 * keystroke would spend an undo entry per character (`structural` edits never coalesce - see
 * `RichTextHistory.record`) and redraw the annotated span under the author mid-word. So the value
 * leaves here exactly once, when the popover closes.
 *
 * Closing commits. Escape and the remove button are the two exits that have already decided what
 * happens, and they say so by settling first. Everything else - Enter, a click back into the
 * sentence, the row scrolling away - carries the draft out, because a reading typed and then left
 * behind is work lost, and there is no second copy of it anywhere.
 */
export function RubyPopover(props: {
    anchor: { top: number; left: number; bottom: number };
    /**
     * The button this opened from. It counts as inside for light dismiss, the way the palette's
     * trigger does: without that, pressing it to close fires the outside-pointerdown first, and the
     * button's own handler then finds the popover already gone and opens a second one.
     */
    anchorRef?: RefObject<HTMLElement | null>;
    /** The reading already on the text, or undefined when there is none yet. */
    value?: string;
    /** Write the draft. Trimmed, or null when the author emptied the field. */
    onCommit: (ruby: string | null) => void;
    /** Remove the reading. Only offered when there is one. Closes on its own. */
    onRemove: () => void;
    /** Take the popover down. The caller clears the state that renders it. */
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(props.value ?? "");
    const panelRef = useRef<HTMLDivElement | null>(null);
    const doc = useHostDocument();
    /**
     * A popover on the style strip: the trigger is its owner, so Tab out of it lands on the strip's
     * next control rather than past the row. The layer's own Escape is the one that does not settle -
     * focus leaving, or the tab being put away, carries the draft out like any other close - which is
     * why the field answers Escape for itself (see `onInputKeyDown`).
     */
    useFloatingLayer({
        open: true,
        onClose: props.onClose,
        panelRef,
        ownerRefs: props.anchorRef ? [props.anchorRef] : undefined,
    });
    /**
     * The draft and the callback as the unmount effect sees them. That effect is bound once - it has
     * to be, or every keystroke would tear it down and rebuild it, and a close landing in that gap
     * would commit nothing - so what it reads cannot be a closure over this render.
     */
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const commitRef = useRef(props.onCommit);
    commitRef.current = props.onCommit;
    /** Set by the two exits that have already written their own outcome. */
    const settledRef = useRef(false);

    useEffect(() => () => {
        if (!settledRef.current) {
            commitRef.current(draftRef.current.trim() || null);
        }
    }, []);

    // Light dismiss: close on any pointerdown outside the panel, letting the event through to
    // whatever was clicked so leaving the popover keeps the author's place. The trigger counts as
    // inside - closing from there is the button's job, and doing it twice reopens the popover.
    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || props.anchorRef?.current?.contains(target)) {
                return;
            }
            props.onClose();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    }, [doc, props]);

    const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        // The field sits inside the row being edited and `KeybindingService` listens on `window`,
        // where Enter commits the row and Tab indents it. Both have to stop here, or typing a reading
        // would end the line it annotates.
        event.stopPropagation();
        // Every key is the input method's while it is composing: Escape there cancels the conversion,
        // not the reading.
        if (isImeKeyEvent(event)) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            props.onClose();
            return;
        }
        if (event.key === "Escape") {
            // One rung per press: this takes the popover down and leaves the text as it was. Answered
            // here rather than by the floating layer, because this is the one close that discards
            // the draft, and the layer's close cannot say which close it was.
            event.preventDefault();
            settledRef.current = true;
            props.onClose();
            return;
        }
        if (event.key === "Tab") {
            // The field answers its own keys, so leaving it is walked here: forwards to Remove when
            // there is one, and otherwise out of the popover - carrying the draft, as focus leaving
            // always does - and back onto the strip's ruby control, where the keyboard came from.
            const remove = panelRef.current?.querySelector<HTMLElement>("button");
            if (!event.shiftKey && remove) {
                return;
            }
            event.preventDefault();
            props.onClose();
            props.anchorRef?.current?.focus({ preventScroll: true });
        }
    };

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
            <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">{t("story.ruby.title")}</div>
            <Input
                size="sm"
                fullWidth
                autoFocus
                {...{ [FLOATING_OWN_KEYS_ATTRIBUTE]: "" }}
                value={draft}
                placeholder={t("story.ruby.placeholder")}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={onInputKeyDown}
            />
            {props.value !== undefined ? (
                <button
                    type="button"
                    className="mt-2 flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-danger"
                    onClick={() => {
                        settledRef.current = true;
                        props.onRemove();
                    }}
                >
                    <Trash2 className="h-3 w-3" />
                    {t("story.ruby.remove")}
                </button>
            ) : null}
        </div>,
        doc.body,
    );
}
