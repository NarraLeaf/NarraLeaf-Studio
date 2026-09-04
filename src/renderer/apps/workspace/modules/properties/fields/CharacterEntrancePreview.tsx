import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { StoryTransformProps } from "@shared/types/story";
import { storyTransformPropsToNlr } from "@shared/story/transformProps";
import { useTranslation } from "@/lib/i18n";
import { SampleSubject } from "@/lib/story/previewSubject";
import { useCompositedSprite } from "@/lib/workspace/hooks/useCompositedSprite";
import type { Character } from "@/lib/workspace/services/character/Character";

/** Longest edge of the composite asked for; the preview box is never wider than this. */
const SPRITE_COMPOSITE_PX = 512;
/** Screen pixels of horizontal drag per 1.0 of zoom - the sensitivity the Story Motion stage uses. */
const ZOOM_DRAG_PX = 180;
/** A stage a sprite is placed on is 0-1 in each axis; past that she is off the world. */
function clampAlign(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * This character on the stage, at the defaults her entrances fall back to.
 *
 * The numbers this field edits are not readable as numbers: `zoom 0.5353` is what undoes the
 * engine's `autoFit` for one particular piece of artwork, and `yalign 0.0989` is where that
 * artwork's feet land. An author can only get them by measuring the picture - which is the whole
 * reason they were being copied from row to row. So they are drawn instead: place her by dragging,
 * and read the numbers off the channel list underneath.
 *
 * **The mapping is the runtime's, not an approximation.** `autoFit` sizes a character to the full
 * stage width and takes only the aspect ratio from the artwork; `xalign`/`yalign` are percentages of
 * the stage with the origin at the bottom left, centred by a `-50%/+50%` translate; `zoom`
 * multiplies both scale axes. Same three rules the Story Motion stage and the camera viewfinder
 * draw with - see `nlr-displayable-css-mapping` for where each is verified against the engine.
 *
 * A drag writes nothing until it is released. The pose is rendered from a local draft while the
 * pointer is down, so one placement is one entry in the undo history rather than one per frame -
 * the rule `useSliderDraft` exists for.
 */
export function CharacterEntrancePreview(props: {
    character: Character;
    value: StoryTransformProps | undefined;
    stageSize: { width: number; height: number };
    onCommit: (next: StoryTransformProps) => void;
}) {
    const { t } = useTranslation();
    const boxRef = useRef<HTMLDivElement | null>(null);
    const [draft, setDraft] = useState<StoryTransformProps | null>(null);
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
    const shown = draft ?? props.value;

    // Her own picture, composited the way the editor's other previews get one - a preset character's
    // default pose, a layered character's default tag on every axis. A runtime-drawn character has no
    // picture to composite (the backend draws her at play time), and falls back to the sample figure:
    // the placement is still hers, and it is the placement this box is for.
    const sprite = useCompositedSprite(props.character, {}, SPRITE_COMPOSITE_PX);

    const nlr = useMemo(() => storyTransformPropsToNlr(shown), [shown]);
    const zoom = typeof nlr.zoom === "number" ? nlr.zoom : 1;
    const scaleX = typeof nlr.scaleX === "number" ? nlr.scaleX : 1;
    const scaleY = typeof nlr.scaleY === "number" ? nlr.scaleY : 1;
    const rotation = typeof nlr.rotation === "number" ? nlr.rotation : 0;
    const xalign = shown?.position?.xalign ?? 0.5;
    const yalign = shown?.position?.yalign ?? 0.5;

    const frameStyle = useMemo<CSSProperties>(() => ({
        left: `${xalign * 100}%`,
        bottom: `${yalign * 100}%`,
        transform: `translate(-50%, 50%) rotate(${rotation}deg) scale(${zoom * scaleX}, ${zoom * scaleY})`,
        // `autoFit`, which a character always has: the full stage width, the artwork's aspect ratio.
        width: "100%",
        ...(naturalSize ? { aspectRatio: `${naturalSize.width} / ${naturalSize.height}` } : { aspectRatio: "2 / 3" }),
        opacity: typeof nlr.opacity === "number" ? nlr.opacity : 1,
        filter: typeof nlr.filter === "string" ? nlr.filter : undefined,
        mixBlendMode: nlr.mixBlendMode as CSSProperties["mixBlendMode"],
        clipPath: typeof nlr.clipPath === "string" ? nlr.clipPath : undefined,
    }), [naturalSize, nlr, rotation, scaleX, scaleY, xalign, yalign, zoom]);

    const withProps = useCallback((patch: StoryTransformProps): StoryTransformProps => ({
        ...(props.value ?? {}),
        ...patch,
    }), [props.value]);

    const placeAt = useCallback((event: ReactPointerEvent<HTMLDivElement>): StoryTransformProps | null => {
        const rect = boxRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            return null;
        }
        return withProps({
            position: {
                ...(props.value?.position ?? {}),
                xalign: Number(clampAlign((event.clientX - rect.left) / rect.width).toFixed(4)),
                // Measured up from the bottom, matching the engine's default origin.
                yalign: Number(clampAlign(1 - (event.clientY - rect.top) / rect.height).toFixed(4)),
            },
        });
    }, [props.value?.position, withProps]);

    const dragPlacement = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        setDraft(placeAt(event));
    }, [placeAt]);

    const startZoomDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startZoom = zoom;
        let latest: StoryTransformProps | null = null;
        const onMove = (moveEvent: PointerEvent) => {
            latest = withProps({
                zoom: Number(Math.max(0.05, startZoom + (moveEvent.clientX - startX) / ZOOM_DRAG_PX).toFixed(4)),
            });
            setDraft(latest);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setDraft(null);
            if (latest) {
                props.onCommit(latest);
            }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [props, withProps, zoom]);

    return (
        <div
            ref={boxRef}
            className="relative w-full cursor-crosshair overflow-hidden rounded-md border border-edge bg-surface-canvas"
            style={{ aspectRatio: `${props.stageSize.width} / ${props.stageSize.height}` }}
            data-tip={t("characters.properties.entranceDrag")}
            onPointerDown={dragPlacement}
            onPointerMove={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    setDraft(placeAt(event));
                }
            }}
            onPointerUp={() => {
                if (draft) {
                    props.onCommit(draft);
                }
                setDraft(null);
            }}
        >
            {/* The floor. A character's baseline is read against it, so it is the one piece of
                furniture this box needs - a dialogue bar would only cover the answer. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-edge" />
            <div className="pointer-events-none absolute" style={frameStyle}>
                {sprite.url ? (
                    <img
                        src={sprite.url}
                        alt=""
                        className="h-full w-full object-contain"
                        draggable={false}
                        onLoad={event => setNaturalSize({
                            width: event.currentTarget.naturalWidth || 1,
                            height: event.currentTarget.naturalHeight || 1,
                        })}
                    />
                ) : (
                    <SampleSubject />
                )}
            </div>
            <div
                className="absolute bottom-1 right-1 h-4 w-4 cursor-ew-resize rounded-md border border-edge-strong bg-primary"
                onPointerDown={startZoomDrag}
                data-tip={t("characters.properties.entranceZoom")}
            />
        </div>
    );
}
