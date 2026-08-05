import { useMemo } from "react";
import { AudioLines, Boxes, ChevronRight, Gamepad2, Image as ImageIcon, Info, ListChecks, Puzzle, SlidersHorizontal, UserCog, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { InteractiveCard } from "@/lib/components/elements";
import type { ProjectConfig } from "@/lib/workspace/project/project";

export type ProjectSectionId = "details" | "game" | "preferences" | "audio" | "assets" | "settings" | "dependencies" | "runtimes" | "linting";

export type ProjectNavItem = {
    id: ProjectSectionId;
    title: string;
    description: string;
    icon: LucideIcon;
};

const PROJECT_NAV_ICONS: Record<ProjectSectionId, LucideIcon> = {
    details: Info,
    game: Gamepad2,
    preferences: UserCog,
    audio: AudioLines,
    assets: ImageIcon,
    dependencies: Puzzle,
    runtimes: Boxes,
    linting: ListChecks,
    settings: SlidersHorizontal,
};

// Game sits next to Details on purpose: both describe the game itself, while
// Assets / Dependencies / Runtimes / Linting / Settings describe how it is built
// and shipped. Preferences follows Game because it is the same class of thing one
// step closer to the player: Game is what the game does, Preferences is where the
// player's own controls start. Audio follows for the same reason Game follows
// Details - an audio track is a decision about what the player hears, not about packaging.
// Runtimes follows Dependencies because it answers the same shape of question -
// what does this project need that is not in it yet - for the author-supplied 2D
// model runtimes rather than for plugins. Linting sits last before Settings
// because it is the only one that describes what the project is checked against
// rather than what it is made of.
const PROJECT_NAV_ORDER: ProjectSectionId[] = ["details", "game", "preferences", "audio", "assets", "dependencies", "runtimes", "linting", "settings"];

/**
 * The project navigation rows, with localized title/description. Shared by the
 * overview list and the parent panel (which resolves the active sub-page).
 */
export function useProjectNavItems(): ProjectNavItem[] {
    const { t } = useTranslation();
    return useMemo(
        () => PROJECT_NAV_ORDER.map(id => ({
            id,
            title: t(`project.nav.${id}.title`),
            description: t(`project.nav.${id}.description`),
            icon: PROJECT_NAV_ICONS[id],
        })),
        [t],
    );
}

/**
 * Project overview: a compact identity header plus a list of setting sections.
 * Selecting a row asks the parent panel to slide in the matching sub-page.
 */
export function ProjectPanelHome({
    config,
    onOpen,
}: {
    config: ProjectConfig | null;
    onOpen: (section: ProjectSectionId) => void;
}) {
    const { t } = useTranslation();
    const navItems = useProjectNavItems();
    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
            <div className="border-b border-edge p-3">
                <div className="truncate text-sm font-semibold text-fg">
                    {config?.name?.trim() || t("project.home.untitledProject")}
                </div>
                {config?.identifier?.trim() ? (
                    <div className="mt-0.5 truncate text-2xs text-fg-subtle">{config.identifier}</div>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
                <div className="grid gap-2">
                    {navItems.map(item => {
                        const ItemIcon = item.icon;
                        return (
                            <InteractiveCard
                                key={item.id}
                                size="sm"
                                title={item.title}
                                description={item.description}
                                icon={<ItemIcon className="h-4 w-4" />}
                                actions={<ChevronRight className="h-4 w-4 text-fg-subtle" />}
                                onClick={config ? () => onOpen(item.id) : undefined}
                                className="text-left"
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
