import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { PanelHeader } from "@/lib/components/elements/PanelHeader";
import { ResizableHandle } from "./ResizableHandle";
import {
    isUsableSectionSize,
    resizeSectionPair,
    resolveSectionStackLayout,
    sashNeighbours,
    sectionStackChromeHeight,
    type SectionStackSpec,
} from "./sectionStackLayout";

export type { SectionStackSpec } from "./sectionStackLayout";

/** How far one arrow key moves a focused seam - the editor split's step. */
const KEYBOARD_STEP_PX = 24;

/**
 * How long a section takes to open or fold - the Accordion's. Every body moves over the same time
 * and the same curve, so their heights keep adding up to the panel's the whole way and the headers
 * below slide to where they end up rather than jumping there.
 */
const SECTION_MOTION_MS = 200;
const SECTION_MOTION = `height ${SECTION_MOTION_MS}ms ease-out`;

type SectionMotion = {
    /**
     * The heights the bodies are leaving, held for one painted frame before they set off; null once
     * they have. Opening a section costs a render of everything in it, and a transition started
     * inside that render has already used up a third of its time by the first frame anybody sees -
     * the header jumps most of the way and only then eases in, which is the jump the motion is for
     * taking away. Starting from a frame that is already on screen, the whole of it is seen.
     */
    from: readonly number[] | null;
    /** Which sections are folding closed, by index: their bodies stay up, shrinking, until the motion ends. */
    folding: readonly boolean[];
};

function sameFlags(a: readonly boolean[], b: readonly boolean[]): boolean {
    return a.length === b.length && a.every((flag, index) => flag === b[index]);
}

/** Body heights the author chose, by section id. A missing id is a section they never sized. */
export type SectionStackSizes = Readonly<Record<string, number | undefined>>;

export type SectionStackProps = {
    /** Every section, in the order they are drawn, with the rules for sizing each. */
    sections: readonly SectionStackSpec[];
    /** The section that takes up the slack - the panel's subject. Optional. */
    fillId?: string;
    open: Readonly<Record<string, boolean | undefined>>;
    onOpenChange: (sectionId: string, open: boolean) => void;
    sizes: SectionStackSizes;
    /** Once per drag, on release, and once per key press or reset - a cheap place to save. */
    onSizesChange: (sizes: SectionStackSizes) => void;
    className?: string;
    /** The `StackSection`s, in the order `sections` lists them. */
    children: ReactNode;
};

type DividerSlot = { kind: "none" } | { kind: "line" } | { kind: "sash"; upper: number; lower: number };

type SectionSlot = {
    open: boolean;
    /** Whether the body is drawn: while the section is open, and while it folds. */
    mounted: boolean;
    /** Whether the body's height is moving rather than set - a section opening or folding. */
    animate: boolean;
    /** The body's height in CSS pixels. */
    size: number;
    toggle: () => void;
    /** What is drawn above this section's header: the seam under the open body before it, if any. */
    divider: DividerSlot;
};

type SectionStackContextValue = {
    slot: (sectionId: string) => SectionSlot | null;
    renderSash: (upper: number, lower: number) => ReactNode;
};

const SectionStackContext = createContext<SectionStackContextValue | null>(null);

/**
 * The panel's own height, measured. Null until it has one, and a hidden panel (a sidebar kept alive
 * behind another, laid out at nothing) keeps the last height it had: laying the bodies out at zero
 * for it would clamp every list's scroll position to the top for when it comes back.
 */
function useMeasuredHeight(): [number | null, (node: HTMLDivElement | null) => void] {
    const [height, setHeight] = useState<number | null>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const attach = useCallback((node: HTMLDivElement | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        if (!node) {
            return;
        }
        const measure = () => {
            const next = Math.floor(node.getBoundingClientRect().height);
            if (next > 0) {
                setHeight(current => (current === next ? current : next));
            }
        };
        measure();
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        observerRef.current = observer;
    }, []);
    useLayoutEffect(() => () => observerRef.current?.disconnect(), []);
    return [height, attach];
}

/**
 * A panel made of collapsible sections that share its height, the way the Explorer in VS Code is.
 *
 * Each section is a header - chevron, title, an optional count, its actions - over a body that
 * scrolls on its own. Open bodies divide the panel between them; a seam between two of them drags,
 * takes the arrow keys once focused and goes back to the defaults on a double-click; a closed section
 * is its header alone. The panel itself never scrolls, so a wheel that runs off the end of one list
 * never carries another one, or the whole panel, along with it. How the height is shared is
 * `resolveSectionStackLayout`.
 *
 * Opening or folding a section animates; nothing else does. A drag, an arrow key on a seam and a
 * panel that changes height all set the bodies at once, the way VS Code's panes behave.
 *
 * Open states and sizes belong to the caller, which decides where they are remembered - a project's
 * panel state, usually. Sizes are reported once per gesture, never per pointer move.
 *
 * Sections are `StackSection`s, which may be rendered by other components as long as they are
 * children of this one: a section can then keep its own header actions and count next to the state
 * they come from.
 */
export function SectionStack({
    sections,
    fillId,
    open,
    onOpenChange,
    sizes,
    onSizesChange,
    className,
    children,
}: SectionStackProps) {
    const { t } = useTranslation();
    const [height, attachRoot] = useMeasuredHeight();
    // The document the panel is drawn in - not the renderer's own inside a detached window - which is
    // where the drag sheet has to go.
    const [hostDocument, setHostDocument] = useState<Document | null>(null);
    const setRoot = useCallback((node: HTMLDivElement | null) => {
        if (node) {
            setHostDocument(node.ownerDocument);
        }
        attachRoot(node);
    }, [attachRoot]);

    const openFlags = useMemo(() => sections.map(spec => open[spec.id] === true), [open, sections]);
    const fillIndex = fillId ? sections.findIndex(spec => spec.id === fillId) : -1;

    const laidOut = useMemo(() => {
        const entries = sections.map((spec, index) => ({ spec, open: openFlags[index]!, size: sizes[spec.id] }));
        if (height === null) {
            // Not measured yet: the frame before the first layout effect, which is never painted.
            return entries.map(entry => (entry.open ? (isUsableSectionSize(entry.size) ? entry.size : entry.spec.defaultSize) : 0));
        }
        return resolveSectionStackLayout(height - sectionStackChromeHeight(openFlags), entries, fillIndex);
    }, [fillIndex, height, openFlags, sections, sizes]);

    /** The body heights last put on screen - where a section that starts to open or fold moves from. */
    const committedSizes = useRef<readonly number[]>(laidOut);

    /**
     * A section opening or folding, from the render that changes which ones are open until the
     * bodies have had the time to get there. Set while rendering rather than in an effect, so the
     * commit that opens a body is already the one that holds it at nothing.
     */
    const [motion, setMotion] = useState<SectionMotion | null>(null);
    const [lastFlags, setLastFlags] = useState(openFlags);
    if (!sameFlags(lastFlags, openFlags)) {
        setLastFlags(openFlags);
        // Before the panel is measured nothing has been painted, so there is nothing to move from.
        // Mid-motion, the bodies hold their course for the frame and then turn towards the new
        // heights from wherever they have got to.
        setMotion(height === null || lastFlags.length !== openFlags.length
            ? null
            : {
                from: motion?.from ?? committedSizes.current,
                folding: openFlags.map((isOpen, index) =>
                    !isOpen && (lastFlags[index] === true || motion?.folding[index] === true)),
            });
    }
    useEffect(() => {
        if (!motion) {
            return;
        }
        if (motion.from) {
            // A frame, then the targets: the update this schedules is rendered after that frame
            // has been painted, so the transitions start from heights that are already on screen.
            const frame = requestAnimationFrame(() => {
                setMotion(current => (current === motion ? { ...motion, from: null } : current));
            });
            return () => cancelAnimationFrame(frame);
        }
        const timer = window.setTimeout(() => {
            setMotion(current => (current === motion ? null : current));
        }, SECTION_MOTION_MS + 50);
        return () => window.clearTimeout(timer);
    }, [motion]);

    /**
     * The sizes during a drag, which the stack holds itself and reports only on release. Set on the
     * first move rather than on the press, so a press that does not move - the first half of a
     * double-click - never puts the drag sheet up between the two clicks and takes the second one.
     */
    const [live, setLive] = useState<number[] | null>(null);
    const liveRef = useRef<number[] | null>(null);
    const latest = useRef({ laidOut, sections, sizes, openFlags, onSizesChange });
    latest.current = { laidOut, sections, sizes, openFlags, onSizesChange };
    const shown = live ?? motion?.from ?? laidOut;
    useLayoutEffect(() => {
        committedSizes.current = shown;
    });

    const beginDrag = useCallback(() => {
        liveRef.current = latest.current.laidOut.slice();
    }, []);

    const dragBy = useCallback((upper: number, lower: number, delta: number): number => {
        const current = liveRef.current;
        if (!current) {
            return 0;
        }
        const mins = latest.current.sections.map(spec => spec.minSize);
        const { sizes: next, applied } = resizeSectionPair(current, upper, lower, delta, mins);
        liveRef.current = next;
        setLive(next);
        // What the handle wants back is the part of the pointer's travel the seam did not follow,
        // so the seam stays under the pointer once a body reaches its minimum.
        return applied - delta;
    }, []);

    const endDrag = useCallback(() => {
        const settled = liveRef.current;
        liveRef.current = null;
        setLive(null);
        const { laidOut: before, sections: specs, sizes: stored, openFlags: flags, onSizesChange: report } = latest.current;
        if (!settled || settled.every((size, index) => size === before[index])) {
            return;
        }
        // Every open body is written down at the size it is now, not just the two beside the seam:
        // laid out again from these, the panel comes back exactly as the author left it.
        const next: Record<string, number | undefined> = { ...stored };
        specs.forEach((spec, index) => {
            if (flags[index]) {
                next[spec.id] = settled[index];
            }
        });
        report(next);
    }, []);

    const reset = useCallback((upper: number, lower: number) => {
        const { sections: specs, sizes: stored, onSizesChange: report } = latest.current;
        const next: Record<string, number | undefined> = { ...stored };
        delete next[specs[upper]!.id];
        delete next[specs[lower]!.id];
        report(next);
    }, []);

    const context = useMemo<SectionStackContextValue>(() => ({
        slot: (sectionId: string) => {
            const index = sections.findIndex(spec => spec.id === sectionId);
            if (index < 0) {
                return null;
            }
            let divider: DividerSlot = { kind: "none" };
            if (index > 0 && openFlags[index - 1]) {
                const pair = sashNeighbours(openFlags, index - 1);
                divider = pair ? { kind: "sash", ...pair } : { kind: "line" };
            }
            return {
                open: openFlags[index]!,
                mounted: openFlags[index]! || motion?.folding[index] === true,
                // Never under a drag: the seam has to stay under the pointer.
                animate: motion !== null && live === null,
                size: shown[index] ?? 0,
                toggle: () => onOpenChange(sectionId, !openFlags[index]),
                divider,
            };
        },
        renderSash: (upper: number, lower: number) => {
            const upperSize = shown[upper] ?? 0;
            const lowerSize = shown[lower] ?? 0;
            const pair = upperSize + lowerSize;
            return (
                <ResizableHandle
                    direction="vertical"
                    onResize={delta => dragBy(upper, lower, delta)}
                    onDragStart={beginDrag}
                    onDragEnd={endDrag}
                    keyboardStep={KEYBOARD_STEP_PX}
                    onReset={() => reset(upper, lower)}
                    label={t("workspace.shell.resizeSections")}
                    valueNow={pair > 0 ? (upperSize / pair) * 100 : 50}
                />
            );
        },
    }), [beginDrag, dragBy, endDrag, live, motion, onOpenChange, openFlags, reset, sections, shown, t]);

    return (
        <SectionStackContext.Provider value={context}>
            <div ref={setRoot} data-section-stack="" className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
                {children}
            </div>
            {/* While a seam is dragged, a sheet over the whole window keeps the resize cursor
                wherever the pointer runs to, and keeps the lists underneath from reading the drag
                as hover - the same sheet an editor's sidebar puts up. */}
            {live && hostDocument
                ? createPortal(<div className="fixed inset-0 z-[10000] cursor-row-resize" />, hostDocument.body)
                : null}
        </SectionStackContext.Provider>
    );
}

export type StackSectionProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> & {
    /** Which entry of the stack's `sections` this is. */
    sectionId: string;
    title: ReactNode;
    /** How many things the section holds, shown beside the title. */
    count?: number;
    /** Controls for the section as a whole, shown at the header's end while it is open. */
    actions?: ReactNode;
    /** Classes for the body, the box the section's content is laid out in. */
    bodyClassName?: string;
    ref?: Ref<HTMLDivElement>;
    /** The body. A list in it scrolls itself: `min-h-0 flex-1 overflow-y-auto overscroll-contain`. */
    children: ReactNode;
};

/**
 * One section of a `SectionStack`: its header, and its body while it is open.
 *
 * The header is a `PanelHeader` on the sunken surface the workspace's title bars use, with the
 * Accordion's chevron, so the boundary between two sections reads the way every other header in
 * Studio does. The body is a flex column of exactly the height the stack gave it, clipped: content
 * that is taller scrolls inside it rather than spilling into the next section.
 *
 * Other DOM props (a ref, `data-*`, a key handler) land on the section's own box, which holds the
 * header and the body.
 */
export function StackSection({
    sectionId,
    title,
    count,
    actions,
    bodyClassName,
    className,
    children,
    ref,
    ...rootProps
}: StackSectionProps) {
    const context = useContext(SectionStackContext);
    const bodyId = useId();
    const slot = context?.slot(sectionId) ?? null;
    if (!context || !slot) {
        return null;
    }
    const { open, mounted, animate, size, toggle, divider } = slot;

    return (
        <>
            {divider.kind === "sash" ? context.renderSash(divider.upper, divider.lower) : null}
            {divider.kind === "line" ? <div className="shrink-0 border-t border-edge" aria-hidden /> : null}
            <div ref={ref} data-section={sectionId} className={cn("flex shrink-0 flex-col", className)} {...rootProps}>
                {/* The sunken surface sits under the header rather than on it, so the hover fill -
                    the one every row and the Accordion's header use - lands on top of it instead of
                    replacing it. The whole row lights, actions included: it is one target. */}
                <div className="shrink-0 bg-surface-sunken">
                    {/* Exactly `h-9`, border included: the layout counts every header as
                        SECTION_HEADER_HEIGHT when it shares the panel out. */}
                    <PanelHeader size="sm" className="h-9 gap-1 pl-1.5 pr-2 transition-colors duration-150 hover:bg-fill">
                        <button
                            type="button"
                            className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pl-0.5 text-left cursor-default"
                            onClick={toggle}
                            aria-expanded={open}
                            aria-controls={open ? bodyId : undefined}
                        >
                            {/* The Accordion's chevron: right when closed, a quarter turn down when
                                open, turning over the time the body takes to get there. */}
                            <ChevronRight
                                className="h-4 w-4 shrink-0 text-fg-muted transition-[rotate] duration-200"
                                style={{ rotate: open ? "90deg" : "0deg" }}
                                aria-hidden
                            />
                            <span className="min-w-0 truncate text-xs font-semibold text-fg">{title}</span>
                            {count !== undefined ? <span className="shrink-0 text-2xs text-fg-subtle">{count}</span> : null}
                        </button>
                        {open && actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
                    </PanelHeader>
                </div>
                {mounted ? (
                    <div
                        id={bodyId}
                        data-section-body={sectionId}
                        className={cn("flex min-h-0 flex-col overflow-hidden", bodyClassName)}
                        // Inline rather than a class: a body's own `transition-colors` would win a
                        // class merge and stop the height from moving.
                        style={{ height: size, transition: animate ? SECTION_MOTION : undefined }}
                        // A folding body is on its way out: nothing in it takes focus or a click.
                        inert={!open}
                    >
                        {children}
                    </div>
                ) : null}
            </div>
        </>
    );
}
