/**
 * The stage timeline's drawing: lane names on the left, the ruler and lanes beside them, scrolling
 * sideways.
 *
 * Every column is one row that runs, with a hairline between columns. A row of stage work is a
 * narrow column and a line is as wide as its words need, and a press anywhere in a column moves the
 * editor to its row. Columns stretch to fill a wider panel; lanes keep their height, and a taller
 * panel carries the column lines on down below them.
 *
 * Comments in English per project convention.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, GitBranch, Image, ImagePlay, ListOrdered, MessageSquareText, Music, Sparkles, Type, User, Video, Volume2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import { useCharacterAvatar } from "../story/scene-editor/storyCharacterFace";
import type { Character } from "@/lib/workspace/services/character/Character";
import { Button, ContextMenu, PanelHeader, Slider, type ContextMenuDef } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import type { StoryBlockId, StoryScene } from "@shared/types/story";
import {
    type StageTimelineCell,
    type StageTimelineColumn,
    type StageTimelineLane,
    type StageTimelineModel,
    type StageTimelineSprite,
    type StageTimelineTiming,
} from "./stageTimelineModel";

export type StageTimelineLanePaint = { className: string; style: CSSProperties };

const RULER_PX = 24;
/** The dialogue strip keeps this height; it is words to read, not a lane to stretch. */
const DIALOGUE_PX = 32;
const LANE_PX = 40;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** The closest two ruler labels are allowed to sit. */
const RULER_LABEL_GAP_PX = 44;
/** Room one row number takes on the ruler. */
const RULER_NUMBER_PX = 24;
/** The scrollbar slot a scroller keeps (`::-webkit-scrollbar` in styles.css). */
const SCROLLBAR_PX = 8;

export function StageTimelineView(props: {
    scene: StoryScene;
    model: StageTimelineModel;
    columns: readonly StageTimelineColumn[];
    cursorColumn: number;
    /** Number every row on the ruler, not only the ones that say something. */
    showAllRows: boolean;
    onShowAllRowsChange: (showAllRows: boolean) => void;
    zoom: number;
    onZoomChange: (zoom: number) => void;
    paints: ReadonlyMap<string, StageTimelineLanePaint>;
    /** The cast, for composing a character's look into its blocks' previews. */
    characters: readonly Character[];
    onStepTo: (blockId: StoryBlockId) => void;
    onPick: (choiceId: StoryBlockId, optionId: StoryBlockId) => void;
}) {
    const { scene, model, cursorColumn, zoom, onZoomChange, paints, onStepTo } = props;
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
    // Lanes keep their height; below them the column lines run on to the bottom of the panel. A track that
    // scrolls sideways keeps its scrollbar's slot out of that.
    const scrollbar = totalWidth > room.width + 0.5 ? SCROLLBAR_PX : 0;
    const laneHeight = LANE_PX;
    const lanesHeight = model.lanes.length * laneHeight;
    const trackHeight = Math.max(RULER_PX + DIALOGUE_PX + lanesHeight, room.height - scrollbar);

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
                <ToolbarButton
                    size="sm"
                    active={props.showAllRows}
                    aria-label={t("story.timeline.showAllRows")}
                    aria-pressed={props.showAllRows}
                    data-tip={t("story.timeline.showAllRows")}
                    onClick={() => props.onShowAllRowsChange(!props.showAllRows)}
                >
                    <ListOrdered className="h-4 w-4" />
                </ToolbarButton>
                {/* The slider fills whatever holds it; the box is what keeps it short. */}
                <div className="flex w-28 shrink-0 items-center">
                    <Slider
                        value={zoom}
                        min={MIN_ZOOM}
                        max={MAX_ZOOM}
                        step="any"
                        onValueChange={onZoomChange}
                        aria-label={t("story.timeline.zoom")}
                        data-tip={t("story.timeline.zoom")}
                        className="w-full"
                    />
                </div>
                {/* Reads the zoom and puts it back to where the timeline started. */}
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("story.timeline.resetZoom")}
                    data-tip={t("story.timeline.resetZoom")}
                    className="w-14 shrink-0 px-0 tabular-nums"
                    onClick={() => onZoomChange(1)}
                >
                    {`${Math.round(zoom * 100)}%`}
                </Button>
            </PanelHeader>
            {/* The names and the track scroll down together. They sit in a row of their own so the row
                is as tall as its lanes: a scroller that is itself the row would squeeze the track to
                the visible height and clip the lanes below it. */}
            <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex min-h-full">
                    <div className="flex w-32 shrink-0 flex-col border-r border-edge-subtle">
                        <div style={{ height: RULER_PX }} className="border-b border-edge" />
                        <div style={{ height: DIALOGUE_PX }} className="flex items-center gap-2 px-3 text-fg-muted">
                            <MessageSquareText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="min-w-0 truncate">{t("story.timeline.lane.dialogue")}</span>
                        </div>
                        {model.lanes.map(lane => (
                            <div key={lane.id} style={{ height: laneHeight }} className="flex items-center gap-2 px-3 text-fg-muted">
                                <LaneMark lane={lane} paint={paints.get(lane.id)} />
                                <span className="min-w-0 truncate">{laneName(lane, t)}</span>
                            </div>
                        ))}
                    </div>
                    <div ref={trackRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
                        <div className="relative" style={{ width: totalWidth, height: trackHeight }}>
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
                            <Ruler model={model} columns={columns} showAllRows={props.showAllRows} />
                            <DialogueStrip model={model} columns={columns} />
                            <div className="absolute left-0 right-0" style={{ top: RULER_PX + DIALOGUE_PX }}>
                                {model.lanes.map(lane => (
                                    <LaneTrack key={lane.id} lane={lane} columns={columns} height={laneHeight} paint={paints.get(lane.id)} characters={props.characters} />
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

/** Lanes that carry a tint of their own; the rest are neutral. */
const LANE_TINTS: Partial<Record<StageTimelineLane["kind"], string>> = {
    background: "border-success/50 bg-success/15",
    music: "border-primary/60 bg-primary/20",
};

const LANE_ICONS = {
    background: Image,
    character: User,
    image: ImagePlay,
    text: Type,
    vfx: Sparkles,
    camera: Video,
    music: Music,
    sound: Volume2,
} as const;

/**
 * A block's picture and name. A block with a picture has it laid along its left end, fading into the
 * block's own colour, with the name over the fade: a character's face in the look the block shows, a
 * background or image as it is. A block with none (a track, a camera pose, a colour) leads its
 * name with its lane's icon, as it does while the picture loads.
 */
function BlockContent(props: {
    lane: StageTimelineLane;
    cell: StageTimelineCell;
    label: string | null;
    characters: readonly Character[];
    left: number;
    width: number;
    /** The block's inner height, which a picture fills. */
    height: number;
}) {
    const { lane, cell } = props;
    const character = cell.sprite ? props.characters.find(candidate => candidate.profile.getId() === cell.sprite?.characterId) : undefined;
    return (
        <span
            className="pointer-events-none absolute top-1 bottom-1 overflow-hidden rounded-l-md text-2xs"
            style={{ left: props.left, width: props.width }}
        >
            {character ? (
                <CharacterBackdrop
                    lane={lane}
                    character={character}
                    sprite={cell.sprite!}
                    label={props.label}
                    height={props.height}
                    width={props.width}
                />
            ) : (
                <ImageBackdrop lane={lane} assetId={cell.image} label={props.label} height={props.height} width={props.width} />
            )}
        </span>
    );
}

/**
 * The composite a face of `size` CSS pixels is cut from. A head is about a quarter of a standing
 * sprite's height, so the whole sprite needs four times the face, at the screen's density. Rounded up
 * to a step so a panel being resized does not composite again at every pixel.
 */
function compositeSizeFor(size: number): number {
    const wanted = size * 4 * (window.devicePixelRatio || 1);
    return Math.min(1024, Math.ceil(wanted / 128) * 128);
}

/** A picture's share of the block: as wide as its shape at the block's height, never past the block. */
const BACKGROUND_ASPECT = 16 / 9;
const FADE_MASK = "linear-gradient(to right, black 35%, transparent)";

function Backdrop(props: { width: number; label: string | null; children: ReactNode }) {
    return (
        <>
            <span
                className="absolute inset-y-px left-px overflow-hidden rounded-l-md"
                style={{ width: props.width, maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
            >
                {props.children}
            </span>
            {props.label ? (
                <span className="relative flex h-full items-center pr-1.5" style={{ paddingLeft: props.width * 0.85 + 10 }}>
                    <span className="truncate">{props.label}</span>
                </span>
            ) : null}
        </>
    );
}

function IconLabel({ lane, label }: { lane: StageTimelineLane; label: string | null }) {
    return (
        <span className="flex h-full items-center gap-1 px-1.5">
            <LaneIcon lane={lane} />
            {label ? <span className="truncate">{label}</span> : null}
        </span>
    );
}

function CharacterBackdrop(props: {
    lane: StageTimelineLane;
    character: Character;
    sprite: StageTimelineSprite;
    label: string | null;
    height: number;
    width: number;
}) {
    // The face in the look this block shows, cut by the same frame the Characters panel cuts its
    // avatar with: the pose's own frame, else the character's.
    const size = Math.min(props.height, props.width);
    const { url, frame, showingSprite } = useCharacterAvatar(props.character, {
        pose: props.sprite.poseId,
        tags: props.sprite.tags,
        resolveVariant: true,
        compositePx: compositeSizeFor(size),
    });
    if (!url) {
        return <IconLabel lane={props.lane} label={props.label} />;
    }
    return (
        <Backdrop width={size} label={props.label}>
            {showingSprite
                ? <HeadThumbnail url={url} alt="" frame={frame} className="h-full w-full" iconClassName="h-3 w-3" />
                : <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />}
        </Backdrop>
    );
}

function ImageBackdrop(props: { lane: StageTimelineLane; assetId: string | null; label: string | null; height: number; width: number }) {
    const { url } = useAssetObjectUrl(props.assetId);
    if (!url) {
        return <IconLabel lane={props.lane} label={props.label} />;
    }
    return (
        <Backdrop width={Math.min(props.height * BACKGROUND_ASPECT, props.width)} label={props.label}>
            <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
        </Backdrop>
    );
}

function LaneIcon({ lane }: { lane: StageTimelineLane }) {
    const Icon = LANE_ICONS[lane.kind];
    return <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />;
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
    const Icon = LANE_ICONS[lane.kind];
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
        const touching = previous !== undefined && previous.end === index - 1;
        if (touching && previous.label === cell.label) {
            previous.end = index;
            return;
        }
        pieces.push({ start: index, end: index, label: cell.label, opens: !touching });
    });
    return pieces;
}

function LaneTrack({ lane, columns, height, paint, characters }: {
    lane: StageTimelineLane;
    columns: readonly StageTimelineColumn[];
    height: number;
    paint?: StageTimelineLanePaint;
    characters: readonly Character[];
}) {
    const pieces = useMemo(() => lanePieces(lane), [lane]);
    // A block is one name: it starts where the lane enters or the name changes, and ends where the
    // lane leaves or the name changes again. A change that keeps the name (a move, a new zoom) is a
    // mark on the block, not a new block.
    const named = pieces.map((piece, index) => piece.opens || piece.label !== pieces[index - 1]?.label);
    const geometry = pieces.map((piece, index) => {
        const left = columns[piece.start].x;
        const right = columns[piece.end].x + columns[piece.end].width;
        const opens = named[index];
        const leaves = piece.end + 1 >= lane.cells.length || !lane.cells[piece.end + 1].present;
        const closes = leaves || named[index + 1] === true;
        const inset = opens ? 1 : 0;
        return { left: left + inset, width: Math.max(2, right - left - inset - (closes ? 1 : 0)), opens, closes, named: opens };
    });
    const nodes: ReactNode[] = [];
    const labels: ReactNode[] = [];
    pieces.forEach((piece, index) => {
        const { left, width, opens, closes, named } = geometry[index];
        if (lane.kind === "sound") {
            nodes.push(
                <div key={`${piece.start}`} className="absolute" style={{ left, width, top: 0, bottom: 0 }}>
                    {named && piece.label ? (
                        <span className="absolute left-0.5 top-0.5 flex max-w-full items-center gap-1 text-2xs text-fg-subtle">
                            <LaneIcon lane={lane} />
                            <span className="truncate">{piece.label}</span>
                        </span>
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
                    opens ? "rounded-l-md" : "border-l-0",
                    closes ? "rounded-r-md" : "border-r-0",
                    character ? paint.className : LANE_TINTS[lane.kind] ?? "border-edge-strong bg-fill",
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
        if (named) {
            // A name runs on over the pieces after it to the end of its block, so a state that is
            // marked again a column later is still named in full.
            let last = index;
            while (!geometry[last].closes && geometry[last + 1] && !geometry[last + 1].named) {
                last += 1;
            }
            const end = geometry[last].left + geometry[last].width;
            labels.push(
                <BlockContent
                    key={`${piece.start}-label`}
                    lane={lane}
                    cell={lane.cells[piece.start]}
                    label={piece.label}
                    characters={characters}
                    left={left}
                    width={end - left}
                    height={height - 8}
                />,
            );
        }
    });
    // A row that changed the lane but kept its name, at its place in its column, on the bar's top
    // edge (`top-1`) clear of the name centred in the bar.
    const marks = lane.marks.map((mark, index) => (
        <span
            key={`mark-${index}`}
            className="absolute h-2 w-2 border border-fg-muted bg-surface"
            style={{ left: columns[mark.column].x + mark.at * columns[mark.column].width - 4, top: 0, transform: "rotate(45deg)" }}
        />
    ));
    return (
        <div className="relative border-b border-edge-subtle" style={{ height }}>
            {nodes}
            {labels}
            {marks}
        </div>
    );
}

/**
 * What each row says, along the top of the lanes. A line runs on over the rows after it that say
 * nothing (commands, menus) until the next line, so a short column still reads as a sentence.
 */
function DialogueStrip({ model, columns }: { model: StageTimelineModel; columns: readonly StageTimelineColumn[] }) {
    const nodes: ReactNode[] = [];
    model.lines.forEach((line, index) => {
        if (line === null) {
            return;
        }
        let next = index + 1;
        while (next < model.lines.length && model.lines[next] === null) {
            next += 1;
        }
        const left = columns[index].x;
        const right = next < columns.length ? columns[next].x : columns[columns.length - 1].x + columns[columns.length - 1].width;
        nodes.push(
            <span
                key={index}
                className="absolute inset-y-0 flex items-center px-1.5 text-2xs text-fg-muted"
                style={{ left, width: right - left }}
            >
                <span className="truncate">{line}</span>
            </span>,
        );
    });
    return (
        <div className="absolute left-0 right-0" style={{ top: RULER_PX, height: DIALOGUE_PX }}>
            {nodes}
        </div>
    );
}

function Ruler({ model, columns, showAllRows }: {
    model: StageTimelineModel;
    columns: readonly StageTimelineColumn[];
    showAllRows: boolean;
}) {
    const labels = useMemo(() => {
        const result: { x: number; text: string }[] = [];
        // A number over every row that says something - the script's lines - and, with every row
        // numbered, over the stage work between them too. A number that would run into the one
        // before it is left out.
        let lastEnd = -Infinity;
        model.lines.forEach((line, index) => {
            if ((line === null && !showAllRows) || columns[index].x < lastEnd) {
                return;
            }
            result.push({ x: columns[index].x, text: String(model.lineNumbers[index]) });
            lastEnd = columns[index].x + RULER_NUMBER_PX;
        });
        // A menu's branch button sits on the ruler; a label under it would show only its last digit.
        const buttons = model.choices.map(choice => choiceButtonLeft(columns[choice.column]));
        return result.filter(label => !buttons.some(x => label.x + 3 < x + 24 && label.x + 3 + RULER_LABEL_GAP_PX * 0.75 > x));
    }, [columns, model.choices, model.lineNumbers, model.lines, showAllRows]);

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

/** A menu's branch button, centred in the menu's column. */
function choiceButtonLeft(column: StageTimelineColumn): number {
    return column.x + Math.max(0, (column.width - 24) / 2);
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
                if (choice.optionBlockIds.length < 2) {
                    return null;
                }
                const column = columns[choice.column];
                return (
                    <ToolbarButton
                        key={choice.choiceBlockId}
                        size="xs"
                        aria-label={t("story.timeline.chooseBranch")}
                        data-tip={t("story.timeline.chooseBranch")}
                        className="absolute top-0 z-20 bg-surface text-fg-muted"
                        style={{ left: choiceButtonLeft(column) }}
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
