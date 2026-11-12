import { useCallback, useMemo, useState, type ReactNode } from "react";
import { listSceneIdsInDocumentOrder, type StoryBlock, type StoryDocument, type StoryId, type StorySceneId } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import { basename } from "@shared/utils/path";
import { getInterface } from "@/lib/app/bridge";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { useTranslation } from "@/lib/i18n";
import { materializePastedRows, speakerMemoryKey } from "@/lib/story/paste/storyPasteModel";
import type { PastePlan, SpeakerMappingTarget } from "@/lib/story/paste/storyPasteTypes";
import { buildManuscript, listManuscriptSpeakers, type ManuscriptLabels } from "@/lib/story/manuscript/manuscriptModel";
import { buildManuscriptDocx, renderManuscriptFooter, renderManuscriptHtml, type ManuscriptLocale } from "@/lib/story/manuscript/manuscriptRender";
import {
    docxToSource,
    parseDelimitedText,
    parseFountain,
    partitionPlanIntoScenes,
    sourceSceneLineCounts,
    type ManuscriptImportSource,
} from "@/lib/story/manuscript/manuscriptImport";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { Services } from "@/lib/workspace/services/services";
import { describeImportFailure, importReadFailureReason } from "@/lib/workspace/assets/importFailure";
import { useWorkspace } from "../../../context";
import { useRegistry } from "../../../registry";
import { createStorySceneEditorTab } from "../scene-editor/openStorySceneEditorTab";
import {
    forgetStoryPasteSeparator,
    getStoryPasteMemory,
    rememberStoryPasteSpeakers,
    saveStoryPasteSeparator,
} from "../scene-editor/storyPasteMemory";
import { createStoryScriptLabeller, createStoryScriptSpeakerLabeller, exportFileName } from "../script/storyScriptIo";
import { ManuscriptExportModal, type ManuscriptExportChoice } from "./ManuscriptExportModal";
import { ManuscriptImportModal, type ManuscriptImportFile, type ManuscriptImportRequest } from "./ManuscriptImportModal";

/** The extensions the import picker offers. */
export const MANUSCRIPT_IMPORT_EXTENSIONS = ["docx", "fountain", "spmd", "csv", "tsv", "xlsx"];

type ExportRequest = {
    storyId: StoryId;
    document: StoryDocument;
    initialSceneIds: StorySceneId[] | null;
};

export type ManuscriptIo = {
    beginImport: (storyId: StoryId) => void;
    /** The import without its file picker: the wizard on a file already chosen. */
    importPath: (storyId: StoryId, filePath: string) => Promise<void>;
    /** The export without its dialogs, to a path already chosen. */
    exportTo: (storyId: StoryId, choice: ManuscriptExportChoice, targetPath: string) => Promise<void>;
    beginExport: (target: { storyId: StoryId; sceneIds: StorySceneId[] | null }) => void;
    dialogs: ReactNode;
};

/** The typesetting language: the project's source language, which is the language of its text. */
function manuscriptLocale(code: string | null | undefined): ManuscriptLocale {
    const lower = (code ?? "").toLowerCase();
    return lower.startsWith("zh") ? "zh" : lower.startsWith("ja") ? "ja" : "en";
}

/** A name the author wrote in a file, resolved to a decision once the confirm created characters. */
function resolveMappingsForMemory(
    authored: Record<string, SpeakerMappingTarget>,
    created: Record<string, string>,
): Record<string, SpeakerMappingTarget> {
    const resolved: Record<string, SpeakerMappingTarget> = {};
    for (const [key, target] of Object.entries(authored)) {
        if (target.kind !== "createCharacter") {
            resolved[key] = target;
            continue;
        }
        const match = Object.entries(created).find(([name]) => speakerMemoryKey(name) === key);
        if (match) {
            resolved[key] = { kind: "character", characterId: match[1] };
        }
    }
    return resolved;
}

/**
 * Script documents in and out of a story, as one thing a surface can mount - the story panel's menus
 * and the command palette drive the same dialogs.
 *
 * Import ends in new scenes, never in edits to existing ones: a file from outside Studio has no ids
 * to match rows against, and adding scenes is the one write that cannot take anything back from the
 * author. All of them are one step of undo.
 */
export function useManuscriptIo(): ManuscriptIo {
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const { t, tn } = useTranslation();
    const [importRequest, setImportRequest] = useState<(ManuscriptImportRequest & { storyId: StoryId }) | null>(null);
    const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null);
    const [busy, setBusy] = useState(false);
    const [memoryRevision, setMemoryRevision] = useState(0);

    const report = useCallback((error: unknown) => {
        context?.services.get<UIService>(Services.UI).showError(error instanceof Error ? error : String(error));
    }, [context]);

    // ----------------------------------------------------------------------- import

    const readFile = useCallback(async (filePath: string): Promise<ManuscriptImportFile> => {
        if (!context) {
            throw new Error(t("manuscript.error.failed"));
        }
        const name = basename(filePath);
        const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
        if (extension === "docx" || extension === "xlsx") {
            const response = await getInterface().manuscript.readOffice(filePath);
            if (!response.success) {
                console.warn("[manuscript] reading the document failed", response);
                throw new Error(t("manuscript.error.unreadable", { file: name }));
            }
            const result = response.data.result;
            if (!result.ok) {
                throw new Error(t(`manuscript.error.${result.reason}` as TranslationKey, { file: name }));
            }
            return result.kind === "docx"
                ? { kind: "source", source: docxToSource(result.paragraphs) }
                : { kind: "table", sheets: result.sheets };
        }
        const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
        const content = await filesystem.read(filePath, "utf-8");
        if (!content.ok) {
            console.warn("[manuscript] could not read the file", content.error);
            throw new Error(describeImportFailure(filePath, importReadFailureReason(content.error.code, t), t));
        }
        if (extension === "fountain" || extension === "spmd") {
            return { kind: "source", source: parseFountain(content.data) };
        }
        if (extension === "csv" || extension === "tsv") {
            return { kind: "table", sheets: [{ name, rows: parseDelimitedText(content.data) }] };
        }
        throw new Error(t("manuscript.error.unsupported", { file: name }));
    }, [context, t]);

    /** Open the wizard on a file. Separate from the picker so a path can be handed in directly. */
    const importPath = useCallback(async (storyId: StoryId, filePath: string) => {
        try {
            const file = await readFile(filePath);
            const empty = file.kind === "source"
                ? sourceSceneLineCounts(file.source).every(count => count === 0)
                : file.sheets.every(sheet => sheet.rows.every(row => row.length === 0));
            if (empty) {
                throw new Error(t("manuscript.error.empty", { file: basename(filePath) }));
            }
            setImportRequest({ storyId, fileName: basename(filePath), file });
        } catch (error) {
            report(error);
        }
    }, [readFile, report, t]);

    const beginImport = useCallback(async (storyId: StoryId) => {
        if (!context || !isInitialized) {
            return;
        }
        if (context.services.get<LiveSessionService>(Services.Live).ownsStory(storyId)) {
            context.services.get<UIService>(Services.UI).showError(t("workspace.shell.freeze.unavailableLive"));
            return;
        }
        const selection = await appPrivilegedFacade.fs.selectFile(MANUSCRIPT_IMPORT_EXTENSIONS, false, t("manuscript.importPickerTitle"));
        if (!selection.success || !selection.data.ok || selection.data.data.length === 0) {
            return;
        }
        await importPath(storyId, selection.data.data[0]);
    }, [context, importPath, isInitialized, t]);

    const confirmImport = useCallback(async (
        source: ManuscriptImportSource,
        plan: PastePlan,
        authored: Record<string, SpeakerMappingTarget>,
    ) => {
        const request = importRequest;
        if (!context || !request) {
            return;
        }
        if (getProjectWriteFreeze() !== null) {
            report(t("workspace.shell.freeze.unavailable"));
            setImportRequest(null);
            return;
        }
        setBusy(true);
        try {
            const storyService = context.services.get<StoryService>(Services.Story);
            const characterService = context.services.get<CharacterService>(Services.Character);
            const uuidService = context.services.get<UuidService>(Services.Uuid);
            await storyService.loadStory(request.storyId);

            const created: Record<string, string> = {};
            for (const name of plan.charactersToCreate) {
                created[name] = characterService.createCharacter(name).profile.getId();
            }
            const generateId = () => uuidService.generate();
            const fallbackName = request.fileName.replace(/\.[^.]+$/, "") || t("manuscript.defaultSceneName");
            const scenes = partitionPlanIntoScenes(plan, source);
            const createdSceneIds: { id: StorySceneId; name: string }[] = [];
            storyService.runAgentOutlineStep(request.storyId, { key: "manuscript.historyLabel" as TranslationKey }, () => {
                scenes.forEach((planned, index) => {
                    const { blocks } = materializePastedRows(
                        { rows: planned.rows.map(entry => entry.row), charactersToCreate: plan.charactersToCreate, counts: plan.counts },
                        { generateId, createdCharacterIds: created },
                    );
                    const withNotes: StoryBlock[] = [];
                    blocks.forEach((block, rowIndex) => {
                        withNotes.push(block);
                        const note = planned.rows[rowIndex]?.note;
                        if (note) {
                            withNotes.push({
                                id: generateId(),
                                kind: "note",
                                parentId: null,
                                childrenIds: [],
                                payload: { text: { textId: generateId(), role: "note", value: note } },
                            } as StoryBlock);
                        }
                    });
                    const name = planned.name ?? (scenes.length > 1 ? `${fallbackName} ${index + 1}` : fallbackName);
                    const scene = storyService.createScene(request.storyId, { name });
                    storyService.insertBlocks(
                        request.storyId,
                        scene.id,
                        withNotes.map(block => ({ block, target: { parentId: null, beforeBlockId: null } })),
                    );
                    createdSceneIds.push({ id: scene.id, name: scene.name });
                });
            });
            rememberStoryPasteSpeakers(
                context.services.get<PanelStateService>(Services.PanelState),
                resolveMappingsForMemory(authored, created),
            );
            setMemoryRevision(revision => revision + 1);
            context.services.get<UIService>(Services.UI).showNotification(tn("manuscript.imported", createdSceneIds.length), "success");
            const first = createdSceneIds[0];
            if (first) {
                openEditorTab(createStorySceneEditorTab({ storyId: request.storyId, sceneId: first.id }, first.name));
            }
            setImportRequest(null);
        } catch (error) {
            console.error("[manuscript] the import failed", error);
            report(t("manuscript.error.failed"));
        } finally {
            setBusy(false);
        }
    }, [context, importRequest, openEditorTab, report, t, tn]);

    // ----------------------------------------------------------------------- export

    const labelsFor = useCallback((document: StoryDocument): ManuscriptLabels | null => {
        if (!context) {
            return null;
        }
        const storyService = context.services.get<StoryService>(Services.Story);
        const characters = context.services.get<CharacterService>(Services.Character).listCharacter();
        const blueprintService = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const assets = context.services.get<AssetsService>(Services.Assets).getAssets();
        const motions = new Map(storyService.listAnimationAssets().map(entry => [entry.id, entry.name]));
        const assetName = (assetId: string): string | null => {
            for (const byId of Object.values(assets ?? {})) {
                const asset = (byId as Record<string, { name?: string }> | undefined)?.[assetId];
                if (asset?.name) {
                    return asset.name;
                }
            }
            return null;
        };
        return {
            label: createStoryScriptLabeller(
                document,
                characters,
                assetName,
                animationId => motions.get(animationId) ?? null,
                [...blueprintService.listSavedVariables(), ...blueprintService.listPersistentVariables()],
            ),
            speaker: createStoryScriptSpeakerLabeller(characters),
            unnamedSpeaker: t("manuscript.unnamedSpeaker"),
        };
    }, [context, t]);

    const beginExport = useCallback(async (target: { storyId: StoryId; sceneIds: StorySceneId[] | null }) => {
        if (!context || !isInitialized) {
            return;
        }
        try {
            const document = await context.services.get<StoryService>(Services.Story).loadStory(target.storyId);
            setExportRequest({ storyId: target.storyId, document, initialSceneIds: target.sceneIds });
        } catch (error) {
            report(error);
        }
    }, [context, isInitialized, report]);

    /**
     * Build the script for a choice and write it. `targetPath` is asked for with the save dialog
     * unless one is handed in (the development bridge does, to skip the native dialog).
     */
    const writeExport = useCallback(async (request: ExportRequest, choice: ManuscriptExportChoice, givenPath?: string): Promise<boolean> => {
        if (!context) {
            return false;
        }
        const labels = labelsFor(request.document);
        if (!labels) {
            return false;
        }
        const speakers = listManuscriptSpeakers(request.document, choice.sceneIds, labels.speaker, labels.unnamedSpeaker);
        const chosen = speakers.filter(speaker => choice.speakerKeys.includes(speaker.key));
        const only = choice.sceneIds.length === 1 ? request.document.scenes[choice.sceneIds[0]] : undefined;
        const title = only ? `${request.document.name} · ${only.name}` : request.document.name;
        const subtitle = [
            chosen.length > 0 ? t("manuscript.linesFor", { names: chosen.map(speaker => speaker.name).join("、") }) : null,
            tn("manuscript.sceneCount", choice.sceneIds.length),
        ].filter(Boolean).join("　");
        const manuscript = buildManuscript(request.document, {
            sceneIds: choice.sceneIds,
            speakers: chosen.length > 0 ? new Set(chosen.map(speaker => speaker.key)) : null,
            contextLines: choice.contextLines,
            includeIds: choice.includeIds,
            includeDirections: choice.includeDirections,
            includeBranches: choice.includeBranches,
        }, labels, { title, subtitle });
        if (manuscript.scenes.length === 0) {
            throw new Error(t("manuscript.noLines"));
        }
        const locale = manuscriptLocale(context.services.get<LocalizationService>(Services.Localization).getConfiguration().sourceLocale);
        let targetPath = givenPath;
        if (!targetPath) {
            const baseName = chosen.length === 1 ? `${title} - ${chosen[0].name}` : title;
            const selection = await appPrivilegedFacade.fs.selectSaveFile(exportFileName(baseName, choice.format), [choice.format]);
            if (!selection.success || !selection.data.ok) {
                console.warn("[manuscript] the save dialog failed", selection);
                throw new Error(t("workspace.shell.fileDialogFailed"));
            }
            targetPath = selection.data.data ?? undefined;
        }
        if (!targetPath) {
            return false;
        }
        const strings = { gap: t("manuscript.gap"), pageOf: t("manuscript.pageOf") };
        const response = choice.format === "pdf"
            ? await getInterface().manuscript.printPdf(targetPath, renderManuscriptHtml(manuscript, locale, strings), renderManuscriptFooter(locale, strings))
            : await getInterface().manuscript.writeDocx(targetPath, buildManuscriptDocx(manuscript, locale));
        if (!response.success) {
            console.error("[manuscript] writing the script failed", response);
            throw new Error(t("manuscript.error.writeFailed", { file: basename(targetPath) }));
        }
        context.services.get<UIService>(Services.UI).showNotification(t("manuscript.exported", { path: targetPath }), "success");
        return true;
    }, [context, labelsFor, t, tn]);

    const runExport = useCallback(async (choice: ManuscriptExportChoice) => {
        const request = exportRequest;
        if (!request) {
            return;
        }
        setBusy(true);
        try {
            if (await writeExport(request, choice)) {
                setExportRequest(null);
            }
        } catch (error) {
            report(error);
        } finally {
            setBusy(false);
        }
    }, [exportRequest, report, writeExport]);

    const exportTo = useCallback(async (storyId: StoryId, choice: ManuscriptExportChoice, targetPath: string) => {
        if (!context) {
            return;
        }
        try {
            const document = await context.services.get<StoryService>(Services.Story).loadStory(storyId);
            await writeExport({ storyId, document, initialSceneIds: null }, choice, targetPath);
        } catch (error) {
            report(error);
        }
    }, [context, report, writeExport]);

    const speakersFor = useCallback((sceneIds: StorySceneId[]) => {
        if (!exportRequest) {
            return [];
        }
        const labels = labelsFor(exportRequest.document);
        return labels ? listManuscriptSpeakers(exportRequest.document, sceneIds, labels.speaker, labels.unnamedSpeaker) : [];
    }, [exportRequest, labelsFor]);

    const panelState = context?.services.get<PanelStateService>(Services.PanelState) ?? null;
    // Read again whenever a decision was written: the store is on disk, not in state.
    const memory = useMemo(
        () => (importRequest ? getStoryPasteMemory(panelState) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [importRequest, panelState, memoryRevision],
    );

    return {
        beginImport: storyId => void beginImport(storyId),
        importPath,
        exportTo,
        beginExport: target => void beginExport(target),
        dialogs: (
            <>
                {importRequest && memory ? (
                    <ManuscriptImportModal
                        key={importRequest.fileName}
                        request={importRequest}
                        characters={context?.services.get<CharacterService>(Services.Character).listCharacter() ?? []}
                        memory={memory}
                        busy={busy}
                        onSaveSeparator={(name, choice) => {
                            saveStoryPasteSeparator(panelState, name, choice);
                            setMemoryRevision(revision => revision + 1);
                        }}
                        onForgetSeparator={name => {
                            forgetStoryPasteSeparator(panelState, name);
                            setMemoryRevision(revision => revision + 1);
                        }}
                        onCancel={() => setImportRequest(null)}
                        onConfirm={(source, plan, authored) => void confirmImport(source, plan, authored)}
                    />
                ) : null}
                {exportRequest ? (
                    <ManuscriptExportModal
                        scenes={listSceneIdsInDocumentOrder(exportRequest.document).map(id => ({ id, name: exportRequest.document.scenes[id]?.name ?? "" }))}
                        initialSceneIds={exportRequest.initialSceneIds}
                        speakersFor={speakersFor}
                        busy={busy}
                        onClose={() => setExportRequest(null)}
                        onExport={choice => void runExport(choice)}
                    />
                ) : null}
            </>
        ),
    };
}
