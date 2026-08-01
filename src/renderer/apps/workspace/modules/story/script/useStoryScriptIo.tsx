import { useCallback, useState, type ReactNode } from "react";
import { listSceneIdsInDocumentOrder, type StoryDocument, type StoryId, type StorySceneId } from "@shared/types/story";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { useTranslation } from "@/lib/i18n";
import { exportStoryScript, parseStoryScript, planStoryScriptImport } from "@/lib/story/script/storyScriptCodec";
import type { StoryScriptExportMode, StoryScriptImportPlan } from "@/lib/story/script/storyScriptTypes";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Services } from "@/lib/workspace/services/services";
import type { TranslationKey } from "@shared/i18n";
import { useWorkspace } from "../../../context";
import {
    hasStorySceneUndoRecorder,
    recordStorySceneUndoCheckpoints,
} from "../scene-editor/storySceneUndoBridge";
import { StoryScriptExportModal } from "./StoryScriptExportModal";
import { StoryScriptImportModal } from "./StoryScriptImportModal";
import {
    applicableScenePlans,
    createStoryScriptLabeller,
    createStoryScriptSpeakerLabeller,
    createStoryScriptSpeakerResolver,
    storyScriptFileName,
} from "./storyScriptIo";

/** What an export was asked to write: one scene, or the whole story when `sceneIds` is null. */
export type StoryScriptExportTarget = {
    storyId: StoryId;
    sceneIds: StorySceneId[] | null;
};

type ImportRequest = {
    storyId: StoryId;
    plan: StoryScriptImportPlan;
};

export type StoryScriptIo = {
    /** Opens the mode chooser; the save dialog follows once the author has answered it. */
    beginExport: (target: StoryScriptExportTarget) => void;
    /** Opens the file picker, then the confirm dialog. Nothing is written until it is confirmed. */
    beginImport: (storyId: StoryId) => void;
    /** Both dialogs. Render once, anywhere in the caller's tree. */
    dialogs: ReactNode;
};

/**
 * The Story Script export/import flows, as one thing a surface can mount.
 *
 * Every entry point (the story panel's two menus, the palette) drives the same two dialogs, so they
 * live with the flow rather than with any one caller. Services are read at invocation time rather
 * than memoized: an export is a keystroke-rare one-shot, and holding subscriptions to the character,
 * asset and motion tables for the sake of a callback that runs once would be pure overhead.
 */
export function useStoryScriptIo(): StoryScriptIo {
    const { context, isInitialized } = useWorkspace();
    const { t, tn } = useTranslation();
    const [exportTarget, setExportTarget] = useState<StoryScriptExportTarget | null>(null);
    const [importRequest, setImportRequest] = useState<ImportRequest | null>(null);
    const [busy, setBusy] = useState(false);

    const ready = context !== null && isInitialized;
    const report = useCallback((error: unknown) => {
        if (!context) {
            return;
        }
        context.services.get<UIService>(Services.UI).showError(error instanceof Error ? error : String(error));
    }, [context]);

    /** `assetId → name`, across every asset type: a background row stores an id and reads as one. */
    const resolveAssetName = useCallback((assetId: string): string | null => {
        const table = context?.services.get<AssetsService>(Services.Assets).getAssets();
        if (!table) {
            return null;
        }
        for (const byId of Object.values(table)) {
            const asset = (byId as Record<string, { name?: string }> | undefined)?.[assetId];
            if (asset?.name) {
                return asset.name;
            }
        }
        return null;
    }, [context]);

    const runExport = useCallback(async (mode: StoryScriptExportMode) => {
        if (!context || !exportTarget) {
            return;
        }
        setBusy(true);
        try {
            const storyService = context.services.get<StoryService>(Services.Story);
            const characterService = context.services.get<CharacterService>(Services.Character);
            const document: StoryDocument = await storyService.loadStory(exportTarget.storyId);
            const sceneIds = exportTarget.sceneIds ?? listSceneIdsInDocumentOrder(document);
            const characters = characterService.listCharacter();
            const motions = new Map(storyService.listAnimationAssets().map(entry => [entry.id, entry.name]));

            const text = exportStoryScript(document, sceneIds, {
                mode,
                label: createStoryScriptLabeller(
                    document,
                    characters,
                    resolveAssetName,
                    animationId => motions.get(animationId) ?? null,
                ),
                speaker: createStoryScriptSpeakerLabeller(characters),
            });

            const only = sceneIds.length === 1 ? document.scenes[sceneIds[0]] : undefined;
            const selection = await appPrivilegedFacade.fs.selectSaveFile(
                storyScriptFileName(only?.name ?? document.name),
                ["txt"],
            );
            if (!selection.success || !selection.data.ok) {
                throw new Error(selection.success && !selection.data.ok ? selection.data.error.message : "Save dialog failed");
            }
            const targetPath = selection.data.data;
            if (!targetPath) {
                // Cancelling the save dialog cancels the export; leaving the mode chooser up would
                // read as a dialog that refused to close.
                setExportTarget(null);
                return;
            }
            const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
            const written = await filesystem.write(targetPath, text, "utf-8");
            if (!written.ok) {
                throw new Error(written.error.message);
            }
            context.services.get<UIService>(Services.UI)
                .showNotification(t("story.script.exported", { path: targetPath }), "success");
            setExportTarget(null);
        } catch (error) {
            report(error);
        } finally {
            setBusy(false);
        }
    }, [context, exportTarget, report, resolveAssetName, t]);

    const beginImport = useCallback(async (storyId: StoryId) => {
        if (!context) {
            return;
        }
        try {
            const selection = await appPrivilegedFacade.fs.selectFile(["txt"], false);
            if (!selection.success || !selection.data.ok || selection.data.data.length === 0) {
                return;
            }
            const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
            const content = await filesystem.read(selection.data.data[0], "utf-8");
            if (!content.ok) {
                throw new Error(content.error.message);
            }
            const parsed = parseStoryScript(content.data);
            if (!parsed.ok) {
                // The codec's `message` is developer-facing English; the author gets the code's own
                // sentence, which is the only one of the two that says what to do about it.
                throw new Error(t(`story.script.parseError.${parsed.error.code}` as TranslationKey));
            }
            const storyService = context.services.get<StoryService>(Services.Story);
            const characterService = context.services.get<CharacterService>(Services.Character);
            const uuidService = context.services.get<UuidService>(Services.Uuid);
            const plan = planStoryScriptImport({
                script: parsed.script,
                live: await storyService.loadStory(storyId),
                // UUID v4, from the same mint every other story id comes out of: `assertValidStoryEntityId`
                // rejects anything else, and it would not say so until the document was next loaded.
                generateId: () => uuidService.generate(),
                resolveSpeaker: createStoryScriptSpeakerResolver(characterService.listCharacter()),
            });
            setImportRequest({ storyId, plan });
        } catch (error) {
            report(error);
        }
    }, [context, report, t]);

    const runImport = useCallback(() => {
        if (!context || !importRequest) {
            return;
        }
        setBusy(true);
        try {
            const storyService = context.services.get<StoryService>(Services.Story);
            const scenes = applicableScenePlans(importRequest.plan);
            // The checkpoint has to precede the first write, and cover the whole batch: an import that
            // rewrote three scenes and then asked for undo would find the first two already replaced.
            recordStorySceneUndoCheckpoints(importRequest.storyId, scenes.map(scene => scene.sceneId));
            for (const scene of scenes) {
                storyService.replaceScene(importRequest.storyId, scene.sceneId, scene.scene);
            }
            context.services.get<UIService>(Services.UI)
                .showNotification(tn("story.script.imported", scenes.length), "success");
            setImportRequest(null);
        } catch (error) {
            report(error);
        } finally {
            setBusy(false);
        }
    }, [context, importRequest, report, tn]);

    const undoable = importRequest !== null
        && applicableScenePlans(importRequest.plan)
            .every(scene => hasStorySceneUndoRecorder(importRequest.storyId, scene.sceneId));

    const beginExport = useCallback((target: StoryScriptExportTarget) => {
        if (ready) {
            setExportTarget(target);
        }
    }, [ready]);

    const requestImport = useCallback((storyId: StoryId) => {
        if (ready) {
            void beginImport(storyId);
        }
    }, [beginImport, ready]);

    return {
        beginExport,
        beginImport: requestImport,
        dialogs: (
            <>
                <StoryScriptExportModal
                    open={exportTarget !== null}
                    busy={busy}
                    onClose={() => setExportTarget(null)}
                    onExport={mode => void runExport(mode)}
                />
                <StoryScriptImportModal
                    plan={importRequest?.plan ?? null}
                    busy={busy}
                    undoable={undoable}
                    onClose={() => setImportRequest(null)}
                    onImport={runImport}
                />
            </>
        ),
    };
}
