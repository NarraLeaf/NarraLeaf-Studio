import { useCallback, useEffect, useMemo, useRef } from "react";
import { BookMarked, Replace, Type } from "lucide-react";
import { AnchoredPanel } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { Services } from "@/lib/workspace/services/services";
import type { DictionaryService } from "@/lib/workspace/services/dictionary/DictionaryService";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { openDictionaryPanel } from "@/apps/workspace/modules/dictionary/openDictionaryPanel";
import { useStoryDocumentScope } from "./storySceneReadOnly";
import type { DictionaryClickInfo } from "./RichTextInput";
import { keepStoryKeysInPopover } from "./PausePopover";

const PANEL_WIDTH_PX = 224;
const MENU_ITEM_SELECTOR = "[role=\"menuitem\"]";

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
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    // Both actions below go through the field's own edit path, so what they write is the text of one
    // row - this story document and nothing else. Scoped to it, because the panel opens on a row the
    // author is already editing: a live session that let them type into the line and then refused the
    // dictionary's own one-click correction would be saying two things about one write.
    //
    // The scope comes from the surrounding scene editor rather than from a prop, the way the rows
    // themselves take it. Outside one there is no scope and this is frozen by any freeze at all.
    const freeze = useFreezeGuard(useStoryDocumentScope());
    const panelRef = useRef<HTMLDivElement | null>(null);
    const doc = useHostDocument();
    const { mark, anchor } = props.target;
    /** The first row that can be pressed - the correction, unless a freeze has switched it off. */
    const firstItem = useMemo(() => ({
        get current(): HTMLElement | null {
            const panel = panelRef.current;
            return panel?.querySelector<HTMLElement>(`${MENU_ITEM_SELECTOR}:not(:disabled)`) ?? panel;
        },
    }), []);
    // The menu takes the focus, so the arrows walk its rows and Enter presses one; left in the field,
    // they moved the caret under the open menu and Enter committed the row. Tab stays inside, as in
    // every popover over the row being edited (see `PausePopover`). Escape closes this one rung - the
    // caller puts the caret back - and not the row's own edit mode as well.
    useFloatingLayer({
        open: true,
        onClose: props.onClose,
        panelRef,
        scope: "trap",
        initialFocus: firstItem,
        itemSelector: MENU_ITEM_SELECTOR,
    });

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

    // Light dismiss, letting the event through to whatever was clicked so leaving the panel keeps
    // the author's place in the sentence.
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

    // A freeze that covers this story has already made the row read-only, so the edit cannot happen;
    // saying so is what keeps the panel from accepting a change it would drop.
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
            {/* `contents`, so the rows stay the panel's own children; it is only here to hear the keys. */}
            <div className="contents" onKeyDown={keepStoryKeysInPopover}>
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
            </div>
        </AnchoredPanel>
    );
}
