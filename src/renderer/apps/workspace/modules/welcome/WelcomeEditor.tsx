import { useCallback, useMemo } from "react";
import { CircleQuestionMark, FolderOpen, SquarePlus, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { createInputDialog } from "@/lib/components/dialogs";
import { cn } from "@/lib/utils/cn";
import { helpSectionKey, helpTitleKey, type HelpTopicId } from "@/lib/help";
import { isMacPlatform } from "@/lib/app/platform";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { openHelpTab } from "../help/openHelpTab";
import { useWorkspace } from "../../context";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { EditorComponentProps } from "../types";

const ASSETS_PANEL_ID = "narraleaf-studio:assets";
const STORY_PANEL_ID = "narraleaf-studio:story";

/**
 * The four topics a first-time author needs, in the order they need them. Links, not summaries: the
 * page used to restate all four as prose steps, which is the same words in a place they cannot be
 * updated from (docs/help-system.md §1).
 */
const FIRST_TOPICS: readonly HelpTopicId[] = [
  "workspaceLayout",
  "storyScene",
  "assets",
  "runModes"
];

/**
 * Welcome editor: the two things a new project needs doing, and the way into the documentation.
 *
 * A greeting, then the work. Deliberately quiet below that: it once carried a 4xl title, a sparkle
 * and a numbered guide, which is a lot of surface for a tab whose job is to be left within a minute.
 */
export function WelcomeEditor({ tabId, payload }: EditorComponentProps) {
  const { t } = useTranslation();
  const { context } = useWorkspace();
  // Only the first card writes anything. The other two reveal a panel and open a tab, and both are
  // exactly what a frozen workspace is for.
  const freeze = useFreezeGuard();

  const uiService = useMemo(() => context?.services.get<UIService>(Services.UI) ?? null, [context]);
  const storyService = useMemo(
    () => context?.services.get<StoryService>(Services.Story) ?? null,
    [context]
  );
  const inputDialog = useMemo(() => (uiService ? createInputDialog(uiService) : null), [uiService]);

  /**
   * Create a scene in the default story and open it. A brand-new project may not have a story
   * yet - there is nothing to hang a scene off in that case, so fall back to revealing the Story
   * panel, which is where a story gets created.
   */
  const handleNewScene = useCallback(async () => {
    if (!context || !uiService || !storyService || !inputDialog) {
      return;
    }
    const storyId = storyService.getDefaultStoryId() ?? storyService.listStories()[0]?.id;
    if (!storyId) {
      uiService.getStore().setPanelVisibility(STORY_PANEL_ID, true);
      return;
    }
    const name = await inputDialog.show({
      title: t("story.panel.newSceneTitle"),
      placeholder: t("story.panel.newScenePlaceholder"),
      required: true,
      maxLength: 120
    });
    if (!name) {
      return;
    }
    const scene = storyService.createScene(storyId, { name });
    uiService.editor.open(createStorySceneEditorTab({ storyId, sceneId: scene.id }, scene.name));
  }, [context, inputDialog, storyService, t, uiService]);

  const handleOpenAssets = useCallback(() => {
    uiService?.getStore().setPanelVisibility(ASSETS_PANEL_ID, true);
  }, [uiService]);

  const openTopic = useCallback(
    (topicId?: HelpTopicId) => {
      if (context) {
        openHelpTab(context, topicId);
      }
    },
    [context]
  );

  return (
    <div className="h-full overflow-auto bg-surface">
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/*
                    Same heading pair as the launcher's empty projects tab and the dashboard:
                    `text-xl font-medium` over `text-sm text-fg-muted`. A page opened once per
                    project does not get its own type scale.
                */}
        <div className="mb-8">
          <h1 className="text-xl font-medium text-fg">{t("welcome.title")}</h1>
          <p className="mt-2 text-sm text-fg-muted">{t("welcome.subtitle")}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <QuickAction
            icon={SquarePlus}
            label={t("welcome.quickActions.newScene.label")}
            description={t("welcome.quickActions.newScene.description")}
            onClick={() => void handleNewScene()}
            // Creating a scene writes the story document: on a frozen project this
            // card asked for a name, took it, and dropped the scene on the floor.
            {...freeze.writes(!storyService)}
          />
          <QuickAction
            icon={FolderOpen}
            label={t("welcome.quickActions.openAssets.label")}
            description={t("welcome.quickActions.openAssets.description")}
            onClick={handleOpenAssets}
            disabled={!uiService}
          />
          <QuickAction
            icon={CircleQuestionMark}
            label={t("welcome.quickActions.help.label")}
            description={t("welcome.quickActions.help.description")}
            onClick={() => openTopic()}
            disabled={!context}
          />
        </div>

        <div className="mt-8">
          <div className="text-2xs text-fg-subtle">{t(helpSectionKey("start"))}</div>
          <div className="mt-1">
            {FIRST_TOPICS.map((topicId) => (
              <button
                key={topicId}
                type="button"
                disabled={!context}
                onClick={() => openTopic(topicId)}
                className="flex h-7 w-full cursor-default items-center rounded-md px-2 text-left text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-50"
              >
                {t(helpTitleKey(topicId))}
              </button>
            ))}
          </div>
        </div>

        {/*
                    How to get back here. The Help menu is the native macOS menu bar, which does
                    not exist on Windows/Linux - and the Help action group is `menuSlot: "none"`,
                    so there is no in-app menu standing in for it. Everywhere else the command
                    palette is the only route, so that is what those users are pointed at.
                */}
        <p className="mt-8 text-2xs text-fg-subtle">
          {isMacPlatform() ? t("welcome.reopenHint.menu") : t("welcome.reopenHint.palette")}
        </p>
      </div>
    </div>
  );
}

interface QuickActionProps {
  icon: LucideIcon;
  /** Action name, shown as the card's title */
  label: string;
  /** One line on what the action does */
  description: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why the card is off, when it is - a frozen workspace says so on hover rather than in the card. */
  title?: string;
}

/**
 * Quick action card
 * A single entry point out of the welcome screen and into real work
 */
function QuickAction({
  icon: Icon,
  label,
  description,
  onClick,
  disabled = false,
  title
}: QuickActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={title}
      className={cn(
        "flex flex-col items-start gap-1 rounded-md p-3 text-left",
        "border border-edge bg-fill-subtle",
        "transition-colors duration-150 ease-out focus:outline-none focus-visible:border-primary",
        "cursor-default hover:bg-fill hover:border-edge-strong",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-fill-subtle disabled:hover:border-edge"
      )}
    >
      <Icon className="mb-1 h-4 w-4 text-fg-muted" />
      <span className="text-sm font-medium text-fg">{label}</span>
      <span className="text-2xs text-fg-subtle">{description}</span>
    </button>
  );
}
