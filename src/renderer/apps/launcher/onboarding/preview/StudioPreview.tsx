import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import {
    BookOpen,
    ChevronDown,
    Cloud,
    CloudOff,
    FolderOpen,
    GitBranch,
    GitCommitHorizontal,
    LayoutDashboard,
    PanelBottom,
    PanelLeft,
    PanelRight,
    Settings,
    Users,
    X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ServerRow } from "@/lib/vcs/servers";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import type { TranslationKey } from "@shared/i18n";
import { composeVcsIdentity } from "@shared/types/vcs";
import { useOnboardingPreferences } from "../onboardingPreferences";
import { useOnboardingServers } from "../onboardingServers";
import { StoryScenePreview } from "./StoryScenePreview";

/**
 * Studio's own window, small: the pane on the right of every setup screen.
 *
 * **A likeness, not an invention.** Every part of it is copied from the surface it stands for -
 * the title bar's height and its two clusters from `TitleBar`, the 48px icon rail and its 40px
 * squares from `LeftSidebarSelector`, the 36px editor tabs with the accent bar over the active one
 * from `EditorGroup`, the 48px panel header from `LeftSidebar`, the 24px strip of small type from
 * `StatusBar`. An author who finishes setup should recognise the window that opens as the one they
 * were just looking at; a preview drawn to its own taste teaches them a layout the product does not
 * have.
 *
 * **The chrome is inert.** The tabs, the rail, the window buttons and the panel headers are drawn
 * as text and glyphs rather than as controls: they are here to be recognised, and a rail that
 * answered a click would be promising a workspace this window has no project to fill. What DOES
 * answer is the scene - rows select, the insert slot takes focus - because that is the part the
 * settings on the left actually change, and a still picture of an editor cannot show what those
 * settings do to reading and typing in one.
 *
 * **One object across the whole flow.** Every answer lands in it: the language names its panels and
 * spells its commands, the theme and the accent paint it, the zoom sizes it (this window is zoomed
 * too, so the likeness grows with everything else), the identity signs its revisions, and the story
 * preferences set its rows. A screen only says which surface to open on.
 */

export type PreviewPanelId = "story" | "versions" | "team";

/** The rail, in the order these panels sit in a real window. */
const RAIL: { icon: LucideIcon; labelKey: TranslationKey; panel?: PreviewPanelId }[] = [
    { icon: LayoutDashboard, labelKey: "placeholders.moduleTitles.dashboard" },
    { icon: BookOpen, labelKey: "placeholders.moduleTitles.story", panel: "story" },
    { icon: Users, labelKey: "placeholders.moduleTitles.characters" },
    { icon: FolderOpen, labelKey: "placeholders.moduleTitles.assets" },
    { icon: GitBranch, labelKey: "onboarding.sample.rail.versions", panel: "versions" },
    { icon: Cloud, labelKey: "onboarding.sample.rail.team", panel: "team" },
];

/** The window's three toggles and its settings button, as `ControlBar` draws them. */
const CONTROL_BAR: LucideIcon[] = [PanelLeft, PanelBottom, PanelRight, Settings];

export interface StudioPreviewProps {
    /** Which surface this screen is about. */
    panel: PreviewPanelId;
}

export function StudioPreview({ panel }: StudioPreviewProps) {
    const { t } = useTranslation();
    const preferences = useOnboardingPreferences();

    return (
        // Rounded and bordered on the left, open on the right: the window is cut by the screen
        // edge rather than ending there, and a border down that side would say it ends.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-l-md border-y border-l border-edge bg-surface">
            {/* The title bar: the project on the left, the window's own toggles on the right. */}
            <div aria-hidden className="flex h-10 min-h-10 shrink-0 items-center bg-surface-sunken px-1.5">
                <span className="flex h-8 min-w-0 max-w-40 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted">
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t("onboarding.sample.projectName")}</span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                </span>
                <span className="ml-auto flex items-center gap-1">
                    {CONTROL_BAR.map((Icon, index) => (
                        <span key={index} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted">
                            <Icon className="h-4 w-4" />
                        </span>
                    ))}
                </span>
            </div>

            <div className="flex min-h-0 flex-1 border-t border-edge">
                {/* The panel rail. The panel this screen is about is the one lit. */}
                <div
                    aria-hidden
                    className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-edge bg-surface-sunken px-1 py-2"
                >
                    {RAIL.map((entry, index) => (
                        <span
                            key={index}
                            className={cn(
                                "grid h-10 w-10 place-items-center rounded-md",
                                entry.panel === panel ? "bg-fill-strong text-fg" : "text-fg-muted",
                            )}
                        >
                            <entry.icon className="h-4 w-4" />
                        </span>
                    ))}
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                    {panel === "story" ? (
                        <>
                            <EditorTabStrip />
                            <StoryScenePreview story={preferences.story} textStyle={preferences.storyTextStyle} />
                        </>
                    ) : panel === "versions" ? (
                        <PanelSurface icon={GitBranch} title={t("onboarding.sample.rail.versions")}>
                            <VersionsPanel />
                        </PanelSurface>
                    ) : (
                        <PanelSurface icon={Cloud} title={t("onboarding.sample.rail.team")}>
                            <TeamPanel />
                        </PanelSurface>
                    )}
                </div>
            </div>

            {/* The status bar: small type, the branch on the left, the zoom on the right - which is
                where Studio actually reports the setting the third screen asks about. */}
            <div aria-hidden className="flex h-6 shrink-0 items-center justify-between border-t border-edge bg-surface-sunken px-1.5">
                <span className="flex h-full items-center gap-1.5 px-2 text-2xs text-fg-subtle">
                    <GitBranch className="h-3 w-3" />
                    main
                </span>
                <span className="flex h-full items-center gap-1.5 px-2 text-2xs tabular-nums text-fg-subtle">
                    {preferences.zoomPercent}%
                </span>
            </div>
        </div>
    );
}

/**
 * The editor's tab strip: one open scene, one tab beside it, and the accent bar the active tab
 * wears. Clipped rather than scrollable, with the fade the real strip uses to say there is more
 * along that edge.
 */
function EditorTabStrip() {
    const { t } = useTranslation();
    return (
        <div aria-hidden className="relative shrink-0 overflow-hidden border-b border-edge bg-surface-sunken">
            <div className="flex items-stretch">
                <span className="relative flex h-9 shrink-0 items-center gap-2 border-r border-edge bg-primary/[0.15] px-3 text-fg">
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />
                    <BookOpen className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap text-sm">{t("onboarding.sample.scene")}</span>
                    <X className="h-3 w-3 shrink-0 text-fg-subtle" />
                </span>
                <span className="flex h-9 shrink-0 items-center gap-2 border-r border-edge bg-surface-sunken px-3 text-fg-muted">
                    <Users className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap text-sm">{t("placeholders.moduleTitles.characters")}</span>
                </span>
            </div>
            <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-sunken to-transparent" />
        </div>
    );
}

/** A docked panel, headed the way `LeftSidebar` heads one. */
function PanelSurface({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div aria-hidden className="flex h-12 shrink-0 items-center justify-between border-b border-edge bg-surface-sunken px-4">
                <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-fg-muted" />
                    <span className="truncate text-sm font-medium text-fg">{title}</span>
                </span>
                <X className="h-4 w-4 shrink-0 text-fg-subtle" />
            </div>
            {children}
        </div>
    );
}

/**
 * The version panel: two recorded revisions, signed the way this installation signs them.
 *
 * The signature is composed by `composeVcsIdentity`, the same fold that reaches the repository, so
 * what the sample prints is the string a commit would actually carry - including the `Name <email>`
 * shape, and including the tool's own name when both fields are empty.
 */
function VersionsPanel() {
    const { t } = useTranslation();
    const { authorName, authorEmail } = useOnboardingPreferences();
    const identity = composeVcsIdentity(authorName, authorEmail) || APP_DISPLAY_NAME;

    const entries: TranslationKey[] = [
        "onboarding.sample.versions.latest",
        "onboarding.sample.versions.earlier",
    ];

    return (
        <div aria-hidden className="min-h-0 flex-1 overflow-y-auto p-2">
            {entries.map(key => (
                <div key={key} className="flex items-start gap-2 rounded-md px-2 py-1.5">
                    <GitCommitHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <div className="min-w-0">
                        <div className="truncate text-xs text-fg">{t(key)}</div>
                        <div className="truncate text-2xs text-fg-subtle">
                            {t("onboarding.sample.versions.checkpoint")} · {identity}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * The team panel: the servers this installation is signed in to, drawn with the row every other
 * screen draws a server with.
 *
 * Read live rather than mocked, because this one genuinely can be: the Team step signs in through
 * the ordinary dialog, so the moment a server is added it appears here - which is the whole answer
 * to "did that work".
 */
function TeamPanel() {
    const { t } = useTranslation();
    const { servers, loading } = useOnboardingServers();

    if (loading) {
        return <div className="min-h-0 flex-1" />;
    }

    if (servers.length === 0) {
        return (
            <div aria-hidden className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                <CloudOff className="h-5 w-5 text-fg-subtle" />
                <span className="text-xs text-fg-subtle">{t("onboarding.sample.teamAlone")}</span>
            </div>
        );
    }

    return (
        <div aria-hidden className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {servers.map(session => (
                <ServerRow key={session.remoteOrigin} session={session} size="sm" />
            ))}
        </div>
    );
}
