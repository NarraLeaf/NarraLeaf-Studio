import type { EditorTabDefinition } from "../../registry/types";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchIndexModel";
import { parseBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { Service } from "@/lib/workspace/services/Service";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import type { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import { buildUIComponentEditorSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { localizationKeyUnitId } from "@shared/types/localization";
import { findDeclarationBlock } from "@shared/types/story";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { nextStoryRevealToken } from "../story/scene-editor/storySceneEditorTabId";
import { createBlueprintEntryEditorTab, showBlueprintEntryEditorTab } from "../blueprint-lite/openBlueprintEditorTab";
import { blueprintJumpOpenTarget } from "./blueprintJumpTarget";
import { openAssetPreviewTabsInEditor } from "../assets/dnd/openDraggedAssetsInEditor";
import { requestAssetReveal, requestAssetSetReveal } from "../assets/assetSetReveal";
import { createComponentEditorTab, createSurfaceEditorTab } from "../ui-editor/UISurfacesPanel";
import { openSceneFlowTab } from "../story-flow/openSceneFlowTab";
import { createCharacterEditorTab } from "../characters/state/useCharacterFocus";
import { STORY_VARIABLES_PANEL_ID, storyVariableReveal } from "../story-variables/storyVariablesPanelId";
import { createLocalizationEditorTab } from "../localization/openLocalizationEditorTab";
import { nextTableRevealToken } from "../localization/localizationEditorTabId";
import { createVoiceEditorTab } from "../voice/openVoiceEditorTab";
import { createStoryMotionEditorTab } from "../story-motion/StoryMotionEditorTab";
import { openProjectPanel } from "../project";
import { STORY_PANEL_ID, storyPanelReveal } from "../story/panel/storyPanelReveal";

export interface SearchJumpDeps {
    openEditorTab: (tab: EditorTabDefinition<any>) => void;
    setPanelVisibility: (panelId: string, visible: boolean) => void;
    /** Needed by every target that has to look something up first; the story ones work without it. */
    context?: WorkspaceContext | null;
}

const LOCALIZATION_PANEL_ID = "narraleaf-studio:localization";
const ASSETS_PANEL_ID = "narraleaf-studio:assets";

/**
 * Select a widget in the interface editor of `surfaceId` (a page's id, or a component editor's).
 *
 * Done before the editor tab opens, so the tab finds its own selection waiting rather than claiming
 * the page for itself; the migration notice's Locate buttons open a widget the same way. A widget
 * that has gone since the index was built is simply not found by the editor, which still opens.
 */
function selectUIElement(context: WorkspaceContext, surfaceId: string, elementId: string): void {
    try {
        context.services.get<UIEditorStateService>(Services.UIEditorState).setUIElementSelection({
            editor: "ui",
            surfaceId,
            elementIds: [elementId],
            primaryId: elementId,
        });
    } catch {
        // Opening the page is still worth doing without the selection.
    }
}

/** A service, or null when the workspace has none of that kind (a test, a window that never loaded it). */
function optionalService<T extends Service>(context: WorkspaceContext, id: Services): T | null {
    try {
        return context.services.get<T>(id);
    } catch {
        return null;
    }
}

/**
 * The name a language's tab is titled with - the one the author declared - or null for a language
 * the project does not have.
 */
function translationLocaleName(localization: LocalizationService, locale: string): string | null {
    const entry = localization.getConfiguration().locales.find(candidate => candidate.code === locale);
    return entry ? entry.displayName || entry.code : null;
}

/**
 * Whether a project-level variable still exists: a registry entry, or - in a project whose story rows
 * were never moved into the registry - a `/save` or `/global` row of a story that is open. Those are
 * listed by the variables panel too, while their story is the focused one.
 */
function projectVariableExists(context: WorkspaceContext, variableId: string): boolean {
    const registry = optionalService<VariableRegistryService>(context, Services.VariableRegistry);
    if (registry?.getEntry(variableId)) {
        return true;
    }
    const stories = optionalService<StoryService>(context, Services.Story);
    for (const entry of stories?.listStories() ?? []) {
        try {
            if (findDeclarationBlock(stories!.getStoryDocument(entry.id), variableId)) {
                return true;
            }
        } catch {
            // Not loaded, so not the story the panel is showing.
        }
    }
    return false;
}

/**
 * Navigate to a search hit. Shared by the search panel, the command palette's search mode, the
 * project check report and every "used by" list.
 *
 * Every target rides an existing navigation affordance: story hits reuse the scene editor's
 * `activeBlockId` deep link (re-opening an existing tab replaces its payload, so the deep link
 * fires on already-open tabs too), blueprint hits reuse the entry tab's focus fields, the two tables
 * take the row in their payload the same way, and the side panels are asked for their row through a
 * reveal request.
 *
 * Returns false when the target cannot be resolved - the thing it names is gone, or there is no
 * workspace to look it up in - and has then done nothing, so the caller can say so.
 */
export function jumpToSearchTarget(target: SearchJumpTarget, deps: SearchJumpDeps): boolean {
    switch (target.kind) {
        case "storyBlock":
            // Tokened so that jumping to a hit, reading around it, and jumping back to the same hit
            // is two navigations rather than one. See `nextStoryRevealToken`.
            deps.openEditorTab(
                createStorySceneEditorTab(
                    {
                        storyId: target.storyId,
                        sceneId: target.sceneId,
                        activeBlockId: target.blockId,
                        revealToken: nextStoryRevealToken(),
                    },
                    target.sceneName || target.storyName,
                ),
            );
            return true;
        case "storyScene":
            deps.openEditorTab(
                createStorySceneEditorTab(
                    { storyId: target.storyId, sceneId: target.sceneId },
                    target.sceneName || target.storyName,
                ),
            );
            return true;
        case "storyFlow": {
            // A story has no single editor; its flow map is the view OF a story rather than of one
            // of its scenes, which is what makes it the right landing place for the story's name.
            if (!deps.context) {
                return false;
            }
            openSceneFlowTab(deps.context, target.storyId, target.storyName);
            return true;
        }
        case "storyEntry": {
            // The story's own row in the list - where it is renamed or deleted, and the only way into
            // a story whose document cannot be opened, which is the finding this exists for.
            const context = deps.context;
            const stories = context ? optionalService<StoryService>(context, Services.Story) : null;
            if (!stories || !stories.listStories().some(entry => entry.id === target.storyId)) {
                return false;
            }
            deps.setPanelVisibility(STORY_PANEL_ID, true);
            storyPanelReveal.request({ storyId: target.storyId });
            return true;
        }
        case "character": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            const character = context.services
                .get<CharacterService>(Services.Character)
                .getCharacter(target.characterId);
            if (!character) {
                return false;
            }
            // The character's own editor, which is what "open a character" means everywhere else in
            // the workspace — the cast list has opened one since it gained a tab, and a search hit
            // that instead revealed the panel and selected a row was the odd one out. The selection
            // still follows so the inspector rail shows who was opened.
            deps.openEditorTab(createCharacterEditorTab(character));
            context.services.get<UIService>(Services.UI).getStore().setSelection({ type: "character", data: character });
            return true;
        }
        case "uiSurface": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            const surface = context.services
                .get<UIDocumentService>(Services.UIDocument)
                .getDocument()
                .surfaces.find(candidate => candidate.id === target.surfaceId);
            if (!surface) {
                return false;
            }
            if (target.elementId) {
                selectUIElement(context, surface.id, target.elementId);
            }
            deps.openEditorTab(createSurfaceEditorTab(surface));
            return true;
        }
        case "uiComponent": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            const component = context.services
                .get<UIDocumentService>(Services.UIDocument)
                .getComponent(target.componentId);
            if (!component) {
                return false;
            }
            if (target.elementId) {
                selectUIElement(context, buildUIComponentEditorSurfaceId(component.id), target.elementId);
            }
            deps.openEditorTab(createComponentEditorTab(component));
            return true;
        }
        case "blueprint": {
            const owner = parseBlueprintOwnerKey(target.ownerKey);
            if (!owner) {
                return false;
            }
            // Keyed and named as every other way into the blueprint does it, so a hit lands on the
            // tab that is already open, under the name it already has, or on the window the editor
            // was moved out to. See `blueprintJumpOpenTarget`.
            showBlueprintEntryEditorTab(
                createBlueprintEntryEditorTab(blueprintJumpOpenTarget(target, owner, deps.context)),
                deps.openEditorTab,
            );
            return true;
        }
        case "localizationKey": {
            const context = deps.context;
            const localization = context ? optionalService<LocalizationService>(context, Services.Localization) : null;
            if (!localization) {
                return false;
            }
            // Gone from the registry: nothing to land on. Not known yet (the keys are read lazily)
            // is not the same answer, and the table finds the row itself once they are.
            const keys = localization.getKeysIfLoaded();
            if (keys && !keys.keys[target.keyName]) {
                return false;
            }
            // A named string's words are edited in the interface source of a translation table, and
            // every table shows the same source words; the first language's is the one opened.
            const config = localization.getConfiguration();
            const locale = config.locales.find(entry => entry.code !== config.sourceLocale);
            if (!locale) {
                // No language to translate into, so no table: the Localization panel is where one is
                // added, and it is the nearest thing to the key there is.
                deps.setPanelVisibility(LOCALIZATION_PANEL_ID, true);
                return true;
            }
            deps.openEditorTab(createLocalizationEditorTab(locale.code, locale.displayName || locale.code, {
                unitId: localizationKeyUnitId(target.keyName),
                token: nextTableRevealToken(),
            }));
            return true;
        }
        case "translation": {
            const context = deps.context;
            const localization = context ? optionalService<LocalizationService>(context, Services.Localization) : null;
            const name = localization ? translationLocaleName(localization, target.locale) : null;
            if (name === null) {
                return false;
            }
            deps.openEditorTab(createLocalizationEditorTab(
                target.locale,
                name,
                target.unitId
                    ? {
                        unitId: target.unitId,
                        ...(target.storyId ? { storyId: target.storyId } : {}),
                        token: nextTableRevealToken(),
                    }
                    : undefined,
            ));
            return true;
        }
        case "voiceLine": {
            const context = deps.context;
            const voice = context ? optionalService<VoiceService>(context, Services.Voice) : null;
            const entry = voice?.getConfiguration().voicedLocales.find(candidate => candidate.code === target.locale);
            if (!entry) {
                return false;
            }
            deps.openEditorTab(createVoiceEditorTab(
                target.locale,
                entry.displayName || entry.code,
                target.unitId
                    ? {
                        unitId: target.unitId,
                        ...(target.storyId ? { storyId: target.storyId } : {}),
                        token: nextTableRevealToken(),
                    }
                    : undefined,
            ));
            return true;
        }
        case "storyVariable": {
            // A saved or persistent variable is declared in the variables panel rather than by any
            // row, so its row in that panel is its address.
            const context = deps.context;
            if (!context || !projectVariableExists(context, target.variableId)) {
                return false;
            }
            deps.setPanelVisibility(STORY_VARIABLES_PANEL_ID, true);
            storyVariableReveal.request({ scope: target.scope, variableId: target.variableId });
            return true;
        }
        case "storyMotion": {
            const context = deps.context;
            const stories = context ? optionalService<StoryService>(context, Services.Story) : null;
            let known = false;
            try {
                known = Boolean(stories?.listAnimationAssets().some(entry => entry.id === target.animationId));
            } catch {
                // The motion index has not been read: nothing to say the motion exists.
            }
            if (!known) {
                return false;
            }
            deps.openEditorTab(createStoryMotionEditorTab({ animationId: target.animationId }));
            return true;
        }
        case "projectPage": {
            if (!deps.context) {
                return false;
            }
            openProjectPanel(deps.context, { section: target.page, ...(target.part ? { part: target.part } : {}) });
            return true;
        }
        case "assetSet": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            // A set has no preview editor - it is a row in the assets panel with an inspector, so
            // this is the `asset` case's second arm and nothing more. Resolved live for the same
            // reason that one is: the declaration may be gone, and a jump that reveals the panel
            // with nothing selected is worse than one that declines.
            const set = context.services.get<AssetSetService>(Services.AssetSets).getSet(target.assetSetId);
            if (!set) {
                return false;
            }
            deps.setPanelVisibility(ASSETS_PANEL_ID, true);
            context.services.get<UIService>(Services.UI).getStore().setSelection({ type: "assetSet", data: set });
            // Selecting it fills the inspector; this puts the ROW on screen. They are different
            // questions - a set can be several folders down from anything the panel is currently
            // drawing, and an inspector for a row nobody can see reads as a jump that half worked.
            requestAssetSetReveal(ASSETS_PANEL_ID, target.assetSetId);
            return true;
        }
        case "asset": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            // Resolve the live asset - the index only carries ids, and the asset may be gone.
            const assetsMap = context.services.get<AssetsService>(Services.Assets).getAssets();
            const asset = Object.values(assetsMap)
                .flatMap(byId => Object.values(byId) as Asset[])
                .find(candidate => candidate.id === target.assetId);
            if (!asset) {
                return false;
            }
            if (asset.type === AssetType.Image || asset.type === AssetType.Audio) {
                openAssetPreviewTabsInEditor(context, [asset], { preview: true });
                return true;
            }
            // Its row in the library, selected and brought on screen - the folders it is filed in
            // opened, the search that hid it cleared. The selection alone filled the inspector for a
            // row the panel was not drawing, which read as a jump that half worked.
            deps.setPanelVisibility(ASSETS_PANEL_ID, true);
            context.services.get<UIService>(Services.UI).getStore().setSelection({ type: "asset", data: asset });
            requestAssetReveal(ASSETS_PANEL_ID, asset.id);
            return true;
        }
    }
}
