import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
    type UIEvent,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
// Not in the barrel, and present all the same - see `lib/components/elements/README.md`.
import { PanelHeader } from "@/lib/components/elements/PanelHeader";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { EDITOR_DEFAULT_SPLIT_RATIO, leadingPaneBasis } from "@/apps/workspace/components/layout/editorSplitResize";
import { SplitSash } from "@/apps/workspace/components/layout/SplitSash";
import { DocumentChangeLine } from "../DocumentChangeList";
import {
    buildDocumentChangeRows,
    documentDiffEmptyKey,
    documentDiffTierCaption,
    isWholeDocumentChange,
    type DocumentChangeRow,
} from "../documentChangeView";
import { useCanvasWidth } from "../presenters/canvasShell";
import { DOCUMENT_ROW_CEILING } from "../presenters/GenericChangeDetail";
import {
    buildSplitSlots,
    layoutSplitSlots,
    splitColumnCount,
    type SplitSlot,
    type SplitSlotLayout,
} from "./splitLayout";
import { anchorAt, NO_ANCHOR, stepAnchor } from "./splitNavigation";
import type { SplitRowAction, SplitRowActionResolver } from "./useComparisonElements";

/**
 * One document at two versions, as two halves of one tab.
 *
 * The detail column of the comparison tab is the right shape for a palette and the wrong shape for
 * anything an author wrote in an editor: a story, a page of the interface, a blueprint graph. Those
 * are read at the size they are authored at, so they get a tab, and the tab is two halves - the
 * older version on the left, the newer on the right, scrolled together.
 *
 * **This is the shell.** Each half draws the read-only change rows the detail column already draws,
 * filtered to the version that half is showing. The canvases that replace those rows arrive later and
 * land inside these halves without moving anything here.
 *
 * **A half is not an inert canvas.** Where the tab can say what a row is ABOUT - a page of the
 * interface can, through `useComparisonElements` - the row becomes a control that selects that
 * element at that half's version, and the right rail inspects it. Selectable and inspectable, never
 * editable: the rail's own branch is what enforces that, and this file only publishes the selection.
 *
 * Four rules the halves have to keep, and each of them is a way this surface could lie quietly:
 *
 *  - **A gap is drawn, never closed.** A change on one side only reserves its height on the other,
 *    as a hatched region. Pulling the rows after it up would leave two columns that still look like
 *    a comparison while facing the wrong things at each other (see `splitLayout.ts`).
 *  - **Each half owns its scroller.** The editor tab host never scrolls - a scrollbar there steals
 *    client width from the tab, which re-clamps everything inside it, which removes the scrollbar
 *    again (`EditorGroup.tsx`). So this is `h-full` throughout and the two scrollers are the only
 *    ones on screen.
 *  - **Two columns are a measurement, not a media query.** The tab sits in an editor group that can
 *    be split and dragged narrower than the window, so the body measures itself and falls back to a
 *    single column below `SPLIT_TWO_COLUMN_MIN_PX` - and back to two when it is dragged wider.
 *  - **Every change is reachable without scrolling for it.** Previous and next walk the whole list
 *    with a readout of where they are, because a change one line below the fold is a change nobody
 *    sees.
 */

export interface SplitComparisonViewProps {
    readonly entry: DocumentDiffEntry;
    /** What the document is called, drawn once at the top. */
    readonly name: string;
    /** Where it sits, dimmed beside the name. Null at the project root. */
    readonly directory: string | null;
    /** What the older half shows - a version's number, or the word for the older side. */
    readonly baseLabel: string;
    readonly headLabel: string;
    /** Anything the tab wants in its header, to the right of the navigation. */
    readonly actions?: ReactNode;
    /**
     * What a row in one half selects, when it selects anything.
     *
     * The seam through which a half stops being a picture: `useComparisonElements` answers with the
     * element a row is about, at that half's version, and pressing the row publishes it as the
     * app-wide selection so the right rail inspects it. Left out - and for every document kind that
     * has no such answer - a row is text and stays text, rather than becoming a control that does
     * nothing when pressed.
     */
    readonly rowAction?: SplitRowActionResolver;
    /** Rows one half may draw. The detail column's ceiling, and for the same reason. */
    readonly limit?: number;
}

export function SplitComparisonView({
    entry,
    name,
    directory,
    baseLabel,
    headLabel,
    actions,
    rowAction,
    limit = DOCUMENT_ROW_CEILING,
}: SplitComparisonViewProps) {
    const { t } = useTranslation();

    const built = useMemo(() => buildDocumentChangeRows(entry.diff, limit), [entry.diff, limit]);
    const slots = useMemo(() => buildSplitSlots(built.rows), [built.rows]);

    // Measured rather than assumed, and measured on the TAB BODY: the window's width says nothing
    // about a tab in an editor group that can be split.
    const [bodyWidth, attachBody] = useCanvasWidth();
    const columns = splitColumnCount(bodyWidth);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const [ratio, setRatio] = useState(EDITOR_DEFAULT_SPLIT_RATIO);
    const [dragging, setDragging] = useState(false);

    const [baseHeights, baseScroller] = useSlotHeights();
    const [headHeights, headScroller] = useSlotHeights();
    const layout = useMemo(
        () => layoutSplitSlots(slots, baseHeights, headHeights),
        [slots, baseHeights, headHeights],
    );

    const [active, setActive] = useState(NO_ANCHOR);
    const activeKey = anchorAt(slots, active)?.key ?? null;
    const step = useCallback(
        (direction: 1 | -1) => setActive(current => stepAnchor(slots.length, current, direction)),
        [slots.length],
    );

    // A selection that outlives the document it was made in would point at a row that is no longer
    // there, and the readout would count to a total that has changed underneath it.
    useEffect(() => setActive(NO_ANCHOR), [entry.path, entry.diff]);

    useScrollToAnchor(activeKey, layout, [baseScroller, headScroller]);
    const syncScroll = useSyncedScroll(baseScroller, headScroller);

    // The caption is a caveat about how the rows below were produced, so it is said once for the
    // comparison rather than once per half - it is the same sentence on both sides.
    const caption = isWholeDocumentChange(entry.kind) ? null : documentDiffTierCaption(entry.diff.tier);

    const half = (side: "base" | "head") => (
        <SplitHalf
            side={side}
            label={side === "base" ? baseLabel : headLabel}
            slots={slots}
            layout={layout}
            activeKey={activeKey}
            emptyText={t(documentDiffEmptyKey(entry.diff.tier))}
            notInVersion={t("documentDiff.split.notInVersion")}
            scrollerRef={side === "base" ? baseScroller : headScroller}
            onScroll={syncScroll(side)}
            rowAction={rowAction}
        />
    );

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
            <PanelHeader size="sm">
                <span className="min-w-0 truncate text-xs font-medium text-fg">{name}</span>
                {directory !== null && (
                    <span className="min-w-0 shrink truncate text-2xs text-fg-subtle" data-tip={directory}>
                        {directory}
                    </span>
                )}
                <span className="flex-1" />
                {slots.length > 0 && (
                    <div className="flex shrink-0 items-center gap-1">
                        <ToolbarButton
                            size="xs"
                            onClick={() => step(-1)}
                            data-tip={t("documentDiff.split.previous")}
                            aria-label={t("documentDiff.split.previous")}
                        >
                            <ChevronUp className="h-3.5 w-3.5" />
                        </ToolbarButton>
                        <span
                            data-split-position
                            className="min-w-10 text-center font-mono text-2xs text-fg-muted"
                        >
                            {t("documentDiff.split.position", {
                                index: String(active < 0 ? 0 : active + 1),
                                total: String(slots.length),
                            })}
                        </span>
                        <ToolbarButton
                            size="xs"
                            onClick={() => step(1)}
                            data-tip={t("documentDiff.split.next")}
                            aria-label={t("documentDiff.split.next")}
                        >
                            <ChevronDown className="h-3.5 w-3.5" />
                        </ToolbarButton>
                    </div>
                )}
                {actions}
            </PanelHeader>

            {caption && (
                <p className="shrink-0 truncate px-3 pt-1.5 text-2xs text-fg-subtle" data-tip={t(caption.hintKey)}>
                    {t(caption.key)}
                </p>
            )}

            <div
                ref={node => {
                    containerRef.current = node;
                    attachBody(node);
                }}
                data-split-columns={columns}
                className={cn("flex min-h-0 flex-1", columns === 2 ? "flex-row" : "flex-col")}
            >
                {columns === 2
                    ? (
                        <>
                            <div className="min-h-0 min-w-0" style={{ flex: `0 0 ${leadingPaneBasis(ratio)}` }}>
                                {half("base")}
                            </div>
                            <SplitSash
                                orientation="horizontal"
                                ratio={ratio}
                                containerRef={containerRef}
                                onPreview={next => {
                                    setDragging(true);
                                    setRatio(next);
                                }}
                                onCommit={next => {
                                    setDragging(false);
                                    setRatio(next);
                                }}
                                dragging={dragging}
                                label={t("documentDiff.split.resize")}
                            />
                            <div className="min-h-0 min-w-0" style={{ flex: "1 1 0%" }}>
                                {half("head")}
                            </div>
                        </>
                    )
                    : (
                        <>
                            {/* One column: the halves stack, and each keeps its own header and its
                                own scroller. Nothing is dropped - the narrow arrangement shows the
                                same two versions, one under the other. */}
                            <div className="min-h-0 flex-1 border-b border-edge">{half("base")}</div>
                            <div className="min-h-0 flex-1">{half("head")}</div>
                        </>
                    )}
            </div>

            {built.hidden > 0 && (
                <p className="shrink-0 border-t border-edge px-3 py-1 text-2xs text-fg-subtle">
                    {t("documentDiff.rows.showing", {
                        shown: String(built.total - built.hidden),
                        total: String(built.total),
                    })}
                </p>
            )}
        </div>
    );
}

/**
 * One version, with its name above it.
 *
 * `h-full` and one scroller of its own, both of which the editor tab host requires of everything
 * inside it. The header is the only thing that says which version this is; nothing in the rows does,
 * which is why it may not be dropped at any width.
 */
function SplitHalf({
    side,
    label,
    slots,
    layout,
    activeKey,
    emptyText,
    notInVersion,
    scrollerRef,
    onScroll,
    rowAction,
}: {
    readonly side: "base" | "head";
    readonly label: string;
    readonly slots: readonly SplitSlot[];
    readonly layout: readonly SplitSlotLayout[];
    readonly activeKey: string | null;
    readonly emptyText: string;
    readonly notInVersion: string;
    readonly scrollerRef: RefObject<HTMLDivElement | null>;
    readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
    readonly rowAction?: SplitRowActionResolver;
}) {
    return (
        <section data-split-half={side} aria-label={label} className="flex h-full min-h-0 min-w-0 flex-col">
            <div className="flex min-h-7 shrink-0 items-center gap-2 border-b border-edge px-3">
                <span className="min-w-0 truncate text-2xs font-medium text-fg-muted">{label}</span>
            </div>
            <div
                ref={scrollerRef}
                onScroll={onScroll}
                data-split-scroller={side}
                className="nl-split-half min-h-0 flex-1 overflow-y-auto px-3 py-1"
            >
                {slots.length === 0 && <p className="text-xs text-fg-subtle">{emptyText}</p>}
                {slots.map((slot, index) => {
                    const measured = layout[index];
                    const present = side === "base" ? slot.onBase : slot.onHead;
                    return (
                        <div
                            key={slot.key}
                            data-split-slot={slot.key}
                            // Reserved on both sides, so the row facing this one is its counterpart
                            // at every scroll position. Zero before the first measurement, which
                            // leaves both halves level rather than guessed at.
                            style={{ minHeight: measured ? `${measured.height}px` : undefined }}
                        >
                            {present
                                ? (
                                    <SplitRow
                                        row={slot.row}
                                        active={slot.key === activeKey}
                                        action={rowAction?.(slot.row, side) ?? null}
                                    />
                                )
                                : (
                                    <div
                                        // The one thing on this surface that is a gap on purpose.
                                        // Hatched rather than blank: a blank region reads as content
                                        // that has not loaded.
                                        data-split-spacer={side}
                                        aria-hidden
                                        data-tip={notInVersion}
                                        className="nl-diff-spacer h-full min-h-4 rounded-sm"
                                    />
                                )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

/**
 * One change line, and - where the half can answer for it - the control that selects what it is
 * about.
 *
 * A `<button>` rather than a click handler on the line, so the row is reachable by keyboard and
 * announces itself as something that can be pressed. The line inside is unchanged: what a change
 * says is the same sentence whether or not it selects anything, and a second styling of it would be
 * a second vocabulary for the same rows.
 *
 * A row that selects nothing is not wrapped at all. A control that looks like a control and does
 * nothing is worse than text.
 */
function SplitRow({
    row,
    active,
    action,
}: {
    readonly row: DocumentChangeRow;
    readonly active: boolean;
    readonly action: SplitRowAction | null;
}) {
    const line = <DocumentChangeLine row={row} dense={false} active={active} />;
    if (!action) {
        return line;
    }
    return (
        <button
            type="button"
            data-split-select
            aria-pressed={action.selected}
            aria-label={action.label}
            onClick={action.onSelect}
            className={cn(
                "w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                action.selected ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-surface-raised",
            )}
        >
            {line}
        </button>
    );
}

const NO_HEIGHTS: ReadonlyMap<string, number> = new Map();

/**
 * What each slot's content actually came out at, in one half.
 *
 * Measured rather than calculated, because a row's height is its wrapped text: the same change is
 * one line in a wide half and three in a narrow one. The CONTENT is measured and the wrapper is what
 * the reserved height is applied to, so a measurement never reads back the padding it produced -
 * which would ratchet both halves taller on every pass.
 */
function useSlotHeights(): [ReadonlyMap<string, number>, RefObject<HTMLDivElement | null>] {
    const ref = useRef<HTMLDivElement | null>(null);
    const [heights, setHeights] = useState<ReadonlyMap<string, number>>(NO_HEIGHTS);

    const measure = useCallback(() => {
        const node = ref.current;
        if (!node) {
            return;
        }
        const next = new Map<string, number>();
        node.querySelectorAll<HTMLElement>("[data-split-slot]").forEach(slot => {
            const key = slot.dataset.splitSlot;
            const content = slot.firstElementChild;
            if (key !== undefined && content instanceof HTMLElement) {
                next.set(key, content.getBoundingClientRect().height);
            }
        });
        // Only when something moved. Without this the layout effect below would set state on every
        // render and the two halves would re-render each other forever.
        setHeights(current => (sameHeights(current, next) ? current : next));
    }, []);

    // After every render, because a render is the only thing that changes what the rows say.
    useLayoutEffect(measure);

    useEffect(() => {
        const node = ref.current;
        if (!node || typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => measure());
        observer.observe(node);
        return () => observer.disconnect();
    }, [measure]);

    return [heights, ref];
}

function sameHeights(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [key, value] of b) {
        if (a.get(key) !== value) {
            return false;
        }
    }
    return true;
}

/**
 * Bring the change navigation stopped on into view, in both halves at once.
 *
 * From the layout rather than from the DOM: the two halves reserve the same height for every slot,
 * so one number is where the change is on both sides. Only when it is out of view, so pressing next
 * on a change that is already on screen does not throw the reader's place away.
 */
function useScrollToAnchor(
    activeKey: string | null,
    layout: readonly SplitSlotLayout[],
    scrollers: readonly RefObject<HTMLDivElement | null>[],
) {
    useEffect(() => {
        if (activeKey === null) {
            return;
        }
        const target = layout.find(slot => slot.key === activeKey);
        if (!target) {
            return;
        }
        for (const scroller of scrollers) {
            const node = scroller.current;
            if (!node) {
                continue;
            }
            const above = target.offset < node.scrollTop;
            const below = target.offset + target.height > node.scrollTop + node.clientHeight;
            if (above || below) {
                node.scrollTop = target.offset;
            }
        }
        // The scroller refs are stable for the life of the component, and `layout` changes on every
        // measurement - depending on it would scroll the reader back on each of them.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeKey]);
}

/**
 * Two halves, one scroll position.
 *
 * Scrolling them apart would defeat the whole arrangement: the claim these halves make is that the
 * thing facing this thing is its counterpart, and that claim is only true while they are level.
 */
function useSyncedScroll(
    base: RefObject<HTMLDivElement | null>,
    head: RefObject<HTMLDivElement | null>,
) {
    // Set while one half is being moved by the other, so the echo does not come back.
    const echoing = useRef(false);
    return useCallback(
        (side: "base" | "head") => (event: UIEvent<HTMLDivElement>) => {
            if (echoing.current) {
                return;
            }
            const other = side === "base" ? head.current : base.current;
            if (!other || other.scrollTop === event.currentTarget.scrollTop) {
                return;
            }
            echoing.current = true;
            other.scrollTop = event.currentTarget.scrollTop;
            echoing.current = false;
        },
        [base, head],
    );
}
