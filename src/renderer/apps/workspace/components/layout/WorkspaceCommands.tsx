import { useEffect } from "react";
import { BookPlus, FilePlus, Settings, UserPlus, Waypoints } from "lucide-react";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { createInputDialog } from "@/lib/components/dialogs/InputDialog";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { openDefaultSceneFlowTab } from "../../modules/story-flow/openSceneFlowTab";
import { createStorySceneEditorTab } from "../../modules/story/scene-editor/openStorySceneEditorTab";

const STORY_PANEL_ID = "narraleaf-studio:story";
const CHARACTERS_PANEL_ID = "narraleaf-studio:characters";

/**
 * The workspace commands that exist nowhere else - the ones with no toolbar action, no panel, and
 * no shortcut to be derived from.
 *
 * The palette collects most of its list from the registries ({@link collectPaletteCommands}), which
 * is why it was never *wrong*, only incomplete: a view reached solely by a button or a panel header
 * contributes nothing to any registry and so was unreachable by name. Scene Flow was the clearest
 * case - a first-class editor view with an `openDefaultSceneFlowTab` written for "the rail/palette
 * entry point" and no caller anywhere in the tree.
 *
 * Renders nothing; mounted once by the workspace shell beside {@link EditorCommands}. Registering
 * per-panel instead would tie a command's existence to whether its panel happens to be open, which
 * is exactly the thing a command palette is supposed to fix.
 *
 * **Anything that writes must gate itself on the freeze.** `collectPaletteCommands` drops frozen-out
 * *actions*, but registered commands are exempt by design - the freeze/thaw entries themselves are
 * registered commands and have to survive a freeze. So the guard lives in each `when` below.
 */
export function WorkspaceCommands() {
  const { context } = useWorkspace();

  useEffect(() => {
    if (!context) {
      return;
    }
    const commandService = context.services.get<CommandService>(Services.Command);
    const uiService = context.services.get<UIService>(Services.UI);
    const storyService = context.services.get<StoryService>(Services.Story);
    const characterService = context.services.get<CharacterService>(Services.Character);
    const inputDialog = createInputDialog(uiService);
    const writable = () => getProjectWriteFreeze() === null;

    /** The story a story-scoped command acts on: the project default, else the only one there is. */
    const targetStoryId = (): string | null => {
      const stories = storyService.listStories();
      return storyService.getDefaultStoryId() ?? stories[0]?.id ?? null;
    };

    return commandService.registerMany([
      {
        id: "go:scene-flow",
        // The tab's own name — the palette should call a view what its tab calls it.
        titleKey: "story.flow.tabTitle",
        categoryKey: "workspace.shell.commandPalette.categoryGo",
        // The tab's own glyph too, for the same reason as its name (`openSceneFlowTab`).
        icon: <Waypoints className="w-4 h-4" />,
        when: () => targetStoryId() !== null,
        run: () => openDefaultSceneFlowTab(context)
      },
      {
        id: "story:new-story",
        titleKey: "story.panel.newStory",
        categoryKey: "workspace.shell.commandPalette.categoryStory",
        icon: <BookPlus className="w-4 h-4" />,
        when: writable,
        run: async () => {
          const name = await inputDialog.show({
            title: translate("story.panel.newStory"),
            placeholder: translate("story.panel.newStoryPlaceholder"),
            required: true,
            maxLength: 120
          });
          if (!name) {
            return;
          }
          storyService.createStory(name);
          // The panel is where a new story is named, ordered and opened; reveal it rather
          // than leaving the author with a story they cannot see.
          uiService.getStore().setPanelVisibility(STORY_PANEL_ID, true);
        }
      },
      {
        id: "story:new-scene",
        titleKey: "story.panel.newSceneTitle",
        categoryKey: "workspace.shell.commandPalette.categoryStory",
        icon: <FilePlus className="w-4 h-4" />,
        when: () => writable() && targetStoryId() !== null,
        run: async () => {
          const storyId = targetStoryId();
          if (!storyId) {
            return;
          }
          const name = await inputDialog.show({
            title: translate("story.panel.newSceneTitle"),
            placeholder: translate("story.panel.newScenePlaceholder"),
            required: true,
            maxLength: 120
          });
          if (!name) {
            return;
          }
          const scene = storyService.createScene(storyId, { name });
          // Straight into the scene: a scene created from the palette was asked for by
          // someone already typing, not browsing.
          uiService.editor.open(
            createStorySceneEditorTab({ storyId, sceneId: scene.id }, scene.name)
          );
        }
      },
      {
        id: "characters:new-character",
        titleKey: "characters.panel.newCharacter",
        categoryKey: "workspace.shell.commandPalette.categoryStory",
        icon: <UserPlus className="w-4 h-4" />,
        when: writable,
        run: async () => {
          const name = await inputDialog.show({
            title: translate("characters.panel.newCharacter"),
            placeholder: translate("characters.panel.namePlaceholder"),
            required: true,
            maxLength: 120
          });
          if (!name) {
            return;
          }
          const character = characterService.createCharacter(name);
          uiService.getStore().setPanelVisibility(CHARACTERS_PANEL_ID, true);
          uiService.getStore().setSelection({ type: "character", data: character });
        }
      },
      {
        id: "workspace:open-settings",
        titleKey: "workspace.shell.openSettings",
        categoryKey: "workspace.shell.commandPalette.categoryPreferences",
        icon: <Settings className="w-4 h-4" />,
        run: async () => {
          await getInterface().app.launchSettings({});
        }
      }
    ]);
  }, [context]);

  return null;
}
