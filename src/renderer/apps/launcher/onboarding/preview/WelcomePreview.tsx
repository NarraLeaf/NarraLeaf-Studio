import { CircleQuestionMark, FolderOpen, SquarePlus, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { helpSectionKey, helpTitleKey, type HelpTopicId } from "@/lib/help";
import { isMacPlatform } from "@/lib/app/platform";

/**
 * The Welcome tab, as Studio opens one on a project's first launch.
 *
 * What the closing screen of setup shows, because it is the next thing an author will actually see:
 * setup ends, a project opens, and this is the page in front of them. Saying so with the page itself
 * is better than describing it.
 *
 * Copied from `WelcomeEditor`: the `max-w-2xl` column, the heading pair, the three cards, the list
 * of first topics under its eyebrow, and the line at the bottom saying how to get back here - which
 * differs by platform there and differs by platform here, because the Help menu it names only
 * exists on macOS.
 *
 * Its words are the tab's own catalog keys, including the topic titles, which come from the help
 * catalog exactly as the real page's do.
 */

/** The four topics a first-time author needs, in the order the real page lists them. */
const FIRST_TOPICS: readonly HelpTopicId[] = ["workspaceLayout", "storyScene", "assets", "runModes"];

export function WelcomePreview() {
    const { t } = useTranslation();

    return (
        <div aria-hidden className="h-full min-h-0 overflow-auto bg-surface">
            <div className="mx-auto max-w-2xl px-6 py-10">
                <div className="mb-8">
                    <h1 className="text-xl font-medium text-fg">{t("welcome.title")}</h1>
                    <p className="mt-2 text-sm text-fg-muted">{t("welcome.subtitle")}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                    <QuickAction
                        icon={SquarePlus}
                        label={t("welcome.quickActions.newScene.label")}
                        description={t("welcome.quickActions.newScene.description")}
                    />
                    <QuickAction
                        icon={FolderOpen}
                        label={t("welcome.quickActions.openAssets.label")}
                        description={t("welcome.quickActions.openAssets.description")}
                    />
                    <QuickAction
                        icon={CircleQuestionMark}
                        label={t("welcome.quickActions.help.label")}
                        description={t("welcome.quickActions.help.description")}
                    />
                </div>

                <div className="mt-8">
                    <div className="text-2xs text-fg-subtle">{t(helpSectionKey("start"))}</div>
                    <div className="mt-1">
                        {FIRST_TOPICS.map(topicId => (
                            <span
                                key={topicId}
                                className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-fg-muted"
                            >
                                {t(helpTitleKey(topicId))}
                            </span>
                        ))}
                    </div>
                </div>

                <p className="mt-8 text-2xs text-fg-subtle">
                    {isMacPlatform() ? t("welcome.reopenHint.menu") : t("welcome.reopenHint.palette")}
                </p>
            </div>
        </div>
    );
}

/** One of the three cards. Drawn, not wired: this page opens nothing. */
function QuickAction({ icon: Icon, label, description }: { icon: LucideIcon; label: string; description: string }) {
    return (
        <span className="flex flex-col items-start gap-1 rounded-md border border-edge bg-fill-subtle p-3 text-left">
            <Icon className="mb-1 h-4 w-4 text-fg-muted" />
            <span className="text-sm font-medium text-fg">{label}</span>
            <span className="text-2xs text-fg-subtle">{description}</span>
        </span>
    );
}
