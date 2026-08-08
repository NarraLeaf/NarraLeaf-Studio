/**
 * Localization sidebar panel: language management for the game (source
 * language, target languages with autonym display names, per-language
 * translation progress) and the entry point into each translation table.
 * The panel is read-first: rows only show text and progress; every action
 * lives behind a single "more" menu, and inputs appear only on demand.
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Ellipsis, Plus } from "lucide-react";
import type { PanelComponentProps } from "../types";
import { ContextMenu, Progress, type ContextMenuDef } from "@/lib/components/elements";
import { useWorkspace } from "../../context";
import { freezeContextMenuRows, useFreezeGuard } from "../../components/ui/freezeGuard";

/**
 * The localization locale menu row that keeps working while frozen: the export.
 *
 * It writes to a path the author picks, outside the project. Language Settings, Set-as-source,
 * Import and Remove Language all write the project and are off.
 */
const FREEZE_READ_ONLY_LOCALIZATION_MENU_IDS: ReadonlySet<string> = new Set(["export-translations"]);
import { useRegistry } from "../../registry";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import {
    buildTranslationExchangeRows,
    extractCharacterTranslationRows,
    extractKeyTranslationRows,
    extractUiTranslationRows,
    type LocalizationProgress,
    type TranslatableUnitContext,
    type TranslationExportScope,
} from "@/lib/workspace/services/localization/localizationModel";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import {
    findLocaleFallbackConflict,
    isValidLocaleCode,
    localeAutonym as autonymFor,
    type LocalizationConfiguration,
    type LocalizationDocument,
} from "@shared/types/localization";
import {
    TRANSLATION_EXCHANGE_FORMAT_INFO,
    detectTranslationExchangeFormat,
    parseTranslationExchange,
    serializeTranslationExchange,
    translationExchangeExtensions,
    type TranslationExchangeFormat,
} from "@shared/utils/localizationExchange";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { createLocalizationEditorTab } from "./openLocalizationEditorTab";
import { TranslationExportForm } from "./TranslationExportForm";
import { LanguageSettingsForm, type FallbackCandidate } from "./LanguageSettingsForm";

/** One translatable unit with translator-facing context (for progress and export). */
type PanelRow = TranslatableUnitContext;

/** Which language row's "more" menu is open, and where to place it. */
type LocaleMenuState = {
    code: string;
    displayName: string;
    isSource: boolean;
    position: { x: number; y: number };
};

const INPUT_CLASS =
    "h-7 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary/50";

const GHOST_ROW_CLASS =
    "flex h-7 w-full items-center justify-center gap-1 rounded-md border border-dashed border-edge text-2xs text-fg-subtle transition-colors hover:border-edge-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

export function LocalizationPanel({ panelId }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const { t } = useTranslation();
    // Adding, removing and re-sourcing a language, and importing a CSV, write the project. Reading the
    // tables, switching locale and exporting a CSV do not.
    const freeze = useFreezeGuard();

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

    /** Written into the exported file so a translator can tell two projects apart. */
    const projectName = useMemo(() => {
        if (!context || !isInitialized) {
            return "";
        }
        return context.services.get<ProjectService>(Services.Project).getProjectConfig().name?.trim() ?? "";
    }, [context, isInitialized]);

    const [config, setConfig] = useState<LocalizationConfiguration | null>(null);
    const [rows, setRows] = useState<PanelRow[]>([]);
    const [progressByLocale, setProgressByLocale] = useState<Record<string, LocalizationProgress>>({});
    const [refreshTick, setRefreshTick] = useState(0);

    // Per-row "more" menu (one at a time, anchored under its trigger).
    const [localeMenu, setLocaleMenu] = useState<LocaleMenuState | null>(null);

    // Last format chosen for an export: a team that translates in Poedit does so
    // every time, and re-picking it per language is the kind of friction that
    // makes people export once and edit JSON by hand instead.
    const [exportFormat, setExportFormat] = useState<TranslationExchangeFormat>("csv");

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

    /**
     * The language's own two settings: the name players see, and its fallback language.
     *
     * The entry is read from the service rather than from the menu state, which carries only what
     * the row renders - a menu that also had to carry the fallback would be a second copy of the
     * configuration, stale from the moment it opened.
     */
    const handleLanguageSettings = useCallback((code: string) => {
        if (!localizationService || !uiService) {
            return;
        }
        const current = localizationService.getConfiguration();
        const entry = current.locales.find(locale => locale.code === code);
        if (!entry) {
            return;
        }
        const candidates: FallbackCandidate[] = current.locales
            .filter(locale => locale.code !== code)
            .map(locale => ({
                code: locale.code,
                displayName: locale.displayName,
                loops: findLocaleFallbackConflict(current, code, locale.code) !== null,
            }));

        // The footer buttons are snapshotted when the dialog opens, so the edit lives here
        // and the form reports into it.
        let displayName = entry.displayName;
        let fallback = entry.fallback ?? "";
        const dialogId = uiService.dialogs.show({
            title: t("workspace.localization.settings.title", { name: entry.displayName }),
            width: 420,
            closable: true,
            content: (
                <LanguageSettingsForm
                    code={code}
                    initialDisplayName={displayName}
                    initialFallback={fallback}
                    candidates={candidates}
                    onChange={(nextDisplayName, nextFallback) => {
                        displayName = nextDisplayName;
                        fallback = nextFallback;
                    }}
                />
            ),
            buttons: [
                { label: t("common.cancel"), onClick: () => uiService.dialogs.close(dialogId) },
                {
                    label: t("common.save"),
                    primary: true,
                    onClick: () => {
                        uiService.dialogs.close(dialogId);
                        // One call for both fields: they are one edit, and the configuration is
                        // written through whole either way.
                        void localizationService
                            .updateLocaleEntry(code, { displayName, fallback })
                            .catch(error => uiService.showError(error instanceof Error ? error : String(error)));
                    },
                },
            ],
        });
    }, [localizationService, uiService, t]);

    /** Write one exchange file, after the dialog below has settled format and scope. */
    const writeExport = useCallback(async (code: string, format: TranslationExchangeFormat, scope: TranslationExportScope) => {
        if (!localizationService || !context) {
            return;
        }
        try {
            const document = await localizationService.loadDocument(code);
            const exportRows = buildTranslationExchangeRows(rows, document, scope);
            if (exportRows.length === 0) {
                uiService?.showNotification(t("workspace.localization.exchange.exportEmpty"), "info");
                return;
            }
            const config = localizationService.getConfiguration();
            const text = serializeTranslationExchange(format, {
                sourceLocale: config.sourceLocale,
                targetLocale: code,
                projectName: projectName || undefined,
                rows: exportRows,
            });
            // Native save dialog: the user picks the destination (null = cancelled).
            const extension = TRANSLATION_EXCHANGE_FORMAT_INFO[format].extension;
            const selection = await appPrivilegedFacade.fs.selectSaveFile(`${code}.${extension}`, [extension]);
            if (!selection.success || !selection.data.ok) {
                const message = selection.success && !selection.data.ok ? selection.data.error.message : undefined;
                throw new Error(message || "Save dialog failed");
            }
            const targetPath = selection.data.data;
            if (!targetPath) {
                return;
            }
            const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
            const result = await filesystem.write(targetPath, text, "utf-8");
            if (!result.ok) {
                throw new Error(result.error.message);
            }
            uiService?.showNotification(
                t("workspace.localization.exchange.exportDone", { count: exportRows.length, path: targetPath }),
                "success",
            );
        } catch (error) {
            uiService?.showError(error instanceof Error ? error : String(error));
        }
    }, [localizationService, context, rows, uiService, projectName, t]);

    const handleExport = useCallback(async (code: string, displayName: string) => {
        if (!localizationService || !uiService) {
            return;
        }
        let document: LocalizationDocument;
        try {
            document = await localizationService.loadDocument(code);
        } catch (error) {
            uiService.showError(error instanceof Error ? error : String(error));
            return;
        }
        const pendingCount = buildTranslationExchangeRows(rows, document, "pending").length;

        // The footer buttons are snapshotted when the dialog opens, so the
        // selection lives here and the form reports into it.
        let format = exportFormat;
        let scope: TranslationExportScope = pendingCount > 0 && pendingCount < rows.length ? "pending" : "all";
        const dialogId = uiService.dialogs.show({
            title: t("workspace.localization.exchange.exportTitle", { name: displayName }),
            width: 420,
            closable: true,
            content: (
                <TranslationExportForm
                    totalCount={rows.length}
                    pendingCount={pendingCount}
                    initialFormat={format}
                    initialScope={scope}
                    onChange={(nextFormat, nextScope) => {
                        format = nextFormat;
                        scope = nextScope;
                    }}
                />
            ),
            buttons: [
                { label: t("common.cancel"), onClick: () => uiService.dialogs.close(dialogId) },
                {
                    label: t("workspace.localization.exchange.exportAction"),
                    primary: true,
                    onClick: () => {
                        uiService.dialogs.close(dialogId);
                        setExportFormat(format);
                        void writeExport(code, format, scope);
                    },
                },
            ],
        });
    }, [localizationService, uiService, rows, exportFormat, writeExport, t]);

    const handleImport = useCallback(async (code: string, displayName: string) => {
        if (!localizationService || !context || !uiService) {
            return;
        }
        try {
            // The title is passed because the generic picker's default says "Select Icon File",
            // which is what a translator would otherwise be asked for.
            const selection = await appPrivilegedFacade.fs.selectFile(
                translationExchangeExtensions(),
                false,
                t("workspace.localization.exchange.importDialogTitle"),
            );
            if (!selection.success || !selection.data.ok || selection.data.data.length === 0) {
                return;
            }
            const filePath = selection.data.data[0];
            const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
            const content = await filesystem.read(filePath, "utf-8");
            if (!content.ok) {
                throw new Error(content.error.message || t("workspace.localization.exchange.importFailed"));
            }
            const format = detectTranslationExchangeFormat(filePath, content.data);
            if (!format) {
                throw new Error(t("workspace.localization.exchange.importUnsupported"));
            }
            const parsed = parseTranslationExchange(format, content.data);
            if (parsed.rows.length === 0) {
                throw new Error(parsed.errors[0] || t("workspace.localization.exchange.importNoRows"));
            }

            // A file that names a different language than the one it is being
            // imported into is the expensive mistake: unit ids match across
            // languages, so nothing downstream would ever notice.
            const declared = parsed.targetLocale?.trim();
            if (declared && declared.toLowerCase() !== code.toLowerCase()) {
                const proceed = await uiService.showConfirm(
                    t("workspace.localization.exchange.localeMismatch", { declared, name: displayName }),
                    t("workspace.localization.exchange.localeMismatchDetail"),
                );
                if (!proceed) {
                    return;
                }
            }

            await localizationService.loadDocument(code);
            const currentSourceByUnit = new Map(rows.map(row => [row.unitId, row.sourceText]));
            const summary = localizationService.applyImportedRows(code, parsed.rows, currentSourceByUnit);
            uiService.showNotification(t("workspace.localization.panel.importSummary", { ...summary }), "success");
            if (parsed.errors.length > 0) {
                uiService.showNotification(
                    t("workspace.localization.exchange.importWarnings", { count: parsed.errors.length, first: parsed.errors[0] }),
                    "warning",
                );
            }
            setRefreshTick(tick => tick + 1);
        } catch (error) {
            uiService.showError(error instanceof Error ? error : String(error));
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
                id: "language-settings",
                label: t("workspace.localization.settings.menu"),
                onClick: () => handleLanguageSettings(code),
            },
            { id: "separator-exchange", separator: true },
            {
                id: "export-translations",
                label: t("workspace.localization.exchange.exportMenu"),
                onClick: () => void handleExport(code, displayName),
            },
            {
                id: "import-translations",
                label: t("workspace.localization.exchange.importMenu"),
                onClick: () => void handleImport(code, displayName),
            },
            { id: "separator", separator: true },
            {
                id: "remove-language",
                label: t("workspace.localization.panel.removeLanguage"),
                onClick: () => void handleRemoveLocale(code, displayName),
            },
        );
        return items;
    }, [localeMenu, handleSetSource, handleLanguageSettings, handleExport, handleImport, handleRemoveLocale, t]);
    const frozenLocaleMenuItems = useMemo(
        () => freezeContextMenuRows(localeMenuItems, freeze.frozen, FREEZE_READ_ONLY_LOCALIZATION_MENU_IDS, freeze.reason),
        [freeze, localeMenuItems],
    );

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
                    {/* No languages: no list. The "+ Add language" row directly below is the action,
                        so a bordered box repeating it is a second copy of the same button. */}
                    {locales.length === 0 ? null : (
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
                                        className="group flex cursor-pointer flex-col gap-1.5 rounded-md border border-edge-subtle px-2.5 py-2 text-left hover:border-edge focus-visible:border-primary/50 focus-visible:outline-none"
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
                                            <span className="rounded-md border border-edge px-1 py-px text-2xs text-fg-subtle">
                                                {locale.code}
                                            </span>
                                            {isSource ? (
                                                <span className="rounded-md border border-primary/40 px-1 py-px text-2xs text-primary">
                                                    {t("workspace.localization.panel.sourceBadge")}
                                                </span>
                                            ) : null}
                                            <button
                                                type="button"
                                                aria-haspopup="menu"
                                                aria-expanded={menuOpen}
                                                title={t("workspace.localization.panel.more")}
                                                className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-opacity hover:bg-fill hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 ${
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
                            {...freeze.writes()}
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
                                className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-edge text-fg-muted hover:border-primary/50 hover:text-fg"
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
                    items={frozenLocaleMenuItems}
                    position={localeMenu.position}
                    onClose={() => setLocaleMenu(null)}
                />
            ) : null}
        </div>
    );
}
