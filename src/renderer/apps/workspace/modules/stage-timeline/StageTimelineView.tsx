/**
 * The stage timeline's drawing: lane names on the left, the ruler and lanes beside them, scrolling
 * sideways.
 *
 * Every column is one row that runs, with a hairline between columns. A column is as wide as the
 * layout says - all the same, or as long as the row takes - and a press anywhere in it moves the
 * editor to its row. The track never leaves room unused: columns stretch to fill a wider panel and
 * lanes grow to fill a taller one.
 *
 * Comments in English per project convention.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, GitBranch, Image, ImagePlay, Music, Sparkles, Type, Video, Volume2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { ContextMenu, PanelHeader, Select, type ContextMenuDef } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import type { StoryBlockId, StoryScene } from "@shared/types/story";
import {
    STAGE_TIMELINE_SECOND_PX,
    type StageTimelineColumn,
    type StageTimelineLane,
    type StageTimelineLayoutMode,
    type StageTimelineModel,
    type StageTimelineTiming,
} from "./stageTimelineModel";

export type StageTimelineLanePaint = { className: string; style: CSSProperties };

const RULER_PX = 24;
const LANE_PX = 28;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** The closest two ruler labels are allowed to sit. */
const RULER_LABEL_GAP_PX = 44;
/** The scrollbar slot a scroller keeps (`::-webkit-scrollbar` in styles.css). */
const SCROLLBAR_PX = 8;

export function StageTimelineView(props: {
    scene: StoryScene;
    model: StageTimelineModel;
    columns: readonly StageTimelineColumn[];
    cursorColumn: number;
    layout: StageTimelineLayoutMode;
    onLayoutChange: (layout: StageTimelineLayoutMode) => void;
    zoom: number;
    onZoomChange: (zoom: number) => void;
    paints: ReadonlyMap<string, StageTimelineLanePaint>;
    onStepTo: (blockId: StoryBlockId) => void;
    onPick: (choiceId: StoryBlockId, optionId: StoryBlockId) => void;
}) {
    const { scene, model, cursorColumn, layout, zoom, onZoomChange, paints, onStepTo } = props;
    const { t } = useTranslation();
    const trackRef = useRef<HTMLDivElement | null>(null);
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const room = useRoom(trackRef, scrollerRef);

    // Columns narrower in total than the track stretch, in proportion, to fill it.
    const baseWidth = columnsWidth(props.columns);
    const fill = baseWidth > 0 && room.width > baseWidth ? room.width / baseWidth : 1;
    const columns = useMemo(
        () => (fill === 1 ? props.columns : props.columns.map(column => ({ x: column.x * fill, width: column.width * fill }))),
        [fill, props.columns],
    );
    const totalWidth = columnsWidth(columns);
    // Lanes share the height below the ruler, never shorter than their own row height. A track that
    // scrolls sideways gives its scrollbar's slot back first.
    const scrollbar = totalWidth > room.width + 0.5 ? SCROLLBAR_PX : 0;
    const laneHeight = model.lanes.length > 0
        ? Math.max(LANE_PX, Math.floor((room.height - RULER_PX - scrollbar) / model.lanes.length))
        : LANE_PX;
    const lanesHeight = model.lanes.length * laneHeight;

    // Ctrl/Cmd + wheel zooms the track, as it zooms the stage preview. A native listener: React's
    // wheel handler is passive and cannot keep the page from scrolling.
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    useEffect(() => {
        const element = trackRef.current;
        if (!element) {
            return;
        }
        const onWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) {
                return;
            }
            event.preventDefault();
            const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * Math.exp(-event.deltaY * 0.002)));
            onZoomChange(next);
        };
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
    }, [onZoomChange]);

    // Keep the cursor's column in view when the editor moves it.
    useEffect(() => {
        const element = trackRef.current;
        const column = columns[cursorColumn];
        if (!element || !column) {
            return;
        }
        if (column.x < element.scrollLeft || column.x + column.width > element.scrollLeft + element.clientWidth) {
            element.scrollLeft = Math.max(0, column.x - element.clientWidth / 3);
        }
    }, [columns, cursorColumn]);

    const layoutOptions = useMemo(() => [
        { value: "equal", label: t("story.timeline.layout.equal") },
        { value: "timed", label: t("story.timeline.layout.timed") },
    ], [t]);

    const cursorTiming = model.timings[cursorColumn];

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-xs text-fg">
            <PanelHeader size="sm" className="gap-3 border-b border-edge px-3">
                <span className="min-w-0 truncate text-fg-muted">{scene.name}</span>
                <span className="flex-1" />
                {cursorTiming ? (
                    <span className="shrink-0 text-fg-subtle">
                        {t("story.timeline.row", { index: model.lineNumbers[cursorColumn] })}
                        {" · "}
                        {describeTiming(cursorTiming, t)}
                    </span>
                ) : null}
                <Select
                    size="sm"
                    options={layoutOptions}
                    value={layout}
                    onChange={value => props.onLayoutChange(value === "timed" ? "timed" : "equal")}
                    className="w-28 shrink-0"
                />
            </PanelHeader>
            {/* The names and the track scroll down together. They sit in a row of their own so the row
                is as tall as its lanes: a scroller that is itself the row would squeeze the track to
                the visible height and clip the lanes below it. */}
            <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex min-h-full">
                    <div className="w-32 shrink-0 border-r border-edge-subtle">
                        <div style={{ height: RULER_PX }} className="border-b border-edge" />
                        {model.lanes.map(lane => (
                            <div key={lane.id} style={{ height: laneHeight }} className="flex items-center gap-2 px-3 text-fg-muted">
                                <LaneMark lane={lane} paint={paints.get(lane.id)} />
                                <span className="min-w-0 truncate">{laneName(lane, t)}</span>
                            </div>
                        ))}
                    </div>
                    <div ref={trackRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
                        <div className="relative" style={{ width: totalWidth, height: RULER_PX + lanesHeight }}>
                            {columns.map((column, index) => (
                                <div
                                    key={index}
                                    className="pointer-events-none absolute top-0 bottom-0 border-l border-edge-subtle"
                                    style={{ left: column.x }}
                                />
                            ))}
                            {columns[cursorColumn] ? (
                                <div
                                    className="pointer-events-none absolute top-0 bottom-0 border-l border-primary bg-primary/15"
                                    style={{ left: columns[cursorColumn].x, width: columns[cursorColumn].width }}
                                />
                            ) : null}
                            <Ruler model={model} columns={columns} layout={layout} zoom={zoom * fill} />
                            <div className="absolute left-0 right-0" style={{ top: RULER_PX }}>
                                {model.lanes.map(lane => (
                                    <LaneTrack key={lane.id} lane={lane} columns={columns} height={laneHeight} paint={paints.get(lane.id)} />
                                ))}
                            </div>
                            {columns.map((column, index) => (
                                <div
                                    key={index}
                                    className="absolute top-0 bottom-0 z-10 hover:bg-fill-subtle"
                                    style={{ left: column.x, width: column.width }}
                                    onMouseDown={event => {
                                        if (event.button === 0) {
                                            onStepTo(model.blockIds[index]);
                                        }
                                    }}
                                />
                            ))}
                            <ChoiceMarks scene={scene} model={model} columns={columns} onPick={props.onPick} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function formatSeconds(ms: number): string {
    return String(Math.round(ms / 100) / 10);
}

function describeTiming(timing: StageTimelineTiming, t: Translate): string {
    switch (timing.source) {
        case "voice":
            return `${t("story.timeline.seconds", { seconds: formatSeconds(timing.durationMs) })} · ${t("story.timeline.source.voice")}`;
        case "estimate":
            return `${t("story.timeline.seconds", { seconds: formatSeconds(timing.durationMs) })} · ${t("story.timeline.source.estimate")}`;
        case "action":
            return t("story.timeline.seconds", { seconds: formatSeconds(timing.durationMs) });
        case "choice":
            return t("story.timeline.source.choice");
        default:
            return t("story.timeline.source.instant");
    }
}

function laneName(lane: StageTimelineLane, t: Translate): string {
    switch (lane.kind) {
        case "background":
            return t("story.timeline.lane.background");
        case "camera":
            return t("story.timeline.lane.camera");
        case "music":
            return t("story.timeline.lane.music");
        default:
            return lane.name;
    }
}

function LaneMark({ lane, paint }: { lane: StageTimelineLane; paint?: StageTimelineLanePaint }) {
    if (lane.kind === "character") {
        return (
            <span
                className={cn("h-2 w-2 shrink-0 rounded-full", paint?.className)}
                style={{ ...paint?.style, backgroundColor: "var(--nl-speaker-disc)" }}
            />
        );
    }
    const Icon = {
        background: Image,
        image: ImagePlay,
        text: Type,
        vfx: Sparkles,
        camera: Video,
        music: Music,
        sound: Volume2,
    }[lane.kind];
    return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}

/** Runs of present cells, each split where a row changed the lane. */
function lanePieces(lane: StageTimelineLane): { start: number; end: number; label: string | null; opens: boolean }[] {
    const pieces: { start: number; end: number; label: string | null; opens: boolean }[] = [];
    lane.cells.forEach((cell, index) => {
        if (!cell.present) {
            return;
        }
        const previous = pieces[pieces.length - 1];
        if (previous && previous.end === index - 1 && !cell.changed) {
            previous.end = index;
            return;
        }
        pieces.push({ start: index, end: index, label: cell.label, opens: !(previous && previous.end === index - 1) });
    });
    return pieces;
}

function LaneTrack({ lane, columns, height, paint }: {
    lane: StageTimelineLane;
    columns: readonly StageTimelineColumn[];
    height: number;
    paint?: StageTimelineLanePaint;
}) {
    const pieces = useMemo(() => lanePieces(lane), [lane]);
    const geometry = pieces.map((piece, index) => {
        const left = columns[piece.start].x;
        const right = columns[piece.end].x + columns[piece.end].width;
        // Pieces of one span touch; only the span's own ends are inset, so a change reads as a mark
        // on one bar rather than as two bars. A change inside a span is not the bar's end: only the
        // column the lane leaves (or the last column) closes it.
        const inset = piece.opens ? 1 : 0;
        const closes = piece.end + 1 >= lane.cells.length || !lane.cells[piece.end + 1].present;
        // A change that keeps the name (a move, a new zoom) is told by its mark; the bar names a state
        // only where the name changes, so a span reads as one word rather than the same word repeated.
        const named = piece.opens || piece.label !== pieces[index - 1]?.label;
        return { left: left + inset, width: Math.max(2, right - left - inset - (closes ? 1 : 0)), closes, named };
    });
    const nodes: ReactNode[] = [];
    const labels: ReactNode[] = [];
    pieces.forEach((piece, index) => {
        const { left, width, closes, named } = geometry[index];
        if (lane.kind === "sound") {
            nodes.push(
                <div key={`${piece.start}`} className="absolute" style={{ left, width, top: 0, bottom: 0 }}>
                    {named && piece.label ? (
                        <span className="absolute left-0.5 top-0.5 max-w-full truncate text-2xs text-fg-subtle">{piece.label}</span>
                    ) : null}
                    <span className="absolute bottom-2 left-0 right-0 h-1 rounded-full bg-fg-subtle" />
                </div>,
            );
            return;
        }
        const character = lane.kind === "character" && paint;
        nodes.push(
            <div
                key={`${piece.start}`}
                className={cn(
                    "absolute top-1 bottom-1 border",
                    piece.opens ? "rounded-l-md" : "border-l-0",
                    closes ? "rounded-r-md" : "border-r-0",
                    character ? paint.className : lane.kind === "music" ? "border-primary/60 bg-primary/20" : "border-edge-strong bg-fill",
                )}
                style={{
                    left,
                    width,
                    ...(character ? {
                        ...paint.style,
                        backgroundColor: "color-mix(in srgb, var(--nl-speaker-disc) 28%, transparent)",
                        borderColor: "var(--nl-speaker-disc)",
                    } : {}),
                }}
            />,
        );
        if (named && piece.label) {
            // A name runs on over the pieces after it until the name changes or the bar ends, so a
            // state that is marked again a column later is still named in full.
            let last = index;
            while (!geometry[last].closes && geometry[last + 1] && !geometry[last + 1].named) {
                last += 1;
            }
            const end = geometry[last].left + geometry[last].width;
            labels.push(
                <span
                    key={`${piece.start}-label`}
                    className="pointer-events-none absolute top-1 bottom-1 flex items-center px-1.5 text-2xs"
                    style={{ left, width: end - left }}
                >
                    <span className="truncate">{piece.label}</span>
                </span>,
            );
        }
        if (!piece.opens) {
            // On the bar's top edge (`top-1`), clear of the name centred in the bar.
            labels.push(
                <span
                    key={`${piece.start}-mark`}
                    className="absolute h-2 w-2 border border-fg-muted bg-surface"
                    style={{ left: left - 4, top: 0, transform: "rotate(45deg)" }}
                />,
            );
        }
    });
    return (
        <div className="relative border-b border-edge-subtle" style={{ height }}>
            {nodes}
            {labels}
        </div>
    );
}

function Ruler({ model, columns, layout, zoom }: {
    model: StageTimelineModel;
    columns: readonly StageTimelineColumn[];
    layout: StageTimelineLayoutMode;
    zoom: number;
}) {
    const labels = useMemo(() => {
        const result: { x: number; text: string }[] = [];
        if (layout === "equal") {
            const width = columns[0]?.width ?? 1;
            const every = niceStep(RULER_LABEL_GAP_PX / width, [1, 2, 5, 10, 20, 50, 100, 200, 500]);
            for (let index = 0; index < columns.length; index += every) {
                result.push({ x: columns[index].x, text: String(model.lineNumbers[index]) });
            }
        } else {
            const everySeconds = niceStep(RULER_LABEL_GAP_PX / (STAGE_TIMELINE_SECOND_PX * zoom), [1, 2, 5, 10, 15, 30, 60, 120, 300]);
            let elapsed = 0;
            let next = 0;
            model.timings.forEach((timing, index) => {
                const end = elapsed + timing.durationMs;
                while (next * 1000 <= end && (timing.durationMs > 0 || next * 1000 === elapsed)) {
                    const fraction = timing.durationMs > 0 ? (next * 1000 - elapsed) / timing.durationMs : 0;
                    result.push({ x: columns[index].x + fraction * columns[index].width, text: formatClock(next) });
                    next += everySeconds;
                }
                elapsed = end;
            });
        }
        // A menu's branch button sits on the ruler; a label under it would show only its last digit.
        const buttons = model.choices
            .map(choice => model.blockIds.indexOf(choice.choiceBlockId))
            .filter(index => index >= 0)
            .map(index => columns[index].x + Math.max(0, (columns[index].width - 24) / 2));
        return result.filter(label => !buttons.some(x => label.x + 3 < x + 24 && label.x + 3 + RULER_LABEL_GAP_PX * 0.75 > x));
    }, [columns, layout, model.blockIds, model.choices, model.lineNumbers, model.timings, zoom]);

    return (
        <div className="absolute left-0 right-0 top-0 border-b border-edge" style={{ height: RULER_PX }}>
            {labels.map((label, index) => (
                <span key={index} className="absolute top-1 text-2xs text-fg-subtle" style={{ left: label.x + 3 }}>
                    {label.text}
                </span>
            ))}
            {model.timings.map((timing, index) => {
                if (timing.source !== "voice" && timing.source !== "estimate") {
                    return null;
                }
                const column = columns[index];
                return (
                    <span
                        key={index}
                        className={cn(
                            "absolute bottom-0.5",
                            timing.source === "voice" ? "h-0.5 rounded-full bg-primary" : "border-t-2 border-dotted border-fg-subtle",
                        )}
                        style={{ left: column.x + 2, width: Math.max(2, column.width - 4) }}
                    />
                );
            })}
        </div>
    );
}

function niceStep(minimum: number, steps: readonly number[]): number {
    return steps.find(step => step >= minimum) ?? steps[steps.length - 1];
}

function formatClock(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A button on the ruler at every menu, listing its options; picking one walks the scene down it. */
function ChoiceMarks({ scene, model, columns, onPick }: {
    scene: StoryScene;
    model: StageTimelineModel;
    columns: readonly StageTimelineColumn[];
    onPick: (choiceId: StoryBlockId, optionId: StoryBlockId) => void;
}) {
    const { t } = useTranslation();
    const [menu, setMenu] = useState<{ choiceId: StoryBlockId; x: number; y: number } | null>(null);
    const items = useMemo((): ContextMenuDef => {
        const choice = menu ? model.choices.find(entry => entry.choiceBlockId === menu.choiceId) : undefined;
        if (!choice) {
            return [];
        }
        return choice.optionBlockIds.map(optionId => {
            const option = scene.blocks[optionId];
            const text = option?.kind === "nodeAction" && option.payload.action === "choiceOption" ? option.payload.text.value : "";
            return {
                id: optionId,
                label: text || t("story.timeline.untitledOption"),
                icon: optionId === choice.takenOptionId ? <Check className="h-3.5 w-3.5" /> : undefined,
                onClick: () => onPick(choice.choiceBlockId, optionId),
            };
        });
    }, [menu, model.choices, onPick, scene.blocks, t]);

    return (
        <>
            {model.choices.map(choice => {
                const index = model.blockIds.indexOf(choice.choiceBlockId);
                if (index < 0 || choice.optionBlockIds.length < 2) {
                    return null;
                }
                const column = columns[index];
                return (
                    <ToolbarButton
                        key={choice.choiceBlockId}
                        size="xs"
                        aria-label={t("story.timeline.chooseBranch")}
                        data-tip={t("story.timeline.chooseBranch")}
                        className="absolute top-0 z-20 bg-surface text-fg-muted"
                        style={{ left: column.x + Math.max(0, (column.width - 24) / 2) }}
                        onClick={event => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setMenu({ choiceId: choice.choiceBlockId, x: rect.left, y: rect.bottom + 2 });
                        }}
                    >
                        <GitBranch className="h-3.5 w-3.5" />
                    </ToolbarButton>
                );
            })}
            {menu ? (
                <ContextMenu items={items} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} iconsEnabled />
            ) : null}
        </>
    );
}

function columnsWidth(columns: readonly StageTimelineColumn[]): number {
    const last = columns[columns.length - 1];
    return last ? last.x + last.width : 0;
}

/** The track's width and the scroller's height, kept current as the panel is resized. */
function useRoom(
    trackRef: RefObject<HTMLDivElement | null>,
    scrollerRef: RefObject<HTMLDivElement | null>,
): { width: number; height: number } {
    const [room, setRoom] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const track = trackRef.current;
        const scroller = scrollerRef.current;
        if (!track || !scroller) {
            return;
        }
        const measure = () => {
            const next = { width: track.clientWidth, height: scroller.clientHeight };
            setRoom(current => (current.width === next.width && current.height === next.height ? current : next));
        };
        measure();
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(track);
        observer.observe(scroller);
        return () => observer.disconnect();
    }, [trackRef, scrollerRef]);
    return room;
}
