import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, Repeat } from "lucide-react";
import type { StoryAnimationAsset, StoryAnimationIndexEntry } from "@shared/types/story";
import { formatStorySecondsLabel } from "@shared/utils/storyTime";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { StoryMotionLoopPreview } from "./StoryMotionLoopPreview";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import { getStoryMotionDurationMs, storyMotionSignatureTimeMs } from "./storyMotionTimeline";

/** What the library knows of a motion's file: read, not read yet, or unreadable. */
export type StoryMotionLibraryLoad =
    | { state: "loading" }
    | { state: "ready"; asset: StoryAnimationAsset }
    | { state: "failed"; reason: string };

/**
 * One motion in the library: the motion on its own preview pictures, its name, and one line saying
 * what it is for and how long it runs.
 *
 * The frame is the asset browser's tile (see `BrowserGrid`'s `TileFrame`), so the two trays read as
 * one kind of library. The picture rests on the motion's most telling frame and plays while the
 * pointer is over it; a grid of motions all playing at once is noise nobody is reading.
 */
export const StoryMotionLibraryTile = memo(function StoryMotionLibraryTile(props: {
    entry: StoryAnimationIndexEntry;
    load: StoryMotionLibraryLoad;
    stageSize: { width: number; height: number };
    /** Width of the picture in pixels; its height follows the stage's shape. */
    pictureWidth: number;
    selected: boolean;
    /** The row the story editor has focused uses this motion. */
    inUse: boolean;
    renaming: boolean;
    onPointerSelect: (id: string, event: React.MouseEvent) => void;
    onOpen: (id: string) => void;
    onContextMenu: (id: string, event: React.MouseEvent) => void;
    onRenameCommit: (id: string, name: string | null) => void;
}) {
    const { t, tn } = useTranslation();
    const { entry, load } = props;
    const [hovered, setHovered] = useState(false);
    const asset = load.state === "ready" ? load.asset : null;
    const timeline = asset?.timeline;
    const restTimeMs = useMemo(() => storyMotionSignatureTimeMs(timeline), [timeline]);
    const target = useMemo(() => resolveStoryMotionPreviewTarget({
        document: null,
        sceneId: undefined,
        blockId: undefined,
        fallbackKind: entry.targetKind,
        fallbackLabel: entry.name,
        previewAssetId: asset?.previewAssetId,
    }), [asset?.previewAssetId, entry.name, entry.targetKind]);
    const { url: backgroundUrl } = useAssetObjectUrl(asset?.previewBackgroundAssetId ?? null);
    const pictureHeight = Math.max(1, Math.round((props.pictureWidth * props.stageSize.height) / props.stageSize.width));
    const repeat = asset?.config?.repeat ?? 0;

    const meta = [
        t(`motion.targetKind.${entry.targetKind}`),
        asset ? formatStorySecondsLabel(getStoryMotionDurationMs(timeline)) : null,
    ].filter(Boolean).join(" · ");

    return (
        <div
            data-motion-tile={entry.id}
            className={cn(
                "relative flex min-w-0 cursor-default flex-col gap-1 rounded-md border p-1.5",
                props.selected ? "border-primary/80 bg-primary/10" : "border-transparent hover:bg-fill",
            )}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={event => props.onPointerSelect(entry.id, event)}
            onDoubleClick={() => props.onOpen(entry.id)}
            onContextMenu={event => props.onContextMenu(entry.id, event)}
        >
            <div
                className="relative overflow-hidden rounded-sm bg-surface-sunken"
                style={{ height: pictureHeight }}
            >
                {asset && props.pictureWidth > 0 ? (
                    <StoryMotionLoopPreview
                        timeline={timeline}
                        target={target}
                        stageSize={props.stageSize}
                        box={{ width: props.pictureWidth, height: pictureHeight }}
                        backgroundUrl={backgroundUrl}
                        active={hovered}
                        restTimeMs={restTimeMs}
                    />
                ) : load.state === "failed" ? (
                    <div className="flex h-full items-center justify-center px-2 text-center text-2xs text-danger" data-tip={load.reason}>
                        {t("motion.library.unreadable")}
                    </div>
                ) : null}
            </div>
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1">
                    {props.renaming ? (
                        <TileRenameField
                            initial={entry.name}
                            onDone={name => props.onRenameCommit(entry.id, name)}
                        />
                    ) : (
                        <p className="min-w-0 flex-1 truncate text-xs text-fg" data-tip={entry.name}>{entry.name}</p>
                    )}
                    {repeat > 0 ? (
                        <span
                            className="flex shrink-0 items-center gap-0.5 text-2xs text-fg-subtle"
                            data-tip={tn("motion.library.repeats", repeat)}
                        >
                            <Repeat className="h-2.5 w-2.5" />
                            {repeat}
                        </span>
                    ) : null}
                    {props.inUse ? (
                        <span className="flex shrink-0 text-primary" data-tip={t("motion.library.inUseTip")}>
                            <Check className="h-3 w-3" />
                        </span>
                    ) : null}
                </div>
                <p className="truncate text-2xs text-fg-subtle">{meta || " "}</p>
            </div>
        </div>
    );
});

/**
 * The name, edited where it is drawn. Enter or leaving the field keeps the new name, Escape keeps the
 * old one; an empty field keeps the old one too.
 */
function TileRenameField(props: { initial: string; onDone: (name: string | null) => void }) {
    const [value, setValue] = useState(props.initial);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const doneRef = useRef(false);
    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);
    const finish = (name: string | null) => {
        if (doneRef.current) {
            return;
        }
        doneRef.current = true;
        props.onDone(name);
    };
    return (
        <input
            ref={inputRef}
            value={value}
            onChange={event => setValue(event.target.value)}
            onClick={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
            onKeyDown={event => {
                event.stopPropagation();
                if (isImeKeyEvent(event)) {
                    return;
                }
                if (event.key === "Enter") {
                    event.preventDefault();
                    finish(value.trim() || null);
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    finish(null);
                }
            }}
            onBlur={() => finish(value.trim() || null)}
            className="min-h-0 w-full min-w-0 flex-1 rounded-sm border border-primary bg-surface-raised px-1 text-xs text-fg outline-none"
        />
    );
}
