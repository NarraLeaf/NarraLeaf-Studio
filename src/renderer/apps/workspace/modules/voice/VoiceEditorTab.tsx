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
import { AudioLines, CheckCircle2, ListMusic, Mic, PenLine } from "lucide-react";
import type { EditorComponentProps } from "../types";
import { Select, type SelectOption } from "@/lib/components/elements";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "../../context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import { deriveVoiceUnitState, type VoiceUnitState } from "@/lib/workspace/services/voice/voiceModel";
import type { StoryTranslationRow } from "@/lib/workspace/services/localization/localizationModel";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { StoryLibraryEntry } from "@shared/types/story";
import type { VoiceConfiguration, VoiceDocument } from "@shared/types/voice";
import type { VoiceEditorTabPayload } from "./voiceEditorTabId";
import { VoiceRow, type VoiceTableRow } from "./VoiceRows";

type EditorMode = "assign" | "audition";
type GroupAxis = "scene" | "character";
type RowFilter = "all" | "missing" | "outdated" | "voiced" | "approved";
type AuditionFilter = "all" | "approved" | "pending";

const NARRATION_GROUP_KEY = "__narration__";

type TableRow = VoiceTableRow & { speaker: string };

export function VoiceEditorTab({ payload, active }: EditorComponentProps<VoiceEditorTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const { t } = useTranslation();
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
    useEffect(() => {
        if (!voiceService || !storyService || !storyId) {
            setRows([]);
            return;
        }
        let disposed = false;
        const extract = () => {
            try {
                const document = storyService.getStoryDocument(storyId);
                setRows(voiceService.extractRows(document).map(row => ({
                    unitId: row.unitId,
                    sourceText: row.sourceText,
                    sceneId: row.sceneId,
                    sceneName: row.sceneName,
                    role: row.role,
                    ...(row.characterId ? { characterId: row.characterId } : {}),
                    speaker: speakerNameFor(row),
                })));
            } catch {
                setRows([]);
            }
        };
        void storyService.loadStory(storyId).then(() => {
            if (!disposed) {
                extract();
            }
        }).catch(() => setRows([]));
        const unsubscribe = storyService.onDocumentChanged(event => {
            if (event.storyId === storyId) {
                extract();
            }
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [voiceService, storyService, storyId, speakerNameFor, characters]);

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
    }, [voiceService, locale]);

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
                    <span className="rounded border border-edge px-1.5 py-0.5 text-2xs text-fg-subtle">{locale}</span>
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
                                className={`flex h-6 items-center gap-1.5 rounded px-2 text-xs transition-colors ${
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
                                className={`flex h-6 items-center gap-1.5 rounded px-2.5 text-xs transition-colors ${
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
            <div className="min-h-0 flex-1 overflow-y-auto">
                {stories.length === 0 ? (
                    <EmptyMessage icon={<Mic className="h-5 w-5" />} text={t("workspace.voice.table.noStories")} />
                ) : rows.length === 0 ? (
                    <EmptyMessage icon={<AudioLines className="h-5 w-5" />} text={t("workspace.voice.table.emptyStory")} />
                ) : auditionQueueEmpty ? (
                    <EmptyMessage icon={<CheckCircle2 className="h-5 w-5 text-success" />} text={t("workspace.voice.table.auditionAllClear")} />
                ) : visibleRows.length === 0 ? (
                    <EmptyMessage icon={<ListMusic className="h-5 w-5" />} text={t("workspace.voice.table.emptyFilter")} />
                ) : (
                    groups.map(group => (
                        <section key={`${group.key}:${group.rows[0]?.unitId ?? ""}`}>
                            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-edge-subtle bg-surface-sunken px-4 py-1.5 text-2xs font-medium text-fg-muted">
                                <span>{group.name}</span>
                                {group.characterId ? (
                                    <input
                                        className="ml-auto h-5 w-40 rounded border border-transparent bg-transparent px-1 text-2xs text-fg-subtle outline-none hover:border-edge focus:border-primary/50 focus:text-fg"
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
                            <div className="flex flex-col">
                                {group.rows.map(row => {
                                    const state = rowStates.get(row.unitId) ?? "missing";
                                    const asset = resolveAsset(voiceDoc?.units[row.unitId]?.assetId);
                                    return (
                                        <VoiceRow
                                            key={row.unitId}
                                            row={row}
                                            speaker={row.speaker}
                                            state={state}
                                            asset={asset}
                                            mode={mode}
                                            isPlaying={playingUnitId === row.unitId}
                                            strings={rowStrings}
                                            onTogglePlay={() => void togglePlay(row.unitId, asset)}
                                            onAssign={anchor => {
                                                selectorAnchorRef.current = anchor;
                                                setSelector({
                                                    unitId: row.unitId,
                                                    sourceText: row.sourceText,
                                                    currentAssetId: voiceDoc?.units[row.unitId]?.assetId,
                                                });
                                            }}
                                            onRemove={() => voiceService?.updateUnit(locale, row.unitId, row.sourceText, { assetId: "" })}
                                            onApprove={() => voiceService?.updateUnit(locale, row.unitId, row.sourceText, { status: "approved" })}
                                            onReturn={() => voiceService?.updateUnit(locale, row.unitId, row.sourceText, { status: "linked" })}
                                            onDropAsset={assetId => assignAsset(row.unitId, row.sourceText, assetId)}
                                        />
                                    );
                                })}
                            </div>
                        </section>
                    ))
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
