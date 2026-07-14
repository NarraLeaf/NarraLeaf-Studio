/**
 * Translation table editor (editor-area tab, one per target locale).
 * Rows follow the story's narrative order (chapters → scenes → depth-first
 * blocks) so translators read lines in context, never alphabetically; each
 * story source opens with a "Characters" group so display names translate
 * alongside the lines that speak them. The "Interface text" source carries
 * both UI widget texts and the named-key registry (keys are managed inline:
 * editable source, hover remove, trailing add row).
 * Two modes: "translate" is a clean bilingual reading view; "review" is a
 * focused sign-off pass with an all/reviewed/unreviewed filter (defaults
 * to unreviewed). All controls live in the single top bar.
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    BookOpenText,
    CheckCircle2,
    ClipboardCheck,
    Languages,
    MessageSquareText,
    PenLine,
    SplitSquareVertical,
} from "lucide-react";
import type { EditorComponentProps } from "../types";
import { Select, type SelectOption } from "@/lib/components/elements";
import { useWorkspace } from "../../context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import {
    deriveUnitState,
    extractCharacterTranslationRows,
    extractKeyTranslationRows,
    extractUiTranslationRows,
    type LocalizationUnitState,
    type StoryTranslationRow,
} from "@/lib/workspace/services/localization/localizationModel";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import { isValidLocalizationKeyName, type LocalizationDocument } from "@shared/types/localization";
import { parseTranslatedText } from "@shared/utils/localizationText";
import type { StoryLibraryEntry } from "@shared/types/story";
import type { LocalizationEditorTabPayload } from "./localizationEditorTabId";
import { AddKeyRow, ReviewRow, TranslateRow, type TranslationTableRow } from "./TranslationRows";

type EditorMode = "translate" | "review";
type RowFilter = "all" | "untranslated" | "stale" | "completed";
type ReviewFilter = "all" | "reviewed" | "unreviewed";

/** Special source-picker value alongside story ids (UI texts + named keys). */
const UI_SOURCE_VALUE = "__ui__";

/** Group keys for the synthetic groups a source may carry. */
const CHARACTERS_GROUP_KEY = "__characters__";
const KEYS_GROUP_KEY = "__keys__";

/** A display row of any origin (story line, character name, UI text, named key). */
type TableRow = TranslationTableRow & {
    groupKey: string;
    groupName: string;
    speaker: string;
};

/** Placeholder count implied by `{n}` references in a named key's source text. */
function impliedInterpolationCount(sourceText: string): number {
    let max = -1;
    for (const part of parseTranslatedText(sourceText)) {
        if (part.kind === "placeholder" && part.index > max) {
            max = part.index;
        }
    }
    return max + 1;
}

/** States a reviewer still has to act on (feeds the pending-count badge). */
function isPendingReview(state: LocalizationUnitState): boolean {
    return state === "stale" || state === "translated" || state === "machine";
}

export function LocalizationEditorTab({ payload, active }: EditorComponentProps<LocalizationEditorTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const { t } = useTranslation();
    const locale = payload?.locale ?? "";

    const localizationService = useMemo(
        () => (context && isInitialized ? context.services.get<LocalizationService>(Services.Localization) : null),
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
    const uiDocumentService = useMemo(
        () => (context && isInitialized ? context.services.get<UIDocumentService>(Services.UIDocument) : null),
        [context, isInitialized],
    );
    const uiDocumentRevision = useUIDocumentRevision(uiDocumentService);

    const [stories, setStories] = useState<StoryLibraryEntry[]>([]);
    const [characters, setCharacters] = useState<{ id: string; name: string }[]>([]);
    const [sourceValue, setSourceValue] = useState<string | null>(null);
    const [rows, setRows] = useState<TableRow[]>([]);
    const [locDocument, setLocDocument] = useState<LocalizationDocument | null>(null);
    const [mode, setMode] = useState<EditorMode>("translate");
    const [filter, setFilter] = useState<RowFilter>("all");
    const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("unreviewed");

    const speakerNameFor = useCallback((row: StoryTranslationRow): string => {
        if (row.role === "narration") {
            return t("workspace.localization.table.narrationSpeaker");
        }
        if (row.role === "choicePrompt" || row.role === "choiceText") {
            return t("workspace.localization.table.choiceSpeaker");
        }
        if (row.characterId) {
            const character = characterService?.getCharacter(row.characterId);
            if (character) {
                return character.profile.getName();
            }
        }
        return t("workspace.localization.table.narrationSpeaker");
    }, [characterService, t]);

    // Story list + default selection.
    useEffect(() => {
        if (!storyService) {
            return;
        }
        const read = () => {
            const entries = storyService.listStories();
            setStories(entries);
            setSourceValue(current => {
                if (current === UI_SOURCE_VALUE) {
                    return current;
                }
                if (current && entries.some(entry => entry.id === current)) {
                    return current;
                }
                return storyService.getDefaultStoryId() ?? entries[0]?.id ?? null;
            });
        };
        read();
        return storyService.onLibraryChanged(read);
    }, [storyService]);

    // Character roster (names head every story source as their own group).
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

    // Rows of the selected source: a story's lines (headed by character
    // names), or the merged interface-text source (UI widget texts followed
    // by the named-key registry).
    useEffect(() => {
        if (!localizationService || !sourceValue) {
            setRows([]);
            return;
        }
        if (sourceValue === UI_SOURCE_VALUE) {
            let disposed = false;
            const read = () => {
                if (disposed) {
                    return;
                }
                const uiDocument = uiDocumentService?.getDocument();
                const uiRows: TableRow[] = uiDocument
                    ? extractUiTranslationRows(uiDocument).map(row => ({
                        unitId: row.unitId,
                        sourceText: row.sourceText,
                        interpolationCount: 0,
                        groupKey: row.groupName,
                        groupName: row.groupName,
                        speaker: row.elementName,
                    }))
                    : [];
                const keysDocument = localizationService.getKeysIfLoaded();
                const keyRows: TableRow[] = keysDocument
                    ? extractKeyTranslationRows(keysDocument).map(row => ({
                        unitId: row.unitId,
                        sourceText: row.sourceText,
                        interpolationCount: impliedInterpolationCount(row.sourceText),
                        groupKey: KEYS_GROUP_KEY,
                        groupName: t("workspace.localization.table.sourceKeys"),
                        speaker: row.keyName,
                        editableSource: true,
                        keyName: row.keyName,
                    }))
                    : [];
                setRows([...uiRows, ...keyRows]);
            };
            read();
            void localizationService.loadKeys().then(read).catch(() => undefined);
            const unsubscribe = localizationService.onKeysChanged(read);
            return () => {
                disposed = true;
                unsubscribe();
            };
        }
        if (!storyService) {
            setRows([]);
            return;
        }
        const storyId = sourceValue;
        let disposed = false;
        const extract = () => {
            try {
                const characterRows: TableRow[] = extractCharacterTranslationRows(characters).map(row => ({
                    unitId: row.unitId,
                    sourceText: row.sourceText,
                    interpolationCount: 0,
                    groupKey: CHARACTERS_GROUP_KEY,
                    groupName: t("workspace.localization.table.charactersGroup"),
                    speaker: t("workspace.localization.table.characterSpeaker"),
                }));
                const storyRows: TableRow[] = localizationService.extractRows(storyService.getStoryDocument(storyId)).map(row => ({
                    unitId: row.unitId,
                    sourceText: row.sourceText,
                    interpolationCount: row.interpolationCount,
                    groupKey: row.sceneId,
                    groupName: row.sceneName,
                    speaker: speakerNameFor(row),
                }));
                setRows([...characterRows, ...storyRows]);
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
    }, [storyService, localizationService, uiDocumentService, sourceValue, speakerNameFor, characters, uiDocumentRevision, t]);

    // Translation document for this locale.
    useEffect(() => {
        if (!localizationService || !locale) {
            setLocDocument(null);
            return;
        }
        let disposed = false;
        void localizationService.loadDocument(locale).then(document => {
            if (!disposed) {
                setLocDocument(document);
            }
        }).catch(() => setLocDocument(null));
        const unsubscribe = localizationService.onDocumentChanged(event => {
            if (event.locale === locale) {
                setLocDocument(event.document);
            }
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [localizationService, locale]);

    // Flush pending translation writes when the tab goes to the background.
    useEffect(() => {
        if (!active && localizationService) {
            void localizationService.flushPendingChanges();
        }
    }, [active, localizationService]);

    const localeDisplayName = useMemo(() => {
        const config = localizationService?.getConfiguration();
        return config?.locales.find(entry => entry.code === locale)?.displayName ?? locale;
    }, [localizationService, locale]);

    const rowStates = useMemo(() => {
        const states = new Map<string, LocalizationUnitState>();
        for (const row of rows) {
            states.set(row.unitId, deriveUnitState(locDocument?.units[row.unitId], row.sourceText));
        }
        return states;
    }, [rows, locDocument]);

    const counts = useMemo(() => {
        let untranslated = 0;
        let stale = 0;
        let completed = 0;
        let reviewed = 0;
        let pending = 0;
        for (const state of rowStates.values()) {
            if (state === "untranslated") {
                untranslated += 1;
            } else if (state === "stale") {
                stale += 1;
            } else {
                completed += 1;
            }
            if (state === "reviewed") {
                reviewed += 1;
            }
            if (isPendingReview(state)) {
                pending += 1;
            }
        }
        return { all: rowStates.size, untranslated, stale, completed, reviewed, pending };
    }, [rowStates]);

    const visibleRows = useMemo(() => {
        if (mode === "review") {
            if (reviewFilter === "all") {
                return rows;
            }
            return rows.filter(row => {
                const state = rowStates.get(row.unitId) ?? "untranslated";
                return reviewFilter === "reviewed" ? state === "reviewed" : state !== "reviewed";
            });
        }
        if (filter === "all") {
            return rows;
        }
        return rows.filter(row => {
            const state = rowStates.get(row.unitId) ?? "untranslated";
            if (filter === "untranslated") {
                return state === "untranslated";
            }
            if (filter === "stale") {
                return state === "stale";
            }
            return state === "machine" || state === "translated" || state === "reviewed";
        });
    }, [rows, rowStates, mode, filter, reviewFilter]);

    const rowsByGroup = useMemo(() => {
        const groups: { groupKey: string; groupName: string; rows: TableRow[] }[] = [];
        for (const row of visibleRows) {
            const last = groups[groups.length - 1];
            if (last && last.groupKey === row.groupKey) {
                last.rows.push(row);
            } else {
                groups.push({ groupKey: row.groupKey, groupName: row.groupName, rows: [row] });
            }
        }
        return groups;
    }, [visibleRows]);

    // Key management (inline editing, removal, the trailing add row) only
    // exists in translate mode on the merged interface-text source.
    const showKeysExtras = mode === "translate" && sourceValue === UI_SOURCE_VALUE;

    // The named-keys group must render even when it has no rows (first key
    // is added right here), so synthesize an empty group when it is absent.
    const groupsToRender = useMemo(() => {
        if (!showKeysExtras || rowsByGroup.some(group => group.groupKey === KEYS_GROUP_KEY)) {
            return rowsByGroup;
        }
        return [
            ...rowsByGroup,
            { groupKey: KEYS_GROUP_KEY, groupName: t("workspace.localization.table.sourceKeys"), rows: [] as TableRow[] },
        ];
    }, [rowsByGroup, showKeysExtras, t]);

    const handleTargetChange = useCallback((row: TranslationTableRow, target: string) => {
        localizationService?.updateUnit(locale, row.unitId, row.sourceText, { target });
    }, [localizationService, locale]);

    const handleApprove = useCallback((row: TranslationTableRow) => {
        localizationService?.updateUnit(locale, row.unitId, row.sourceText, { status: "reviewed" });
    }, [localizationService, locale]);

    const handleReturn = useCallback((row: TranslationTableRow) => {
        localizationService?.updateUnit(locale, row.unitId, row.sourceText, { status: "translated" });
    }, [localizationService, locale]);

    /** Inline edit of a named key's source text; the key's note is preserved. */
    const handleKeySourceChange = useCallback((row: TranslationTableRow, sourceText: string) => {
        if (!localizationService || !row.keyName) {
            return;
        }
        const note = localizationService.getKeysIfLoaded()?.keys[row.keyName]?.note;
        localizationService.setKey(row.keyName, { sourceText, ...(note ? { note } : {}) });
    }, [localizationService]);

    const handleKeyRemove = useCallback(async (row: TranslationTableRow) => {
        if (!localizationService || !uiService || !row.keyName) {
            return;
        }
        const name = row.keyName;
        const confirmed = await uiService.showConfirm(
            t("workspace.localization.table.removeKeyConfirm", { name }),
            t("workspace.localization.table.removeKeyConfirmDetail"),
        );
        if (confirmed) {
            localizationService.removeKey(name);
        }
    }, [localizationService, uiService, t]);

    /** Create a named key from the add row; returns whether it succeeded. */
    const handleAddKey = useCallback((name: string, sourceText: string): boolean => {
        if (!localizationService) {
            return false;
        }
        const trimmed = name.trim();
        if (!isValidLocalizationKeyName(trimmed)) {
            uiService?.showNotification(t("workspace.localization.table.invalidKeyName"), "warning");
            return false;
        }
        try {
            localizationService.setKey(trimmed, { sourceText });
            return true;
        } catch (error) {
            uiService?.showError(error instanceof Error ? error : String(error));
            return false;
        }
    }, [localizationService, uiService, t]);

    const sourceOptions: SelectOption[] = useMemo(
        () => [
            ...stories.map(entry => ({ value: entry.id, label: entry.name })),
            { value: UI_SOURCE_VALUE, label: t("workspace.localization.table.sourceUi") },
        ],
        [stories, t],
    );

    const modeOptions: { key: EditorMode; label: string; icon: React.ReactNode }[] = [
        { key: "translate", label: t("workspace.localization.table.modeTranslate"), icon: <PenLine className="h-3.5 w-3.5" /> },
        { key: "review", label: t("workspace.localization.table.modeReview"), icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    ];

    // Filters live in a single compact select; each option carries its count.
    const filterOptions: SelectOption[] = useMemo(() => [
        { value: "all", label: `${t("workspace.localization.table.filterAll")} (${counts.all})` },
        { value: "untranslated", label: `${t("workspace.localization.table.filterUntranslated")} (${counts.untranslated})` },
        { value: "stale", label: `${t("workspace.localization.table.filterStale")} (${counts.stale})` },
        { value: "completed", label: `${t("workspace.localization.table.filterCompleted")} (${counts.completed})` },
    ], [counts, t]);

    const reviewFilterOptions: SelectOption[] = useMemo(() => [
        { value: "all", label: `${t("workspace.localization.table.filterAll")} (${counts.all})` },
        { value: "reviewed", label: `${t("workspace.localization.table.reviewFilterReviewed")} (${counts.reviewed})` },
        { value: "unreviewed", label: `${t("workspace.localization.table.reviewFilterUnreviewed")} (${counts.all - counts.reviewed})` },
    ], [counts, t]);

    if (!locale) {
        return null;
    }

    // "All caught up" only makes sense on the unreviewed pass; the other
    // review filters fall back to the generic empty-filter message.
    const reviewQueueEmpty = mode === "review" && reviewFilter === "unreviewed" && rows.length > 0 && visibleRows.length === 0;

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex items-center gap-3 border-b border-edge px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Languages className="h-4 w-4 shrink-0 text-fg-muted" />
                    <span className="truncate text-sm font-medium text-fg">{localeDisplayName}</span>
                    <span className="rounded border border-edge px-1.5 py-0.5 text-2xs text-fg-subtle">{locale}</span>
                </div>
                <div className="ml-auto flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-2xs text-fg-subtle">{t("workspace.localization.table.storyLabel")}</span>
                        <Select
                            options={sourceOptions}
                            value={sourceValue ?? undefined}
                            onChange={value => setSourceValue(String(value))}
                            size="sm"
                            portalMenu
                            className="w-44"
                        />
                    </div>
                    {mode === "translate" ? (
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
                            options={reviewFilterOptions}
                            value={reviewFilter}
                            onChange={value => setReviewFilter(value as ReviewFilter)}
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
                                title={option.key === "review" && counts.pending > 0
                                    ? t("workspace.localization.table.reviewPendingCount", { count: counts.pending })
                                    : undefined}
                                className={`flex h-6 items-center gap-1.5 rounded px-2.5 text-xs transition-colors ${
                                    mode === option.key
                                        ? "bg-surface-raised text-fg shadow-sm"
                                        : "text-fg-muted hover:text-fg"
                                }`}
                            >
                                {option.icon}
                                {option.label}
                                {option.key === "review" && counts.pending > 0 ? (
                                    <span className="text-2xs text-fg-subtle">{counts.pending}</span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {stories.length === 0 && sourceValue !== UI_SOURCE_VALUE ? (
                    <EmptyMessage icon={<BookOpenText className="h-5 w-5" />} text={t("workspace.localization.table.noStories")} />
                ) : rows.length === 0 && !showKeysExtras ? (
                    <EmptyMessage
                        icon={<MessageSquareText className="h-5 w-5" />}
                        text={sourceValue === UI_SOURCE_VALUE
                            ? t("workspace.localization.table.emptyUi")
                            : t("workspace.localization.table.emptyStory")}
                    />
                ) : reviewQueueEmpty ? (
                    <EmptyMessage icon={<CheckCircle2 className="h-5 w-5 text-success" />} text={t("workspace.localization.table.reviewAllClear")} />
                ) : visibleRows.length === 0 && !showKeysExtras ? (
                    <EmptyMessage icon={<SplitSquareVertical className="h-5 w-5" />} text={t("workspace.localization.table.emptyFilter")} />
                ) : (
                    groupsToRender.map(group => (
                        <section key={`${group.groupKey}:${group.rows[0]?.unitId ?? ""}`}>
                            <div className="sticky top-0 z-10 border-b border-edge-subtle bg-surface-sunken px-4 py-1.5 text-2xs font-medium text-fg-muted">
                                {group.groupName}
                            </div>
                            <div className="flex flex-col">
                                {group.rows.map(row => {
                                    const state = rowStates.get(row.unitId) ?? "untranslated";
                                    const target = locDocument?.units[row.unitId]?.target ?? "";
                                    return mode === "review" ? (
                                        <ReviewRow
                                            key={row.unitId}
                                            row={row}
                                            speaker={row.speaker}
                                            state={state}
                                            target={target}
                                            onTargetChange={handleTargetChange}
                                            onApprove={handleApprove}
                                            onReturn={handleReturn}
                                        />
                                    ) : (
                                        <TranslateRow
                                            key={row.unitId}
                                            row={row}
                                            speaker={row.speaker}
                                            state={state}
                                            target={target}
                                            onTargetChange={handleTargetChange}
                                            onSourceChange={handleKeySourceChange}
                                            onRemove={row => void handleKeyRemove(row)}
                                        />
                                    );
                                })}
                                {group.groupKey === KEYS_GROUP_KEY && showKeysExtras ? (
                                    <AddKeyRow onSubmit={handleAddKey} />
                                ) : null}
                            </div>
                        </section>
                    ))
                )}
            </div>
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
