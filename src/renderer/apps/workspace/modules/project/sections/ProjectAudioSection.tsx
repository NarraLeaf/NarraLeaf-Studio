/**
 * Project → Audio: the tracks every audio-producing surface points at.
 *
 * A track is an authoring-time mix preset - a bus, a multiplier and the fade/loop defaults a play on
 * it inherits. The bus is the whole reason this surface exists: before it, a per-action `volume`
 * multiplied silently with the player's preference sliders and nothing in Studio said which slider
 * that was. Each row's status line answers it by name.
 *
 * The three built-ins cannot be deleted, because they are where an unresolvable reference lands -
 * one per bus, at all times. Deleting a custom track does NOT rewrite the things pointing at it;
 * they fall back to the built-in for their channel at resolve time, which is why the row carries the
 * number of them and the confirm says so.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Copy, Link2, Plus, Repeat, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Select } from "@/lib/components/elements";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { AudioTrackService } from "@/lib/workspace/services/audio/AudioTrackService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import {
    AUDIO_TRACK_CHANNELS,
    AUDIO_TRACK_GAIN_MAX,
    AUDIO_TRACK_GAIN_MIN,
    countAudioTrackReferences,
    type AudioTrackChannel,
    type ProjectAudioTrack,
} from "@shared/types/audioTrack";
import type { TranslationKey } from "@shared/i18n";
import { useWorkspace } from "../../../context";
import type { ProjectSectionProps } from "./types";

/** The bus, as the engine names it. Short, because it shares a line with two other controls. */
const CHANNEL_LABEL_KEYS: Record<AudioTrackChannel, TranslationKey> = {
    bgm: "project.audio.channel.bgm",
    sound: "project.audio.channel.sound",
    voice: "project.audio.channel.voice",
};

/** The player's own volume slider for that bus - the thing the status line is there to name. */
const SLIDER_LABEL_KEYS: Record<AudioTrackChannel, TranslationKey> = {
    bgm: "project.audio.slider.bgm",
    sound: "project.audio.slider.sound",
    voice: "project.audio.slider.voice",
};

export function ProjectAudioSection({ uiService }: ProjectSectionProps) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();

    const trackService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<AudioTrackService>(Services.AudioTracks);
    }, [context, isInitialized]);

    const [tracks, setTracks] = useState<ProjectAudioTrack[]>([]);
    const [references, setReferences] = useState<Record<string, number>>({});

    useEffect(() => {
        if (!trackService) {
            setTracks([]);
            return;
        }
        setTracks(trackService.listTracks());
        return trackService.onTracksChanged(setTracks);
    }, [trackService]);

    // Recomputed when the id set changes rather than on every keystroke: renaming a track or nudging
    // its gain cannot change how many things point at it, and re-reading every story document for
    // each character typed into the name field would be a scan per frame.
    const trackIdKey = tracks.map(track => track.id).join("\u0000");
    useEffect(() => {
        if (!context || !isInitialized || !trackIdKey) {
            return;
        }
        let active = true;
        void (async () => {
            const counts = await countReferences(context, trackIdKey.split("\u0000"));
            if (active) {
                setReferences(counts);
            }
        })();
        return () => { active = false; };
    }, [context, isInitialized, trackIdKey]);

    const addTrack = useCallback(() => {
        trackService?.createTrack({ name: t("project.audio.newTrackName") });
    }, [t, trackService]);

    const removeTrack = useCallback(async (track: ProjectAudioTrack) => {
        if (!trackService) {
            return;
        }
        const uses = references[track.id] ?? 0;
        const fallback = trackService.resolveTrack(null, track.channel);
        const confirmed = await uiService?.showDestructiveConfirm(
            t("project.audio.deleteConfirm", { name: track.name }),
            tn("project.audio.deleteDetail", uses, { track: fallback.name }),
            t("project.audio.delete"),
        );
        if (confirmed) {
            trackService.deleteTrack(track.id);
        }
    }, [references, t, trackService, uiService]);

    return (
        <div className="grid gap-3">
            <div className="flex justify-end">
                <AddTrackButton onClick={addTrack} disabled={!trackService} />
            </div>

            <div className="grid gap-2">
                {tracks.map(track => (
                    <TrackRow
                        key={track.id}
                        track={track}
                        references={references[track.id] ?? 0}
                        onPatch={patch => trackService?.updateTrack(track.id, patch)}
                        onDuplicate={() => trackService?.duplicateTrack(track.id)}
                        onDelete={() => void removeTrack(track)}
                    />
                ))}
            </div>
        </div>
    );
}

function AddTrackButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    return (
        <button
            type="button"
            onClick={onClick}
            {...freeze.writes(disabled)}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-fill-subtle px-2 py-1 text-2xs font-medium text-fg-muted transition hover:bg-fill disabled:opacity-50"
        >
            <Plus className="h-3.5 w-3.5" />
            {t("project.audio.add")}
        </button>
    );
}

function TrackRow({
    track,
    references,
    onPatch,
    onDuplicate,
    onDelete,
}: {
    track: ProjectAudioTrack;
    references: number;
    onPatch: (patch: Partial<Omit<ProjectAudioTrack, "id" | "builtin">>) => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const { t, tn } = useTranslation();
    // Every control here writes `editor/audio-tracks.json`, so the row goes read-only as one. The
    // freeze reason rides the container's title the way `settingRows` does it: a disabled `Select`
    // does not report a hover of its own on every platform.
    const freeze = useFreezeGuard();
    const frozen = freeze.writes();

    const channelOptions = useMemo(
        () => AUDIO_TRACK_CHANNELS.map(channel => ({ value: channel, labelKey: CHANNEL_LABEL_KEYS[channel] })),
        [],
    );

    return (
        <div
            className="group grid gap-1.5 rounded-md border border-edge bg-fill-subtle p-2"
            title={frozen.title}
        >
            <TrackNameInput
                name={track.name}
                disabled={frozen.disabled}
                onCommit={name => onPatch({ name })}
            />

            <div className="flex items-center gap-1.5">
                <Select
                    size="md"
                    fullWidth
                    className="min-w-0 flex-1"
                    portalMenu
                    options={channelOptions}
                    value={track.channel}
                    // A built-in's bus is its identity: `music` is where a bgm play with no track
                    // lands, so re-pointing it would silently break every such play elsewhere.
                    disabled={frozen.disabled || Boolean(track.builtin)}
                    onChange={value => onPatch({ channel: value as AudioTrackChannel })}
                />
                <NumericDraftEnhancedInput
                    committedDisplay={formatGain(track.gain)}
                    draftResetKey={`${track.id}-gain`}
                    // Rounded on the way in, so the number the field shows after a blur is the
                    // number that is stored - and the status line's `× 1.25` is not a summary of a
                    // 1.2487 nobody can see.
                    onFiniteNumber={gain => onPatch({ gain: Math.round(gain * 100) / 100 })}
                    disabled={frozen.disabled}
                    inputMode="decimal"
                    type="number"
                    min={AUDIO_TRACK_GAIN_MIN}
                    max={AUDIO_TRACK_GAIN_MAX}
                    step={0.05}
                    aria-label={t("project.audio.gainAria")}
                    popoverWhenNarrow={false}
                    selectAllOnFocus
                    className="w-16 shrink-0"
                />
                <button
                    type="button"
                    onClick={() => onPatch({ loop: !track.loop })}
                    aria-pressed={track.loop}
                    aria-label={t("project.audio.loopAria")}
                    // `writes()` with no own title, here and on the two row actions: the accessible
                    // name is the `aria-label`, so the only hover text this surface ever shows is
                    // the freeze reason.
                    {...freeze.writes()}
                    className={`${controlButtonClass(track.loop)} shrink-0 disabled:opacity-50`}
                >
                    <Repeat className="h-4 w-4" />
                </button>
            </div>

            <div className="flex items-center gap-1.5">
                <NumericDraftEnhancedInput
                    committedDisplay={String(Math.round(track.fadeInMs))}
                    draftResetKey={`${track.id}-fade-in`}
                    onFiniteNumber={fadeInMs => onPatch({ fadeInMs })}
                    disabled={frozen.disabled}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    unit="ms"
                    leftIcon={<ArrowUpRight className="h-3.5 w-3.5" />}
                    aria-label={t("project.audio.fadeInAria")}
                    popoverWhenNarrow={false}
                    selectAllOnFocus
                    className="min-w-0 flex-1"
                />
                <NumericDraftEnhancedInput
                    committedDisplay={String(Math.round(track.fadeOutMs))}
                    draftResetKey={`${track.id}-fade-out`}
                    onFiniteNumber={fadeOutMs => onPatch({ fadeOutMs })}
                    disabled={frozen.disabled}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    unit="ms"
                    leftIcon={<ArrowDownRight className="h-3.5 w-3.5" />}
                    aria-label={t("project.audio.fadeOutAria")}
                    popoverWhenNarrow={false}
                    selectAllOnFocus
                    className="min-w-0 flex-1"
                />
            </div>

            <div className="flex items-center gap-2 text-2xs text-fg-subtle">
                {/* The point of the whole feature, stated as values: the player slider this track
                    lands on, and the multiplier that used to be invisible. */}
                <span className="min-w-0 truncate">
                    {t(SLIDER_LABEL_KEYS[track.channel])} × {formatGain(track.gain)}
                </span>
                {references > 0 ? (
                    <span
                        className="flex shrink-0 items-center gap-0.5"
                        aria-label={tn("project.audio.referencesAria", references)}
                    >
                        <Link2 className="h-3 w-3" />
                        {references}
                    </span>
                ) : null}
                <span className="flex-1" />
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                        type="button"
                        onClick={onDuplicate}
                        aria-label={t("project.audio.duplicate")}
                        {...freeze.writes()}
                        className="grid h-6 w-6 place-items-center rounded-md text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40"
                    >
                        <Copy className="h-3.5 w-3.5" />
                    </button>
                    {track.builtin ? null : (
                        <button
                            type="button"
                            onClick={onDelete}
                            aria-label={t("project.audio.delete")}
                            {...freeze.writes()}
                            className="grid h-6 w-6 place-items-center rounded-md text-fg-muted transition-colors hover:bg-fill hover:text-danger disabled:opacity-40"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * The name, committed on blur or Enter rather than per keystroke.
 *
 * Not a convenience: the normalizer trims the name and falls an empty one back to the id, so a
 * per-keystroke commit would eat the space the author typed in the middle of "New Track" and would
 * replace a cleared field with a uuid while they were still deleting. Same shape as `DetailField`
 * on the Details sub-page, for the same reason.
 */
function TrackNameInput({
    name,
    disabled,
    onCommit,
}: {
    name: string;
    disabled: boolean;
    onCommit: (name: string) => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(name);

    useEffect(() => {
        setDraft(name);
    }, [name]);

    const commit = useCallback(() => {
        const next = draft.trim();
        if (next && next !== name) {
            onCommit(next);
        } else {
            setDraft(name);
        }
    }, [draft, name, onCommit]);

    return (
        <EnhancedInput
            value={draft}
            onChange={setDraft}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                    setDraft(name);
                    event.currentTarget.blur();
                }
            }}
            disabled={disabled}
            aria-label={t("project.audio.nameAria")}
            popoverWhenNarrow={false}
            className="w-full"
        />
    );
}

/** Two decimals, trailing zeros trimmed: `1`, `0.5`, `1.25` - never `1.00` next to `0.50`. */
function formatGain(gain: number): string {
    return String(Math.round(gain * 100) / 100);
}

/**
 * How many stored references each track has, read from the documents that can hold one.
 *
 * Reads the in-memory documents rather than the files, so the count reflects unsaved edits - the
 * same reason `ReferenceService` is renderer-side. A story that has never been opened is loaded
 * here; failures are skipped rather than propagated, because an unreadable story is already reported
 * elsewhere and must not leave this surface without a number.
 */
async function countReferences(
    context: WorkspaceContext,
    trackIds: readonly string[],
): Promise<Record<string, number>> {
    const roots: unknown[] = [];
    try {
        const storyService = context.services.get<StoryService>(Services.Story);
        for (const entry of storyService.listStories()) {
            const document = await storyService.loadStory(entry.id).catch(() => null);
            if (document) {
                roots.push(document);
            }
        }
    } catch {
        // The story library is not loaded in every context this panel can mount in.
    }
    // Each in its own guard: a document service that has not loaded contributes nothing rather than
    // costing the surface the counts the others could have provided.
    try {
        roots.push(context.services.get<UIGraphService>(Services.UIGraph).getDocument());
    } catch { /* not loaded */ }
    try {
        roots.push(context.services.get<UIDocumentService>(Services.UIDocument).getDocument());
    } catch { /* not loaded */ }

    return countAudioTrackReferences(roots, trackIds);
}
