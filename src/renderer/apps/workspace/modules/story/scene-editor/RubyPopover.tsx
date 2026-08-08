import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { Input } from "@/lib/components/elements/Input";
import { useTranslation } from "@/lib/i18n";

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

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }
            // One rung per press: this takes the popover down and leaves the text as it was. The
            // `stopPropagation` is because the row's own Escape leaves edit mode entirely.
            event.stopPropagation();
            settledRef.current = true;
            props.onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    // Light dismiss: close on any pointerdown outside the panel, letting the event through to
    // whatever was clicked so leaving the popover keeps the author's place.
    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            if (panelRef.current?.contains(event.target as Node)) {
                return;
            }
            props.onClose();
        };
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        // The field sits inside the row being edited and `KeybindingService` listens on `window`,
        // where Enter commits the row and Tab indents it. Both have to stop here, or typing a reading
        // would end the line it annotates.
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            props.onClose();
        }
    };

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 140);
    const left = Math.min(props.anchor.left, window.innerWidth - 236);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-56 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
        >
            <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">{t("story.ruby.title")}</div>
            <Input
                size="sm"
                fullWidth
                autoFocus
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
        document.body,
    );
}
