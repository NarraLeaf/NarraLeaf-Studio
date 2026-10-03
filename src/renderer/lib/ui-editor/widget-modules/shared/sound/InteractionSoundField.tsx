import { useState } from "react";
import { ChevronRight, Music } from "lucide-react";
import {
    readUIInteractionSound,
    UI_INTERACTION_SOUND_DEFAULT_TRACK_ID,
    UI_INTERACTION_SOUND_DEFAULT_VOLUME,
    uiInteractionSoundOptionsPatch,
    uiInteractionSoundPatch,
    type UIInteractionSound,
    type UIInteractionSoundKind,
    type UIInteractionSoundOptions,
} from "@shared/types/ui-editor/interactionSounds";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { Select, Slider, useSliderDraft } from "@/lib/components/elements";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { AssetPickerRow } from "../assets/AssetPickerRow";
import { useProjectAudioTracks } from "./useProjectAudioTracks";

/** The increment the volume slider moves on. The box beside it takes any value in 0..1. */
const VOLUME_STEP = 0.05;

function snapVolume(value: number): number {
    return Math.round(value / VOLUME_STEP) * VOLUME_STEP;
}

/** A volume as the author reads it: 1, 0.6, 0.55 - no trailing zeros, at most two places. */
function formatVolume(value: number): string {
    return String(Math.round(value * 100) / 100);
}

/**
 * The sounds an element plays when the player points at it and when they click it.
 *
 * One row per gesture, each naming an audio asset or an asset set, and under each a folded line for
 * the two things an author tunes on a `Play Sound` node: its volume and its track. What plays and
 * where is the runtime's (`runtime/interactionSounds.ts`); this only reads and writes the two props.
 */
export function InteractionSoundField({ data, readOnly }: CustomFieldProps<UIInspectorData>) {
    // Through the live document: a schema closure can outlive the props it captured.
    const element = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    const write = (patch: Record<string, unknown>) => {
        data.documentService.updateElementProps(element.id, patch);
    };

    return (
        <div className="flex flex-col gap-3">
            <InteractionSoundSlot kind="hover" sound={readUIInteractionSound(element, "hover")} write={write} readOnly={readOnly} />
            <InteractionSoundSlot kind="click" sound={readUIInteractionSound(element, "click")} write={write} readOnly={readOnly} />
        </div>
    );
}

const SLOT_KEYS = {
    hover: {
        label: "properties.interactionSound.hover",
        tip: "properties.interactionSound.hoverTip",
        choose: "properties.interactionSound.chooseHover",
    },
    click: {
        label: "properties.interactionSound.click",
        tip: "properties.interactionSound.clickTip",
        choose: "properties.interactionSound.chooseClick",
    },
} as const;

function InteractionSoundSlot({
    kind,
    sound,
    write,
    readOnly,
}: {
    kind: UIInteractionSoundKind;
    sound: UIInteractionSound | null;
    write: (patch: Record<string, unknown>) => void;
    readOnly?: boolean;
}) {
    const { t } = useTranslation();
    const keys = SLOT_KEYS[kind];
    const setOptions = (options: UIInteractionSoundOptions) => {
        const patch = uiInteractionSoundOptionsPatch(sound, kind, options);
        if (patch) {
            write(patch);
        }
    };

    return (
        <div className="flex flex-col gap-1.5">
            <AssetPickerRow
                label={t(keys.label)}
                tip={t(keys.tip)}
                emptyLabel={t("properties.interactionSound.none")}
                chooseLabel={t(keys.choose)}
                missingLabel={t("properties.interactionSound.missing")}
                icon={Music}
                assetType={AssetType.Audio}
                assetId={sound?.assetId ?? null}
                onChange={next => write(uiInteractionSoundPatch(kind, next, sound))}
                readOnly={readOnly}
            />
            {sound ? <SoundPlaybackOptions sound={sound} onChange={setOptions} readOnly={readOnly} /> : null}
        </div>
    );
}

/**
 * A slot's volume and track, folded under one line that states both.
 *
 * Folded because most sounds are played as they are, and a row of controls under every slot would
 * double the section for nothing. The line is the summary as well as the toggle, so a sound that has
 * been turned down or sent to another track says so while folded - a setting that changes what the
 * player hears is never hidden behind a closed disclosure.
 */
function SoundPlaybackOptions({
    sound,
    onChange,
    readOnly,
}: {
    sound: UIInteractionSound;
    onChange: (options: UIInteractionSoundOptions) => void;
    readOnly?: boolean;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const tracks = useProjectAudioTracks();
    const volume = sound.volume ?? UI_INTERACTION_SOUND_DEFAULT_VOLUME;
    // A track that has since been deleted plays on the SFX track, so that is what the picker shows.
    const trackId = sound.audioTrackId && tracks.some(track => track.id === sound.audioTrackId)
        ? sound.audioTrackId
        : UI_INTERACTION_SOUND_DEFAULT_TRACK_ID;
    const trackName = tracks.find(track => track.id === trackId)?.name ?? trackId;
    const summary = t("properties.interactionSound.summary", { volume: formatVolume(volume), track: trackName });

    return (
        <div className="flex flex-col gap-2">
            <button
                type="button"
                aria-expanded={open}
                aria-label={`${t("properties.interactionSound.options")}: ${summary}`}
                onClick={() => setOpen(value => !value)}
                className="flex w-fit min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-2xs text-fg-subtle hover:bg-fill hover:text-fg-muted"
            >
                <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform duration-150", open && "rotate-90")} />
                <span className="truncate">{summary}</span>
            </button>
            {open ? (
                <div className="flex flex-col gap-2 pl-4">
                    <VolumeRow volume={volume} onChange={next => onChange({ volume: next })} readOnly={readOnly} />
                    <div className="flex items-center gap-2">
                        <span className="w-10 shrink-0 text-xs text-fg-muted">{t("properties.interactionSound.track")}</span>
                        <Select
                            size="sm"
                            fullWidth
                            value={trackId}
                            disabled={readOnly}
                            options={tracks.map(track => ({ value: track.id, label: track.name }))}
                            onChange={value => onChange({ audioTrackId: value ? String(value) : null })}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/**
 * Volume as a box and a slider reading one value.
 *
 * The write happens once per gesture (`useSliderDraft`): on release for the slider, on blur or Enter
 * for the box. The slider snaps while it moves, never on commit - `Slider` also commits on `keyup`,
 * and a Tab that only passes through it would otherwise round a typed 0.62 to 0.6.
 */
function VolumeRow({ volume, onChange, readOnly }: { volume: number; onChange: (next: number | null) => void; readOnly?: boolean }) {
    const { t } = useTranslation();
    const draft = useSliderDraft(volume, next => onChange(Math.min(1, Math.max(0, next))));
    const onGrid = Math.abs(snapVolume(draft.value) - draft.value) < 1e-9;
    const label = t("properties.interactionSound.volume");
    return (
        <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-xs text-fg-muted">{label}</span>
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
                committedDisplay={formatVolume(draft.value)}
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
                // The track picker below is `sm`, and so is every control in this section's rows.
                size="sm"
                popoverWhenNarrow={false}
                className="w-14 shrink-0"
                inputClassName="px-1.5 text-right"
            />
        </div>
    );
}
