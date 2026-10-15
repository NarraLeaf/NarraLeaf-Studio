import { Music } from "lucide-react";
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
import { Select } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { AssetPickerRow } from "../assets/AssetPickerRow";
import { useProjectAudioTracks } from "./useProjectAudioTracks";
import { formatSoundVolume, SoundOptionLabel, SoundOptionsFold, SoundVolumeControl } from "./SoundPlaybackOptions";
import { audioTrackDisplayName } from "@shared/types/audioTrack";

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
 * A slot's volume and track, folded under one line that states both (`SoundOptionsFold`).
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
    const tracks = useProjectAudioTracks();
    const volume = sound.volume ?? UI_INTERACTION_SOUND_DEFAULT_VOLUME;
    // A track that has since been deleted plays on the SFX track, so that is what the picker shows.
    const trackId = sound.audioTrackId && tracks.some(track => track.id === sound.audioTrackId)
        ? sound.audioTrackId
        : UI_INTERACTION_SOUND_DEFAULT_TRACK_ID;
    const shownTrack = tracks.find(track => track.id === trackId);
    const trackName = shownTrack ? audioTrackDisplayName(shownTrack, t) : trackId;
    const summary = t("properties.interactionSound.summary", { volume: formatSoundVolume(volume), track: trackName });
    const volumeLabel = t("properties.interactionSound.volume");

    return (
        <SoundOptionsFold summary={summary} label={t("properties.interactionSound.options")}>
            <SoundOptionLabel>{volumeLabel}</SoundOptionLabel>
            <SoundVolumeControl volume={volume} label={volumeLabel} onChange={next => onChange({ volume: next })} readOnly={readOnly} />
            <SoundOptionLabel>{t("properties.interactionSound.track")}</SoundOptionLabel>
            <Select
                size="sm"
                fullWidth
                value={trackId}
                disabled={readOnly}
                options={tracks.map(track => ({ value: track.id, label: audioTrackDisplayName(track, t) }))}
                onChange={value => onChange({ audioTrackId: value ? String(value) : null })}
            />
        </SoundOptionsFold>
    );
}
