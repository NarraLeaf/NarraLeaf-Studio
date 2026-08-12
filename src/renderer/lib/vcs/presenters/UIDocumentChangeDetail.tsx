import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { uiDocumentSpec } from "@shared/documents/specs/uiDocument";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements";
import { ErrorBoundary } from "@/lib/app/errorHandling/ErrorBoundary";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { createEditorHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/editorHostAdapter";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { sidesOfEntry } from "./bitmapPreview";
import {
    canvasReadFailure,
    CanvasColumn,
    CanvasNote,
    CanvasShell,
    MaskLegend,
    UnmarkedNote,
    useCanvasWidth,
} from "./canvasShell";
import { CHANGE_MASK_CLASS } from "./changeMask";
import { registerChangePresenter, type ChangePresenter, type ChangePresenterProps } from "./registry";
import { useSideDocument } from "./sideDocument";
import {
    buildSurfaceDiffPlan,
    sharedSurfaceScale,
    type CanvasSize,
    type SurfaceMask,
} from "./surfaceDiffPlan";

/**
 * Two versions of one page of the interface, side by side, with what changed washed over it.
 *
 * The question this answers is the one a list of rows cannot: "layout changed" on an element named
 * `panel-2` tells an author that something moved and nothing about whether the result is right. Here
 * the old page and the new one are drawn by the same renderer the editor uses, at one shared scale,
 * with a translucent mark over each element the comparison found - so the answer is the page itself.
 *
 * **The history is drawn, never run.** `passive` turns off every widget's pointer handling and
 * `staticDocument` lets the element tree be memoised, which is what that flag is for and which the
 * editing canvas may never set - a document that cannot change is exactly the case it promises. The
 * only thing that takes a click is the marks layer on top.
 *
 * **Where a mark goes is measured, not calculated.** An element's `layout` is relative to its parent
 * and is ignored outright inside a stack container or a list, so geometry read from the document
 * would put marks in the wrong place on exactly the pages that use those. The marks are positioned
 * from the rendered DOM instead, which is the only thing that knows where an element ended up.
 *
 * **An element the DOM has no handle on is said out loud.** Only interactive wrappers carry
 * `data-ui-element-id`, and content inside a component instance carries none at all by design (every
 * placement of one definition shares the ids inside it). Those changes are counted in the line under
 * the canvas rather than dropped, because a canvas that silently marks nine of twelve changes is
 * worse than one that marks nine and says so.
 */

/** How tall the pair of pages may get before the scale is pulled in. */
const CANVAS_MAX_HEIGHT = 360;

export function UIDocumentChangeDetail({ entry, change, sides }: ChangePresenterProps) {
    const { t, tn } = useTranslation();
    const requested = useMemo(() => sidesOfEntry(entry, sides), [entry, sides]);
    const base = useSideDocument<UIDocument>(requested.before, entry.path, uiDocumentSpec);
    const head = useSideDocument<UIDocument>(requested.after, entry.path, uiDocumentSpec);

    const changes = entry.diff.changes;
    const plan = useMemo(
        () => buildSurfaceDiffPlan(changes, base.document, head.document),
        [changes, base.document, head.document],
    );

    /**
     * The page being looked at, resolved against the plan rather than stored as truth.
     *
     * The same discipline the tab applies to the selected file: a document that finished loading
     * changes which pages exist, and a stored id would then name one nothing can draw.
     */
    const [chosenSurface, setChosenSurface] = useState<string | null>(null);
    const surfaceId = plan.surfaces.some(option => option.id === chosenSurface)
        ? chosenSurface
        : plan.defaultSurfaceId;
    const surface = plan.surfaces.find(option => option.id === surfaceId) ?? null;

    /** Which change a mark was clicked on, as an index into `entry.diff.changes`. */
    const [selected, setSelected] = useState<number | null>(null);

    const [frame, onFrame] = useCanvasWidth();
    const masks = useMemo(
        () => plan.masks.filter(mask => mask.target.surfaceId === surfaceId),
        [plan.masks, surfaceId],
    );
    // Memoised per column, and that is load-bearing rather than tidy: a column measures itself in a
    // layout effect keyed on the marks it was given, so an array rebuilt on every render would
    // measure on every render - and each measurement reports back up, which renders again.
    const baseMasks = useMemo(() => masks.filter(mask => mask.onBase), [masks]);
    const headMasks = useMemo(() => masks.filter(mask => mask.onHead), [masks]);

    /**
     * Marks whose element the rendered page has no handle on, by column.
     *
     * Narrowed to the page on screen rather than cleared when the page changes: a column reports
     * what it just measured, and the answer for the page the author has left is still sitting in
     * state until that column measures again. Filtering is one line and cannot be forgotten in a
     * branch, where an effect that resets it can.
     */
    const [unplacedBase, setUnplacedBase] = useState<readonly number[]>([]);
    const [unplacedHead, setUnplacedHead] = useState<readonly number[]>([]);
    const unplaced = useMemo(() => {
        const here = new Set(masks.map(mask => mask.index));
        // A page neither version holds draws no column at all, so nothing will ever measure its
        // marks and report them. They are unplaced by construction, and saying so is the difference
        // between a count that adds up and one that quietly does not.
        if (surface !== null && !surface.inBase && !surface.inHead) {
            return here;
        }
        return new Set([...unplacedBase, ...unplacedHead].filter(index => here.has(index)));
    }, [unplacedBase, unplacedHead, masks, surface]);

    const columns = (surface?.inBase ? 1 : 0) + (surface?.inHead ? 1 : 0);
    const scale = sharedSurfaceScale(
        [surface?.baseSize ?? null, surface?.headSize ?? null],
        {
            width: columns > 1 ? Math.max(0, (frame - COLUMN_GAP) / 2) : frame,
            height: CANVAS_MAX_HEIGHT,
        },
    );

    const failure = canvasReadFailure(base, head);
    const drawn = surface !== null && (base.document !== null || head.document !== null);

    return (
        <CanvasShell
            entry={entry}
            change={change}
            selected={selected === null ? null : changes[selected] ?? null}
            onClearSelection={() => setSelected(null)}
            controls={plan.surfaces.length > 1 && (
                <Select
                    size="sm"
                    ariaLabel={t("documentDiff.canvas.surfaceLabel")}
                    value={surfaceId ?? ""}
                    onChange={value => {
                        setChosenSurface(String(value));
                        setSelected(null);
                    }}
                    options={plan.surfaces.map(option => ({
                        value: option.id,
                        label: option.name ?? t("documentDiff.canvas.unnamed"),
                        secondaryLabel: option.changes > 0
                            ? tn("documentDiff.shell.changes", option.changes)
                            : undefined,
                    }))}
                />
            )}
            legend={<MaskLegend tones={masks.map(mask => mask.tone)} />}
            notes={
                <>
                    {failure && <CanvasNote tone="danger">{t(failure.key, { error: failure.error })}</CanvasNote>}
                    <UnmarkedNote
                        elsewhere={plan.masks.length - masks.length}
                        elsewhereKey="documentDiff.canvas.onOtherPages"
                        offCanvas={plan.offCanvas.length}
                        unplaced={unplaced.size}
                    />
                </>
            }
        >
            <div ref={onFrame} className="flex w-full items-start gap-2">
                {frame > 0 && drawn && surface && (
                    <>
                        {surface.inBase && (
                            <SurfaceColumn
                                caption="documentDiff.canvas.before"
                                document={base.document}
                                surfaceId={surface.id}
                                size={surface.baseSize}
                                scale={scale}
                                masks={baseMasks}
                                selected={selected}
                                onSelect={setSelected}
                                onUnplaced={setUnplacedBase}
                            />
                        )}
                        {surface.inHead && (
                            <SurfaceColumn
                                caption="documentDiff.canvas.after"
                                document={head.document}
                                surfaceId={surface.id}
                                size={surface.headSize}
                                scale={scale}
                                masks={headMasks}
                                selected={selected}
                                onSelect={setSelected}
                                onUnplaced={setUnplacedHead}
                            />
                        )}
                    </>
                )}
                {frame > 0 && !drawn && !failure && (
                    <p className="text-2xs text-fg-muted">{t("documentDiff.rows.loading")}</p>
                )}
            </div>
        </CanvasShell>
    );
}

/** The gap between the two columns, in pixels - `gap-2`, spelled where the scale can subtract it. */
const COLUMN_GAP = 8;

/* ---------------------------------------------------------------------------------------- */
/* One column                                                                                 */
/* ---------------------------------------------------------------------------------------- */

interface SurfaceColumnProps {
    readonly caption: TranslationKey;
    readonly document: UIDocument | null;
    readonly surfaceId: string;
    readonly size: CanvasSize | null;
    readonly scale: number;
    readonly masks: readonly SurfaceMask[];
    readonly selected: number | null;
    readonly onSelect: (index: number) => void;
    readonly onUnplaced: (indices: readonly number[]) => void;
}

function SurfaceColumn(props: SurfaceColumnProps) {
    const { t } = useTranslation();
    const { document, surfaceId, size, scale, masks, selected, onSelect, onUnplaced } = props;
    const surface = findSurface(document, surfaceId);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const [boxes, setBoxes] = useState<ReadonlyMap<number, MaskBox>>(EMPTY_BOXES);
    /** The last list handed upwards, so an unchanged one is never handed up twice. */
    const reported = useRef<readonly number[]>(NO_INDICES);

    const hostAdapter = useMemo(() => createEditorHostAdapter(), []);

    /**
     * Where every mark goes, measured off the page that was just drawn.
     *
     * In a layout effect and again on the next frame: the first pass catches a page whose layout is
     * settled by the time React commits, the second catches one whose widgets size themselves after
     * mounting. A resize observer keeps both honest when the pane is dragged wider.
     */
    const measure = useCallback(() => {
        const frame = frameRef.current;
        if (!frame) {
            return;
        }
        const bounds = frame.getBoundingClientRect();
        const found = new Map<number, MaskBox>();
        const missing: number[] = [];
        for (const mask of masks) {
            const box = mask.target.kind === "surface"
                ? { left: 0, top: 0, width: bounds.width, height: bounds.height }
                : elementBox(frame, bounds, mask.target.elementId);
            if (box) {
                found.set(mask.index, box);
            } else {
                missing.push(mask.index);
            }
        }
        setBoxes(current => (sameBoxes(current, found) ? current : found));
        // Only when it changed. A resize observer fires often, the answer is usually the same one,
        // and handing an equal-but-new array up would re-render the parent - which re-renders this
        // column, which measures again.
        if (reported.current.length !== missing.length
            || missing.some((index, at) => reported.current[at] !== index)) {
            reported.current = missing;
            onUnplaced(missing);
        }
    }, [masks, onUnplaced]);

    useLayoutEffect(() => {
        measure();
        const frame = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(frame);
    }, [measure, document, surfaceId, scale]);

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame || typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => measure());
        observer.observe(frame);
        return () => observer.disconnect();
    }, [measure]);

    const drawable = surface !== null && size !== null;

    return (
        <figure className="flex min-w-0 flex-col gap-1">
            <div
                ref={frameRef}
                className="relative overflow-hidden rounded-md border border-edge bg-surface-sunken"
                style={{
                    // A page with no usable design size still gets a box, because the box is where
                    // the reason it could not be drawn is written.
                    width: size ? Math.round(size.width * scale) : UNSIZED_FRAME.width,
                    height: size ? Math.round(size.height * scale) : UNSIZED_FRAME.height,
                }}
            >
                {drawable
                    ? (
                        <ErrorBoundary
                            // Remounted per page, so a page that could not be drawn does not leave
                            // the next one blank as well. Deliberately NOT keyed on the scale: a
                            // resize would then rebuild the whole element tree on every pixel.
                            key={surfaceId}
                            fallback={NotDrawn}
                        >
                            <GameSurfaceRenderer
                                document={document as UIDocument}
                                surface={surface}
                                rendererRegistry={RENDERER_REGISTRY}
                                scale={scale}
                                hostAdapter={hostAdapter}
                                // Display-only, three ways: no widget takes a pointer event, the
                                // shell does not either, and the element tree is memoised because
                                // this document cannot change. `interactive` is deliberately left
                                // on - it is what puts `data-ui-element-id` on a wrapper, and with
                                // no blueprint runtime and no widget runtime store behind it there
                                // is nothing for an event to reach anyway.
                                passive
                                staticDocument
                                surfacePointerEvents="none"
                            />
                        </ErrorBoundary>
                    )
                    : <NotDrawn />}

                <div className="pointer-events-none absolute inset-0">
                    {masks.map(mask => {
                        const box = boxes.get(mask.index);
                        if (!box) {
                            return null;
                        }
                        return (
                            <button
                                key={mask.index}
                                type="button"
                                onClick={() => onSelect(mask.index)}
                                aria-label={t("documentDiff.canvas.markLabel")}
                                data-change-mask={mask.tone}
                                data-change-index={mask.index}
                                className={cn(
                                    // `nl-focus-ring` rather than a ring utility: `styles.css`
                                    // clears box-shadow on every focused native control.
                                    "nl-focus-ring pointer-events-auto absolute border",
                                    CHANGE_MASK_CLASS[mask.tone],
                                    selected === mask.index && "outline outline-2 outline-offset-1 outline-primary",
                                )}
                                style={{
                                    left: box.left,
                                    top: box.top,
                                    // Never invisible: a 1px text element that changed is still a
                                    // thing the author has to be able to find and click.
                                    width: Math.max(box.width, MIN_MASK_SIZE),
                                    height: Math.max(box.height, MIN_MASK_SIZE),
                                }}
                            />
                        );
                    })}
                </div>
            </div>
            <CanvasColumn caption={props.caption} detail={size ? `${size.width} × ${size.height}` : null} />
        </figure>
    );
}

/**
 * A column with no picture in it.
 *
 * One component for both ways that happens - the page is not in this version's document, and the
 * renderer threw on it - because from where the author sits they are the same fact: this version of
 * the page is not on screen. Which of the two it was is a thing only a log can tell apart, and
 * making the author read two sentences to learn the same thing is how a surface gets wordy.
 */
function NotDrawn() {
    const { t } = useTranslation();
    return (
        <span className="absolute inset-0 grid place-items-center px-2 text-center text-2xs text-fg-muted">
            {t("documentDiff.canvas.notDrawn")}
        </span>
    );
}

/** The smallest a mark may be drawn, so an element with no size is still findable. */
const MIN_MASK_SIZE = 6;

/** The box a page with no readable design size gets, so its reason has somewhere to be. */
const UNSIZED_FRAME = { width: 160, height: 90 };

interface MaskBox {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

const EMPTY_BOXES: ReadonlyMap<number, MaskBox> = new Map();
const NO_INDICES: readonly number[] = [];

/**
 * One element's box inside the frame, or null when the page has no handle on it.
 *
 * Null is a real answer and the caller reports it. Content inside a component instance is the
 * expected case - it carries no id, on purpose - and an element hidden by its own `visible: false`
 * is another.
 */
function elementBox(frame: HTMLElement, bounds: DOMRect, elementId: string): MaskBox | null {
    const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(elementId)
        : elementId.replace(/["\\]/g, "\\$&");
    const node = frame.querySelector(`[data-ui-element-id="${escaped}"]`);
    if (!(node instanceof HTMLElement)) {
        return null;
    }
    const rect = node.getBoundingClientRect();
    return {
        left: rect.left - bounds.left,
        top: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
    };
}

function sameBoxes(left: ReadonlyMap<number, MaskBox>, right: ReadonlyMap<number, MaskBox>): boolean {
    if (left.size !== right.size) {
        return false;
    }
    for (const [index, box] of left) {
        const other = right.get(index);
        if (!other || other.left !== box.left || other.top !== box.top
            || other.width !== box.width || other.height !== box.height) {
            return false;
        }
    }
    return true;
}

function findSurface(document: UIDocument | null, surfaceId: string): UISurface | null {
    const surfaces = Array.isArray(document?.surfaces) ? (document?.surfaces as UISurface[]) : [];
    return surfaces.find(surface => surface?.id === surfaceId) ?? null;
}

/**
 * One registry for every column and every selection.
 *
 * A module constant rather than a memo per mount: it is a table of the built-in widget renderers
 * with no state in it, and building one per column would build one on every resize.
 */
const RENDERER_REGISTRY = new ElementRendererRegistry(BuiltinElementRenderers);

export const uiDocumentChangePresenter: ChangePresenter = {
    id: "ui-document",
    matches: (entry: DocumentDiffEntry) => entry.documentKind === "ui-document",
    Detail: UIDocumentChangeDetail,
};

// Registered on import, and imported for that effect by `ChangeDetailHost`.
registerChangePresenter(uiDocumentChangePresenter);
