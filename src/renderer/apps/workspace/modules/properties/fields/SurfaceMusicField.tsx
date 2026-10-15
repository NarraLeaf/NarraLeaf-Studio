import { Music } from "lucide-react";
import { normalizeAudioClipRegion } from "@shared/types/audio";
import { AUDIO_TRACK_ID_BGM, audioTrackDisplayName, resolveAudioTrack } from "@shared/types/audioTrack";
import { readUIPageMusic, type UIPageMusic } from "@shared/types/ui-editor/pageMusic";
import { useTranslation } from "@/lib/i18n";
import { Select, Switch } from "@/lib/components/elements";
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
    SoundVolumeControl,
} from "@/lib/ui-editor/widget-modules/shared/sound/SoundPlaybackOptions";
import { useProjectAudioTracks } from "@/lib/ui-editor/widget-modules/shared/sound/useProjectAudioTracks";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";
import { pageMusicSummary } from "./pageMusicSummary";

/** Which control an edit came from, so one drag of one control is one undo step. */
type PageMusicEdit = "asset" | "clear" | "volume" | "track" | "loop" | "fade";

/**
 * The page's music, the body of the page inspector's Music section.
 *
 * Set the way an element's hover and click sounds are: one picker row naming the clip (or an audio
 * set), and under it the playback options folded beneath a line that states them. Music has two more
 * options than an element sound, loop and fade, and its line says how the clip's marks loop.
 *
 * Plays while the page is the page on screen and hands over when another page with music of its own
 * takes the screen, or when the page leaves it; see `runtime/app/pageMusic.ts` for the whole rule.
 */
export function SurfaceMusicField({ data, readOnly }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    const music = readUIPageMusic(data.surface);

    const write = (next: UIPageMusic | null, edit: PageMusicEdit) => {
        data.documentService.updateSurface(data.surface.id, surface => {
            const settings = { ...(surface.settings ?? {}) };
            if (next) {
                settings.music = next;
            } else {
                // Cleared means gone, not "options with no clip": a half-filled record would
                // outlive the choice that made it and keep claiming the asset it no longer plays.
                delete settings.music;
            }
            surface.settings = settings;
        }, { mergeKey: `surface:${data.surface.id}:music:${edit}` });
    };

    return (
        <div className="flex flex-col gap-1.5">
            <AssetPickerRow
                emptyLabel={t("properties.pageMusic.none")}
                chooseLabel={t("properties.pageMusic.choose")}
                missingLabel={t("properties.pageMusic.missing")}
                icon={Music}
                assetType={AssetType.Audio}
                assetId={music?.assetId ?? null}
                // A new clip keeps the options set for the old one, as an element sound's does.
                onChange={next => (next ? write({ ...(music ?? {}), assetId: next }, "asset") : write(null, "clear"))}
                readOnly={readOnly}
            />
            {music ? <PageMusicOptions music={music} onChange={write} readOnly={readOnly} /> : null}
        </div>
    );
}

function PageMusicOptions({
    music,
    onChange,
    readOnly,
}: {
    music: UIPageMusic;
    onChange: (next: UIPageMusic, edit: PageMusicEdit) => void;
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
    const summary = pageMusicSummary(t, {
        volume,
        trackName: audioTrackDisplayName(track, t),
        loops,
        region: normalizeAudioClipRegion(asset?.extras),
        fadeMs,
    });

    const patch = (next: Partial<UIPageMusic>, edit: PageMusicEdit) => {
        const merged: UIPageMusic = { ...music, ...next };
        // An option back at its default is an absent field, as the record documents it.
        for (const key of Object.keys(next) as (keyof UIPageMusic)[]) {
            if (merged[key] === undefined) {
                delete merged[key];
            }
        }
        onChange(merged, edit);
    };
    const volumeLabel = t("properties.interactionSound.volume");
    const loopLabel = t("properties.pageMusic.loop");
    const fadeLabel = t("properties.pageMusic.fade");

    return (
        <SoundOptionsFold summary={summary} label={t("properties.interactionSound.options")}>
            <SoundOptionLabel>{volumeLabel}</SoundOptionLabel>
            <SoundVolumeControl
                volume={volume}
                label={volumeLabel}
                onChange={next => patch({ volume: next ?? undefined }, "volume")}
                readOnly={readOnly}
            />
            <SoundOptionLabel>{t("properties.interactionSound.track")}</SoundOptionLabel>
            <Select
                size="sm"
                fullWidth
                value={track.id}
                disabled={readOnly}
                options={tracks.map(entry => ({ value: entry.id, label: audioTrackDisplayName(entry, t) }))}
                onChange={value => {
                    const id = value ? String(value) : "";
                    patch({ audioTrackId: id && id !== AUDIO_TRACK_ID_BGM ? id : undefined }, "track");
                }}
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
