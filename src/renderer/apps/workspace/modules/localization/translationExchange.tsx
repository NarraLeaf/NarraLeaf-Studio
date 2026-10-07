/**
 * Handing one language's translations to a translator as a file, and folding the file they send
 * back into the project.
 *
 * Shared by the two places an author does this from - the language's menu in the Localization panel,
 * and the toolbar of that language's translation table - so the dialog, the formats, the refusals and
 * the summary are one implementation whichever way it was reached.
 *
 * Comments in English per project convention.
 */

import { useCallback, useMemo, useState } from "react";
import { useWorkspace } from "../../context";
import { i18nStore, useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import {
    buildTranslationExchangeRows,
    extractCharacterTranslationRows,
    extractKeyTranslationRows,
    extractEndingTranslationRows,
    extractSceneTranslationRows,
    extractUiTranslationRows,
    type TranslatableUnitContext,
    type TranslationExportScope,
} from "@/lib/workspace/services/localization/localizationModel";
import { listPluginWordsRows } from "@/lib/workspace/services/localization/pluginWords";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { describeLocalizationKeyContext, indexLocalizationKeyUses } from "@/lib/workspace/services/localization/localizationKeyUses";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { LocalizationDocument } from "@shared/types/localization";
import {
    TRANSLATION_EXCHANGE_FORMAT_INFO,
    detectTranslationExchangeFormat,
    parseTranslationExchange,
    serializeTranslationExchange,
    translationExchangeExtensions,
    type TranslationExchangeFormat,
} from "@shared/utils/localizationExchange";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { TranslationExportForm } from "./TranslationExportForm";
import { basename } from "@shared/utils/path";
import { describeFileWriteFailure } from "@/lib/workspace/services/core/writeFailureReason";
import { itemWrite } from "@/lib/workspace/services/autosave/writeReport";
import {
    describeExchangeProblem,
    describeImportFailure,
    fileLevelProblem,
    importReadFailureReason,
} from "@/lib/workspace/assets/importFailure";

/** The services the project's translatable units are read from. Any may be absent while the workspace comes up. */
export type TranslatableUnitSources = {
    storyService: StoryService | null;
    localizationService: LocalizationService | null;
    characterService: CharacterService | null;
    uiDocumentService: UIDocumentService | null;
};

/** The project's blueprints, or none while their store is still coming up. */
function readBlueprintDocument(uiDocumentService: UIDocumentService | null): BlueprintDocument | null {
    try {
        return uiDocumentService?.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument() ?? null;
    } catch {
        return null;
    }
}

/**
 * Every translatable unit of the project, with the context a translator needs: character names, scene
 * names, ending names and story lines (narrative order), widgets' own words, plugins' words, and named keys.
 *
 * What both the panel's progress and an exported file count, so the two always agree.
 */
export async function collectTranslatableUnits(sources: TranslatableUnitSources): Promise<TranslatableUnitContext[]> {
    const { storyService, localizationService, characterService, uiDocumentService } = sources;
    if (!storyService || !localizationService) {
        return [];
    }
    const collected: TranslatableUnitContext[] = [];
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
            for (const row of extractSceneTranslationRows(document)) {
                // The story is the context a scene name needs: the name itself is the source
                // column, so repeating it there would tell the translator nothing.
                collected.push({
                    unitId: row.unitId,
                    sourceText: row.sourceText,
                    context: document.name || row.sourceText,
                });
            }
            for (const row of extractEndingTranslationRows(document)) {
                // The scene the ending is reached in, the way a line is placed by its scene.
                collected.push({
                    unitId: row.unitId,
                    sourceText: row.sourceText,
                    context: row.sceneName || document.name || row.sourceText,
                });
            }
            for (const row of localizationService.extractRows(document)) {
                collected.push({
                    unitId: row.unitId,
                    sourceText: row.sourceText,
                    ...(row.sourceMarkup ? { sourceMarkup: row.sourceMarkup } : {}),
                    context: row.sceneName,
                });
            }
        } catch {
            // A broken story must not take the panel down.
        }
    }
    const uiDocument = uiDocumentService?.getDocument();
    if (uiDocument) {
        for (const row of extractUiTranslationRows(uiDocument, { locale: i18nStore.getLocale() })) {
            collected.push({
                unitId: row.unitId,
                sourceText: row.sourceText,
                context: row.groupName ? `${row.groupName} · ${row.elementName}` : row.elementName,
            });
        }
    }
    // The words plugins offer - a menu row's label, a gallery entry's name - beside the
    // interface's own, under the plugin that holds them.
    for (const row of listPluginWordsRows()) {
        collected.push({ unitId: row.unitId, sourceText: row.sourceText, context: row.context });
    }
    let keysDocument = localizationService.getKeysIfLoaded();
    if (!keysDocument) {
        keysDocument = await localizationService.loadKeys().catch(() => undefined);
    }
    // A key's row says where the key is used - the pages and components showing its words or
    // reading it in a blueprint - since its name alone tells a translator nothing about them.
    const keyUses = indexLocalizationKeyUses({
        uiDocument: uiDocument ?? null,
        blueprintDocument: readBlueprintDocument(uiDocumentService),
        widgetName: element => widgetModuleRegistry.get(element.type)?.displayName || element.type,
    });
    for (const row of extractKeyTranslationRows(keysDocument ?? { schemaVersion: 1, keys: {} })) {
        collected.push({
            unitId: row.unitId,
            sourceText: row.sourceText,
            context: describeLocalizationKeyContext(row.keyName, keyUses.get(row.keyName)),
        });
    }
    return collected;
}

/** The workspace services `collectTranslatableUnits` reads, or nulls before the workspace is up. */
export function useTranslatableUnitSources(): TranslatableUnitSources & {
    uiService: UIService | null;
} {
    const { context, isInitialized } = useWorkspace();
    return useMemo(() => {
        if (!context || !isInitialized) {
            return { storyService: null, localizationService: null, characterService: null, uiDocumentService: null, uiService: null };
        }
        return {
            storyService: context.services.get<StoryService>(Services.Story),
            localizationService: context.services.get<LocalizationService>(Services.Localization),
            characterService: context.services.get<CharacterService>(Services.Character),
            uiDocumentService: context.services.get<UIDocumentService>(Services.UIDocument),
            uiService: context.services.get<UIService>(Services.UI),
        };
    }, [context, isInitialized]);
}

export type TranslationExchange = {
    /** Ask for a format and a scope, then write the language's translations to a file the author picks. */
    exportLanguage: (code: string, displayName: string) => Promise<void>;
    /**
     * Fold a translator's file back into the language. `frozen` is the caller's answer for this
     * language's translations: refused before the picker opens rather than at the save.
     */
    importLanguage: (code: string, displayName: string, frozen: boolean) => Promise<void>;
};

/**
 * The export and the import of one language's translations.
 *
 * The project's units are read when one of them is asked for rather than held: the table this is
 * reached from shows one source at a time and has no other reason to read the whole project, and an
 * export has to describe the project as it is at that moment anyway.
 */
export function useTranslationExchange(): TranslationExchange {
    const { context } = useWorkspace();
    const { t, tn } = useTranslation();
    const sources = useTranslatableUnitSources();
    const { localizationService, uiService } = sources;

    // Last format chosen for an export: a team that translates in Poedit does so
    // every time, and re-picking it per language is the kind of friction that
    // makes people export once and edit JSON by hand instead.
    const [exportFormat, setExportFormat] = useState<TranslationExchangeFormat>("csv");

    /** Written into the exported file so a translator can tell two projects apart. */
    const projectName = useMemo(() => {
        try {
            return context?.services.get<ProjectService>(Services.Project).getProjectConfig().name?.trim() ?? "";
        } catch {
            return "";
        }
    }, [context]);

    /** Write one exchange file, after the dialog has settled format and scope. */
    const writeExport = useCallback(async (
        code: string,
        format: TranslationExchangeFormat,
        scope: TranslationExportScope,
        rows: readonly TranslatableUnitContext[],
    ) => {
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
                // The dialog's own failure is for the log; it is English and says nothing to act on.
                console.warn("[localization] the save dialog failed", selection);
                throw new Error(t("workspace.shell.fileDialogFailed"));
            }
            const targetPath = selection.data.data;
            if (!targetPath) {
                return;
            }
            const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
            // Reported here, where the author asked for it, by the name they gave the file - the
            // save-status surface only logs it. Never the system's message, which is English and
            // quotes the whole path.
            const result = await filesystem.write(
                targetPath,
                text,
                "utf-8",
                itemWrite(basename(targetPath), "workspace.shell.save.stores.localization", "handledByWriter"),
            );
            if (!result.ok) {
                throw new Error(describeFileWriteFailure(basename(targetPath), result.error, t));
            }
            uiService?.showNotification(
                tn("workspace.localization.exchange.exportDone", exportRows.length, { path: targetPath }),
                "success",
            );
        } catch (error) {
            uiService?.showError(error instanceof Error ? error : String(error));
        }
    }, [localizationService, context, uiService, projectName, t, tn]);

    const exportLanguage = useCallback(async (code: string, displayName: string) => {
        if (!localizationService || !uiService) {
            return;
        }
        let document: LocalizationDocument;
        let rows: TranslatableUnitContext[];
        try {
            document = await localizationService.loadDocument(code);
            rows = await collectTranslatableUnits(sources);
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
                        void writeExport(code, format, scope, rows);
                    },
                },
            ],
        });
    }, [localizationService, uiService, sources, exportFormat, writeExport, t]);

    /**
     * Fold a translator's exchange file back into the language's document.
     *
     * Refused before the picker opens rather than at the save. The control this hangs off is greyed
     * by the freeze already, but it was drawn before the author started reading the file list, and
     * everything between the picker and the write - the parse, the "this file names a different
     * language" confirmation - is time in which a session can begin. Asking a translator to confirm
     * an overwrite that is then discarded is the worst version of this.
     */
    const importLanguage = useCallback(async (code: string, displayName: string, frozen: boolean) => {
        if (!localizationService || !context || !uiService || frozen) {
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
            // Every refusal below names the file by its name and says why in the author's terms. The
            // read's own message is English and quotes the whole path, and the parsers answer in codes.
            const content = await filesystem.read(filePath, "utf-8");
            if (!content.ok) {
                console.warn("[localization] could not read the translation file", content.error);
                throw new Error(describeImportFailure(filePath, importReadFailureReason(content.error.code, t), t));
            }
            const format = detectTranslationExchangeFormat(filePath, content.data);
            if (!format) {
                throw new Error(describeImportFailure(filePath, t("workspace.localization.exchange.importUnsupported"), t));
            }
            const parsed = parseTranslationExchange(format, content.data);
            if (parsed.rows.length === 0) {
                throw new Error(describeImportFailure(
                    filePath,
                    describeExchangeProblem(fileLevelProblem(parsed.problems), t),
                    t,
                ));
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
            const rows = await collectTranslatableUnits(sources);
            const currentSourceByUnit = new Map(rows.map(row => [row.unitId, row.sourceText]));
            const summary = localizationService.applyImportedRows(code, parsed.rows, currentSourceByUnit);
            uiService.showNotification(t("workspace.localization.panel.importCounts", {
                ...summary,
                applied: tn("workspace.localization.panel.translationCount", summary.applied),
            }), "success");
            if (parsed.problems.length > 0) {
                uiService.showNotification(
                    tn("workspace.localization.exchange.importWarnings", parsed.problems.length, {
                        first: describeExchangeProblem(parsed.problems[0], t),
                    }),
                    "warning",
                );
            }
        } catch (error) {
            uiService.showError(error instanceof Error ? error : String(error));
        }
    }, [localizationService, context, uiService, sources, t, tn]);

    return useMemo(() => ({ exportLanguage, importLanguage }), [exportLanguage, importLanguage]);
}
