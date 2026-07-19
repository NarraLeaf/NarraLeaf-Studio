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

export type VoiceTableRow = {
    unitId: string;
    sourceText: string;
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
};

type VoiceRowProps = {
    row: VoiceTableRow;
    speaker: string;
    state: VoiceUnitState;
    /** Resolved audio asset for the linked clip, or null when the clip is missing / unlinked. */
    asset: Asset | null;
    mode: "assign" | "audition";
    isPlaying: boolean;
    strings: VoiceRowStrings;
    onTogglePlay: () => void;
    onAssign: (anchor: HTMLElement) => void;
    onRemove: () => void;
    onApprove: () => void;
    onReturn: () => void;
    onDropAsset: (assetId: string) => void;
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
            onDragOver={event => {
                if (readAudioAssetId(event.dataTransfer, true)) {
                    event.preventDefault();
                    setDragOver(true);
                }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
        >
            <span className="w-24 shrink-0 truncate text-2xs text-fg-subtle" title={speaker}>
                {speaker}
            </span>
            <span className="min-w-0 flex-1 truncate text-fg" title={row.sourceText}>
                {row.sourceText || "—"}
            </span>

            {hasClip ? (
                <>
                    <button
                        type="button"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-fill hover:text-fg"
                        title={isPlaying ? strings.stop : strings.play}
                        onClick={props.onTogglePlay}
                        disabled={!asset}
                    >
                        {isPlaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <span
                        className={`w-40 shrink-0 truncate text-2xs ${asset ? "text-fg-subtle" : "text-warning"}`}
                        title={state === "stale" ? strings.outdatedHint : (asset?.name ?? strings.clipMissing)}
                    >
                        {asset?.name ?? strings.clipMissing}
                    </span>
                    <span className="flex w-16 shrink-0 items-center gap-1 text-2xs text-fg-subtle">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[state]}`} />
                        {statusLabel}
                    </span>
                    <div className="flex w-16 shrink-0 items-center justify-end gap-0.5">
                        {mode === "audition" ? (
                            state === "approved" ? (
                                <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-fg group-hover:opacity-100"
                                    title={strings.reject}
                                    onClick={props.onReturn}
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-success group-hover:opacity-100"
                                    title={strings.approve}
                                    onClick={props.onApprove}
                                    disabled={state === "stale"}
                                >
                                    <Check className="h-3.5 w-3.5" />
                                </button>
                            )
                        ) : (
                            <>
                                <button
                                    ref={assignRef}
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-fg group-hover:opacity-100"
                                    title={strings.replace}
                                    onClick={() => assignRef.current && props.onAssign(assignRef.current)}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-danger group-hover:opacity-100"
                                    title={strings.remove}
                                    onClick={props.onRemove}
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
                    className="flex h-7 shrink-0 items-center gap-1 rounded border border-dashed border-edge px-2 text-2xs text-fg-subtle transition-colors hover:border-edge-strong hover:text-fg"
                    title={strings.assign}
                    onClick={() => assignRef.current && props.onAssign(assignRef.current)}
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
