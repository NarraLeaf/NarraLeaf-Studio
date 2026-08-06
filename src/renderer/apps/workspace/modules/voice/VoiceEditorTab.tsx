/**
 * Voice table editor (editor-area tab, one per voice language). Rows follow the
 * story's narrative order so a director reads lines in context. Two grouping
 * axes share the same data: "by scene" is the writer's view; "by character" is
 * the recording view — a voice actor's lines gathered across the whole game,
 * which is how imported takes are actually organised.
 *
 * Studio imports audio; it never records. Assigning a line means linking it to
 * an audio asset already in the library — dropped from the Assets panel or
 * picked from the library. Two modes mirror the localization table: "assign"
 * links clips; "audition" is a focused listen-and-approve pass.
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AudioLines, CheckCircle2, ListMusic, Mic, PenLine } from "lucide-react";
import type { EditorComponentProps } from "../types";
import { Select, type SelectOption } from "@/lib/components/elements";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "../../context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import { deriveVoiceUnitState, type VoiceUnitState } from "@/lib/workspace/services/voice/voiceModel";
import { formatVoiceDuration, readAudioDuration } from "@/lib/workspace/services/voice/audioDuration";
import type { StoryTranslationRow } from "@/lib/workspace/services/localization/localizationModel";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { StoryLibraryEntry } from "@shared/types/story";
import type { VoiceConfiguration, VoiceDocument } from "@shared/types/voice";
import { buildAssetNameKeyMap, voiceMatchKeyForEntry, withSceneIndices } from "@/lib/workspace/services/voice/voiceScript";
import type { VoiceEditorTabPayload } from "./voiceEditorTabId";
import { VoiceRow, type VoiceTableRow } from "./VoiceRows";

type EditorMode = "assign" | "audition";
type GroupAxis = "scene" | "character";
type RowFilter = "all" | "missing" | "outdated" | "voiced" | "approved";
type AuditionFilter = "all" | "approved" | "pending";

const NARRATION_GROUP_KEY = "__narration__";

/** Starting estimates for the windowed list; every item re-measures itself once it mounts. */
const GROUP_ROW_HEIGHT_PX = 26;
const VOICE_ROW_HEIGHT_PX = 37;

type TableRow = VoiceTableRow & { speaker: string; indexInScene: number };

export function VoiceEditorTab({ payload, active }: EditorComponentProps<VoiceEditorTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const { t } = useTranslation();
    // The rows guard themselves (see `VoiceRows`); the cast name in the group header is the one
    // writing control this shell owns.
    const freeze = useFreezeGuard();
    const locale = payload?.locale ?? "";

    const voiceService = useMemo(
        () => (context && isInitialized ? context.services.get<VoiceService>(Services.Voice) : null),
        [context, isInitialized],
    );
    const storyService = useMemo(
        () => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null),
        [context, isInitialized],
    );
    const characterService = useMemo(
        () => (context && isInitialized ? context.services.get<CharacterService>(Services.Character) : null),
        [context, isInitialized],
    );
    const uiService = useMemo(
        () => (context && isInitialized ? context.services.get<UIService>(Services.UI) : null),
        [context, isInitialized],
    );
    const assetsService = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    const localizationService = useMemo(
        () => (context && isInitialized ? context.services.get<LocalizationService>(Services.Localization) : null),
        [context, isInitialized],
    );

    const [stories, setStories] = useState<StoryLibraryEntry[]>([]);
    const [characters, setCharacters] = useState<{ id: string; name: string }[]>([]);
    const [storyId, setStoryId] = useState<string | null>(null);
    const [rows, setRows] = useState<TableRow[]>([]);
    const [voiceDoc, setVoiceDoc] = useState<VoiceDocument | null>(null);
    const [config, setConfig] = useState<VoiceConfiguration | null>(null);
    const [mode, setMode] = useState<EditorMode>("assign");
    const [groupAxis, setGroupAxis] = useState<GroupAxis>("scene");
    const [filter, setFilter] = useState<RowFilter>("all");
    const [auditionFilter, setAuditionFilter] = useState<AuditionFilter>("pending");
    const [assetsRev, setAssetsRev] = useState(0);

    // Clip playback: one lazily-created audio element, one active object URL.
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const [playingUnitId, setPlayingUnitId] = useState<string | null>(null);

    // Import (asset picker) state, anchored under the row that opened it.
    const [selector, setSelector] = useState<{ unitId: string; sourceText: string; currentAssetId?: string } | null>(null);
    const selectorAnchorRef = useRef<HTMLElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    const speakerNameFor = useCallback((row: StoryTranslationRow): string => {
        if (row.role === "narration") {
            return t("workspace.voice.table.narrationSpeaker");
        }
        if (row.characterId) {
            const character = characterService?.getCharacter(row.characterId);
            if (character) {
                return character.profile.getName();
            }
        }
        return t("workspace.voice.table.narrationSpeaker");
    }, [characterService, t]);

    // Story list + default selection.
    useEffect(() => {
        if (!storyService) {
            return;
        }
        const read = () => {
            const entries = storyService.listStories();
            setStories(entries);
            setStoryId(current => {
                if (current && entries.some(entry => entry.id === current)) {
                    return current;
                }
                return storyService.getDefaultStoryId() ?? entries[0]?.id ?? null;
            });
        };
        read();
        return storyService.onLibraryChanged(read);
    }, [storyService]);

    // Voice configuration (casting + display names).
    useEffect(() => {
        if (!voiceService) {
            return;
        }
        setConfig(voiceService.getConfiguration());
        return voiceService.onConfigChanged(setConfig);
    }, [voiceService]);

    // Character roster (speaker names).
    useEffect(() => {
        if (!characterService) {
            return;
        }
        const read = () => {
            setCharacters(characterService.listCharacter().map(character => ({
                id: character.profile.getId(),
                name: character.profile.getName(),
            })));
        };
        read();
        return characterService.subscribe(read);
    }, [characterService]);

    // Refresh clip-name resolution when the asset library changes.
    useEffect(() => {
        if (!assetsService) {
            return;
        }
        const events = assetsService.getEvents();
        const bump = () => setAssetsRev(rev => rev + 1);
        const off1 = events.on("updated", bump);
        const off2 = events.on("deleted", bump);
        return () => {
            off1();
            off2();
        };
    }, [assetsService]);

    // Voiceable rows of the selected story, in narrative order.
    //
    // The row's text is what an actor for THIS language reads, so the extraction depends on the
    // locale's translation table as much as on the story - and re-runs when either moves.
    useEffect(() => {
        if (!voiceService || !storyService || !storyId || !locale) {
            setRows([]);
            return;
        }
        let disposed = false;
        const extract = () => {
            try {
                const document = storyService.getStoryDocument(storyId);
                // `withSceneIndices` because the naming pattern's `{index}` is a line's position
                // within its own scene - the same number the exported recording script carries, so
                // the assign picker and the booth's filenames agree.
                setRows(withSceneIndices(voiceService.extractRows(document)).map(row => {
                    const scriptText = voiceService.getLineText(locale, row.unitId, row.sourceText);
                    return {
                        unitId: row.unitId,
                        sourceText: scriptText,
                        ...(scriptText !== row.sourceText ? { authoredText: row.sourceText } : {}),
                        sceneId: row.sceneId,
                        sceneName: row.sceneName,
                        indexInScene: row.indexInScene,
                        role: row.role,
                        ...(row.characterId ? { characterId: row.characterId } : {}),
                        speaker: speakerNameFor(row),
                    };
                }));
            } catch {
                setRows([]);
            }
        };
        void Promise.all([storyService.loadStory(storyId), voiceService.loadLineTexts(locale)]).then(() => {
            if (!disposed) {
                extract();
            }
        }).catch(() => setRows([]));
        const unsubscribeStory = storyService.onDocumentChanged(event => {
            if (event.storyId === storyId) {
                extract();
            }
        });
        const unsubscribeTranslation = localizationService?.onDocumentChanged(event => {
            if (event.locale === locale) {
                extract();
            }
        });
        return () => {
            disposed = true;
            unsubscribeStory();
            unsubscribeTranslation?.();
        };
    }, [voiceService, storyService, localizationService, storyId, locale, speakerNameFor, characters]);

    // Voice document for this language.
    useEffect(() => {
        if (!voiceService || !locale) {
            setVoiceDoc(null);
            return;
        }
        let disposed = false;
        void voiceService.loadDocument(locale).then(document => {
            if (!disposed) {
                setVoiceDoc(document);
            }
        }).catch(() => setVoiceDoc(null));
        const unsubscribe = voiceService.onDocumentChanged(event => {
            if (event.locale === locale) {
                setVoiceDoc(event.document);
            }
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [voiceService, locale]);

    const stopPlayback = useCallback(() => {
        audioRef.current?.pause();
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
        setPlayingUnitId(null);
    }, []);

    // Flush pending writes and stop audio when the tab goes to the background.
    useEffect(() => {
        if (!active) {
            stopPlayback();
            if (voiceService) {
                void voiceService.flushPendingChanges();
            }
        }
    }, [active, voiceService, stopPlayback]);

    useEffect(() => stopPlayback, [stopPlayback]);

    const resolveAsset = useCallback((assetId: string | undefined): Asset | null => {
        if (!assetId || !assetsService) {
            return null;
        }
        // assetsRev participates so a rename/delete re-resolves.
        void assetsRev;
        return assetsService.getAssets()[AssetType.Audio]?.[assetId] ?? null;
    }, [assetsService, assetsRev]);

    const togglePlay = useCallback(async (unitId: string, asset: Asset | null) => {
        if (playingUnitId === unitId) {
            stopPlayback();
            return;
        }
        stopPlayback();
        if (!asset || !assetsService) {
            return;
        }
        try {
            const result = await assetsService.fetch(asset);
            if (!result.success) {
                uiService?.showNotification(result.error || t("workspace.voice.table.clipMissing"), "warning");
                return;
            }
            const blob = new Blob([new Uint8Array((result.data as { data: Uint8Array }).data)]);
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            let audio = audioRef.current;
            if (!audio) {
                audio = new Audio();
                audioRef.current = audio;
            }
            audio.src = url;
            audio.onended = () => stopPlayback();
            setPlayingUnitId(unitId);
            await audio.play();
        } catch {
            stopPlayback();
        }
    }, [playingUnitId, stopPlayback, assetsService, uiService, t]);

    const assignAsset = useCallback((unitId: string, sourceText: string, assetId: string) => {
        voiceService?.updateUnit(locale, unitId, sourceText, { assetId });
        // Measured after the link lands, not before it: the link is the author's action and must not
        // wait on decoding a header. A patch carrying only `duration` never re-stamps the source
        // hash, so this cannot quietly un-stale the line it just measured.
        void (async () => {
            const asset = assetsService?.getAssets()[AssetType.Audio]?.[assetId];
            if (!asset || !assetsService) {
                return;
            }
            const result = await assetsService.fetch(asset);
            if (!result.success) {
                return;
            }
            const duration = await readAudioDuration(new Uint8Array((result.data as { data: Uint8Array }).data));
            if (duration !== undefined) {
                voiceService?.updateUnit(locale, unitId, sourceText, { duration });
            }
        })();
    }, [voiceService, assetsService, locale]);

    const setNote = useCallback((unitId: string, sourceText: string, note: string) => {
        voiceService?.updateUnit(locale, unitId, sourceText, { note });
    }, [voiceService, locale]);

    /**
     * Library name -> asset id, for the audio the project already holds.
     *
     * Keyed off `assetsRev` so a rename or a fresh import is reflected without reopening the tab.
     * Named assets only: the key is built from the name the asset carries **in the library**, which
     * is what an author sees and can fix, rather than the filename it happened to arrive under.
     */
    const assetNameKeys = useMemo(() => {
        void assetsRev;
        const audio = assetsService?.getAssets()[AssetType.Audio] ?? {};
        return buildAssetNameKeyMap(Object.values(audio).map(asset => ({ id: asset.id, name: asset.name })));
    }, [assetsService, assetsRev]);

    /**
     * The clip this line would have been recorded as, if the project already holds it.
     *
     * The whole point of the naming pattern is that a line and its take share a name, so when a
     * director opens the picker on an unassigned line the answer is usually already in the library -
     * pre-selecting it turns "find the file among three hundred" into "press Enter". Nothing is
     * written until they confirm.
     */
    const matchingAssetIdFor = useCallback((row: TableRow): string | undefined => {
        if (!config) {
            return undefined;
        }
        const key = voiceMatchKeyForEntry({
            unitId: row.unitId,
            sceneName: row.sceneName,
            indexInScene: row.indexInScene,
            speaker: row.speaker,
            sourceText: row.sourceText,
        }, config.namingPattern, locale);
        return key ? assetNameKeys.get(key) : undefined;
    }, [assetNameKeys, config, locale]);

    const rowStates = useMemo(() => {
        const states = new Map<string, VoiceUnitState>();
        for (const row of rows) {
            states.set(row.unitId, deriveVoiceUnitState(voiceDoc?.units[row.unitId], row.sourceText));
        }
        return states;
    }, [rows, voiceDoc]);

    const counts = useMemo(() => {
        let missing = 0;
        let voiced = 0;
        let approved = 0;
        let outdated = 0;
        for (const state of rowStates.values()) {
            if (state === "missing") missing += 1;
            else if (state === "stale") outdated += 1;
            else if (state === "approved") approved += 1;
            else voiced += 1;
        }
        const clips = voiced + approved + outdated;
        return { all: rowStates.size, missing, voiced, approved, outdated, clips };
    }, [rowStates]);

    const visibleRows = useMemo(() => {
        if (mode === "audition") {
            const withClips = rows.filter(row => (rowStates.get(row.unitId) ?? "missing") !== "missing");
            if (auditionFilter === "approved") {
                return withClips.filter(row => rowStates.get(row.unitId) === "approved");
            }
            if (auditionFilter === "pending") {
                return withClips.filter(row => rowStates.get(row.unitId) === "linked");
            }
            return withClips;
        }
        if (filter === "all") {
            return rows;
        }
        return rows.filter(row => {
            const state = rowStates.get(row.unitId) ?? "missing";
            if (filter === "missing") return state === "missing";
            if (filter === "outdated") return state === "stale";
            if (filter === "approved") return state === "approved";
            return state === "linked"; // "voiced"
        });
    }, [rows, rowStates, mode, filter, auditionFilter]);

    const groups = useMemo(() => {
        type Group = { key: string; name: string; characterId?: string; rows: TableRow[] };
        if (groupAxis === "scene") {
            const out: Group[] = [];
            for (const row of visibleRows) {
                const last = out[out.length - 1];
                if (last && last.key === row.sceneId) {
                    last.rows.push(row);
                } else {
                    out.push({ key: row.sceneId, name: row.sceneName, rows: [row] });
                }
            }
            return out;
        }
        // Character axis: bucket by speaker, first-appearance order, narrative order inside.
        const order: Group[] = [];
        const byKey = new Map<string, Group>();
        for (const row of visibleRows) {
            const key = row.role === "narration" ? NARRATION_GROUP_KEY : (row.characterId ?? `name:${row.speaker}`);
            let group = byKey.get(key);
            if (!group) {
                group = {
                    key,
                    name: row.role === "narration" ? t("workspace.voice.table.narrationGroup") : row.speaker,
                    ...(row.role === "dialogue" && row.characterId ? { characterId: row.characterId } : {}),
                    rows: [],
                };
                byKey.set(key, group);
                order.push(group);
            }
            group.rows.push(row);
        }
        return order;
    }, [visibleRows, groupAxis, t]);

    /**
     * Groups and rows flattened into one windowed list.
     *
     * A fully-voiced commercial VN is tens of thousands of lines and this table used to render every
     * one of them as DOM - a table that is unusable on exactly the projects that need it most. Same
     * shape as the lint and test reports: fixed-estimate items, absolutely positioned. The group
     * header gives up `position: sticky` in the trade, because a sticky child of an absolutely
     * positioned item has nothing to stick to.
     */
    const flatItems = useMemo(() => {
        const items: ({ key: string } & (
            | { kind: "group"; name: string; characterId?: string }
            | { kind: "row"; row: TableRow }
        ))[] = [];
        for (const group of groups) {
            items.push({
                kind: "group",
                key: `g:${group.key}:${group.rows[0]?.unitId ?? ""}`,
                name: group.name,
                ...(group.characterId ? { characterId: group.characterId } : {}),
            });
            for (const row of group.rows) {
                items.push({ kind: "row", key: `r:${row.unitId}`, row });
            }
        }
        return items;
    }, [groups]);

    const virtualizer = useVirtualizer({
        count: flatItems.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: index => (flatItems[index]?.kind === "group" ? GROUP_ROW_HEIGHT_PX : VOICE_ROW_HEIGHT_PX),
        overscan: 16,
        getItemKey: index => flatItems[index]?.key ?? index,
    });

    const rowStrings = useMemo(() => ({
        assign: t("workspace.voice.table.assign"),
        replace: t("workspace.voice.table.replace"),
        remove: t("workspace.voice.table.remove"),
        play: t("workspace.voice.table.play"),
        stop: t("workspace.voice.table.stop"),
        approve: t("workspace.voice.table.approve"),
        reject: t("workspace.voice.table.reject"),
        clipMissing: t("workspace.voice.table.clipMissing"),
        outdatedHint: t("workspace.voice.table.outdatedHint"),
        dropHint: t("workspace.voice.table.dropHint"),
        statusVoiced: t("workspace.voice.table.statusVoiced"),
        statusApproved: t("workspace.voice.table.statusApproved"),
        statusOutdated: t("workspace.voice.table.statusOutdated"),
        notePlaceholder: t("workspace.voice.table.notePlaceholder"),
    }), [t]);

    const localeDisplayName = useMemo(() => {
        const config = voiceService?.getConfiguration();
        return config?.voicedLocales.find(entry => entry.code === locale)?.displayName ?? locale;
    }, [voiceService, locale]);

    const storyOptions: SelectOption[] = useMemo(
        () => stories.map(entry => ({ value: entry.id, label: entry.name })),
        [stories],
    );

    const filterOptions: SelectOption[] = useMemo(() => [
        { value: "all", label: `${t("workspace.voice.table.filterAll")} (${counts.all})` },
        { value: "missing", label: `${t("workspace.voice.table.filterMissing")} (${counts.missing})` },
        { value: "outdated", label: `${t("workspace.voice.table.filterOutdated")} (${counts.outdated})` },
        { value: "voiced", label: `${t("workspace.voice.table.filterVoiced")} (${counts.voiced})` },
        { value: "approved", label: `${t("workspace.voice.table.filterApproved")} (${counts.approved})` },
    ], [counts, t]);

    const auditionFilterOptions: SelectOption[] = useMemo(() => [
        { value: "all", label: `${t("workspace.voice.table.auditionFilterAll")} (${counts.clips})` },
        { value: "pending", label: `${t("workspace.voice.table.auditionFilterPending")} (${counts.voiced})` },
        { value: "approved", label: `${t("workspace.voice.table.auditionFilterApproved")} (${counts.approved})` },
    ], [counts, t]);

    const groupAxisOptions: { key: GroupAxis; label: string; icon: React.ReactNode }[] = [
        { key: "scene", label: t("workspace.voice.table.groupByScene"), icon: <ListMusic className="h-3.5 w-3.5" /> },
        { key: "character", label: t("workspace.voice.table.groupByCharacter"), icon: <AudioLines className="h-3.5 w-3.5" /> },
    ];

    const modeOptions: { key: EditorMode; label: string; icon: React.ReactNode }[] = [
        { key: "assign", label: t("workspace.voice.table.modeAssign"), icon: <PenLine className="h-3.5 w-3.5" /> },
        { key: "audition", label: t("workspace.voice.table.modeAudition"), icon: <AudioLines className="h-3.5 w-3.5" /> },
    ];

    if (!locale) {
        return null;
    }

    const auditionQueueEmpty = mode === "audition" && auditionFilter === "pending" && counts.clips > 0 && visibleRows.length === 0;

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex items-center gap-3 border-b border-edge px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Mic className="h-4 w-4 shrink-0 text-fg-muted" />
                    <span className="truncate text-sm font-medium text-fg">{localeDisplayName}</span>
                    <span className="rounded-md border border-edge px-1.5 py-0.5 text-2xs text-fg-subtle">{locale}</span>
                </div>
                <div className="ml-auto flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-2xs text-fg-subtle">{t("workspace.voice.table.storyLabel")}</span>
                        <Select
                            options={storyOptions}
                            value={storyId ?? undefined}
                            onChange={value => setStoryId(String(value))}
                            size="sm"
                            portalMenu
                            className="w-40"
                        />
                    </div>
                    <div className="flex items-center rounded-md bg-surface-sunken p-0.5">
                        {groupAxisOptions.map(option => (
                            <button
                                key={option.key}
                                type="button"
                                aria-pressed={groupAxis === option.key}
                                onClick={() => setGroupAxis(option.key)}
                                title={option.label}
                                className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
                                    groupAxis === option.key ? "bg-surface-raised text-fg shadow-sm" : "text-fg-muted hover:text-fg"
                                }`}
                            >
                                {option.icon}
                                {option.label}
                            </button>
                        ))}
                    </div>
                    {mode === "assign" ? (
                        <Select
                            options={filterOptions}
                            value={filter}
                            onChange={value => setFilter(value as RowFilter)}
                            size="sm"
                            portalMenu
                            className="w-32"
                        />
                    ) : (
                        <Select
                            options={auditionFilterOptions}
                            value={auditionFilter}
                            onChange={value => setAuditionFilter(value as AuditionFilter)}
                            size="sm"
                            portalMenu
                            className="w-32"
                        />
                    )}
                    <div className="flex items-center rounded-md bg-surface-sunken p-0.5">
                        {modeOptions.map(option => (
                            <button
                                key={option.key}
                                type="button"
                                aria-pressed={mode === option.key}
                                onClick={() => setMode(option.key)}
                                className={`flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
                                    mode === option.key ? "bg-surface-raised text-fg shadow-sm" : "text-fg-muted hover:text-fg"
                                }`}
                            >
                                {option.icon}
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {stories.length === 0 ? (
                    <EmptyMessage icon={<Mic className="h-5 w-5" />} text={t("workspace.voice.table.noStories")} />
                ) : rows.length === 0 ? (
                    <EmptyMessage icon={<AudioLines className="h-5 w-5" />} text={t("workspace.voice.table.emptyStory")} />
                ) : auditionQueueEmpty ? (
                    <EmptyMessage icon={<CheckCircle2 className="h-5 w-5 text-success" />} text={t("workspace.voice.table.auditionAllClear")} />
                ) : visibleRows.length === 0 ? (
                    <EmptyMessage icon={<ListMusic className="h-5 w-5" />} text={t("workspace.voice.table.emptyFilter")} />
                ) : (
                    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                        {virtualizer.getVirtualItems().map(item => {
                            const entry = flatItems[item.index];
                            if (!entry) {
                                return null;
                            }
                            const group = entry.kind === "group" ? entry : null;
                            const row = entry.kind === "row" ? entry.row : null;
                            return (
                        <div
                            key={item.key}
                            ref={virtualizer.measureElement}
                            data-index={item.index}
                            className="absolute left-0 top-0 w-full"
                            style={{ transform: `translateY(${item.start}px)` }}
                        >
                        {group ? (
                            <div className="flex items-center gap-2 border-b border-edge-subtle bg-surface-sunken px-4 py-1.5 text-2xs font-medium text-fg-muted">
                                <span>{group.name}</span>
                                {group.characterId ? (
                                    // Who voices this character is voice-configuration data, so the box
                                    // is `readOnly` rather than `disabled`: the name is what a reader of
                                    // a past version came for. It commits on blur, which is what made it
                                    // worth guarding - a frozen project accepted the new cast name,
                                    // showed it, and dropped it the moment the field lost focus.
                                    <input
                                        className="ml-auto h-5 w-40 rounded-md border border-transparent bg-transparent px-1 text-2xs text-fg-subtle outline-none hover:border-edge focus:border-primary/50 focus:text-fg"
                                        readOnly={freeze.frozen}
                                        title={freeze.frozen ? freeze.reason : undefined}
                                        placeholder={t("workspace.voice.table.castPlaceholder")}
                                        defaultValue={config?.cast[group.characterId]?.[locale] ?? ""}
                                        key={`${group.characterId}:${config?.cast[group.characterId]?.[locale] ?? ""}`}
                                        onBlur={event => {
                                            const next = event.target.value.trim();
                                            const current = config?.cast[group.characterId!]?.[locale] ?? "";
                                            if (next !== current) {
                                                void voiceService?.setCastName(group.characterId!, locale, next);
                                            }
                                        }}
                                        onKeyDown={event => {
                                            if (event.key === "Enter") {
                                                (event.target as HTMLInputElement).blur();
                                            }
                                        }}
                                        aria-label={t("workspace.voice.table.castPlaceholder")}
                                    />
                                ) : null}
                            </div>
                        ) : null}
                        {row ? (() => {
                            const state = rowStates.get(row.unitId) ?? "missing";
                            const unit = voiceDoc?.units[row.unitId];
                            const asset = resolveAsset(unit?.assetId);
                            return (
                                <VoiceRow
                                    row={row}
                                    speaker={row.speaker}
                                    state={state}
                                    asset={asset}
                                    duration={formatVoiceDuration(unit?.duration)}
                                    note={unit?.note ?? ""}
                                    onNoteChange={note => setNote(row.unitId, row.sourceText, note)}
                                    mode={mode}
                                    isPlaying={playingUnitId === row.unitId}
                                    strings={rowStrings}
                                    onTogglePlay={() => void togglePlay(row.unitId, asset)}
                                    onAssign={anchor => {
                                        selectorAnchorRef.current = anchor;
                                        setSelector({
                                            unitId: row.unitId,
                                            sourceText: row.sourceText,
                                            // Already bound wins; otherwise the clip whose library
                                            // name matches this line's expected recording name.
                                            currentAssetId: unit?.assetId ?? matchingAssetIdFor(row),
                                        });
                                    }}
                                    onRemove={() => voiceService?.updateUnit(locale, row.unitId, row.sourceText, { assetId: "" })}
                                    onApprove={() => voiceService?.updateUnit(locale, row.unitId, row.sourceText, { status: "approved" })}
                                    onReturn={() => voiceService?.updateUnit(locale, row.unitId, row.sourceText, { status: "linked" })}
                                    onDropAsset={assetId => assignAsset(row.unitId, row.sourceText, assetId)}
                                />
                            );
                        })() : null}
                        </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <AssetSelector
                visible={selector !== null}
                assetType={AssetType.Audio}
                selectedIds={selector?.currentAssetId ? [selector.currentAssetId] : []}
                anchorRef={selectorAnchorRef}
                title={t("workspace.voice.table.assign")}
                onClose={() => setSelector(null)}
                onConfirm={assets => {
                    const asset = assets[0];
                    if (asset && selector) {
                        assignAsset(selector.unitId, selector.sourceText, asset.id);
                    }
                    setSelector(null);
                }}
            />
        </div>
    );
}

function EmptyMessage(props: { icon: React.ReactNode; text: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs text-fg-subtle">
            {props.icon}
            {props.text}
        </div>
    );
}
