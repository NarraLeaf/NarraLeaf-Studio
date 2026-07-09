/**
 * Localization sidebar panel: language management for the game (source
 * language, target languages with autonym display names, per-language
 * translation progress) and the entry point into each translation table.
 * The panel is read-first: rows only show text and progress; every action
 * lives behind a single "more" menu, and inputs appear only on demand.
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Ellipsis, Languages, Plus } from "lucide-react";
import type { PanelComponentProps } from "../types";
import { ContextMenu, Progress, type ContextMenuDef } from "@/lib/components/elements";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import {
    deriveUnitState,
    extractCharacterTranslationRows,
    extractKeyTranslationRows,
    extractUiTranslationRows,
    type LocalizationProgress,
} from "@/lib/workspace/services/localization/localizationModel";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import {
    isValidLocaleCode,
    type LocalizationConfiguration,
} from "@shared/types/localization";
import { parseTranslationCsv, serializeTranslationCsv, type TranslationCsvRow } from "@shared/utils/localizationCsv";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { createLocalizationEditorTab } from "./openLocalizationEditorTab";

/** One translatable unit with translator-facing context (for progress + CSV export). */
type PanelRow = {
    unitId: string;
    sourceText: string;
    context: string;
};

/** Which language row's "more" menu is open, and where to place it. */
type LocaleMenuState = {
    code: string;
    displayName: string;
    isSource: boolean;
    position: { x: number; y: number };
};

const INPUT_CLASS =
    "h-7 min-w-0 flex-1 rounded border border-edge bg-surface-raised px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary/50";

const GHOST_ROW_CLASS =
    "flex h-7 w-full items-center justify-center gap-1 rounded border border-dashed border-edge text-2xs text-fg-subtle transition-colors hover:border-edge-strong hover:text-fg";

/** Autonym for a language code via Intl (e.g. "ja" → "日本語"); falls back to the code. */
function autonymFor(code: string): string {
    try {
        const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
        return name && name !== code ? name : code;
    } catch {
        return code;
    }
}

export function LocalizationPanel({ panelId }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const { t } = useTranslation();

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

    const [config, setConfig] = useState<LocalizationConfiguration | null>(null);
    const [rows, setRows] = useState<PanelRow[]>([]);
    const [progressByLocale, setProgressByLocale] = useState<Record<string, LocalizationProgress>>({});
    const [refreshTick, setRefreshTick] = useState(0);

    // Per-row "more" menu (one at a time, anchored under its trigger).
    const [localeMenu, setLocaleMenu] = useState<LocaleMenuState | null>(null);

    // Add-language inline form (collapsed by default; the panel shows no idle inputs).
    const [addingLocale, setAddingLocale] = useState(false);
    const [codeDraft, setCodeDraft] = useState("");
    const [nameDraft, setNameDraft] = useState("");
    const [nameDraftTouched, setNameDraftTouched] = useState(false);

    // Configuration (from .nlproj via the localization service).
    useEffect(() => {
        if (!localizationService) {
            return;
        }
        setConfig(localizationService.getConfiguration());
        return localizationService.onConfigChanged(setConfig);
    }, [localizationService]);

    // Every translatable unit of the project: character names, story lines
    // (narrative order), opted-in UI widget texts, and named keys — with
    // translator-facing context (feeds both progress and CSV export).
    useEffect(() => {
        if (!storyService || !localizationService) {
            return;
        }
        let disposed = false;
        const recompute = async () => {
            const collected: PanelRow[] = [];
            const characters = (characterService?.listCharacter() ?? []).map(character => ({
                id: character.profile.getId(),
                name: character.profile.getName(),
            }));
            for (const row of extractCharacterTranslationRows(characters)) {
                collected.push({ unitId: row.unitId, sourceText: row.sourceText, context: row.sourceText });
            }
            for (const entry of storyService.listStories()) {
                try {
                    const document = await storyService.loadStory(entry.id);
                    for (const row of localizationService.extractRows(document)) {
                        collected.push({ unitId: row.unitId, sourceText: row.sourceText, context: row.sceneName });
                    }
                } catch {
                    // A broken story must not take the panel down.
                }
            }
            const uiDocument = uiDocumentService?.getDocument();
            if (uiDocument) {
                for (const row of extractUiTranslationRows(uiDocument)) {
                    collected.push({
                        unitId: row.unitId,
                        sourceText: row.sourceText,
                        context: row.groupName ? `${row.groupName} · ${row.elementName}` : row.elementName,
                    });
                }
            }
            let keysDocument = localizationService.getKeysIfLoaded();
            if (!keysDocument) {
                keysDocument = await localizationService.loadKeys().catch(() => undefined);
            }
            for (const row of extractKeyTranslationRows(keysDocument ?? { schemaVersion: 1, keys: {} })) {
                collected.push({ unitId: row.unitId, sourceText: row.sourceText, context: row.keyName });
            }
            if (!disposed) {
                setRows(collected);
            }
        };
        void recompute();
        const unsubscribeLibrary = storyService.onLibraryChanged(() => void recompute());
        const unsubscribeDocument = storyService.onDocumentChanged(() => void recompute());
        const unsubscribeKeys = localizationService.onKeysChanged(() => void recompute());
        const unsubscribeCharacters = characterService?.subscribe(() => void recompute());
        return () => {
            disposed = true;
            unsubscribeLibrary();
            unsubscribeDocument();
            unsubscribeKeys();
            unsubscribeCharacters?.();
        };
    }, [storyService, localizationService, characterService, uiDocumentService, uiDocumentRevision]);

    // Per-language progress; recomputed when rows, config, or any translation change.
    useEffect(() => {
        if (!localizationService || !config) {
            return;
        }
        let disposed = false;
        void (async () => {
            const next: Record<string, LocalizationProgress> = {};
            for (const locale of config.locales) {
                if (locale.code === config.sourceLocale) {
                    continue;
                }
                try {
                    await localizationService.loadDocument(locale.code);
                    next[locale.code] = localizationService.computeProgress(rows, locale.code);
                } catch {
                    // Skip broken locale files; the row simply shows no progress.
                }
            }
            if (!disposed) {
                setProgressByLocale(next);
            }
        })();
        return () => {
            disposed = true;
        };
    }, [localizationService, config, rows, refreshTick]);

    useEffect(() => {
        if (!localizationService) {
            return;
        }
        return localizationService.onDocumentChanged(() => setRefreshTick(tick => tick + 1));
    }, [localizationService]);

    const handleCodeDraftChange = useCallback((value: string) => {
        setCodeDraft(value);
        if (!nameDraftTouched) {
            setNameDraft(value.trim() ? autonymFor(value.trim()) : "");
        }
    }, [nameDraftTouched]);

    const cancelAddLocale = useCallback(() => {
        setAddingLocale(false);
        setCodeDraft("");
        setNameDraft("");
        setNameDraftTouched(false);
    }, []);

    const handleAddLocale = useCallback(async () => {
        if (!localizationService) {
            return;
        }
        const code = codeDraft.trim();
        if (!isValidLocaleCode(code)) {
            uiService?.showNotification(t("workspace.localization.panel.invalidCode"), "warning");
            return;
        }
        try {
            await localizationService.addLocale({ code, displayName: nameDraft.trim() || autonymFor(code) });
            cancelAddLocale();
        } catch (error) {
            uiService?.showError(error instanceof Error ? error : String(error));
        }
    }, [localizationService, uiService, codeDraft, nameDraft, cancelAddLocale, t]);

    const handleRemoveLocale = useCallback(async (code: string, displayName: string) => {
        if (!localizationService || !uiService) {
            return;
        }
        const confirmed = await uiService.showConfirm(
            t("workspace.localization.panel.removeConfirm", { name: displayName }),
            t("workspace.localization.panel.removeConfirmDetail"),
        );
        if (!confirmed) {
            return;
        }
        try {
            await localizationService.removeLocale(code);
        } catch (error) {
            uiService.showError(error instanceof Error ? error : String(error));
        }
    }, [localizationService, uiService, t]);

    const handleSetSource = useCallback(async (code: string) => {
        try {
            await localizationService?.setSourceLocale(code);
        } catch (error) {
            uiService?.showError(error instanceof Error ? error : String(error));
        }
    }, [localizationService, uiService]);

    const handleOpenTable = useCallback((code: string, displayName: string) => {
        openEditorTab(createLocalizationEditorTab(code, displayName));
    }, [openEditorTab]);

    const handleExportCsv = useCallback(async (code: string) => {
        if (!localizationService || !context) {
            return;
        }
        try {
            const document = await localizationService.loadDocument(code);
            const csvRows: TranslationCsvRow[] = rows.map(row => {
                const unit = document.units[row.unitId];
                const state = deriveUnitState(unit, row.sourceText);
                return {
                    unitId: row.unitId,
                    context: row.context,
                    source: row.sourceText,
                    target: unit?.target ?? "",
                    status: state === "untranslated" ? "" : state,
                    note: unit?.note ?? "",
                };
            });
            const csv = "﻿" + serializeTranslationCsv(csvRows);
            // Native save dialog: the user picks the destination (null = cancelled).
            const selection = await appPrivilegedFacade.fs.selectSaveFile(`${code}.csv`, ["csv"]);
            if (!selection.success || !selection.data.ok) {
                const message = selection.success && !selection.data.ok ? selection.data.error.message : undefined;
                throw new Error(message || "Save dialog failed");
            }
            const targetPath = selection.data.data;
            if (!targetPath) {
                return;
            }
            const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
            const result = await filesystem.write(targetPath, csv, "utf-8");
            if (!result.ok) {
                throw new Error(result.error.message);
            }
            uiService?.showNotification(t("workspace.localization.panel.exportDone", { path: targetPath }), "success");
        } catch (error) {
            uiService?.showError(error instanceof Error ? error : String(error));
        }
    }, [localizationService, context, rows, uiService, t]);

    const handleImportCsv = useCallback(async (code: string) => {
        if (!localizationService || !context) {
            return;
        }
        try {
            const selection = await appPrivilegedFacade.fs.selectFile(["csv"], false);
            if (!selection.success || !selection.data.ok || selection.data.data.length === 0) {
                return;
            }
            const filePath = selection.data.data[0];
            const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
            const content = await filesystem.read(filePath, "utf-8");
            if (!content.ok) {
                throw new Error(content.error.message || t("workspace.localization.panel.importFailed"));
            }
            const parsed = parseTranslationCsv(content.data);
            if (parsed.errors.length > 0 && parsed.rows.length === 0) {
                throw new Error(parsed.errors[0]);
            }
            await localizationService.loadDocument(code);
            const currentSourceByUnit = new Map(rows.map(row => [row.unitId, row.sourceText]));
            const summary = localizationService.applyImportedRows(code, parsed.rows, currentSourceByUnit);
            uiService?.showNotification(t("workspace.localization.panel.importSummary", { ...summary }), "success");
            setRefreshTick(tick => tick + 1);
        } catch (error) {
            uiService?.showError(error instanceof Error ? error : String(error));
        }
    }, [localizationService, context, rows, uiService, t]);

    const localeMenuItems = useMemo<ContextMenuDef>(() => {
        if (!localeMenu) {
            return [];
        }
        const { code, displayName, isSource } = localeMenu;
        const items: ContextMenuDef = [];
        if (!isSource) {
            items.push({
                id: "set-source",
                label: t("workspace.localization.panel.setSource"),
                onClick: () => void handleSetSource(code),
            });
        }
        items.push(
            {
                id: "export-csv",
                label: t("workspace.localization.panel.exportCsv"),
                onClick: () => void handleExportCsv(code),
            },
            {
                id: "import-csv",
                label: t("workspace.localization.panel.importCsv"),
                onClick: () => void handleImportCsv(code),
            },
            { id: "separator", separator: true },
            {
                id: "remove-language",
                label: t("workspace.localization.panel.removeLanguage"),
                onClick: () => void handleRemoveLocale(code, displayName),
            },
        );
        return items;
    }, [localeMenu, handleSetSource, handleExportCsv, handleImportCsv, handleRemoveLocale, t]);

    const locales = config?.locales ?? [];

    return (
        <div className="flex h-full min-h-0 flex-col" data-panel-id={panelId}>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="flex flex-col gap-2">
                    <div className="truncate text-xs font-medium text-fg">
                        {t("workspace.localization.panel.languagesTitle")}
                    </div>
                    <p className="text-2xs leading-snug text-fg-subtle">
                        {t("workspace.localization.panel.languagesHint")}
                    </p>
                    {locales.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 rounded border border-edge-subtle px-3 py-6 text-center text-2xs text-fg-subtle">
                            <Languages className="h-5 w-5" />
                            {t("workspace.localization.panel.empty")}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1">
                            {locales.map(locale => {
                                const isSource = locale.code === config?.sourceLocale;
                                const progress = progressByLocale[locale.code];
                                const menuOpen = localeMenu?.code === locale.code;
                                return (
                                    <div
                                        key={locale.code}
                                        role="button"
                                        tabIndex={0}
                                        title={t("workspace.localization.panel.openTable")}
                                        className="group flex cursor-pointer flex-col gap-1.5 rounded border border-edge-subtle px-2.5 py-2 text-left hover:border-edge focus-visible:border-primary/50 focus-visible:outline-none"
                                        onClick={() => handleOpenTable(locale.code, locale.displayName)}
                                        onKeyDown={event => {
                                            if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                                event.preventDefault();
                                                handleOpenTable(locale.code, locale.displayName);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-xs text-fg">{locale.displayName}</span>
                                            <span className="rounded border border-edge px-1 py-px text-2xs text-fg-subtle">
                                                {locale.code}
                                            </span>
                                            {isSource ? (
                                                <span className="rounded border border-primary/40 px-1 py-px text-2xs text-primary">
                                                    {t("workspace.localization.panel.sourceBadge")}
                                                </span>
                                            ) : null}
                                            <button
                                                type="button"
                                                aria-haspopup="menu"
                                                aria-expanded={menuOpen}
                                                title={t("workspace.localization.panel.more")}
                                                className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-opacity hover:bg-fill hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 ${
                                                    menuOpen ? "opacity-100" : "opacity-0"
                                                }`}
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                    setLocaleMenu({
                                                        code: locale.code,
                                                        displayName: locale.displayName,
                                                        isSource,
                                                        position: { x: rect.left, y: rect.bottom + 4 },
                                                    });
                                                }}
                                                onKeyDown={event => event.stopPropagation()}
                                            >
                                                <Ellipsis className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        {!isSource ? (
                                            <div className="flex flex-col gap-1">
                                                <Progress
                                                    value={progress ? progress.completed : 0}
                                                    max={Math.max(1, progress?.total ?? 1)}
                                                    size="sm"
                                                />
                                                <span className="flex items-center gap-2 text-2xs text-fg-subtle">
                                                    {t("workspace.localization.panel.progress", {
                                                        completed: progress?.completed ?? 0,
                                                        total: progress?.total ?? 0,
                                                    })}
                                                    {progress && progress.stale > 0 ? (
                                                        <span className="text-warning">
                                                            {t("workspace.localization.panel.staleCount", { count: progress.stale })}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {!addingLocale ? (
                        <button
                            type="button"
                            className={`mt-1 ${GHOST_ROW_CLASS}`}
                            onClick={() => setAddingLocale(true)}
                        >
                            <Plus className="h-3 w-3" /> {t("workspace.localization.panel.addLanguage")}
                        </button>
                    ) : (
                        <div
                            className="mt-1 flex items-center gap-1.5"
                            onKeyDown={event => {
                                if (event.key === "Escape") {
                                    cancelAddLocale();
                                }
                            }}
                            onBlur={event => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                    cancelAddLocale();
                                }
                            }}
                        >
                            <input
                                autoFocus
                                className={`${INPUT_CLASS} w-24 flex-none`}
                                value={codeDraft}
                                placeholder={t("workspace.localization.panel.codePlaceholder")}
                                onChange={event => handleCodeDraftChange(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === "Enter") {
                                        void handleAddLocale();
                                    }
                                }}
                                aria-label={t("workspace.localization.panel.codePlaceholder")}
                            />
                            <input
                                className={INPUT_CLASS}
                                value={nameDraft}
                                placeholder={t("workspace.localization.panel.namePlaceholder")}
                                onChange={event => {
                                    setNameDraft(event.target.value);
                                    setNameDraftTouched(true);
                                }}
                                onKeyDown={event => {
                                    if (event.key === "Enter") {
                                        void handleAddLocale();
                                    }
                                }}
                                aria-label={t("workspace.localization.panel.namePlaceholder")}
                            />
                            <button
                                type="button"
                                className="flex h-7 w-7 flex-none items-center justify-center rounded border border-edge text-fg-muted hover:border-primary/50 hover:text-fg"
                                onClick={() => void handleAddLocale()}
                                title={t("workspace.localization.panel.confirm")}
                            >
                                <Check className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {localeMenu ? (
                <ContextMenu
                    items={localeMenuItems}
                    position={localeMenu.position}
                    onClose={() => setLocaleMenu(null)}
                />
            ) : null}
        </div>
    );
}
