/**
 * Voice sidebar panel: coarse management of the game's voice languages
 * (autonym display names + per-language coverage of spoken lines) and the entry
 * point into each voice table. Studio imports audio — it never records — so the
 * panel is deliberately small: a language row shows only its name, code, and
 * coverage; every action lives behind a single "more" menu; inputs appear only
 * on demand. Modelled on the Localization panel.
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Ellipsis, Plus, RotateCcw } from "lucide-react";
import type { PanelComponentProps } from "../types";
import { ContextMenu, Progress, type ContextMenuDef } from "@/lib/components/elements";
import { useWorkspace } from "../../context";
import { freezeContextMenuRows, useFreezeGuard } from "../../components/ui/freezeGuard";

/**
 * The voice locale menu rows that keep working while frozen: the two exports.
 *
 * They write a CSV to a path the author picks, which is outside the project - the freeze is about the
 * project, not about the author's desktop. Import and Remove Language write the project and are off.
 */
const FREEZE_READ_ONLY_VOICE_MENU_IDS: ReadonlySet<string> = new Set([
  "export-script",
  "export-pickup"
]);
import { useRegistry } from "../../registry";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import {
  deriveVoiceUnitState,
  type VoiceProgress
} from "@/lib/workspace/services/voice/voiceModel";
import {
  buildRecordingScriptRows,
  buildVoiceNameKeyMap,
  withSceneIndices,
  type VoiceScriptEntry
} from "@/lib/workspace/services/voice/voiceScript";
import type { StoryTranslationRow } from "@/lib/workspace/services/localization/localizationModel";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import {
  DEFAULT_VOICE_NAMING_PATTERN,
  isValidLocaleCode,
  type VoiceConfiguration
} from "@shared/types/voice";
import { localeAutonym as autonymFor } from "@shared/types/localization";
import { parseVoiceCsv, serializeVoiceCsv } from "@shared/utils/voiceCsv";
import { matchKeyForFilename, VOICE_NAME_TOKENS } from "@shared/utils/voiceNaming";
import { readAudioDuration } from "@/lib/workspace/services/voice/audioDuration";
import { createVoiceEditorTab } from "./openVoiceEditorTab";

/** Audio containers offered in the batch-import file picker. */
const AUDIO_IMPORT_EXTENSIONS = ["mp3", "wav", "ogg", "oga", "opus", "aac", "m4a", "flac", "weba"];

/** One voiceable line (spoken narration/dialogue) — feeds coverage. */
type PanelRow = {
  unitId: string;
  sourceText: string;
};

/** Which language row's "more" menu is open, and where to place it. */
type LocaleMenuState = {
  code: string;
  displayName: string;
  position: { x: number; y: number };
};

const INPUT_CLASS =
  "h-7 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary/50";

const GHOST_ROW_CLASS =
  "flex h-7 w-full items-center justify-center gap-1 rounded-md border border-dashed border-edge text-2xs text-fg-subtle transition-colors hover:border-edge-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

/** The pattern tokens, spelled the way an author types them. */
const NAMING_TOKEN_HINT = VOICE_NAME_TOKENS.filter((token) => token !== "unitId")
  .map((token) => `{${token}}`)
  .join(" ");

export function VoicePanel({ panelId }: PanelComponentProps) {
  const { context, isInitialized } = useWorkspace();
  const { openEditorTab } = useRegistry();
  const { t } = useTranslation();
  // Adding and removing a voice language, and importing audio, write the project. Auditioning,
  // switching locale and exporting a recording script do not.
  const freeze = useFreezeGuard();

  const voiceService = useMemo(
    () => (context && isInitialized ? context.services.get<VoiceService>(Services.Voice) : null),
    [context, isInitialized]
  );
  const storyService = useMemo(
    () => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null),
    [context, isInitialized]
  );
  const uiService = useMemo(
    () => (context && isInitialized ? context.services.get<UIService>(Services.UI) : null),
    [context, isInitialized]
  );
  const characterService = useMemo(
    () =>
      context && isInitialized ? context.services.get<CharacterService>(Services.Character) : null,
    [context, isInitialized]
  );

  const [config, setConfig] = useState<VoiceConfiguration | null>(null);
  const [rows, setRows] = useState<PanelRow[]>([]);
  const [progressByLocale, setProgressByLocale] = useState<Record<string, VoiceProgress>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  const [localeMenu, setLocaleMenu] = useState<LocaleMenuState | null>(null);

  // Add-language inline form (collapsed by default; the panel shows no idle inputs).
  const [addingLocale, setAddingLocale] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [nameDraftTouched, setNameDraftTouched] = useState(false);

  useEffect(() => {
    if (!voiceService) {
      return;
    }
    setConfig(voiceService.getConfiguration());
    return voiceService.onConfigChanged(setConfig);
  }, [voiceService]);

  // Every spoken line of the project (narration + dialogue across all stories),
  // in narrative order — the coverage denominator for each voice language.
  //
  // Cached per story and re-extracted one story at a time. A document change used to re-read and
  // re-walk EVERY story in the project, and a document change is what the story editor emits while
  // an author types - so a full-project scan ran on every keystroke, then fanned out into a
  // coverage recount per voice language.
  useEffect(() => {
    if (!storyService || !voiceService) {
      return;
    }
    let disposed = false;
    const byStory = new Map<string, PanelRow[]>();

    const publish = () => {
      if (disposed) {
        return;
      }
      // Rebuilt from the story order rather than from map insertion order, so a re-extracted
      // story stays where it was rather than jumping to the end of the coverage denominator.
      const collected: PanelRow[] = [];
      for (const entry of storyService.listStories()) {
        collected.push(...(byStory.get(entry.id) ?? []));
      }
      setRows(collected);
    };

    const extract = async (storyId: string): Promise<void> => {
      try {
        const document = await storyService.loadStory(storyId);
        byStory.set(
          storyId,
          voiceService.extractRows(document).map((row) => ({
            unitId: row.unitId,
            sourceText: row.sourceText
          }))
        );
      } catch {
        // A broken story must not take the panel down - it contributes no lines.
        byStory.set(storyId, []);
      }
    };

    const rebuildAll = async (): Promise<void> => {
      const ids = storyService.listStories().map((entry) => entry.id);
      for (const id of ids) {
        if (!byStory.has(id)) {
          await extract(id);
        }
      }
      for (const id of [...byStory.keys()]) {
        if (!ids.includes(id)) {
          byStory.delete(id);
        }
      }
      publish();
    };

    void rebuildAll();
    const unsubscribeLibrary = storyService.onLibraryChanged(() => void rebuildAll());
    const unsubscribeDocument = storyService.onDocumentChanged((event) => {
      void extract(event.storyId).then(publish);
    });
    return () => {
      disposed = true;
      unsubscribeLibrary();
      unsubscribeDocument();
    };
  }, [storyService, voiceService]);

  // Per-language coverage; recomputed when rows, config, or any assignment changes.
  useEffect(() => {
    if (!voiceService || !config) {
      return;
    }
    let disposed = false;
    void (async () => {
      const next: Record<string, VoiceProgress> = {};
      for (const locale of config.voicedLocales) {
        try {
          await voiceService.loadDocument(locale.code);
          // Coverage is measured against the text this language's actor reads, so its
          // translation table has to be in memory before the (synchronous) count runs.
          await voiceService.loadLineTexts(locale.code);
          next[locale.code] = voiceService.computeProgress(rows, locale.code);
        } catch {
          // Skip broken locale files; the row simply shows no coverage.
        }
      }
      if (!disposed) {
        setProgressByLocale(next);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [voiceService, config, rows, refreshTick]);

  useEffect(() => {
    if (!voiceService) {
      return;
    }
    return voiceService.onDocumentChanged(() => setRefreshTick((tick) => tick + 1));
  }, [voiceService]);

  const handleCodeDraftChange = useCallback(
    (value: string) => {
      setCodeDraft(value);
      if (!nameDraftTouched) {
        setNameDraft(value.trim() ? autonymFor(value.trim()) : "");
      }
    },
    [nameDraftTouched]
  );

  const cancelAddLocale = useCallback(() => {
    setAddingLocale(false);
    setCodeDraft("");
    setNameDraft("");
    setNameDraftTouched(false);
  }, []);

  const handleAddLocale = useCallback(async () => {
    if (!voiceService) {
      return;
    }
    const code = codeDraft.trim();
    if (!isValidLocaleCode(code)) {
      uiService?.showNotification(t("workspace.voice.panel.invalidCode"), "warning");
      return;
    }
    try {
      await voiceService.addLocale({ code, displayName: nameDraft.trim() || autonymFor(code) });
      cancelAddLocale();
    } catch (error) {
      uiService?.showError(error instanceof Error ? error : String(error));
    }
  }, [voiceService, uiService, codeDraft, nameDraft, cancelAddLocale, t]);

  const handleRemoveLocale = useCallback(
    async (code: string, displayName: string) => {
      if (!voiceService || !uiService) {
        return;
      }
      const confirmed = await uiService.showConfirm(
        t("workspace.voice.panel.removeConfirm", { name: displayName }),
        t("workspace.voice.panel.removeConfirmDetail")
      );
      if (!confirmed) {
        return;
      }
      try {
        await voiceService.removeLocale(code);
      } catch (error) {
        uiService.showError(error instanceof Error ? error : String(error));
      }
    },
    [voiceService, uiService, t]
  );

  const commitNamingPattern = useCallback(
    (value: string) => {
      const next = value.trim() || DEFAULT_VOICE_NAMING_PATTERN;
      if (!voiceService || next === (config?.namingPattern ?? DEFAULT_VOICE_NAMING_PATTERN)) {
        return;
      }
      void voiceService
        .updateConfiguration((current) => ({ ...current, namingPattern: next }))
        .catch((error) => uiService?.showError(error instanceof Error ? error : String(error)));
    },
    [voiceService, config, uiService]
  );

  const handleOpenTable = useCallback(
    (code: string, displayName: string) => {
      openEditorTab(createVoiceEditorTab(code, displayName));
    },
    [openEditorTab]
  );

  const speakerNameFor = useCallback(
    (row: StoryTranslationRow): string => {
      if (row.role === "dialogue" && row.characterId) {
        const character = characterService?.getCharacter(row.characterId);
        if (character) {
          return character.profile.getName();
        }
      }
      return t("workspace.voice.table.narrationSpeaker");
    },
    [characterService, t]
  );

  // Gather every voiceable line across all stories as recording-script entries
  // (speaker resolved, 1-based index within each scene). On-demand — the
  // coverage rows above stay lean.
  //
  // Per voice language, because the line an actor records is the line in THEIR language: the
  // script a Japanese booth is handed has to be the Japanese text, not the authored source.
  const gatherEntries = useCallback(
    async (locale: string): Promise<VoiceScriptEntry[]> => {
      if (!storyService || !voiceService) {
        return [];
      }
      await voiceService.loadLineTexts(locale);
      const flat: (VoiceScriptEntry & { sceneId: string })[] = [];
      for (const entry of storyService.listStories()) {
        try {
          const document = await storyService.loadStory(entry.id);
          for (const row of voiceService.extractRows(document)) {
            flat.push({
              unitId: row.unitId,
              sceneId: row.sceneId,
              sceneName: row.sceneName,
              indexInScene: 0,
              speaker: speakerNameFor(row),
              sourceText: voiceService.getLineText(locale, row.unitId, row.sourceText)
            });
          }
        } catch {
          // A broken story must not abort the whole export.
        }
      }
      return withSceneIndices(flat).map(({ sceneId: _sceneId, ...entry }) => entry);
    },
    [storyService, voiceService, speakerNameFor]
  );

  const writeCsvToChosenFile = useCallback(
    async (defaultName: string, csv: string): Promise<boolean> => {
      if (!context) {
        return false;
      }
      const selection = await appPrivilegedFacade.fs.selectSaveFile(defaultName, ["csv"]);
      if (!selection.success || !selection.data.ok) {
        const message =
          selection.success && !selection.data.ok ? selection.data.error.message : undefined;
        throw new Error(message || "Save dialog failed");
      }
      const targetPath = selection.data.data;
      if (!targetPath) {
        return false;
      }
      const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
      const result = await filesystem.write(targetPath, "﻿" + csv, "utf-8");
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      uiService?.showNotification(
        t("workspace.voice.panel.exportDone", { path: targetPath }),
        "success"
      );
      return true;
    },
    [context, uiService, t]
  );

  const handleExportScript = useCallback(
    async (code: string, pickupOnly: boolean) => {
      if (!voiceService || !config) {
        return;
      }
      try {
        const entries = await gatherEntries(code);
        const document = await voiceService.loadDocument(code).catch(() => undefined);
        const selected = pickupOnly
          ? entries.filter(
              (entry) =>
                deriveVoiceUnitState(document?.units[entry.unitId], entry.sourceText) === "stale"
            )
          : entries;
        if (pickupOnly && selected.length === 0) {
          uiService?.showNotification(t("workspace.voice.panel.pickupEmpty"), "info");
          return;
        }
        const csv = serializeVoiceCsv(
          buildRecordingScriptRows(selected, config.namingPattern, code, document)
        );
        await writeCsvToChosenFile(`${code}-voice-${pickupOnly ? "pickup" : "script"}.csv`, csv);
      } catch (error) {
        uiService?.showError(error instanceof Error ? error : String(error));
      }
    },
    [voiceService, config, gatherEntries, writeCsvToChosenFile, uiService, t]
  );

  /** Fill in take lengths after a batch link. Best-effort and unattended - a file that will not decode is skipped. */
  const measureDurations = useCallback(
    async (
      code: string,
      takes: readonly { unitId: string; sourceText: string; assetId: string }[]
    ): Promise<void> => {
      if (!voiceService || !context || takes.length === 0) {
        return;
      }
      const assetsService = context.services.get<AssetsService>(Services.Assets);
      for (const take of takes) {
        const asset = assetsService.getAssets()[AssetType.Audio]?.[take.assetId];
        if (!asset) {
          continue;
        }
        const result = await assetsService.fetch(asset);
        if (!result.success) {
          continue;
        }
        const duration = await readAudioDuration(
          new Uint8Array((result.data as { data: Uint8Array }).data)
        );
        if (duration !== undefined) {
          voiceService.updateUnit(code, take.unitId, take.sourceText, { duration });
        }
      }
      await voiceService.flushPendingChanges();
    },
    [voiceService, context]
  );

  /**
   * Fold a filled-in recording script back into the library: the director's notes and approvals.
   *
   * The export side has existed since the module shipped; this is the return leg it never had, so
   * everything a booth or a director wrote in the spreadsheet had to be retyped by hand.
   */
  const handleImportScript = useCallback(
    async (code: string) => {
      if (!voiceService || !context) {
        return;
      }
      try {
        const selection = await appPrivilegedFacade.fs.selectFile(["csv"], false);
        if (!selection.success || !selection.data.ok || selection.data.data.length === 0) {
          return;
        }
        const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
        const read = await filesystem.read(selection.data.data[0], "utf-8");
        if (!read.ok) {
          throw new Error(read.error.message);
        }
        const parsed = parseVoiceCsv(String(read.data));
        if (parsed.rows.length === 0) {
          throw new Error(parsed.errors[0] || t("workspace.voice.panel.importScriptFailed"));
        }
        await voiceService.loadDocument(code);
        const summary = voiceService.applyImportedRows(code, parsed.rows);
        await voiceService.flushPendingChanges();
        uiService?.showNotification(
          t("workspace.voice.panel.importScriptSummary", summary),
          "success"
        );
        setRefreshTick((tick) => tick + 1);
      } catch (error) {
        uiService?.showError(error instanceof Error ? error : String(error));
      }
    },
    [voiceService, context, uiService, t]
  );

  const handleImportAudio = useCallback(
    async (code: string) => {
      if (!voiceService || !context || !config) {
        return;
      }
      try {
        const selection = await appPrivilegedFacade.fs.selectFile(AUDIO_IMPORT_EXTENSIONS, true);
        if (!selection.success || !selection.data.ok || selection.data.data.length === 0) {
          return;
        }
        const paths = selection.data.data;
        await voiceService.loadDocument(code);
        const keyMap = buildVoiceNameKeyMap(await gatherEntries(code), config.namingPattern, code);
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        const importResult = await assetsService.importFromPaths(AssetType.Audio, paths);
        if (!importResult.success) {
          throw new Error(importResult.error || t("workspace.voice.panel.importFailed"));
        }
        let linked = 0;
        let unmatched = 0;
        let failed = 0;
        const measured: { unitId: string; sourceText: string; assetId: string }[] = [];
        importResult.data.forEach((result, index) => {
          if (!result.success) {
            failed += 1;
            return;
          }
          const hit = keyMap.get(matchKeyForFilename(paths[index]));
          if (!hit) {
            unmatched += 1;
            return;
          }
          voiceService.updateUnit(code, hit.unitId, hit.sourceText, { assetId: result.data.id });
          measured.push({
            unitId: hit.unitId,
            sourceText: hit.sourceText,
            assetId: result.data.id
          });
          linked += 1;
        });
        await voiceService.flushPendingChanges();
        uiService?.showNotification(
          t("workspace.voice.panel.importSummary", { linked, unmatched, failed }),
          "success"
        );
        setRefreshTick((tick) => tick + 1);
        // Lengths trail the import rather than gating it: a booth hands back hundreds of files at
        // once and nobody should watch a spinner decode headers to learn the takes are linked.
        void measureDurations(code, measured);
      } catch (error) {
        uiService?.showError(error instanceof Error ? error : String(error));
      }
    },
    [voiceService, context, config, gatherEntries, uiService, t]
  );

  const localeMenuItems = useMemo<ContextMenuDef>(() => {
    if (!localeMenu) {
      return [];
    }
    const { code, displayName } = localeMenu;
    return [
      {
        id: "export-script",
        label: t("workspace.voice.panel.exportScript"),
        onClick: () => void handleExportScript(code, false)
      },
      {
        id: "export-pickup",
        label: t("workspace.voice.panel.exportPickup"),
        onClick: () => void handleExportScript(code, true)
      },
      {
        id: "import-audio",
        label: t("workspace.voice.panel.importAudio"),
        onClick: () => void handleImportAudio(code)
      },
      {
        id: "import-script",
        label: t("workspace.voice.panel.importScript"),
        onClick: () => void handleImportScript(code)
      },
      { id: "separator", separator: true },
      {
        id: "remove-language",
        label: t("workspace.voice.panel.removeLanguage"),
        onClick: () => void handleRemoveLocale(code, displayName)
      }
    ];
  }, [
    localeMenu,
    handleExportScript,
    handleImportAudio,
    handleImportScript,
    handleRemoveLocale,
    t
  ]);
  const frozenLocaleMenuItems = useMemo(
    () =>
      freezeContextMenuRows(
        localeMenuItems,
        freeze.frozen,
        FREEZE_READ_ONLY_VOICE_MENU_IDS,
        freeze.reason
      ),
    [freeze, localeMenuItems]
  );

  const locales = config?.voicedLocales ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col" data-panel-id={panelId}>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          <div className="truncate text-xs font-medium text-fg">
            {t("workspace.voice.panel.languagesTitle")}
          </div>
          <p className="text-2xs leading-snug text-fg-subtle">
            {t("workspace.voice.panel.languagesHint")}
          </p>
          {/* No voice languages: no list. The "+ Add voice language" row directly below is
                        the action, so a bordered box repeating it is that button twice. */}
          {locales.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              {locales.map((locale) => {
                const progress = progressByLocale[locale.code];
                const menuOpen = localeMenu?.code === locale.code;
                return (
                  <div
                    key={locale.code}
                    role="button"
                    tabIndex={0}
                    data-tip={t("workspace.voice.panel.openTable")}
                    className="group flex cursor-pointer flex-col gap-1.5 rounded-md border border-edge-subtle px-2.5 py-2 text-left hover:border-edge focus-visible:border-primary/50 focus-visible:outline-none"
                    onClick={() => handleOpenTable(locale.code, locale.displayName)}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
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
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        data-tip={t("workspace.voice.panel.more")}
                        aria-label={t("workspace.voice.panel.more")}
                        className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-opacity hover:bg-fill hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 ${
                          menuOpen ? "opacity-100" : "opacity-0"
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setLocaleMenu({
                            code: locale.code,
                            displayName: locale.displayName,
                            position: { x: rect.left, y: rect.bottom + 4 }
                          });
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Ellipsis className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Progress
                        value={progress ? progress.covered : 0}
                        max={Math.max(1, progress?.total ?? 1)}
                        size="sm"
                      />
                      <span className="flex items-center gap-2 text-2xs text-fg-subtle">
                        {t("workspace.voice.panel.progress", {
                          covered: progress?.covered ?? 0,
                          total: progress?.total ?? 0
                        })}
                        {progress && progress.stale > 0 ? (
                          <span className="text-warning">
                            {t("workspace.voice.panel.staleCount", { count: progress.stale })}
                          </span>
                        ) : null}
                      </span>
                    </div>
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
              <Plus className="h-3 w-3" /> {t("workspace.voice.panel.addLanguage")}
            </button>
          ) : (
            <div
              className="mt-1 flex items-center gap-1.5"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  cancelAddLocale();
                }
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  cancelAddLocale();
                }
              }}
            >
              <input
                autoFocus
                className={`${INPUT_CLASS} w-24 flex-none`}
                value={codeDraft}
                placeholder={t("workspace.voice.panel.codePlaceholder")}
                onChange={(event) => handleCodeDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleAddLocale();
                  }
                }}
                aria-label={t("workspace.voice.panel.codePlaceholder")}
              />
              <input
                className={INPUT_CLASS}
                value={nameDraft}
                placeholder={t("workspace.voice.panel.namePlaceholder")}
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  setNameDraftTouched(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleAddLocale();
                  }
                }}
                aria-label={t("workspace.voice.panel.namePlaceholder")}
              />
              <button
                type="button"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-edge text-fg-muted hover:border-primary/50 hover:text-fg"
                onClick={() => void handleAddLocale()}
                data-tip={t("workspace.voice.panel.confirm")}
                aria-label={t("workspace.voice.panel.confirm")}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        {/* The convention the booth records to, and the one batch import matches back against.
                    It lived only in the project file before, so a project whose names the default
                    pattern did not suit had to be hand-edited on disk to change it. Shown only once
                    a language exists, because it is meaningless before there is a script to export. */}
        {locales.length > 0 ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <div className="truncate text-xs font-medium text-fg">
              {t("workspace.voice.panel.namingTitle")}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                className={INPUT_CLASS}
                defaultValue={config?.namingPattern ?? DEFAULT_VOICE_NAMING_PATTERN}
                key={config?.namingPattern ?? DEFAULT_VOICE_NAMING_PATTERN}
                readOnly={freeze.frozen}
                data-tip={freeze.frozen ? freeze.reason : undefined}
                onBlur={(event) => commitNamingPattern(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    (event.target as HTMLInputElement).blur();
                  }
                }}
                aria-label={t("workspace.voice.panel.namingTitle")}
              />
              {config && config.namingPattern !== DEFAULT_VOICE_NAMING_PATTERN ? (
                <button
                  type="button"
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-fg-subtle hover:bg-fill hover:text-fg"
                  onClick={() => commitNamingPattern(DEFAULT_VOICE_NAMING_PATTERN)}
                  {...freeze.writes(false, t("workspace.voice.panel.namingReset"))}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <p className="text-2xs leading-snug text-fg-subtle">
              {t("workspace.voice.panel.namingHint", { tokens: NAMING_TOKEN_HINT })}
            </p>
          </div>
        ) : null}
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
