/**
 * Project → Audio: the mixer, as a tree of buses.
 *
 * A track **is** a bus. It feeds into another bus (or straight into the master output), carries its
 * own live gain, and lends its default loop policy to the clips played on it. The three seeded ones
 * - Music, SFX, Voice - cannot be deleted, because they are where an unresolvable reference lands
 * and what the player's four volume sliders alias onto; everything else about them is the author's.
 *
 * **This is a list of many similar items, so it is built on `Accordion` - the same disclosure the
 * assets, character and story panels use - and not on the `SettingShell` rows its sibling sub-pages
 * use.** That was the previous shape and it was wrong: four bordered cards per track, each with its
 * own title and description paragraph, is ~360px of panel per bus and the same three paragraphs
 * repeated verbatim on every one of them. Three tracks overflowed the panel, and the feature's own
 * headline case - a bus per character - was unusable. `SettingShell` is right for a settings *page*
 * with a handful of unrelated switches; it is wrong for N of the same thing.
 *
 * What survives from that round is the requirement that produced it: **every control keeps a visible
 * label as well as an accessible name**. The labels are now inside the disclosure, one compact
 * group per bus, and the explanations that used to be per-field are stated once at the top of the
 * section - a paragraph that appears N times is noise, the same paragraph once is documentation.
 *
 * Deleting a bus with children promotes them to its own parent rather than taking them with it -
 * see `AudioTrackService.deleteTrack` for why - and does not rewrite the things that pointed at it,
 * which is what the confirmation says out loud before the author commits.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Button, HintPopover, Input, Select, Slider, Switch, type SelectOption } from "@/lib/components/elements";
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
import type { ProjectSectionProps } from "./types";

/**
 * The level at which the indent stops growing. `Accordion` indents 12px a level, and a 318px panel
 * that can be squeezed to ~190px cannot spend more than four of those on depth before the name has
 * nowhere left to go. Past level 4 two different depths look alike and the expanded "Routes into"
 * field is what says where the bus sits, in words.
 */
const TRACK_INDENT_MAX_LEVEL = 4;
const TRACK_INDENT_PX = 12;

/**
 * How far the *body* follows the row's indent. Two levels, not four.
 *
 * The indent on the collapsed row is the tree and has to be paid for; the body is already attached
 * to the row above it and only needs enough offset to read as belonging to it. Measured: at a 190px
 * panel a depth-4 bus gave its fields 108px, which is narrower than Duplicate + Delete side by side,
 * so the full indent bought legibility the fields could not afford.
 */
const TRACK_BODY_INDENT_MAX_LEVEL = 2;

/** Volume is stored 0..1 and edited 0..100, because a mixer strip reads in percent. */
const VOLUME_PERCENT_MIN = 0;
const VOLUME_PERCENT_MAX = 100;

/**
 * Clamps that keep this subtree from widening the panel.
 *
 * A flex/grid item's `min-width` defaults to `auto`, i.e. its min-content - and an `<input>`
 * contributes its intrinsic `size` attribute width (~258px) to that, which `min-w-0` on the input
 * itself does NOT remove from the parent's contribution. `Accordion` owns the header's flex chain,
 * so the clamp for it has to be applied from outside via `headerClassName`; without it a long bus
 * name pushes the whole sub-page into horizontal scroll.
 */
const HEADER_WIDTH_CLAMP = "min-w-0 [&>button]:min-w-0 [&>button>span]:min-w-0";

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
    /**
     * Collapsed is the default: the list opens as one row per bus, and nothing is expanded until the
     * author asks. A bus the author just created is the one exception - they made it to name it.
     */
    const [openIds, setOpenIds] = useState<string[]>([]);

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

    // Filtered rather than pruned in an effect: a deleted bus's id would otherwise sit in the open
    // set and re-open a later track that happened to be handed the same id.
    const openItems = useMemo(() => {
        const known = new Set(tracks.map(track => track.id));
        return openIds.filter(id => known.has(id));
    }, [openIds, tracks]);

    const addTrack = useCallback(() => {
        const created = trackService?.createTrack({ name: t("project.audio.newTrackName") });
        if (created) {
            setOpenIds(prev => [...prev, created.id]);
        }
    }, [t, trackService]);

    const duplicateTrack = useCallback((id: string) => {
        const created = trackService?.duplicateTrack(id);
        if (created) {
            setOpenIds(prev => [...prev, created.id]);
        }
    }, [trackService]);

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
        // `[&>*]:min-w-0` on every grid in this subtree; see HEADER_WIDTH_CLAMP.
        <div className="grid gap-3 [&>*]:min-w-0">
            {/*
              * The explanation, once. It used to be three paragraphs repeated per track, which is
              * how a three-bus project came to be a wall of prose. Here it reads as what it is:
              * what a bus is, and how the mix multiplies.
              */}
            <p className="text-2xs leading-relaxed text-fg-subtle">{t("project.audio.intro")}</p>

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

            <div className="min-w-0 border-t border-edge">
                <Accordion
                    className="min-w-0"
                    multiple
                    openItems={openItems}
                    onOpenChange={setOpenIds}
                >
                    {rows.map(({ track, depth }) => (
                        <TrackItem
                            key={track.id}
                            track={track}
                            depth={depth}
                            tracks={tracks}
                            service={trackService}
                            uses={references[track.id] ?? 0}
                            onDuplicate={() => duplicateTrack(track.id)}
                            onDelete={() => void removeTrack(track)}
                        />
                    ))}
                </Accordion>
            </div>
        </div>
    );
}

/**
 * One bus: a single collapsed row, and its fields as one group behind the disclosure.
 *
 * The collapsed row carries the three things an author scans a mixer for - which bus, where it sits
 * in the tree, how loud it is - and nothing else. Depth is the `Accordion`'s own indent, so a child
 * bus lines up under its parent exactly the way a group does in the assets panel.
 */
function TrackItem({
    track,
    depth,
    tracks,
    service,
    uses,
    onDuplicate,
    onDelete,
}: {
    track: ProjectAudioTrack;
    depth: number;
    tracks: readonly ProjectAudioTrack[];
    service: AudioTrackService | null;
    uses: number;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard();
    const frozen = freeze.writes(!service);

    /**
     * The volume the surface is showing, which is the stored one except while a drag is in flight.
     *
     * Held here rather than inside the field so the collapsed row's readout and the expanded
     * slider are never a frame apart - both are visible at once while the bus is open, and a header
     * that lags the slider under it reads as a broken control. The service is written on release
     * (see {@link Slider.onValueCommit}), not per pointer move, so a drag costs one document
     * revision rather than sixty.
     */
    const storedPercent = Math.round(track.volume * 100);
    const [draftPercent, setDraftPercent] = useState(storedPercent);
    useEffect(() => {
        setDraftPercent(storedPercent);
    }, [storedPercent]);

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

    const level = Math.min(depth, TRACK_INDENT_MAX_LEVEL);

    return (
        <AccordionItem
            id={track.id}
            level={level}
            className="min-w-0"
            headerClassName={HEADER_WIDTH_CLAMP}
            contentClassName="min-w-0"
            headerProps={{
                // The row's handle: verification, and anything that later has to find a bus on
                // screen, reads this rather than matching a translated label.
                "data-audio-track": track.id,
            }}
            title={
                <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-fg">{track.name}</span>
                    <VolumeReadout
                        percent={draftPercent}
                        title={`${t("project.audio.volumeTitle")} ${draftPercent}${t("project.audio.volumeUnit")}`}
                    />
                </span>
            }
        >
            {/*
              * `Accordion` listens for Enter/Space on `window` to toggle the focused row, and its
              * only exemption is for real `input`/`textarea`/`select` elements. `Select` and
              * `Switch` are buttons, so without this a Space on the loop switch would collapse the
              * bus instead of toggling it. Scoped to the two keys the accordion consumes, so
              * application keybindings still reach the window from inside an open bus.
              */}
            <div
                className="grid gap-2.5 bg-fill-subtle py-2.5 pr-3 [&>*]:min-w-0"
                style={{
                    paddingLeft: TRACK_INDENT_PX
                        + Math.min(level, TRACK_BODY_INDENT_MAX_LEVEL) * TRACK_INDENT_PX,
                }}
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                    }
                }}
            >
                <Field label={t("project.audio.nameTitle")}>
                    <TrackNameField
                        name={track.name}
                        disabled={frozen.disabled}
                        label={t("project.audio.nameTitle")}
                        onCommit={name => service?.renameTrack(track.id, name)}
                    />
                </Field>

                <Field label={t("project.audio.parentTitle")}>
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
                </Field>

                <Field
                    label={t("project.audio.volumeTitle")}
                    trailing={
                        <span className="shrink-0 tabular-nums text-2xs text-fg-muted">
                            {draftPercent}{t("project.audio.volumeUnit")}
                        </span>
                    }
                >
                    <Slider
                        value={draftPercent}
                        min={VOLUME_PERCENT_MIN}
                        max={VOLUME_PERCENT_MAX}
                        step={1}
                        disabled={frozen.disabled}
                        title={frozen.title}
                        aria-label={t("project.audio.volumeTitle")}
                        onValueChange={setDraftPercent}
                        onValueCommit={percent => service?.updateTrack(track.id, { volume: percent / 100 })}
                    />
                </Field>

                <div className="flex min-w-0 items-center justify-between gap-2" title={frozen.title}>
                    <span className="flex min-w-0 items-center gap-1 text-2xs font-medium text-fg-muted">
                        <span className="truncate">{t("project.audio.loopTitle")}</span>
                        {/*
                          * The one per-field explanation that survives as prose, and it is behind an
                          * icon rather than on screen: what "routes into" and "volume" mean is in the
                          * section intro, but a loop *default* is a policy the label alone does not
                          * state.
                          */}
                        <HintPopover text={t("project.audio.loopDescription")} />
                    </span>
                    <Switch
                        size="sm"
                        checked={track.loop}
                        disabled={frozen.disabled}
                        onCheckedChange={loop => service?.updateTrack(track.id, { loop })}
                        aria-label={t("project.audio.loopTitle")}
                    />
                </div>

                {/*
                  * How many stored references point here sits next to Delete rather than in the row,
                  * because that is the only question it answers: what the confirmation is about to
                  * tell the author will fall back to a default bus.
                  */}
                {/*
                  * The buttons wrap, the row does not. Squeezed to ~190px with another panel open,
                  * a nested bus has less body width than Duplicate and Delete side by side, and a
                  * group that refuses to wrap pushes the whole sub-page into horizontal scroll -
                  * measured, 20px of it. `flex-wrap` on the *row* would fix that too and costs 20px
                  * of height on every open bus at full width, because flexbox wraps on content size
                  * before it shrinks anything: the count would jump to its own line rather than
                  * ellipsing. So the row stays one line and the count is what gives way.
                  */}
                <div className="flex min-w-0 items-center justify-between gap-2 border-t border-edge pt-2">
                    <span className="min-w-0 truncate text-2xs text-fg-subtle">
                        {tn("project.audio.usedBy", uses)}
                    </span>
                    {/*
                      * `shrink-0` so the count gives way first, `max-w-full` so the pair still
                      * wraps once even that is not enough. Without `shrink-0` flexbox shrinks both
                      * items in proportion, which wrapped the buttons - and cost 28px of height -
                      * on every nested bus at full width, where they fit perfectly well.
                      */}
                    <span className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onDuplicate}
                            {...freeze.writes(!service)}
                            className="px-1.5"
                        >
                            {t("project.audio.duplicate")}
                        </Button>
                        {track.builtin ? null : (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={onDelete}
                                {...freeze.writes(!service)}
                                className="px-1.5 hover:text-danger"
                            >
                                {t("project.audio.delete")}
                            </Button>
                        )}
                    </span>
                </div>
            </div>
        </AccordionItem>
    );
}

/**
 * A labelled field inside a bus.
 *
 * The label is visible *and* every control below carries its own accessible name, which is the
 * requirement this surface was rebuilt under - a control whose only label is an `aria-label` says
 * nothing on screen. It is a `div` rather than a `label` on purpose: wrapping `Select` in a `label`
 * makes the click that picks an option re-open the menu, because the label re-dispatches it to the
 * trigger.
 */
function Field({
    label,
    trailing,
    children,
}: {
    label: string;
    trailing?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="grid min-w-0 gap-1 [&>*]:min-w-0">
            <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-2xs font-medium text-fg-muted">{label}</span>
                {trailing}
            </div>
            {children}
        </div>
    );
}

/**
 * The collapsed row's volume: a gain bar and the number.
 *
 * Not a `Slider`, even though volume is the one value a mixer is scanned for and a slider is what
 * reads at a glance. The row's whole surface is `Accordion`'s disclosure `<button>` - a range input
 * inside it would be invalid nesting and the button would swallow the drag - and the header's other
 * slot (`actions`) is revealed on hover, which is exactly what "scannable" rules out. So the row
 * carries the *reading* a slider would give and the real `Slider` lives one click away, in the body.
 */
function VolumeReadout({ percent, title }: { percent: number; title: string }) {
    return (
        // `gap-1`, not `gap-1.5`: measured, the wider gap put the readout 1.6px past the section's
        // right edge at a 190px panel with a depth-4 bus open and a scrollbar showing.
        <span className="flex shrink-0 items-center gap-1" title={title}>
            <span
                aria-hidden="true"
                className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-fill-strong"
            >
                <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${percent}%` }}
                />
            </span>
            <span className="w-7 shrink-0 text-right tabular-nums text-2xs text-fg-muted">{percent}%</span>
        </span>
    );
}

/**
 * The name, committed on blur or Enter rather than per keystroke.
 *
 * Not a convenience: the service trims the name and refuses a blank one, so a per-keystroke commit
 * would eat the space the author typed in the middle of "New Track" and would reject the field the
 * moment they cleared it to retype.
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
