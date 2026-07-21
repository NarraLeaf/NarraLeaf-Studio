import { useCallback, useMemo } from "react";
import { BookOpen, FolderOpen, Sparkles, SquarePlus, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { createInputDialog } from "@/lib/components/dialogs";
import { cn } from "@/lib/utils/cn";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { useWorkspace } from "../../context";
import { EditorComponentProps } from "../types";

const ASSETS_PANEL_ID = "narraleaf-studio:assets";
const STORY_PANEL_ID = "narraleaf-studio:story";

/** Where "View tutorials" goes; mirrors the launcher's Learning tab entry point. */
const TUTORIAL_URL = "https://www.narraleaf.com/docs/studio";

/**
 * Welcome editor component
 * Displays a welcome screen with quick actions and getting started guide
 */
export function WelcomeEditor({ tabId, payload }: EditorComponentProps) {
    const { t } = useTranslation();
    const { context } = useWorkspace();

    const uiService = useMemo(() => context?.services.get<UIService>(Services.UI) ?? null, [context]);
    const storyService = useMemo(() => context?.services.get<StoryService>(Services.Story) ?? null, [context]);
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
            maxLength: 120,
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

    const handleOpenTutorials = useCallback(() => {
        void getInterface().app.openExternal(TUTORIAL_URL);
    }, []);

    return (
        <div className="h-full overflow-auto bg-surface">
            <div className="max-w-4xl mx-auto py-12 px-6">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="flex items-center justify-center gap-3 mb-4">
                        <Sparkles className="w-12 h-12 text-primary" />
                        <h1 className="text-4xl font-bold text-fg">{t("common.appName")}</h1>
                    </div>
                    <p className="text-lg text-fg-muted">
                        {t("welcome.tagline")}
                    </p>
                </div>

                {/* Quick actions */}
                <div className="grid gap-3 mb-8 sm:grid-cols-3">
                    <QuickAction
                        icon={SquarePlus}
                        label={t("welcome.quickActions.newScene.label")}
                        description={t("welcome.quickActions.newScene.description")}
                        onClick={() => void handleNewScene()}
                        disabled={!storyService}
                    />
                    <QuickAction
                        icon={FolderOpen}
                        label={t("welcome.quickActions.openAssets.label")}
                        description={t("welcome.quickActions.openAssets.description")}
                        onClick={handleOpenAssets}
                        disabled={!uiService}
                    />
                    <QuickAction
                        icon={BookOpen}
                        label={t("welcome.quickActions.tutorials.label")}
                        description={t("welcome.quickActions.tutorials.description")}
                        onClick={handleOpenTutorials}
                    />
                </div>

                {/* Getting Started */}
                <div className="bg-surface-raised rounded-lg p-6 border border-edge">
                    <h2 className="text-xl font-semibold text-fg mb-4">{t("welcome.gettingStarted.title")}</h2>
                    <div className="space-y-4">
                        <GettingStartedStep
                            number={1}
                            title={t("welcome.gettingStarted.step1.title")}
                            description={t("welcome.gettingStarted.step1.description")}
                        />
                        <GettingStartedStep
                            number={2}
                            title={t("welcome.gettingStarted.step2.title")}
                            description={t("welcome.gettingStarted.step2.description")}
                        />
                        <GettingStartedStep
                            number={3}
                            title={t("welcome.gettingStarted.step3.title")}
                            description={t("welcome.gettingStarted.step3.description")}
                        />
                        <GettingStartedStep
                            number={4}
                            title={t("welcome.gettingStarted.step4.title")}
                            description={t("welcome.gettingStarted.step4.description")}
                        />
                    </div>
                </div>

                {/*
                    How to get back here. The Help menu is the native macOS menu bar, which does
                    not exist on Windows/Linux - and the Help action group is `menuSlot: "none"`,
                    so there is no in-app menu standing in for it. Everywhere else the command
                    palette is the only route, so that is what those users are pointed at.
                */}
                <p className="mt-6 text-center text-xs text-fg-subtle">
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
}

/**
 * Quick action card
 * A single entry point out of the welcome screen and into real work
 */
function QuickAction({ icon: Icon, label, description, onClick, disabled = false }: QuickActionProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "flex flex-col items-start gap-1 text-left rounded-lg p-4",
                "bg-surface-raised border border-edge",
                "transition-colors duration-150 ease-out focus:outline-none focus-visible:border-primary",
                "cursor-default hover:bg-fill hover:border-edge-strong",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface-raised disabled:hover:border-edge",
            )}
        >
            <Icon className="w-5 h-5 text-primary mb-1" />
            <span className="text-sm font-medium text-fg">{label}</span>
            <span className="text-xs text-fg-muted">{description}</span>
        </button>
    );
}

interface GettingStartedStepProps {
    /** Step number */
    number: number;
    /** Step title */
    title: string;
    /** Step description */
    description: string;
}

/**
 * Getting started step component
 * Displays a numbered step in the getting started guide
 */
function GettingStartedStep({ number, title, description }: GettingStartedStepProps) {
    return (
        <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold text-sm">
                {number}
            </div>
            <div>
                <h3 className="text-base font-medium text-fg mb-1">{title}</h3>
                <p className="text-sm text-fg-muted">{description}</p>
            </div>
        </div>
    );
}
