import { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { hasClipMarkers, normalizeAudioClipRegion } from "@shared/types/audio";
import { audioTrackDisplayName, resolveAudioTrack } from "@shared/types/audioTrack";
import type { Translator } from "@shared/i18n";
import { audioBusStatusLine } from "@/lib/story/audioBusStatus";
import { useTranslation } from "@/lib/i18n";
import { Select, Switch } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useAssetSetPickerSource } from "@/apps/workspace/modules/assets/state/useAssetSetPickerSource";
import { useProjectAudioTracks } from "@/lib/story/useProjectAudioTracks";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

/** Translator function, threaded into helpers that run outside React. */
type TranslateFn = Translator["t"];

/**
 * A piece of music something plays while it is on screen: a scene's (`StorySceneBgm`) and a page's
 * (`UIPageMusic`), which have the same five fields with the same meaning.
 */
export type MusicSetting = {
    assetId: string;
    audioTrackId?: string;
    volume?: number;
    loop?: boolean;
    fadeMs?: number;
};

/** Which control an edit came from, so a caller can fold one drag of one control into one undo step. */
export type MusicSettingEdit = "asset" | "track" | "volume" | "loop" | "fade" | "clear";

export type MusicSettingFieldProps = {
    value: MusicSetting | null;
    onChange: (next: MusicSetting | null, edit: MusicSettingEdit) => void;
    /** The clear button's name, which says whose music it clears. */
    clearLabel: string;
    /** The asset picker's title. */
    selectTitle: string;
};

/**
 * Pick a clip, then its track, volume, loop and fade.
 *
 * One control rather than a column of fields, because track / volume / loop / fade only mean anything
 * once a clip is picked — an empty picker with four dead knobs under it reads as broken.
 *
 * The status line is where the two invisible things are said out loud: what the asset's markers do to
 * this music (whole clip / loop region / intro→loop) and where the sound goes (the bus chain and the
 * player slider that governs it). Both are otherwise answerable only by opening another surface.
 *
 * The scene inspector's Scene music and the page inspector's Page music are this one control, so the
 * two read and behave alike; each says only whose music it is.
 */
export function MusicSettingField({ value, onChange, clearLabel, selectTitle }: MusicSettingFieldProps) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const [selectorOpen, setSelectorOpen] = useState(false);
    const selectButtonRef = useRef<HTMLButtonElement | null>(null);
    const music = value;
    const assetsService = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    const asset = music?.assetId ? assetsService?.getAssets()[AssetType.Audio]?.[music.assetId] ?? null : null;
    // Music varies by language as readily as art does (a theme with a sung vocal), and assembly
    // resolves this field, so the picker offers the project's audio sets here too.
    const {
        virtualGroups: musicSetGroups,
        resolveAssetPreviewUrl: resolveMusicSetPreviewUrl,
        findSet: findMusicSet,
    } = useAssetSetPickerSource({ context, isInitialized, assetType: AssetType.Audio, enabled: true });
    const musicSet = music?.assetId && !asset ? findMusicSet(music.assetId) : null;
    const label = asset?.name
        ?? musicSet?.set.name
        ?? (music?.assetId ? t("story.music.missingAudio") : t("story.music.none"));
    const region = normalizeAudioClipRegion(asset?.extras);
    const tracks = useProjectAudioTracks();
    const track = resolveAudioTrack(tracks, music?.audioTrackId, "bgm");
    // The track supplies the loop default, so the switch has to show the resolved answer - music on
    // a non-looping track whose switch read "on" would be lying about what the game does.
    const loops = music?.loop ?? track.loop;
    const regionHint = buildRegionHint(t, region, loops);

    const patch = (next: Partial<MusicSetting>, edit: MusicSettingEdit): void => {
        if (!music) {
            return;
        }
        onChange({ ...music, ...next }, edit);
    };
    const trackOptions = [
        { value: "", label: t("storyInspector.audio.trackDefault", { name: audioTrackDisplayName(resolveAudioTrack(tracks, undefined, "bgm"), t) }) },
        ...tracks.map(entry => ({ value: entry.id, label: audioTrackDisplayName(entry, t) })),
    ];

    return (
        <div>
            <div className="flex gap-2">
                <button
                    ref={selectButtonRef}
                    type="button"
                    className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-edge bg-surface-raised px-3 text-left text-sm text-fg-muted hover:border-primary/40"
                    onClick={() => setSelectorOpen(true)}
                >
                    <span className={["truncate", asset ? "" : "italic text-fg-subtle"].join(" ")}>{label}</span>
                </button>
                <button
                    type="button"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!music}
                    data-tip={clearLabel} aria-label={clearLabel}
                    onClick={() => onChange(null, "clear")}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            {music ? (
                <div className="mt-2 space-y-2">
                    <div className="text-2xs tabular-nums text-fg-subtle">
                        {[regionHint, audioBusStatusLine(t, tracks, track.id, "bgm")].join(" · ")}
                    </div>
                    <Select
                        fullWidth
                        portalMenu
                        options={trackOptions}
                        value={music.audioTrackId ?? ""}
                        onChange={next => patch({ audioTrackId: String(next) || undefined }, "track")}
                    />
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={music.volume ?? 1}
                            data-tip={t("story.sceneEditor.sceneMusicVolume")} aria-label={t("story.sceneEditor.sceneMusicVolume")}
                            className="h-9 min-w-0 flex-1"
                            onChange={event => patch({ volume: Number(event.target.value) }, "volume")}
                        />
                        <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">
                            {Math.round((music.volume ?? 1) * 100)}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                            <Switch
                                size="sm"
                                checked={loops}
                                onCheckedChange={loop => patch({ loop }, "loop")}
                                aria-label={t("story.sceneEditor.sceneMusicLoop")}
                            />
                            {t("story.sceneEditor.sceneMusicLoop")}
                        </span>
                        <label className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-xs text-fg-muted">
                            {t("story.sceneEditor.sceneMusicFade")}
                            <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={(music.fadeMs ?? 0) / 1000}
                                className="h-7 w-16 rounded-md border border-edge bg-surface px-2 text-right text-xs"
                                onChange={event => patch({ fadeMs: Math.max(0, Number(event.target.value) || 0) * 1000 }, "fade")}
                            />
                        </label>
                    </div>
                </div>
            ) : null}

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Audio}
                {...(musicSetGroups ? { virtualGroups: musicSetGroups, resolveAssetPreviewUrl: resolveMusicSetPreviewUrl } : {})}
                onClose={() => setSelectorOpen(false)}
                onConfirm={assets => {
                    const selected = assets[0];
                    setSelectorOpen(false);
                    if (selected) {
                        onChange({ ...(music ?? {}), assetId: selected.id }, "asset");
                    }
                }}
                selectedIds={music?.assetId ? [music.assetId] : []}
                anchorRef={selectButtonRef}
                title={selectTitle}
                multiple={false}
            />
        </div>
    );
}

/** Whole seconds where the marker lands on one, one decimal otherwise. */
function formatSeconds(ms: number): string {
    const seconds = ms / 1000;
    return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/**
 * What the asset's marked region does to this music, in one line of values.
 *
 * Three markers now, not two: an intro→loop clip plays `in..loop` once and then repeats `loop..out`
 * forever, which is a materially different thing from looping the whole marked region and the author
 * has no other way to see it from here. Still one line - the standing rule is that thin bars never
 * stack, so the third marker joins the sentence rather than adding a row under it.
 *
 * The loop arms are shown only when the music actually loops: a one-shot ignores every marker past
 * the in point, and printing a loop point on it would describe playback that never happens.
 */
function buildRegionHint(
    t: TranslateFn,
    region: ReturnType<typeof normalizeAudioClipRegion>,
    loops: boolean,
): string {
    // A clip that carries only a gain is still the whole clip.
    if (!region || !hasClipMarkers(region)) {
        return t("story.sceneEditor.sceneMusicWholeClip");
    }
    const from = formatSeconds(region.inMs ?? 0);
    if (region.outMs === undefined || !loops) {
        return t("story.sceneEditor.sceneMusicFromIn", { from });
    }
    const to = formatSeconds(region.outMs);
    // `loopStartMs` equal to the in point is the plain loop the two-marker line already describes,
    // and `normalizeAudioClipRegion` only keeps a point inside the window, so this is the intro case.
    if (region.loopStartMs !== undefined && region.loopStartMs !== (region.inMs ?? 0)) {
        return t("story.sceneEditor.sceneMusicIntroLoop", { from, loop: formatSeconds(region.loopStartMs), to });
    }
    return t("story.sceneEditor.sceneMusicLoopRegion", { from, to });
}
