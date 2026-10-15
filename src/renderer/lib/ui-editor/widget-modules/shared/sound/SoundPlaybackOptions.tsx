import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Slider, useSliderDraft } from "@/lib/components/elements";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { cn } from "@/lib/utils/cn";

/** The increment the volume slider moves on. The box beside it takes any value in 0..1. */
const VOLUME_STEP = 0.05;

function snapVolume(value: number): number {
    return Math.round(value / VOLUME_STEP) * VOLUME_STEP;
}

/** A volume as the author reads it: 1, 0.6, 0.55 - no trailing zeros, at most two places. */
export function formatSoundVolume(value: number): string {
    return String(Math.round(value * 100) / 100);
}

/**
 * A sound's playback options, folded under one line that states them.
 *
 * Folded because most sounds are played as they are, and a row of controls under every picker would
 * double the section for nothing. The line is the summary as well as the toggle, so a sound that has
 * been turned down or sent to another track says so while folded - a setting that changes what the
 * player hears is never hidden behind a closed disclosure. The caller writes the summary, and owes
 * it every option the fold holds.
 *
 * The open body is a two-column grid of {@link SoundOptionLabel} and control pairs, so the labels
 * share one column however many rows a caller gives it. The label column is at least as wide as the
 * element sound slots always laid it out, and grows for a longer label rather than letting it run
 * under its control.
 */
export function SoundOptionsFold({ summary, label, children }: { summary: string; label: string; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="flex flex-col gap-2">
            <button
                type="button"
                aria-expanded={open}
                aria-label={`${label}: ${summary}`}
                onClick={() => setOpen(value => !value)}
                className="flex w-fit min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-2xs text-fg-subtle hover:bg-fill hover:text-fg-muted"
            >
                <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform duration-150", open && "rotate-90")} />
                <span className="truncate">{summary}</span>
            </button>
            {open ? (
                <div className="grid grid-cols-[minmax(2.5rem,auto)_minmax(0,1fr)] items-center gap-2 pl-4">
                    {children}
                </div>
            ) : null}
        </div>
    );
}

/** The left-hand cell of one {@link SoundOptionsFold} row. */
export function SoundOptionLabel({ children }: { children: ReactNode }) {
    return <span className="whitespace-nowrap text-xs text-fg-muted">{children}</span>;
}

/**
 * Volume as a box and a slider reading one value: the right-hand cell of a volume row.
 *
 * The write happens once per gesture (`useSliderDraft`): on release for the slider, on blur or Enter
 * for the box. The slider snaps while it moves, never on commit - `Slider` also commits on `keyup`,
 * and a Tab that only passes through it would otherwise round a typed 0.62 to 0.6. An emptied box
 * hands back `null`: the volume goes back to its default.
 */
export function SoundVolumeControl({
    volume,
    onChange,
    label,
    readOnly,
}: {
    volume: number;
    onChange: (next: number | null) => void;
    /** The row's label, as the accessible name of both controls. */
    label: string;
    readOnly?: boolean;
}) {
    const draft = useSliderDraft(volume, next => onChange(Math.min(1, Math.max(0, next))));
    const onGrid = Math.abs(snapVolume(draft.value) - draft.value) < 1e-9;
    return (
        <div className="flex min-w-0 items-center gap-2">
            <Slider
                className="min-w-0 flex-1"
                min={0}
                max={1}
                step={onGrid ? VOLUME_STEP : "any"}
                value={draft.value}
                disabled={readOnly}
                aria-label={label}
                onValueChange={value => draft.onValueChange(snapVolume(value))}
                onValueCommit={draft.onValueCommit}
            />
            <NumericDraftEnhancedInput
                committedDisplay={formatSoundVolume(draft.value)}
                commitOn="blur"
                onDraftNumber={draft.onValueChange}
                onFiniteNumber={draft.onValueCommit}
                onEmpty={() => {
                    draft.clear();
                    onChange(null);
                }}
                type="text"
                inputMode="decimal"
                aria-label={label}
                disabled={readOnly}
                // Every control in a fold's rows is `sm`, the track picker included.
                size="sm"
                popoverWhenNarrow={false}
                className="w-14 shrink-0"
                inputClassName="px-1.5 text-right"
            />
        </div>
    );
}
