/**
 * Project → Audio: the mixer, as a tree of buses.
 *
 * A track **is** a bus. It feeds into another bus (or straight into the master output), carries its
 * own live gain, and lends its default loop policy to the clips played on it. The three seeded ones
 * - Music, SFX, Voice - cannot be deleted, because they are where an unresolvable reference lands
 * and what the player's four volume sliders alias onto; everything else about them is the author's.
 *
 * **This surface is built on the same `SettingShell`/`SettingStack`/`SettingRow` its neighbours use,
 * and that is the point.** The first version of this panel was bare inputs and icon buttons whose
 * only label was an invisible `aria-label`, so nothing on screen said what a number meant - a review
 * called it unreadable, correctly. In an *editing* surface (a story canvas, a waveform) unlabelled
 * controls are right, because the content is the label. In project settings the control IS the
 * content, and Details / Game / Runtimes / Linting all answer that with a visible title and
 * description per control. So does this.
 *
 * Deleting a bus with children promotes them to its own parent rather than taking them with it -
 * see `AudioTrackService.deleteTrack` for why - and does not rewrite the things that pointed at it,
 * which is what the confirmation says out loud before the author commits.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CornerDownRight, Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Button, Input, Select, type SelectOption } from "@/lib/components/elements";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { AudioTrackService } from "@/lib/workspace/services/audio/AudioTrackService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import {
    audioTrackDescendantIds,
    countAudioTrackReferences,
    flattenAudioTrackTree,
    type ProjectAudioTrack,
} from "@shared/types/audioTrack";
import { useWorkspace } from "../../../context";
import { NumberField } from "./NumberField";
import { SettingRow, SettingShell, SettingStack } from "./settingRows";
import type { ProjectSectionProps } from "./types";

/**
 * Indent per level, and the level at which the indent stops growing.
 *
 * A tree in a 318px panel cannot spend 20px a level; four levels of 10px is 40px, which is enough
 * for the eye to group a child under its parent while leaving the rows readable. Past that the
 * "routes into" row is what says where a bus sits, and it says it in words.
 */
const TRACK_INDENT_PX = 10;
const TRACK_INDENT_MAX_LEVEL = 4;

/** Volume is stored 0..1 and edited 0..100, because a mixer strip reads in percent. */
const VOLUME_PERCENT_MIN = 0;
const VOLUME_PERCENT_MAX = 100;

export function ProjectAudioSection({ uiService }: ProjectSectionProps) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();

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

    // Recomputed when the id set changes rather than on every keystroke: renaming a bus or nudging
    // its volume cannot change how many things point at it, and re-reading every story document for
    // each character typed into the name field would be a scan per frame.
    // JSON rather than a delimiter join: an id is only trimmed, not restricted, so any
    // separator could in principle appear inside one and split a single track into two.
    const trackIdKey = JSON.stringify(tracks.map(track => track.id));
    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        let active = true;
        void (async () => {
            const counts = await countReferences(context, JSON.parse(trackIdKey) as string[]);
            if (active) {
                setReferences(counts);
            }
        })();
        return () => { active = false; };
    }, [context, isInitialized, trackIdKey]);

    const rows = useMemo(() => flattenAudioTrackTree(tracks), [tracks]);

    const addTrack = useCallback(() => {
        trackService?.createTrack({ name: t("project.audio.newTrackName") });
    }, [t, trackService]);

    const removeTrack = useCallback(async (track: ProjectAudioTrack) => {
        if (!trackService) {
            return;
        }
        const uses = references[track.id] ?? 0;
        const children = tracks.filter(entry => entry.parentId === track.id).length;
        const parent = track.parentId === null
            ? t("project.audio.parentMaster")
            : trackService.getTrack(track.parentId)?.name ?? t("project.audio.parentMaster");
        const detail = [
            tn("project.audio.deleteDetail", uses),
            children > 0 ? tn("project.audio.deleteChildren", children, { parent }) : null,
        ].filter(Boolean).join("\n");
        const confirmed = await uiService?.showDestructiveConfirm(
            t("project.audio.deleteConfirm", { name: track.name }),
            detail,
            t("project.audio.delete"),
        );
        if (confirmed) {
            trackService.deleteTrack(track.id);
        }
    }, [references, t, tn, trackService, tracks, uiService]);

    return (
        // `[&>*]:min-w-0` on every grid in this subtree; see the note on `SettingStack`.
        <div className="grid gap-3 [&>*]:min-w-0">
            <div className="flex justify-end">
                <Button
                    size="sm"
                    onClick={addTrack}
                    {...freeze.writes(!trackService)}
                    className="shrink-0"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {t("project.audio.add")}
                </Button>
            </div>

            {rows.map(({ track, depth }) => (
                <TrackGroup
                    key={track.id}
                    track={track}
                    depth={depth}
                    tracks={tracks}
                    service={trackService}
                    onDelete={() => void removeTrack(track)}
                />
            ))}
        </div>
    );
}

/**
 * One bus: a heading that places it in the tree, then its four controls as ordinary setting rows.
 *
 * Indented by depth and hung off a left rule, so a child bus visibly belongs to its parent without
 * the rows themselves getting narrower than the panel can show.
 */
function TrackGroup({
    track,
    depth,
    tracks,
    service,
    onDelete,
}: {
    track: ProjectAudioTrack;
    depth: number;
    tracks: readonly ProjectAudioTrack[];
    service: AudioTrackService | null;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const frozen = freeze.writes(!service);

    const parentOptions = useMemo<SelectOption[]>(() => {
        // Itself and its own descendants are excluded rather than offered and refused: a select that
        // lets the author pick a cycle and then silently re-roots the bus teaches them the control
        // is broken.
        const forbidden = audioTrackDescendantIds(tracks, track.id);
        return [
            { value: "", label: t("project.audio.parentMaster") },
            ...tracks
                .filter(entry => entry.id !== track.id && !forbidden.has(entry.id))
                .map(entry => ({ value: entry.id, label: entry.name })),
        ];
    }, [t, track.id, tracks]);

    return (
        <div
            className="grid gap-2 [&>*]:min-w-0"
            style={{ paddingLeft: Math.min(depth, TRACK_INDENT_MAX_LEVEL) * TRACK_INDENT_PX }}
        >
            <div className="flex min-w-0 items-center gap-1.5 border-l-2 border-primary/40 pl-2">
                {depth > 0 && <CornerDownRight className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />}
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{track.name}</h3>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => service?.duplicateTrack(track.id)}
                    {...freeze.writes(!service)}
                    className="shrink-0 px-1.5"
                >
                    {t("project.audio.duplicate")}
                </Button>
                {track.builtin ? null : (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={onDelete}
                        {...freeze.writes(!service)}
                        className="shrink-0 px-1.5 hover:text-danger"
                    >
                        {t("project.audio.delete")}
                    </Button>
                )}
            </div>

            <SettingStack
                title={t("project.audio.nameTitle")}
                description={t("project.audio.nameDescription")}
                titleAttr={frozen.title}
            >
                <TrackNameField
                    name={track.name}
                    disabled={frozen.disabled}
                    label={t("project.audio.nameTitle")}
                    onCommit={name => service?.renameTrack(track.id, name)}
                />
            </SettingStack>

            <SettingStack
                title={t("project.audio.parentTitle")}
                description={t("project.audio.parentDescription")}
                titleAttr={frozen.title}
            >
                <Select
                    size="sm"
                    fullWidth
                    portalMenu
                    className="min-w-0"
                    options={parentOptions}
                    value={track.parentId ?? ""}
                    disabled={frozen.disabled}
                    ariaLabel={t("project.audio.parentTitle")}
                    onChange={value => service?.reparentTrack(track.id, String(value) || null)}
                />
            </SettingStack>

            <SettingShell
                title={t("project.audio.volumeTitle")}
                description={t("project.audio.volumeDescription")}
                titleAttr={frozen.title}
            >
                <NumberField
                    value={Math.round(track.volume * 100)}
                    min={VOLUME_PERCENT_MIN}
                    max={VOLUME_PERCENT_MAX}
                    unit={t("project.audio.volumeUnit")}
                    disabled={frozen.disabled}
                    ariaLabel={t("project.audio.volumeTitle")}
                    onCommit={percent => service?.updateTrack(track.id, { volume: percent / 100 })}
                />
            </SettingShell>

            <SettingRow
                title={t("project.audio.loopTitle")}
                description={t("project.audio.loopDescription")}
                checked={track.loop}
                loading={false}
                disabled={!service}
                onChange={loop => service?.updateTrack(track.id, { loop })}
            />
        </div>
    );
}

/**
 * The name, committed on blur or Enter rather than per keystroke.
 *
 * Not a convenience: the service trims the name and refuses a blank one, so a per-keystroke commit
 * would eat the space the author typed in the middle of "New Track" and would reject the field the
 * moment they cleared it to retype. Same shape as `NumberField` on the Game sub-page, for the same
 * reason.
 */
function TrackNameField({
    name,
    disabled,
    label,
    onCommit,
}: {
    name: string;
    disabled: boolean;
    label: string;
    onCommit: (name: string) => void;
}) {
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
        <Input
            size="sm"
            value={draft}
            disabled={disabled}
            aria-label={label}
            className="w-full min-w-0"
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    setDraft(name);
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

/**
 * How many stored references each bus has, read from the documents that can hold one.
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
