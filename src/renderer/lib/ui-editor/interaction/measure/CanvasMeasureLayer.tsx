import { useEffect, useMemo, useState } from "react";
import type { UISurfaceDesignSize } from "@shared/types/ui-editor/document";
import type { ViewportTransform } from "../../geometry/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { ActiveSnapGuides, AxisAlignedRect } from "@/lib/ui-editor/snapping/types";
import { collectSnapCandidateRects } from "@/lib/ui-editor/snapping/collectCandidates";
import { resolveSnapGuideSpans } from "@/lib/ui-editor/snapping/guideSpans";
import { MeasureLabel, SnapGuidesOverlay } from "@/lib/ui-editor/snapping/SnapGuidesOverlay";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import { SELECTABLE_TARGET } from "../constants";
import { resolvePlainPressTarget } from "../containerDrillSelection";
import { formatMeasure, measureBetween, unionScreenRects, type MeasureSegment, type ScreenRect } from "./measureGeometry";
import type { FrameSignal } from "./frameSignal";

const ROOT_WIDGET_TYPE = "nl.root";

/**
 * A measured line shorter than this (screen px) has its label set beside it: its middle is within a
 * handle's reach of the selection's edge, and the handle would cover the number.
 */
const SHORT_SEGMENT_PX = 56;

/** Screen pixels between the selection's lower edge and the size label under it. */
const SIZE_LABEL_GAP_PX = 10;

type Props = {
    surfaceElement: HTMLElement;
    surfaceId: string;
    designSize: UISurfaceDesignSize;
    viewport: ViewportTransform;
    documentService: UIDocumentService;
    stateService: UIEditorStateService;
    documentRevision: number;
    selectionIds: readonly string[];
    primaryId: string | undefined;
    selectedTargets: readonly HTMLElement[];
    snapGuides: ActiveSnapGuides | null;
    snapExcludedElementIds: readonly string[];
    /** Fires on every frame of a move, resize or turn, while the DOM runs ahead of the document. */
    frames: FrameSignal;
    /** The selection frame is the transform one, and nothing is being typed into in place. */
    showSize: boolean;
    /** Alt shows distances; off while another tool or an in-place editor has the canvas. */
    measureEnabled: boolean;
};

/**
 * What the canvas measures over the selection: its size under it, snap guides drawn as far as what
 * they line up (with the gap labelled), and, while Alt is held, the distances to the layer under the
 * pointer - or to the selection's container when the pointer is on nothing else.
 *
 * Everything here is read from the DOM as it is drawn, so it follows a gesture frame by frame; the
 * document only catches up when the gesture ends. A component of its own so those frames re-render
 * just this, not the whole interaction layer.
 */
export function CanvasMeasureLayer(props: Props) {
    const { surfaceElement, viewport, frames, documentRevision } = props;
    const [, setFrame] = useState(0);
    useEffect(() => frames.subscribe(() => setFrame(n => n + 1)), [frames]);
    // The canvas draws a document change in its own render, which may land after this one.
    useEffect(() => {
        const handle = requestAnimationFrame(() => setFrame(n => n + 1));
        return () => cancelAnimationFrame(handle);
    }, [documentRevision]);

    const altTarget = useAltMeasureTarget(props);

    const origin = surfaceElement.getBoundingClientRect();
    const toOverlay = (box: DOMRect): ScreenRect => ({
        left: box.left - origin.left,
        top: box.top - origin.top,
        width: box.width,
        height: box.height,
    });
    const selectionBox = unionScreenRects(props.selectedTargets.filter(t => t.isConnected).map(t => toOverlay(t.getBoundingClientRect())));
    const scale = Math.max(viewport.scale, 1e-4);

    const excludedKey = props.snapExcludedElementIds.join(",");
    const hasGuides = Boolean(props.snapGuides && props.snapGuides.surfaceId === props.surfaceId);
    const candidates = useMemo(
        () =>
            hasGuides
                ? collectSnapCandidateRects(props.documentService.getDocument(), props.surfaceId, new Set(props.snapExcludedElementIds))
                : [],
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the ids' content, not the array
        [hasGuides, excludedKey, documentRevision, props.documentService, props.surfaceId],
    );

    let spans = null;
    if (hasGuides && props.snapGuides && selectionBox) {
        const subject: AxisAlignedRect = {
            x: (selectionBox.left - viewport.offsetX) / scale,
            y: (selectionBox.top - viewport.offsetY) / scale,
            width: selectionBox.width / scale,
            height: selectionBox.height / scale,
        };
        spans = resolveSnapGuideSpans({ guides: props.snapGuides, subject, candidates, designSize: props.designSize });
    }

    let size: { width: number; height: number } | null = null;
    // Not while Alt is measuring: the size is under the selection, right where the distance below it
    // is labelled.
    if (props.showSize && selectionBox && altTarget === undefined) {
        size = props.selectedTargets.length === 1
            ? layoutSizeOf(props.selectedTargets[0])
            : { width: selectionBox.width / scale, height: selectionBox.height / scale };
    }

    let measured: { target: ScreenRect; segments: MeasureSegment[] } | null = null;
    if (altTarget !== undefined && selectionBox) {
        const target = resolveMeasureTargetRect(props, altTarget, toOverlay);
        if (target) {
            measured = { target, segments: measureBetween(selectionBox, target) };
        }
    }

    return (
        <>
            {hasGuides && props.snapGuides ? <SnapGuidesOverlay guides={props.snapGuides} viewport={viewport} spans={spans} /> : null}
            {measured ? <MeasureLines target={measured.target} segments={measured.segments} scale={scale} /> : null}
            {size && selectionBox ? (
                <div
                    data-ui-editor-size-label=""
                    className="pointer-events-none absolute z-[8] whitespace-nowrap rounded-sm bg-primary px-1 font-mono text-2xs leading-4 text-on-primary"
                    style={{
                        left: Math.round(selectionBox.left + selectionBox.width / 2),
                        top: Math.round(selectionBox.top + selectionBox.height + SIZE_LABEL_GAP_PX),
                        translate: "-50% 0",
                    }}
                >
                    {formatMeasure(size.width)} × {formatMeasure(size.height)}
                </div>
            ) : null}
        </>
    );
}

/**
 * An element's own width and height in design pixels: what was set on it while a resize is in
 * progress, the box the canvas laid out otherwise. Not the screen box - that is the turned box's
 * bounds for a rotated element, and zoomed.
 */
function layoutSizeOf(target: HTMLElement): { width: number; height: number } {
    const read = (value: string, laidOut: number) => (value.endsWith("px") ? Number.parseFloat(value) : laidOut);
    return { width: read(target.style.width, target.offsetWidth), height: read(target.style.height, target.offsetHeight) };
}

/**
 * Where the distances are measured to: the layer the pointer is on (`id`), or for `null` the
 * selection's container - the canvas itself when that is the surface's root.
 */
function resolveMeasureTargetRect(props: Props, id: string | null, toOverlay: (box: DOMRect) => ScreenRect): ScreenRect | null {
    const doc = props.documentService.getDocument();
    let targetId = id;
    if (targetId == null && props.primaryId) {
        const parentId = doc.elements[props.primaryId]?.parentId ?? null;
        const parent = parentId ? doc.elements[parentId] : undefined;
        targetId = parent && parent.type !== ROOT_WIDGET_TYPE && !isComponentEditorRootElement(parent) ? parent.id : null;
    }
    if (targetId) {
        const node = props.surfaceElement.querySelector(`[data-ui-element-id="${targetId}"]`);
        return node ? toOverlay(node.getBoundingClientRect()) : null;
    }
    const { scale, offsetX, offsetY } = props.viewport;
    return { left: offsetX, top: offsetY, width: props.designSize.width * scale, height: props.designSize.height * scale };
}

/**
 * The layer Alt is measuring to: its id, `null` for the selection's container, or `undefined` while
 * nothing is being measured (Alt up, a button down, the pointer off the canvas, nothing selected).
 * Picked the way a click would pick - the frame, or a sibling inside the selected container, or with
 * Cmd/Ctrl the deepest layer - so Alt measures to what the hover frame shows.
 */
function useAltMeasureTarget(props: Props): string | null | undefined {
    const { surfaceElement, measureEnabled, documentService, stateService, surfaceId } = props;
    const hasSelection = props.selectionIds.length > 0;
    const [target, setTarget] = useState<string | null | undefined>(undefined);
    useEffect(() => {
        if (!measureEnabled || !hasSelection) {
            setTarget(undefined);
            return undefined;
        }
        const view = surfaceElement.ownerDocument.defaultView;
        const doc = surfaceElement.ownerDocument;
        let pointer: { x: number; y: number; pressed: boolean; deep: boolean } | null = null;
        let alt = false;
        let frame = 0;
        const resolve = () => {
            frame = 0;
            if (!alt || !pointer || pointer.pressed) {
                setTarget(undefined);
                return;
            }
            const bounds = surfaceElement.getBoundingClientRect();
            if (pointer.x < bounds.left || pointer.x > bounds.right || pointer.y < bounds.top || pointer.y > bounds.bottom) {
                setTarget(undefined);
                return;
            }
            const node = doc
                .elementsFromPoint(pointer.x, pointer.y)
                .map(el => el.closest(SELECTABLE_TARGET) as HTMLElement | null)
                .find((el): el is HTMLElement => el != null && surfaceElement.contains(el));
            const hitId = node?.dataset.uiElementId;
            const document = documentService.getDocument();
            if (!hitId || !document.elements[hitId]) {
                setTarget(null);
                return;
            }
            const live = stateService.getSelection();
            const liveData = isUIElementSelection(live) && live.data.surfaceId === surfaceId ? live.data : null;
            const id = pointer.deep ? hitId : resolvePlainPressTarget(document, surfaceId, liveData, hitId);
            setTarget(liveData?.elementIds.includes(id) ? null : id);
        };
        const schedule = () => {
            if (!frame) {
                frame = requestAnimationFrame(resolve);
            }
        };
        const onMove = (event: PointerEvent) => {
            pointer = { x: event.clientX, y: event.clientY, pressed: event.buttons !== 0, deep: event.metaKey || event.ctrlKey };
            alt = event.altKey;
            schedule();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Alt" || event.key === "Meta" || event.key === "Control") {
                alt = event.altKey;
                if (pointer) {
                    pointer = { ...pointer, deep: event.metaKey || event.ctrlKey };
                }
                schedule();
            }
        };
        const onBlur = () => {
            alt = false;
            schedule();
        };
        view?.addEventListener("pointermove", onMove, true);
        view?.addEventListener("pointerdown", onMove, true);
        view?.addEventListener("pointerup", onMove, true);
        view?.addEventListener("keydown", onKey, true);
        view?.addEventListener("keyup", onKey, true);
        view?.addEventListener("blur", onBlur);
        return () => {
            if (frame) {
                cancelAnimationFrame(frame);
            }
            view?.removeEventListener("pointermove", onMove, true);
            view?.removeEventListener("pointerdown", onMove, true);
            view?.removeEventListener("pointerup", onMove, true);
            view?.removeEventListener("keydown", onKey, true);
            view?.removeEventListener("keyup", onKey, true);
            view?.removeEventListener("blur", onBlur);
        };
    }, [documentService, hasSelection, measureEnabled, stateService, surfaceElement, surfaceId]);
    return target;
}

function MeasureLines({ target, segments, scale }: { target: ScreenRect; segments: readonly MeasureSegment[]; scale: number }) {
    return (
        <div className="pointer-events-none absolute inset-0 z-[8]" data-ui-editor-measure="">
            <div className="absolute border border-danger" style={target} />
            {segments.map((segment, i) => {
                const length = segment.to - segment.from;
                const line = segment.axis === "x"
                    ? { left: segment.from, top: Math.round(segment.at), width: length, height: 1 }
                    : { left: Math.round(segment.at), top: segment.from, width: 1, height: length };
                const leader = segment.leader
                    ? segment.axis === "x"
                        ? { left: Math.round(segment.leader.at), top: segment.leader.from, height: segment.leader.to - segment.leader.from }
                        : { top: Math.round(segment.leader.at), left: segment.leader.from, width: segment.leader.to - segment.leader.from }
                    : null;
                const middle = (segment.from + segment.to) / 2;
                return (
                    <div key={i}>
                        <div className="absolute bg-danger" style={line} />
                        {leader ? (
                            <div
                                className={`absolute border-dashed border-danger ${segment.axis === "x" ? "border-l" : "border-t"}`}
                                style={leader}
                            />
                        ) : null}
                        <MeasureLabel
                            x={segment.axis === "x" ? middle : segment.at}
                            y={segment.axis === "x" ? segment.at : middle}
                            value={length / scale}
                            tone="danger"
                            beside={length < SHORT_SEGMENT_PX ? (segment.axis === "x" ? "above" : "right") : undefined}
                        />
                    </div>
                );
            })}
        </div>
    );
}
