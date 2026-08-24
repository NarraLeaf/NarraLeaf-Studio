import { AnimatePresence, motion } from "motion/react";
import {
    BookOpen,
    ChevronDown,
    Ellipsis,
    FolderOpen,
    Home,
    LayoutDashboard,
    Menu,
    Package,
    PanelBottom,
    PanelLeft,
    PanelRight,
    PanelsTopLeft,
    Play,
    Puzzle,
    Search,
    Settings,
    Terminal,
    Users,
    X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useProductIconSrc } from "@/lib/appearance/useProductIcon";
import { cn } from "@/lib/utils/cn";
import type { TranslationKey } from "@shared/i18n";
import { useOnboardingPreferences } from "../onboardingPreferences";
import { ConsolePreview } from "./ConsolePreview";
import { DashboardPreview } from "./DashboardPreview";
import { StoryScenePreview } from "./StoryScenePreview";
import { VersionRailPreview } from "./VersionRailPreview";
import { WelcomePreview } from "./WelcomePreview";

/**
 * The top-left corner of a Studio workspace window, drawn at full size and cut off by the screen
 * that shows it.
 *
 * **A corner, not a miniature.** The frame is laid out at the width and height a workspace is worked
 * in and the setup screen has room for the left third of it, so the type is at its real size and the
 * columns at their real widths; everything past the crop is simply not on screen, the way the right
 * half of a window is not on screen when it runs off a laptop display. A scaled-down likeness would
 * teach proportions the product does not have.
 *
 * **Every part is copied from the surface it stands for**, so the window that opens after setup is
 * the one that was just on screen: the 40px title bar with its mark, hamburger, project switcher and
 * run control from `TitleBar` / `MainMenuButton` / `ProjectSwitcher` / `RunControl`; the 48px rail
 * and its 40px squares from `LeftSidebarSelector`, carrying the panels a workspace registers in the
 * order it registers them; the 36px editor tabs with the accent bar over the active one from
 * `EditorGroup`; the 320px version column from `VersionRail`.
 *
 * **The chrome is inert.** The rail, the tabs and the title bar are drawn as text and glyphs rather
 * than as controls - there is no project behind this window for them to open. What does answer is
 * the scene, whose rows select and whose insert slot takes typing, because the story screen's
 * settings are about reading and typing in one.
 *
 * **One object across the whole flow.** The language names its panels, the theme and accent paint
 * it, the zoom sizes it - this window is zoomed with every other, so the corner grows along with the
 * interface it stands for - the identity signs its versions, and the story preferences set its rows.
 * A screen only says which surface to bring forward.
 */

/** Which of Studio's surfaces the corner is showing. */
export type PreviewSurfaceId = "welcome" | "dashboard" | "story" | "console" | "versions";

/**
 * The width the frame is laid out at, and the basis for what the crop leaves out.
 *
 * 960 is the narrow end of what Studio is worked in, and it is chosen for what it does to the
 * surfaces behind the crop: the dashboard and the welcome page both centre a column of fixed width,
 * so on a wider frame the only thing in the visible third would be that column's left margin.
 */
const FRAME_WIDTH_PX = 960;

/** How long the page inside the editor takes to change, matched to the screens beside it. */
const SURFACE_DURATION_S = 0.18;

/** The left rail, as a workspace registers it: the panel modules in `order`, then the fold. */
const RAIL: readonly { icon: LucideIcon; labelKey?: TranslationKey; label?: string }[] = [
    { icon: LayoutDashboard, labelKey: "placeholders.moduleTitles.dashboard" },
    { icon: Package, labelKey: "placeholders.moduleTitles.project" },
    { icon: BookOpen, labelKey: "placeholders.moduleTitles.story" },
    { icon: PanelsTopLeft, label: "UI" },
    { icon: Users, labelKey: "placeholders.moduleTitles.characters" },
    { icon: Search, labelKey: "placeholders.moduleTitles.search" },
    { icon: FolderOpen, labelKey: "placeholders.moduleTitles.assets" },
    { icon: Puzzle, labelKey: "placeholders.moduleTitles.plugins" },
    { icon: Ellipsis, labelKey: "workspace.shell.panelGroup.title" },
];

/** The window's three dock toggles and its settings button, as `ControlBar` draws them. */
const CONTROL_BAR: readonly LucideIcon[] = [PanelLeft, PanelBottom, PanelRight, Settings];

export interface StudioPreviewProps {
    /** Which surface this screen is about. */
    surface: PreviewSurfaceId;
}

export function StudioPreview({ surface }: StudioPreviewProps) {
    const { t } = useTranslation();
    const preferences = useOnboardingPreferences();
    const productIconSrc = useProductIconSrc();
    const projectName = t("onboarding.sample.projectName");

    // The version column is a column of the window rather than a page in it, which is also what
    // keeps it inside the crop: 320px against the window's left edge.
    const railPanel = surface === "versions";
    // A column is not an editor tab, so the editor behind one still holds whatever was last in
    // front of it.
    const front: PreviewSurfaceId = railPanel ? "dashboard" : surface;

    return (
        <div
            aria-hidden
            // Raised off the screen behind it, the way every window in front of another one is.
            // Cast up and to the LEFT rather than down and to the right, which is where `shadow-2xl`
            // and every other preset puts it: the crop takes the bottom and right edges, so a
            // shadow that falls that way falls entirely outside the screen and the frame reads as a
            // flat region of it. Same reason and same shape as the panel overlays that slide in from
            // the right (`ProjectPanel`, `PluginsPanel`).
            className="flex h-full flex-col overflow-hidden rounded-tl-md border-l border-t border-edge-strong bg-surface shadow-[-12px_-2px_36px_rgba(0,0,0,0.35)]"
            style={{ width: FRAME_WIDTH_PX }}
        >
            <div className="flex h-10 min-h-10 shrink-0 items-center border-b border-edge bg-surface-sunken">
                <span className="flex h-full shrink-0 items-center px-4">
                    <img src={productIconSrc} alt="" className="h-5 w-5" />
                </span>
                {/* The menu bar folded behind one button, which is how Studio leaves the factory. */}
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-muted">
                    <Menu className="h-4 w-4" />
                </span>
                <span className="flex h-8 min-w-0 max-w-56 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted">
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">{projectName}</span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                </span>
                <span className="flex h-8 shrink-0 items-center rounded-md text-sm text-fg-muted">
                    <span className="flex items-center gap-1.5 px-2">
                        <Play className="h-4 w-4" />
                        {t("actions.run.devMode")}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                </span>

                <span className="flex h-full min-w-0 flex-1 items-center justify-center px-3">
                    <span className="flex h-6 w-full min-w-0 max-w-[720px] items-center justify-center gap-1.5 rounded-md border border-edge bg-fill-subtle px-3 text-xs text-fg-subtle">
                        <Search className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                            {t("workspace.shell.search.titleBarPlaceholder", { name: projectName })}
                        </span>
                    </span>
                </span>

                <span className="flex h-full shrink-0 items-center gap-1 pr-1.5">
                    {CONTROL_BAR.map((Icon, index) => (
                        <span key={index} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted">
                            <Icon className="h-4 w-4" />
                        </span>
                    ))}
                </span>
            </div>

            <div className="flex min-h-0 flex-1">
                {/* Left of the panel rail, where the window puts it: which version is on screen
                    decides what every column to its right is a view of. */}
                {railPanel ? <VersionRailPreview /> : null}

                <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-edge bg-surface-sunken px-1 py-2">
                    {RAIL.map((entry, index) => (
                        <span
                            key={index}
                            className={cn(
                                "grid h-10 w-10 place-items-center rounded-md",
                                // Lit for the panel whose editor is in front, exactly as the rail
                                // lights the open one.
                                index === railIndexFor(front) ? "bg-fill-strong text-fg" : "text-fg-muted",
                            )}
                        >
                            <entry.icon className="h-4 w-4" />
                        </span>
                    ))}
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                    <EditorTabStrip front={front} />
                    {/* The chrome around it holds still and the page inside it changes, which is
                        what happens when a tab is brought forward. `mode="wait"` because the two
                        pages are opaque and the same size: overlapping them would read as a fault
                        rather than as a change. */}
                    <div className="relative min-h-0 flex-1">
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={front}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: SURFACE_DURATION_S, ease: "easeOut" }}
                                className="absolute inset-0 flex flex-col"
                            >
                                {front === "story" ? (
                                    <StoryScenePreview story={preferences.story} textStyle={preferences.storyTextStyle} />
                                ) : front === "console" ? (
                                    <ConsolePreview />
                                ) : front === "welcome" ? (
                                    <WelcomePreview />
                                ) : (
                                    <DashboardPreview />
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Which rail square a surface belongs to. Only the panels that have one are named. */
function railIndexFor(surface: PreviewSurfaceId): number {
    return surface === "story" ? 2 : 0;
}

/**
 * The editor's tab strip, with the open surface in front and the rest beside it.
 *
 * Four tabs rather than a strip that changes shape: the dashboard, the welcome page and the console
 * are editor tabs in Studio like any other, so a window showing one of them is a window with all
 * four open and one of them in front. The open one is listed first - in a real window a tab's
 * position is the history of what was opened when, and a sample has no history, while the tab being
 * looked at has to be inside the crop.
 *
 * Clipped rather than scrollable, with the fade the real strip draws along the edge that has more.
 */
function EditorTabStrip({ front }: { front: PreviewSurfaceId }) {
    const { t } = useTranslation();
    const all: { id: PreviewSurfaceId; icon: LucideIcon; label: string }[] = [
        { id: "dashboard", icon: LayoutDashboard, label: t("placeholders.moduleTitles.dashboard") },
        { id: "welcome", icon: Home, label: t("placeholders.moduleTitles.welcome") },
        { id: "story", icon: BookOpen, label: t("onboarding.sample.scene") },
        { id: "console", icon: Terminal, label: t("placeholders.moduleTitles.console") },
    ];
    const tabs = [
        ...all.filter(tab => tab.id === front),
        ...all.filter(tab => tab.id !== front),
    ];

    return (
        <div className="relative shrink-0 overflow-hidden border-b border-edge bg-surface-sunken">
            <div className="flex items-stretch">
                {tabs.map(tab => {
                    const active = tab.id === front;
                    return (
                        <span
                            key={tab.id}
                            className={cn(
                                "relative flex h-9 shrink-0 items-center gap-2 border-r border-edge px-3",
                                active ? "bg-primary/[0.15] text-fg" : "bg-surface-sunken text-fg-muted",
                            )}
                        >
                            {active ? <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" /> : null}
                            <tab.icon className="h-4 w-4 shrink-0" />
                            <span className="whitespace-nowrap text-sm">{tab.label}</span>
                            {active ? <X className="h-3 w-3 shrink-0 text-fg-subtle" /> : null}
                        </span>
                    );
                })}
            </div>
            <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-sunken to-transparent" />
        </div>
    );
}
