/**
 * Every workspace-side agent tool, by name: the table `AgentBridgeService` dispatches through.
 *
 * One entry per row of `@shared/agent/tools` whose `side` is `workspace`, and nothing else - the
 * coverage test holds both directions, so a tool cannot be advertised and missing here, or handled
 * here and invisible to clients.
 *
 * The `.story`, `.ui` and `.bp` text-format tools run the offline command lines' bodies from the
 * agent core (`@/lib/agent-core`) over the live documents, and write through the same services the
 * editors commit through.
 *
 * Comments in English per project convention.
 */

import { AGENT_INTERNAL_TOOL_BUILD, AGENT_INTERNAL_TOOL_TEST } from "@shared/agent/protocol";
import type { AgentToolHandler } from "./agentCall";
import { projectInfo, projectSettingsSet } from "./tools/projectTools";
import { assetDelete, assetsImport, assetsList, assetsPlaceholder } from "./tools/assetTools";
import { audioTracksList, characterDelete, characterUpsert, charactersList, variableDelete, variableUpsert, variablesList } from "./tools/castTools";
import { characterLayeredSet, characterLayersImport, characterPreview } from "./tools/layeredTools";
import { sceneCreate, sceneDelete, sceneRename, sceneSetEntry, storyList, storyRename } from "./tools/storyTools";
import { storyApply, storyCommand, storyCommands, storyShow, storyTargets } from "./tools/storyTextTools";
import { brandGet, brandSet, uiPatch, uiScreenshot, uiSelection, uiTemplateApply, uiTemplates } from "./tools/uiTools";
import { uiApply, uiShow, uiSurfaces, uiUsage, uiWidget, uiWidgets } from "./tools/uiTextTools";
import { blueprintApply, blueprintList, blueprintNode, blueprintNodes, blueprintShow } from "./tools/blueprintTools";
import { localizationList, localizationSet, localizationStatus } from "./tools/localizationTools";
import { voiceAutoLink, voiceLink, voiceList, voiceSettingsSet, voiceStatus } from "./tools/voiceTools";
import {
    consoleRead,
    internalBuild,
    internalTest,
    lint,
    playtestAdvance,
    playtestScreenshot,
    playtestStart,
    playtestStop,
} from "./tools/verifyTools";

export function createAgentToolHandlers(): Record<string, AgentToolHandler> {
    const handlers: Record<string, AgentToolHandler> = {
        project_info: projectInfo,
        project_settings_set: projectSettingsSet,
        assets_list: assetsList,
        assets_import: assetsImport,
        assets_placeholder: assetsPlaceholder,
        asset_delete: assetDelete,
        characters_list: charactersList,
        character_upsert: characterUpsert,
        character_delete: characterDelete,
        character_layered_set: characterLayeredSet,
        character_layers_import: characterLayersImport,
        character_preview: characterPreview,
        variables_list: variablesList,
        variable_upsert: variableUpsert,
        variable_delete: variableDelete,
        audio_tracks_list: audioTracksList,
        story_commands: storyCommands,
        story_command: storyCommand,
        story_targets: storyTargets,
        story_list: storyList,
        story_rename: storyRename,
        story_show: storyShow,
        story_apply: storyApply,
        scene_create: sceneCreate,
        scene_rename: sceneRename,
        scene_set_entry: sceneSetEntry,
        scene_delete: sceneDelete,
        ui_widgets: uiWidgets,
        ui_widget: uiWidget,
        ui_usage: uiUsage,
        ui_surfaces: uiSurfaces,
        ui_show: uiShow,
        ui_selection: uiSelection,
        ui_apply: uiApply,
        ui_patch: uiPatch,
        ui_screenshot: uiScreenshot,
        ui_templates: uiTemplates,
        ui_template_apply: uiTemplateApply,
        brand_get: brandGet,
        brand_set: brandSet,
        blueprint_nodes: blueprintNodes,
        blueprint_node: blueprintNode,
        blueprint_list: blueprintList,
        blueprint_show: blueprintShow,
        blueprint_apply: blueprintApply,
        localization_status: localizationStatus,
        localization_list: localizationList,
        localization_set: localizationSet,
        voice_status: voiceStatus,
        voice_list: voiceList,
        voice_link: voiceLink,
        voice_auto_link: voiceAutoLink,
        voice_settings_set: voiceSettingsSet,
        lint,
        console_read: consoleRead,
        playtest_start: playtestStart,
        playtest_advance: playtestAdvance,
        playtest_screenshot: playtestScreenshot,
        playtest_stop: playtestStop,
    };
    return handlers;
}

/**
 * Main's own calls into a workspace that has the project open. Not tools an agent can name; `write`
 * is how the bridge gates them, the same way it gates a tool.
 */
export function createAgentInternalHandlers(): Record<string, { handler: AgentToolHandler; write: boolean }> {
    return {
        [AGENT_INTERNAL_TOOL_TEST]: { handler: internalTest, write: false },
        [AGENT_INTERNAL_TOOL_BUILD]: { handler: internalBuild, write: true },
    };
}
