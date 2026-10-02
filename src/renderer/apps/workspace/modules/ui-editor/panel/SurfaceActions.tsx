import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ClipboardPaste, LayoutTemplate, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useFreezeGuard } from "../../../components/ui/freezeGuard";
import { interfaceDocumentFreezeScope } from "../uiLiveSession";

type SurfaceActionsProps = {
    onCreate: () => void;
    createLabel: string;
    createDisabled: boolean;
    onOpenTemplateStore: () => void;
    templateLabel: string;
    templateDisabled: boolean;
    /**
     * Add the interface on the machine's clipboard, or undefined when there is not one.
     *
     * Undefined removes the control rather than greying it. A disabled Paste is the affordance for
     * something the author could do and cannot right now - which is what the freeze guard renders,
     * and it says why. "Nothing has been copied" is not that: it is the ordinary state of a
     * clipboard, and a permanently greyed row over it teaches nothing.
     */
    onPaste?: () => void;
    pasteLabel: string;
};

const CREATE_CLASS =
    "flex h-10 items-center justify-center gap-2 rounded-md border border-edge-strong bg-surface-raised px-3 text-xs font-semibold text-fg transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-fill hover:text-fg";
const SECONDARY_CLASS =
    "flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-xs text-fg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-fill hover:text-fg";

/**
 * Whether the row has room for the template button to say what it is.
 *
 * The store used to be an unlabelled icon beside Create, and an icon of a layout is easy to read as
 * a layout setting - authors asked when a template store would arrive while looking at its button.
 * So it carries its name whenever the row can hold Create, the named template button and Paste at
 * their natural widths, and falls back to the icon (with the name as its tip) only when it cannot.
 *
 * "Natural width" is measured from an invisible copy of the row with every label shown, rather than
 * guessed from a breakpoint: the labels are three languages long, and only the browser knows how wide
 * "Start from a template" is.
 */
function useLabelFits(): {
    fits: boolean;
    rowRef: (node: HTMLDivElement | null) => void;
    naturalRef: (node: HTMLDivElement | null) => void;
} {
    const [fits, setFits] = useState(true);
    const row = useRef<HTMLDivElement | null>(null);
    const natural = useRef<HTMLDivElement | null>(null);
    const observer = useRef<ResizeObserver | null>(null);

    const check = useCallback(() => {
        if (!row.current || !natural.current) {
            return;
        }
        const next = natural.current.offsetWidth <= row.current.clientWidth;
        setFits(current => (current === next ? current : next));
    }, []);

    const observe = useCallback(() => {
        observer.current?.disconnect();
        observer.current = null;
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const next = new ResizeObserver(check);
        if (row.current) next.observe(row.current);
        if (natural.current) next.observe(natural.current);
        observer.current = next;
    }, [check]);

    const rowRef = useCallback((node: HTMLDivElement | null) => {
        row.current = node;
        observe();
        check();
    }, [check, observe]);
    const naturalRef = useCallback((node: HTMLDivElement | null) => {
        natural.current = node;
        observe();
        check();
    }, [check, observe]);

    // The copy is observed as well as the row: a label changing (the list switched between Page and
    // Game UI, or the language changed) resizes the copy without resizing the row.
    useLayoutEffect(() => () => observer.current?.disconnect(), []);

    return { fits, rowRef, naturalRef };
}

export function SurfaceActions({
    onCreate,
    createLabel,
    createDisabled,
    onOpenTemplateStore,
    templateLabel,
    templateDisabled,
    onPaste,
    pasteLabel,
}: SurfaceActionsProps) {
    // All three write: one creates a surface, one opens the store whose Apply imports a template
    // bundle into the interface document, and one adds a copied interface to it.
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const { fits: templateNamed, rowRef, naturalRef } = useLabelFits();
    return (
        <div className="px-2 mt-2 space-y-1.5">
            <div ref={rowRef} className="relative flex gap-2">
                <button
                    type="button"
                    onClick={onCreate}
                    {...freeze.writes(createDisabled)}
                    className={cn(CREATE_CLASS, "min-w-0 flex-1")}
                >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span className="truncate">{createLabel}</span>
                </button>
                <button
                    type="button"
                    onClick={onOpenTemplateStore}
                    // Named by its visible label when it has one; the icon alone needs the name said,
                    // both as its tip and to a screen reader.
                    {...freeze.writes(templateDisabled, templateNamed ? undefined : templateLabel)}
                    aria-label={templateNamed ? undefined : templateLabel}
                    data-surface-template-store=""
                    className={SECONDARY_CLASS}
                >
                    <LayoutTemplate className="w-4 h-4 shrink-0" />
                    {templateNamed ? <span className="whitespace-nowrap">{templateLabel}</span> : null}
                </button>
                {onPaste && (
                    <button
                        type="button"
                        onClick={onPaste}
                        {...freeze.writes(false, pasteLabel)}
                        aria-label={pasteLabel}
                        className={SECONDARY_CLASS}
                    >
                        <ClipboardPaste className="w-4 h-4" />
                    </button>
                )}
                {/*
                  * The row as it would be with every label shown, at its natural width, for
                  * `useLabelFits` to measure. Clipped to nothing so it can never widen the panel or
                  * be seen, and hidden from the accessibility tree.
                  */}
                <div aria-hidden className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
                    <div ref={naturalRef} className="flex w-max gap-2">
                        <span className={CREATE_CLASS}>
                            <Plus className="w-4 h-4 shrink-0" />
                            <span className="whitespace-nowrap">{createLabel}</span>
                        </span>
                        <span className={SECONDARY_CLASS}>
                            <LayoutTemplate className="w-4 h-4 shrink-0" />
                            <span className="whitespace-nowrap">{templateLabel}</span>
                        </span>
                        {onPaste ? (
                            <span className={SECONDARY_CLASS}>
                                <ClipboardPaste className="w-4 h-4" />
                            </span>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
