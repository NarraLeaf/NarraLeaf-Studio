import { useCallback, useEffect, useMemo, useRef } from "react";
import { BookMarked, Replace, Type } from "lucide-react";
import { AnchoredPanel } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useDismissWhenHidden } from "@/lib/components/layout";
import { Services } from "@/lib/workspace/services/services";
import type { DictionaryService } from "@/lib/workspace/services/dictionary/DictionaryService";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { openDictionaryPanel } from "@/apps/workspace/modules/dictionary/openDictionaryPanel";
import type { DictionaryClickInfo } from "./RichTextInput";

const PANEL_WIDTH_PX = 224;

/**
 * What the project dictionary has to say about the words under the pointer, and the one thing to do
 * about it.
 *
 * The sibling of {@link SpellSuggestionPopover}, and pointed at the words for the same reason: this
 * is a statement about one stretch of one line, and a menu opening where the mouse happens to be
 * leaves the author reading a list with no visible connection to what it is about.
 *
 * One action, not a list. A variant has exactly one replacement - the term the project writes - and
 * a reading has exactly one value. What the second row offers is the entry itself, because the
 * answer to "why is this marked" is the record that marked it, and a note the author left on it is
 * the closest thing the script has to a style guide.
 */
export function DictionaryMarkPopover(props: {
    target: DictionaryClickInfo;
    /** Write the term over the variant, through the field's normal edit path. */
    onReplace: (replacement: string) => void;
    /** Write the reading over the term as ruby. */
    onApplyReading: (reading: string) => void;
    /** Take the panel down. The caller clears the state that renders it. */
    onClose: () => void;
}) {
    // Switching tabs or panels away from this row leaves a body-portalled panel hanging over
    // whatever the author moved to; the caller's own dismissal is what puts it away.
    useDismissWhenHidden(props.onClose);
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const { mark, anchor } = props.target;

    const note = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        try {
            return context.services.get<DictionaryService>(Services.Dictionary).getEntry(mark.term)?.note ?? null;
        } catch {
            // A recovery-mode workspace never loaded the document.
            return null;
        }
    }, [context, isInitialized, mark.term]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }
            // One rung per press: this closes the panel and leaves the row being edited. The row's
            // own Escape leaves edit mode entirely, which is a rung further out.
            event.stopPropagation();
            props.onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    // Light dismiss, letting the event through to whatever was clicked so leaving the panel keeps
    // the author's place in the sentence.
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

    const anchorBox = useCallback(
        () => ({ top: anchor.top, bottom: anchor.bottom, left: anchor.left }),
        [anchor.bottom, anchor.left, anchor.top],
    );

    const openEntry = useCallback(() => {
        if (context) {
            openDictionaryPanel(context, { term: mark.term });
        }
        props.onClose();
    }, [context, mark.term, props]);

    // The row is already read-only on a frozen project, so the edit cannot happen; saying so is what
    // keeps the panel from accepting a change it would drop.
    const editProps = freeze.writes();

    return (
        <AnchoredPanel
            anchor={anchorBox}
            width={PANEL_WIDTH_PX}
            panelRef={panelRef}
            role="menu"
            aria-label={mark.term}
            className="z-[70] rounded-lg border border-edge bg-surface-overlay py-1 shadow-2xl"
        >
            <p className="truncate px-2 pb-1 text-2xs text-fg-subtle" aria-hidden="true">{mark.term}</p>
            {mark.kind === "variant" ? (
                <button
                    type="button"
                    role="menuitem"
                    disabled={editProps.disabled}
                    data-tip={editProps["data-tip"]}
                    className={cn(
                        "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-fg transition-colors",
                        editProps.disabled ? "cursor-not-allowed opacity-50" : "hover:bg-fill",
                    )}
                    onClick={() => props.onReplace(mark.replacement ?? mark.term)}
                >
                    <Replace className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                        {t("story.dictionary.replaceWith", { term: mark.replacement ?? mark.term })}
                    </span>
                </button>
            ) : (
                <button
                    type="button"
                    role="menuitem"
                    disabled={editProps.disabled}
                    data-tip={editProps["data-tip"]}
                    className={cn(
                        "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-fg transition-colors",
                        editProps.disabled ? "cursor-not-allowed opacity-50" : "hover:bg-fill",
                    )}
                    onClick={() => props.onApplyReading(mark.reading ?? "")}
                >
                    <Type className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                        {t("story.dictionary.applyReading", { reading: mark.reading ?? "" })}
                    </span>
                </button>
            )}
            {note ? <p className="px-2 py-1 text-2xs text-fg-subtle">{note}</p> : null}
            <div className="mt-1 border-t border-edge-subtle pt-1">
                <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    onClick={openEntry}
                >
                    <BookMarked className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t("story.dictionary.openEntry")}</span>
                </button>
            </div>
        </AnchoredPanel>
    );
}
