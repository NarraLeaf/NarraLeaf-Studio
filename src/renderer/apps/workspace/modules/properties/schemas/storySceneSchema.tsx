import { useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import type { StoryScene, StorySceneBgm, StorySceneUpdate } from "@shared/types/story";
import { normalizeAudioClipRegion } from "@shared/types/audio";
import { resolveAudioTrack } from "@shared/types/audioTrack";
import { audioBusStatusLine } from "@/lib/story/audioBusStatus";
import type { Translator } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { Select } from "@/lib/components/elements";
import { useProjectAudioTracks } from "@/lib/story/useProjectAudioTracks";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { createPropertyEditorSchema, defineField } from "../framework";
import type {
    CustomFieldDefinition,
    CustomFieldProps,
    TextFieldDefinition,
    TextareaFieldDefinition,
} from "../framework/types";

/** Translator function, threaded into schema builders since they run outside React. */
type TranslateFn = Translator["t"];

/**
 * What the right rail edits when a story scene tab is in front and no row is focused.
 *
 * `onUpdateScene` is the scene editor controller's `updateSceneMetadata` — the same function the
 * inline scene header card commits through. Deliberately not a `StoryService` handle: the controller
 * is what records the undo snapshot, so writing round it would make an edit from here unreachable by
 * Ctrl+Z (and an edit from the header card a different number of steps than one from here).
 */
export type StorySceneEditorContext = {
    scene: StoryScene;
    onUpdateScene: (patch: StorySceneUpdate) => boolean;
};

/**
 * The scene's default backdrop, as a picker.
 *
 * A `thumbnail` field would be the framework's nearest stock control, but it crops the picked image
 * and writes a NEW asset — this field references an existing one by id, so it has to be its own
 * control. The shape follows the inline scene header card, which picks the same value the same way.
 */
function SceneDefaultBackgroundField({ data }: CustomFieldProps<StorySceneEditorContext>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const [selectorOpen, setSelectorOpen] = useState(false);
    const selectButtonRef = useRef<HTMLButtonElement | null>(null);
    const assetId = data.scene.defaultBackgroundAssetId ?? null;
    const { url } = useAssetObjectUrl(assetId);
    const assetsService = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    // The picked image by name, never by id — the rail's own rule (a bare uuid names nothing).
    const asset = assetId ? assetsService?.getAssets()[AssetType.Image]?.[assetId] ?? null : null;
    const label = asset?.name ?? (assetId ? t("story.background.missingImage") : t("story.background.none"));

    const handleSelect = (assets: Asset[]) => {
        const selected = assets[0];
        setSelectorOpen(false);
        if (selected) {
            data.onUpdateScene({ defaultBackgroundAssetId: selected.id });
        }
    };

    return (
        <div>
            <button
                type="button"
                className="relative block aspect-[16/9] w-full overflow-hidden rounded-md border border-edge bg-surface text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                onClick={() => setSelectorOpen(true)}
            >
                {url ? (
                    <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                ) : (
                    <span className="flex h-full w-full items-center justify-center text-fg-subtle">
                        <ImageIcon className="h-6 w-6" />
                    </span>
                )}
            </button>
            <div className="mt-2 flex gap-2">
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
                    disabled={!assetId}
                    title={t("story.sceneEditor.clearBackground")}
                    onClick={() => data.onUpdateScene({ defaultBackgroundAssetId: null })}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelect}
                selectedIds={assetId ? [assetId] : []}
                anchorRef={selectButtonRef}
                title={t("story.sceneEditor.selectDefaultBackground")}
                multiple={false}
            />
        </div>
    );
}

/**
 * The scene's opening music.
 *
 * One control rather than a column of fields, because track / volume / loop / fade only mean anything
 * once a clip is picked — an empty picker with four dead knobs under it reads as broken.
 *
 * The status line is where the two invisible things are said out loud: what the asset's markers do to
 * this scene (whole clip / loop region / intro→loop) and where the sound goes (the bus chain and the
 * player slider that governs it). Both are otherwise answerable only by opening another surface.
 */
function SceneBackgroundMusicField({ data }: CustomFieldProps<StorySceneEditorContext>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const [selectorOpen, setSelectorOpen] = useState(false);
    const selectButtonRef = useRef<HTMLButtonElement | null>(null);
    const bgm = data.scene.bgm ?? null;
    const assetsService = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    const asset = bgm?.assetId ? assetsService?.getAssets()[AssetType.Audio]?.[bgm.assetId] ?? null : null;
    const label = asset?.name ?? (bgm?.assetId ? t("story.music.missingAudio") : t("story.music.none"));
    const region = normalizeAudioClipRegion(asset?.extras);
    const tracks = useProjectAudioTracks();
    const track = resolveAudioTrack(tracks, bgm?.audioTrackId, "bgm");
    // The track supplies the loop default now, so the checkbox has to show the resolved answer -
    // a scene on a non-looping track whose box read "on" would be lying about what the game does.
    const loops = bgm?.loop ?? track.loop;
    const regionHint = buildRegionHint(t, region, loops);

    const patch = (next: Partial<StorySceneBgm>): void => {
        if (!bgm) {
            return;
        }
        data.onUpdateScene({ bgm: { ...bgm, ...next } });
    };
    const trackOptions = [
        { value: "", label: t("storyInspector.audio.trackDefault", { name: resolveAudioTrack(tracks, undefined, "bgm").name }) },
        ...tracks.map(entry => ({ value: entry.id, label: entry.name })),
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
                    disabled={!bgm}
                    title={t("story.sceneEditor.clearSceneMusic")}
                    onClick={() => data.onUpdateScene({ bgm: null })}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            {bgm ? (
                <div className="mt-2 space-y-2">
                    <div className="text-2xs tabular-nums text-fg-subtle">
                        {[regionHint, audioBusStatusLine(t, tracks, track.id, "bgm")].join(" · ")}
                    </div>
                    <Select
                        fullWidth
                        portalMenu
                        className="[&>button]:h-9 [&>button]:min-h-[34px] [&>button]:py-0"
                        options={trackOptions}
                        value={bgm.audioTrackId ?? ""}
                        onChange={value => patch({ audioTrackId: String(value) || undefined })}
                    />
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={bgm.volume ?? 1}
                            title={t("story.sceneEditor.sceneMusicVolume")}
                            className="h-9 min-w-0 flex-1"
                            onChange={event => patch({ volume: Number(event.target.value) })}
                        />
                        <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">
                            {Math.round((bgm.volume ?? 1) * 100)}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                            <input
                                type="checkbox"
                                checked={loops}
                                onChange={event => patch({ loop: event.target.checked })}
                            />
                            {t("story.sceneEditor.sceneMusicLoop")}
                        </label>
                        <label className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-xs text-fg-muted">
                            {t("story.sceneEditor.sceneMusicFade")}
                            <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={(bgm.fadeMs ?? 0) / 1000}
                                className="h-7 w-16 rounded-md border border-edge bg-surface px-2 text-right text-xs"
                                onChange={event => patch({ fadeMs: Math.max(0, Number(event.target.value) || 0) * 1000 })}
                            />
                        </label>
                    </div>
                </div>
            ) : null}

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Audio}
                onClose={() => setSelectorOpen(false)}
                onConfirm={assets => {
                    const selected = assets[0];
                    setSelectorOpen(false);
                    if (selected) {
                        data.onUpdateScene({ bgm: { ...(bgm ?? {}), assetId: selected.id } });
                    }
                }}
                selectedIds={bgm?.assetId ? [bgm.assetId] : []}
                anchorRef={selectButtonRef}
                title={t("story.sceneEditor.selectSceneMusic")}
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
 * What the asset's marked region does to THIS scene's music, in one line of values.
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
    if (!region) {
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

/**
 * Scene-level properties, shown when a story scene tab is in front with no row selected.
 *
 * Exactly the four things `StorySceneUpdate` can write. Nothing here invents a field the document
 * does not have, and nothing here is a second copy of the header card's state — both read the scene
 * off the same document and write through the same commit.
 */
export const storyScenePropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<StorySceneEditorContext>({
        id: "story-scene",
        // Never rendered (PropertyEditor draws fields only); kept because the schema type carries it.
        title: t("properties.panel.scene"),
        fields: [
            defineField<StorySceneEditorContext, TextFieldDefinition<StorySceneEditorContext>>({
                id: "storyScene.name",
                type: "text",
                label: t("common.name"),
                maxLength: 120,
                getValue: data => data.scene.name,
                setValue: (data, value) => {
                    data.onUpdateScene({ name: value });
                },
                order: 10,
            }),
            defineField<StorySceneEditorContext, TextareaFieldDefinition<StorySceneEditorContext>>({
                id: "storyScene.description",
                type: "textarea",
                label: t("common.description"),
                rows: 3,
                maxLength: 600,
                placeholder: t("story.sceneEditor.noDescription"),
                getValue: data => data.scene.description ?? "",
                setValue: (data, value) => {
                    data.onUpdateScene({ description: value });
                },
                order: 20,
            }),
            defineField<StorySceneEditorContext, CustomFieldDefinition<StorySceneEditorContext>>({
                id: "storyScene.defaultBackground",
                type: "custom",
                label: t("story.sceneEditor.defaultBackground"),
                component: SceneDefaultBackgroundField,
                order: 30,
            }),
            defineField<StorySceneEditorContext, CustomFieldDefinition<StorySceneEditorContext>>({
                id: "storyScene.bgm",
                type: "custom",
                label: t("story.sceneEditor.sceneMusic"),
                component: SceneBackgroundMusicField,
                order: 40,
            }),
        ],
    });
