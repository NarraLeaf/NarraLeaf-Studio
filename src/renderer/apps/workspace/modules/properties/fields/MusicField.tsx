import { Music } from "lucide-react";
import { normalizeAudioClipRegion } from "@shared/types/audio";
import { AUDIO_TRACK_ID_BGM, audioTrackDisplayName, resolveAudioTrack } from "@shared/types/audioTrack";
import { useTranslation } from "@/lib/i18n";
import { Switch } from "@/lib/components/elements";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { resolveEditorAssetSetMember } from "@/lib/workspace/assets/resolveWorkspaceAssetUrl";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";
import { AssetPickerRow } from "@/lib/ui-editor/widget-modules/shared/assets/AssetPickerRow";
import {
    SoundOptionLabel,
    SoundOptionsFold,
    SoundTrackOption,
    SoundVolumeControl,
} from "@/lib/ui-editor/widget-modules/shared/sound/SoundPlaybackOptions";
import { useProjectAudioTracks } from "@/lib/ui-editor/widget-modules/shared/sound/useProjectAudioTracks";
import { musicSummary } from "./musicSummary";

/**
 * The record every music setting stores, a page's (`UIPageMusic`) and a scene's (`StorySceneBgm`)
 * alike: the same five fields with the same defaults.
 */
export type MusicSetting = {
    assetId: string;
    audioTrackId?: string;
    /** 0-1. Absent = 1. */
    volume?: number;
    /** Absent = the track's own loop default. */
    loop?: boolean;
    /** Milliseconds. Absent = 0. */
    fadeMs?: number;
};

/** Which control an edit came from, so a caller can make one drag of one control one undo step. */
export type MusicEdit = "asset" | "clear" | "volume" | "track" | "loop" | "fade";

/**
 * A music setting, the body of the page inspector's and the scene inspector's Music section.
 *
 * Set the way an element's hover and click sounds are: one picker row naming the clip (or an audio
 * set), and under it the playback options folded beneath a line that states them. Music has two more
 * options than an element sound, loop and fade, and its line says what of the clip plays.
 *
 * Writes whole records: a cleared picker hands back `null`, and an option back at its default is an
 * absent field, as the record documents it.
 */
export function MusicField({
    music,
    onChange,
    chooseLabel,
    readOnly,
}: {
    music: MusicSetting | null;
    onChange: (next: MusicSetting | null, edit: MusicEdit) => void;
    /** The picker row's empty-state action and the picker's title. */
    chooseLabel: string;
    readOnly?: boolean;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col gap-1.5">
            <AssetPickerRow
                emptyLabel={t("properties.music.none")}
                chooseLabel={chooseLabel}
                missingLabel={t("properties.music.missing")}
                icon={Music}
                assetType={AssetType.Audio}
                assetId={music?.assetId ?? null}
                // A new clip keeps the options set for the old one, as an element sound's does.
                onChange={next => (next ? onChange({ ...(music ?? {}), assetId: next }, "asset") : onChange(null, "clear"))}
                readOnly={readOnly}
            />
            {music ? <MusicOptions music={music} onChange={onChange} readOnly={readOnly} /> : null}
        </div>
    );
}

function MusicOptions({
    music,
    onChange,
    readOnly,
}: {
    music: MusicSetting;
    onChange: (next: MusicSetting, edit: MusicEdit) => void;
    readOnly?: boolean;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const tracks = useProjectAudioTracks();
    // The marks are edited on the clip's own record, elsewhere; the revision re-reads them here.
    useAssetLibraryRevision();
    // A set stands for a file, and the marks belong to the file: the member the editor previews.
    const fileId = context ? resolveEditorAssetSetMember(context, music.assetId) ?? music.assetId : music.assetId;
    const asset = context?.services.get<AssetsService>(Services.Assets).getAssets()[AssetType.Audio]?.[fileId] ?? null;
    // A track that has since been deleted plays on the Music track, so that is what the picker shows.
    const track = resolveAudioTrack(tracks, music.audioTrackId, "bgm");
    // The track supplies the loop default, so the switch and the line show the resolved answer.
    const loops = music.loop ?? track.loop;
    const volume = music.volume ?? 1;
    const fadeMs = music.fadeMs ?? 0;
    const summary = musicSummary(t, {
        volume,
        trackName: audioTrackDisplayName(track, t),
        loops,
        region: normalizeAudioClipRegion(asset?.extras),
        fadeMs,
    });

    const patch = (next: Partial<MusicSetting>, edit: MusicEdit) => {
        const merged: MusicSetting = { ...music, ...next };
        for (const key of Object.keys(next) as (keyof MusicSetting)[]) {
            if (merged[key] === undefined) {
                delete merged[key];
            }
        }
        onChange(merged, edit);
    };
    const volumeLabel = t("properties.interactionSound.volume");
    const loopLabel = t("properties.music.loop");
    const fadeLabel = t("properties.music.fade");

    return (
        <SoundOptionsFold summary={summary} label={t("properties.interactionSound.options")}>
            <SoundOptionLabel>{volumeLabel}</SoundOptionLabel>
            <SoundVolumeControl
                volume={volume}
                label={volumeLabel}
                onChange={next => patch({ volume: next ?? undefined }, "volume")}
                readOnly={readOnly}
            />
            <SoundTrackOption
                tracks={tracks}
                trackId={track.id}
                fallbackChannel="bgm"
                onChange={id => patch({ audioTrackId: id && id !== AUDIO_TRACK_ID_BGM ? id : undefined }, "track")}
                readOnly={readOnly}
            />
            <SoundOptionLabel>{loopLabel}</SoundOptionLabel>
            <div className="flex">
                <Switch
                    size="sm"
                    checked={loops}
                    disabled={readOnly}
                    aria-label={loopLabel}
                    onCheckedChange={loop => patch({ loop }, "loop")}
                />
            </div>
            <SoundOptionLabel>{fadeLabel}</SoundOptionLabel>
            <div className="flex">
                <NumericDraftEnhancedInput
                    committedDisplay={String(fadeMs / 1000)}
                    commitOn="blur"
                    onFiniteNumber={seconds => {
                        const next = Math.round(Math.max(0, seconds) * 1000);
                        patch({ fadeMs: next > 0 ? next : undefined }, "fade");
                    }}
                    onEmpty={() => patch({ fadeMs: undefined }, "fade")}
                    type="text"
                    inputMode="decimal"
                    unit="s"
                    aria-label={fadeLabel}
                    disabled={readOnly}
                    size="sm"
                    popoverWhenNarrow={false}
                    className="w-24 shrink-0"
                />
            </div>
        </SoundOptionsFold>
    );
}
