import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookPlus } from "lucide-react";
import { AnchoredPanel } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { DictionaryService } from "@/lib/workspace/services/dictionary/DictionaryService";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { cn } from "@/lib/utils/cn";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { keepStoryKeysInPopover } from "./PausePopover";

const PANEL_WIDTH_PX = 208;
const MENU_ITEM_SELECTOR = "[role=\"menuitem\"]";

/** The word a right click landed on, and where it is drawn. */
export type SpellingTarget = {
    /** Unit offsets of the word, for the splice that replaces it. */
    unitStart: number;
    unitEnd: number;
    word: string;
    /** Viewport box of the word, so the panel opens under the words themselves. */
    anchor: { top: number; left: number; bottom: number };
};

/**
 * The replacements for one misspelled word, and the offer to teach the project the word instead.
 *
 * A popover rather than a context menu, and pointed at the word rather than at the pointer. The
 * suggestions are about one word, and a menu that opens where the mouse happens to be leaves the
 * author reading a list with no visible connection to the thing it is a list about - which was
 * survivable while Chromium supplied the rows and unarguable now that the rows are ours to place.
 *
 * The suggestions are fetched when the panel opens, not with the check. A scene holds hundreds of
 * words and an author asks about one of them, so suggesting for every marked word would be work
 * done on the chance it is wanted; the round trip costs a frame or two and only ever happens on a
 * word somebody has already right-clicked.
 */
export function SpellSuggestionPopover(props: {
    target: SpellingTarget;
    /** The language the word was checked in. Suggestions need it too. */
    language: string;
    /** Write `replacement` over the word, through the field's normal edit path. */
    onApply: (replacement: string) => void;
    /** Take the panel down. The caller clears the state that renders it. */
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    // Deliberately UNSCOPED, unlike the sibling {@link DictionaryMarkPopover}: the only control this
    // panel guards is `Add to dictionary`, and that writes the project's dictionary document. No
    // partial freeze covers it, so naming the story this panel is open over would offer a write the
    // boundary then refuses.
    //
    // The suggestion rows above it are not guarded at all, and that is right: applying one goes
    // through the field's edit path, so it writes the row's text - and the row is only editable when
    // a freeze allows this story document in the first place.
    const freeze = useFreezeGuard();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [suggestions, setSuggestions] = useState<string[] | null>(null);
    const doc = useHostDocument();
    /**
     * The panel's first live row, read when the layer asks rather than captured: the rows are not all
     * there at open (the suggestions arrive a round trip later), and the one that is may be disabled.
     */
    const firstItem = useMemo(() => ({
        get current(): HTMLElement | null {
            const panel = panelRef.current;
            return panel?.querySelector<HTMLElement>(`${MENU_ITEM_SELECTOR}:not(:disabled)`) ?? panel;
        },
    }), []);
    // The menu takes the focus, so the arrows walk its rows and Enter applies one. Left in the field,
    // those keys moved the caret under the open menu and Enter committed the row. Tab stays inside, as
    // it does in every popover over the row being edited (see `PausePopover`); Escape closes the menu
    // and the caller puts the caret back in the line - one rung, not the row's own Escape as well.
    useFloatingLayer({
        open: true,
        onClose: props.onClose,
        panelRef,
        scope: "trap",
        initialFocus: firstItem,
        itemSelector: MENU_ITEM_SELECTOR,
    });

    const dictionaryService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<DictionaryService>(Services.Dictionary);
    }, [context, isInitialized]);

    const { word, anchor } = props.target;
    const language = props.language;

    // The suggestions land after the menu has opened on whatever it had then - the panel, or the
    // dictionary row below them. While the author has not moved off that, the first suggestion is
    // where the menu should have opened, so focus goes there.
    useEffect(() => {
        const panel = panelRef.current;
        if (!panel || !suggestions || suggestions.length === 0) {
            return;
        }
        const active = doc.activeElement;
        const items = panel.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR);
        const resting = active === panel || active === items[items.length - 1] || !active || active === doc.body;
        if (resting) {
            items[0]?.focus({ preventScroll: true });
        }
    }, [doc, suggestions]);

    useEffect(() => {
        let mounted = true;
        void (async () => {
            const result = await getInterface().app.spellcheck.suggest(word, language).catch(() => null);
            if (mounted) {
                // A failed call and an empty list are shown the same way on purpose. Neither can be
                // acted on, and "the checker had nothing" is the honest reading of both.
                setSuggestions(result?.success ? result.data.suggestions : []);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [language, word]);

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

    const addWord = useCallback(() => {
        try {
            dictionaryService?.addTerm(word);
        } catch {
            // A recovery-mode workspace never loaded the document. It also freezes project writes,
            // so this row is already disabled - the catch only makes an unanticipated state cost a
            // click rather than a crash.
        }
        props.onClose();
    }, [dictionaryService, props, word]);

    // A frozen project refuses the write, so the row says so rather than accepting a word it would
    // drop; a recovery-mode workspace never loaded the document at all.
    const addProps = freeze.writes(!dictionaryService);

    return (
        <AnchoredPanel
            anchor={anchorBox}
            width={PANEL_WIDTH_PX}
            panelRef={panelRef}
            // A menu, not a dialog: it is a short list of things to do to one word, it takes no
            // input, and it closes on the first press. Portalled to the body like every other menu
            // and popover in Studio - the rule against that is about dialogs, whose backdrop would
            // otherwise cover the title bar (see the overlay host).
            role="menu"
            aria-label={word}
            className="z-[70] rounded-lg border border-edge bg-surface-overlay py-1 shadow-2xl"
        >
            {/* `contents`, so the rows stay the panel's own children; it is only here to hear the keys. */}
            <div className="contents" onKeyDown={keepStoryKeysInPopover}>
            <p className="truncate px-2 pb-1 text-2xs text-fg-subtle" aria-hidden="true">{word}</p>
            {suggestions === null ? (
                <p className="px-2 py-1 text-xs text-fg-subtle">{t("story.spellcheck.checking")}</p>
            ) : suggestions.length === 0 ? (
                // A row rather than nothing. An empty list is a real answer - the dictionary holds no
                // near miss for this word - and a panel that opened straight onto "add to dictionary"
                // would read as if the word had never been checked.
                <p className="px-2 py-1 text-xs text-fg-subtle">{t("story.spellcheck.noSuggestions")}</p>
            ) : (
                suggestions.map(suggestion => (
                    <button
                        key={suggestion}
                        type="button"
                        role="menuitem"
                        className="block w-full truncate px-2 py-1 text-left text-xs text-fg transition-colors hover:bg-fill"
                        onClick={() => props.onApply(suggestion)}
                    >
                        {suggestion}
                    </button>
                ))
            )}
            <div className="mt-1 border-t border-edge-subtle pt-1">
                <button
                    type="button"
                    role="menuitem"
                    disabled={addProps.disabled}
                    data-tip={addProps["data-tip"]}
                    className={cn(
                        "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-fg-muted transition-colors",
                        addProps.disabled ? "cursor-not-allowed opacity-50" : "hover:bg-fill hover:text-fg",
                    )}
                    onClick={addWord}
                >
                    <BookPlus className="h-3.5 w-3.5 shrink-0" />
                    {/* The word goes into the project's document, not the machine's profile: it is
                        the author's own vocabulary and it travels with the repository. */}
                    <span className="truncate">{t("story.spellcheck.addToDictionary")}</span>
                </button>
            </div>
            </div>
        </AnchoredPanel>
    );
}
