/**
 * Row components for the voice table. A row is read-first: it shows the speaker,
 * the spoken line, and — once a clip is linked — a play control, the clip name,
 * and a status. Assignment is import-only: drop an audio asset onto the row, or
 * click to pick one from the library. Every mutating action is a small,
 * hover-revealed control, mirroring the localization table's restraint.
 * Comments in English per project convention.
 */

import { useRef, useState } from "react";
import { Check, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { VoiceUnitState } from "@/lib/workspace/services/voice/voiceModel";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

export type VoiceTableRow = {
    unitId: string;
    /**
     * The line as this voice language's actor reads it - the translation when the project has one,
     * the authored line otherwise. This is the text takes are hashed against, so it is also the text
     * the table has to show: a director comparing a clip to an English line while the actor recorded
     * the Japanese one is comparing the wrong things.
     */
    sourceText: string;
    /** The authored line, carried only so the row can show it when it differs from what is recorded. */
    authoredText?: string;
    sceneId: string;
    sceneName: string;
    role: "narration" | "dialogue" | "choicePrompt" | "choiceText" | "note";
    characterId?: string;
};

type VoiceRowStrings = {
    assign: string;
    replace: string;
    remove: string;
    play: string;
    stop: string;
    approve: string;
    reject: string;
    clipMissing: string;
    outdatedHint: string;
    dropHint: string;
    statusVoiced: string;
    statusApproved: string;
    statusOutdated: string;
    notePlaceholder: string;
};

type VoiceRowProps = {
    row: VoiceTableRow;
    speaker: string;
    state: VoiceUnitState;
    /** Resolved audio asset for the linked clip, or null when the clip is missing / unlinked. */
    asset: Asset | null;
    /** Take length in seconds, measured when the clip was linked; empty when unknown. */
    duration: string;
    /** Direction note carried with the take. */
    note: string;
    mode: "assign" | "audition";
    isPlaying: boolean;
    strings: VoiceRowStrings;
    onTogglePlay: () => void;
    onAssign: (anchor: HTMLElement) => void;
    onRemove: () => void;
    onApprove: () => void;
    onReturn: () => void;
    onDropAsset: (assetId: string) => void;
    onNoteChange: (note: string) => void;
};

const STATUS_DOT: Record<VoiceUnitState, string> = {
    missing: "bg-transparent",
    linked: "bg-primary/60",
    approved: "bg-success",
    stale: "bg-warning",
    // "missing" never renders a dot.
};

export function VoiceRow(props: VoiceRowProps) {
    const { row, speaker, state, asset, mode, isPlaying, strings } = props;
    // Assigning, removing, approving and returning write the locale voice document. Playing the clip
    // and reading the row do not, so auditioning a frozen revision still works.
    const freeze = useFreezeGuard();
    const assignRef = useRef<HTMLButtonElement | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const hasClip = state !== "missing";

    const statusLabel =
        state === "approved" ? strings.statusApproved
            : state === "stale" ? strings.statusOutdated
                : state === "linked" ? strings.statusVoiced
                    : "";

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setDragOver(false);
        const assetId = readAudioAssetId(event.dataTransfer);
        if (assetId) {
            props.onDropAsset(assetId);
        }
    };

    return (
        <div
            className={`group flex items-center gap-3 border-b border-edge-subtle px-4 py-2 text-xs ${
                dragOver ? "bg-primary/10" : ""
            }`}
            // Both halves withheld together while frozen: assigning a clip writes the voice document, and
            // a row that highlights on drag-over and then keeps its old clip would look like a bug.
            onDragOver={freeze.gesture((event: React.DragEvent) => {
                if (readAudioAssetId(event.dataTransfer, true)) {
                    event.preventDefault();
                    setDragOver(true);
                }
            })}
            onDragLeave={() => setDragOver(false)}
            onDrop={freeze.gesture(handleDrop)}
        >
            <span className="w-24 shrink-0 truncate text-2xs text-fg-subtle" data-tip={speaker}>
                {speaker}
            </span>
            <span
                className="min-w-0 flex-1 truncate text-fg"
                data-tip={row.authoredText && row.authoredText !== row.sourceText
                    ? `${row.sourceText}\n${row.authoredText}`
                    : row.sourceText}
            >
                {row.sourceText || "—"}
            </span>

            {hasClip ? (
                <>
                    <button
                        type="button"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-fill hover:text-fg"
                        data-tip={isPlaying ? strings.stop : strings.play} aria-label={isPlaying ? strings.stop : strings.play}
                        onClick={props.onTogglePlay}
                        disabled={!asset}
                    >
                        {isPlaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <span
                        className={`w-32 shrink-0 truncate text-2xs ${asset ? "text-fg-subtle" : "text-warning"}`}
                        data-tip={state === "stale" ? strings.outdatedHint : (asset?.name ?? strings.clipMissing)}
                    >
                        {asset?.name ?? strings.clipMissing}
                    </span>
                    <span className="w-10 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">
                        {props.duration}
                    </span>
                    {/* A note is a director's artifact, so it is only writable during the pass where a
                        director is judging takes. Same borderless-until-hover input as the cast name. */}
                    {mode === "audition" ? (
                        <input
                            className="h-6 w-40 shrink-0 rounded-md border border-transparent bg-transparent px-1 text-2xs text-fg-subtle outline-none hover:border-edge focus:border-primary/50 focus:text-fg"
                            readOnly={freeze.frozen}
                            data-tip={freeze.frozen ? freeze.reason : undefined}
                            placeholder={strings.notePlaceholder}
                            defaultValue={props.note}
                            key={props.note}
                            onBlur={event => {
                                if (event.target.value.trim() !== props.note) {
                                    props.onNoteChange(event.target.value);
                                }
                            }}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    (event.target as HTMLInputElement).blur();
                                }
                            }}
                            aria-label={strings.notePlaceholder}
                        />
                    ) : null}
                    <span className="flex w-16 shrink-0 items-center gap-1 text-2xs text-fg-subtle">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[state]}`} />
                        {statusLabel}
                    </span>
                    <div className="flex w-16 shrink-0 items-center justify-end gap-0.5">
                        {mode === "audition" ? (
                            state === "approved" ? (
                                <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-fg group-hover:opacity-100"
                                    onClick={props.onReturn}
                                    {...freeze.writes(false, strings.reject)}
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-success group-hover:opacity-100"
                                    onClick={props.onApprove}
                                    {...freeze.writes(state === "stale", strings.approve)}
                                >
                                    <Check className="h-3.5 w-3.5" />
                                </button>
                            )
                        ) : (
                            <>
                                <button
                                    ref={assignRef}
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-fg group-hover:opacity-100"
                                    onClick={() => assignRef.current && props.onAssign(assignRef.current)}
                                    {...freeze.writes(false, strings.replace)}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-danger group-hover:opacity-100"
                                    onClick={props.onRemove}
                                    {...freeze.writes(false, strings.remove)}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </>
                        )}
                    </div>
                </>
            ) : (
                <button
                    ref={assignRef}
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed border-edge px-2 text-2xs text-fg-subtle transition-colors hover:border-edge-strong hover:text-fg"
                    onClick={() => assignRef.current && props.onAssign(assignRef.current)}
                    {...freeze.writes(false, strings.assign)}
                >
                    <Plus className="h-3 w-3" />
                    {dragOver ? strings.dropHint : strings.assign}
                </button>
            )}
        </div>
    );
}

const ASSET_DRAG_MIME = "application/x-narraleaf-assets+json";
const AUDIO_ASSET_TYPE = "audio";

/**
 * Pull the first audio asset id off a workspace asset drag. When `peek` is true,
 * the payload may be unreadable (dragover fires before drop exposes data), so it
 * only checks the MIME is present rather than parsing.
 */
function readAudioAssetId(dataTransfer: DataTransfer | null, peek = false): string | null {
    if (!dataTransfer) {
        return null;
    }
    if (peek) {
        return Array.from(dataTransfer.types).includes(ASSET_DRAG_MIME) ? "" : null;
    }
    const raw = dataTransfer.getData(ASSET_DRAG_MIME);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as { i?: { id?: string; t?: string }[] };
        const audio = parsed.i?.find(item => item?.t === AUDIO_ASSET_TYPE && typeof item.id === "string");
        return audio?.id ?? null;
    } catch {
        return null;
    }
}
