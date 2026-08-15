import { useCallback, useState, type ReactNode } from "react";
import { listSceneIdsInDocumentOrder, type StoryDocument, type StoryId, type StoryScene, type StorySceneId } from "@shared/types/story";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { useTranslation } from "@/lib/i18n";
import {
    printNarralangScene,
    printNarralangStory,
    type NarralangLookups,
    type NarralangSceneResult,
} from "@/lib/story/narralang/narralangPrinter";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { Services } from "@/lib/workspace/services/services";
import { characterRowLookup, projectVariableNameLookup } from "../scene-editor/storySceneBlockUtils";
import { useWorkspace } from "../../../context";
import { NarralangExportReportModal } from "./NarralangExportReportModal";
import { narralangAppearanceNames, narralangFileName, narralangIssueRows, type NarralangIssueRow } from "./narralangIo";

/** What an export was asked to write: one scene, or the whole story when `sceneId` is null. */
export type NarralangExportTarget = {
    storyId: StoryId;
    sceneId: StorySceneId | null;
};

export type NarralangExport = {
    /** Opens the save dialog straight away - a NarraLang file has no options to ask about. */
    beginExport: (target: NarralangExportTarget) => void;
    /** The report dialog. Render once, anywhere in the caller's tree. */
    dialogs: ReactNode;
};

/**
 * The NarraLang export, as one thing a surface can mount.
 *
 * Deliberately the same pipeline as the `.txt` export next door (`useStoryScriptIo`): the same save
 * dialog, the same write, the same success notification, services read at invocation time rather than
 * subscribed to. The two are one feature in two formats, and an author who has used one should find
 * nothing new in the other except what the file looks like.
 *
 * It differs in exactly two places, and both follow from NarraLang being one-way: there is no format
 * question to ask before the save dialog, and there is no import. What it gains instead is the
 * coverage report - the file is always written, and the rows it could not spell are named afterwards.
 */
export function useNarralangExport(): NarralangExport {
    const { context, isInitialized } = useWorkspace();
    const { t } = useTranslation();
    const [report, setReport] = useState<NarralangIssueRow[] | null>(null);
    const [busy, setBusy] = useState(false);

    const ready = context !== null && isInitialized;
    const fail = useCallback((error: unknown) => {
        if (!context) {
            return;
        }
        context.services.get<UIService>(Services.UI).showError(error instanceof Error ? error : String(error));
    }, [context]);

    const runExport = useCallback(async (target: NarralangExportTarget) => {
        if (!context) {
            return;
        }
        setBusy(true);
        try {
            const storyService = context.services.get<StoryService>(Services.Story);
            const characterService = context.services.get<CharacterService>(Services.Character);
            const blueprintService = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const appTagService = context.services.get<AppTagService>(Services.AppTags);
            const document: StoryDocument = await storyService.loadStory(target.storyId);
            const characters = characterService.listCharacter();
            const motions = new Map(storyService.listAnimationAssets().map(entry => [entry.id, entry.name]));
            const appTags = new Map(appTagService.listTags().map(tag => [tag.id, tag.name]));

            const lookups: NarralangLookups = {
                character: characterRowLookup(characters),
                // `assetId → name`, across every asset type: a background row stores an id and reads
                // as one, and an id the printer cannot name is a row it refuses to spell.
                assetName: assetId => {
                    const table = assetsService.getAssets();
                    for (const byId of Object.values(table)) {
                        const asset = (byId as Record<string, { name?: string }> | undefined)?.[assetId];
                        if (asset?.name) {
                            return asset.name;
                        }
                    }
                    return null;
                },
                motionName: animationId => motions.get(animationId) ?? null,
                appearanceName: narralangAppearanceNames(characters),
                // Read at export time rather than held in state: an export is a one-shot command, so
                // the freshest registry is the one on disk when the author asked. Both project scopes,
                // because since the declaration migration the registry is the only place either lives.
                projectVariableName: projectVariableNameLookup([
                    ...blueprintService.listSavedVariables(),
                    ...blueprintService.listPersistentVariables(),
                ]),
                appTagName: appTagId => appTags.get(appTagId) ?? null,
                scenes: document.scenes,
                document,
            };

            const scene: StoryScene | undefined = target.sceneId ? document.scenes[target.sceneId] : undefined;
            if (target.sceneId && !scene) {
                // Deleted between the menu opening and this running. Nothing to write, and inventing
                // an empty file would look like a successful export of a scene that is gone.
                throw new Error(t("story.narralang.sceneMissing"));
            }
            const result: NarralangSceneResult = scene
                ? printNarralangScene(scene, lookups)
                : printNarralangStory(document, lookups);

            const selection = await appPrivilegedFacade.fs.selectSaveFile(
                narralangFileName(scene?.name ?? document.name),
                ["nl"],
            );
            if (!selection.success || !selection.data.ok) {
                throw new Error(selection.success && !selection.data.ok ? selection.data.error.message : "Save dialog failed");
            }
            const targetPath = selection.data.data;
            if (!targetPath) {
                return;
            }
            const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
            const written = await filesystem.write(targetPath, result.text, "utf-8");
            if (!written.ok) {
                throw new Error(written.error.message);
            }
            // The same sentence the `.txt` export ends on: one export, two formats.
            context.services.get<UIService>(Services.UI)
                .showNotification(t("story.script.exported", { path: targetPath }), "success");

            const scenes = scene
                ? [scene]
                : listSceneIdsInDocumentOrder(document).map(sceneId => document.scenes[sceneId]);
            const rows = narralangIssueRows(result.issues, scenes, lookups);
            if (rows.length > 0) {
                setReport(rows);
            }
        } catch (error) {
            fail(error);
        } finally {
            setBusy(false);
        }
    }, [context, fail, t]);

    const beginExport = useCallback((target: NarralangExportTarget) => {
        if (ready && !busy) {
            void runExport(target);
        }
    }, [busy, ready, runExport]);

    return {
        beginExport,
        dialogs: <NarralangExportReportModal rows={report} onClose={() => setReport(null)} />,
    };
}
