/**
 * `project_info` and `project_settings_set`.
 *
 * Settings are written through `ProjectService`, which owns the `.nlproj` - never by writing the file
 * behind its back, which would leave the open workspace holding the old values and saving them over
 * the new ones on its next write.
 *
 * Comments in English per project convention.
 */

import { resolveEntrySurface } from "@shared/types/ui-editor/entrySurface";
import { Services } from "../../services";
import type { ProjectService } from "../../core/ProjectService";
import type { UIDocumentService } from "../../ui-editor/UIDocumentService";
import type { LocalizationService } from "../../localization/LocalizationService";
import type { CharacterService } from "../../core/CharacterService";
import type { VariableRegistryService } from "../../variables/VariableRegistryService";
import { answerJson, readOptionalInteger, readOptionalString, refuse, type AgentToolHandler } from "../agentCall";
import { AGENT_ASSET_TYPES, assetsService, storyService } from "../agentLookups";

const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };

export const projectInfo: AgentToolHandler = async (_args, { ctx }) => {
    const project = ctx.services.get<ProjectService>(Services.Project);
    const config = project.getProjectConfig();
    const uidoc = ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument();
    const localization = ctx.services.get<LocalizationService>(Services.Localization).getConfiguration();
    const story = storyService(ctx);

    const stories = [];
    let sceneCount = 0;
    for (const entry of story.listStories()) {
        const document = await story.loadStory(entry.id).catch(() => null);
        const scenes = document ? Object.keys(document.scenes).length : 0;
        sceneCount += scenes;
        stories.push({
            id: entry.id,
            name: entry.name,
            scenes,
            entryScene: document?.entrySceneId ? document.scenes[document.entrySceneId]?.name ?? null : null,
        });
    }

    const assetMap = assetsService(ctx).getAssets();
    const assets: Record<string, number> = {};
    for (const type of AGENT_ASSET_TYPES) {
        const count = Object.keys(assetMap[type] ?? {}).length;
        if (count > 0) {
            assets[type] = count;
        }
    }
    const entrySurface = resolveEntrySurface(uidoc);

    return answerJson({
        name: config.name,
        projectPath: ctx.project.getConfig().projectPath,
        resolution: config.metadata?.resolution ?? DEFAULT_RESOLUTION,
        sourceLanguage: localization.sourceLocale || null,
        languages: localization.locales.map(locale => locale.code),
        entryPage: entrySurface ? { id: entrySurface.id, name: entrySurface.name } : null,
        defaultStory: story.getDefaultStoryId() ?? null,
        stories,
        counts: {
            stories: stories.length,
            scenes: sceneCount,
            pages: uidoc.surfaces.filter(surface => surface.kind === "appSurface").length,
            gameUis: uidoc.surfaces.filter(surface => surface.kind === "stageSurface").length,
            components: (uidoc.components ?? []).length,
            assets,
            characters: ctx.services.get<CharacterService>(Services.Character).listCharacter().length,
            variables: ctx.services.get<VariableRegistryService>(Services.VariableRegistry).listEntries().length,
        },
    });
};

export const projectSettingsSet: AgentToolHandler = async (args, { ctx, log }) => {
    const name = readOptionalString(args, "name");
    const width = readOptionalInteger(args, "width", { min: 16, max: 16384 });
    const height = readOptionalInteger(args, "height", { min: 16, max: 16384 });
    if (name === undefined && width === undefined && height === undefined) {
        throw refuse("invalid_args", "Give at least one of `name`, `width`, `height`.");
    }
    const project = ctx.services.get<ProjectService>(Services.Project);
    const changed: string[] = [];
    if (name !== undefined && name !== project.getProjectConfig().name) {
        await project.updateProjectName(name);
        changed.push("name");
    }
    if (width !== undefined || height !== undefined) {
        const current = project.getProjectConfig().metadata?.resolution ?? DEFAULT_RESOLUTION;
        const next = { width: width ?? current.width, height: height ?? current.height };
        if (next.width !== current.width || next.height !== current.height) {
            await project.updateProjectMetadata({ resolution: next });
            changed.push("resolution");
            log("info", `resolution ${current.width}x${current.height} -> ${next.width}x${next.height}`);
        }
    }
    const config = project.getProjectConfig();
    return answerJson(
        { changed, name: config.name, resolution: config.metadata?.resolution ?? DEFAULT_RESOLUTION },
        changed.length === 0 ? "Nothing changed: the project already had these settings." : `Changed ${changed.join(" and ")}.`
            + (changed.includes("resolution") ? " Existing pages keep their design size; resize them with ui_patch if they should follow." : ""),
    );
};
